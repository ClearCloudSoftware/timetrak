# Tracking Feature Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six independent tracking features: smart quick-start, "not tracking" nudge, weekly goals, backup/restore, idle detection, and an editable timeline.

**Architecture:** Tauri v2 menu-bar app. Rust backend (`src-tauri/`) owns SQLite via `Database { conn: Mutex<Connection> }` managed state; commands are registered in the `timetrak_handlers!` macro in `src-tauri/src/commands/mod.rs`; backend↔frontend events are string constants mirrored in `src-tauri/src/events.rs` and `src/lib/event-names.ts`. React frontend (`src/`) uses TanStack Query, Tailwind with semantic tokens, and Lucide icons.

**Tech Stack:** Rust (rusqlite, chrono, tokio), React 18 + TypeScript, Tailwind 3, vitest + @testing-library/react.

**Spec:** No standalone spec file — each Part below opens with a **Spec** block that is the requirement source for its tasks.

## Global Constraints

- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml` — must stay warning-free (currently 0 warnings).
- Frontend: `npm test` (vitest) and `npx tsc -b` must pass after every task.
- TDD: every task writes its failing test first and watches it fail.
- New Tauri commands MUST be appended to the `tauri::generate_handler![...]` list in `src-tauri/src/commands/mod.rs` and given a thin wrapper in `src/lib/api.ts` (invoke arg keys are camelCase: `invoke('goal_set', { categoryId, targetMinutes })`).
- Frontend colors ONLY via semantic tokens (`text-label`, `text-label-2`, `bg-raised`, `bg-surface`, `bg-accent`, `text-destructive`, `border-separator`, `bg-fill`, `hover:bg-fill-hover`); icons ONLY from `lucide-react`; text sizes follow existing 10–13px conventions.
- Settings key/value config lives in the `app_meta` table (`INSERT ... ON CONFLICT(key) DO UPDATE`), never in new one-off tables.
- Native dialogs via `@tauri-apps/plugin-dialog` (`ask`, `message`, `save`, `open`) — never `confirm()`/`alert()`.
- No time/duration estimates anywhere; sizes are small/medium/large.
- Commit after every task with a conventional-commit message ending in the project's Co-Authored-By trailer.

---

# Part 1: Smart Quick-Start (small)

**Spec:** The tray's Quick Start card currently shows bare categories. Replace its content with the user's recent *combinations* (category + project + note), most recent first, max 6, drawn from the last 14 days of entries. Clicking a combo starts/switches a timer with that exact combination. When there are no combos yet, fall back to the existing category grid. The existing empty state ("No categories yet") stays.

### Task 1.1: repo query for recent combos

**Files:**
- Modify: `src-tauri/src/repo/entries.rs` (append)

**Interfaces:**
- Produces: `pub struct RecentCombo { pub category_id: Uuid, pub project_id: Option<Uuid>, pub note: Option<String> }` (derives `Debug, Clone, serde::Serialize`) and `pub fn recent_combos(conn: &Connection, since: DateTime<Utc>, limit: u32) -> AppResult<Vec<RecentCombo>>` in `crate::repo::entries`.

- [ ] **Step 1: Write the failing test** (append inside a new `#[cfg(test)] mod recent_combo_tests` at the end of `src-tauri/src/repo/entries.rs`)

```rust
#[cfg(test)]
mod recent_combo_tests {
    use super::*;
    use crate::test_support::*;

    fn insert_with_note(conn: &rusqlite::Connection, cat: uuid::Uuid, start: &str, end: &str, note: Option<&str>) {
        conn.execute(
            "INSERT INTO time_entry (id, category_id, project_id, started_at, ended_at, note)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            rusqlite::params![uuid::Uuid::new_v4().to_string(), cat.to_string(), start, end, note],
        ).unwrap();
    }

    #[test]
    fn recent_combos_dedupes_and_orders_by_recency() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        // Same combo twice (older + newer) must appear once, ranked by newest use.
        insert_with_note(&conn, coding(), "2026-08-20T09:00:00Z", "2026-08-20T10:00:00Z", Some("review"));
        insert_with_note(&conn, coding(), "2026-08-22T09:00:00Z", "2026-08-22T10:00:00Z", Some("review"));
        insert_with_note(&conn, meeting(), "2026-08-21T09:00:00Z", "2026-08-21T10:00:00Z", None);

        let combos = recent_combos(&conn, t("2026-08-10T00:00:00Z"), 6).unwrap();
        assert_eq!(combos.len(), 2);
        assert_eq!(combos[0].category_id, coding());
        assert_eq!(combos[0].note.as_deref(), Some("review"));
        assert_eq!(combos[1].category_id, meeting());
    }

    #[test]
    fn recent_combos_respects_since_and_limit() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        insert_with_note(&conn, coding(), "2026-01-01T09:00:00Z", "2026-01-01T10:00:00Z", None); // too old
        insert_with_note(&conn, coding(), "2026-08-22T09:00:00Z", "2026-08-22T10:00:00Z", Some("a"));
        insert_with_note(&conn, coding(), "2026-08-23T09:00:00Z", "2026-08-23T10:00:00Z", Some("b"));

        let combos = recent_combos(&conn, t("2026-08-10T00:00:00Z"), 1).unwrap();
        assert_eq!(combos.len(), 1);
        assert_eq!(combos[0].note.as_deref(), Some("b"));
    }
}
```

- [ ] **Step 2: Run and verify it fails** — `cargo test --manifest-path src-tauri/Cargo.toml recent_combos` — Expected: compile error `cannot find function recent_combos`.

- [ ] **Step 3: Implement** (append to `src-tauri/src/repo/entries.rs`, above the test mods)

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct RecentCombo {
    pub category_id: Uuid,
    pub project_id: Option<Uuid>,
    pub note: Option<String>,
}

