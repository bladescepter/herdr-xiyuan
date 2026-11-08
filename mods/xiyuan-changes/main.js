// The xiyuan Changes panel: Herdr's Changes (file list + diff), plus everyday git.
//   Header: branch, ahead/behind its upstream, Fetch, Pull (fast-forward only), Push
//           (sets the upstream on first push). Fetches by itself on open and every 5 minutes.
//   Files:  the box stages or unstages one file (the header box: all); ↺ on the open file
//           discards its changes (click twice).
//   Commit: commits what's staged, or everything when nothing is; Amend rewrites the last
//           commit; Commit & Push does both.
// Never force-pushes, merges or resets. Git runs without a terminal, so anything that would
// ask for a password fails with git's message instead of waiting.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, settings } from "herdr";

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
// Reads write nothing under .git (no index refresh or lock, no fsmonitor cookie):
// the folder watch would see it, and every refresh would start the next one.
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
const FETCH_EVERY = 5 * 60 * 1000;
const countLines = (text) => text ? text.split("\n").length - Number(text.endsWith("\n")) : 0;
const firstLine = (s) => (s || "").trim().split("\n").filter(Boolean).slice(-3).join(" · ");

// "## main...origin/main [ahead 1, behind 2]", "## No commits yet on main", "## HEAD (no branch)"
function parseBranch(line) {
  const text = line.slice(3);
  const fresh = /^No commits yet on (.+)$/.exec(text);
  if (fresh) return { name: fresh[1], upstream: null, ahead: 0, behind: 0 };
  if (text.startsWith("HEAD (no branch)")) return { name: "detached", detached: true, upstream: null, ahead: 0, behind: 0 };
  const m = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(text) ?? [];
  const info = m[3] ?? "";
  return {
    name: m[1] ?? text, upstream: m[2] ?? null, gone: info.includes("gone"),
    ahead: Number(/ahead (\d+)/.exec(info)?.[1] ?? 0), behind: Number(/behind (\d+)/.exec(info)?.[1] ?? 0),
  };
}

// Numbers each diff line once, so a frame only draws the rows on screen.
function diffRows(lines) {
  let old = 0, next = 0;
  return lines.map((line) => {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (match) { old = +match[1]; next = +match[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: line.slice(1) || " " };
    if (kind === "+") return { kind, number: next++, text: line.slice(1) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: line.slice(1) || " " }; }
    return { kind: "", text: line };
  });
}

