import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A pool fan-out (`fs.promises.cp`, recursive `fs.promises.readdir`, the
// shell's `rm -r`) is heap state shared by every pool thread working on it and
// kept alive by a count of the parties holding it (`subtask_count`). As soon
// as a thread's own decrement lands, whichever party drops the last count is
// free to finish the object and free it (the `rm` tree frees the directory
// task, and through the cascade up to the root the whole `ShellRmTask`, whose
// `path` the walk was borrowing). Under both aliasing models a reference
// passed as an argument is protected until its call returns, and freeing
// protected memory from another thread is UB whether or not the reference is
// used again (Tree Borrows, the model `bun run rust:miri` uses: "protected
// tags must never be Disabled"; Stacked Borrows: "deallocating while item is
// strongly protected"). So the decrement has to sit in a frame that holds the
// object by raw pointer, with the borrowing work done in callees that have
// returned first: `NewAsyncCpTask::on_subtask_done(this: *mut Self)` in
// src/runtime/node/node_fs.rs and `DirTask::{drop_own_count, post_run}` in
// src/runtime/shell/builtin/rm.rs are the shape.
//
// Banned: a function whose body decrements one of the COUNTS while taking a
// receiver, or any reference parameter, or no raw pointer at all. Every
// reference is banned, not just `&Self`: which objects the last drop frees is
// not something the parameter types say (`rm`'s drop frees two types), and a
// reference to caller-owned data is cheap to turn into a value or a pointer.
// A drop that is not inside any function (a module-level macro) is banned too,
// since it cannot be attributed to a frame.
//
// Scope: the text of the function containing the `<count>.fetch_sub(` call,
// macros defined inside it included. A drop delegated to a helper is checked
// at the helper, which is where the frame shape matters; the caller holding a
// reference while calling the helper is the bug self-receiver-fan-out.test.ts
// guards the known entry points against (#37861).
//
// Siblings: self-receiver-reclaim.test.ts (freeing the receiver),
// fn-long-mut-reborrow.test.ts, frozen-nonnull-reborrow.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(p => p.endsWith(".rs"));

// Only scan files tracked in HEAD (a `git stash` round-trip can leave stray
// `.rs` files in the working tree; CI runs on a clean checkout). Same guard as
// dead-code-escapes.test.ts.
const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

/** The fields whose last decrement frees the object they count for. */
const COUNTS = ["subtask_count"];

const DROP = new RegExp(String.raw`\b(?:${COUNTS.join("|")})\s*\.\s*fetch_sub\s*\(`, "g");

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape. Prefer converting over adding an entry here.
const ALLOW: Record<string, number> = {
  // The recursive readdir scan drops its counts from `perform_work(&mut self)`
  // and `write_results(&mut self)`. #37861 moves them into
  // `on_subtask_done(this: *mut Self)`; delete this entry when it lands.
  "src/runtime/node/node_fs.rs": 2,
};

/**
 * Blanks out comments, string literals and char literals (keeping their
 * length and newlines) so that the brace matching below only sees code.
 */
function neutralize(source: string): string {
  const re =
    // block comment | line comment | raw (byte) string | (byte) string | (byte) char
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|b?r(#*)"[\s\S]*?"\1|b?"(?:\\[\s\S]|[^"\\])*"|b?'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F_]+\}|[\s\S])|[^\\'\n])'/g;
  return source.replace(re, m => m.replace(/[^\n]/g, " "));
}

interface Fn {
  name: string;
  /** Offset of the `fn` keyword. */
  offset: number;
  params: string;
  bodyStart: number;
  bodyEnd: number;
}

/** Index just past the bracket matching the one at `open`, or -1. */
function matching(text: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === opener) depth++;
    else if (c === closer && --depth === 0) return i + 1;
  }
  return -1;
}

/** Every function with a body in (neutralized) `text`. */
function functions(text: string): Fn[] {
  const out: Fn[] = [];
  for (const m of text.matchAll(/\bfn\s+([A-Za-z_]\w*)\s*/g)) {
    let i = m.index + m[0].length;
    if (text[i] === "<") {
      // Generics: `>` closes a level except as the arrow of an `Fn() -> T` bound.
      let depth = 0;
      for (; i < text.length; i++) {
        const c = text[i];
        if (c === "<") depth++;
        else if (c === ">" && text[i - 1] !== "-" && --depth === 0) break;
      }
      i = text.indexOf("(", i);
      if (i === -1) continue;
    }
    if (text[i] !== "(") continue;
    const paramsEnd = matching(text, i, "(", ")");
    if (paramsEnd === -1) continue;
    const params = text.slice(i + 1, paramsEnd - 1);
    // The body's `{` is the first one after the return type / where clause;
    // a `;` at bracket depth 0 first means a bodiless declaration.
    let j = paramsEnd;
    let depth = 0;
    let bodyStart = -1;
    for (; j < text.length; j++) {
      const c = text[j];
      if (c === "(" || c === "[" || c === "<") depth++;
      else if (c === ")" || c === "]" || (c === ">" && text[j - 1] !== "-")) depth--;
      else if (depth <= 0 && c === ";") break;
      else if (depth <= 0 && c === "{") {
        bodyStart = j;
        break;
      }
    }
    if (bodyStart === -1) continue;
    const bodyEnd = matching(text, bodyStart, "{", "}");
    if (bodyEnd === -1) continue;
    out.push({ name: m[1]!, offset: m.index, params, bodyStart, bodyEnd });
  }
  return out;
}

