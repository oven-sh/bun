import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The `*mut Task` a `Batch::from(..)` hands to the thread pool must be
// projected out of a pointer to the object that embeds the task, never out of
// a reference to the task field itself:
//
//   Batch::from(ptr::from_mut((*task).task()))   // accessor returns &mut Task
//   Batch::from(this.task())
//   Batch::from(&mut self.task)                   // coerces to *mut Task
//
// are banned; `&raw mut (*p).task`, `addr_of_mut!((*p).task)`, `&raw mut
// self.task`, `T::field_of(p)` (an associated fn given the object's pointer)
// and a local are the shapes to use.
//
// The pool calls back with exactly the pointer it was given, and the
// trampolines behind these sites (`from_task_ptr`, `from_field_ptr!`)
// container-of it back to the embedding object and then use the rest of the
// object through the result, often ending in `heap::take`. A reference to a
// field carries provenance for that field only, so a pointer taken through one
// stops at the field's bounds: the sibling fields the callback reads and
// writes, and the allocation it frees, are outside it (`bun_core::container_of`
// spells this out: "a `&mut field` reborrow does not suffice"). Stacked
// Borrows rejects every out-of-range access; Tree Borrows (what `bun run
// rust:miri` uses) rejects the writes and the free. A raw projection from the
// object's own pointer keeps that pointer's provenance, which is what
// `WorkPool::schedule_owned` (src/threading/work_pool.rs) does and what
// `NewTaskQueue::push` in src/install/PackageInstall.rs, the instance this was
// written for, does now via `IntrusiveField::field_of`.
//
// Scope: the argument expression of every `Batch::from(` call, which is the
// one way a task enters a `ThreadPool` batch (`.schedule(Batch::from(..))`,
// `batch.push(Batch::from(..))`, `HTTPThread::schedule(Batch::from(..))`). A
// pointer projected the wrong way somewhere else and passed in through a local
// is the same bug and is not caught here. This lint is about the range of the
// pointer the pool gets; `&raw mut self.task` has the whole object's range and
// passes. `WorkPool::schedule(..)`, the other hand-over, takes a `*mut Task`
// directly and is the subject of the same rule in #37772. Siblings:
// self-receiver-reclaim.test.ts, fn-long-mut-reborrow.test.ts,
// frozen-nonnull-reborrow.test.ts.

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

// `Batch::from(`, however the type is reached: `thread_pool::Batch::from(`,
// `ThreadPoolLib::Batch::from(`, and the `use .. Batch as PoolBatch` /
// `ThreadPoolBatch` aliases in the tree.
const BATCH_FROM = /\b\w*Batch::from\s*\(/g;

// A method-call chain rooted at a receiver (`(*task).task()`, `this.task()`,
// `self.task.as_ptr()`, `self.task_mut()`): an accessor auto-refs the field or
// returns a reference to it, so the pointer that comes out covers the field
// only. Associated-fn calls (`T::field_of(p)`) are not rooted at a receiver and
// do not match.
const METHOD_CHAIN = /^(?:[\w:]+|\(\s*\*\s*[\w.]+\s*\))(?:\.\w+)*(?:\.\w+\s*\([^()]*\)\s*)+$/;
// A reference formed anywhere in the argument: `&mut self.task` coercing to
// `*mut Task`, `from_mut(&mut self.task)`. `&raw mut` / `&raw const` are the
// raw projections this lint asks for.
const REFERENCE = /&(?!\s*raw\b)/;
// The reference-to-pointer conversions, for when the reference comes out of an
// accessor and is never spelled with `&` (the shape this lint was written for).
const FROM_REF = /\bfrom_(?:mut|ref)\b/;

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
  return METHOD_CHAIN.test(arg) || REFERENCE.test(arg) || FROM_REF.test(arg);
}

