import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A method must not push its own receiver onto a queue or put it back into its
// pool. Inside a `&mut self` method, the receiver's address
//
//   queue.push(NonNull::from(&mut *self))
//   store.put(ptr::from_mut(self))
//   list.push(self)                          (`&mut Self` coercing to `*mut Self`)
//   queue.push(NonNull::new_unchecked(self)) (the same coercion, one call in)
//   let job = NonNull::from(&mut *self); ... queue.push(job)
//   let p: *mut Self = self;             ... queue.push(NonNull::new_unchecked(p))
//
// as the argument of a `.push(..)` or `.put(..)` is banned.
//
// Both calls give the receiver's storage away. A push is how a pool thread
// hands a finished job back to the thread that owns it (`UnboundedQueue::push`,
// then a wakeup); from the moment it lands the consumer writes to the object or
// frees it (the package manager reclaims the `Box` a patch task lives in). A
// `put` returns a slot to its pool: `HiveArrayFallback::put` drops it in place,
// or frees it when it was a heap spill, before returning (`FilePoll`'s
// `Store::put` does that at once for a poll that was never registered, and
// queues the slot for the end of the event loop turn otherwise). Either way
// the `self` of the method that made the call is still a live argument while
// that happens. A reference argument is protected for the duration of its
// call, and writing to or deallocating protected memory is UB under both
// aliasing models whether or not the method touches `self` again: Tree Borrows
// (what `bun run rust:miri` uses) reports "deallocation through <tag> is
// forbidden ... the strongly protected tag disallows deallocations" or, for the
// cross-thread writes, a data race on the protector's release, pointing at the
// receiver; Stacked Borrows reports "deallocating while item [Unique] is
// strongly protected". Codegen relies on the same guarantee: a `&mut self`
// argument is `noalias dereferenceable` for the whole call, so the compiler is
// free to re-read a field through it after the call instead of keeping the copy
// taken before; a read after the push (spelled out in the source, there) is
// what crashed the Zig version of the transpiler store (#29128).
// `TranspilerJob::dispatch_to_main_thread(&mut self)` (reached from inside
// `run(&mut self)` via a scope guard, so two protected frames deep),
// `TranspilerJob::run_from_js_thread(&mut self)` (the `put` of the same slot),
// `PatchTask::run_from_thread_pool_impl(&mut self)` and
// `FilePoll::deinit_possibly_defer(&mut self, ..)` (reached through the
// `&mut self` `deinit` / `deinit_with_vm` / `deinit_force_unregister` entry
// points, so again two protected frames deep) were the instances this was
// written for.
//
// The object was a raw pointer in the caller's hands before it became `self`
// (the pool recovers it from the intrusive task field, the queue pops it, a
// poll's owner stores the slot pointer `FilePoll::init` returned), so the fix
// is to keep it one: run the body through a statement-scoped reborrow
// (`let was_registered = (*this).clear_for_put(..);`), read whatever else comes
// after through `(*this).field` accesses that end before the call, push or put
// `this`, and never touch it again. Templates: `FilePoll::deinit` /
// `deinit_possibly_defer` in src/io/posix_event_loop.rs (and the Windows twin in
// src/io/windows_event_loop.rs), `NetworkTask::notify` in
// src/install/NetworkTask.rs, `Task::callback` in src/install/PackageManagerTask.rs.
//
// Scope: the exclusive spellings below (`from_mut(self)`, `NonNull::from(self)`,
// `NonNull::new_unchecked(self)`, `self.into()`, `&raw mut *self`, ...), plus
// `self` on its own as the only argument (the implicit `&mut Self` to
// `*mut Self` coercion, which is the shortest spelling of all of these and the
// one clippy does not catch: `ref_as_ptr` / `borrow_as_ptr` already deny the
// `self as *mut _` and `&mut *self as *mut _` forms workspace-wide), with
// `self` as the receiver and `.push(` / `.put(` as the callee, inline or through
// a local of the same function. Outside it: the shared spellings
// (`from_ref(self)`, `&*self`; what this tree pushes from a `&self` method is a
// same-thread registry entry, quic's `ENDPOINT_REGISTRY`, whose consumer
// neither writes nor frees), `self` as one of several arguments (the
// `put(self, ..)` map inserts and `err.put(global, ..)` property writes, where
// `self` is a key or a context, not storage being given away), a pointer
// produced by a helper (`self.as_ptr()`), something the receiver owns
// (`NonNull::from(&mut self.task)`, `&raw mut self.task`), and reference
// parameters other than `self` (`fn f(this: &mut Task)` pushing
// `NonNull::from(this)`; a local reference is not protected and the push moves
// it, but a reference *parameter* pushed that way is the same bug, convert it
// on sight). A by-value `self` moved into a `Vec` would also spell
// `v.push(self)`; nothing in the tree does that today, and such a method can
// bind the value first (`let me = self;`) to say so. Other helpers that free
// their argument (`Self::destroy(..)`) are the population
// self-receiver-reclaim.test.ts names as outside its scope.
// Siblings: self-receiver-reclaim.test.ts, fn-long-mut-reborrow.test.ts,
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

