import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A pool fan-out (`fs.promises.cp`, recursive `fs.promises.readdir`) is one
// heap object shared by every pool thread working on it, kept alive by a count
// of those threads (`subtask_count`); whichever thread drops the last count
// finishes it and hands it to the JS thread, which frees it. Two shapes are
// banned around that:
//
//   - A subtask forming `&mut` to the shared object (`ParentRef::assume_mut`).
//     The object's thread and the sibling subtasks are touching it at the same
//     time; each `&mut` claims the whole object, and under both aliasing
//     models a write through any one of them (even to an atomic) invalidates
//     the others, so a directory with two subdirectories is already rejected
//     (Tree Borrows, the model `bun run rust:miri` uses: "reborrow through
//     <tag> is forbidden ... Disabled due to a foreign write access"). What a
//     subtask may hold is the `&Self` the `ParentRef` projects, with the
//     shared state interior-mutable (`Atomic*`, `Cell`, `Guarded`, the
//     lock-free queue).
//   - The frame that drops a count, and every frame under it on that thread,
//     taking the object by reference. A reference argument is protected until
//     its call returns, and once the decrement has landed another thread (or,
//     for the last count, the JS thread this frame itself posts to) reads and
//     frees the object through its own pointer: a foreign access to protected
//     memory, and a deallocation of it, are UB in both models whether or not
//     the reference is used again ("protected tags must never be Disabled" /
//     "deallocating while item is strongly protected"). These frames take
//     `this: *mut Self`, do their own work through borrows scoped to a
//     statement or to a helper that returns first, and make the decrement or
//     the hand-over their last access: `NewAsyncCpTask::on_subtask_done` and
//     `AsyncReaddirRecursiveTask::perform_work` / `on_subtask_done` in
//     src/runtime/node/node_fs.rs are the templates.
//
// Scope: `assume_mut()` inside the impl blocks of every `owned_task!` type
// (the pool-side half of each fan-out, found in the file that declares it),
// and the parameter lists of the count-dropping entry points listed in
// FAN_OUT, inside the impl blocks of their types. The work frames under those
// entry points (`cp_async_directory`, `scan_directory`,
// `readdir_with_entries_recursive_async`) hold the object as `&Self` / a
// `ParentRef` and return before the drop; they are not what this lint checks.
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

/** The fan-out objects and the functions on them that drop a count. */
const FAN_OUT: Record<string, string[]> = {
  // The scan-directory callback (drops its count through a scopeguard) and
  // the per-subtask drop.
  NewAsyncCpTask: ["cp_async", "on_subtask_done"],
  // One directory's walk plus the drop of the count held for it, and the
  // drop itself.
  AsyncReaddirRecursiveTask: ["perform_work", "on_subtask_done"],
};

// `bun_threading::owned_task!(Foo, task);` or
// `owned_task!([const N: bool] Foo<N>, task);` — the type being declared a
// pool task.
const OWNED_TASK = /\bowned_task!\s*\(\s*(?:\[[^\]]*\]\s*)?([A-Za-z_]\w*)/g;

