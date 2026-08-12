import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A method must not push its own receiver onto a queue. Inside a `&mut self`
// method, the receiver's address
//
//   queue.push(NonNull::from(&mut *self))
//   let job = NonNull::from(&mut *self); ... queue.push(job)
//   let p: *mut Self = self;             ... queue.push(NonNull::new_unchecked(p))
//
// as the argument of a `.push(..)` is banned.
//
// The push is the hand-over: it is how a pool thread gives a finished job
// back to the thread that owns it (`UnboundedQueue::push`, then a wakeup).
// From the moment it lands the consumer writes to the object or frees it (the
// runtime transpiler store `put()`s the slot back into its hive, a `Box` free
// once the hive is full; the package manager reclaims the `Box` a patch task
// lives in), and it does so while the `self` of the method that pushed is
// still a live argument. A reference argument is protected for the duration
// of its call, and writing to or deallocating protected memory is UB under
// both aliasing models whether or not the method touches `self` again: Tree
// Borrows (what `bun run rust:miri` uses) reports "deallocation through <tag>
// is forbidden ... the strongly protected tag disallows deallocations" or a
// data race on the protector's release, pointing at the receiver; Stacked
// Borrows reports "deallocating while item [Unique] is strongly protected".
// Codegen relies on the same guarantee: a `&mut self` argument is
// `noalias dereferenceable` for the whole call, so the compiler is free to
// re-read a field through it after the push instead of keeping the copy taken
// before; a read after the push (spelled out in the source, there) is what
// crashed the Zig version of the transpiler store (#29128).
// `TranspilerJob::dispatch_to_main_thread(&mut self)` (reached from inside
// `run(&mut self)` via a scope guard, so two protected frames deep) and
// `PatchTask::run_from_thread_pool_impl(&mut self)` were the instances this
// was written for.
//
// The object was a raw pointer in the caller's hands before it became `self`
// (the pool recovers it from the intrusive task field), so the fix is to keep
// it one: run the body through a statement-scoped reborrow (`(*this).run();`),
// read whatever the hand-over needs through `(*this).field` accesses that end
// before the push, push `this`, and never touch it again. Templates:
// `TranspilerJob::run_from_worker_thread` / `dispatch_to_main_thread` in
// src/jsc/RuntimeTranspilerStore.rs, `PatchTask::run_from_thread_pool` in
// src/install/patch_install.rs, `NetworkTask::notify` in
// src/install/NetworkTask.rs, `Task::callback` in src/install/PackageManagerTask.rs.
//
// Scope: the exclusive spellings below (`from_mut(self)`, `&mut *self`,
// `&raw mut *self`, `self as *mut _`, ...), with `self` as the receiver and
// `.push(` as the callee, inline or through a local of the same function.
// Outside it: the shared spellings (`from_ref(self)`, `&*self`; what this tree
// pushes from a `&self` method is a same-thread registry entry, quic's
// `ENDPOINT_REGISTRY`, whose consumer neither writes nor frees), a pointer
// produced by a helper (`self.as_ptr()`), something the receiver owns
// (`NonNull::from(&mut self.task)`, `&raw mut self.task`), and reference
// parameters other than `self` (`fn f(this: &mut Task)` pushing
// `NonNull::from(this)`; a local reference is not protected and the push moves
// it, but a reference *parameter* pushed that way is the same bug, convert it
// on sight). Siblings: self-receiver-reclaim.test.ts,
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

// The publish. Anchored on the argument below, so the `Vec::push` calls all
// over the tree only count when what is pushed is the receiver's address.
// `\s*` after the paren so a rustfmt-wrapped argument still matches.
const PUSH = String.raw`\.\s*push\s*\(\s*`;

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

// `self` as a `NonNull`: from the reference itself (`NonNull::from(self)`,
// `NonNull::from(&mut *self)`; the `\)` right after `self` keeps
// `NonNull::from(&mut *self.field)` out) or wrapped around a raw spelling.
const SELF_AS_NONNULL = [
  String.raw`${PATH}NonNull::from\(\s*(?:&\s*mut\s+\*\s*)?self\s*\)`,
  String.raw`${PATH}NonNull::(?:new_unchecked|new)${TURBOFISH}\(\s*(?:${SELF_AS_RAW})\s*\)`,
].join("|");