// The hand-over. Anchored on the argument below, so the `Vec::push` and map
// `put` calls all over the tree only count when the argument is the receiver's
// address. `\s*` after the paren so a rustfmt-wrapped argument still matches.
const HAND_OVER = String.raw`\.\s*(?:push|put)\s*\(\s*`;

// Optional path in front of an item (`core::ptr::NonNull`, `std::ptr::from_mut`).
const PATH = String.raw`(?:[\w:]+::)?`;
const TURBOFISH = String.raw`(?:::<[^>]*>)?`;

// `self` as a `*mut`. The `&raw` form needs the `(?!\s*\.)` so
// `&raw mut *self.field` (something the receiver owns) stays out; `self as`
// swallows the pointer type that follows.
const SELF_AS_RAW = [
  String.raw`${PATH}from_mut${TURBOFISH}\(\s*self\s*\)`,
  String.raw`self\s+as\s+\*mut\b[^,;)]*`,
  String.raw`&raw\s+mut\s+\*\s*self\b(?!\s*\.)`,
  String.raw`${PATH}addr_of_mut!\s*\(\s*\*\s*self\s*\)`,
].join("|");

// The receiver reference itself: `self` or its reborrow `&mut *self`. Every
// use below is followed by `\s*\)` or `\s*,?\s*\)`, which keeps `self.field` /
// `&mut *self.field` (something the receiver owns) out.
const SELF_REF = String.raw`(?:&\s*mut\s+\*\s*)?self`;

// `self` as a `NonNull`: converted from the reference itself (`NonNull::from(self)`,
// `self.into()`), coerced to `*mut` inside a constructor
// (`NonNull::new_unchecked(self)`), or wrapped around a raw spelling.
const SELF_AS_NONNULL = [
  String.raw`${PATH}NonNull::from\(\s*${SELF_REF}\s*\)`,
  String.raw`${PATH}NonNull::(?:new_unchecked|new)${TURBOFISH}\(\s*(?:${SELF_REF}|${SELF_AS_RAW})\s*\)`,
  String.raw`${SELF_REF}\s*\.\s*into\(\)`,
].join("|");

const SELF_AS_POINTER = `(?:${SELF_AS_RAW}|${SELF_AS_NONNULL})`;

// Method calls that keep the address: how a `NonNull::new(..)` is unwrapped
// and how a binding is adapted to the queue's element type.
const SAME_ADDRESS = String.raw`(?:\s*\.\s*(?:cast(?:_mut|_const)?${TURBOFISH}\(\)|as_ptr\(\)|unwrap\(\)|expect\([^)]*\)))*`;

// The argument has to end there: `.push(NonNull::from(self).foo)` is not
// this shape, and neither is `.push(p.field)` for a binding `p` below.
const ARG_END = String.raw`\s*[,)]`;

const DIRECT = new RegExp(`${HAND_OVER}${SELF_AS_POINTER}${SAME_ADDRESS}${ARG_END}`, "g");

// The reference itself as the whole argument list, coerced to `*mut Self` by
// the callee's signature (`list.push(self)`, `store.put(&mut *self)`). Only as
// the sole argument: with more arguments `self` is a key or a context (see the
// header), not the storage being handed over.
const COERCED = new RegExp(`${HAND_OVER}${SELF_REF}\\s*,?\\s*\\)`, "g");

// A local bound to the receiver's address, then handed over further down the
// same function (which ends at the next `fn` item; a closure inside it is the
// same function for this purpose). `let p: *mut Self = self;` is the coercion
// spelling; without the annotation `let p = self;` is just another reference.
const BINDING_HEAD = String.raw`\blet\s+(?:mut\s+)?(\w+)\s*`;
const SELF_POINTER_BINDINGS = [
  new RegExp(`${BINDING_HEAD}(?::[^=;]*)?=\\s*${SELF_AS_POINTER}${SAME_ADDRESS}\\s*;`, "g"),
  new RegExp(`${BINDING_HEAD}:\\s*\\*(?:mut|const)\\b[^=;]*=\\s*self\\s*;`, "g"),
];
const FN_ITEM = /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe|extern\s+"[^"]*")\s+)*fn\s+\w+/m;

