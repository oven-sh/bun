import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The `*mut Task` a `Batch::from(..)` hands to the thread pool must be
// projected out of a raw pointer to the object that embeds the task, not out
// of a reference to that object:
//
//   Batch::from(&raw mut self.task)                              // `self: &mut Self`
//   Batch::from(&raw mut task.task)                              // `task: &mut T` (a slot, an iter_mut item)
//   Batch::from(addr_of_mut!(runner_task.task))
//   Batch::from(&raw mut combined_part_ranges.last_mut().unwrap().task)
//
// are banned; the accepted spellings project through a raw pointer:
//
//   Batch::from(&raw mut (*this).task)                           // `this: *mut T`, or `ptr::from_mut(t)`
//   Batch::from(&raw mut (*tasks.as_mut_ptr().add(i)).task)      // a Vec of tasks, filled first
//   Batch::from(addr_of_mut!((*task).task))
//
// The pool calls back with exactly the pointer it was given, and every
// callback behind a `Batch::from` site (`from_task_ptr`, `from_field_ptr!`)
// container-ofs it back to the embedding object and then reads and writes the
// object's other fields through the result; `HTTPThread::schedule` does the
// container-of on the calling thread before the batch is even queued.
// `bun_core::container_of` documents that this needs a pointer derived from the
// object's pointer, and a raw borrow of a field taken through a reference does
// not give one: rustc retags `&raw mut <place>` unless the place is based on a
// raw pointer, and under Stacked Borrows that retag covers the field only, so
// the callback's first sibling-field access is UB ("created by a
// SharedReadWrite retag at offsets [<the task field>]"). The push-then-
// `last_mut()` loop is worse: each `last_mut()` reborrows the whole buffer and
// invalidates the pointers already in the batch, so `Batch::push` itself trips
// when it links the next task onto the previous one. `&raw mut (*p).f` with
// `p` raw is not retagged and keeps `p`'s range; `ptr::from_mut(t)` is a
// reborrow of the whole object, so projecting through it is equivalent. Tree
// Borrows, which is what `bun run rust:miri` runs, accepts the banned shapes,
// and none of the crates involved are in its crate set, so this lint is what
// reports a regression. The sites this was written for (install's
// `PatchTask::schedule` and isolated-install `start_task`,
// `AsyncHTTP::schedule` and `preconnect`, `ThreadPool::each`, the bundler's
// source-map and chunk batches) are the templates for the accepted shapes.
//
// Scope: the argument of every `Batch::from(` call (however the type is
// reached, including the `PoolBatch` / `ThreadPoolBatch` aliases), when it is
// `&raw mut` / `&raw const` / `addr_of_mut!` / `addr_of!` of a field path whose
// base is a binding rather than a `(*p)` deref. A local holding a pointer
// projected elsewhere is out of scope, as is whether the pointer a function was
// handed is itself whole-object (that is its caller's business). The other
// ways of narrowing the same argument, a `&mut` formed in the argument, an
// accessor returning `&mut Task`, `ptr::from_mut(..)` of either, are banned by
// the sibling lint from #37865 and deliberately not repeated here, so the two
// never share an allowlist; `WorkPool::schedule(..)`, the other hand-over, is
// the subject of #37768's lint. Siblings: self-receiver-reclaim.test.ts,
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

