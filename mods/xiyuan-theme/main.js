// Keeps the xiyuan layout's themes in step with the system.
// Light/dark switching itself is the layout's `"theme": { "light", "dark" }`;
// this mod only rewrites the colors inside themes/xiyuan-light.json and xiyuan-dark.json:
//   Linux + Omarchy: the whole palette of the current Omarchy theme (watched).
//   macOS / Windows: the system accent color (checked every minute).
// It draws nothing.

import { View, div } from "gpui-kit";
import { exec, home, appHome, readTextFile, writeTextFile, watchFolder, window, notify } from "herdr";

const NAMES = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
// AppleAccentColor values; absent means blue (multicolor).
const MAC_ACCENTS = { "-1": "#8C8C8C", "0": "#FF5257", "1": "#F7821B", "2": "#FFC600", "3": "#62BA46", "4": "#007AFF", "5": "#A550A7", "6": "#F74F9E" };

// `key = "value"` pairs of a small TOML file, keyed "section.key".
function toml(text) {
  const out = {};
  let section = "";
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    const s = /^\[([^\]]+)\]$/.exec(line);
    if (s) { section = s[1] + "."; continue; }
    const kv = /^([\w.-]+)\s*=\s*"([^"]*)"/.exec(line);
    if (kv) out[section + kv[1]] = kv[2];
  }
  return out;
}
const hex = (v) => (/^#[0-9a-fA-F]{6}$/.test(v ?? "") ? v.toUpperCase() : null);
const light = (c) => {
  const n = parseInt(c.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.5;
};
const onAccent = (c) => (light(c) ? "#100F0F" : "#FFFCF0");

// An Omarchy theme as a Herdr theme. Terminal colors come from Omarchy's alacritty.toml
// (what the person's terminal shows), else from colors.toml.
function omarchyTheme(colorsText, alacrittyText) {
  const c = toml(colorsText), a = toml(alacrittyText);
  const background = hex(c.background) ?? hex(a["colors.primary.background"]);
  const foreground = hex(c.foreground) ?? hex(a["colors.primary.foreground"]);
  if (!background || !foreground) return null;
  const mode = c.mode === "light" || c.mode === "dark" ? c.mode : light(background) ? "light" : "dark";
  const dark = mode === "dark";
  const normal = { ...c, black: dark ? c.lighter_background : foreground, white: dark ? foreground : c.lighter_background };
  const bright = { black: c.muted, white: c.bright_foreground };
  const ansi = [
    ...NAMES.map((n) => hex(a[`colors.normal.${n}`]) ?? hex(normal[n]) ?? foreground),
    ...NAMES.map((n) => hex(a[`colors.bright.${n}`]) ?? hex(bright[n] ?? c[`bright_${n}`]) ?? hex(normal[n]) ?? foreground),
  ];
  const accent = hex(c.accent) ?? ansi[4];
  return {
    mode,
    theme: {
      background,
      foreground,
      selection: hex(a["colors.selection.background"]) ?? hex(c.selection) ?? ansi[8],
      cursor: hex(a["colors.cursor.cursor"]) ?? foreground,
      ansi,
      colors: { accent, accent_foreground: onAccent(accent) },
    },
  };
}

const themeFile = (mode) => `${appHome()}/themes/xiyuan-${mode}.json`;

export default class XiyuanTheme extends View {
  init(_props, cx) {
    const platform = window()?.platform; // null under `herdr-app check`
    if (platform === "linux") this.watchOmarchy(cx);
    else if (platform === "macos" || platform === "windows") {
      this.syncAccent(cx, platform);
      cx.timer.every(60000, (cx) => this.syncAccent(cx, platform));
    }
  }

  // Writes only when the text differs, so an unchanged system causes no reload.
  async write(path, text) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const old = await readTextFile(path);
      if (old === text) return;
      try { await writeTextFile(path, text, old); return; } catch (e) { if (attempt === 2) throw e; }
    }
  }

  fail(e) {
    if (this.failed) return;
    this.failed = true;
    notify({ title: "xiyuan: theme sync failed", body: String(e), level: "warning" });
  }

  async syncOmarchy(dir) {
    const colors = await readTextFile(`${dir}/theme/colors.toml`);
    if (colors === null) return false;
    const made = omarchyTheme(colors, await readTextFile(`${dir}/theme/alacritty.toml`));
    if (made) await this.write(themeFile(made.mode), JSON.stringify(made.theme, null, 2) + "\n");
    return true;
  }

  watchOmarchy(cx) {
    const dir = `${home()}/.local/state/omarchy/current`;
    const sync = () => this.syncOmarchy(dir).catch((e) => { this.fail(e); return false; });
    cx.spawn(async () => {
      this.omarchy = await sync();
      if (!this.omarchy) return;
      for (;;) {
        try { await watchFolder(dir); } catch { return; } // the timer below still covers it
        await sync();
      }
    });
    // Safety net for missed or failed watches; reads two small files.
    cx.timer.every(30000, (cx) => { if (this.omarchy) cx.spawn(async () => { await sync(); }); });
  }

  syncAccent(cx, platform) {
    cx.spawn(async () => {
      try {
        let accent = null;
        if (platform === "macos") {
          const r = await exec("defaults", ["read", "-g", "AppleAccentColor"]);
          accent = MAC_ACCENTS[r.code === 0 ? r.stdout.trim() : "4"] ?? MAC_ACCENTS["4"];
        } else {
          const r = await exec("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\DWM", "/v", "AccentColor"]);
          const m = /0x([0-9a-f]+)/i.exec(r.stdout);
          if (m) { // 0xAABBGGRR
            const v = parseInt(m[1], 16), part = (s) => ((v >> s) & 255).toString(16).padStart(2, "0");
            accent = `#${part(0)}${part(8)}${part(16)}`.toUpperCase();
          }
        }
        if (!accent) return;
        for (const mode of ["light", "dark"]) {
          const text = await readTextFile(themeFile(mode));
          if (text === null) continue;
          const t = JSON.parse(text);
          t.colors = { ...(t.colors ?? {}), accent, accent_foreground: onAccent(accent) };
          await this.write(themeFile(mode), JSON.stringify(t, null, 2) + "\n");
        }
      } catch (e) { this.fail(e); }
    });
  }

  render() {
    return div();
  }
}