// The binding passed as is, or wrapped into a `NonNull` at the call.
function handOverOfBinding(name: string): RegExp {
  const wrapped = String.raw`${PATH}NonNull::(?:new_unchecked|new|from)${TURBOFISH}\(\s*${name}${SAME_ADDRESS}\s*\)`;
  return new RegExp(`${HAND_OVER}(?:${wrapped}|\\b${name})${SAME_ADDRESS}${ARG_END}`);
}

/** Byte offsets (into `stripped`) of every banned hand-over in one file. */
function findHandOvers(stripped: string): number[] {
  const hits: number[] = [];
  for (const m of stripped.matchAll(DIRECT)) hits.push(m.index);
  for (const m of stripped.matchAll(COERCED)) hits.push(m.index);
  for (const pattern of SELF_POINTER_BINDINGS) {
    for (const binding of stripped.matchAll(pattern)) {
      const start = binding.index + binding[0].length;
      const rest = stripped.slice(start);
      const fnEnd = rest.search(FN_ITEM);
      const body = fnEnd === -1 ? rest : rest.slice(0, fnEnd);
      const call = body.search(handOverOfBinding(binding[1]));
      if (call !== -1) hits.push(start + call);
    }
  }
  return hits.sort((a, b) => a - b);
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

// Documented, ratcheted exceptions: files allowed to keep exactly N of the
// shape. Lower an entry when you convert one; do not add entries.
const ALLOW: Record<string, number> = {
  // `TranspilerJob::dispatch_to_main_thread(&mut self)` pushes its own slot to
  // the JS thread and `TranspilerJob::run_from_js_thread(&mut self)` puts it
  // back into the store; `PatchTask::run_from_thread_pool_impl(&mut self)`
  // pushes the task it lives in back to the main thread. They are being
  // converted separately (#37778); delete these entries when that lands.
  "src/jsc/RuntimeTranspilerStore.rs": 2,
  "src/install/patch_install.rs": 1,
  // `Resolve::dispatch(&mut self)` and `Load::dispatch(&mut self)` link their
  // receiver into the bundle's outstanding lists (`outstanding_*.push(self)`,
  // the coercion spelling) before posting it to the JS thread. Being converted
  // separately (#37732); delete this entry when that lands.
  "src/bundler/bundle_v2.rs": 2,
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
  for (const offset of findHandOvers(stripped)) {
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
    // `TranspilerJob::dispatch_to_main_thread(&mut self)` as it was.
    "let job = NonNull::from(&mut *self);\nunsafe { (*transpiler_store).queue.push(job) };",
    // `PatchTask::run_from_thread_pool_impl(&mut self)` as it was.
    "unsafe {\n    (*mgr)\n        .patch_task_queue\n        .push(core::ptr::NonNull::from(&mut *self));\n    PackageManager::wake_raw(mgr);\n}",
    // `TranspilerJob::run_from_js_thread(&mut self)` as it was.
    "unsafe {\n    (*vm)\n        .transpiler_store\n        .store\n        .put(std::ptr::from_mut::<TranspilerJob>(self))\n};",
    "pool.put(self as *mut Self);",
    "let slot = ptr::from_mut(self);\nunsafe { (*store).put(slot) };",
    // `FilePoll::deinit_possibly_defer(&mut self, ..)` as it was, posix and
    // windows spellings.
    "let this = ptr::NonNull::from(self);\nvm.file_polls_mut().put(this, vm, was_ever_registered);",
    "let this: ptr::NonNull<FilePoll> = ptr::NonNull::from(&mut *self);\nvm.file_polls_mut().put(this, vm, was_ever_registered);",
    // `Resolve::dispatch(&mut self)` in src/bundler/bundle_v2.rs (allowlisted
    // above): the bare coercion.
    "bv2.graph.outstanding_resolves.push(self);",
    // The coercion spellings of the three instances above.
    "unsafe { (*vm).transpiler_store.store.put(self) };",
    "(*self.pool).put(&mut *self);",
    "queue.push(NonNull::new_unchecked(self));",
    "queue.push(NonNull::new(self).unwrap());",
    "queue.push(NonNull::new_unchecked(&mut *self));",
    "queue.push(self.into());",
    "pending.push(\n    self,\n);",
    "let this = NonNull::new_unchecked(self);\nqueue.push(this);",
    "let this: NonNull<Self> = self.into();\nqueue.push(this);",
    // Other spellings of the same thing.
    "queue.push(NonNull::from(self));",
    "queue.push(core::ptr::NonNull::from(&mut  *self));",
    "queue.push(NonNull::new_unchecked(std::ptr::from_mut::<Self>(self)));",
    "queue.push(NonNull::new(self as *mut Self).unwrap());",
    "queue.push(core::ptr::NonNull::new_unchecked(&raw mut *self));",
    "queue.push(NonNull::new_unchecked(ptr::addr_of_mut!(*self)).cast());",
    "pending.push(ptr::from_mut(self));",
    "pending.push(self as *mut Self as *mut c_void);",
    "pending.push(\n    NonNull::from(&mut *self),\n);",
    // Through a local.
    "let this = std::ptr::from_mut::<Self>(self);\nlet x = 1;\nqueue.push(NonNull::new_unchecked(this));",
    "let this: *mut Self = self;\nif done {\n    return;\n}\nqueue.push(NonNull::new(this).unwrap());",
    "let this = NonNull::from(self).cast::<Job>();\nqueue.push(this.cast());",
    "let mut this = NonNull::from(&mut *self);\n(*vm).store.queue.push(this, );",
  ];
  const allowed = [
    // The raw-pointer shape the fix produces.
    "unsafe { (*transpiler_store).queue.push(NonNull::new_unchecked(this)) };",
    "(*mgr)\n    .patch_task_queue\n    .push(core::ptr::NonNull::new_unchecked(this));",
    "unsafe { (*vm).transpiler_store.store.put(this) };",
    "self.store.put(job);",
    // A local reference parameter, moved into the push.
    "installer.task_queue.push(core::ptr::NonNull::from(this));",
    // `self` as a key or a context, not as storage.
    "bun_core::handle_oom(handles.put(self, ()));",
    'err.put(self, b"name", name_value);',
    "unsafe { self.owner.put(self.slot.as_ptr()) };",
    // Something the receiver owns.
    "queue.push(NonNull::from(&mut *self.inner));",
    "queue.push(NonNull::from(&mut self.task));",
    "batch.push(Batch::from(&raw mut self.task));",
    "batch.push(Batch::from(core::ptr::addr_of_mut!(self.task)));",
    "self.tasks.push(NonNull::new_unchecked(concurrent));",
    "self.tasks.push(NonNull::new_unchecked(self.task));",
    "self.entries.push(item);",
    "out.push(self.len);",
    "out.push(self.node.into());",
    "out.push(&mut *self.node);",
    "out.push(selfie);",
    "let job = NonNull::from(&mut *self.job);\nqueue.push(job);",
    // A helper-produced pointer and the shared spellings are out of scope.
    "queue.push(self.as_non_null());",
    "queue.push(NonNull::from(&*self));",
    "let me = core::ptr::from_ref(self).cast_mut();\nENDPOINT_REGISTRY.with_borrow_mut(|v| {\n    if !v.contains(&me) {\n        v.push(me);\n    }\n});",
    // A self pointer that is not pushed, or whose name is only a prefix of
    // what is pushed.
    "let this = std::ptr::from_mut(self);\nSelf::finalize(this);",
    "let this = std::ptr::from_mut(self);\nqueue.push(this_task);",
    "let this = std::ptr::from_mut(self);\nqueue.push(NonNull::from(&mut (*this).task));",
    // The binding's function ends before the push.
    "let this = std::ptr::from_mut(self);\n    }\n\n    fn other(&mut self, this: NonNull<Job>) {\n        self.queue.push(this);",
  ];
  expect(banned.filter(s => findHandOvers(s).length === 0)).toEqual([]);
  expect(allowed.filter(s => findHandOvers(s).length !== 0)).toEqual([]);
});

test("no method pushes or puts its own receiver", () => {
  expect(offenders).toEqual([]);
});

test("allowlisted files still carry exactly their documented count", () => {
  // Ratchet: once an allowlisted instance is converted, delete its entry so
  // a new one cannot take its place.
  const actual = Object.fromEntries(Object.keys(ALLOW).map(f => [f, counts[f] ?? 0]));
  expect(actual).toEqual(ALLOW);
});
