# Minifox — Little Arc for Firefox

Peek, copy URL and containers work on any OS. Routing links from other apps into the
mini window uses [Finicky](https://github.com/johnste/finicky), so that part is macOS-only.

- **Mini window.** Links opened from other apps land in a compact window in the
  middle of the screen, with a floating URL bar: back, URL, copy, *Open in Firefox*, close.
- **Peek.** Shift+click any link inside Firefox to preview it in an overlay.
- **Copy URL.** ⇧⌘C copies the current page URL (inside Peek — the previewed page)
  and shows a small toast.
- **Containers.** Mini windows and tabs opened from Peek or a mini window keep the
  source tab's container; private stays private.

## Shortcuts

| | macOS | Windows / Linux |
|---|---|---|
| Open full — mini window → main window, Peek → tab | ⇧⌘O | Ctrl+Shift+O |
| Copy page URL | ⇧⌘C | Ctrl+Shift+C |
| Peek a link | Shift+click | Shift+click |
| Close Peek | Esc | Esc |
| Close mini window | ⌘W | Ctrl+W |

Toolbar buttons show the shortcut for the current platform. *Open full* can be rebound in
`about:addons` → ⚙ → **Manage Extension Shortcuts**, and the buttons follow the new binding.

Both default combos override Firefox's own: ⇧⌘O / Ctrl+Shift+O is *Show All Bookmarks*
(still in the Bookmarks menu), ⇧⌘C / Ctrl+Shift+C is the devtools element picker on web
pages (open devtools with ⌥⌘I / Ctrl+Shift+I instead).

## Install

### 1. Finicky (routes external links)

```sh
brew install --cask finicky
cp extras/finicky.js ~/.finicky.js
open -a Finicky
```

Accept Finicky's prompt to become the default browser, or set it in
**System Settings → Desktop & Dock → Default web browser**.

If you use Firefox Developer Edition, change both `"Firefox"` names in `~/.finicky.js`
to `"Firefox Developer Edition"`.

Then in Firefox's `about:config` set:

```
browser.tabs.loadDivertedInBackground = true
```

Without it Firefox raises the main window for every external link before the mini
window appears. The pref also makes `target="_blank"` links on pages open in background
tabs — the extension undoes that part: a tab opened by a plain click is brought to the
front, while ⌘-click and middle-click still open in the background.

### 2. The extension

Download the signed `minifox-<version>.xpi` from the latest
[GitHub Release](../../releases/latest), drag it into Firefox and allow access to all
sites (needed for Peek and the URL bar). Later versions install automatically.

Upgrading from a build with the old add-on ID (`minifox@local` or the *Mini Window*
build): Firefox treats `minifox@sukhanov.cloud` as a new add-on. Remove the old one in
`about:addons` first.

**Quick test from source (until Firefox restarts):** `about:debugging#/runtime/this-firefox`
→ **Load Temporary Add-on…** → pick `src/manifest.json`. Or run `pnpm start` (see
[Development](#development)).

### 3. Check

- `open https://github.com` in Terminal → opens in the mini window.
- Shift+click any link in Firefox → Peek.

## Usage

### Mini window
- The URL bar hides when you scroll down and comes back when you scroll up or move
  the pointer to the top edge. Click the URL to copy it.
- **Open in Firefox** (or *Open full*, or the address bar icon) moves the page to the
  main window, in the same container.
- Links from apps and hosts in the exception lists in `~/.finicky.js` skip the mini
  window and open as a focused tab in the main window.

### Peek
- Same toolbar as the mini window: back (inside the preview only), URL (click to copy),
  copy, **Open in tab** (or *Open full*), open in mini window, close.
- Close with **Esc**, a click on the backdrop, or ✕.
- The preview frame lives in the tab's container, so container sessions carry over.
- Sites that forbid embedding (GitHub, Google, …) still load: the extension strips
  `X-Frame-Options` and `frame-ancestors` for the peek frame only. Other pages are untouched.
- Because of Total Cookie Protection, a cross-site peek frame gets its own cookies, so
  you may appear logged out in the preview. *Open in tab* / *Open in mini window* opens
  the same page with your session.

Peek and the URL bar don't run on `about:` pages or `addons.mozilla.org` — Firefox keeps
extensions out of those. The *Open full* shortcut still works there.

## Configuration

- Mini window size, position (`"center"` or `"top-right"`) and margin: `SIZE`, `POSITION` and `MARGIN` in `src/background.js`.
- Exceptions: `FULL_WINDOW_HOSTS` and `SKIP_OPENERS` in `~/.finicky.js`.
  Find an app's bundle ID with `osascript -e 'id of app "Visual Studio Code"'`.

## Optional: hide Firefox's own toolbar in the mini window

With the extension's URL bar in place, Firefox's read-only address bar in popup windows
is redundant. To hide it, set `toolkit.legacyUserProfileCustomizations.stylesheets = true`
in `about:config`, then add to `<profile>/chrome/userChrome.css` and restart Firefox:

```css
/* Popup windows only */
#main-window[chromehidden~="toolbar"] #nav-bar {
  visibility: collapse !important;
}
```

This applies to **all** popup windows, including sign-in popups (OAuth etc.), which will
no longer show their address. Find your profile folder via `about:support` → *Profile Folder*.

## Known quirks

- An external link briefly creates a background tab in the main window before the
  extension closes it. If the main window still flashes forward, check that
  `browser.tabs.loadDivertedInBackground` is `true` and that Finicky picked up the new
  config (quit and relaunch it).
- New tabs opened by a page's own script without a click right before it (rare) stay in
  the background.
- If Firefox isn't running, the first external link launches it with your restored
  session, so the main window appears too.
- Popup windows that sites open themselves (OAuth sign-in, payments) are not mini
  windows: they get no toolbar and *Open full* ignores them. Mini windows that Firefox
  restores after a restart, or that were open while the extension updated, become
  plain popups too.

## Development

Requires Node.js LTS (see `.nvmrc`) and pnpm (`corepack enable` or `npm i -g pnpm`).

```sh
nvm use
pnpm install
pnpm start      # web-ext run: temporary Firefox profile with src/ loaded, auto-reload
pnpm check      # node --check on all JS
pnpm lint       # web-ext lint (errors fail, warnings don't)
pnpm build      # zip src/ into web-ext-artifacts/
pnpm icons      # re-render src/icons/*.png from assets/icons/*.svg
```

Layout:

- `src/` — the extension; the only thing packaged into the `.xpi`.
- `extras/finicky.js` — Finicky config, attached to each release.
- `assets/icons/` — SVG sources of the icons.
- `scripts/` — icon rendering and release helpers.
- `updates.json` — update manifest for installed copies; maintained by the release workflow.
- `.github/workflows/` — CI (`ci.yml`) and release (`release.yml`).

The `#minifox_open_in_mini` / `#minifox_open_in_main` markers are a contract between
`extras/finicky.js` and `src/background.js` — change both together.

## Releasing

```sh
pnpm release 1.2.3        # bumps src/manifest.json + package.json, commits, tags v1.2.3
git push --follow-tags    # the tag starts the release workflow
```

The workflow checks that the tag matches `manifest.json`, builds and signs the `.xpi`
with AMO (unlisted channel), and publishes a GitHub Release with the `.xpi` and
`extras/finicky.js`, with notes from the commits since the previous tag. It then adds
the release to `updates.json` on `main` — installed copies poll it through `update_url`
and update themselves. AMO never signs the same version twice, so every release needs
a new version.

Signing needs two repository secrets, from
https://addons.mozilla.org/developers/addon/api/key/:

| Secret | Value |
|---|---|
| `AMO_JWT_ISSUER` | JWT issuer, like `user:12345:678` |
| `AMO_JWT_SECRET` | JWT secret |