/// Distinct (category, project, note) combinations used since `since`,
/// most recently used first. Feeds the tray's Quick Start chips.
pub fn recent_combos(conn: &Connection, since: DateTime<Utc>, limit: u32) -> AppResult<Vec<RecentCombo>> {
    let mut stmt = conn.prepare(
        "SELECT category_id, project_id, note, MAX(started_at) AS last_used
         FROM time_entry
         WHERE started_at >= ?1
         GROUP BY category_id, COALESCE(project_id, ''), COALESCE(note, '')
         ORDER BY last_used DESC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(rusqlite::params![since.to_rfc3339(), limit], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut out = Vec::new();
    for r in rows {
        let (cat, proj, note) = r?;
        let Ok(category_id) = Uuid::parse_str(&cat) else { continue };
        out.push(RecentCombo {
            category_id,
            project_id: proj.and_then(|p| Uuid::parse_str(&p).ok()),
            note,
        });
    }
    Ok(out)
}
```

- [ ] **Step 4: Run and verify it passes** — same command, Expected: `2 passed`; full suite still green.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(repo): recent (category, project, note) combos query"` (+ trailer).

### Task 1.2: command + API wrapper

**Files:**
- Modify: `src-tauri/src/commands/entries.rs` (append command)
- Modify: `src-tauri/src/commands/mod.rs` (register `list_recent_combos` in the macro list)
- Modify: `src/lib/api.ts`, `src/types.ts`

**Interfaces:**
- Consumes: `repo::entries::recent_combos` (Task 1.1).
- Produces: Tauri command `list_recent_combos() -> Vec<RecentCombo>`; TS `api.listRecentCombos(): Promise<RecentCombo[]>`; TS type `RecentCombo { category_id: Id; project_id: Id | null; note: string | null }`.

- [ ] **Step 1: Implement command** (no unit test — thin glue; the repo layer is tested. Append to `src-tauri/src/commands/entries.rs`, matching that file's existing imports/style):

```rust
#[tauri::command]
pub fn list_recent_combos(db: tauri::State<'_, crate::db::Database>) -> crate::error::AppResult<Vec<crate::repo::entries::RecentCombo>> {
    let conn = db.conn.lock().unwrap();
    let since = chrono::Utc::now() - chrono::Duration::days(14);
    crate::repo::entries::recent_combos(&conn, since, 6)
}
```

Register in `src-tauri/src/commands/mod.rs` inside `tauri::generate_handler![...]`:
```rust
            timetrak_lib::commands::entries::list_recent_combos,
```

- [ ] **Step 2: TS side.** In `src/types.ts` add:
```ts
export interface RecentCombo {
  category_id: Id;
  project_id: Id | null;
  note: string | null;
}
```
In `src/lib/api.ts` add (near the other entry functions):
```ts
export const listRecentCombos = () => invoke<RecentCombo[]>('list_recent_combos');
```
(`RecentCombo` must be added to the existing `import type { ... } from '../types'` line.)

- [ ] **Step 3: Verify** — `cargo test --manifest-path src-tauri/Cargo.toml` and `npx tsc -b` pass.

- [ ] **Step 4: Commit** — `git commit -m "feat(api): list_recent_combos command"`.

### Task 1.3: Quick Start chips render combos

**Files:**
- Modify: `src/windows/tray/QuickStartCard.tsx`
- Modify: `src/windows/tray/TrayPopover.tsx` (fetch combos, pass down)
- Modify: `src/windows/tray/TrayPopover.test.tsx` and `src/windows/tray/InlineTimerForm.test.tsx` **mocks**: add `listRecentCombos: vi.fn(async () => [])` to the `vi.mock('../../lib/api', ...)` factory of any test that renders TrayPopover (missing mock keys make the component throw).

**Interfaces:**
- Consumes: `api.listRecentCombos`, existing `startOrSwitchMut` in TrayPopover (`onStart(categoryId, projectId, description)` — note the card's `onStart` signature GAINS a third param).
- Produces: `QuickStartCard` props change to `{ categories, projects, combos, onStart: (categoryId: Id, projectId: Id | null, note: string | null) => void, pending, error }`.

- [ ] **Step 1: Write failing test** (append to `src/windows/tray/TrayPopover.test.tsx`; follow that file's existing render helper):

```tsx
it('shows recent combos as quick-start chips', async () => {
  const api = await import('../../lib/api');
  vi.mocked(api.listRecentCombos).mockResolvedValue([
    { category_id: 'c1', project_id: null, note: 'code review' },
  ]);
  renderPopover(); // use the file's existing render helper name
  expect(await screen.findByText(/code review/)).toBeTruthy();
});
```

- [ ] **Step 2: Run `npm test` — verify the new test fails** (combo note not rendered).

- [ ] **Step 3: Implement.** In `TrayPopover.tsx`: `const combos = useQuery({ queryKey: ['recentCombos'], queryFn: api.listRecentCombos });`, invalidate `['recentCombos']` wherever `['entries']` is invalidated in this file, and pass `combos={combos.data ?? []}` and `projects={projs}` to `QuickStartCard`; change the card's `onStart` wiring to pass the note through: `onStart={(categoryId, projectId, note) => startOrSwitchMut.mutate({ categoryId, projectId, description: note })}`. In `QuickStartCard.tsx`, when `combos.length > 0` render combo chips instead of the category grid (keep the category grid as the fallback and keep the existing empty state):

```tsx
{combos.map((c, i) => {
  const cat = categories.find((x) => x.id === c.category_id);
  const proj = projects.find((x) => x.id === c.project_id);
  if (!cat) return null;
  return (
    <button
      key={i}
      type="button"
      disabled={pending}
      onClick={() => onStart(c.category_id, c.project_id, c.note)}
      className="flex w-full items-center gap-1.5 rounded-md bg-raised px-2 py-1.5 text-left text-[12px] text-label ring-1 ring-inset ring-separator transition-colors hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span aria-hidden className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: cat.color }} />
      <span className="shrink-0">{cat.name}</span>
      {proj && <span className="shrink-0 text-label-2">· {proj.name}</span>}
      {c.note && <span className="truncate text-label-2">— {c.note}</span>}
    </button>
  );
})}
```
Combo list is a single column (`space-y-1`), not the 2-col grid.

- [ ] **Step 4: `npm test` and `npx tsc -b` pass** (including the updated mocks).

- [ ] **Step 5: Commit** — `git commit -m "feat(tray): quick-start chips show recent category/project/note combos"`.

---

# Part 2: "Not Tracking" Nudge (small)

**Spec:** When enabled, on Mon–Fri between a configurable start and end time (local), if no timer is running, post one macOS notification ("Nothing is being tracked") at most once per 60 minutes. Config keys in `app_meta`: `nudge_enabled` ('0'/'1', default '0'), `nudge_work_start` (default '09:00'), `nudge_work_end` (default '18:00'). Configurable from Settings → General. This part also introduces the generic prefs command pair reused by Part 5.

### Task 2.1: pure `should_nudge`

**Files:**
- Modify: `src-tauri/src/notifications.rs`

**Interfaces:**
- Produces: `pub struct NudgeConfig { pub enabled: bool, pub work_start: NaiveTime, pub work_end: NaiveTime }`, `pub fn get_nudge_config(conn: &Connection) -> NudgeConfig` (reads the three app_meta keys with defaults), and `pub fn should_nudge(cfg: &NudgeConfig, now_local: chrono::NaiveDateTime, timer_running: bool, last_nudge: Option<chrono::NaiveDateTime>) -> bool`.

- [ ] **Step 1: Failing tests** (new `#[cfg(test)] mod nudge_tests` in `notifications.rs`):

```rust
#[cfg(test)]
mod nudge_tests {
    use super::*;
    use chrono::{NaiveDateTime, NaiveTime};

    fn cfg() -> NudgeConfig {
        NudgeConfig {
            enabled: true,
            work_start: NaiveTime::from_hms_opt(9, 0, 0).unwrap(),
            work_end: NaiveTime::from_hms_opt(18, 0, 0).unwrap(),
        }
    }
    fn dt(s: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M").unwrap()
    }

    #[test]
    fn nudges_on_a_weekday_in_work_hours_when_idle() {
        // 2026-08-24 is a Monday.
        assert!(should_nudge(&cfg(), dt("2026-08-24 10:00"), false, None));
    }
    #[test]
    fn never_nudges_when_disabled_running_offhours_or_weekend() {
        let mut off = cfg(); off.enabled = false;
        assert!(!should_nudge(&off, dt("2026-08-24 10:00"), false, None));
        assert!(!should_nudge(&cfg(), dt("2026-08-24 10:00"), true, None));      // timer running
        assert!(!should_nudge(&cfg(), dt("2026-08-24 08:59"), false, None));     // before start
        assert!(!should_nudge(&cfg(), dt("2026-08-24 18:00"), false, None));     // at/after end
        assert!(!should_nudge(&cfg(), dt("2026-08-23 10:00"), false, None));     // Sunday
    }
    #[test]
    fn rate_limited_to_once_per_hour() {
        assert!(!should_nudge(&cfg(), dt("2026-08-24 10:30"), false, Some(dt("2026-08-24 10:00"))));
        assert!(should_nudge(&cfg(), dt("2026-08-24 11:00"), false, Some(dt("2026-08-24 10:00"))));
    }
}
```

- [ ] **Step 2: Run, verify compile failure** (`should_nudge` missing).

- [ ] **Step 3: Implement** in `notifications.rs`:

```rust
pub struct NudgeConfig {
    pub enabled: bool,
    pub work_start: NaiveTime,
    pub work_end: NaiveTime,
}

fn meta_str(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM app_meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

pub fn get_nudge_config(conn: &Connection) -> NudgeConfig {
    let time = |key: &str, default: &str| {
        NaiveTime::parse_from_str(&meta_str(conn, key).unwrap_or_else(|| default.into()), "%H:%M")
            .unwrap_or_else(|_| NaiveTime::parse_from_str(default, "%H:%M").unwrap())
    };
    NudgeConfig {
        enabled: meta_str(conn, "nudge_enabled").as_deref() == Some("1"),
        work_start: time("nudge_work_start", "09:00"),
        work_end: time("nudge_work_end", "18:00"),
    }
}

/// One nudge per hour, weekdays, inside [work_start, work_end), only while idle.
pub fn should_nudge(
    cfg: &NudgeConfig,
    now_local: chrono::NaiveDateTime,
    timer_running: bool,
    last_nudge: Option<chrono::NaiveDateTime>,
) -> bool {
    use chrono::Datelike;
    if !cfg.enabled || timer_running {
        return false;
    }
    if matches!(now_local.weekday(), chrono::Weekday::Sat | chrono::Weekday::Sun) {
        return false;
    }
    let t = now_local.time();
    if t < cfg.work_start || t >= cfg.work_end {
        return false;
    }
    match last_nudge {
        Some(prev) => now_local - prev >= chrono::Duration::minutes(60),
        None => true,
    }
}
```
- [ ] **Step 4: Tests pass; whole suite warning-free.**
- [ ] **Step 5: Commit** — `git commit -m "feat(nudge): should_nudge decision logic + config reader"`.

### Task 2.2: wire into the notification scheduler + prefs commands

**Files:**
- Modify: `src-tauri/src/notifications.rs` (`spawn_scheduler` loop)
- Create: `src-tauri/src/commands/prefs.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod prefs;` + register both commands)
- Modify: `src/lib/api.ts`

**Interfaces:**
- Consumes: `should_nudge`, `get_nudge_config` (Task 2.1); `repo::entries::running(&conn)`.
- Produces: commands `get_pref(key: String) -> Option<String>` and `set_pref(key: String, value: String) -> ()` with an allowlist `["nudge_enabled", "nudge_work_start", "nudge_work_end", "idle_threshold_minutes"]` (rejects other keys with `AppError::Invalid`); TS `api.getPref(key)`, `api.setPref(key, value)`.

- [ ] **Step 1: Failing test for the allowlist** (in `commands/prefs.rs`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn set_pref_rejects_keys_outside_allowlist() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        assert!(set_pref_inner(&conn, "schema_version", "999").is_err());
        assert!(set_pref_inner(&conn, "nudge_enabled", "1").is_ok());
        assert_eq!(get_pref_inner(&conn, "nudge_enabled").unwrap(), Some("1".into()));
    }
}
```

- [ ] **Step 2: Verify compile failure**, then implement `commands/prefs.rs`:

```rust
//! Small allowlisted key/value preference commands over app_meta.

use rusqlite::{Connection, OptionalExtension};
use tauri::State;

use crate::db::Database;
use crate::error::{AppError, AppResult};

const ALLOWED: &[&str] = &[
    "nudge_enabled",
    "nudge_work_start",
    "nudge_work_end",
    "idle_threshold_minutes",
];

fn check(key: &str) -> AppResult<()> {
    if ALLOWED.contains(&key) {
        Ok(())
    } else {
        Err(AppError::Invalid(format!("unknown preference: {key}")))
    }
}

pub fn get_pref_inner(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    check(key)?;
    Ok(conn
        .query_row("SELECT value FROM app_meta WHERE key = ?1", [key], |r| r.get(0))
        .optional()?)
}

pub fn set_pref_inner(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    check(key)?;
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

#[tauri::command]
pub fn get_pref(db: State<'_, Database>, key: String) -> AppResult<Option<String>> {
    let conn = db.conn.lock().unwrap();
    get_pref_inner(&conn, &key)
}

#[tauri::command]
pub fn set_pref(db: State<'_, Database>, key: String, value: String) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    set_pref_inner(&conn, &key, &value)
}
```
Register `pub mod prefs;` and the two commands in `commands/mod.rs`. In `src/lib/api.ts`:
```ts
export const getPref = (key: string) => invoke<string | null>('get_pref', { key });
export const setPref = (key: string, value: string) => invoke<void>('set_pref', { key, value });
```

- [ ] **Step 3: Scheduler wiring.** In `spawn_scheduler`'s loop (runs every 60s), add nudge handling — a local `let mut last_nudge: Option<chrono::NaiveDateTime> = None;` declared before the loop:

```rust
// inside the loop, after the daily-summary tick:
let now_local = chrono::Local::now().naive_local();
let fire = {
    let db = app.state::<crate::db::Database>();
    let conn = db.conn.lock().unwrap();
    let cfg = get_nudge_config(&conn);
    let running = crate::repo::entries::running(&conn).ok().flatten().is_some();
    should_nudge(&cfg, now_local, running, last_nudge)
};
if fire {
    last_nudge = Some(now_local);
    let _ = app
        .notification()
        .builder()
        .title("Nothing is being tracked")
        .body("Start a timer from the menu bar.")
        .show();
}
```

- [ ] **Step 4: Full verification** — `cargo test`, `npx tsc -b`, `npm test` all green, no warnings.
- [ ] **Step 5: Commit** — `git commit -m "feat(nudge): scheduler wiring + allowlisted pref commands"`.

### Task 2.3: Settings UI

**Files:**
- Modify: `src/windows/settings/panes.tsx` (`PreferencesPane`)

**Interfaces:**
- Consumes: `api.getPref` / `api.setPref` (Task 2.2); existing `Row` and `Switch` components in `panes.tsx`.

- [ ] **Step 1: Implement** (no component test — it's Switch+inputs glue over the tested command layer). Add to `PreferencesPane`, below the Appearance row:

```tsx
// state
const [nudge, setNudge] = useState(false);
const [workStart, setWorkStart] = useState('09:00');
const [workEnd, setWorkEnd] = useState('18:00');
useEffect(() => {
  api.getPref('nudge_enabled').then((v) => setNudge(v === '1'));
  api.getPref('nudge_work_start').then((v) => v && setWorkStart(v));
  api.getPref('nudge_work_end').then((v) => v && setWorkEnd(v));
}, []);
```

```tsx
<Row label="Tracking reminder" hint="Weekdays, when no timer is running.">
  <div className="flex items-center gap-2">
    <input
      className="h-6 w-14 rounded-md border border-separator bg-raised px-1 text-center text-[11px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      value={workStart}
      onChange={(e) => setWorkStart(e.target.value)}
      onBlur={() => void api.setPref('nudge_work_start', workStart)}
      placeholder="09:00"
    />
    <span className="text-[11px] text-label-2">–</span>
    <input
      className="h-6 w-14 rounded-md border border-separator bg-raised px-1 text-center text-[11px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      value={workEnd}
      onChange={(e) => setWorkEnd(e.target.value)}
      onBlur={() => void api.setPref('nudge_work_end', workEnd)}
      placeholder="18:00"
    />
    <Switch
      checked={nudge}
      onChange={() => {
        const next = !nudge;
        setNudge(next);
        void api.setPref('nudge_enabled', next ? '1' : '0');
      }}
    />
  </div>
</Row>
```
`panes.tsx` already imports `* as api`.

- [ ] **Step 2: Verify** `npx tsc -b` + `npm test`; manually check the row renders (`npm run tauri dev`).
- [ ] **Step 3: Commit** — `git commit -m "feat(settings): tracking-reminder toggle and work hours"`.

---

# Part 3: Weekly Goals (small–medium)

**Spec:** Per-category weekly target, stored as minutes, edited as hours/week in Settings → Categories. When the dashboard Table view shows the "This week" preset, the stats strip shows `spent / goal` and a mini progress bar for every category with a goal. Deleting a category deletes its goal (FK cascade).

### Task 3.1: migration v4

**Files:**
- Create: `src-tauri/src/db/migrations/v4_goals.sql`
- Modify: `src-tauri/src/db/migrations.rs`
- Modify: `src-tauri/src/db/mod.rs` (the existing test asserts `schema_version == "3"` — update to `"4"`)

- [ ] **Step 1: RED — update the existing schema test** in `db/mod.rs` to `assert_eq!(version, "4");` and add to that same test:
```rust
let goal_cnt: i64 = conn.query_row("SELECT COUNT(*) FROM weekly_goal", [], |r| r.get(0)).unwrap();
assert_eq!(goal_cnt, 0);
```
Run — fails (`no such table: weekly_goal`).

- [ ] **Step 2: Implement.** `v4_goals.sql`:
```sql
-- Weekly targets per category, in minutes.
CREATE TABLE IF NOT EXISTS weekly_goal (
  category_id    TEXT PRIMARY KEY REFERENCES category(id) ON DELETE CASCADE,
  target_minutes INTEGER NOT NULL CHECK (target_minutes > 0)
);
```
`migrations.rs`: add `const V4_GOALS: &str = include_str!("migrations/v4_goals.sql");` and `Migration { version: 4, sql: V4_GOALS },` to `MIGRATIONS`.

- [ ] **Step 3: GREEN** — full `cargo test` passes.
- [ ] **Step 4: Commit** — `git commit -m "feat(db): v4 migration — weekly_goal table"`.

### Task 3.2: repo + commands

**Files:**
- Create: `src-tauri/src/repo/goals.rs`
- Modify: `src-tauri/src/repo/mod.rs` (add `pub mod goals;`)
- Modify: `src-tauri/src/commands/categories.rs` (two commands), `src-tauri/src/commands/mod.rs` (register)
- Modify: `src/lib/api.ts`, `src/types.ts`

**Interfaces:**
- Produces: `repo::goals::set(conn, category_id: Uuid, target_minutes: Option<u32>) -> AppResult<()>` (None deletes) and `repo::goals::all(conn) -> AppResult<Vec<WeeklyGoal>>` where `pub struct WeeklyGoal { pub category_id: Uuid, pub target_minutes: u32 }` (derives `Debug, Clone, serde::Serialize`); commands `goals_list() -> Vec<WeeklyGoal>`, `goal_set(category_id: Uuid, target_minutes: Option<u32>)`; TS `WeeklyGoal { category_id: Id; target_minutes: number }`, `api.listGoals()`, `api.setGoal(categoryId, targetMinutes | null)`.

- [ ] **Step 1: RED** — `src-tauri/src/repo/goals.rs` with the test first:

```rust
use rusqlite::Connection;
use uuid::Uuid;

use crate::error::AppResult;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn set_get_and_clear_goal() {
        let db = fresh_db();
        let conn = db.conn.lock().unwrap();
        set(&conn, coding(), Some(1200)).unwrap();
        set(&conn, coding(), Some(900)).unwrap(); // upsert
        assert_eq!(all(&conn).unwrap(), vec![WeeklyGoal { category_id: coding(), target_minutes: 900 }]);
        set(&conn, coding(), None).unwrap(); // clear
        assert!(all(&conn).unwrap().is_empty());
    }
}
```
Run → compile failure. Implement:

```rust
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct WeeklyGoal {
    pub category_id: Uuid,
    pub target_minutes: u32,
}

pub fn set(conn: &Connection, category_id: Uuid, target_minutes: Option<u32>) -> AppResult<()> {
    match target_minutes {
        Some(m) => {
            conn.execute(
                "INSERT INTO weekly_goal (category_id, target_minutes) VALUES (?1, ?2)
                 ON CONFLICT(category_id) DO UPDATE SET target_minutes = excluded.target_minutes",
                rusqlite::params![category_id.to_string(), m],
            )?;
        }
        None => {
            conn.execute(
                "DELETE FROM weekly_goal WHERE category_id = ?1",
                [category_id.to_string()],
            )?;
        }
    }
    Ok(())
}

pub fn all(conn: &Connection) -> AppResult<Vec<WeeklyGoal>> {
    let mut stmt = conn.prepare("SELECT category_id, target_minutes FROM weekly_goal")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?)))?;
    let mut out = Vec::new();
    for r in rows {
        let (id, m) = r?;
        if let Ok(category_id) = Uuid::parse_str(&id) {
            out.push(WeeklyGoal { category_id, target_minutes: m });
        }
    }
    Ok(out)
}
```
(The test needs `PartialEq` on `WeeklyGoal` — it's in the derive above.)

- [ ] **Step 2: Commands** in `commands/categories.rs` (match its import style):
```rust
#[tauri::command]
pub fn goals_list(db: tauri::State<'_, crate::db::Database>) -> crate::error::AppResult<Vec<crate::repo::goals::WeeklyGoal>> {
    let conn = db.conn.lock().unwrap();
    crate::repo::goals::all(&conn)
}

