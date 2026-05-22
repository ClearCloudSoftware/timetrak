# TimeTrak — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Tauri 2 + React app skeleton, SQLite schema and migrations, shared Rust/TS types, and the module layout that all follow-up plans target.

**Architecture:** A Tauri 2 desktop app with a Rust core (`src-tauri/`) and a React + TypeScript UI (`src/`). The Rust core owns persistence and OS integration; the UI calls it through Tauri commands. This plan creates the empty modules and the schema only — repository methods, timer logic, and UI windows are implemented in follow-up plans.

**Tech Stack:** Tauri 2, Rust (stable), `rusqlite` (bundled), `serde`, `uuid`, `chrono`, `thiserror`, React 18, TypeScript, Vite, Tailwind CSS, `@tanstack/react-query`, Vitest.

**This plan is the parallelism gate.** All follow-up plans assume the file layout, types, command module map, and DB schema defined here exist exactly as specified.

---

## File Structure (created by this plan)

```
timetrak/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
├── index.html
├── README.md
├── .gitignore
├── src/                              # React UI
│   ├── main.tsx                      # entry; mounts <App />
│   ├── App.tsx                       # window router (tray | dashboard | settings)
│   ├── index.css                     # tailwind
│   ├── lib/
│   │   ├── api.ts                    # typed invoke() wrappers (stubs only here)
│   │   ├── events.ts                 # typed listen() wrappers
│   │   └── query.ts                  # React Query client
│   └── types.ts                      # TS mirror of Rust domain types
└── src-tauri/                        # Rust core
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── icons/                        # placeholder icons (commit empty placeholders)
    └── src/
        ├── main.rs                   # tauri::Builder, manages state, registers commands
        ├── lib.rs                    # `pub mod` declarations
        ├── error.rs                  # AppError + Result alias
        ├── domain.rs                 # Category, Project, TimeEntry, NewEntry types
        ├── db/
        │   ├── mod.rs                # Database struct + open() + migrate()
        │   └── schema.sql            # full v1 schema
        ├── repo/
        │   ├── mod.rs                # pub mod categories; pub mod projects; pub mod entries;
        │   ├── categories.rs         # empty trait-less module (follow-up plan fills it)
        │   ├── projects.rs           # empty
        │   └── entries.rs            # empty
        ├── timer.rs                  # empty (follow-up plan)
        ├── reporting.rs              # empty (follow-up plan)
        ├── csv_export.rs             # empty (follow-up plan)
        ├── notifications.rs          # empty (follow-up plan)
        └── commands/
            ├── mod.rs                # registers all command modules
            ├── categories.rs         # empty
            ├── projects.rs           # empty
            ├── entries.rs            # empty
            ├── timer.rs              # empty
            └── export.rs             # empty
```

**Module ownership for follow-up plans:** each follow-up plan owns one or more leaf files and adds a single line to `commands/mod.rs` and `lib.rs` to wire its commands in.

---

## Task 1: Initialize git repo and Node project

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: Verify we are in the project root**

Run: `pwd`
Expected: `/Users/alex/projects/personal/timetrak`

- [ ] **Step 2: Initialize git if not already**

Run: `git status || git init`
Expected: either status output, or `Initialized empty Git repository`

- [ ] **Step 3: Create `.gitignore`**

```gitignore
# Node
node_modules/
dist/
.vite/

# Rust
src-tauri/target/
src-tauri/Cargo.lock.bak

# OS
.DS_Store
Thumbs.db

# Editor
.idea/
.vscode/*
!.vscode/extensions.json

# Local
*.log
*.sqlite
*.sqlite-journal
```

- [ ] **Step 4: Create `package.json`**

```json
{
  "name": "timetrak",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.0.0",
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-autostart": "^2.0.0",
    "@tauri-apps/plugin-dialog": "^2.0.0",
    "@tauri-apps/plugin-notification": "^2.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "jsdom": "^25.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 5: Create `README.md`**

```markdown
# TimeTrak

Personal cross-platform tray app for tracking time spent on categorized
activities. macOS + Windows.

## Development

```sh
npm install
npm run tauri dev
```

## Tests

```sh
npm test                       # UI tests
cd src-tauri && cargo test     # Rust tests
```

