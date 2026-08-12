import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The `*mut Task` handed to `WorkPool::schedule` must be projected out of a
// pointer to the object that embeds the task, never out of a reference to the
// task field itself:
//
//   WorkPool::schedule(this.task().as_ptr());      // accessor returns &JsCell<Task>
//   WorkPool::schedule(this.task());               // accessor returns &mut Task
//   WorkPool::schedule(&mut self.task);            // coerces to *mut Task
//
// are banned; `&raw mut (*p).task`, `&raw mut self.task` and `T::field_of(p)`
// (`bun_core::IntrusiveField`, given the object's pointer) are the shapes to
// use.
//
// The pool calls back with exactly the pointer it was given, and every
// trampoline behind these sites `container_of`s it back to the embedding
// object and then uses the rest of the object through the result (see
// `bun_core::container_of`'s contract: "a `&mut field` reborrow does not
// suffice"). A reference to a field carries provenance for that field only, so
// a pointer taken through one (`&JsCell<Task>` -> `.as_ptr()`, `&mut Task`
// coerced to `*mut Task`) stops at the field's bounds: the sibling fields the
// callback reads and writes, and the allocation the completion may free, are
// outside it. Stacked Borrows rejects every out-of-range access; Tree Borrows
// (what `bun run rust:miri` uses) rejects the writes and the free. A raw
// projection from the object's pointer (`&raw mut (*p).task`, which is what
// `IntrusiveField::field_of` computes) keeps `p`'s provenance; that is what
// `WorkPool::schedule_owned` does (src/threading/work_pool.rs) and what
// `CompressionStream::write` in src/runtime/node/node_zlib_binding.rs, the
// instance this was written for, does now.
//
// Scope: the argument expression at the `WorkPool::schedule(` call. Every
// method call in that position goes through a reference (an accessor returns
// one, a cell's `.as_ptr()` auto-refs the field), so any method call is
// banned, whether it is the whole argument (`x.task()`), the tail of one
// (`T::task(x).as_ptr()`) or an operand (`JsCell::as_ptr(x.task())`), and so
// is a call nested in a call (`JsCell::as_ptr(T::task(x))`); the shapes that
// pass are place projections and one associated fn applied to a raw pointer or
// a local, and what that fn does inside is not checked (the tree's is
// `field_of`, whose body is the trait's). Not covered: a pointer
// projected the wrong way somewhere else and passed in through a local, and
// tasks that go into a `Batch::from(..)` and are scheduled later. This lint is
// about the range of the pointer the pool gets; `&raw mut self.task` has the
// whole object's range and passes here, and the separate problem with it (the
// `&mut self` it is taken through stays protected while the pool thread is
// already running) is the subject of work-pool-schedule-projection.test.ts
// (#37768). Siblings: self-receiver-reclaim.test.ts,
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