#[tauri::command]
pub fn goal_set(
    db: tauri::State<'_, crate::db::Database>,
    category_id: uuid::Uuid,
    target_minutes: Option<u32>,
) -> crate::error::AppResult<()> {
    let conn = db.conn.lock().unwrap();
    crate::repo::goals::set(&conn, category_id, target_minutes)
}
```
Register both in `commands/mod.rs`. TS side:
```ts
// types.ts
export interface WeeklyGoal { category_id: Id; target_minutes: number }
// api.ts
export const listGoals = () => invoke<WeeklyGoal[]>('goals_list');
export const setGoal = (categoryId: Id, targetMinutes: number | null) =>
  invoke<void>('goal_set', { categoryId, targetMinutes });
```

- [ ] **Step 3: All suites green.**
- [ ] **Step 4: Commit** — `git commit -m "feat(goals): weekly_goal repo + commands"`.

### Task 3.3: Settings editing + dashboard progress

**Files:**
- Modify: `src/windows/settings/panes.tsx` (`CategoriesPane` / `CatRow`)
- Modify: `src/windows/dashboard/views/TableView.tsx`

**Interfaces:**
- Consumes: `api.listGoals`, `api.setGoal` (Task 3.2); `matchPreset(p.range) === 'week'` from `../format`; `fmtDur` from `./types`.

- [ ] **Step 1: CatRow goal input.** `CategoriesPane` fetches goals: `const goals = useQuery({ queryKey: ['goals'], queryFn: api.listGoals });` and a mutation `const setGoalMut = useMutation({ mutationFn: ({ id, minutes }: { id: string; minutes: number | null }) => api.setGoal(id, minutes), onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }) });`. Pass `goalHours` (target_minutes/60 or '') and `onGoal` into each `CatRow`. In `CatRow`, before the delete button:

```tsx
<input
  aria-label={`Weekly goal for ${c.name} (hours)`}
  className="h-5 w-12 rounded-sm bg-transparent px-1 text-right text-[11px] tabular-nums text-label-2 outline-none focus:bg-fill-hover"
  placeholder="h/wk"
  defaultValue={goalHours}
  onBlur={(e) => {
    const h = parseFloat(e.target.value);
    onGoal(Number.isFinite(h) && h > 0 ? Math.round(h * 60) : null);
  }}
  onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
