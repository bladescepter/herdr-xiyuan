# Xiyuan

Herdr's `main` layout with three additions: its colors follow the system theme (the whole palette of the current Omarchy theme on Linux, the accent color on macOS and Windows, light and dark everywhere); a folder button beside New space drops down ten saved folders, each one key away from a new space there; and the Changes panel does everyday git — stage, discard, commit, amend, fetch, pull, push.

![Xiyuan](preview.png)

## What you see

Left to right, as in `main`:

- **Sidebar, 268px**, on the `chrome` color: the brand bar (46px), then Spaces and Agents sharing the rest equally (each at least 90px), then the footer (69px).
  - **Spaces header** (31px): "Spaces" in 11.5px `dim` text, and two 26px icon buttons at the right: a **folder** (`mods/workspace-chrome/folder.svg`, 14px) and **+** (`plus.svg`, 14px). Both turn `hover` with `foreground` icons under the pointer. When the sidebar is narrower than 160px, only + is shown.
  - Below it, the spaces list exactly as in Herdr's built-in Spaces.
- **Work column**: the tabs bar (42px), the active tab's panes (cards with radius 10, 8px gaps, a 1px `border` frame and a 1px `accent` frame on the focused one, a 30px pane header), and the status bar (28px).
- **Right panel, 368px, hidden until opened** from the tabs bar: Files or Changes, stacked. Changes is a card (`background`, 1px `border`, radius 10):
  - Header (42px): an all-files stage box, "Changes", a pill with "N files" or "S/N staged", then `+added` in `ansi2` and `−deleted` in `ansi1`.
  - Branch bar (38px): `⎇`, the branch name in 12px semibold, `↑ahead` in `ansi2`, `↓behind` in `blocked` color, or "not pushed" / "upstream gone" in `dim`; then **Fetch**, **Pull**, **Push** as 26px outlined buttons (11px text, radius 6).
  - File rows (28px, the list up to 200px tall): a stage box, the status letter (A `ansi2`, D and U `ansi1`, else `blocked`), the folder in `dim` and the file name. The open row is `selected` and gets a **↺** button.
  - The diff of the open file in the terminal font at 11px.
  - Footer: a 32px commit-message field (border turns `accent` while typing), an **Amend** check box, an outlined **Commit & Push** and a solid **Commit** (`solid` / `solid_foreground`).
- **Folder menu** (a popup at the pointer, 300px wide, up to 420px tall, on `popover`): a line "Open in a new space · Shift+digit to change", ten 28px rows in the order 1–9, 0 — an 18px digit badge (`accent` border and digit when set, `border`/`dim` when empty), the folder's name, its path with `~` for home in 11px `dim`, and small **Set** and **×** — then a divider and a **Browse…** row with "Enter" at the right. Empty rows read "Empty · click to set".
- **Colors**: the layout's themes are `xiyuan-light` and `xiyuan-dark`, Flexoki by default (light: background `#FFFCF0`, foreground `#100F0F`, accent `#205EA6`; dark: background `#100F0F`, foreground `#CECDC3`, accent `#4385BE`). Panel colors are derived by Herdr from these.

## How it behaves