const ASSUME_MUT = /\.assume_mut\s*\(/g;

/** `impl` blocks (inherent or trait) whose header names `typeName`, with the offset of their body. */
function implBlocks(stripped: string, typeName: string): { start: number; body: string }[] {
  // The header runs from `impl` to its `{`; a rustfmt-wrapped header (where
  // clause, trait on its own line) may span lines, so only `;` and `{` end it.
  // The block ends at the first `}` back on the `impl` line's indentation.
  const header = new RegExp(
    String.raw`^([ \t]*)(?:pub(?:\([^)]*\))?[ \t]+)?(?:unsafe[ \t]+)?impl\b[^{;]*\b${typeName}\b[^{;]*\{`,
    "gm",
  );
  const out: { start: number; body: string }[] = [];
  for (const m of stripped.matchAll(header)) {
    const start = m.index + m[0].length;
    const rest = stripped.slice(start);
    const end = rest.search(new RegExp(`^${m[1]}\\}`, "m"));
    out.push({ start, body: end === -1 ? rest : rest.slice(0, end) });
  }
  return out;
}

/** The parameter list of `fn <name>(`, as source text, for every definition in `body`. */
function fnParams(body: string, name: string): { offset: number; params: string }[] {
  const out: { offset: number; params: string }[] = [];
  for (const m of body.matchAll(new RegExp(String.raw`\bfn\s+${name}\s*(?:<[^>]*>\s*)?\(`, "g"))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const from = i;
    while (i < body.length && depth > 0) {
      const c = body[i];
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    }
    out.push({ offset: m.index, params: body.slice(from, i - 1) });
  }
  return out;
}

// A receiver (`self`, `mut self`, `&self`, `&'a mut self`, `self: Pin<..>`),
// or any parameter that is a reference to the object.
const RECEIVER = /(?:^|,)\s*(?:&\s*(?:'\w+\s+)?(?:mut\s+)?)?(?:mut\s+)?self\b/;
const REF_TO_SELF = /&\s*(?:'\w+\s+)?(?:mut\s+)?Self\b/;

/** Whether a count-dropping entry point on `typeName` holds its object the banned way. */
function dropsUnderReference(params: string, typeName: string): boolean {
  if (RECEIVER.test(params) || REF_TO_SELF.test(params)) return true;
  return !new RegExp(String.raw`\*mut\s+(?:Self|${typeName})\b`).test(params);
}

/** Offsets (into `stripped`) of `assume_mut()` calls inside the impl blocks of the file's `owned_task!` types. */
function subtaskOffenders(stripped: string): number[] {
  const out: number[] = [];
  const types = new Set([...stripped.matchAll(OWNED_TASK)].map(m => m[1]));
  for (const typeName of types) {
    for (const { start, body } of implBlocks(stripped, typeName)) {
      for (const m of body.matchAll(ASSUME_MUT)) out.push(start + m.index);
    }
  }
  return out;
}

/** For each FAN_OUT entry point defined in `stripped`: where, its params, and whether it is the banned shape. */
function fanOutEntries(
  stripped: string,
): { typeName: string; fn: string; offset: number; params: string; banned: boolean }[] {
  const out: { typeName: string; fn: string; offset: number; params: string; banned: boolean }[] = [];
  for (const [typeName, fns] of Object.entries(FAN_OUT)) {
    for (const { start, body } of implBlocks(stripped, typeName)) {
      for (const fn of fns) {
        for (const { offset, params } of fnParams(body, fn)) {
          out.push({ typeName, fn, offset: start + offset, params, banned: dropsUnderReference(params, typeName) });
        }
      }
    }
  }
  return out;
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

const offenders = { subtask: [] as string[], drop: [] as string[] };
const defined = new Set<string>();
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip full-line comments so prose mentions (including the in-tree comments
  // describing this hazard) don't count. `[ \t]*`, not `\s*`: `\s` crosses
  // newlines and would swallow blank lines, shifting the reported line numbers.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const offset of subtaskOffenders(stripped)) offenders.subtask.push(`${source}:${lineOf(stripped, offset)}`);
  for (const { typeName, fn, offset, params, banned } of fanOutEntries(stripped)) {
    defined.add(`${typeName}::${fn}`);
    if (banned) {
      offenders.drop.push(`${source}:${lineOf(stripped, offset)}: fn ${fn}(${params.replace(/\s+/g, " ").trim()})`);
    }
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the bans below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the subtask pattern matches assume_mut() in owned_task! types and nothing else", () => {
  const declared = (impl: string) =>
    `struct Sub {\n    parent: ParentRef<Parent, Mut>,\n    task: Task,\n}\n\nbun_threading::owned_task!(Sub, task);\n\n${impl}`;
  const banned = [
    // `ReaddirSubtask::run_owned` as it was.
    declared(
      "impl Sub {\n    fn run_owned(self: Box<Self>) {\n        unsafe { self.parent.assume_mut() }.perform_work();\n    }\n}\n",
    ),
    // Bound first, generic task.
    "bun_threading::owned_task!([const S: bool] Sub<S>, task);\n\nimpl<const S: bool> Sub<S> {\n    fn run_owned(self: Box<Self>) {\n        let p = unsafe { self.parent.assume_mut() };\n        p.done();\n    }\n}\n",
    // Any impl block of the type, indented inside a module.
    "    bun_threading::owned_task!(Sub, task);\n\n    impl Drop for Sub {\n        fn drop(&mut self) {\n            unsafe { self.parent.assume_mut() }.cancel();\n        }\n    }\n",
  ];
  const allowed = [
    // `CpSingleTask::run_owned`: shared projection, then the pointer for the drop.
    declared(
      "impl Sub {\n    fn run_owned(self: Box<Self>) {\n        let parent = self.parent;\n        parent.get().record(1);\n        drop(self);\n        Parent::on_subtask_done(parent.as_mut_ptr());\n    }\n}\n",
    ),
    // `assume_mut` somewhere else in the file, on a type that is not a pool task.
    declared(
      "impl Sub {\n    fn run_owned(self: Box<Self>) {}\n}\n\nimpl Owner {\n    fn tick(&self) {\n        unsafe { self.store.assume_mut() }.flush();\n    }\n}\n",
    ),
    // An impl block of the task type that has ended before the call.
    declared(
      "impl Sub {\n    fn run_owned(self: Box<Self>) {}\n}\n\nfn main_thread(p: ParentRef<Parent, Mut>) {\n    unsafe { p.assume_mut() }.finish();\n}\n",
    ),
    // Not a pool task at all.
    "struct Sub {\n    parent: ParentRef<Parent, Mut>,\n}\n\nimpl Sub {\n    fn run(self) {\n        unsafe { self.parent.assume_mut() }.step();\n    }\n}\n",
  ];
  expect(banned.map(s => subtaskOffenders(s).length)).toEqual(banned.map(() => 1));
  expect(allowed.map(s => subtaskOffenders(s).length)).toEqual(allowed.map(() => 0));
});

test("the drop pattern matches the banned parameter lists and nothing else", () => {
  const readdir = (params: string, kw = "fn") =>
    `    impl AsyncReaddirRecursiveTask {\n        ${kw} perform_work(\n            ${params}\n        ) {\n        }\n    }\n`;
  const banned = [
    // As it was.
    readdir("&mut self,\n            basename: &ZStr,\n            buf: &mut PathBuffer,\n            is_root: bool,"),
    readdir("&self, subdir: Option<&ZStr>"),
    readdir("self: Box<Self>"),
    readdir("mut self"),
    // A reference parameter under another name is the same frame.
    readdir("this: &mut Self, subdir: Option<&ZStr>"),
    readdir("this: &'a Self"),
    // A reference alongside the pointer still protects the object.
    readdir("this: *mut Self, scan: &Self", "unsafe fn"),
    // No pointer at all.
    readdir("subdir: Option<&ZStr>"),
    // `cp_async` with the task by reference behind its first parameter.
    "    impl<const IS_SHELL: bool> NewAsyncCpTask<IS_SHELL> {\n        pub(crate) fn cp_async(nodefs: &mut NodeFS, this: &mut Self) {}\n    }\n",
  ];
  const allowed = [
    // As it is.
    readdir("this: *mut Self, subdir: Option<&ZStr>", "unsafe fn"),
    readdir("this: *mut AsyncReaddirRecursiveTask, subdir: Option<&ZStr>", "unsafe fn"),
    // Other references are fine: they are not the object being dropped.
    "    impl<const IS_SHELL: bool> NewAsyncCpTask<IS_SHELL> {\n        pub(crate) fn cp_async(nodefs: &mut NodeFS, this: *mut Self) {}\n    }\n",
    "    impl<const IS_SHELL: bool> NewAsyncCpTask<IS_SHELL> {\n        fn on_subtask_done(this: *mut Self) {}\n    }\n",
    // A method of the same name on an unrelated type, and the work frames,
    // are out of scope.
    "impl Walker {\n    fn perform_work(&mut self) {}\n}\n",
    "    impl AsyncReaddirRecursiveTask {\n        fn scan_directory<T>(scan: ReaddirScanRef, subdir: Option<&ZStr>) {}\n        fn push_results<T>(&self, entries: Vec<T>) {}\n        fn finish_scan(&mut self) -> Completion<Self> {\n            self.done.take().unwrap()\n        }\n    }\n",
    // The impl block ended before a same-named free function.
    "    impl AsyncReaddirRecursiveTask {\n        fn create() {}\n    }\n\n    fn perform_work(scan: &mut AsyncReaddirRecursiveTask) {}\n",
  ];
  const bannedCount = (s: string) => fanOutEntries(s).filter(e => e.banned).length;
  expect(banned.map(bannedCount)).toEqual(banned.map(() => 1));
  expect(allowed.map(bannedCount)).toEqual(allowed.map(() => 0));
  // The allowed `as it is` spellings are seen as entry points, not skipped.
  expect(fanOutEntries(allowed[0]!).length).toBe(1);
  expect(fanOutEntries(allowed[allowed.length - 1]!).length).toBe(0);
});

test("no pool subtask forms &mut to the object it shares", () => {
  expect(offenders.subtask).toEqual([]);
});

test("every count-dropping entry point takes its object by pointer", () => {
  expect(offenders.drop).toEqual([]);
});

test("every FAN_OUT entry point still exists under that name", () => {
  // A rename would otherwise make the check above pass vacuously; move the
  // entry with the function.
  const expected = Object.entries(FAN_OUT).flatMap(([typeName, fns]) => fns.map(fn => `${typeName}::${fn}`));
  expect([...defined].sort()).toEqual(expected.sort());
});