/>
```
`CatRow` prop additions: `goalHours: string; onGoal: (minutes: number | null) => void`. Add `key={c.id + goalHours}` on `CatRow` in the map so the uncontrolled input refreshes after a goal query refetch.

- [ ] **Step 2: TableView progress.** Inside `TableView`, fetch goals (`useQuery`, same key `['goals']` — import `useQuery` from `@tanstack/react-query` and `* as api` following the file's relative-path conventions: `../../../lib/api`... actual path from `views/` is `../../../lib/api` — verify against the file's existing imports of `../format`). In the stats strip, when `matchPreset(p.range) === 'week'`, render after each top category's duration:

```tsx
{goal && (
  <span className="flex items-center gap-1">
    <span className="text-[10px] text-label-2">/ {fmtDur(goal.target_minutes * 60)}</span>
    <span className="h-1 w-10 overflow-hidden rounded-full bg-fill">
      <span
        className="block h-full rounded-full bg-accent"
        style={{ width: `${Math.min(100, (t.s / (goal.target_minutes * 60)) * 100)}%` }}
      />
    </span>
  </span>
)}
```
where `const goal = goalsQuery.data?.find((g) => g.category_id === t.cat?.id);` and the whole block renders only when the week preset is active. Note the existing strip iterates `totals.top` with `t.s` in seconds.

- [ ] **Step 3: Verify** — `npx tsc -b`, `npm test`; manual: set a goal in Settings, check the This-week strip shows `spent / goal` + bar.
- [ ] **Step 4: Commit** — `git commit -m "feat(goals): edit weekly goals in Settings; progress in week stats strip"`.

---

# Part 4: Backup / Restore (small)

**Spec:** Settings → General gains "Back up now…" (native save dialog, writes a consistent snapshot via `VACUUM INTO`) and "Restore from backup…" (native open dialog + native confirm; validates the file, stages it next to the live DB, restarts the app; `Database::open` swaps the staged file in before opening). Restore is destructive and must confirm with kind: 'warning'.

### Task 4.1: staged-restore swap in `Database::open`

**Files:**
- Modify: `src-tauri/src/db/mod.rs`

**Interfaces:**
- Produces: on `Database::open(path)`, if `<path>.restore-pending` exists it is renamed over `path` before opening. Public helper `pub fn restore_pending_path(db_path: &Path) -> std::path::PathBuf` (appends `.restore-pending` to the file name).

- [ ] **Step 1: RED test** (in `db/mod.rs` tests; `tempfile` is already a dev-dependency):

```rust
#[test]
fn open_swaps_in_pending_restore_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("timetrak.sqlite");
    // Seed a live DB and add a marker row.
    {
        let db = Database::open(&path).unwrap();
        let conn = db.conn.lock().unwrap();
        conn.execute("INSERT INTO app_meta (key, value) VALUES ('marker', 'live')", []).unwrap();
    }
    // Stage a different DB as pending restore.
    let pending = restore_pending_path(&path);
    {
        let db2 = Database::open(&dir.path().join("staged.sqlite")).unwrap();
        let conn = db2.conn.lock().unwrap();
        conn.execute("INSERT INTO app_meta (key, value) VALUES ('marker', 'restored')", []).unwrap();
        conn.execute("VACUUM INTO ?1", [pending.to_str().unwrap()]).unwrap();
    }
    // Re-open the live path: pending must win.
    let db = Database::open(&path).unwrap();
    let conn = db.conn.lock().unwrap();
    let marker: String = conn
        .query_row("SELECT value FROM app_meta WHERE key = 'marker'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(marker, "restored");
    assert!(!pending.exists());
}
```
Run → compile failure (`restore_pending_path` missing).

- [ ] **Step 2: Implement** in `db/mod.rs`:

```rust
/// Path of the staged restore file for a given live DB path.
pub fn restore_pending_path(db_path: &Path) -> std::path::PathBuf {
    let mut name = db_path.file_name().unwrap_or_default().to_os_string();
    name.push(".restore-pending");
    db_path.with_file_name(name)
}
```
and at the top of `Database::open`, after `create_dir_all`:
```rust
// A staged restore (Settings → Restore from backup) wins over the live file.
let pending = restore_pending_path(path);
if pending.exists() {
    std::fs::rename(&pending, path)?;
}
```

- [ ] **Step 3: GREEN**, full suite passes.
- [ ] **Step 4: Commit** — `git commit -m "feat(backup): Database::open swaps in staged restore file"`.

### Task 4.2: backup/restore commands

**Files:**
- Create: `src-tauri/src/commands/backup.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add module + register), `src/lib/api.ts`

