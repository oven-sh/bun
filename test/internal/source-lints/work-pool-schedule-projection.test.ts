import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The task handed to `WorkPool::schedule` must be projected from a raw pointer
// to the object that embeds it, never through a reference:
//
//   WorkPool::schedule(&raw mut self.task);        // `self: &mut Self`
//   WorkPool::schedule(&raw mut this.task);        // `this` a `&mut T` local
//   WorkPool::schedule(&raw mut raw.task);         // `raw` a leaked `&mut T`
//   bun_jsc::WorkPool::schedule(this.task());      // accessor returning `&mut Task`
//
// are banned; the accepted spelling is the one `WorkPool::schedule_owned`
// (src/threading/work_pool.rs) and the tree's other schedulers use:
//
//   WorkPool::schedule(&raw mut (*this).task);
//
// where `this: *mut T` is the pointer the caller already held (the io action's
// ctx, the timer's container, the hive slot, the box just released).
//
// The pool calls back with exactly the pointer it was given, and the callback
// (`IntrusiveWorkTask::from_task_ptr`, `from_field_ptr!`) recovers the whole
// object from it and then reads and writes the object's other fields through
// the result. `from_task_ptr` and `bun_core::container_of` document that this
// needs a pointer whose provenance covers the whole object ("a `&mut field`
// reborrow does not suffice"). A projection taken through a reference does not
// reliably give one: an accessor's `&mut Task` covers the field by definition,
// and under Stacked Borrows so does `&raw mut self.task` (Miri: the callback's
// write to a sibling field is "using <tag> ... created by a SharedReadWrite
// retag at offsets [<the task field>]"). The raw projection `&raw mut
// (*p).task` keeps `p`'s provenance and is accepted by Stacked and Tree
// Borrows alike. Tree Borrows, which is what `bun run rust:miri` runs, accepts
// the banned spellings too, and none of the crates involved are in its crate
// set, so nothing but this lint reports a regression; keeping the argument a
// raw projection also means no `&mut` to the object is a live function
// argument (`noalias`, `dereferenceable`) while a pool thread may already be
// running it. `ReadFile::on_ready` / `on_io_error`, `WriteFile::on_ready` /
// `on_io_error`, the close round trip in `impl_file_closer!`,
// `StatWatcherScheduler::timer_callback`, `TranspilerJob::schedule` and
// `AsyncCpTask::schedule_new` were the instances this was written for; the
// converted versions are the templates.
//
// Scope: the argument of a call spelled `..WorkPool::schedule(..)`, when it is
// a field path through a binding (`&raw mut x.f`, `&mut x.f`, `addr_of_mut!(
// x.f)`, `ptr::from_mut(&mut x.f)`) or one of the tree's reference-returning
// task accessors (`x.task()`, `x.task_mut()`, `x.field_mut()`). A raw pointer
// projected through `(*p).f`, a local holding the projected pointer, and
// `schedule_owned` / `schedule_new` are the intended shapes. Whether the
// pointer the function was handed is itself whole-object is that function's
// caller's business (the io thread's `FileAction.poll: &mut Poll` and
// `Request` hand-offs narrow one level up; tracked separately). The same
// defect in other spellings is outside this lint and tracked separately:
// tasks that go into `Batch::from(..)` (bundler, install, http), and
// `IoRequestLoop::schedule(&mut self.io_request)`, the io-thread twin of this
// hand-over; #37772 adds a sibling lint for method calls in the argument, such
// as the zlib binding's `x.task().as_ptr()`. Siblings: self-receiver-reclaim.
// test.ts, self-receiver-publish.test.ts, self-receiver-intrusive-post.test.ts.

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

// `WorkPool::schedule(`, however the path in front of `WorkPool` is spelled
// (`bun_jsc::`, `bun_threading::work_pool::`, bare). `schedule_owned` and
// `schedule_new` have a different name and do not match. `\s*` after the paren
// so a rustfmt-wrapped argument still matches; the argument may be wrapped in
// an `unsafe { .. }` block.
const CALL = String.raw`\bWorkPool::schedule\(\s*(?:unsafe\s*\{\s*)?`;
const END = String.raw`\s*\}?\s*[,)]`;

// `x.f`, `x.a.f`: a field path whose base is a binding. A raw pointer projects
// as `(*x).f`, which starts with `(` and so never matches.
const FIELD_PATH = String.raw`\w+(?:\.\w+)+`;