export default class Changes extends View {
  init(_props, cx) {
    this.files = []; this.rows = []; this.diffWidth = 0; this.message = ""; this.handle = cx.focus_handle();
    this.branch = null; this.remotes = []; this.amend = false; this.fetchedAt = {};
    this.input = InputState.new({ placeholder: "Commit message" });
    this.input.on("change", (_e, cx) => {
      const hadMessage = Boolean(this.message.trim());
      this.message = this.input.value();
      if (hadMessage !== Boolean(this.message.trim())) cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.commit(cx, false));
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(10000, (cx) => this.refresh(cx));
    cx.timer.every(60000, (cx) => this.autoFetch(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    cx.spawn(async (cx) => {
      try {
        while (this.watched === root) {
          await watchFolder(root);
          if (this.watched === root) this.refresh(cx);
        }
      } catch { this.watched = null; }
    });
  }

  refresh(cx) {
    if (this.loading || this.busy) return;
    const { cwd, on } = location(), context = key();
    if (context !== this.context) {
      this.context = context; this.root = null; this.files = []; this.open = null; this.branch = null; this.remotes = [];
      this.setLines([]); this.message = ""; this.input.set_value(""); this.error = null; this.note = null; this.watched = null; this.closed = false; this.limited = false; this.amend = false; this.armed = null;
    }
    if (!cwd) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      let fresh = false;
      try {
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
        if (key() !== context) return;
        if (top.code !== 0) { this.root = null; this.files = []; this.branch = null; this.setLines([]); this.open = null; this.error = "Not a git repository"; return; }
        const root = top.stdout.trim(), git = (args) => exec("git", [...READ, ...args], { cwd: root, on });
        const status = await git(["status", "--porcelain=v1", "-z", "--branch", "--no-renames", "--untracked-files=all"]);
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(["rev-parse", "--verify", "HEAD"]);
        const remotes = await git(["remote"]);
        const stats = {};
        const results = head.code === 0 ? [await git(["diff", "HEAD", "--numstat", "-z", "--no-renames"])] : [await git(["diff", "--cached", "--numstat", "-z", "--no-renames"]), await git(["diff", "--numstat", "-z", "--no-renames"])];
        for (const result of results) {
          if (result.code !== 0) throw new Error(result.stderr);
          for (const entry of result.stdout.split("\0")) {
            const [a, d, ...parts] = entry.split("\t");
            if (!parts.length) continue;
            const path = parts.join("\t"), old = stats[path] ?? { add: 0, del: 0 };
            stats[path] = { add: old.add + (Number(a) || 0), del: old.del + (Number(d) || 0), binary: a === "-" };
          }
        }
        let entries = status.stdout.split("\0").filter(Boolean), branch = null;
        if (entries[0]?.startsWith("## ")) branch = parseBranch(entries.shift());
        const files = [];
        for (const entry of entries.slice(0, 1000)) {
          const xy = entry.slice(0, 2), path = entry.slice(3), untracked = xy === "??";
          const conflict = xy.includes("U") || xy === "AA" || xy === "DD";
          const s = conflict ? "U" : xy.includes("D") ? "D" : untracked || xy.includes("A") ? "A" : "M";
          const staged = !untracked && xy[0] !== " ", unstaged = untracked || xy[1] !== " ";
          const stat = stats[path] ?? { add: 0, del: 0 };
          files.push({ path, status: s, fresh: untracked, staged, unstaged, conflict, ...stat });
        }
        if (key() !== context) return;
        fresh = this.root !== root;
        this.root = root; this.on = on; this.hasHead = head.code === 0; this.files = files; this.limited = entries.length > 1000; this.error = null;
        this.branch = branch; this.remotes = remotes.code === 0 ? remotes.stdout.split("\n").filter(Boolean) : [];
        this.watch(root, cx);
        if (this.open && !files.some((f) => f.path === this.open)) { this.open = null; this.setLines([]); }
        // The first file's diff shows until you pick another.
        if (!this.open && !this.closed && files.length) this.open = files[0].path;
        if (this.open) {
          try { await this.load(this.open, context); }
          catch { if (key() === context) this.setLines(["Cannot preview this diff (too large or unreadable)"]); }
        }
      } catch (e) { if (key() === context) this.error = String(e); }
      finally {
        this.loading = false;
        if (fresh) this.autoFetch(cx);
        cx.notify();
      }
    });
  }

  async load(path, context) {
    const file = this.files.find((f) => f.path === path), root = this.root, on = this.on;
    if (!file) return;
    let lines;
    if (file.fresh || (!this.hasHead && file.status === "A")) {
      const text = await readTextFile(`${root}/${path}`, { on }).catch(() => null);
      if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
      else if (text.includes("\0")) lines = ["Binary file · no text diff"];
      else {
        file.add = countLines(text);
        lines = [`@@ -0,0 +1,${file.add} @@`, ...text.slice(0, 400000).replace(/\n$/, "").split("\n").slice(0, 1500).map(l => `+${l}`)];
      }
    } else {
      const r = await exec("git", [...READ, "diff", ...(this.hasHead ? ["HEAD"] : []), "--no-ext-diff", "--no-textconv", "--no-color", "--", path], { cwd: root, on });
      if (r.code !== 0) throw new Error(r.stderr);
      const all = r.stdout.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
      lines = first < 0 ? [file.binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
    }
    if (key() === context && this.open === path) this.setLines(lines.slice(0, 1500).map(line => line.length > 4000 ? line.slice(0, 4000) + "… (line truncated)" : line));
  }

  setLines(lines) {
    this.rows = diffRows(lines);
    this.diffWidth = Math.max(300, ...lines.map(line => line.length * 7 + 50));
  }

  pick(path, cx) {
    this.open = this.open === path ? null : path; this.setLines([]); this.note = null; this.armed = null;
    this.closed = !this.open;
    const context = this.context;
    if (this.open) cx.spawn(async (cx) => {
      try { await this.load(path, context); }
      catch (e) { if (key() === context && this.open === path) this.note = `Cannot preview this diff (too large or unreadable): ${e}`; }
      cx.notify();
    });
    cx.notify();
  }

  // Runs git steps in order for this repo; stops at the first failure and shows its message.
  // `label` shows while it runs; `done` is the quiet note after success.
  // `quiet` (background fetch) keeps whatever note is showing unless it fails.
  act(cx, label, steps, done, after, quiet) {
    if (!this.root || this.busy || this.context !== key()) return;
    const root = this.root, on = this.on, context = this.context;
    this.busy = label; this.armed = null;
    if (!quiet) this.note = null;
    cx.spawn(async (cx) => {
      try {
        for (const args of steps) {
          const r = await exec("git", args, { cwd: root, on });
          if (r.code !== 0) throw new Error(firstLine(r.stderr || r.stdout) || `git ${args[0]} failed (${r.code})`);
        }
        if (key() === context) { if (!quiet) this.note = done ? { ok: true, text: done } : null; after?.(); }
      } catch (e) { if (key() === context) this.note = { ok: false, text: `${label} failed: ${e.message ?? e}` }; }
      finally { this.busy = null; this.refresh(cx); cx.notify(); }
    });
    cx.notify();
  }

  pushSteps() {
    const b = this.branch;
    if (b?.upstream && !b.gone) return [["push"]];
    const remote = this.remotes.includes("origin") ? "origin" : this.remotes[0];
    return [["push", "-u", remote, "HEAD"]];
  }

  canPush() {
    const b = this.branch;
    return Boolean(this.hasHead && b && !b.detached && this.remotes.length && (!b.upstream || b.gone || b.ahead > 0));
  }

  fetch(cx, quiet) {
    if (!this.remotes.length) return;
    this.fetchedAt[this.context] = Date.now();
    this.act(cx, "Fetch", [["fetch", "--prune"]], "Fetched", null, quiet);
  }

  // On opening a repo, then every 5 minutes; never while something else runs.
  autoFetch(cx) {
    if (!this.root || this.busy || this.loading || !this.remotes.length || !this.branch?.upstream) return;
    if (Date.now() - (this.fetchedAt[this.context] ?? 0) < FETCH_EVERY) return;
    this.fetch(cx, true);
  }

  toggleStage(cx, file) {
    const steps = file.staged && !file.unstaged
      ? [this.hasHead ? ["reset", "-q", "--", file.path] : ["rm", "--cached", "-q", "--", file.path]]
      : [["add", "-A", "--", file.path]];
    this.act(cx, file.staged && !file.unstaged ? "Unstage" : "Stage", steps);
  }

  toggleAll(cx) {
    const all = this.files.length && this.files.every((f) => f.staged && !f.unstaged);
    this.act(cx, all ? "Unstage" : "Stage", [all ? (this.hasHead ? ["reset", "-q"] : ["rm", "-r", "--cached", "-q", "."]) : ["add", "-A"]]);
  }

  // First click arms, second (within 4 s) discards. New files are deleted.
  discard(cx, file) {
    if (this.armed !== file.path) {
      this.armed = file.path;
      cx.timer.after(4000, (cx) => { if (this.armed === file.path) { this.armed = null; cx.notify(); } });
      cx.notify();
      return;
    }
    const steps = file.fresh ? [["clean", "-f", "-q", "--", file.path]]
      : file.status === "A" ? [["rm", "-f", "-q", "--", file.path]]
      : [["restore", "--source=HEAD", "--staged", "--worktree", "--", file.path]];
    this.act(cx, "Discard", steps, `Discarded ${file.path.split("/").pop()}`);
  }

  canCommit() {
    if (!this.root || this.busy || this.loading) return false;
    if (this.amend) return this.hasHead;
    return Boolean(this.message.trim() && this.files.length);
  }

  commit(cx, push) {
    if (!this.canCommit() || this.context !== key()) return;
    const message = this.message.trim(), staged = this.files.some((f) => f.staged);
    const steps = [];
    if (!staged && this.files.length) steps.push(["add", "-A"]);
    steps.push(["commit", ...(this.amend ? ["--amend"] : []), ...(message ? ["-m", message] : ["--no-edit"])]);
    const clear = () => { this.message = ""; this.input.set_value(""); this.amend = false; };
    if (!push) return this.act(cx, this.amend ? "Amend" : "Commit", steps, this.amend ? "Amended" : "Committed", clear);
    if (!this.remotes.length) { this.note = { ok: false, text: "No remote to push to" }; return cx.notify(); }
    // An amended commit that was already pushed needs a force push: not done here.
    this.act(cx, "Commit & Push", [...steps, ...this.pushSteps()], "Committed and pushed", clear);
  }

  diffRow({ kind, number, text }, t) {
    if (kind === "@") return div().w_full().px(12).h(20).flex_none().truncate().bg(t.raised).text_color(t.dim).child(text);
    return h_flex().w_full().h(20).flex_none().gap(10).when(kind === "+", (e) => e.bg(t.ansi2 + "18")).when(kind === "-", (e) => e.bg(t.ansi1 + "18"))
      .child(div().w(30).flex_none().text_right().text_color(t.dim).child(number === undefined ? "" : String(number)))
      .child(div().flex_1().min_w(0).truncate().child(text));
  }

  // A staging box: full, partly (–) or empty.
  box(t, id, state, onClick) {
    return div().id(id).w(14).h(14).flex_none().flex().items_center().justify_center().rounded(3).border_1()
      .border_color(state ? t.accent : t.input).bg(state === "all" ? t.accent : t.background)
      .text_size(10).text_color(state === "all" ? t.accent_foreground : t.accent).cursor_pointer()
      .on_click((_e, cx) => { cx.stop_propagation(); onClick(cx); })
      .child(state === "all" ? "✓" : state === "some" ? "–" : "");
  }

  button(t, id, label, enabled, onClick, primary) {
    return div().id(id).h(26).px(9).flex().flex_none().items_center().rounded(6).text_size(11)
      .when(primary, (e) => e.bg(enabled ? t.solid : t.raised).text_color(enabled ? t.solid_foreground : t.dim))
      .when(!primary, (e) => e.border_1().border_color(t.border).text_color(enabled ? t.foreground : t.dim))
      .when(enabled, (e) => e.cursor_pointer().hover((s) => primary ? s.opacity(0.88) : s.bg(t.hover)).on_click((_e, cx) => onClick(cx)))
      .child(this.busy === label ? `${label}…` : label);
  }

  branchBar(t) {
    const b = this.branch, idle = !this.busy && !this.loading && Boolean(this.root);
    const remote = idle && this.remotes.length > 0 && Boolean(b) && !b.detached;
    const upstream = b?.upstream && !b.gone;
    return h_flex().h(38).flex_none().px(12).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().text_color(t.dim).text_size(12).child("⎇"))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_semibold().child(b?.name ?? "—"))
      .when(Boolean(upstream && b.ahead), (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`↑${b.ahead}`)))
      .when(Boolean(upstream && b.behind), (e) => e.child(div().text_size(11).text_color(t.blocked).child(`↓${b.behind}`)))
      .when(Boolean(b && !b.detached && this.remotes.length && !upstream), (e) => e.child(div().text_size(11).text_color(t.dim).child(b.gone ? "upstream gone" : "not pushed")))
      .child(this.button(t, "git-fetch", "Fetch", remote, (cx) => this.fetch(cx, false)))
      .child(this.button(t, "git-pull", "Pull", remote && Boolean(upstream), (cx) => this.act(cx, "Pull", [["pull", "--ff-only"]], "Pulled")))
      .child(this.button(t, "git-push", "Push", idle && this.canPush(), (cx) => this.act(cx, "Push", this.pushSteps(), "Pushed")));
  }

  render(cx) {
    if (key() !== this.context) this.refresh(cx);
    const t = theme(), add = this.files.reduce((n, f) => n + f.add, 0), del = this.files.reduce((n, f) => n + f.del, 0);
    const commitable = this.canCommit(), staged = this.files.filter((f) => f.staged).length;
    const allState = !this.files.length ? null : this.files.every((f) => f.staged && !f.unstaged) ? "all" : staged ? "some" : null;
    const discardable = (f) => !f.conflict && (this.hasHead || f.fresh);
    return v_flex().id("changes").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.typing) { this.typing = false; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(this.files.length > 0, (e) => e.child(this.box(t, "stage-all", allState, (cx) => this.toggleAll(cx))))
        .child(div().font_semibold().child("Changes"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(staged ? `${staged}/${this.files.length} staged` : `${this.files.length} files`))
        .child(div().flex_1()).child(div().text_size(11).text_color(t.ansi2).child(`+${add}`)).child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
      .when(Boolean(this.root), (e) => e.child(this.branchBar(t)))
      .child(v_flex().id("changes-list").flex_none().h(Math.min(200, Math.max(44, this.files.length * 28 + 12))).overflow_y_scrollbar().p(6).border_b(1).border_color(t.border).children(this.files.map((f) => {
        const parts = f.path.split("/"), name = parts.pop(), open = this.open === f.path, armed = this.armed === f.path;
        return h_flex().id(`change-${f.path}`).h(28).flex_none().px(8).gap(8).items_center().rounded(7).cursor_pointer().when(open, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.pick(f.path, cx))
          .child(this.box(t, `stage-${f.path}`, f.staged ? (f.unstaged ? "some" : "all") : null, (cx) => this.toggleStage(cx, f)))
          .child(div().w(12).text_size(11).text_color(f.status === "A" ? t.ansi2 : f.status === "D" ? t.ansi1 : f.status === "U" ? t.ansi1 : t.blocked).child(f.status))
          .child(h_flex().flex_1().min_w(0).child(div().text_color(t.dim).truncate().child(parts.length ? parts.join("/") + "/" : "")).child(div().max_w(260).min_w(0).truncate().child(name)))
          .when(f.add > 0 && !armed, (e) => e.child(div().text_size(11).text_color(t.ansi2).child(`+${f.add}`))).when(f.del > 0 && !armed, (e) => e.child(div().text_size(11).text_color(t.ansi1).child(`−${f.del}`)))
          .when(open && discardable(f), (e) => e.child(div().id(`discard-${f.path}`).px(5).h(20).flex().items_center().rounded(4).text_size(11)
            .text_color(armed ? t.solid_foreground : t.muted).when(armed, (e) => e.bg(t.ansi1))
            .hover((s) => s.text_color(armed ? t.solid_foreground : t.ansi1))
            .on_click((_e, cx) => { cx.stop_propagation(); this.discard(cx, f); })
            .child(armed ? (f.fresh || f.status === "A" ? "Delete file?" : "Discard?") : "↺")));
      })).when(!this.files.length, (e) => e.child(div().p(8).text_color(t.dim).child(this.error || (this.loading ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder")))))
      .when(this.limited, el => el.child(div().px(12).py(4).text_size(11).text_color(t.dim).child("Showing the first 1,000 changed files")))
      .child(div().flex_1().min_h(0).relative().font_family(settings().font_family ?? "JetBrains Mono").text_size(11)
        .child(div().id("changes-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full().child(v_virtual_list("changes-diff", this.rows.length, 20, (i) => String(i),
            (range) => this.rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
        .child(Scrollbar.vertical("changes-diff").viewport_from_layout().absolute().inset_0())
        .when(!this.open && this.files.length > 0, (e) => e.child(div().absolute().top(6).px(12).text_color(t.dim).child("Select a file to view its changes"))))
      .when(Boolean(this.note), (e) => e.child(div().px(12).pt(8).text_size(11).text_color(this.note.ok ? t.muted : t.ansi1).child(this.note.text)))
      .child(v_flex().flex_none().p(10).gap(8).border_t(1).border_color(t.border)
        .child(div().id("commit-message").w_full().h(32).px(10).flex().items_center().rounded(8).border_1().border_color(this.typing ? t.accent : t.border).cursor_text().on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))
        .child(h_flex().gap(8).items_center()
          .child(h_flex().id("amend").gap(6).items_center().text_size(11).text_color(this.hasHead ? t.muted : t.dim)
            .when(Boolean(this.hasHead), (e) => e.cursor_pointer().on_click((_e, cx) => { this.amend = !this.amend; cx.notify(); }))
            .child(this.box(t, "amend-box", this.amend ? "all" : null, (cx) => { if (this.hasHead) { this.amend = !this.amend; cx.notify(); } }))
            .child("Amend"))
          .child(div().flex_1())
          .child(this.button(t, "commit-push", "Commit & Push", commitable && this.remotes.length > 0 && !this.branch?.detached, (cx) => this.commit(cx, true)))
          .child(this.button(t, "commit", this.amend ? "Amend" : "Commit", commitable, (cx) => this.commit(cx, false), true))));
  }
}