**Interfaces:**
- Consumes: `db::restore_pending_path` (Task 4.1).
- Produces: commands `backup_db(dest: String)` (VACUUM INTO dest; deletes an existing dest first) and `restore_db(src: String)` (validates via read-only open + `PRAGMA integrity_check` + `schema_version` present, copies to the pending path, then `app.restart()` — never returns on success); TS `api.backupDb(dest)`, `api.restoreDb(src)`.

- [ ] **Step 1: RED test** for backup + validation (in `commands/backup.rs`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn backup_writes_openable_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("backup.sqlite");
        let db = fresh_db();
        {
            let conn = db.conn.lock().unwrap();
            backup_inner(&conn, dest.to_str().unwrap()).unwrap();
        }
        let out = rusqlite::Connection::open(&dest).unwrap();
        let cats: i64 = out.query_row("SELECT COUNT(*) FROM category", [], |r| r.get(0)).unwrap();
        assert_eq!(cats, 4);
    }

    #[test]
    fn validate_rejects_non_timetrak_files() {
        let dir = tempfile::tempdir().unwrap();
        let junk = dir.path().join("junk.sqlite");
        std::fs::write(&junk, b"not a database").unwrap();
        assert!(validate_backup(junk.to_str().unwrap()).is_err());
    }
}
```
Run → compile failure. Implement:

```rust
//! Backup ("VACUUM INTO" snapshot) and staged restore commands.

use rusqlite::Connection;
use tauri::{AppHandle, Manager, State};

use crate::db::{restore_pending_path, Database};
use crate::error::{AppError, AppResult};

pub fn backup_inner(conn: &Connection, dest: &str) -> AppResult<()> {
    if std::path::Path::new(dest).exists() {
        std::fs::remove_file(dest)?;
    }
    conn.execute("VACUUM INTO ?1", [dest])?;
    Ok(())
}

/// A restorable file is a SQLite DB that passes integrity_check and carries
/// our schema_version marker.
pub fn validate_backup(src: &str) -> AppResult<()> {
    let conn = Connection::open_with_flags(
        src,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| AppError::Invalid(format!("not a SQLite database: {e}")))?;
    let ok: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| AppError::Invalid(format!("integrity check failed: {e}")))?;
    if ok != "ok" {
        return Err(AppError::Invalid("backup file failed integrity check".into()));
    }
    conn.query_row("SELECT value FROM app_meta WHERE key = 'schema_version'", [], |r| {
        r.get::<_, String>(0)
    })
    .map_err(|_| AppError::Invalid("not a TimeTrak backup (no schema_version)".into()))?;
    Ok(())
}

#[tauri::command]
pub fn backup_db(db: State<'_, Database>, dest: String) -> AppResult<()> {
    let conn = db.conn.lock().unwrap();
    backup_inner(&conn, &dest)
}

#[tauri::command]
pub fn restore_db(app: AppHandle, src: String) -> AppResult<()> {
    validate_backup(&src)?;
    let live = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(e.to_string()))?
        .join("timetrak.sqlite");
    std::fs::copy(&src, restore_pending_path(&live))?;
    app.restart(); // never returns
}
```
(`app.restart()` returns `!`; no `Ok(())` needed after it. If the compiler demands a return, end the function with `app.restart()` as the final expression.) Register module + both commands. TS:
```ts
export const backupDb = (dest: string) => invoke<void>('backup_db', { dest });
export const restoreDb = (src: string) => invoke<void>('restore_db', { src });
```

- [ ] **Step 2: GREEN**, suite passes warning-free.
- [ ] **Step 3: Commit** — `git commit -m "feat(backup): backup_db / restore_db commands with validation"`.

### Task 4.3: Settings UI

**Files:**
- Modify: `src/windows/settings/panes.tsx` (`PreferencesPane`)

**Interfaces:**
- Consumes: `api.backupDb`, `api.restoreDb`; `save`, `open`, `ask`, `message` from `@tauri-apps/plugin-dialog` (`ask`/`message` already imported in this file; add `save`, `open`).

- [ ] **Step 1: Implement** two rows at the bottom of `PreferencesPane`:

```tsx
<Row label="Back up" hint="Save a snapshot of all tracked data.">
  <button
    className="h-6 rounded-md border border-separator bg-raised px-2.5 text-[11px] font-medium text-label hover:bg-fill-hover"
    onClick={async () => {
      const dest = await save({
        defaultPath: `TimeTrak-backup-${new Date().toISOString().slice(0, 10)}.sqlite`,
        filters: [{ name: 'SQLite', extensions: ['sqlite'] }],
      });
      if (!dest) return;
      try {
        await api.backupDb(dest);
        await message('Backup saved.', { title: 'TimeTrak' });
      } catch (e) {
        await message(String(e), { kind: 'error' });
      }
    }}
  >
    Back up now…
  </button>
</Row>
<Row label="Restore" hint="Replaces all current data and restarts the app.">
  <button
    className="h-6 rounded-md border border-separator bg-raised px-2.5 text-[11px] font-medium text-destructive hover:bg-fill-hover"
    onClick={async () => {
      const src = await open({ filters: [{ name: 'SQLite', extensions: ['sqlite'] }], multiple: false });
      if (typeof src !== 'string') return;
      const sure = await ask('Replace ALL current data with this backup? TimeTrak will restart.', {
        title: 'Restore Backup', kind: 'warning', okLabel: 'Restore',
      });
      if (!sure) return;
      try {
        await api.restoreDb(src);
      } catch (e) {
        await message(String(e), { kind: 'error' });
      }
    }}
  >
    Restore from backup…
  </button>
</Row>
```

- [ ] **Step 2: Verify** `npx tsc -b`, `npm test`; manual: back up, restore the backup, app restarts with data intact.
- [ ] **Step 3: Commit** — `git commit -m "feat(settings): backup and restore rows"`.

---

# Part 5: Idle Detection (medium)

**Spec:** While a timer runs, poll system idle time (macOS `CGEventSourceSecondsSinceLastEventType`). If the user is idle ≥ threshold (app_meta `idle_threshold_minutes`, default 10, 0 = off — key already allowlisted in Part 2) and then returns, emit `idle-detected { entry_id, idle_started_at }` + a notification. The tray popover shows a toast with three actions: **Keep** (do nothing), **Stop at HH:MM** (truncate the entry to when idleness began), **Resume** (truncate, then start a fresh timer with the same category/project/note). Depends on Part 2's prefs commands for the Settings row.

### Task 5.1: pure `IdleWatcher`

**Files:**
- Create: `src-tauri/src/idle.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod idle;`)

**Interfaces:**
- Produces:
```rust
pub enum IdleAction { None, Prompt { idle_started_at: chrono::DateTime<chrono::Utc> } }
pub struct IdleWatcher { /* private */ }
impl IdleWatcher {
    pub fn new() -> Self;
    /// Feed one sample. threshold_secs <= 0 disables.
    pub fn observe(&mut self, now: DateTime<Utc>, idle_secs: f64, threshold_secs: f64, timer_running: bool) -> IdleAction;
}
```

- [ ] **Step 1: RED tests** (in `idle.rs`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};

    fn at(min: i64) -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 24, 12, 0, 0).unwrap() + chrono::Duration::minutes(min)
    }

    #[test]
    fn prompts_once_when_user_returns_after_threshold() {
        let mut w = IdleWatcher::new();
        assert!(matches!(w.observe(at(0), 0.0, 600.0, true), IdleAction::None));
        assert!(matches!(w.observe(at(11), 660.0, 600.0, true), IdleAction::None)); // still away
        match w.observe(at(12), 2.0, 600.0, true) {
            // Anchored by the last away sample: at(11) minus 660s idle = at(0).
            IdleAction::Prompt { idle_started_at } => assert_eq!(idle_started_at, at(0)),
            IdleAction::None => panic!("expected prompt"),
        }
        // No duplicate prompt for the same period.
        assert!(matches!(w.observe(at(13), 5.0, 600.0, true), IdleAction::None));
    }

    #[test]
    fn no_prompt_below_threshold_or_without_timer_or_disabled() {
        let mut w = IdleWatcher::new();
        w.observe(at(0), 300.0, 600.0, true); // below threshold
        assert!(matches!(w.observe(at(1), 2.0, 600.0, true), IdleAction::None));
        let mut w2 = IdleWatcher::new();
        w2.observe(at(0), 900.0, 600.0, false); // no timer
        assert!(matches!(w2.observe(at(1), 2.0, 600.0, false), IdleAction::None));
        let mut w3 = IdleWatcher::new();
        w3.observe(at(0), 900.0, 0.0, true); // disabled
        assert!(matches!(w3.observe(at(1), 2.0, 0.0, true), IdleAction::None));
    }
}
```