See `docs/superpowers/specs/2026-05-22-timetrak-design.md` for the design.
```

- [ ] **Step 6: Install deps**

Run: `npm install`
Expected: dependencies resolve, `package-lock.json` written, no errors.

- [ ] **Step 7: Commit**

```sh
git add .gitignore package.json package-lock.json README.md
git commit -m "chore: initialize node project"
```

---

## Task 2: Configure Vite + React + TypeScript + Tailwind

**Files:**
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/index.css`

- [ ] **Step 1: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 2: Create `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 4: Create `tailwind.config.js`**

```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 5: Create `postcss.config.js`**

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 6: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TimeTrak</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Create `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; margin: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
```

- [ ] **Step 8: Create `src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 9: Create `src/App.tsx`**

```tsx
export default function App() {
  const params = new URLSearchParams(window.location.search);
  const window_ = params.get('window') ?? 'tray';
  return (
    <div className="h-full w-full p-4 text-sm">
      <div className="text-gray-500">TimeTrak [{window_}] placeholder</div>
    </div>
  );
}
```

- [ ] **Step 10: Verify dev build compiles**

Run: `npx tsc -b`
Expected: no output, exit 0.

Run: `npx vite build`
Expected: build succeeds, `dist/` written.

- [ ] **Step 11: Commit**

```sh
git add tsconfig.json tsconfig.node.json vite.config.ts tailwind.config.js postcss.config.js index.html src/
git commit -m "chore: scaffold vite + react + tailwind"
```

---

## Task 3: Initialize Tauri 2

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/icons/.gitkeep`

- [ ] **Step 1: Create `src-tauri/Cargo.toml`**

```toml
[package]
name = "timetrak"
version = "0.1.0"
edition = "2021"

[lib]
name = "timetrak_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-dialog = "2"
tauri-plugin-notification = "2"
tauri-plugin-autostart = "2"

serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"
uuid = { version = "1", features = ["v4", "serde"] }
chrono = { version = "0.4", features = ["serde"] }
rusqlite = { version = "0.31", features = ["bundled", "chrono", "uuid"] }
tokio = { version = "1", features = ["sync", "time", "rt-multi-thread", "macros"] }

[dev-dependencies]
tempfile = "3"

[features]
default = []
```

- [ ] **Step 2: Create `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 3: Create `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "TimeTrak",
  "version": "0.1.0",
  "identifier": "com.timetrak.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [],
    "security": { "csp": null },
    "macOSPrivateApi": true
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ],
    "macOS": { "minimumSystemVersion": "12.0" }
  }
}
```

> Note: `windows: []` means no windows are created at launch. Follow-up plans create windows on demand via the tray.

- [ ] **Step 4: Create `src-tauri/src/lib.rs`**

```rust
pub mod commands;
pub mod db;
pub mod domain;
pub mod error;
pub mod repo;
```

- [ ] **Step 5: Create `src-tauri/src/main.rs`**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 6: Create `src-tauri/icons/.gitkeep`**

Empty file. Real icons are created in the packaging plan; default Tauri build will warn until then but compile.

Run: `touch src-tauri/icons/.gitkeep`

- [ ] **Step 7: Generate default Tauri icons (so build doesn't fail)**

Run: `npx @tauri-apps/cli icon ./src-tauri/icons/.gitkeep --output ./src-tauri/icons || true`

> If `npx tauri icon` fails because there is no source image, run instead:
>
> ```sh
> npx @tauri-apps/cli icon --help
> ```
>
> and create placeholder PNGs with ImageMagick:
>
> ```sh
> magick -size 128x128 xc:#3b82f6 src-tauri/icons/128x128.png
> magick -size 32x32 xc:#3b82f6 src-tauri/icons/32x32.png
> magick -size 256x256 xc:#3b82f6 src-tauri/icons/128x128@2x.png
> magick src-tauri/icons/128x128.png -define icon:auto-resize=16,32,48,64,128 src-tauri/icons/icon.ico
> magick src-tauri/icons/128x128.png src-tauri/icons/icon.icns
> ```

- [ ] **Step 8: Verify `cargo check`**

Run: `cd src-tauri && cargo check`
Expected: compiles. May warn about empty modules — fine.

- [ ] **Step 9: Commit**

```sh
git add src-tauri/
git commit -m "chore: scaffold tauri 2 rust core"
```

---

## Task 4: Define shared domain types in Rust

**Files:**
- Create: `src-tauri/src/domain.rs`
- Create: `src-tauri/src/error.rs`

- [ ] **Step 1: Create `src-tauri/src/error.rs`**

```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid input: {0}")]
    Invalid(String),

    #[error("overlap: entry would overlap an existing entry")]
    Overlap,

    #[error("a timer is already running")]
    AlreadyRunning,

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

