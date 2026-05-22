# TimeTrak — Packaging + CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Produce distributable artifacts: a macOS `.dmg` (notarized when secrets are available) and a Windows `.msi`, built by GitHub Actions on tag push.

**Depends on:** tags `plan-02-complete`, `plan-03-complete`, `plan-04-complete`, `plan-05-complete`.

**Touches:**
- `src-tauri/icons/`
- `src-tauri/tauri.conf.json`
- `src-tauri/Info.plist` (new)
- `.github/workflows/release.yml` (new)

---

## Task 1: Real app icons

**Files:**
- Replace placeholders in `src-tauri/icons/`

- [ ] **Step 1: Provide a 1024×1024 source PNG**

Place a square master image at `src-tauri/icons/source.png` (1024×1024,
transparent background, the TimeTrak glyph). If you don't have art
yet, generate a minimal placeholder:

```sh
magick -size 1024x1024 xc:none \
  -fill "#2563eb" -draw "roundrectangle 64,64 960,960 160,160" \
  -fill white -gravity center -pointsize 480 -annotate +0+0 "T" \
  src-tauri/icons/source.png
```

- [ ] **Step 2: Generate the platform icon set**

Run from repo root:

```sh
npx @tauri-apps/cli icon ./src-tauri/icons/source.png --output ./src-tauri/icons
```

This produces `32x32.png`, `128x128.png`, `128x128@2x.png`,
`icon.icns`, and `icon.ico`.

- [ ] **Step 3: Provide a monochrome template tray icon (macOS)**

Create `src-tauri/icons/tray-template.png` — 22×22 (and `@2x` 44×44),
black on transparent. macOS will recolor it automatically for light/
dark menu bars.

```sh
magick -size 22x22 xc:none -fill black \
  -draw "circle 11,11 11,2" src-tauri/icons/tray-template.png
magick -size 44x44 xc:none -fill black \
  -draw "circle 22,22 22,4" src-tauri/icons/tray-template@2x.png
```

- [ ] **Step 4: Provide a Windows tray ICO**

```sh
magick src-tauri/icons/source.png -define icon:auto-resize=16,32,48,64 \
  src-tauri/icons/tray.ico
```

- [ ] **Step 5: Commit**

```sh
git add src-tauri/icons/
git commit -m "feat(icons): real app + tray icons"
```

---

## Task 2: Wire tray icon variants

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Use the template icon on macOS and the ICO on Windows**

In the tray builder, replace the `.icon(app.default_window_icon().unwrap().clone())` line with:

```rust
                .icon({
                    #[cfg(target_os = "macos")]
                    {
                        tauri::image::Image::from_path("icons/tray-template.png").unwrap()
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        tauri::image::Image::from_path("icons/tray.ico").unwrap()
                    }
                })
                .icon_as_template(cfg!(target_os = "macos"))
```

> Resolve `icons/...` relative to the bundled resources directory. If
> the dev build can't find the files, add them to the bundle resources
> in `tauri.conf.json`:
>
> ```json
> "bundle": { ..., "resources": ["icons/tray*"] }
> ```

- [ ] **Step 2: Smoke test**

Run: `npm run tauri dev`. Tray icon should appear monochrome on macOS,
colorful on Windows.

- [ ] **Step 3: Commit**

```sh
git add src-tauri/src/main.rs src-tauri/tauri.conf.json
git commit -m "feat(tray): platform-specific icon variants"
```

---

## Task 3: macOS LSUIElement (no Dock icon)

**Files:**
- Create: `src-tauri/Info.plist`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Create `src-tauri/Info.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>LSUIElement</key>
  <true/>
  <key>NSUserNotificationAlertStyle</key>
  <string>banner</string>
</dict>
</plist>
```

- [ ] **Step 2: Reference it in `tauri.conf.json`**

In the `bundle.macOS` block, add:

```json
"bundle": {
  ...
  "macOS": {
    "minimumSystemVersion": "12.0",
    "infoPlistPath": "Info.plist"
  }
}
```

- [ ] **Step 3: Verify a release build hides the Dock icon**

Run: `npm run tauri build`

Open the produced `.app` from `src-tauri/target/release/bundle/macos/`.
The tray icon should appear; no Dock icon.

- [ ] **Step 4: Commit**

```sh
git add src-tauri/Info.plist src-tauri/tauri.conf.json
git commit -m "feat(macos): LSUIElement to hide Dock icon"
```

---

## Task 4: GitHub Actions release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create**

```yaml
name: Release

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            target: aarch64-apple-darwin
          - os: macos-latest
            target: x86_64-apple-darwin
          - os: windows-latest
            target: x86_64-pc-windows-msvc

    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - run: npm ci

      - name: Build
        env:
          # Optional code signing — set these secrets in the repo to enable.
          APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
          APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: npm run tauri build -- --target ${{ matrix.target }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: timetrak-${{ matrix.target }}
          path: |
            src-tauri/target/${{ matrix.target }}/release/bundle/dmg/*.dmg
            src-tauri/target/${{ matrix.target }}/release/bundle/msi/*.msi

  release:
    needs: build
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: artifacts

      - uses: softprops/action-gh-release@v2
        with:
          files: artifacts/**/*
          generate_release_notes: true
```

- [ ] **Step 2: Commit**

```sh
git add .github/workflows/release.yml
git commit -m "ci: cross-platform release workflow"
```

---

## Task 5: First release cut

- [ ] **Step 1: Tag and push**

```sh
git tag v0.1.0
git push --tags
```

- [ ] **Step 2: Verify**

In GitHub Actions, the `Release` workflow runs the matrix. After all
three jobs succeed, a GitHub Release is created with the dmg(s) and
msi attached. Download the dmg, open it on macOS, drag to Applications,
launch. Verify:

- Tray icon visible, no Dock icon.
- DB created at `~/Library/Application Support/com.timetrak.app/`.
- Start/stop/switch works.
- Dashboard window opens, charts render, CSV exports.
- Settings window opens, autostart toggle works.

Repeat on Windows with the `.msi`.

- [ ] **Step 3: Tag**

```sh
git tag plan-06-complete
git push --tags
```

---

## Done

TimeTrak is now distributable. Signing certificates are optional but
recommended; without them, macOS Gatekeeper will warn on first launch
(users right-click → Open).
