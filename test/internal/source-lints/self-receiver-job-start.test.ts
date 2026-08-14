import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The two entry points through which a pool job reaches the code that hands
// it to another thread must take the object by pointer, not by reference:
//
//   - `JobContext::run` (src/jsc/job.rs), the trait declaration and every
//     `impl .. JobContext for ..`: its first parameter is the job's off-thread
//     part. `Job::run_on_pool` calls it; a body that keeps the `Completion`
//     (ReadFile, WriteFile, the recursive readdir scan) publishes the object to
//     the io thread or to further pool tasks, or finishes the token so the JS
//     thread frees it, before it returns.
//   - `FileOpener::get_fd` / `get_fd_by_opening` (src/runtime/webcore/Blob.rs)
//     and the continuation they invoke, `OpenCallback<T>`: the continuation
//     takes the task over and ends the same way (ReadFile / WriteFile hand it
//     to the io thread, ReadFileUV frees it), so neither the continuation's
//     own parameter nor the `get_fd` frame invoking it may be a reference.
//
// A reference passed as an argument is protected until the call returns, under
// both aliasing models (Tree Borrows is what `bun run rust:miri` uses). Once
// the object has been handed on, the thread that finishes it reads and frees
// the job through the job's own pointer (`Job::complete`), which is foreign to
// every reference still protected on the publishing thread's stack, and
// `ReadFileUV` frees itself outright; a foreign access to a protected
// reference's memory, and any deallocation of it, is UB whether or not the
// reference is used again. Every frame between `run_on_pool` and the hand-over
// used to add one such reference (`C::run(&mut (*job).off, ..)` ->
// `ReadFile::run(&mut self)` -> `get_fd(&mut self, ..)` -> `callback(self, fd)`
// -> `run_async_with_fd(&mut self)`), and the JS thread only has to get to the
// completion before this thread has returned through them, which for a read
// that finishes in its first step (an empty file, an open error) is the normal
// case. The converted chain carries `*mut`, does its own work through reborrows
// scoped to a statement or to a `&mut self` helper that returns before the
// hand-over (`prepare_read` / `prepare_write`), and makes the hand-over its
// last access; `ReadFile::run_async` and `FileOpener::get_fd` are the templates.
//
// Scope, four checks:
//   1. the first parameter of `fn run` inside a `JobContext` trait or impl block;
//   2. the first parameter of `get_fd` / `get_fd_by_opening` inside the
//      `FileOpener` trait block;
//   3. the definition of `OpenCallback<T>`, which has to read
//      `unsafe fn(*mut T, Fd)`: every continuation (`run_async_with_fd`,
//      `run_with_fd`, `ReadFileUV::on_file_open`) is passed as a fn item where
//      this alias is expected, so its signature is what holds theirs to `*mut`;
//   4. as a net under 3, a continuation type spelled out as `fn(&mut X, Fd)`
//      anywhere (the pre-conversion spelling, in whatever parameter syntax).
// Each anchored check also records what it examined and asserts it found the
// declarations it is about, so renaming `run` / `JobContext` / `FileOpener` /
// `OpenCallback` fails here (update the lint) instead of emptying it.
//
// Not covered: the steps below these entry points. For ReadFile / WriteFile
// those are `wait_for_*`, `on_finish`, `do_close` and the loops; for the
// recursive readdir scan they are `perform_work` and everything under it, which
// still take `&mut self` and perform the hand-over inside that borrow, so for
// that job only the entry frame is converted. Those conversions carry their own
// guards.
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

/** One check's findings in one piece of source: byte offsets of what it examined and of what it rejects. */
interface Scan {
  checked: { offset: number; name: string }[];
  offenders: number[];
}

// The line an `impl` / `trait` item starts on. A rustfmt-wrapped header puts
// the trait name a line or two below this, so the block's indentation is read
// from here, and the block ends at the first `}` back on that indentation.
const ITEM_START = /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(?:unsafe[ \t]+)?(?:impl|trait)\b/gm;