- [ ] **Step 2: Run, verify compile failure, then implement:**

```rust
//! Idle-return detection. Pure state machine — the OS poll loop lives in main.rs.

use chrono::{DateTime, Duration, Utc};

pub enum IdleAction {
    None,
    Prompt { idle_started_at: DateTime<Utc> },
}

#[derive(Default)]
pub struct IdleWatcher {
    idle_since: Option<DateTime<Utc>>,
}

impl IdleWatcher {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn observe(
        &mut self,
        now: DateTime<Utc>,
        idle_secs: f64,
        threshold_secs: f64,
        timer_running: bool,
    ) -> IdleAction {
        if threshold_secs <= 0.0 || !timer_running {
            self.idle_since = None;
            return IdleAction::None;
        }
        if idle_secs >= threshold_secs {
            // Anchor the idle start from the OS counter, not our poll time.
            self.idle_since = Some(now - Duration::milliseconds((idle_secs * 1000.0) as i64));
            return IdleAction::None;
        }
        // User is active again — prompt if we saw a full idle period.
        match self.idle_since.take() {
            Some(started) => IdleAction::Prompt { idle_started_at: started },
            None => IdleAction::None,
        }
    }
}
```
Note the second observe call in the first test recomputes `idle_since` from the newest sample — that is intended (the OS counter is authoritative).

- [ ] **Step 3: GREEN** — tests pass (the `idle_started_at` assertion works because 12min − 660s = 1min).
- [ ] **Step 4: Commit** — `git commit -m "feat(idle): IdleWatcher state machine"`.

### Task 5.2: OS poll loop + event

**Files:**
- Modify: `src-tauri/src/main.rs` (idle poll thread in setup), `src-tauri/src/events.rs`, `src/lib/event-names.ts`, `src/lib/events.ts`

**Interfaces:**
- Consumes: `timetrak_lib::idle::{IdleWatcher, IdleAction}`; `timetrak_lib::timer::state`; prefs key `idle_threshold_minutes`.
- Produces: Rust const `events::IDLE_DETECTED = "idle-detected"`; event payload `{ entry_id: String, idle_started_at: String /* RFC3339 */ }`; TS `EVENT_IDLE_DETECTED` and `onIdleDetected(cb: (e: { entry_id: string; idle_started_at: string }) => void)`.