pub type AppResult<T> = std::result::Result<T, AppError>;

// Tauri commands need errors that serialize. Convert to String at the boundary.
impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
```

- [ ] **Step 2: Create `src-tauri/src/domain.rs`**

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type Id = Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Category {
    pub id: Id,
    pub name: String,
    pub color: String, // #RRGGBB
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Project {
    pub id: Id,
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimeEntry {
    pub id: Id,
    pub category_id: Id,
    pub project_id: Option<Id>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
}

/// Input for creating a new entry. `id` and timestamps are assigned by the repo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewEntry {
    pub category_id: Id,
    pub project_id: Option<Id>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
}

/// Input for editing an entry. All fields replace existing values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntryEdit {
    pub category_id: Id,
    pub project_id: Option<Id>,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub note: Option<String>,
}
```

- [ ] **Step 3: Add `chrono` to error module use (verify compile)**

Run: `cd src-tauri && cargo check`
Expected: compiles cleanly.

- [ ] **Step 4: Commit**

```sh
git add src-tauri/src/error.rs src-tauri/src/domain.rs
git commit -m "feat: define rust domain types and AppError"
```

---

## Task 5: Define SQLite schema

**Files:**
- Create: `src-tauri/src/db/mod.rs`
- Create: `src-tauri/src/db/schema.sql`

- [ ] **Step 1: Create `src-tauri/src/db/schema.sql`**

```sql
-- v1 schema for TimeTrak

CREATE TABLE IF NOT EXISTS category (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS time_entry (
  id          TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES category(id) ON DELETE RESTRICT,
  project_id  TEXT REFERENCES project(id) ON DELETE SET NULL,
  started_at  TEXT NOT NULL,                -- ISO-8601 UTC
  ended_at    TEXT,                         -- ISO-8601 UTC, NULL = running
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_time_entry_started_at ON time_entry (started_at);

-- Enforce at most one running entry at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_running_entry
  ON time_entry ((1)) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Seed default categories on first run; idempotent.
INSERT OR IGNORE INTO category (id, name, color) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Meeting', '#3b82f6'),
  ('00000000-0000-0000-0000-000000000002', 'Coding',  '#10b981'),
  ('00000000-0000-0000-0000-000000000003', 'Email',   '#f59e0b'),
  ('00000000-0000-0000-0000-000000000004', 'Break',   '#a855f7');

INSERT OR IGNORE INTO app_meta (key, value) VALUES
  ('schema_version', '1'),
  ('daily_summary_time', '18:00');
```

- [ ] **Step 2: Create `src-tauri/src/db/mod.rs`**

```rust
use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

use crate::error::AppResult;

/// Owns the SQLite connection. Wrapped in a Mutex because rusqlite::Connection
/// is not Sync. Tauri stores this as managed state.
pub struct Database {
    pub conn: Mutex<Connection>,
}

const SCHEMA_SQL: &str = include_str!("schema.sql");

impl Database {
    /// Open or create the DB at `path`, run migrations, enable foreign keys.
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        conn.execute_batch(SCHEMA_SQL)?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Open an in-memory database for tests.
    #[cfg(test)]
    pub fn open_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        conn.execute_batch(SCHEMA_SQL)?;
        Ok(Self { conn: Mutex::new(conn) })
    }
}
```

- [ ] **Step 3: Write a failing migration smoke test**