const BANNED_ARGS = [
  String.raw`&raw\s+mut\s+${FIELD_PATH}`,
  String.raw`&mut\s+${FIELD_PATH}`,
  String.raw`(?:[\w:]+::)?addr_of_mut!\s*\(\s*${FIELD_PATH}\s*\)`,
  String.raw`(?:[\w:]+::)?from_mut(?:::<[^>]*>)?\(\s*&mut\s+${FIELD_PATH}\s*\)`,
  // The tree's accessors that return `&mut Task`: `FileCloser::task` (as it
  // was), `IntrusiveWorkTask::task_mut`, `IntrusiveField::field_mut`. A
  // trailing `.as_ptr()` or similar does not reach the closing paren, so a
  // helper returning a raw pointer is not matched.
  String.raw`\w+(?:\.\w+)*\.(?:task|task_mut|field_mut)\(\s*\)`,
].join("|");

const BANNED = new RegExp(`${CALL}(?:${BANNED_ARGS})${END}`, "g");

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape. Prefer converting over adding an entry here.
const ALLOW: Record<string, number> = {
  // `napi_async_work::schedule(&mut self)` is being converted separately
  // (#37750, together with the rest of that type's receivers); delete this
  // entry when that lands.
  "src/runtime/napi/napi_body.rs": 1,
};

const counts: Record<string, number> = {};
const offenders: string[] = [];
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
  for (const m of stripped.matchAll(BANNED)) {
    const line = stripped.slice(0, m.index).split("\n").length;
    counts[source] = (counts[source] ?? 0) + 1;
    if ((counts[source] ?? 0) > (ALLOW[source] ?? 0)) {
      offenders.push(`${source}:${line}: ${m[0].replace(/\s+/g, " ")}`);
    }
  }
}

function matches(snippet: string): boolean {
  BANNED.lastIndex = 0;
  return BANNED.test(snippet);
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the pattern recognizes the spellings it claims to", () => {
  const banned = [
    // The instances this was written for, as they were.
    "WorkPool::schedule(&raw mut self.task);",
    "WorkPool::schedule(&raw mut this.task);",
    "WorkPool::schedule(&raw mut raw.task);",
    "WorkPool::schedule(&raw mut self.work_task);",
    "bun_jsc::WorkPool::schedule(this.task());",
    // Other paths to the pool, and other spellings of the projection.
    "bun_threading::work_pool::WorkPool::schedule(&raw mut self.task);",
    "WorkPool::schedule(&raw mut self.inner.task);",
    "WorkPool::schedule(&mut self.task);",
    "WorkPool::schedule(addr_of_mut!(self.task));",
    "WorkPool::schedule(core::ptr::addr_of_mut!(this.task));",
    "WorkPool::schedule(ptr::from_mut(&mut self.task));",
    "WorkPool::schedule(std::ptr::from_mut::<WorkPoolTask>(&mut self.task));",
    "WorkPool::schedule(self.task_mut());",
    "WorkPool::schedule(self.field_mut());",
    "WorkPool::schedule(this.inner.task());",
    "WorkPool::schedule(unsafe { &raw mut this.task });",
    // rustfmt-wrapped.
    "WorkPool::schedule(\n    &raw mut self.task,\n);",
    "bun_jsc::WorkPool::schedule(\n    this.task(),\n);",
  ];
  const allowed = [
    // The converted shapes: projected from the object's raw pointer.
    "WorkPool::schedule(&raw mut (*this).task);",
    "WorkPool::schedule(&raw mut (*this).work_task);",
    "WorkPool::schedule(unsafe { &raw mut (*job).task });",
    "WorkPool::schedule(&raw mut (*st).task);",
    "bun_threading::work_pool::WorkPool::schedule(&raw mut (*subtask).work_task);",
    "::bun_jsc::WorkPool::schedule(&raw mut (*this).task);",
    "WorkPool::schedule(unsafe {\n    &raw mut (*raw).task\n});",
    // A local already holding the projected pointer, and the typed schedulers.
    "WorkPool::schedule(task);",
    "Self::schedule(unsafe { T::field_of(raw) });",
    "WorkPool::schedule_owned(task);",
    "WorkPool::schedule_new(ReaddirSubtask { .. });",
    // Out of scope (see the header): a helper that returns a raw pointer, the
    // batch and io-loop spellings.
    "WorkPool::schedule(this.task().as_ptr());",
    "batch.push(Batch::from(&raw mut self.task));",
    "io::IoRequestLoop::schedule(&mut self.io_request);",
    // A pointer the object owns is not a projection through it.
    "WorkPool::schedule(self.task_ptr);",
    "WorkPool::schedule(&raw mut *self.task);",
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("no WorkPool::schedule call projects the task through a reference", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted instance is converted, delete its entry so
  // a new one cannot take its place.
  for (const [f, n] of Object.entries(ALLOW)) {
    expect({ file: f, count: counts[f] ?? 0 }).toEqual({ file: f, count: n });
  }
});
