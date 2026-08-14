import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `S3HttpDownloadStreamingTask` (src/runtime/webcore/s3/download_stream.rs) is
// one heap object used by two threads at once for its whole life: the HTTP
// thread records each chunk into it under the task's `mutex`, and the JS thread
// reports the chunks from `on_response` under the same mutex and frees the task
// once it has read `has_more == false`. Two consequences for how its code may
// be written, both enforced here:
//
// 1. No `&mut self` methods on the task: that receiver is banned in
//    `impl S3HttpDownloadStreamingTask`. A reference argument is protected for
//    the duration of the call under Rust's aliasing models (Tree Borrows, which
//    `bun run rust:miri` uses, and Stacked Borrows), and a `&mut` one claims the
//    whole object, atomics and mutex word included. The other thread writes
//    those words whenever it tries to take the lock (and `on_stream_cancelled`
//    writes `signal_store` from inside the chunk callback), and Miri reports the
//    first such write during the call as UB ("this foreign write access would
//    cause the protected tag to become Disabled"). On the HTTP thread the same
//    `&mut self` would additionally still be protected when the final unlock
//    lets the JS thread free the task. So every function that runs while both
//    threads are live takes `this: *mut Self` and forms references one field or
//    one call at a time; `&self` helpers (`get_state`, `set_state`) are fine
//    because a shared reference leaves the interior-mutable words to the other
//    thread and the remaining fields are only written by whoever holds the lock.
//    `Drop` runs after the HTTP thread is done, so it is outside the impl block
//    this applies to.
//
// 2. The mutex is left through `Mutex::unlock_raw`, never through a guard or a
//    receiver: `.mutex.lock_guard()` in any spelling and `self.mutex.lock()` /
//    `unlock()` / `try_lock()` are banned in src/runtime/webcore/s3/. On the final
//    chunk the HTTP thread's unlock is what frees the task when a task is already
//    queued (the JS thread is blocked in `on_response`'s `lock()` and frees the
//    task as soon as it gets in), so the releasing store has to be the HTTP
//    thread's last access to the task: `MutexGuard::drop` unlocks through a
//    `&Mutex` into the task (and `Mutex::lock_guard` documents that the mutex
//    must outlive the guard), and a section entered through `self.mutex` sits in
//    a method whose receiver is live across the release. The shape both
//    HTTP-thread sections use (`process_http_callback`, `release_at_shutdown`):
//
//      (*this).mutex.lock();
//      ...
//      Mutex::unlock_raw(&raw const (*this).mutex);
//
// Before the conversion this reported `report_progress`, `update_state`,
// `process_http_callback` and `release_portable` for (1) and the two
// `lock_guard()` sections, `process_http_callback` and `release_at_shutdown`,
// for (2).
//
// Not covered: an HTTP-thread section ending in `(*this).mutex.unlock()` is the
// same bug as (2) spelled differently and cannot be told apart by regex from
// `on_response`, whose `unlock()` runs on the JS thread ahead of that thread's
// own free; convert it on sight. Sibling guards for other spellings of "the
// callee outlives, or frees, what a reference argument covers":
// self-receiver-reclaim.test.ts, unsound-erased-box.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const SCOPE = "src/runtime/webcore/s3/";
const TASK_FILE = `${SCOPE}download_stream.rs`;
const TASK_IMPL_HEADER = "impl S3HttpDownloadStreamingTask {";
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