- **Agents**: unchanged from `main` — the Agents list and the spaces list show working, blocked, done and idle the way Herdr's built-in `agents` and `spaces` mods do.
- **Theme**: Herdr picks `xiyuan-light` or `xiyuan-dark` with the system's appearance. Inside them:
  - Linux with Omarchy: the current Omarchy theme is written into the theme of its mode (background, foreground, selection, cursor, the 16 terminal colors from Omarchy's `alacritty.toml`, else `colors.toml`, and the accent). It follows within about 2 seconds of an Omarchy theme switch, with a check every 30 seconds as a safety net.
  - macOS and Windows: only the accent is replaced with the system accent color, checked every minute.
  - Any platform: a missing theme file is first written with the Flexoki defaults.
  - Files are only written when their text changes; a failed write posts one warning notification.
- **+** (header, "This computer", and "New space there") makes a new space at once, as in `main`. `Ctrl+Shift+N` is Herdr's default New space.
- **Folder button** opens the folder menu:
  - A digit, or a click on a row, opens a new space in that folder on this computer and closes the menu. An empty slot asks for its folder first (the system folder picker), and remembers it.
  - Shift+digit, or **Set**, picks a new folder for the slot; **×** clears it.
  - **Browse…** or Enter picks any folder once and opens it; Esc closes the menu.
  - The ten folders are kept in shared state `xiyuan.folders` (an array of 10, index = digit).
- **Changes**:
  - A row's box stages or unstages that file; the header box stages or unstages all. Partly staged files show "–".
  - **↺** on the open row turns into a red "Discard?" (or "Delete file?" for new files); a second click within 4 seconds discards. Conflicted files can't be discarded.
  - **Commit** commits what's staged, or everything when nothing is. **Amend** (check box) rewrites the last commit, keeping its message when the field is empty. **Commit & Push** commits, then pushes.
  - **Fetch** runs `git fetch --prune`; **Pull** only fast-forwards; **Push** sets the upstream on a branch's first push.
  - It fetches by itself when a repo opens and every 5 minutes after; a background fetch only shows a message when it fails.
  - While a command runs its button reads "Fetch…", "Commit…" and so on; results and git's errors show above the commit field.
  - The panel refreshes on folder changes and every 10 seconds.

## Built from

- **Layout** `layouts/xiyuan.json`: `layout.clone main`, then:
  - root: `"theme": { "light": "xiyuan-light", "dark": "xiyuan-dark" }`, `"preview": "layouts/xiyuan.svg"`.
  - the `spaces` block's mod is `xiyuan-spaces`; the `changes` block's mod is `xiyuan-changes` (keep the block id `changes`: the tabs bar's Changes button toggles it by id).
  - a last sidebar child `{ "id": "xiyuan-theme", "type": "block", "content": { "mod": "xiyuan-theme" }, "size": { "px": 0 } }` so the theme mod runs.
  - Tree: `root` row → `sidebar` column (`brand` workspace-chrome, `sidebar-lists` column of `spaces` + `agents`, `sidebar-footer` workspace-chrome `{footer: true}`, `xiyuan-theme`) and `work` column (`tabs`, `work-body` row of `main` terminal block + hidden `panel` column with a `panel-body` stack of `files` and `changes`, `status` workspace-status).
- **Shipped mods used**: `workspace-chrome`, `agents`, `tabs`, `pane`, `files`, `workspace-status`, `menu` (the space right-click menu); icons `mods/workspace-chrome/{folder,plus,branch,chevron-*}.svg`.
- **`mods/xiyuan-theme/`** (`{"place":"none"}`, draws nothing): `readTextFile`, `writeTextFile`, `watchFolder` on `~/.local/state/omarchy/current`, `appHome()`, `window().platform`, `notify`. Runs `defaults read -g AppleAccentColor` (macOS) and `reg query HKCU\Software\Microsoft\Windows\DWM /v AccentColor` (Windows, `0xAABBGGRR`). Writes only `themes/xiyuan-light.json` and `themes/xiyuan-dark.json`.
- **`mods/xiyuan-launch/`** (`{"place":"none","title":"Folders","overlay":{"kind":"popup","width":300,"height":420}}`): the folder menu. `pickFolder`, `shared`/`setShared("xiyuan.folders")`, `run("space.new", { folder, machine: "" })`, `closeOverlay(props().overlay)`.
- **`mods/xiyuan-spaces/`**: `mod.clone spaces` (0.1.13); the only change is the folder button, which calls `openOverlay({ mod: "xiyuan-launch", kind: "popup", width: 300, height: 420 })`. Like the original it runs `git status` and `hc`.
- **`mods/xiyuan-changes/`**: `mod.clone changes` (0.1.13) plus the branch bar, stage boxes, discard, commit/amend/push. Runs `git` only, through `exec` in the repo's folder (on its machine for remote spaces): `status`, `diff`, `remote`, `rev-parse`, `add`, `reset`, `rm --cached`, `restore`, `clean -f -- <file>`, `rm -f`, `commit [--amend] [--no-edit] -m`, `fetch --prune`, `pull --ff-only`, `push [-u <remote> HEAD]`.
- **Themes** `themes/xiyuan-light.json`, `themes/xiyuan-dark.json`: Flexoki; light uses the 600 shades for normal colors and the 400 shades for bright ones.
- **Art**: `layouts/xiyuan.svg` (the settings preview), `mods/xiyuan-changes/changes.svg`.

## Watch out

- **What it touches**: `xiyuan-theme` reads `~/.local/state/omarchy/current/theme/` and runs `defaults` / `reg`; `xiyuan-changes` runs git in your repos and can push to your remotes; `xiyuan-spaces` runs `git status` like the built-in. None of them reaches the network except through git (fetch, pull, push).
- **Copy `themes/` too** if you can; if not, `xiyuan-theme` writes the Flexoki defaults on first run. A theme chosen in Settings overrides the layout's, and then the colors no longer follow the system.
- On Omarchy the theme files are rewritten to the current Omarchy theme, so editing them by hand doesn't last.
- Write a new mod's `mod.json` before its `main.js`: a folder without `mod.json` gets docked into the layout.
- `window()` is null under `herdr-app check`; use `window()?.platform`.
- `exec` takes no environment and no terminal: git that asks for a password fails with its message (use ssh-agent or a credential helper). Each command times out after 30 seconds.
- The folder menu only opens spaces on this computer: the system folder picker can't browse another machine. Remote machines keep their own + in the spaces list.
- It never force-pushes, resets, merges or rebases. A diverged branch can't Pull (fast-forward only); settle it in a terminal.
- The Changes list shows at most 1,000 files; a diff shows at most 1,500 lines, each cut at 4,000 characters.
- `xiyuan-spaces` and `xiyuan-changes` are clones of 0.1.13: later changes to the built-in `spaces` and `changes` don't reach them.
- Not tested: the macOS and Windows accent paths.

## Done when

- `herdr-app check mods/<name>` passes for all four mods and `herdr-app status` shows no errors after `layout.switch {"name":"xiyuan"}`.
- Settings shows the xiyuan preview picture.
- `themes/xiyuan-light.json` and `xiyuan-dark.json` exist (deleted, they come back on the next start); switching the system between light and dark switches the layout's colors.
- On Omarchy, switching the Omarchy theme changes Herdr's background and terminal colors within a few seconds.
- The folder button opens the menu at the pointer; setting slot 1 and pressing `1` opens a new space in that folder; + and `Ctrl+Shift+N` make a new space without the menu.
- In a git repo with changes, the panel shows the branch bar; ticking a box stages the file (`git status` agrees); ↺ twice discards; Commit with a message makes a commit; Push sets the upstream on a new branch; Pull refuses on a diverged branch.