Create `src-tauri/src/db/mod.rs` test module at the bottom of the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_in_memory_creates_schema() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();

        let cnt: i64 = conn
            .query_row("SELECT COUNT(*) FROM category", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cnt, 4, "should seed 4 default categories");

        let version: String = conn
            .query_row(
                "SELECT value FROM app_meta WHERE key = 'schema_version'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(version, "1");
    }

    #[test]
    fn one_running_entry_unique_index_blocks_second_running_entry() {
        let db = Database::open_in_memory().unwrap();
        let conn = db.conn.lock().unwrap();

        conn.execute(
            "INSERT INTO time_entry (id, category_id, started_at, ended_at)
             VALUES ('a', '00000000-0000-0000-0000-000000000001', '2026-05-22T10:00:00Z', NULL)",
            [],
        )
        .unwrap();

        let err = conn.execute(
            "INSERT INTO time_entry (id, category_id, started_at, ended_at)
             VALUES ('b', '00000000-0000-0000-0000-000000000001', '2026-05-22T11:00:00Z', NULL)",
            [],
        );
        assert!(err.is_err(), "second running entry should be blocked by unique index");
    }
}
```

- [ ] **Step 4: Run the tests — expect them to pass after schema is in place**

Run: `cd src-tauri && cargo test --lib db::`
Expected: 2 tests pass.

> If the partial-unique-index syntax errors on the SQLite version bundled with `rusqlite`, change the index to use a concrete expression:
> ```sql
> CREATE UNIQUE INDEX IF NOT EXISTS idx_one_running_entry
>   ON time_entry (ended_at) WHERE ended_at IS NULL;
> ```
> This works because `ended_at` is `NULL` for at most one row under the index (since `NULL` values are still distinct under unique indexes in SQLite — but actually SQLite treats multiple NULLs as distinct). If the test fails, switch to a sentinel column approach:
> ```sql
> ALTER TABLE time_entry ADD COLUMN is_running INTEGER GENERATED ALWAYS AS (CASE WHEN ended_at IS NULL THEN 1 ELSE NULL END) VIRTUAL;
> CREATE UNIQUE INDEX idx_one_running_entry ON time_entry (is_running);
> ```
> Verify the second-insert test goes red before fixing.

- [ ] **Step 5: Commit**

```sh
git add src-tauri/src/db/
git commit -m "feat: sqlite schema, migrations, and seed data"
```

---

## Task 6: Empty repo, command, and service module skeletons

**Files:**
- Create: `src-tauri/src/repo/mod.rs`
- Create: `src-tauri/src/repo/categories.rs`
- Create: `src-tauri/src/repo/projects.rs`
- Create: `src-tauri/src/repo/entries.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/categories.rs`
- Create: `src-tauri/src/commands/projects.rs`
- Create: `src-tauri/src/commands/entries.rs`
- Create: `src-tauri/src/commands/timer.rs`
- Create: `src-tauri/src/commands/export.rs`
- Create: `src-tauri/src/timer.rs`
- Create: `src-tauri/src/reporting.rs`
- Create: `src-tauri/src/csv_export.rs`
- Create: `src-tauri/src/notifications.rs`

- [ ] **Step 1: Create `src-tauri/src/repo/mod.rs`**

```rust
pub mod categories;
pub mod entries;
pub mod projects;
```

- [ ] **Step 2: Create each empty repo file**

`src-tauri/src/repo/categories.rs`:

```rust
//! Category repository — implemented in plan 01 (data-layer).
```

`src-tauri/src/repo/projects.rs`:

```rust
//! Project repository — implemented in plan 01 (data-layer).
```

`src-tauri/src/repo/entries.rs`:

```rust
//! TimeEntry repository — implemented in plan 01 (data-layer).
```

- [ ] **Step 3: Create empty service modules**

`src-tauri/src/timer.rs`:

```rust
//! Timer service — implemented in plan 02 (timer-and-tray).
```

`src-tauri/src/reporting.rs`:

```rust
//! Reporting aggregations — implemented in plan 03 (dashboard).
```

`src-tauri/src/csv_export.rs`:

```rust
//! CSV exporter — implemented in plan 03 (dashboard).
```

`src-tauri/src/notifications.rs`:

```rust
//! Daily summary notifications — implemented in plan 05 (notifications).
```

- [ ] **Step 4: Create `src-tauri/src/commands/mod.rs`**

```rust
//! Each follow-up plan adds its command handlers to its own submodule
//! and registers them in `register_handlers` below.

pub mod categories;
pub mod entries;
pub mod export;
pub mod projects;
pub mod timer;