/** The text of the trait / impl block whose header contains `headerIndex`, and where it starts. */
function itemBlock(stripped: string, headerIndex: number): { start: number; block: string } | null {
  const lineEnd = stripped.indexOf("\n", headerIndex);
  const upToHeaderLine = stripped.slice(0, lineEnd === -1 ? stripped.length : lineEnd);
  let item: RegExpExecArray | null = null;
  for (const m of upToHeaderLine.matchAll(ITEM_START)) item = m;
  if (item === null) return null;
  const indent = /^[ \t]*/.exec(item[0])![0];
  const rest = stripped.slice(headerIndex);
  const end = rest.search(new RegExp(`^${indent}\\}`, "m"));
  return { start: headerIndex, block: end === -1 ? rest : rest.slice(0, end) };
}

// A first parameter that is a raw pointer: `this: *mut Self`, `off: *mut
// Self::OffThread`, `ctx: *mut C`, `_: *mut ()`. Anything else (a `&mut self`
// receiver, `this: &mut Self`, `ctx: &mut C`) is the banned shape.
const POINTER_PARAM = /^(?:mut\s+)?\w+\s*:\s*\*mut\b/;

/** `fn <name>(` (name restricted to `names`) followed by its first parameter. */
function fnWithFirstParam(names: string): RegExp {
  return new RegExp(String.raw`\bfn\s+(${names})\s*\(\s*([^,)]*)`, "g");
}

/** Checks 1 and 2: the named fns inside every block introduced by `header`. */
function scanEntries(stripped: string, header: RegExp, fns: string): Scan {
  const scan: Scan = { checked: [], offenders: [] };
  for (const h of stripped.matchAll(header)) {
    const item = itemBlock(stripped, h.index);
    if (item === null) continue;
    for (const f of item.block.matchAll(fnWithFirstParam(fns))) {
      const offset = item.start + f.index;
      scan.checked.push({ offset, name: f[1] });
      if (!POINTER_PARAM.test(f[2].trim())) scan.offenders.push(offset);
    }
  }
  return scan;
}

// 1. `JobContext::run`: the declaration and every implementation.
const JOB_CONTEXT = /\btrait\s+JobContext\b|\bJobContext\s+for\b/g;
function scanJobRun(stripped: string): Scan {
  return scanEntries(stripped, JOB_CONTEXT, "run");
}

// 2. `FileOpener::get_fd` / `get_fd_by_opening`, the frames that invoke the continuation.
const FILE_OPENER = /\btrait\s+FileOpener\b/g;
function scanFileOpener(stripped: string): Scan {
  return scanEntries(stripped, FILE_OPENER, "get_fd|get_fd_by_opening");
}