const SELF_AS_POINTER = `(?:${SELF_AS_RAW}|${SELF_AS_NONNULL})`;

// Method calls that keep the address: how a `NonNull::new(..)` is unwrapped
// and how a binding is adapted to the queue's element type.
const SAME_ADDRESS = String.raw`(?:\s*\.\s*(?:cast(?:_mut|_const)?${TURBOFISH}\(\)|as_ptr\(\)|unwrap\(\)|expect\([^)]*\)))*`;

// The argument has to end there: `.push(NonNull::from(self).foo)` is not
// this shape, and neither is `.push(p.field)` for a binding `p` below.
const ARG_END = String.raw`\s*[,)]`;

const DIRECT = new RegExp(`${PUSH}${SELF_AS_POINTER}${SAME_ADDRESS}${ARG_END}`, "g");

// A local bound to the receiver's address, then pushed further down the same
// function (which ends at the next `fn` item; a closure inside it is the same
// function for this purpose). `let p: *mut Self = self;` is the coercion
// spelling; without the annotation `let p = self;` is just another reference.
const BINDING_HEAD = String.raw`\blet\s+(?:mut\s+)?(\w+)\s*`;
const SELF_POINTER_BINDINGS = [
  new RegExp(`${BINDING_HEAD}(?::[^=;]*)?=\\s*${SELF_AS_POINTER}${SAME_ADDRESS}\\s*;`, "g"),
  new RegExp(`${BINDING_HEAD}:\\s*\\*(?:mut|const)\\b[^=;]*=\\s*self\\s*;`, "g"),
];
const FN_ITEM = /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe|extern\s+"[^"]*")\s+)*fn\s+\w+/m;

// The binding pushed as is, or wrapped into a `NonNull` at the push.
function pushOfBinding(name: string): RegExp {
  const wrapped = String.raw`${PATH}NonNull::(?:new_unchecked|new|from)${TURBOFISH}\(\s*${name}${SAME_ADDRESS}\s*\)`;
  return new RegExp(`${PUSH}(?:${wrapped}|\\b${name})${SAME_ADDRESS}${ARG_END}`);
}

/** Byte offsets (into `stripped`) of every banned push in one file. */
function findPushes(stripped: string): number[] {
  const hits: number[] = [];
  for (const m of stripped.matchAll(DIRECT)) hits.push(m.index);
  for (const pattern of SELF_POINTER_BINDINGS) {
    for (const binding of stripped.matchAll(pattern)) {
      const start = binding.index + binding[0].length;
      const rest = stripped.slice(start);
      const fnEnd = rest.search(FN_ITEM);
      const body = fnEnd === -1 ? rest : rest.slice(0, fnEnd);
      const push = body.search(pushOfBinding(binding[1]));
      if (push !== -1) hits.push(start + push);
    }
  }
  return hits.sort((a, b) => a - b);
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

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
  for (const offset of findPushes(stripped)) {
    offenders.push(`${source}:${lineOf(stripped, offset)}`);
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
    // A local reference parameter, moved into the push.
    "installer.task_queue.push(core::ptr::NonNull::from(this));",
    // Something the receiver owns.
    "queue.push(NonNull::from(&mut *self.inner));",
    "queue.push(NonNull::from(&mut self.task));",
    "batch.push(Batch::from(&raw mut self.task));",
    "batch.push(Batch::from(core::ptr::addr_of_mut!(self.task)));",
    "self.tasks.push(NonNull::new_unchecked(concurrent));",
    "self.entries.push(item);",
    "out.push(self.len);",
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
  expect(banned.filter(s => findPushes(s).length === 0)).toEqual([]);
  expect(allowed.filter(s => findPushes(s).length !== 0)).toEqual([]);
});

test("no method pushes its own receiver onto a queue", () => {
  expect(offenders).toEqual([]);
});