// A receiver: `self`, `mut self`, `&self`, `&'a mut self`, `self: Box<Self>`.
const RECEIVER = /^\s*(?:&\s*(?:'\w+\s+)?(?:mut\s+)?)?(?:mut\s+)?self\b/;
const RAW_POINTER = /\*\s*(?:mut|const)\b|\bNonNull\s*</;

/** Why a drop frame with these parameters is banned, or null when it is the pointer shape. */
function bannedBecause(params: string): string | null {
  if (RECEIVER.test(params)) return "receiver";
  if (params.includes("&")) return "reference parameter";
  if (!RAW_POINTER.test(params)) return "no raw pointer";
  return null;
}

interface Offender {
  line: number;
  /** `fn name(params)`, or null for a drop outside every function. */
  frame: string | null;
  reason: string;
}

/** The count drops in `source` that do not sit in a pointer-holding frame. */
function dropOffenders(source: string): { drops: number; offenders: Offender[] } {
  const text = neutralize(source);
  const drops = [...text.matchAll(DROP)];
  if (drops.length === 0) return { drops: 0, offenders: [] };
  const fns = functions(text);
  const offenders: Offender[] = [];
  for (const drop of drops) {
    const at = drop.index;
    const line = text.slice(0, at).split("\n").length;
    // Innermost enclosing function: the containing body that starts last.
    let frame: Fn | undefined;
    for (const fn of fns) {
      if (fn.bodyStart < at && at < fn.bodyEnd && (!frame || fn.bodyStart > frame.bodyStart)) frame = fn;
    }
    if (!frame) {
      offenders.push({ line, frame: null, reason: "outside every function" });
      continue;
    }
    const reason = bannedBecause(frame.params);
    if (reason !== null) {
      const params = frame.params.replace(/\s+/g, " ").trim().replace(/,$/, "");
      offenders.push({ line, frame: `fn ${frame.name}(${params})`, reason });
    }
  }
  return { drops: drops.length, offenders };
}

const counts: Record<string, number> = {};
const reported: string[] = [];
let scanned = 0;
let dropsInTree = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const { drops, offenders } = dropOffenders(await file(abs).text());
  dropsInTree += drops;
  counts[source] = offenders.length;
  if (offenders.length > (ALLOW[source] ?? 0)) {
    for (const { line, frame, reason } of offenders)
      reported.push(`${source}:${line}: ${frame ?? "<no fn>"}: ${reason}`);
  }
}

test("scans a non-empty set of tracked Rust sources containing count drops", () => {
  // Guards against the tracked/realpath filters over-firing, and against the
  // COUNTS names going stale, either of which would make the ban below pass
  // vacuously.
  expect(scanned).toBeGreaterThan(0);
  expect(dropsInTree).toBeGreaterThan(0);
});

test("neutralize keeps offsets and line structure while blanking literals and comments", () => {
  const src = "let a = \"{\"; // {\nlet b = '{'; let c = b'}'; let d = r#\"}\"#; /* {\n{ */ let e: &'a T;";
  const out = neutralize(src);
  expect(out.length).toBe(src.length);
  expect(out.split("\n").length).toBe(src.split("\n").length);
  expect(out).not.toContain("{");
  expect(out).not.toContain("}");
  // Lifetimes are not char literals.
  expect(out).toContain("&'a T");
});

test("functions() finds bodies through generics, return types and nested items", () => {
  const src = neutralize(
    [
      "fn a<F: Fn() -> u8>(f: F) -> [u8; 4] { [0; 4] }",
      "fn b(x: &str);",
      "fn c(this: *mut Self) -> impl Fn() -> u8 {",
      '    fn inner(&self) { let s = "}"; }',
      "    || b'}' as u8",
      "}",
    ].join("\n"),
  );
  const fns = functions(src);
  expect(fns.map(f => f.name)).toEqual(["a", "c", "inner"]);
  const [a, c, inner] = fns as [Fn, Fn, Fn];
  expect(a.params).toBe("f: F");
  expect(src.slice(a.bodyStart, a.bodyEnd)).toBe("{ [0; 4] }");
  expect(c.params).toBe("this: *mut Self");
  expect(inner.params).toBe("&self");
  expect(c.bodyStart).toBeLessThan(inner.bodyStart);
  expect(inner.bodyEnd).toBeLessThan(c.bodyEnd);
});

test("the frame check bans receivers and references and requires a pointer", () => {
  const banned: [string, string][] = [
    // `ShellRmTask::remove_entry_dir` and `AsyncReaddirRecursiveTask::perform_work`, as they were.
    ["&self, dir_task: *mut DirTask, is_absolute: bool, buf: &mut PathBuffer", "receiver"],
    ["&mut self, basename: &ZStr", "receiver"],
    ["self: Box<Self>", "receiver"],
    ["mut self", "receiver"],
    ["&'a self", "receiver"],
    // A reference under another name is the same frame.
    ["this: &mut Self", "reference parameter"],
    ["this: &'a AsyncReaddirRecursiveTask", "reference parameter"],
    // A reference alongside the pointer still protects something.
    ["this: *mut Self, scan: &Self", "reference parameter"],
    ["this: *mut DirTask, buf: &mut PathBuffer", "reference parameter"],
    ["this: *mut Self, name: Option<&ZStr>", "reference parameter"],
    // Nothing to reach the object through.
    ["", "no raw pointer"],
    ["count: usize", "no raw pointer"],
    ["task: Box<DirTask>", "no raw pointer"],
  ];
  const allowed = [
    "this: *mut DirTask",
    "this: *mut Self, outcome: EntryOutcome",
    "this: *const Self",
    "this: NonNull<Self>, flag: bool",
    // rustfmt-wrapped.
    "\n        this: *mut DirTask,\n        outcome: EntryOutcome,\n    ",
    // A parameter whose name merely starts with `self`.
    "self_ptr: *mut Self",
  ];
  expect(banned.map(([p]) => bannedBecause(p))).toEqual(banned.map(([, why]) => why));
  expect(allowed.map(bannedBecause)).toEqual(allowed.map(() => null));
});

test("dropOffenders attributes each drop to its innermost function", () => {
  const impl = (body: string) => `impl DirTask {\n${body}\n}\n`;
  const flagged = (src: string) => dropOffenders(src).offenders.map(o => `${o.line}: ${o.frame}: ${o.reason}`);
  // The hand-off as it was in rm.rs: the decrement inside a `&self` walk.
  expect(
    flagged(
      impl(
        [
          "    fn remove_entry_dir(",
          "        &self,",
          "        dir_task: *mut DirTask,",
          "    ) -> bun_sys::Maybe<()> {",
          "        unsafe {",
          "            let dt = &*dir_task;",
          "            if dt.subtask_count.fetch_sub(1, Ordering::SeqCst) != 1 {",
          "                return Ok(());",
          "            }",
          "        }",
          "        Ok(())",
          "    }",
        ].join("\n"),
      ),
    ),
  ).toEqual(["8: fn remove_entry_dir(&self, dir_task: *mut DirTask): receiver"]);
  // A drop inside a macro defined in the function body belongs to that function.
  expect(
    flagged(
      impl(
        [
          "    fn perform_work(&mut self) {",
          "        macro_rules! impl_tag {",
          "            ($T:ty) => {{",
          "                if self.subtask_count.fetch_sub(1, Ordering::Relaxed) == 1 {}",
          "            }};",
          "        }",
          "    }",
        ].join("\n"),
      ),
    ),
  ).toEqual(["5: fn perform_work(&mut self): receiver"]);
  // A nested pointer-taking function inside a `&self` method is judged on its own parameters.
  expect(
    flagged(
      impl(
        [
          "    fn outer(&self) {",
          "        unsafe fn drop_count(this: *mut DirTask) {",
          "            unsafe { (*this).subtask_count.fetch_sub(1, Ordering::SeqCst) };",
          "        }",
          "    }",
        ].join("\n"),
      ),
    ),
  ).toEqual([]);
  // A drop outside every function cannot be attributed to a frame.
  expect(
    flagged("macro_rules! done {\n    ($t:expr) => { $t.subtask_count.fetch_sub(1, Ordering::SeqCst) };\n}\n"),
  ).toEqual(["2: null: outside every function"]);
  // Prose and strings do not count; neither do other operations on the count.
  const clean = impl(
    [
      "    /// Drops `subtask_count.fetch_sub(1)`'s worth of ownership.",
      "    fn enqueue(&self, parent: *mut DirTask) {",
      '        let _ = "subtask_count.fetch_sub(";',
      "        unsafe { (*parent).subtask_count.fetch_add(1, Ordering::Relaxed) };",
      "        self.other_count.fetch_sub(1, Ordering::Relaxed);",
      "    }",
      "    unsafe fn post_run(this: *mut DirTask) {",
      "        unsafe { (*this).subtask_count.fetch_sub(1, Ordering::SeqCst) };",
      "    }",
    ].join("\n"),
  );
  expect(dropOffenders(clean)).toEqual({ drops: 1, offenders: [] });
});

test("every count drop sits in a frame that holds its object by pointer", () => {
  expect(reported).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted instance is converted, delete its entry so
  // a new one cannot take its place.
  for (const [f, n] of Object.entries(ALLOW)) {
    expect(counts[f] ?? 0).toBe(n);
  }
});
