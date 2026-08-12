import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A method must not post its own receiver as a task. Inside a `&self` /
// `&mut self` method, a pointer spelled from `self`
//
//   ConcurrentTask::create(Task::init(std::ptr::from_mut(self)))
//   ConcurrentTask::create_from(self)            // `&mut Self` coerces to `*mut Self`
//   loop_.enqueue_task(Task::init(self))          // same loop, drained later
//   let this = std::ptr::from_mut(self); ... Task::init(this)
//   let p: *mut Self = self;             ... ConcurrentTask::create_from(p)
//
// as the argument of `Task::init(..)`, `ConcurrentTask::create_from(..)` or
// `ConcurrentTask::from_callback(..)`, the heap-task constructors, is banned.
// (Filling an embedded task with it, `.from(..)`, is the sibling lint
// self-receiver-intrusive-post.test.ts from #37750.)
//
// Two things are wrong with it, and which one bites depends on who drains the
// queue:
//
//   - Another thread (a `ConcurrentTask`): the post is the hand-over. From the
//     moment it lands the consumer may write to the object or, when the post
//     carries its last ref, free it, while `self` is still a live argument of
//     the posting method. A reference argument is protected for the duration
//     of its call, and writing to or deallocating protected memory is UB under
//     both aliasing models whether or not the method touches `self` again:
//     Tree Borrows (what `bun run rust:miri` uses) reports "deallocation
//     through <tag> is forbidden ... the strongly protected tag disallows
//     deallocations", pointing at the receiver, and Stacked Borrows reports
//     "deallocating while item [Unique] is strongly protected". Codegen relies
//     on the same guarantee: a reference argument is annotated as
//     dereferenceable for the whole call.
//   - The same thread, later: the queued pointer carries the provenance of the
//     receiver reborrow it was spelled from, and that reborrow is dead as soon
//     as anything reaches the object through the owner's own pointer again (the
//     caller that holds it, the next event, a state CAS on the way out of the
//     dispatch). When the queue is drained the task is read, or freed, through
//     a dead pointer: "reborrow through <tag> is forbidden" (Tree Borrows) /
//     "that tag does not exist in the borrow stack" (Stacked Borrows). This is
//     why `SendQueue` in src/runtime/ipc.rs keeps its allocation pointer in a
//     field and posts `root_ptr()`.
//
// `JSBundleCompletionTask::complete_on_bundle_thread(&mut self)` was the
// instance this was written for: every `Bun.build()` ended with the bundle
// thread posting the task's only ref to the JS thread, which frees it, from
// inside its own `&mut self`.
//
// The object was a raw pointer in the caller's hands before it became `self`
// (the queue entry, the callback ctx, the backref), so the fix is to keep it
// one: the function that posts takes `this: *mut Self`, does its own work
// through accesses that end before the post (`(*this).field` place
// expressions or a call-scoped reborrow), and posts `this`. Templates:
// `complete_on_bundle_thread` in src/runtime/api/js_bundle_completion_task.rs
// (and its caller in src/bundler/BundleThread.rs, which keeps the pointer
// raw), `async_job_run` in src/runtime/node/node_zlib_binding.rs, `post_job`
// in src/jsc/VmHandle.rs.
//
// Scope: the spellings above, with `self` as the receiver and those three
// callees. The same hand-over spelled some other way is outside the regex and
// is the same bug; the instances known at the time of writing, and where each
// is being converted, are `napi_async_work::run` / `post_to_js_thread` in
// src/runtime/napi/napi_body.rs (posts a `*mut Self` parameter the caller made
// from its `&mut self`; #37750), `TranspilerJob::dispatch_to_main_thread` in
// src/jsc/RuntimeTranspilerStore.rs (pushes `NonNull::from(&mut *self)` onto
// its own queue; #37778), `FetchTasklet::deref_from_thread` in
// src/runtime/webcore/fetch/FetchTasklet.rs (posts `this`, but through
// `post(&self)` and the handle field inside the object it is freeing) and
// `StatWatcher::post_to_js_thread(&self)` in src/runtime/node/
// node_fs_stat_watcher.rs (a helper's pointer, `self.as_ctx_ptr()`), the last
// two tracked. Convert anything of that shape on sight; the ratchet below only
// tracks what the regex can see. Siblings: self-receiver-reclaim.test.ts,
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

// `Task::init(`, `ConcurrentTask::create_from(`, `ConcurrentTask::from_callback(`,
// however the path in front is spelled (`jsc::`, `bun_event_loop::ConcurrentTask::`,
// the `ConcurrentTaskItem` alias), optionally turbofished. The `\b` before
// `Task` keeps `NapiFinalizerTask::init(self)` (a constructor that copies out
// of `self`) out, and pinning the other two to a `ConcurrentTask*` path keeps
// unrelated `create_from` constructors out. `\s*` after the paren so a
// rustfmt-wrapped argument still matches.
const POST = String.raw`\b(?:Task::init|ConcurrentTask\w*::(?:create_from|from_callback))(?:::<[^>]*>)?\(\s*`;