/// Builds the Tauri invoke_handler. Add new command functions to the
/// `tauri::generate_handler!` list as follow-up plans land.
#[macro_export]
macro_rules! timetrak_handlers {
    () => {
        tauri::generate_handler![
            // categories
            // crate::commands::categories::list_categories,
            // crate::commands::categories::create_category,
            // ...
            // (Each follow-up plan uncomments / adds entries here.)
        ]
    };
}
```

- [ ] **Step 5: Create each empty command file**

`src-tauri/src/commands/categories.rs`:

```rust
//! Category Tauri commands — implemented in plan 04 (settings).
```

`src-tauri/src/commands/projects.rs`:

```rust
//! Project Tauri commands — implemented in plan 04 (settings).
```

`src-tauri/src/commands/entries.rs`:

```rust
//! Entry Tauri commands — implemented in plan 03 (dashboard).
```

`src-tauri/src/commands/timer.rs`:

```rust
//! Timer Tauri commands — implemented in plan 02 (timer-and-tray).
```

`src-tauri/src/commands/export.rs`:

```rust
//! Export Tauri commands — implemented in plan 03 (dashboard).
```

- [ ] **Step 6: Update `src-tauri/src/lib.rs`**

Replace with:

```rust
pub mod commands;
pub mod csv_export;
pub mod db;
pub mod domain;
pub mod error;
pub mod notifications;
pub mod repo;
pub mod reporting;
pub mod timer;
```

- [ ] **Step 7: Verify cargo build**

Run: `cd src-tauri && cargo check`
Expected: builds clean (may warn about unused modules — fine).

- [ ] **Step 8: Commit**

```sh
git add src-tauri/src/
git commit -m "chore: stub module layout for follow-up plans"
```

---

## Task 7: Wire Database into Tauri managed state

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Replace `src-tauri/src/main.rs` with full setup**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use timetrak_lib::db::Database;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            let db_path = data_dir.join("timetrak.sqlite");
            let db = Database::open(&db_path)
                .expect("failed to open database");
            app.manage(db);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 2: Verify cargo build**

Run: `cd src-tauri && cargo check`
Expected: builds clean.

- [ ] **Step 3: Verify Tauri dev launches (smoke test)**

Run: `npm run tauri dev`
Expected: app builds, no windows appear (because `windows: []`). The DB file is created at the OS app-data path. Press Ctrl-C to stop.

Verify the DB file:

```sh
ls -la ~/Library/Application\ Support/com.timetrak.app/
```

Expected: `timetrak.sqlite` exists.

- [ ] **Step 4: Commit**

```sh
git add src-tauri/src/main.rs
git commit -m "feat: open SQLite DB into Tauri managed state on launch"
```

---

## Task 8: TypeScript domain types and API stub layer

**Files:**
- Create: `src/types.ts`
- Create: `src/lib/api.ts`
- Create: `src/lib/events.ts`
- Create: `src/lib/query.ts`

- [ ] **Step 1: Create `src/types.ts`** — mirror of Rust domain types

```ts
export type Id = string; // UUID v4

export interface Category {
  id: Id;
  name: string;
  color: string; // #RRGGBB
}

export interface Project {
  id: Id;
  name: string;
  color: string;
}

export interface TimeEntry {
  id: Id;
  category_id: Id;
  project_id: Id | null;
  started_at: string;   // ISO-8601 UTC
  ended_at: string | null;
  note: string | null;
}

export interface NewEntry {
  category_id: Id;
  project_id: Id | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
}

export interface EntryEdit {
  category_id: Id;
  project_id: Id | null;
  started_at: string;
  ended_at: string | null;
  note: string | null;
}
```

- [ ] **Step 2: Create `src/lib/api.ts`**

```ts
import { invoke } from '@tauri-apps/api/core';
import type { Category, Project, TimeEntry, NewEntry, EntryEdit, Id } from '../types';

/**
 * Typed wrappers over Tauri invoke. Each follow-up plan implements
 * its block of functions; this file is the only place that touches
 * `@tauri-apps/api`.
 */

// --- Categories (plan 04) ---
export const listCategories = () => invoke<Category[]>('list_categories');
export const createCategory = (name: string, color: string) =>
  invoke<Category>('create_category', { name, color });
export const updateCategory = (id: Id, name: string, color: string) =>
  invoke<Category>('update_category', { id, name, color });
export const deleteCategory = (id: Id, cascadeEntries: boolean) =>
  invoke<void>('delete_category', { id, cascadeEntries });

// --- Projects (plan 04) ---
export const listProjects = () => invoke<Project[]>('list_projects');
export const createProject = (name: string, color: string) =>
  invoke<Project>('create_project', { name, color });
export const updateProject = (id: Id, name: string, color: string) =>
  invoke<Project>('update_project', { id, name, color });
