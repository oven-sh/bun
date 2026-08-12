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
//   let this = std::ptr::from_mut(self); ... Task::init(this)
//   let p: *mut Self = self;             ... ConcurrentTask::create_from(p)
//   ThreadSafeFunction::schedule_dispatch(self)  // a helper that posts its argument
//
// as the argument of `Task::init(..)` / `..::create_from(..)` /
// `..::from_callback(..)`, or of one of the helpers in `POSTING_HELPERS` whose
// contract is to post the pointer they are given, is banned.
//
// The post is the hand-over, and it goes wrong in two ways. The consumer
// (another thread, for a `ConcurrentTask`) starts using the object the moment
// the post lands, and when the post carries its last reference it frees it,
// while `self` is still a live argument of the method that posted it; a
// reference argument is protected for the duration of its call, and writing to
// or deallocating protected memory is UB under both aliasing models whether or
// not the method touches `self` again (Tree Borrows, what `bun run rust:miri`
// uses: "the strongly protected tag disallows deallocations"; Stacked Borrows:
// "deallocating while item [Unique] is strongly protected"). And the pointer
// that was posted carries the receiver's provenance, so the first thing the
// poster does to the object through any other path afterwards, typically
// dropping the lock it posted under, invalidates the consumer's pointer: its
// next access is "a child of the conflicting tag <receiver>, which has state
// Disabled" (TB) / "tag does not exist in the borrow stack" (SB). Codegen
// relies on the same guarantees: a reference argument is annotated
// dereferenceable (and, for `&mut`, noalias) for the whole call.
// `ThreadSafeFunction::schedule_dispatch` in src/runtime/napi/napi_body.rs was
// the instance this was written for: every `napi_call_threadsafe_function` /
// `napi_release_threadsafe_function` posted the TSFN to the JS thread from
// inside a chain of `&mut self` frames on the addon thread and then unlocked
// it, so every dispatch_one on the JS thread locked through an invalidated
// pointer, and a call that consumed the last thread reference let the JS
// thread free the allocation while those frames were still returning.
//
// The object was a raw pointer in the caller's hands before it became `self`
// (the N-API handle, the queue entry, the callback ctx, the backref), so the
// fix is to keep it one: the function that posts takes `this: *mut Self`,
// does its own work through accesses that end before the post (`(*this).field`
// place expressions or a call-scoped reborrow), and posts `this`. Templates:
// `push` / `release` and what they call under the lock in
// src/runtime/napi/napi_body.rs, `async_job_run` in
// src/runtime/node/node_zlib_binding.rs, `post_job` in src/jsc/VmHandle.rs.
//
// Scope: the spellings above, with `self` as the receiver and the three task
// constructors or a listed helper as the callee. The conversion of a posting
// site moves the post behind a `this: *mut Self` function, and `&mut Self`
// coerces to `*mut Self` silently, so a `&mut self` caller that passes `self`
// into that function recreates the bug without any of the spellings above
// appearing at the post itself: that is what `POSTING_HELPERS` is for, and a
// function that takes a pointer in order to post it has to be added there when
// it is introduced (its `SAFETY` contract should say the pointer must be the
// allocation's own, which is the other half of the guard). A pointer produced
// by a helper (`self.as_ptr()`), a `NonNull::from(self)` binding posted through
// `.as_ptr()`, the intrusive `ConcurrentTask::from(..)` form, and reference
// *parameters* other than `self` (`fn f(load: &mut Load)` posting
// `from_mut(load)`) are the same hazard but outside this lint. Siblings:
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

// Functions whose contract is to post the pointer they are given (see the
// header): `post_job` in src/jsc/VmHandle.rs, `ThreadSafeFunction::
// schedule_dispatch` in src/runtime/napi/napi_body.rs. Qualified or not.
const POSTING_HELPERS = [String.raw`(?:[\w:]+::)?post_job`, String.raw`[\w:]+::schedule_dispatch`];