// The ways of spelling "`self`, as a raw pointer" as the first argument. Each
// is anchored at its front only, so a trailing `.cast_mut()` / `.as_ptr()`
// still matches; the bare form needs the `,` / `)` so `self.as_ptr()` (a
// helper, out of scope) does not. `(?!\s*\.)` after the `&raw` form keeps
// `&raw mut *self.field` (a field the receiver owns) out.
const SELF_AS_POINTER = [
  String.raw`self\s*[,)]`,
  String.raw`(?:[\w:]+::)?from_(?:mut|ref)(?:::<[^>]*>)?\(\s*self\s*\)`,
  String.raw`(?:[\w:]+::)?NonNull::from\(\s*self\s*\)`,
  String.raw`self\s+as\s+\*(?:mut|const)\b`,
  String.raw`&raw\s+(?:mut|const)\s+\*\s*self\b(?!\s*\.)`,
  String.raw`(?:[\w:]+::)?addr_of(?:_mut)?!\s*\(\s*\*\s*self\s*\)`,
].join("|");

const DIRECT = new RegExp(`${POST}(?:${SELF_AS_POINTER})`, "g");

// A local bound to such a pointer: `let this = ptr::from_mut(self);`,
// `let p = self as *mut Self;`, `let p: *mut Self = self;` (the coercion
// spelling needs the annotation; without it `let p = self;` is just another
// reference). The binding is then looked for as a post argument further down
// the same function, which ends at the next `fn` item (a closure inside it is
// the same function for this purpose).
const BINDING_HEAD = String.raw`let\s+(?:mut\s+)?(\w+)\s*`;
const SELF_POINTER_BINDINGS = [
  new RegExp(
    BINDING_HEAD +
      String.raw`(?::[^=;]*)?=\s*(?:` +
      [
        String.raw`(?:[\w:]+::)?from_(?:mut|ref)(?:::<[^>]*>)?\(\s*self\s*\)(?:\s*\.cast_mut\(\))?`,
        String.raw`self\s+as\s+\*(?:mut|const)\b[^;]*`,
        String.raw`&raw\s+(?:mut|const)\s+\*\s*self\b`,
        String.raw`(?:[\w:]+::)?addr_of(?:_mut)?!\s*\(\s*\*\s*self\s*\)`,
      ].join("|") +
      String.raw`)\s*;`,
    "g",
  ),
  new RegExp(BINDING_HEAD + String.raw`:\s*\*(?:mut|const)\b[^=;]*=\s*self\s*;`, "g"),
];
const FN_ITEM = /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe|extern\s+"[^"]*")\s+)*fn\s/m;

function postOfBinding(name: string): RegExp {
  return new RegExp(POST + name + String.raw`\s*[,)]`);
}

