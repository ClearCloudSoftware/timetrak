#!/usr/bin/env bash
# scripts/release.sh — bump version, commit, tag, push.
#
# Pushing a `v*` tag triggers `.github/workflows/release.yml`, which builds
# the macOS (aarch64 + x86_64) and Windows (x86_64-msvc) bundles in parallel
# and attaches them to a GitHub Release.
#
# Usage:
#   scripts/release.sh <version>
# Example:
#   scripts/release.sh 0.3.0

set -euo pipefail

# --- input ----------------------------------------------------------------

if [[ $# -ne 1 ]]; then
  echo "usage: scripts/release.sh <version>" >&2
  echo "example: scripts/release.sh 0.3.0" >&2
  exit 1
fi

VERSION="$1"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: version must be semver MAJOR.MINOR.PATCH (got: $VERSION)" >&2
  exit 1
fi
TAG="v$VERSION"

# --- repo state checks ----------------------------------------------------

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: working tree has uncommitted changes — clean it up first" >&2
  git status --short >&2
  exit 1
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "dev" && "$BRANCH" != "main" ]]; then
  echo "warning: on branch '$BRANCH' (not 'dev' or 'main')"
  read -r -p "continue anyway? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "error: no remote named 'origin' is configured" >&2
  exit 1
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "error: tag $TAG already exists locally" >&2
  exit 1
fi

if git ls-remote --exit-code --tags origin "$TAG" >/dev/null 2>&1; then
  echo "error: tag $TAG already exists on origin" >&2
  exit 1
fi

# --- detect current versions ----------------------------------------------

current_pkg=$(grep -E '"version"' package.json | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')
current_tauri=$(grep -E '"version"' src-tauri/tauri.conf.json | head -1 | sed 's/.*"version": "\([^"]*\)".*/\1/')
current_cargo=$(grep -E '^version = ' src-tauri/Cargo.toml | head -1 | sed 's/version = "\([^"]*\)"/\1/')

cat <<EOF
About to release $TAG:

  package.json              $current_pkg   → $VERSION
  src-tauri/tauri.conf.json $current_tauri → $VERSION
  src-tauri/Cargo.toml      $current_cargo → $VERSION

  → git commit -m "chore(release): bump to $VERSION"
  → git tag $TAG
  → git push origin $BRANCH
  → git push origin $TAG       (triggers Release workflow)

EOF
read -r -p "proceed? [y/N] " ans
[[ "$ans" =~ ^[Yy]$ ]] || { echo "aborted"; exit 1; }

# --- bump versions --------------------------------------------------------

# `sed -i` differs between GNU and BSD sed, so write to a temp file and mv.
bump_json() {
  local file="$1"
  sed "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$VERSION\"/" "$file" > "$file.tmp"
  mv "$file.tmp" "$file"
}

bump_cargo() {
  local file="$1"
  # Anchor to start-of-line to match the [package] version, not the inline
  # `version = "0.4"` strings inside `[dependencies]` table entries.
  sed "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"$/version = \"$VERSION\"/" "$file" > "$file.tmp"
  mv "$file.tmp" "$file"
}

bump_json  "package.json"
bump_json  "src-tauri/tauri.conf.json"
bump_cargo "src-tauri/Cargo.toml"

# refresh Cargo.lock so it records the new crate version
echo "+ cargo check (refreshes Cargo.lock)"
(cd src-tauri && cargo check --quiet)

# --- commit, tag, push ----------------------------------------------------

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore(release): bump to $VERSION"
git tag "$TAG"
git push origin "$BRANCH"
git push origin "$TAG"

cat <<EOF

✓ $TAG pushed.

Watch the Release workflow:
  https://github.com/ClearCloudSoftware/timetrak/actions

When the macOS + Windows matrix finishes (~5–10 min), the build artifacts
are attached to a new GitHub Release with auto-generated notes.
EOF
