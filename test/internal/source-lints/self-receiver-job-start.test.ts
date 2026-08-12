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
// Scope: the first parameter of `fn run` inside a `JobContext` trait or impl
// block, the first parameter of `get_fd` / `get_fd_by_opening` inside the
// `FileOpener` trait block, and the spelling `fn(&mut Self, Fd)` of an open
// continuation anywhere. The steps below these entry points (`wait_for_*`,
// `on_finish`, `do_close`, the libuv completions) are guarded by their own
// conversions, not by this lint.
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

/** `fn <name>(` followed by its first parameter, for the given names. */
function fnWithFirstParam(names: string): RegExp {
  return new RegExp(String.raw`\bfn\s+(?:${names})\s*\(\s*([^,)]*)`, "g");
}

/** Offsets of every entry point in a trait/impl block (found by `header`) whose first parameter is not a pointer. */
function entryOffenders(stripped: string, header: RegExp, fns: string): number[] {
  const out: number[] = [];
  for (const h of stripped.matchAll(header)) {
    const item = itemBlock(stripped, h.index);
    if (item === null) continue;
    for (const f of item.block.matchAll(fnWithFirstParam(fns))) {
      if (!POINTER_PARAM.test(f[1].trim())) out.push(item.start + f.index);
    }
  }
  return out;
}

// `JobContext::run`: the declaration and every implementation.
const JOB_CONTEXT = /\btrait\s+JobContext\b|\bJobContext\s+for\b/g;
function jobRunOffenders(stripped: string): number[] {
  return entryOffenders(stripped, JOB_CONTEXT, "run");
}

// `FileOpener::get_fd` / `get_fd_by_opening`, the frames that invoke the continuation.
const FILE_OPENER = /\btrait\s+FileOpener\b/g;
function fileOpenerOffenders(stripped: string): number[] {
  return entryOffenders(stripped, FILE_OPENER, "get_fd|get_fd_by_opening");
}

// An open continuation typed as taking the task by reference, wherever it is
// spelled (the `get_fd` parameter, the Windows stash accessors, a field).
const OPEN_CONTINUATION_BY_REF = /\bfn\s*\(\s*&\s*(?:'\w+\s+)?mut\s+Self\s*,\s*Fd\s*\)/g;
function openContinuationOffenders(stripped: string): number[] {
  return [...stripped.matchAll(OPEN_CONTINUATION_BY_REF)].map(m => m.index);
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

const offenders = { jobRun: [] as string[], fileOpener: [] as string[], openContinuation: [] as string[] };
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
  for (const offset of jobRunOffenders(stripped)) offenders.jobRun.push(`${source}:${lineOf(stripped, offset)}`);
  for (const offset of fileOpenerOffenders(stripped)) {
    offenders.fileOpener.push(`${source}:${lineOf(stripped, offset)}`);
  }
  for (const offset of openContinuationOffenders(stripped)) {
    offenders.openContinuation.push(`${source}:${lineOf(stripped, offset)}`);
  }
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
    // An unrelated trait with a `run` taking a reference.
    "impl TaskContext for Foo {\n    fn run(&mut self) {}\n}\n",
  ];
  expect(banned.map(s => jobRunOffenders(s).length)).toEqual(banned.map(() => 1));
  expect(allowed.map(s => jobRunOffenders(s).length)).toEqual(allowed.map(() => 0));
});

test("the FileOpener patterns match the banned shapes and nothing else", () => {
  const opener = (body: string) => `pub trait FileOpener: Sized {\n    fn opened_fd(&self) -> Fd;\n${body}}\n`;
  const bannedEntries = [
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
  const allowedEntries = [
    opener("    unsafe fn get_fd(this: *mut Self, callback: OpenCallback<Self>) {}\n"),
    opener(
      "    #[cfg(not(windows))]\n    unsafe fn get_fd_by_opening(this: *mut Self, callback: OpenCallback<Self>) {}\n",
    ),
    // The accessors the entry points use may take `self`: they return before the hand-over.
    opener(
      "    fn set_opened_fd(&mut self, fd: Fd);\n    fn open_pathlike(&mut self) -> Fd {\n        Fd::INVALID\n    }\n",
    ),
    // A `get_fd` outside the trait block (the sinks have one) is something else.
    "impl Sink {\n    fn get_fd(&self) -> i32 {\n        self.fd\n    }\n}\n",
    opener("") + "\nimpl Reader {\n    fn get_fd(&self) -> Fd {\n        self.fd\n    }\n}\n",
  ];
  expect(bannedEntries.map(s => fileOpenerOffenders(s).length)).toEqual(bannedEntries.map(() => 1));
  expect(allowedEntries.map(s => fileOpenerOffenders(s).length)).toEqual(allowedEntries.map(() => 0));

  const bannedContinuations = [
    "fn get_fd(&mut self, callback: fn(&mut Self, Fd)) {",
    "fn set_open_callback(&mut self, cb: fn(&mut Self, Fd));",
    "fn open_callback(&self) -> fn(&mut Self, Fd);",
    "open_callback: fn(&mut Self, Fd),",
    "open_callback: fn(&'a mut Self, Fd),",
    "cb: fn( &mut Self , Fd ),",
  ];
  const allowedContinuations = [
    "pub type OpenCallback<T> = unsafe fn(this: *mut T, fd: Fd);",
    "open_callback: OpenCallback<Self>,",
    "cb: unsafe fn(*mut Self, Fd),",
    // A predicate over the receiver, not a continuation that takes it over.
    "validate: fn(&mut Self, usize) -> bool,",
    "fn(&mut Self)",
  ];
  expect(bannedContinuations.map(s => openContinuationOffenders(s).length)).toEqual(bannedContinuations.map(() => 1));
  expect(allowedContinuations.map(s => openContinuationOffenders(s).length)).toEqual(allowedContinuations.map(() => 0));
});

test("every JobContext::run takes the off-thread part by pointer", () => {
  expect(offenders.jobRun).toEqual([]);
});

test("FileOpener's entry points take the task by pointer", () => {
  expect(offenders.fileOpener).toEqual([]);
});

test("no open continuation takes the task by reference", () => {
  expect(offenders.openContinuation).toEqual([]);
});
