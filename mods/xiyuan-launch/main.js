// New space, starting from a folder. Opened as a dialog (Ctrl+Shift+N in the xiyuan layout,
// or the sidebar's New space button). Ten slots, 1–9 and 0, each a folder kept in shared
// "xiyuan.folders": press the digit to open a space there; Shift+digit (or Set) picks the
// slot's folder; × clears it. Browse (Enter) opens the system folder picker once. Esc leaves.
// Folders are on this computer: the system picker can't browse another machine.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, theme, props, closeOverlay, shared, setShared, pickFolder, home } from "herdr";

const KEY = "xiyuan.folders";
const ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
const SHIFTED = { "!": 1, "@": 2, "#": 3, "$": 4, "%": 5, "^": 6, "&": 7, "*": 8, "(": 9, ")": 0 };

const slots = () => {
  const s = shared(KEY);
  return Array.isArray(s) && s.length === 10 ? s : Array(10).fill(null);
};
const short = (path) => {
  const h = home();
  return path === h ? "~" : path.startsWith(h + "/") || path.startsWith(h + "\\") ? "~" + path.slice(h.length) : path;
};
const base = (path) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

export default class Launch extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus()); // after the dialog has settled
  }

  close() {
    closeOverlay(props().overlay);
  }

  open(folder) {
    this.close();
    run("space.new", { folder, machine: "" });
  }

  // The system picker; while it is up, keys go to it, not here.
  pick(cx, then) {
    if (this.picking) return;
    this.picking = true;
    cx.spawn(async (cx) => {
      try {
        const folder = await pickFolder({ prompt: "Choose" });
        if (folder) then(folder);
      } catch (e) {
        this.error = `Folder picker failed: ${e}`;
      } finally {
        this.picking = false;
        this.handle.focus();
        cx.notify();
      }
    });
  }

  assign(cx, n) {
    this.pick(cx, (folder) => {
      const next = [...slots()];
      next[n] = folder;
      setShared(KEY, next);
    });
  }

  clear(n) {
    const next = [...slots()];
    next[n] = null;
    setShared(KEY, next);
  }

  slot(cx, n) {
    const folder = slots()[n];
    if (folder) this.open(folder);
    else this.assign(cx, n);
  }

  row(t, n, folder) {
    const id = `slot-${n}`;
    const small = (label, onClick) =>
      div().id(`${id}-${label}`).px(8).h(24).flex().items_center().rounded(6).text_size(11).text_color(t.muted)
        .cursor_pointer().hover((s) => s.bg(t.raised).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); }).child(label);
    return h_flex().id(id).h(36).flex_none().px(8).gap(10).items_center().rounded(8).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.slot(cx, n))
      .child(div().w(22).h(22).flex_none().flex().items_center().justify_center().rounded(5)
        .border_1().border_color(folder ? t.accent : t.border).text_size(11).font_semibold()
        .text_color(folder ? t.accent : t.dim).child(String(n)))
      .child(folder
        ? h_flex().flex_1().min_w(0).gap(8).items_center()
            .child(div().flex_none().max_w(180).truncate().text_color(t.foreground).child(base(folder)))
            .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(short(folder)))
        : div().flex_1().text_color(t.dim).child("Empty · click to set"))
      .when(Boolean(folder), (e) => e.child(small("Set", (cx) => this.assign(cx, n))).child(small("×", () => this.clear(n))));
  }

  render(cx) {
    const t = theme(), s = slots();
    return v_flex().id("xiyuan-launch").size_full().min_h(0).p(16).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") this.close();
        else if (k === "enter") this.pick(cx, (folder) => this.open(folder));
        else if (/^[0-9]$/.test(k) && !e.modifiers.control && !e.modifiers.alt) {
          if (e.modifiers.shift) this.assign(cx, Number(k));
          else this.slot(cx, Number(k));
        } else if (k in SHIFTED) this.assign(cx, SHIFTED[k]);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().gap(8)
        .child(div().flex_1().text_size(15).font_semibold().child("New space"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_size(12).text_color(t.muted).child("Press a digit to open its folder · Shift+digit to change it"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().gap(2).children(ORDER.map((n) => this.row(t, n, s[n]))))
      .when(Boolean(this.error), (e) => e.child(div().text_size(11).text_color(t.ansi1).child(this.error)))
      .child(h_flex().justify_end().gap(8).text_size(12)
        .child(div().id("cancel").h(32).px(14).flex().items_center().rounded(8).border_1().border_color(t.input)
          .bg(t.raised).cursor_pointer().hover((s) => s.opacity(0.88))
          .on_click(() => this.close()).child("Cancel"))
        .child(div().id("browse").h(32).px(14).flex().items_center().gap(8).rounded(8).bg(t.solid)
          .text_color(t.solid_foreground).cursor_pointer().hover((s) => s.opacity(0.88))
          .on_click((_e, cx) => this.pick(cx, (folder) => this.open(folder)))
          .child(this.picking ? "Choosing…" : "Browse…").child(div().opacity(0.6).text_size(11).child("Enter"))));
  }
}