// 3. The alias itself. `[^;]*` spans a rustfmt-wrapped right-hand side.
const OPEN_CALLBACK_DEF = /\btype\s+OpenCallback\s*<[^>]*>\s*=\s*([^;]*);/g;
const POINTER_FN_TYPE = /^unsafe\s+fn\s*\(\s*(?:\w+\s*:\s*)?\*mut\b/;
function scanOpenCallbackDef(stripped: string): Scan {
  const scan: Scan = { checked: [], offenders: [] };
  for (const m of stripped.matchAll(OPEN_CALLBACK_DEF)) {
    scan.checked.push({ offset: m.index, name: "OpenCallback" });
    if (!POINTER_FN_TYPE.test(m[1].trim())) scan.offenders.push(m.index);
  }
  return scan;
}

// 4. A continuation type taking the task by reference, with or without
// parameter names and however `Fd` is qualified: `fn(&mut Self, Fd)`,
// `fn(this: &mut T, fd: bun_sys::Fd)`.
const OPEN_CONTINUATION_BY_REF =
  /\bfn\s*\(\s*(?:\w+\s*:\s*)?&\s*(?:'\w+\s+)?mut\s+\w+\s*,\s*(?:\w+\s*:\s*)?(?:[\w:]+::)?Fd\s*\)/g;
function openContinuationOffenders(stripped: string): number[] {
  return [...stripped.matchAll(OPEN_CONTINUATION_BY_REF)].map(m => m.index);
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

const found = { jobRun: [] as string[], fileOpener: [] as string[], openCallbackDef: [] as string[] };
const offenders = {
  jobRun: [] as string[],
  fileOpener: [] as string[],
  openCallbackDef: [] as string[],
  openContinuation: [] as string[],
};
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
  const at = (offset: number) => `${source}:${lineOf(stripped, offset)}`;
  for (const [check, scan] of [
    ["jobRun", scanJobRun(stripped)],
    ["fileOpener", scanFileOpener(stripped)],
    ["openCallbackDef", scanOpenCallbackDef(stripped)],
  ] as const) {
    for (const c of scan.checked) found[check].push(check === "fileOpener" ? `${source} ${c.name}` : at(c.offset));
    for (const offset of scan.offenders) offenders[check].push(at(offset));
  }
  for (const offset of openContinuationOffenders(stripped)) offenders.openContinuation.push(at(offset));
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the bans below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the JobContext::run pattern matches the banned shapes and nothing else", () => {
  const impl = (params: string, fn = "fn") =>
    `impl bun_jsc::JobContext for Foo {\n    type OffThread = Self;\n    type Js = ();\n    ${fn} run(\n        ${params}\n        done: Completion<Self>,\n    ) -> Option<Completion<Self>> {\n        Some(done)\n    }\n}\n`;
  const banned = [
    // The declaration and the implementations as they were.
    "pub trait JobContext: Sized + 'static {\n    type OffThread: Send;\n    fn run(\n        off: &mut Self::OffThread,\n        vm: &Borrow,\n    ) -> Option<Completion<Self>>;\n}\n",
    impl("this: &mut Self,\n        _vm: &Borrow,"),
    "impl<C: TaskContext> bun_jsc::JobContext for AsyncTask<C> {\n    type OffThread = C;\n    fn run(ctx: &mut C, _vm: &Borrow, done: Completion<Self>) -> Option<Completion<Self>> {\n        Some(done)\n    }\n}\n",
    // `Never`.
    "impl JobContext for Never {\n    fn run(_: &mut (), _: &Borrow, done: Completion<Self>) -> Option<Completion<Self>> {\n        Some(done)\n    }\n}\n",
    // A rustfmt-wrapped header with a where clause (`AsyncFSTask`): the block
    // is bounded by the `impl` line's indentation, not the header line's.
    "    impl<R: FsReturn, A: FsArgument, const F: NodeFSFunctionEnum>\n        bun_jsc::JobContext for AsyncFSTask<R, A, F>\n    where\n        Op<{ F }>: NodeFSDispatch<R, A>,\n    {\n        type OffThread = Self;\n        fn run(\n            this: &mut Self,\n            _vm: &Borrow,\n        ) -> Option<Completion<Self>> {\n            Some(done)\n        }\n    }\n",
    // A pointer that is not the first parameter does not help.
    impl("this: &mut Self,\n        extra: *mut u8,", "unsafe fn"),
  ];
  const allowed = [
    // The converted shapes.
    "pub trait JobContext: Sized + 'static {\n    type OffThread: Send;\n    unsafe fn run(\n        off: *mut Self::OffThread,\n        vm: &Borrow,\n    ) -> Option<Completion<Self>>;\n}\n",
    impl("this: *mut Self,\n        _vm: &Borrow,", "unsafe fn"),
    "impl<C: TaskContext> bun_jsc::JobContext for AsyncTask<C> {\n    unsafe fn run(ctx: *mut C, _vm: &Borrow, done: Completion<Self>) -> Option<Completion<Self>> {\n        Some(done)\n    }\n}\n",
    "impl JobContext for Never {\n    unsafe fn run(_: *mut (), _: &Borrow, done: Completion<Self>) -> Option<Completion<Self>> {\n        Some(done)\n    }\n}\n",
    // The `&mut self` helper the implementation delegates to lives outside the
    // impl block, before or after it, and is not what this lint is about.
    "impl Foo {\n    fn run(&mut self) {}\n}\n\n" + impl("this: *mut Self,\n        _vm: &Borrow,", "unsafe fn"),
    impl("this: *mut Self,\n        _vm: &Borrow,", "unsafe fn") + "\nimpl Foo {\n    fn run(&mut self) {}\n}\n",
  ];
  expect(banned.map(s => scanJobRun(s).offenders.length)).toEqual(banned.map(() => 1));
  expect(allowed.map(s => scanJobRun(s).offenders.length)).toEqual(allowed.map(() => 0));
  // Every fixture above contains exactly one `run` this check is about, and
  // an unrelated trait's `run` is not examined at all.
  expect([...banned, ...allowed].map(s => scanJobRun(s).checked.length)).toEqual([...banned, ...allowed].map(() => 1));
  expect(scanJobRun("impl TaskContext for Foo {\n    fn run(&mut self) {}\n}\n")).toEqual({
    checked: [],
    offenders: [],
  });
});

test("the FileOpener entry-point pattern matches the banned shapes and nothing else", () => {
  const opener = (body: string) => `pub trait FileOpener: Sized {\n    fn opened_fd(&self) -> Fd;\n${body}}\n`;
  const banned = [
    // `get_fd` / `get_fd_by_opening` as they were.
    opener(
      "    fn get_fd(&mut self, callback: fn(&mut Self, Fd)) {\n        callback(self, self.opened_fd());\n    }\n",
    ),
    opener("    fn get_fd_by_opening(&mut self, callback: fn(&mut Self, Fd)) {}\n"),
    // A pointer-typed continuation invoked from a frame that still holds a reference.
    opener(
      "    unsafe fn get_fd(&mut self, callback: OpenCallback<Self>) {\n        unsafe { callback(self, fd) }\n    }\n",
    ),
    opener("    unsafe fn get_fd(this: &mut Self, callback: OpenCallback<Self>) {}\n"),
  ];
  const allowed = [
    opener("    unsafe fn get_fd(this: *mut Self, callback: OpenCallback<Self>) {}\n"),
    opener(
      "    #[cfg(not(windows))]\n    unsafe fn get_fd_by_opening(this: *mut Self, callback: OpenCallback<Self>) {}\n",
    ),
  ];
  expect(banned.map(s => scanFileOpener(s).offenders.length)).toEqual(banned.map(() => 1));
  expect(allowed.map(s => scanFileOpener(s).offenders.length)).toEqual(allowed.map(() => 0));
  expect([...banned, ...allowed].map(s => scanFileOpener(s).checked.length)).toEqual(
    [...banned, ...allowed].map(() => 1),
  );
  // The accessors the entry points call may take `self` (they return before
  // the hand-over), and a `get_fd` outside the trait block (the sinks have
  // one) is something else: neither is examined.
  const notExamined = [
    opener(
      "    fn set_opened_fd(&mut self, fd: Fd);\n    fn open_pathlike(&mut self) -> Fd {\n        Fd::INVALID\n    }\n",
    ),
    "impl Sink {\n    fn get_fd(&self) -> i32 {\n        self.fd\n    }\n}\n",
    opener("") + "\nimpl Reader {\n    fn get_fd(&self) -> Fd {\n        self.fd\n    }\n}\n",
  ];
  expect(notExamined.map(s => scanFileOpener(s))).toEqual(notExamined.map(() => ({ checked: [], offenders: [] })));
});

test("the OpenCallback patterns match the banned shapes and nothing else", () => {
  const bannedDefs = [
    // The alias pointed back at the old continuation shape, in any spelling.
    "pub type OpenCallback<T> = fn(&mut T, Fd);",
    "pub type OpenCallback<T> = unsafe fn(this: &mut T, fd: Fd);",
    "pub type OpenCallback<T> =\n    unsafe fn(this: &mut T, fd: bun_sys::Fd);",
    // A safe fn over the pointer: callers could then pass anything.
    "pub type OpenCallback<T> = fn(*mut T, Fd);",
  ];
  const allowedDefs = [
    "pub type OpenCallback<T> = unsafe fn(this: *mut T, fd: Fd);",
    "pub(crate) type OpenCallback<T> = unsafe fn(*mut T, Fd);",
    "pub type OpenCallback<T> =\n    unsafe fn(this: *mut T, fd: bun_sys::Fd);",
  ];
  expect(bannedDefs.map(s => scanOpenCallbackDef(s).offenders.length)).toEqual(bannedDefs.map(() => 1));
  expect(allowedDefs.map(s => scanOpenCallbackDef(s).offenders.length)).toEqual(allowedDefs.map(() => 0));
  expect([...bannedDefs, ...allowedDefs].map(s => scanOpenCallbackDef(s).checked.length)).toEqual(
    [...bannedDefs, ...allowedDefs].map(() => 1),
  );
  // Uses of the alias, and other callback aliases, are not definitions of it.
  const notDefs = [
    "open_callback: OpenCallback<Self>,",
    "pub type RequestCallback = unsafe fn(*mut Request) -> Action;",
  ];
  expect(notDefs.map(s => scanOpenCallbackDef(s))).toEqual(notDefs.map(() => ({ checked: [], offenders: [] })));

  const bannedSpellings = [
    "fn get_fd(&mut self, callback: fn(&mut Self, Fd)) {",
    "fn set_open_callback(&mut self, cb: fn(&mut Self, Fd));",
    "fn open_callback(&self) -> fn(&mut Self, Fd);",
    "open_callback: fn(&mut Self, Fd),",
    "open_callback: fn(&'a mut Self, Fd),",
    "cb: fn( &mut Self , Fd ),",
    // Named parameters, a concrete task type, a qualified `Fd`.
    "= unsafe fn(this: &mut T, fd: Fd);",
    "open_callback: fn(&mut ReadFileUV, Fd),",
    "cb: fn(&mut Self, bun_sys::Fd),",
  ];
  const allowedSpellings = [
    "pub type OpenCallback<T> = unsafe fn(this: *mut T, fd: Fd);",
    "open_callback: OpenCallback<Self>,",
    "cb: unsafe fn(*mut Self, Fd),",
    // A predicate over the receiver, not a continuation that takes it over.
    "validate: fn(&mut Self, usize) -> bool,",
    "fn(&mut Self)",
    // A function item is not a fn-pointer type.
    "fn run_with_fd(&mut self, fd: Fd) {",
  ];
  expect(bannedSpellings.map(s => openContinuationOffenders(s).length)).toEqual(bannedSpellings.map(() => 1));
  expect(allowedSpellings.map(s => openContinuationOffenders(s).length)).toEqual(allowedSpellings.map(() => 0));
});

test("the anchored checks still find the declarations they are about", () => {
  // If one of these goes empty or changes shape, the trait / alias was renamed
  // or moved and the anchors above need updating, not the bans below.
  expect(found.jobRun.some(entry => entry.startsWith("src/jsc/job.rs:"))).toBeTrue();
  expect(found.jobRun.length).toBeGreaterThanOrEqual(10);
  expect(found.fileOpener.toSorted()).toEqual([
    "src/runtime/webcore/Blob.rs get_fd",
    "src/runtime/webcore/Blob.rs get_fd_by_opening",
  ]);
  expect(found.openCallbackDef).toHaveLength(1);
});

test("every JobContext::run takes the off-thread part by pointer", () => {
  expect(offenders.jobRun).toEqual([]);
});

test("FileOpener's entry points take the task by pointer", () => {
  expect(offenders.fileOpener).toEqual([]);
});

test("OpenCallback is an unsafe fn over the task's pointer", () => {
  expect(offenders.openCallbackDef).toEqual([]);
});

test("no continuation type takes the task by reference", () => {
  expect(offenders.openContinuation).toEqual([]);
});
