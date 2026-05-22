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

## Building

### macOS (local)

```sh
npm run tauri build
```

Produces `src-tauri/target/release/bundle/dmg/TimeTrak_<version>_aarch64.dmg`
(or `x86_64.dmg` depending on host architecture).

### Windows

Tauri's Windows installers (`.msi` via WiX, `.exe` via NSIS) are
Windows-only tools, so you can't cross-compile a polished Windows
build from macOS. Pick one of:

#### Option 1 — GitHub Actions (recommended)

The repo ships with `.github/workflows/release.yml`, a cross-platform
matrix that builds macOS (aarch64 + x86_64) and Windows
(x86_64-pc-windows-msvc) in parallel. Two ways to trigger it:

```sh
# Tag-and-push — also creates a GitHub Release with the artifacts attached
git tag v0.2.0
git push origin v0.2.0
```

…or open the repo on github.com → **Actions** → **Release** workflow →
**Run workflow** (uses `workflow_dispatch`).

Each job uploads its bundle as a build artifact; on a `v*` tag push the
release job additionally attaches them to a GitHub Release with
auto-generated notes.

Optional secrets for code signing (set in the repo's Settings →
Secrets → Actions; build still succeeds without them, just unsigned):

- macOS: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`,
  `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`,
  `APPLE_TEAM_ID`
- Tauri updater (future): `TAURI_SIGNING_PRIVATE_KEY`,
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

#### Option 2 — Build on a Windows machine

One-time setup on Windows 10/11:

```powershell
winget install Microsoft.EdgeWebView2Runtime
winget install Rustlang.Rustup
winget install OpenJS.NodeJS.LTS
rustup target add x86_64-pc-windows-msvc
```

Plus the Visual Studio Build Tools 2022 with the **Desktop development
with C++** workload (provides MSVC + the Windows SDK that Tauri's
bundler needs).

Per build:

```powershell
git clone <repo-url>
cd timetrak
npm ci
npm run tauri build
```

Output:

- `src-tauri\target\release\bundle\msi\TimeTrak_<version>_x64_en-US.msi`
- `src-tauri\target\release\bundle\nsis\TimeTrak_<version>_x64-setup.exe`

#### Option 3 — Windows VM on this Mac

Parallels Desktop, VMware Fusion, or UTM → install Windows 11 → follow
Option 2 inside the VM. Workable but slow; really only worth it if
you'll iterate locally instead of via CI.

## Docs

- Design spec: `docs/superpowers/specs/2026-05-22-timetrak-design.md`
- v0.2 popover redesign: `docs/superpowers/specs/2026-05-22-timetrak-v0.2-design.md`
- Plan index + frozen contracts: `docs/superpowers/plans/2026-05-22-timetrak-INDEX.md`
- Current TODOs / bugs: `docs/TODO.md`