export const deleteProject = (id: Id) =>
  invoke<void>('delete_project', { id });

// --- Entries (plan 03) ---
export const listEntries = (startUtc: string, endUtc: string) =>
  invoke<TimeEntry[]>('list_entries', { startUtc, endUtc });
export const createEntry = (entry: NewEntry) =>
  invoke<TimeEntry>('create_entry', { entry });
export const updateEntry = (id: Id, edit: EntryEdit) =>
  invoke<TimeEntry>('update_entry', { id, edit });
export const deleteEntry = (id: Id) =>
  invoke<void>('delete_entry', { id });

// --- Timer (plan 02) ---
export interface TimerState {
  running: TimeEntry | null;
}
export const getTimerState = () => invoke<TimerState>('get_timer_state');
export const startTimer = (categoryId: Id, projectId: Id | null, note: string | null) =>
  invoke<TimeEntry>('start_timer', { categoryId, projectId, note });
export const stopTimer = () => invoke<TimeEntry | null>('stop_timer');
export const switchTimer = (categoryId: Id, projectId: Id | null, note: string | null) =>
  invoke<TimeEntry>('switch_timer', { categoryId, projectId, note });

// --- Export (plan 03) ---
export const exportCsv = (startUtc: string, endUtc: string) =>
  invoke<string>('export_csv', { startUtc, endUtc });
```

- [ ] **Step 3: Create `src/lib/events.ts`**

```ts
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { TimeEntry } from '../types';

export interface TimerChanged {
  running: TimeEntry | null;
}
export interface EntriesChanged {}

export const onTimerChanged = (cb: (e: TimerChanged) => void): Promise<UnlistenFn> =>
  listen<TimerChanged>('timer-changed', (evt) => cb(evt.payload));

export const onEntriesChanged = (cb: () => void): Promise<UnlistenFn> =>
  listen<EntriesChanged>('entries-changed', () => cb());
```

- [ ] **Step 4: Create `src/lib/query.ts`**

```ts
import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, refetchOnWindowFocus: false },
  },
});

export const qk = {
  categories: ['categories'] as const,
  projects: ['projects'] as const,
  entries: (startUtc: string, endUtc: string) =>
    ['entries', startUtc, endUtc] as const,
  timerState: ['timer-state'] as const,
};
```

- [ ] **Step 5: Wire QueryClient in `src/main.tsx`**

Replace `src/main.tsx` with:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/query';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 6: Type-check**

Run: `npx tsc -b`
Expected: passes.

- [ ] **Step 7: Commit**

```sh
git add src/
git commit -m "feat: typescript domain types and API wrappers"
```

---

## Task 9: Smoke test — Vitest runs

**Files:**
- Create: `src/lib/api.test.ts`

- [ ] **Step 1: Create a trivial test so vitest is wired**

```ts
import { describe, it, expect } from 'vitest';
import * as api from './api';

describe('api', () => {
  it('exports a startTimer function', () => {
    expect(typeof api.startTimer).toBe('function');
  });
});
```

- [ ] **Step 2: Run vitest**

Run: `npm test`
Expected: 1 test passes.

- [ ] **Step 3: Commit**

```sh
git add src/lib/api.test.ts
git commit -m "test: smoke test for api module"
```

---

## Task 10: Self-verify foundation

- [ ] **Step 1: Run all checks**

```sh
npx tsc -b
npm test
cd src-tauri && cargo check && cargo test --lib
```

Expected: all green.

- [ ] **Step 2: Tag the foundation**

```sh
cd /Users/alex/projects/personal/timetrak
git tag foundation-complete
git log --oneline | head -10
```

Expected: 9 commits on `main`, `foundation-complete` tag.

---

## Done

The repo now has:

- A working Tauri 2 app shell that opens a SQLite DB at the OS app-data
  path on launch and creates no windows.
- The full v1 schema with seeded categories.
- Empty module stubs for every follow-up plan to fill in: repos, timer,
  reporting, csv_export, notifications, and all command modules.
- TypeScript domain types and a complete `api.ts` whose `invoke` calls
  will fail at runtime until the matching Rust commands are wired in by
  follow-up plans — but the *types and signatures are frozen contracts*
  that follow-up plans must honor.
- React + Vite + Tailwind + React Query + Vitest.

Follow-up plans (see `2026-05-22-timetrak-INDEX.md`) can now be picked
up in parallel.
