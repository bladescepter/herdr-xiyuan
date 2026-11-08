# herdr-xiyuan

A [Herdr](https://herdr.dev) layout: Herdr's `main` layout, plus

- **Colors that follow the system** — light and dark everywhere; the whole palette of the current Omarchy theme on Linux; the system accent color on macOS and Windows. Flexoki by default.
- **A folder menu** beside New space — ten saved folders, press a digit to open a new space in one.
- **Git in the Changes panel** — stage, discard, commit, amend, fetch, pull (fast-forward only), push. No force push, reset, merge or rebase.

![Xiyuan](preview.png)

## Install

Ask your agent inside Herdr:

```
add herdr.dev/layouts/bladescepter/xiyuan
```

or point it at this repo: `add github.com/bladescepter/herdr-xiyuan`.

It copies `layouts/xiyuan.json` and the four `mods/xiyuan-*` folders into `~/.config/herdr-app` (copying `themes/` too is fine; the theme mod writes them if missing). Switch to it with `Ctrl+Shift+L`.

Heads-up: `xiyuan-changes` runs `git` in your repos and can push; `xiyuan-theme` reads Omarchy's theme folder and runs `defaults` (macOS) or `reg` (Windows) to read the accent color.

See [RECIPE.md](RECIPE.md) for how it is built.

## License

MIT. The default colors are [Flexoki](https://github.com/kepano/flexoki) by Steph Ango (MIT).