// `WorkPool::schedule(`, however the path is qualified. `schedule_owned` /
// `schedule_new` take the object itself and do the projection internally, so
// they do not match.
const SCHEDULE = /\bWorkPool::schedule\s*\(/g;

// A method call anywhere in the argument (`this.task()`, `self.task.as_ptr()`,
// `(*this).task.as_ptr()`, `self.task_mut()`, `JsCell::as_ptr(this.task())`).
// Field paths without a call (`&raw mut (*p).task`) and associated-fn calls
// (`T::field_of(p)`) have no `.name(` and do not match.
const METHOD_CALL = /\.\w+(?:::<[^>]*>)?\s*\(/;
// A call whose argument is itself a call (`JsCell::as_ptr(T::task(this))`):
// whatever the inner call returned is what gets projected, and an associated
// fn is only in the clear when it is applied to a raw pointer or a local.
// `addr_of_mut!((*p).task)` has `!(` in front of its parens and does not match.
const NESTED_CALL = /\w\s*\([^()]*\w\s*\(/;
// A reference formed anywhere in the argument: `&mut self.task` coercing to
// `*mut Task`, `from_mut(&mut self.task)`, `JsCell::as_ptr(&self.task)`.
// `&raw mut` / `&raw const` are the raw projections this lint asks for.
const REFERENCE = /&(?!\s*raw\b)/;

/** The argument text of the call whose opening paren is at `open`, or null if unbalanced. */
function argumentAt(source: string, open: number): string | null {
  for (let depth = 0, i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      if (--depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

function normalize(argument: string): string {
  let arg = argument.replace(/\s+/g, " ").trim().replace(/,$/, "").trim();
  const unsafeBlock = /^unsafe\s*\{(.*)\}$/.exec(arg);
  if (unsafeBlock) arg = unsafeBlock[1].trim();
  return arg;
}

function isBanned(argument: string): boolean {
  const arg = normalize(argument);
  return METHOD_CALL.test(arg) || NESTED_CALL.test(arg) || REFERENCE.test(arg);
}

/** Byte offsets (into `stripped`) of every banned schedule call in one file. */
function findBannedSchedules(stripped: string): number[] {
  const hits: number[] = [];
  for (const m of stripped.matchAll(SCHEDULE)) {
    const argument = argumentAt(stripped, m.index + m[0].length - 1);
    if (argument !== null && isBanned(argument)) hits.push(m.index);
  }
  return hits;
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape. Prefer converting over adding an entry here.
const ALLOW: Record<string, number> = {
  // `FileCloser::on_io_request_closed` schedules `this.task()`, the trait's
  // `&mut Task` accessor. #37768 converts it together with the `&mut self`
  // schedule sites; delete this entry when that lands.
  "src/runtime/webcore/Blob.rs": 1,
};

const counts: Record<string, number> = {};
const offenders: string[] = [];
let scanned = 0;
let scheduleSites = 0;
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
  scheduleSites += [...stripped.matchAll(SCHEDULE)].length;
  for (const offset of findBannedSchedules(stripped)) {
    counts[source] = (counts[source] ?? 0) + 1;
    if (counts[source] > (ALLOW[source] ?? 0)) {
      offenders.push(`${source}:${lineOf(stripped, offset)}`);
    }
  }
}

test("scans a non-empty set of tracked Rust sources containing schedule calls", () => {
  // Guards against the tracked/realpath filters (or the call pattern) failing
  // to match anything, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
  expect(scheduleSites).toBeGreaterThan(0);
});

test("the classifier recognizes the spellings it claims to", () => {
  const banned = [
    // `CompressionStream::write` as it was: `task()` returns
    // `&JsCell<WorkPoolTask>`.
    "this.task().as_ptr()",
    // `FileCloser::on_io_request_closed`: `task()` returns `&mut WorkPoolTask`.
    "this.task()",
    "self.task.as_ptr()",
    "(*this).task.as_ptr()",
    "self.task_mut()",
    // The same accessors in other positions.
    "JsCell::as_ptr(this.task())",
    "JsCell::as_ptr(T::task(this))",
    "T::task(this).as_ptr()",
    "<T as CompressionStreamImpl>::task(this).as_ptr()",
    "this.task().as_ptr().cast::<WorkPoolTask>()",
    "&mut self.task",
    "&mut (*this).task",
    "&self.task as *const _ as *mut _",
    "ptr::from_mut(&mut self.task)",
    "core::ptr::from_ref(&self.task).cast_mut()",
    "JsCell::as_ptr(&self.task)",
    // rustfmt-wrapped.
    "\n            this.task().as_ptr(),\n        ",
    "unsafe { this.task_cell().as_ptr() }",
  ];
  const allowed = [
    // The shapes in the tree.
    "&raw mut self.task",
    "&raw mut this.task",
    "&raw mut raw.task",
    "&raw mut (*st).task",
    "&raw mut (*subtask).work_task",
    "unsafe { &raw mut (*job).task }",
    "unsafe { T::field_of(this_ptr) }",
    "unsafe { T::field_of(raw) }",
    "core::ptr::addr_of_mut!((*this).task)",
    // A pointer projected elsewhere is out of scope.
    "task",
    "task_ptr",
    // rustfmt-wrapped.
    "unsafe {\n                &raw mut (*this).task\n            }",
    "\n            &raw mut (*this).task,\n        ",
  ];
  expect(banned.filter(s => !isBanned(s))).toEqual([]);
  expect(allowed.filter(s => isBanned(s))).toEqual([]);
});

test("the call matcher finds the call and takes its whole argument", () => {
  const source = [
    "fn a(this: &T) {",
    "    WorkPool::schedule(this.task().as_ptr());",
    "    bun_jsc::WorkPool::schedule(",
    "        this.task(),",
    "    );",
    "    WorkPool::schedule(unsafe { &raw mut (*this).task });",
    "    WorkPool::schedule_owned(task);",
    "    WorkPool::get().schedule(batch);",
    "}",
  ].join("\n");
  expect(findBannedSchedules(source).map(offset => lineOf(source, offset))).toEqual([2, 3]);
});

test("no schedule call projects the task out of a reference to the field", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted instance is converted, delete its entry so
  // a new one cannot take its place.
  for (const [f, n] of Object.entries(ALLOW)) {
    expect(counts[f] ?? 0).toBe(n);
  }
});