/** Byte offsets (into `stripped`) of every banned `Batch::from` call in one file. */
function findBannedBatches(stripped: string): number[] {
  const hits: number[] = [];
  for (const m of stripped.matchAll(BATCH_FROM)) {
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
const ALLOW: Record<string, number> = {};

const counts: Record<string, number> = {};
const offenders: string[] = [];
let scanned = 0;
let batchSites = 0;
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
  batchSites += [...stripped.matchAll(BATCH_FROM)].length;
  for (const offset of findBannedBatches(stripped)) {
    counts[source] = (counts[source] ?? 0) + 1;
    if (counts[source] > (ALLOW[source] ?? 0)) {
      offenders.push(`${source}:${lineOf(stripped, offset)}`);
    }
  }
}

test("scans a non-empty set of tracked Rust sources containing Batch::from calls", () => {
  // Guards against the tracked/realpath filters (or the call pattern) failing
  // to match anything, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
  expect(batchSites).toBeGreaterThan(0);
});

test("the classifier recognizes the spellings it claims to", () => {
  const banned = [
    // `NewTaskQueue::push` before `field_of`: `HasWorkPoolTask::task()`
    // returned `&mut WorkPoolTask`.
    "unsafe { std::ptr::from_mut::<WorkPoolTask>((*task).task()) }",
    "unsafe {\n            std::ptr::from_mut::<WorkPoolTask>((*task).task())\n        }",
    "(*task).task()",
    "this.task()",
    "self.task_mut()",
    "self.task.as_ptr()",
    "(*this).task.as_ptr()",
    "&mut self.task",
    "&mut (*task).task",
    "&self.task as *const _ as *mut _",
    "ptr::from_mut(&mut self.task)",
    "core::ptr::from_ref(&self.task).cast_mut()",
    "unsafe { ptr::from_mut((*task).task_mut()) }",
    // rustfmt-wrapped.
    "\n            &mut task.task,\n        ",
  ];
  const allowed = [
    // The shapes in the tree.
    "unsafe { TaskType::field_of(task) }",
    "unsafe { core::ptr::addr_of_mut!((*task).task) }",
    "unsafe {\n                        core::ptr::addr_of_mut!((*task).task)\n                    }",
    "core::ptr::addr_of_mut!(\n                            (*this.parse_task.as_ptr()).task\n                        )",
    "ptr::addr_of_mut!(runner_task.task)",
    "core::ptr::addr_of_mut!(async_http.task)",
    "core::ptr::addr_of_mut!(self.task)",
    "&raw mut task.task",
    "&raw mut self.task",
    "&raw mut (*parse_task).task",
    "&raw mut (*parse_task).io_task",
    "&raw mut line_offset.thread_task",
    "\n                                &raw mut combined_part_ranges.last_mut().unwrap().task,\n                            ",
    // A pointer projected elsewhere is out of scope.
    "task",
    "queued",
  ];
  expect(banned.filter(s => !isBanned(s))).toEqual([]);
  expect(allowed.filter(s => isBanned(s))).toEqual([]);
});

test("the call matcher finds every spelling of the call and takes its whole argument", () => {
  const source = [
    "unsafe fn push(&self, task: *mut TaskType) {",
    "    self.thread_pool.schedule(Batch::from(unsafe {",
    "        std::ptr::from_mut::<WorkPoolTask>((*task).task())",
    "    }));",
    "    batch.push(ThreadPoolLib::Batch::from(&mut task.task));",
    "    let batch = PoolBatch::from(",
    "        this.task(),",
    "    );",
    "    manager.task_batch.push(ThreadPoolBatch::from(queued));",
    "    self.thread_pool.schedule(Batch::from(unsafe { TaskType::field_of(task) }));",
    "    batch.push(thread_pool::Batch::from(&raw mut task.task));",
    "}",
  ].join("\n");
  expect(findBannedBatches(source).map(offset => lineOf(source, offset))).toEqual([2, 5, 6]);
});

test("no Batch::from call projects the task out of a reference to the field", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted instance is converted, delete its entry so
  // a new one cannot take its place.
  for (const [f, n] of Object.entries(ALLOW)) {
    expect(counts[f] ?? 0).toBe(n);
  }
});