// (1): a `&mut self` receiver, in either rustfmt layout (`fn f(&mut self, ..)`
// or `fn f(\n    &mut self,\n`).
const MUT_SELF_RECEIVER = /\bfn\s+(\w+)\s*(?:<[^>]*>)?\s*\(\s*&\s*(?:'\w+\s+)?mut\s+self\b/g;

// (2): the two spellings of a critical section that is not the raw shape.
const BANNED_MUTEX_USE = new RegExp(
  [
    // `<anything>.mutex.lock_guard(..)`: `self.mutex`, `(*this).mutex`, `task.mutex`,
    // including rustfmt's one-segment-per-line wrapping of the chain.
    String.raw`\.\s*mutex\s*\.\s*lock_guard\s*\(`,
    // Entering or leaving the section through the receiver.
    String.raw`\bself\s*\.\s*mutex\s*\.\s*(?:try_)?(?:un)?lock\s*\(`,
  ].join("|"),
  "g",
);

// What keeps the bans from passing vacuously: the task file still has its
// inherent impl block, still has a `bun_threading::Mutex` field called `mutex`
// (a rename would otherwise blind the regexes above) and still locks it.
const MUTEX_FIELD = /\bmutex\s*:\s*(?:[\w:]+::)?Mutex\b/g;
const LOCK = /\.\s*mutex\s*\.\s*lock\s*\(/g;

// Strip full-line comments so the comments describing this hazard don't
// count. `[ \t]*`, not `\s*`: `\s` crosses newlines and would swallow blank
// lines, shifting the reported line numbers.
function stripComments(source: string): string {
  return source.replace(/^[ \t]*\/\/.*$/gm, "");
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

// The inherent impl block: from its header to the next `}` at column 0
// (rustfmt closes every item there), as [start, end) offsets into `stripped`.
function taskImplRange(stripped: string): [number, number] | null {
  const start = stripped.indexOf(TASK_IMPL_HEADER);
  if (start < 0) return null;
  const end = stripped.indexOf("\n}", start);
  return end < 0 ? null : [start, end];
}

function mutSelfMethods(stripped: string, range: [number, number]): string[] {
  const hits: string[] = [];
  for (const m of stripped.matchAll(MUT_SELF_RECEIVER)) {
    const at = m.index ?? 0;
    if (at >= range[0] && at < range[1]) hits.push(`${TASK_FILE}:${lineOf(stripped, at)}: ${m[1]}`);
  }
  return hits;
}

const receiverOffenders: string[] = [];
const mutexOffenders: string[] = [];
const scanned: string[] = [];
let taskImplFound = false;
let mutexFields = 0;
let locks = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (!source.startsWith(SCOPE)) continue;
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned.push(source);
  const stripped = stripComments(await file(abs).text());
  mutexFields += [...stripped.matchAll(MUTEX_FIELD)].length;
  locks += [...stripped.matchAll(LOCK)].length;
  for (const m of stripped.matchAll(BANNED_MUTEX_USE)) {
    mutexOffenders.push(`${source}:${lineOf(stripped, m.index ?? 0)}: ${m[0].replace(/\s+/g, " ")}`);
  }
  if (source === TASK_FILE) {
    const range = taskImplRange(stripped);
    if (range !== null) {
      taskImplFound = true;
      receiverOffenders.push(...mutSelfMethods(stripped, range));
    }
  }
}

function matchesMutexBan(snippet: string): boolean {
  BANNED_MUTEX_USE.lastIndex = 0;
  return BANNED_MUTEX_USE.test(snippet);
}

test("scans the task it is about", () => {
  expect(scanned).toContain(TASK_FILE);
  expect(taskImplFound).toBe(true);
  expect(mutexFields).toBeGreaterThan(0);
  expect(locks).toBeGreaterThan(0);
});

test("the receiver pattern sees `&mut self` methods inside the impl block only", () => {
  const sample = stripComments(
    [
      "impl State {",
      "    fn set_has_more(&mut self, v: bool) {}",
      "}",
      "",
      TASK_IMPL_HEADER,
      "    pub(crate) fn get_state(&self) -> State { todo!() }",
      "    // `report_progress`, as it was.",
      "    fn report_progress(&mut self, state: State) {}",
      "    fn update_state(",
      "        &mut self,",
      "        state: &mut State,",
      "    ) -> bool { todo!() }",
      "    fn with_lifetime<'a>(&'a mut self) {}",
      "    unsafe fn process_http_callback(this: *mut Self) -> bool { todo!() }",
      "    fn takes_another(&mut other: &mut u32) {}",
      "}",
      "",
      "impl Drop for S3HttpDownloadStreamingTask {",
      "    fn drop(&mut self) {}",
      "}",
    ].join("\n"),
  );
  const range = taskImplRange(sample);
  expect(range).not.toBeNull();
  expect(mutSelfMethods(sample, range!).map(hit => hit.split(": ")[1])).toEqual([
    "report_progress",
    "update_state",
    "with_lifetime",
  ]);
});

test("the mutex pattern recognizes the spellings it claims to", () => {
  const banned = [
    // `process_http_callback(&mut self, ..)`, as it was.
    "let _guard = self.mutex.lock_guard();",
    // `release_at_shutdown`, as it was.
    "let _guard = (*this).mutex.lock_guard();",
    "let guard = task.mutex.lock_guard();",
    "drop(self.mutex.lock_guard());",
    "self.mutex.lock();",
    "self.mutex.unlock();",
    "if self.mutex.try_lock() {",
    // rustfmt-wrapped chains.
    "let _guard = (*this)\n    .mutex\n    .lock_guard();",
    "self\n    .mutex\n    .unlock();",
  ];
  const allowed = [
    // The required shape.
    "(*this).mutex.lock();",
    "Mutex::unlock_raw(&raw const (*this).mutex);",
    "bun_threading::Mutex::unlock_raw(&raw const (*this).mutex);",
    // `on_response` (JS thread; this thread frees the task itself, after the unlock).
    "unsafe { (*this).mutex.lock() };",
    "(*this_ptr).mutex.unlock();",
    // A debug assertion neither enters nor leaves the section.
    "debug_assert!(self.mutex.is_held_by_current_thread());",
    // Declaring and initialising the field.
    "pub(crate) mutex: Mutex,",
    "mutex: Default::default(),",
    // Guards on some other object's lock (`.mutex` is the field this lint is about).
    "let _guard = self.queued_writes_lock.lock_guard();",
    "let _guard = other.state_mutex.lock_guard();",
  ];
  expect(banned.filter(s => !matchesMutexBan(s))).toEqual([]);
  expect(allowed.filter(matchesMutexBan)).toEqual([]);
});

test("the streaming task has no `&mut self` methods", () => {
  expect(receiverOffenders).toEqual([]);
});

test("S3 task mutexes are taken through the raw pointer and never held by a guard", () => {
  expect(mutexOffenders).toEqual([]);
});