- [ ] **Step 1: Implement** (no unit test — FFI + thread glue over the tested watcher; note that in the plan's commit). In `events.rs`: `pub const IDLE_DETECTED: &str = "idle-detected";`. In `main.rs` add near `update_tray_title`:

```rust
#[cfg(target_os = "macos")]
fn system_idle_seconds() -> f64 {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state_id: i32, event_type: u32) -> f64;
    }
    // 1 = kCGEventSourceStateCombinedSessionState, u32::MAX = kCGAnyInputEventType
    unsafe { CGEventSourceSecondsSinceLastEventType(1, u32::MAX) }
}
```
and in `setup`, after the tray-title block:

```rust
// Idle detection: poll while a timer runs; prompt when the user returns.
#[cfg(target_os = "macos")]
{
    use tauri::Emitter;
    let handle = app.handle().clone();
    std::thread::spawn(move || {
        let mut watcher = timetrak_lib::idle::IdleWatcher::new();
        loop {
            std::thread::sleep(std::time::Duration::from_secs(15));
            let (running, threshold_secs) = {
                let db = handle.state::<Database>();
                let conn = db.conn.lock().unwrap();
                let running = timetrak_lib::timer::state(&conn).ok().and_then(|s| s.running);
                let mins: f64 = conn
                    .query_row(
                        "SELECT value FROM app_meta WHERE key = 'idle_threshold_minutes'",
                        [],
                        |r| r.get::<_, String>(0),
                    )
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(10.0);
                (running, mins * 60.0)
            };
            let action = watcher.observe(
                chrono::Utc::now(),
                system_idle_seconds(),
                threshold_secs,
                running.is_some(),
            );
            if let timetrak_lib::idle::IdleAction::Prompt { idle_started_at } = action {
                if let Some(entry) = running {
                    let _ = handle.emit(
                        timetrak_lib::events::IDLE_DETECTED,
                        serde_json::json!({
                            "entry_id": entry.id.to_string(),
                            "idle_started_at": idle_started_at.to_rfc3339(),
                        }),
                    );
                    use tauri_plugin_notification::NotificationExt;
                    let _ = handle
                        .notification()
                        .builder()
                        .title("Were you away?")
                        .body("A timer kept running while you were idle.")
                        .show();
                }
            }
        }
    });
}
```
(`serde_json` is already a dependency; `main.rs` needs `use timetrak_lib` paths only — no new imports at top level beyond what the compiler asks for.) TS mirror in `event-names.ts`:
```ts
export const EVENT_IDLE_DETECTED = 'idle-detected' as const;
```
and in `events.ts`:
```ts
export interface IdleDetected { entry_id: string; idle_started_at: string }
export const onIdleDetected = (cb: (e: IdleDetected) => void): Promise<UnlistenFn> =>
  listen<IdleDetected>(EVENT_IDLE_DETECTED, (evt) => cb(evt.payload));
```
(add `EVENT_IDLE_DETECTED` to the import list in `events.ts`).

- [ ] **Step 2: Verify** — `cargo build` (links CoreGraphics), full suites green.
- [ ] **Step 3: Commit** — `git commit -m "feat(idle): macOS idle poll loop + idle-detected event (loop untested glue over tested watcher)"`.

### Task 5.3: resolution command

**Files:**
- Modify: `src-tauri/src/commands/timer.rs`, `src-tauri/src/commands/mod.rs`, `src/lib/api.ts`

**Interfaces:**
- Consumes: `repo::entries::{find, update, running}`, `crate::timer::start`, `crate::domain::EntryEdit`.
- Produces: command `idle_resolve(entry_id: Uuid, action: String /* "keep" | "stop_at_idle" | "resume" */, idle_started_at: chrono::DateTime<chrono::Utc>)`; TS `api.idleResolve(entryId, action, idleStartedAt)`.

- [ ] **Step 1: RED test** (in `commands/timer.rs` tests or a new mod there):

```rust
#[cfg(test)]
mod idle_resolve_tests {
    use super::*;
    use crate::test_support::*;

    #[test]
    fn stop_at_idle_truncates_running_entry() {
        let db = fresh_db();
        let mut conn = db.conn.lock().unwrap();
        let e = crate::timer::start(&mut conn, coding(), None, Some("deep work".into())).unwrap();
        let idle_start = e.started_at + chrono::Duration::minutes(5);
        idle_resolve_inner(&mut conn, e.id, "stop_at_idle", idle_start).unwrap();
        let stored = crate::repo::entries::find(&conn, e.id).unwrap();
        assert_eq!(stored.ended_at, Some(idle_start));
        assert!(crate::repo::entries::running(&conn).unwrap().is_none());
    }

    #[test]
    fn resume_truncates_and_starts_same_combo() {
        let db = fresh_db();
        let mut conn = db.conn.lock().unwrap();
        let e = crate::timer::start(&mut conn, coding(), None, Some("deep work".into())).unwrap();
        let idle_start = e.started_at + chrono::Duration::minutes(5);
        idle_resolve_inner(&mut conn, e.id, "resume", idle_start).unwrap();
        let running = crate::repo::entries::running(&conn).unwrap().expect("new timer");
        assert_ne!(running.id, e.id);
        assert_eq!(running.category_id, coding());
        assert_eq!(running.note.as_deref(), Some("deep work"));
    }
}
```

- [ ] **Step 2: Verify compile failure, then implement** in `commands/timer.rs`:

```rust
pub fn idle_resolve_inner(
    conn: &mut rusqlite::Connection,
    entry_id: uuid::Uuid,
    action: &str,
    idle_started_at: chrono::DateTime<chrono::Utc>,
) -> crate::error::AppResult<()> {
    if action == "keep" {
        return Ok(());
    }
    let entry = crate::repo::entries::find(conn, entry_id)?;
    if entry.ended_at.is_some() {
        return Ok(()); // already stopped elsewhere; nothing to truncate
    }
    let edit = crate::domain::EntryEdit {
        category_id: entry.category_id,
        project_id: entry.project_id,
        started_at: entry.started_at,
        ended_at: Some(idle_started_at),
        note: entry.note.clone(),
    };
    crate::repo::entries::update(conn, entry_id, &edit)?;
    if action == "resume" {
        crate::timer::start(conn, entry.category_id, entry.project_id, entry.note)?;
    }
    Ok(())
}

#[tauri::command]
pub fn idle_resolve(
    app: tauri::AppHandle,
    db: tauri::State<'_, crate::db::Database>,
    entry_id: uuid::Uuid,
    action: String,
    idle_started_at: chrono::DateTime<chrono::Utc>,
) -> crate::error::AppResult<()> {
    {
        let mut conn = db.conn.lock().unwrap();
        idle_resolve_inner(&mut conn, entry_id, &action, idle_started_at)?;
    }
    use tauri::Emitter;
    let _ = app.emit(crate::events::TIMER_CHANGED, ());
    let _ = app.emit(crate::events::ENTRIES_CHANGED, ());
    Ok(())
}
```
Match the surrounding file's actual import style (it may already `use` these paths unqualified — follow it). Register the command. TS:
```ts
export const idleResolve = (entryId: Id, action: 'keep' | 'stop_at_idle' | 'resume', idleStartedAt: string) =>
  invoke<void>('idle_resolve', { entryId, action, idleStartedAt });
```

- [ ] **Step 3: GREEN**, full suite.
- [ ] **Step 4: Commit** — `git commit -m "feat(idle): idle_resolve command (keep / stop-at-idle / resume)"`.

### Task 5.4: tray toast + settings row

**Files:**
- Create: `src/windows/tray/IdleToast.tsx`
- Modify: `src/windows/tray/TrayPopover.tsx` (render `<IdleToast />` directly under `<CalendarToasts />`)
- Modify: `src/windows/settings/panes.tsx` (threshold row)

**Interfaces:**
- Consumes: `onIdleDetected` (Task 5.2), `api.idleResolve` (Task 5.3), `api.getPref`/`api.setPref` (Part 2).

- [ ] **Step 1: Implement `IdleToast.tsx`** (mirrors `CalendarToasts` structure):

```tsx
import { useEffect, useState } from 'react';
import { onIdleDetected } from '../../lib/events';
import * as api from '../../lib/api';

interface Pending { entryId: string; idleStartedAt: string }

export function IdleToast() {
  const [pending, setPending] = useState<Pending | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onIdleDetected((e) => setPending({ entryId: e.entry_id, idleStartedAt: e.idle_started_at }))
      .then((u) => { unlisten = u; });
    return () => unlisten?.();
  }, []);

  if (!pending) return null;
  const since = new Date(pending.idleStartedAt);
  const hhmm = `${String(since.getHours()).padStart(2, '0')}:${String(since.getMinutes()).padStart(2, '0')}`;
  const resolve = (action: 'keep' | 'stop_at_idle' | 'resume') => {
    void api.idleResolve(pending.entryId, action, pending.idleStartedAt).finally(() => setPending(null));
  };

  return (
    <div className="rounded-md bg-warning/10 px-2 py-1.5 text-[11px]">
      <div className="text-label">Away since {hhmm} — timer kept running.</div>
      <div className="mt-1 flex gap-1.5">
        <button className="h-6 flex-1 rounded-md border border-separator text-[11px] hover:bg-fill-hover" onClick={() => resolve('keep')}>Keep</button>
        <button className="h-6 flex-1 rounded-md border border-separator text-[11px] hover:bg-fill-hover" onClick={() => resolve('stop_at_idle')}>Stop at {hhmm}</button>
        <button className="h-6 flex-1 rounded-md bg-accent text-[11px] font-medium text-white hover:bg-accent-hover" onClick={() => resolve('resume')}>Resume</button>
      </div>
    </div>
  );
}
```
In `TrayPopover.tsx` render it inside the same padded wrapper as `<CalendarToasts />`. In `PreferencesPane`, add a Row "Idle detection" with a numeric minutes input (same input styling as the nudge times, `w-14`), reading/writing pref `idle_threshold_minutes` on blur; hint: "Ask what to do after this many idle minutes. 0 disables."

- [ ] **Step 2: Verify** `npx tsc -b`, `npm test`; manual: set threshold to 1 minute, start a timer, idle >1 min, wiggle mouse → toast + notification appear; each button behaves per spec.
- [ ] **Step 3: Commit** — `git commit -m "feat(idle): tray idle toast + threshold setting"`.

---

# Part 6: Editable Timeline (medium–large)

**Spec:** In the dashboard Timeline view: (a) dragging on empty canvas creates an entry — on release the existing EntryEditorSheet opens pre-filled with the dragged range (snapped to 5 minutes); (b) dragging a block's top/bottom 6px edge resizes it; dragging its body moves it within the day (duration preserved, snapped to 5 minutes) — on release the entry is saved via `updateEntry`; an Overlap rejection shows an error banner and the block reverts. All time math is pure and unit-tested.

### Task 6.1: pure time math

**Files:**
- Create: `src/windows/dashboard/views/timeline-math.ts`
- Create: `src/windows/dashboard/views/timeline-math.test.ts`

**Interfaces:**
- Produces:
```ts
export const SNAP_MIN = 5;
export function yToMinutes(y: number, hourHeight: number): number; // 0..1440, snapped
export function minutesToDate(dayKey: string, minutes: number): Date; // dayKey = Date.toDateString() key
export function moveRange(startMin: number, endMin: number, deltaMin: number): [number, number]; // clamped to day, duration preserved
```

- [ ] **Step 1: RED tests** (`timeline-math.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { yToMinutes, minutesToDate, moveRange, SNAP_MIN } from './timeline-math';

describe('timeline math', () => {
  it('converts y to snapped minutes', () => {
    expect(yToMinutes(0, 48)).toBe(0);
    expect(yToMinutes(48, 48)).toBe(60);
    expect(yToMinutes(50, 48)).toBe(65);      // 62.5 → snap 65
    expect(yToMinutes(-10, 48)).toBe(0);      // clamp low
    expect(yToMinutes(48 * 25, 48)).toBe(1440); // clamp high
    expect(SNAP_MIN).toBe(5);
  });

  it('builds a local Date on the given day', () => {
    const d = minutesToDate(new Date(2026, 7, 24).toDateString(), 9 * 60 + 30);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(24);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(30);
  });

  it('moves a range preserving duration and clamping to the day', () => {
    expect(moveRange(60, 120, 30)).toEqual([90, 150]);
    expect(moveRange(60, 120, -90)).toEqual([0, 60]);       // clamp at 0
    expect(moveRange(1380, 1440, 60)).toEqual([1380, 1440]); // clamp at end
  });
});
```

- [ ] **Step 2: `npm test` → fails (module missing). Implement:**

```ts
export const SNAP_MIN = 5;

export function yToMinutes(y: number, hourHeight: number): number {
  const raw = (y / hourHeight) * 60;
  const snapped = Math.round(raw / SNAP_MIN) * SNAP_MIN;
  return Math.max(0, Math.min(24 * 60, snapped));
}

export function minutesToDate(dayKey: string, minutes: number): Date {
  const d = new Date(dayKey); // toDateString() output parses to local midnight
  d.setHours(0, minutes, 0, 0);
  return d;
}

export function moveRange(startMin: number, endMin: number, deltaMin: number): [number, number] {
  const dur = endMin - startMin;
  let s = startMin + deltaMin;
  s = Math.max(0, Math.min(24 * 60 - dur, s));
  return [s, s + dur];
}
```

- [ ] **Step 3: GREEN.**
- [ ] **Step 4: Commit** — `git commit -m "feat(timeline): pure drag/snap time math"`.

### Task 6.2: drag-to-create

**Files:**
- Modify: `src/windows/dashboard/views/types.ts` (add to `DashViewProps`: `onCreateRange: (start: Date, end: Date) => void;`)
- Modify: `src/windows/dashboard/Dashboard.tsx` (implement `onCreateRange`; extend the create-sheet state)
- Modify: `src/windows/dashboard/EntryEditorSheet.tsx` (create mode accepts an initial range)
- Modify: `src/windows/dashboard/views/TimelineView.tsx` (pointer handlers + ghost block)

**Interfaces:**
- Consumes: Task 6.1 helpers.
- Produces: `EntryEditorSheet` `Mode` becomes `{ kind: 'edit'; entry: TimeEntry } | { kind: 'create'; initialStart?: Date; initialEnd?: Date }`; `Dashboard` state `creating: { initialStart?: Date; initialEnd?: Date } | null` replaces the boolean (all existing `setCreating(true)` call sites become `setCreating({})`, `creating &&` stays truthy-compatible).

- [ ] **Step 1: EntryEditorSheet.** In `computeDefaults`, when `mode.kind === 'create'` and `mode.initialStart`/`initialEnd` are present, use them instead of the hour-ago/now defaults:

```ts
const start = mode.initialStart ?? hourAgo;
const end = mode.initialEnd ?? now;
const s = splitLocal(start);
const e = splitLocal(end);
```
(keep the `lastCategoryId` logic unchanged).

- [ ] **Step 2: Dashboard.** `const [creating, setCreating] = useState<{ initialStart?: Date; initialEnd?: Date } | null>(null);`; the header button and the pending-new-entry effect call `setCreating({})`; render `{creating && <EntryEditorSheet mode={{ kind: 'create', ...creating }} ... onClose={() => setCreating(null)} ...}`; add to the shared `props`: `onCreateRange: (start, end) => setCreating({ initialStart: start, initialEnd: end })`.

- [ ] **Step 3: TimelineView canvas drag.** Local state `const [draft, setDraft] = useState<{ startMin: number; endMin: number } | null>(null);`. On the absolutely-positioned day container (`<div className="relative" style={{ height: 24 * HOUR_H }}>`) add:

```tsx
onPointerDown={(e) => {
  if (e.target !== e.currentTarget || !selected) return; // blocks handle their own drags
  const rect = e.currentTarget.getBoundingClientRect();
  const m = yToMinutes(e.clientY - rect.top, HOUR_H);
  setDraft({ startMin: m, endMin: m });
  e.currentTarget.setPointerCapture(e.pointerId);
}}
onPointerMove={(e) => {
  if (!draft) return;
  const rect = e.currentTarget.getBoundingClientRect();
  setDraft({ ...draft, endMin: yToMinutes(e.clientY - rect.top, HOUR_H) });
}}
onPointerUp={() => {
  if (!draft || !selected) return;
  const [a, b] = [Math.min(draft.startMin, draft.endMin), Math.max(draft.startMin, draft.endMin)];
  setDraft(null);
  if (b - a >= SNAP_MIN) p.onCreateRange(minutesToDate(selected, a), minutesToDate(selected, b));
}}
```
Ghost block while dragging (render inside the container):
```tsx
{draft && (
  <div
    className="pointer-events-none absolute right-3 rounded-[5px] bg-accent/15 ring-1 ring-inset ring-accent/40"
    style={{
      left: GUTTER + 8,
      top: (Math.min(draft.startMin, draft.endMin) / 60) * HOUR_H,
      height: (Math.abs(draft.endMin - draft.startMin) / 60) * HOUR_H,
    }}
  />
)}
```
Imports: `import { minutesToDate, yToMinutes, SNAP_MIN } from './timeline-math';`.

- [ ] **Step 4: Verify** — `npx tsc -b`, `npm test`; manual: drag on empty canvas → sheet opens with the dragged times; plain click still does nothing; "New entry" button still works.
- [ ] **Step 5: Commit** — `git commit -m "feat(timeline): drag empty canvas to create an entry"`.

### Task 6.3: move & resize existing blocks

**Files:**
- Modify: `src/windows/dashboard/views/TimelineView.tsx`

**Interfaces:**
- Consumes: `moveRange`, `yToMinutes`, `minutesToDate` (Task 6.1); `api.updateEntry(id, EntryEdit)` — payload `{ category_id, project_id, started_at, ended_at, note }` all present (copy unchanged fields from the entry).

- [ ] **Step 1: Implement.** Add imports `import { useQueryClient } from '@tanstack/react-query';` and `import * as api from '../../../lib/api';` (path per this file's existing convention — `../../../lib/api`). Component state:

```tsx
const qc = useQueryClient();
const [editDrag, setEditDrag] = useState<{
  entry: TimeEntry; kind: 'move' | 'resize-start' | 'resize-end';
  origStartMin: number; origEndMin: number; grabMin: number;
  startMin: number; endMin: number;
} | null>(null);
const [dragError, setDragError] = useState<string | null>(null);
```
On each entry block `<button>` add (only for entries with `ended_at`; skip a still-running block):

```tsx
onPointerDown={(e) => {
  if (!e.currentTarget.parentElement) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const zone = e.clientY - rect.top < 6 ? 'resize-start'
    : rect.bottom - e.clientY < 6 ? 'resize-end' : 'move';
  const container = e.currentTarget.parentElement.getBoundingClientRect();
  const grabMin = yToMinutes(e.clientY - container.top, HOUR_H);
  const s = new Date(entry.started_at); const en = new Date(entry.ended_at!);
  const startMin = s.getHours() * 60 + s.getMinutes();
  const endMin = en.getHours() * 60 + en.getMinutes();
  setEditDrag({ entry, kind: zone, origStartMin: startMin, origEndMin: endMin, grabMin, startMin, endMin });
  e.currentTarget.setPointerCapture(e.pointerId);
  e.stopPropagation();
}}
```
(rename the map variable from `e` to `entry` in this block's scope to avoid shadowing the event — adjust the existing map accordingly). Pointer move/up handlers on the same block element:

```tsx
onPointerMove={(ev) => {
  if (!editDrag) return;
  const container = ev.currentTarget.parentElement!.getBoundingClientRect();
  const cur = yToMinutes(ev.clientY - container.top, HOUR_H);
  const delta = cur - editDrag.grabMin;
  if (editDrag.kind === 'move') {
    const [s2, e2] = moveRange(editDrag.origStartMin, editDrag.origEndMin, delta);
    setEditDrag({ ...editDrag, startMin: s2, endMin: e2 });
  } else if (editDrag.kind === 'resize-start') {
    setEditDrag({ ...editDrag, startMin: Math.min(editDrag.origStartMin + delta, editDrag.origEndMin - SNAP_MIN) });
  } else {
    setEditDrag({ ...editDrag, endMin: Math.max(editDrag.origEndMin + delta, editDrag.origStartMin + SNAP_MIN) });
  }
}}
onPointerUp={() => {
  if (!editDrag || !selected) return;
  const d = editDrag;
  setEditDrag(null);
  if (d.startMin === d.origStartMin && d.endMin === d.origEndMin) return; // click → onEdit fires normally
  api.updateEntry(d.entry.id, {
    category_id: d.entry.category_id,
    project_id: d.entry.project_id,
    started_at: minutesToDate(selected, d.startMin).toISOString(),
    ended_at: minutesToDate(selected, d.endMin).toISOString(),
    note: d.entry.note,
  }).then(() => qc.invalidateQueries({ queryKey: ['entries'] }))
    .catch((err) => setDragError(String(err)));
}}
```
While `editDrag` is active for a block, render THAT block using `editDrag.startMin/endMin` for `top`/`height` (override the computed values when `editDrag?.entry.id === entry.id`) and suppress the `onClick` edit when a drag actually moved (`d.startMin !== d.origStartMin || d.endMin !== d.origEndMin` — track via a `movedRef` set in onPointerUp and checked/cleared in onClick). Add `cursor-ns-resize` styling via inline `style.cursor` when hovering the 6px zones is NOT required — acceptable to keep the default cursor (macOS Calendar shows none until drag). Error banner at the top of the day pane:
```tsx
{dragError && (
  <div className="absolute inset-x-2 top-1 z-20 rounded-md bg-destructive/10 px-2 py-1 text-[11px] text-destructive"
       onClick={() => setDragError(null)}>
    {dragError}
  </div>
)}
```

- [ ] **Step 2: Verify** — `npx tsc -b`, `npm test` green; manual checklist: move a block (snaps, saves, survives reload); resize both edges (min 5 minutes); overlapping another entry shows the error banner and the block reverts (query invalidation restores server state); plain click still opens the editor; drag-to-create from Task 6.2 still works.
- [ ] **Step 3: Commit** — `git commit -m "feat(timeline): drag to move and resize entries"`.

---

## Execution Order & Independence

Parts 1, 3, 4, 6 are fully independent. Part 2 must precede Part 5 (prefs commands + allowlist). Within a part, tasks are sequential. Each part leaves the app shippable.

## Verification After Each Part

```
cargo test --manifest-path src-tauri/Cargo.toml   # must be green AND warning-free
npm test
npx tsc -b
npm run tauri dev                                  # manual spot-check of the part's UI
```