// `Task::init(`, `ConcurrentTask::create_from(`, `ConcurrentTask::from_callback(`,
// however the path in front is spelled, optionally turbofished, or one of the
// helpers above. The `\b` before `Task` keeps `NapiFinalizerTask::init(self)` (a
// constructor that copies out of `self`) out; `create_from` / `from_callback` /
// `schedule_dispatch` require a path in front so a method call of the same name
// does not count. `\s*` after the paren so a rustfmt-wrapped argument still
// matches.
const POST =
  String.raw`\b(?:Task::init|[\w:]+::create_from|[\w:]+::from_callback|` +
  POSTING_HELPERS.join("|") +
  String.raw`)(?:::<[^>]*>)?\(\s*`;

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
// shape. Each has been read and each has its conversion in flight or tied to
// a conversion of its callers. Lower an entry when you convert one; do not
// add entries.
const ALLOW: Record<string, number> = {
  // `Resolve::dispatch` / `Load::dispatch` (`&mut self`) post the arena-owned
  // plugin request to the JS thread, which writes its `value` while
  // `dispatch` is still returning; the arena, not the consumer, frees it.
  // #37732 converts them; delete this entry when it lands.
  "src/bundler/bundle_v2.rs": 2,
  // `DeferredBatchTask::schedule` (`&mut self`) posts a task embedded in its
  // `BundleV2`, whose consumer reaches the surrounding `BundleV2` through it;
  // the receiver that matters there is the `&mut BundleV2` the bundle thread
  // holds for the whole pass, not this field's. #37709 reshapes `schedule` to
  // take the `BundleV2`; delete this entry when that lands.
  "src/bundler/DeferredBatchTask.rs": 1,
  // `JSBundleCompletionTask::complete_on_bundle_thread` (`&mut self`) posts
  // the finished build's only ref to the JS thread, which frees it. #37723
  // converts it; delete this entry when it lands.
  "src/runtime/api/js_bundle_completion_task.rs": 1,
  // `ThreadSafeFunction::maybe_queue_finalizer` posts the finalize task to the
  // loop it is running on (no other thread is involved by then, and the task
  // runs after it returns), but the pointer it posts is made from a receiver
  // that `on_dispatch` then writes past through its own pointer, and `destroy`
  // later frees through the posted one. The pointer to post is the one
  // `on_dispatch` holds, so this goes with converting the JS-thread side
  // (`dispatch_one` and what it calls), tracked separately; the addon-thread
  // side is converted.
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
    // `ThreadSafeFunction::schedule_dispatch(&mut self)` as it was.
    "let self_ptr: *mut Self = self;\nif self.event_loop.is_none() {\n    return;\n}\nlet ct = ConcurrentTask::create_from(self_ptr);",
    // `JSBundleCompletionTask::complete_on_bundle_thread(&mut self)`.
    "let this = std::ptr::from_mut::<Self>(self);\nlet ct = jsc::ConcurrentTask::create(jsc::Task::init(this));",
    // The remaining allowlisted shapes.
    "ConcurrentTask::create(Task::init(std::ptr::from_mut::<Self>(self)));",
    "bun_event_loop::ConcurrentTask::ConcurrentTask::create(\n    bun_event_loop::Task::init(std::ptr::from_mut::<Self>(self)),\n);",
    "let self_ptr: *mut Self = self;\nloop_.enqueue_task(Task::init(self_ptr));",
    // Other spellings of the pointer.
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
    "let p = self as *mut Self;\nlet ct = ConcurrentTask::create_from(p);",
    "let p: *mut Self = std::ptr::from_mut(self);\nlet ct = bun_jsc::ConcurrentTask::create_from(p);",
    "let p = core::ptr::from_ref(self).cast_mut();\nlet ct = ConcurrentTask::create_from(p);",
    "let p = &raw mut *self;\nlet task = Task::init(p);",
    // A `&mut self` caller handing `self` (coerced) or a pointer made from it
    // to a function that posts its argument: the shape a receiver-taking
    // `release_locked` would have after this conversion.
    "unsafe { ThreadSafeFunction::schedule_dispatch(self) };",
    "unsafe {\n    Self::schedule_dispatch(\n        self,\n    )\n};",
    "let self_ptr: *mut Self = self;\nunsafe { Self::schedule_dispatch(self_ptr) };",
    "unsafe { bun_jsc::post_job(std::ptr::from_mut(self)) };",
    "unsafe { post_job::<Self>(self as *mut Self) };",
  ];
  const allowed = [
    // Posting the pointer the caller handed us is the intended shape.
    "let ct = ConcurrentTask::create_from(this);",
    "let ct = jsc::ConcurrentTask::create(jsc::Task::init(this));",
    "ConcurrentTask::create_from(task.as_ptr())",
    "ConcurrentTask::from_callback(this, FetchTasklet::resume_request_data_stream)",
    "unsafe { ThreadSafeFunction::schedule_dispatch(this) };",
    "unsafe { crate::post_job(job) };",
    // A method call means the callee takes a receiver; its own body is where
    // the post (and the lint hit) is.
    "self.schedule_dispatch();",
    // An owned box handed over whole (`NapiFinalizerTask::schedule(self: Box<Self>)`).
    "let this = bun_core::heap::into_raw(self);\nlet ct = ConcurrentTask::create(Task::init(this));",
    // Something the receiver owns or points at, or a helper's pointer, is
    // out of scope (see the header).
    "ConcurrentTask::create(Task::init(self.as_ctx_ptr()))",
    "Task::init(core::ptr::from_ref(&self.run_pending_later).cast_mut())",
    "Task::init(&raw mut *self.inner)",
    "Task::init(self.task)",
    "ConcurrentTask::from_callback(std::ptr::from_mut(load), on_load_from_js_loop_raw)",
    // A constructor whose name merely ends in `Task`, and a method call.
    "NapiFinalizerTask::init(self).schedule();",
    "state.create_from(index, from, into);",
    // Producing the pointer is fine when it is not what gets posted.
    "let this = std::ptr::from_mut::<Self>(self);\nregister(this);",
    "let this = std::ptr::from_mut(self);\nlet ct = ConcurrentTask::create_from(other);",
    // Rebinding the reference is not a pointer binding.
    "let this = self;\nlet ct = ConcurrentTask::create_from(this);",
    // The binding is posted, but in the next function, where it is a
    // raw-pointer parameter of the same name.
    "let this = std::ptr::from_mut(self);\nregister(this);\n}\n\nunsafe fn schedule_dispatch(this: *mut Self) {\n    let ct = ConcurrentTask::create_from(this);\n}",
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