// `Batch::from(`, however the type is reached: `thread_pool::Batch::from(`,
// `ThreadPoolLib::Batch::from(`, and the `use .. Batch as PoolBatch` /
// `ThreadPoolBatch` aliases in the tree.
const BATCH_FROM = /\b\w*Batch::from\s*\(/g;

// A place rooted at a binding and ending in a field: `self.task`,
// `task.task`, `self.inner.task`, `v.last_mut().unwrap().task`,
// `self.tasks[i].task`. A place rooted at a raw pointer is spelled `(*p).f`
// (or `(*p.add(i)).f`) and starts with `(`, so it never matches; neither does
// a bare deref such as `*self.task_ptr`, which is a pointer the object holds
// rather than a projection through the object.
const FIELD_PLACE = String.raw`\w+(?:\.\w+(?:\([^()]*\))?|\[[^\[\]]*\])*\.\w+`;

const RAW_BORROW = new RegExp(String.raw`^&\s*raw\s+(?:mut|const)\s+${FIELD_PLACE}$`);
const ADDR_OF = new RegExp(String.raw`^(?:[\w:]+::)?addr_of(?:_mut)?!\s*\(\s*${FIELD_PLACE}\s*\)$`);

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
  return RAW_BORROW.test(arg) || ADDR_OF.test(arg);
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
    // The instances this was written for, as they were.
    "&raw mut self.task",
    "core::ptr::addr_of_mut!(self.task)",
    "core::ptr::addr_of_mut!(async_http.task)",
    "&raw mut task.task",
    "ptr::addr_of_mut!(runner_task.task)",
    "&raw mut line_offset.thread_task",
    "\n                                &raw mut combined_part_ranges.last_mut().unwrap().task,\n                            ",
    // Other spellings of the same projection.
    "&raw const self.task",
    "addr_of_mut!(this.task)",
    "std::ptr::addr_of!(self.task)",
    "&raw mut self.inner.task",
    "&raw mut self.tasks[i].task",
    "&raw mut tasks[i].task",
    "&raw mut self.tasks.last_mut().unwrap().task",
    "unsafe { &raw mut this.task }",
    "unsafe {\n    core::ptr::addr_of_mut!(self.task)\n}",
    "core::ptr::addr_of_mut!(\n    task.task\n)",
  ];
  const allowed = [
    // The converted shapes.
    "unsafe { &raw mut (*this).task }",
    "unsafe { &raw mut (*task).task }",
    "\n                    &raw mut (*line_offset).thread_task,\n                ",
    "unsafe { &raw mut (*runner_tasks.add(i)).task }",
    "unsafe {\n                    &raw mut (*tasks_ptr.add(i)).task\n                }",
    // The raw projections that were already in the tree.
    "&raw mut (*parse_task).task",
    "&raw mut (*parse_task).io_task",
    "unsafe { core::ptr::addr_of_mut!((*task).task) }",
    "unsafe {\n                        core::ptr::addr_of_mut!((*task).task)\n                    }",
    "core::ptr::addr_of_mut!(\n                            (*this.parse_task.as_ptr()).task\n                        )",
    "core::ptr::addr_of_mut!(\n                    (*this).drain_task\n                )",
    "unsafe { TaskType::field_of(task) }",
    // A pointer projected elsewhere, or one the object holds, is out of scope.
    "task",
    "queued",
    "&raw mut *self.task",
    // Narrowed through a reference or an accessor rather than a raw borrow:
    // #37865's lint, not this one.
    "&mut self.task",
    "this.task()",
    "unsafe { std::ptr::from_mut::<WorkPoolTask>((*task).task()) }",
    "ptr::from_mut(&mut self.task)",
  ];
  expect(banned.filter(s => !isBanned(s))).toEqual([]);
  expect(allowed.filter(s => isBanned(s))).toEqual([]);
});

test("the call matcher finds every spelling of the call and takes its whole argument", () => {
  const source = [
    "fn schedule(&mut self, batch: &mut Batch) {",
    "    batch.push(Batch::from(&raw mut self.task));",
    "    batch.push(thread_pool::Batch::from(unsafe { &raw mut (*task).task }));",
    "    batch.push(ThreadPoolLib::Batch::from(",
    "        &raw mut combined_part_ranges.last_mut().unwrap().task,",
    "    ));",
    "    crate::HTTPThread::schedule(Batch::from(core::ptr::addr_of_mut!(async_http.task)));",
    "    let batch = PoolBatch::from(unsafe { core::ptr::addr_of_mut!((*task).task) });",
    "    manager.task_batch.push(ThreadPoolBatch::from(queued));",
    "    batch.push(Batch::from(unsafe {",
    "        &raw mut (*runner_tasks.add(i)).task",
    "    }));",
    "    // batch.push(Batch::from(&raw mut self.task));",
    "}",
  ].join("\n");
  const stripped = source.replace(/^[ \t]*\/\/.*$/gm, "");
  expect(findBannedBatches(stripped).map(offset => lineOf(stripped, offset))).toEqual([2, 4, 7]);
});

test("no Batch::from call projects the task through a reference to the object", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted instance is converted, delete its entry so
  // a new one cannot take its place.
  for (const [f, n] of Object.entries(ALLOW)) {
    expect({ file: f, count: counts[f] ?? 0 }).toEqual({ file: f, count: n });
  }
});