/** Byte offsets (into `stripped`) of every banned post in one file. */
function findPosts(stripped: string): number[] {
  const hits: number[] = [];
  for (const m of stripped.matchAll(DIRECT)) hits.push(m.index);
  for (const pattern of SELF_POINTER_BINDINGS) {
    for (const binding of stripped.matchAll(pattern)) {
      const start = binding.index + binding[0].length;
      const rest = stripped.slice(start);
      const fnEnd = rest.search(FN_ITEM);
      const body = fnEnd === -1 ? rest : rest.slice(0, fnEnd);
      const post = body.search(postOfBinding(binding[1]));
      if (post !== -1) hits.push(start + post);
    }
  }
  return hits.sort((a, b) => a - b);
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape. Each has been read and is the bug described above, not a false
// positive; each is listed because its conversion is a change of its own (the
// PR named on it), not because it is safe. Lower an entry when its conversion
// lands; do not add entries.
const ALLOW: Record<string, number> = {
  // `Resolve::dispatch` / `Load::dispatch` (`&mut self`) post the arena-owned
  // plugin request to the JS thread, which writes its `value` while
  // `dispatch` is still returning (the arena, not the consumer, frees it).
  // #37732 converts them; delete this entry when it lands.
  "src/bundler/bundle_v2.rs": 2,
  // `DeferredBatchTask::schedule` (`&mut self`) posts a task embedded in its
  // `BundleV2`, whose consumer reaches the surrounding `BundleV2` through it;
  // the receiver that matters there is the `&mut BundleV2` the bundle thread
  // holds for the whole pass, not this field's. #37709 reshapes `schedule` to
  // take the `BundleV2`; delete this entry when that lands.
  "src/bundler/DeferredBatchTask.rs": 1,
  // `ThreadSafeFunction::maybe_queue_finalizer` is the same-thread case: it
  // sets `closing` and posts `self_ptr` to its own loop, `on_dispatch` then
  // CASes `dispatch_state` through the real pointer on its way out, and the
  // drained task is what `destroy`s the TSFN, through the dead one (#37762,
  // with its `dispatch_one` caller). `schedule_dispatch` is the cross-thread
  // case: addon threads post and the JS thread writes the atomics at once
  // (#37741, with its `call` / `release_locked` callers). One each.
  "src/runtime/napi/napi_body.rs": 2,
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
  for (const offset of findPosts(stripped)) {
    counts[source] = (counts[source] ?? 0) + 1;
    if (counts[source] > (ALLOW[source] ?? 0)) {
      offenders.push(`${source}:${lineOf(stripped, offset)}`);
    }
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
});

test("the patterns match the banned spellings and nothing else", () => {
  const banned = [
    // `complete_on_bundle_thread(&mut self)` as it was.
    "let this = std::ptr::from_mut::<Self>(self);\nlet ct = jsc::ConcurrentTask::create(jsc::Task::init(this));",
    // The allowlisted shapes.
    "ConcurrentTask::create(Task::init(std::ptr::from_mut::<Self>(self)));",
    "bun_event_loop::ConcurrentTask::ConcurrentTask::create(\n    bun_event_loop::Task::init(std::ptr::from_mut::<Self>(self)),\n);",
    "let self_ptr: *mut Self = self;\nif done {\n    return;\n}\nlet ct = ConcurrentTask::create_from(self_ptr);",
    "let self_ptr: *mut Self = self;\nloop_.enqueue_task(Task::init(self_ptr));",
    // Other spellings of the pointer; a same-loop post counts too (see the
    // header).
    "loop_.enqueue_task(Task::init(self));",
    "let ct = ConcurrentTask::create_from(self);",
    "ConcurrentTask::from_callback(self, Self::resume);",
    "ConcurrentTask::from_callback(\n    std::ptr::from_mut(self),\n    Self::resume,\n)",
    "Task::init(core::ptr::from_ref(self).cast_mut())",
    "Task::init(NonNull::from(self).as_ptr())",
    "Task::init(self as *mut Self)",
    "Task::init(&raw mut *self)",
    "Task::init(core::ptr::addr_of_mut!(*self))",
    "jsc::ConcurrentTask::create_from::<Self>(std::ptr::from_mut(self))",
    "let task = ConcurrentTaskItem::create_from(std::ptr::from_mut(self));",
    "bun_event_loop::ConcurrentTask::ConcurrentTask::from_callback(self, on_done)",
    "let p = self as *mut Self;\nlet ct = ConcurrentTask::create_from(p);",
    "let p: *mut Self = std::ptr::from_mut(self);\nlet ct = bun_jsc::ConcurrentTask::create_from(p);",
    "let p = core::ptr::from_ref(self).cast_mut();\nlet ct = ConcurrentTask::create_from(p);",
    "let p = &raw mut *self;\nlet task = Task::init(p);",
  ];
  const allowed = [
    // Posting the pointer the caller handed us is the intended shape.
    "let ct = jsc::ConcurrentTask::create(jsc::Task::init(this));",
    "let ct = ConcurrentTask::create(Task::init(this));",
    "ConcurrentTask::create_from(task.as_ptr())",
    "ConcurrentTask::from_callback(this, FetchTasklet::resume_request_data_stream)",
    // The embedded-task form is the sibling lint's (see the header).
    "let ct = self.concurrent_task.from(self_ptr, AutoDeinit::ManualDeinit);",
    // Something the receiver owns or points at, or a helper's pointer, is
    // out of scope (see the header).
    "ConcurrentTask::create(Task::init(self.as_ctx_ptr()))",
    "Task::init(core::ptr::from_ref(&self.run_pending_later).cast_mut())",
    "Task::init(&raw mut *self.inner)",
    "Task::init(self.task)",
    "ConcurrentTask::from_callback(std::ptr::from_mut(load), on_load_from_js_loop_raw)",
    // A constructor whose name merely ends in `Task`, a `create_from` that is
    // not a task's, and a method call.
    "NapiFinalizerTask::init(self).schedule();",
    "let headers = FetchHeaders::create_from(self);",
    "state.create_from(index, from, into);",
    // Producing the pointer is fine when it is not what gets posted.
    "let this = std::ptr::from_mut::<Self>(self);\nregister(this);",
    "let this = std::ptr::from_mut(self);\nlet ct = ConcurrentTask::create_from(other);",
    // Rebinding the reference is not a pointer binding.
    "let this = self;\nlet ct = ConcurrentTask::create_from(this);",
    // The binding is posted, but in the next function, where it is a
    // raw-pointer parameter of the same name.
    "let this = std::ptr::from_mut(self);\nregister(this);\n}\n\nfn resume(this: *mut Self) {\n    let ct = ConcurrentTask::create_from(this);\n}",
  ];
  expect(banned.map(s => findPosts(s).length)).toEqual(banned.map(() => 1));
  expect(allowed.map(s => findPosts(s).length)).toEqual(allowed.map(() => 0));
});

test("no method posts its own receiver as a task", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: when an allowlisted site is converted, lower its entry so the
  // shape cannot come back into that file.
  for (const [source, n] of Object.entries(ALLOW)) {
    expect({ source, count: counts[source] ?? 0 }).toEqual({ source, count: n });
  }
});
