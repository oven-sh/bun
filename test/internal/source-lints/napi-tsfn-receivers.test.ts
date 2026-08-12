import { file } from "bun";
import { expect, test } from "bun:test";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `ThreadSafeFunction` (src/runtime/napi/napi_body.rs) is reached through a
// raw pointer from every side, never through a reference to the whole object.
//
// The object is shared for its whole life: addon threads take `lock`, wait on
// `blocking_condvar` and write `thread_count` / `queue` / `closing` from
// `napi_call_threadsafe_function`, `napi_acquire_threadsafe_function` and
// `napi_release_threadsafe_function` at any time, including while the JS
// thread is inside `dispatch_one` running the user's callback, or inside
// `env_teardown`, after whose last phase an addon thread may even free the
// allocation. A reference argument (a `&mut self` / `&self` receiver, or a
// `this: &mut ThreadSafeFunction` parameter, which is the same thing under a
// different name) claims the object for the duration of the call: a write to
// any byte of it from anywhere else while the call is running (or, for
// `env_teardown`, freeing it) is rejected by both aliasing models (Tree
// Borrows, which `bun run rust:miri` uses: "foreign read access would cause
// the protected tag ... to become Disabled; protected tags must never be
// Disabled", naming the method; Stacked Borrows: "would remove [Unique for
// <tag>] which is strongly protected"), and it is what rustc's `noalias` on
// the argument tells LLVM to rely on. The callback also re-enters the object
// from the same thread: `napi_unref_threadsafe_function` called from inside it
// used to form a second `&mut Self` under the `&mut self` of `call`, which
// fails the same way with one thread. `&self` is not exempt with the current
// layout: `queue.data` (written by addon threads under `lock`) and the JS
// thread's plain fields (`poll_ref`, `callback`, ..., written by
// `maybe_queue_finalizer`, `env_teardown` and the re-entrant unref) are
// ordinary bytes, so a shared reference covering them is invalidated by those
// writes too. If those fields are ever moved into `Guarded` / `JsCell`, `&self`
// becomes sound for everything except the functions that post or free the
// object, and this lint should be narrowed to `&mut` then; until that layout
// change, no reference to the whole object is right.
//
// So the functions take `this: *mut ThreadSafeFunction` and borrow one field
// per statement (`(*this).lock.lock_guard()`, `(*this).queue.data.read_item()`),
// and the `extern "C"` entry points project the field they need straight off
// the handle (`(*func).poll_ref.ref_(..)`). This lint holds that shape for the
// inherent `impl ThreadSafeFunction` and the `*threadsafe_function*` entry
// points:
//
//   1. the functions named in PINNED take the object as `this: *mut ..`;
//   2. no other parameter whose type names the object is anything but a raw
//      pointer, a by-value move or a `Box` (so `this: &mut ThreadSafeFunction`,
//      `Option<&mut Self>`, `NonNull<Self>` are all out);
//   3. no method takes a reference receiver, except the ratcheted list below;
//   4. no body reborrows the whole object from the handle (`&mut *this`,
//      `&*func`, `func.as_mut()`), except the ratcheted count below.
//
// Out of scope, knowingly: a reborrow through a local alias of the handle
// (`let p = this; .. &mut *p`), a reference formed by a caller outside
// src/runtime/napi/ (the `task_tag::ThreadSafeFunction` arm in
// src/runtime/dispatch.rs passes `cast_ptr!`, not `cast!`), and trait impls
// (`Drop`, `Taskable`), whose receivers the trait dictates and which run once
// nothing else can reach the object. `TsfnQueue::is_blocked(&self)` borrows
// only the queue, under `lock`. Siblings: fn-long-mut-reborrow.test.ts (the
// fn-long `let x = &mut *ptr` form, tree-wide), self-receiver-reclaim.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const napiSources = globAllSources().rust.filter(
  p => p.endsWith(".rs") && path.relative(root, p).replaceAll(path.sep, "/").startsWith("src/runtime/napi/"),
);

// Functions that must take the object as their first parameter, as a raw
// pointer. The JS-thread side plus the two addon-thread roots that already had
// the shape; append the rest of the addon-thread side as it is converted.
const PINNED = [
  "on_dispatch",
  "dispatch_one",
  "call",
  "maybe_queue_finalizer",
  "env_teardown",
  "push",
  "release",
  "destroy",
  "free_orphaned",
];

// Methods of `impl ThreadSafeFunction` still taking a reference receiver.
// These are the addon-thread half of the same hazard (`push` and `release`
// reach `enqueue` / `release_locked` through an autoref of `*this`; the entry
// point for `acquire` reborrows the whole object, see below); #37741 converts
// them, after which both lists are empty. Delete each name as it is
// converted; do not add any.
const REFERENCE_RECEIVERS_STILL_TO_CONVERT = [
  "acquire",
  "enqueue",
  "is_closing",
  "release_locked",
  "schedule_dispatch",
];

// Functions allowed exactly N whole-object reborrows of the handle, for the
// same reason. Lower when converted; do not add entries.
const REBORROWS_STILL_TO_CONVERT: Record<string, number> = {
  napi_acquire_threadsafe_function: 1,
};

// The names the handle goes by in the functions this lint covers. A new name
// must be added here for the reborrow check to see it.
const HANDLE = String.raw`(?:this|func|function|tsfn)`;
const WHOLE_OBJECT_REBORROW = new RegExp(
  [String.raw`&\s*(?:mut\s+)?\*\s*${HANDLE}\b`, String.raw`\b${HANDLE}\s*\.\s*as_(?:mut|ref)\s*\(`].join("|"),
  "g",
);

const INHERENT_IMPL = /^impl\s+ThreadSafeFunction\s*\{/gm;
// A file-level `extern "C" fn` whose name mentions the object, however it is
// qualified. The parameter list is parsed from the `(` by `parseFn`.
const TSFN_ENTRY_POINT =
  /^(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?extern\s+"C"\s+fn\s+(\w*threadsafe_function\w*)\s*\(/gm;
// Every fn item inside an impl block (generics included); the parameter list
// is parsed from the `(` by `parseFn`.
const FN_HEAD = /\bfn\s+(\w+)\s*(?:<[^()]*>)?\s*\(/g;
const REFERENCE_RECEIVER = /^(?:&\s*(?:'\w+\s+)?(?:mut\s+)?self\b|(?:mut\s+)?self\s*:\s*&)/;
const NAMES_THE_OBJECT = /\b(?:Self|ThreadSafeFunction)\b/;
// The three ways a parameter may take the object: raw pointer, by value, boxed.
const ALLOWED_OBJECT_PARAM =
  /^(?:\*\s*(?:mut|const)\s+(?:Self|ThreadSafeFunction)|(?:Self|ThreadSafeFunction)|Box\s*<\s*(?:Self|ThreadSafeFunction)\s*>)$/;
const PINNED_FIRST_PARAM = /^this\s*:\s*\*\s*mut\s+(?:Self|ThreadSafeFunction)$/;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Comments out (full-line and trailing), newlines kept so line numbers hold.
 * The covered code has no string literals containing `//`. */
function stripComments(text: string): string {
  return text.replace(/^[ \t]*\/\/.*$/gm, "").replace(/[ \t]\/\/.*$/gm, "");
}

/** Index one past the bracket closing the one at `open`, or -1 if unbalanced. */
function closeOf(text: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === openCh) depth++;
    else if (c === closeCh && --depth === 0) return i + 1;
  }
  return -1;
}

/** Splits a parameter list on its top-level commas (generics and parens may
 * contain commas of their own). */
function splitParams(params: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < params.length; i++) {
    const c = params[i];
    if (c === "<" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(params.slice(start, i));
      start = i + 1;
    }
  }
  out.push(params.slice(start));
  return out.map(p => p.trim().replace(/\s+/g, " ")).filter(Boolean);
}

interface Fn {
  name: string;
  params: string[];
  /** Offsets into the text `parseFn` was given: the `fn` keyword and one past the body's `}`. */
  start: number;
  end: number;
}

/** The fn item whose head regex match is `head`, in `text`. */
function parseFn(text: string, head: RegExpMatchArray, source: string): Fn {
  const name = head[1];
  const paramsOpen = head.index + head[0].length - 1;
  const paramsEnd = closeOf(text, paramsOpen, "(", ")");
  if (paramsEnd === -1) throw new Error(`${source}:${lineOf(text, head.index)}: unbalanced parameter list in ${name}`);
  const params = splitParams(text.slice(paramsOpen + 1, paramsEnd - 1));
  // `fn f(..) -> T where ..;` (a declaration) has no body; every fn this lint
  // looks at has one, so a missing body is a parse failure worth hearing about.
  const bodyOpen = text.indexOf("{", paramsEnd);
  const end = bodyOpen === -1 ? -1 : closeOf(text, bodyOpen, "{", "}");
  if (end === -1) throw new Error(`${source}:${lineOf(text, head.index)}: could not find the body of ${name}`);
  return { name, params, start: head.index, end };
}

interface Audit {
  /** Inherent impl blocks found (normally one). */
  impls: number;
  /** `name -> first parameter` of every method of those impls, in source order. */
  methods: Record<string, string>;
  /** Methods whose receiver is a reference. */
  referenceReceivers: string[];
  /** `*threadsafe_function*` entry points found. */
  entryPoints: string[];
  /** `file:line: function: param` for every non-receiver parameter that names the object other than as allowed. */
  referenceParams: string[];
  /** `function name -> count` of whole-object reborrows, impl methods and entry points alike. */
  reborrows: Record<string, number>;
  /** `file:line: function: text` of every reborrow, for the failure message. */
  reborrowSites: string[];
}

function emptyAudit(): Audit {
  return {
    impls: 0,
    methods: {},
    referenceReceivers: [],
    entryPoints: [],
    referenceParams: [],
    reborrows: {},
    reborrowSites: [],
  };
}

function audit(source: string, text: string, into: Audit): void {
  const stripped = stripComments(text);
  for (const m of stripped.matchAll(INHERENT_IMPL)) {
    const open = m.index + m[0].length - 1;
    const end = closeOf(stripped, open, "{", "}");
    if (end === -1) throw new Error(`${source}:${lineOf(stripped, m.index)}: unbalanced impl block`);
    into.impls++;
    const body = stripped.slice(0, end);
    FN_HEAD.lastIndex = open;
    for (let head = FN_HEAD.exec(body); head !== null; head = FN_HEAD.exec(body)) {
      const fn = parseFn(body, head, source);
      into.methods[fn.name] = fn.params[0] ?? "";
      if (REFERENCE_RECEIVER.test(fn.params[0] ?? "")) into.referenceReceivers.push(fn.name);
      check(source, stripped, fn, into);
      // Skip the body so a nested closure or item does not count as a method.
      FN_HEAD.lastIndex = fn.end;
    }
  }
  for (const m of stripped.matchAll(TSFN_ENTRY_POINT)) {
    const fn = parseFn(stripped, m, source);
    into.entryPoints.push(fn.name);
    check(source, stripped, fn, into);
  }
}

function check(source: string, stripped: string, fn: Fn, into: Audit): void {
  const where = `${source}:${lineOf(stripped, fn.start)}: ${fn.name}`;
  for (const param of fn.params) {
    if (REFERENCE_RECEIVER.test(param) || /^(?:mut\s+)?self\b/.test(param)) continue; // the receiver check's job
    const type = param.slice(param.indexOf(":") + 1).trim();
    if (NAMES_THE_OBJECT.test(type) && !ALLOWED_OBJECT_PARAM.test(type))
      into.referenceParams.push(`${where}: ${param}`);
  }
  const body = stripped.slice(fn.start, fn.end);
  for (const r of body.matchAll(WHOLE_OBJECT_REBORROW)) {
    into.reborrows[fn.name] = (into.reborrows[fn.name] ?? 0) + 1;
    into.reborrowSites.push(`${source}:${lineOf(stripped, fn.start + r.index)}: ${fn.name}: ${r[0]}`);
  }
}

const tree = emptyAudit();
for (const abs of napiSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  audit(source, await file(abs).text(), tree);
}

test("the audit recognizes the shapes it claims to", () => {
  const a = emptyAudit();
  audit(
    "x.rs",
    `
impl ThreadSafeFunction {
    pub(crate) fn new(init: ThreadSafeFunction) -> *mut ThreadSafeFunction { heap::into_raw(Box::new(init)) }
    // A comment mentioning &mut *this does not count.
    unsafe fn dispatch_one(this: *mut ThreadSafeFunction, is_first: bool) -> bool {
        let _g = unsafe { (*this).lock.lock_guard() }; // nor does &*this here
        let env = unsafe { &*env };
        let f = |x: &mut Self| x.poll_ref.disable();
        unsafe { (*this).queue.data.read_item() }.is_some()
    }
    unsafe fn call(
        this: *mut Self,
        cb: Option<extern "C" fn(*mut c_void, *mut c_void)>,
        pair: (u32, u32),
    ) {
    }
    pub(crate) unsafe fn destroy(this: *mut ThreadSafeFunction) {
        drop(unsafe { bun_core::heap::take(this) });
    }
    fn consume(boxed: Box<Self>) {}
    fn is_closing(&self) -> bool { true }
    fn enqueue(&mut self, ctx: *mut c_void) {}
    fn by_ref(self: &Self) {}
    fn with_lifetime<'a>(&'a mut self) -> &'a Mutex { &self.lock }
    fn by_param(this: &mut ThreadSafeFunction, other: &Self, maybe: Option<&mut Self>, nn: NonNull<ThreadSafeFunction>) {}
    unsafe fn reborrows(this: *mut Self) {
        unsafe { &mut *this }.tick();
        let shared = unsafe { & *this };
        unsafe { this.as_mut() }.unwrap().tick();
    }
}
impl Drop for ThreadSafeFunction {
    fn drop(&mut self) { let _ = &mut *self; }
}
extern "C" fn napi_acquire_threadsafe_function(func: napi_threadsafe_function) -> napi_status {
    unsafe { &mut *func }.acquire()
}
pub(crate) unsafe extern "C" fn napi_ref_threadsafe_function(env_: napi_env, func: napi_threadsafe_function) -> napi_status {
    // SAFETY: prose about &mut *func.
    unsafe { (*func).poll_ref.ref_(bun_io::js_vm_ctx()) };
    NapiStatus::ok as napi_status
}
extern "C" fn napi_internal_threadsafe_function_env_teardown(tsfn: *mut c_void) {
    let this = tsfn.cast::<ThreadSafeFunction>();
    if unsafe { ThreadSafeFunction::env_teardown(this) } {
        unsafe { ThreadSafeFunction::free_orphaned(this) };
    }
}
extern "C" fn napi_internal_threadsafe_function_by_ref(func: &mut ThreadSafeFunction) -> napi_status {
    func.poll_ref.disable();
    NapiStatus::ok as napi_status
}
extern "C" fn napi_create_async_work(env: napi_env) -> napi_status { unsafe { &mut *env }.ok() }
`,
    a,
  );
  expect(a).toEqual({
    impls: 1,
    methods: {
      new: "init: ThreadSafeFunction",
      dispatch_one: "this: *mut ThreadSafeFunction",
      call: "this: *mut Self",
      destroy: "this: *mut ThreadSafeFunction",
      consume: "boxed: Box<Self>",
      is_closing: "&self",
      enqueue: "&mut self",
      by_ref: "self: &Self",
      with_lifetime: "&'a mut self",
      by_param: "this: &mut ThreadSafeFunction",
      reborrows: "this: *mut Self",
    },
    referenceReceivers: ["is_closing", "enqueue", "by_ref", "with_lifetime"],
    entryPoints: [
      "napi_acquire_threadsafe_function",
      "napi_ref_threadsafe_function",
      "napi_internal_threadsafe_function_env_teardown",
      "napi_internal_threadsafe_function_by_ref",
    ],
    referenceParams: [
      "x.rs:25: by_param: this: &mut ThreadSafeFunction",
      "x.rs:25: by_param: other: &Self",
      "x.rs:25: by_param: maybe: Option<&mut Self>",
      "x.rs:25: by_param: nn: NonNull<ThreadSafeFunction>",
      "x.rs:49: napi_internal_threadsafe_function_by_ref: func: &mut ThreadSafeFunction",
    ],
    reborrows: { reborrows: 3, napi_acquire_threadsafe_function: 1 },
    reborrowSites: [
      "x.rs:27: reborrows: &mut *this",
      "x.rs:28: reborrows: & *this",
      "x.rs:29: reborrows: this.as_mut(",
      "x.rs:36: napi_acquire_threadsafe_function: &mut *func",
    ],
  });
});

test("ThreadSafeFunction is still where this lint looks for it", () => {
  // If this fails, the impl or the entry points moved or were renamed: update
  // the patterns and lists above rather than the assertions below.
  expect(tree.impls).toBe(1);
  expect(Object.keys(tree.methods)).toEqual(expect.arrayContaining(PINNED));
  expect(tree.entryPoints).toEqual(
    expect.arrayContaining([
      "napi_create_threadsafe_function",
      "napi_call_threadsafe_function",
      "napi_acquire_threadsafe_function",
      "napi_release_threadsafe_function",
      "napi_ref_threadsafe_function",
      "napi_unref_threadsafe_function",
      "napi_internal_threadsafe_function_env_teardown",
    ]),
  );
});

test("the pinned functions take the object as `this: *mut`", () => {
  const firstParams = Object.fromEntries(PINNED.map(name => [name, tree.methods[name]]));
  expect(firstParams).toEqual(
    Object.fromEntries(PINNED.map(name => [name, expect.stringMatching(PINNED_FIRST_PARAM)])),
  );
});

test("no other parameter takes the object by reference", () => {
  expect(tree.referenceParams).toEqual([]);
});

test("no ThreadSafeFunction method takes a reference receiver, beyond the ones still being converted", () => {
  // Exact: a new `&self` / `&mut self` method fails this, and so does leaving
  // a converted one in the list.
  expect([...tree.referenceReceivers].sort()).toEqual([...REFERENCE_RECEIVERS_STILL_TO_CONVERT].sort());
});

test("neither the methods nor the entry points reborrow the whole object from its pointer", () => {
  const over = Object.keys(tree.reborrows).filter(fn => tree.reborrows[fn] > (REBORROWS_STILL_TO_CONVERT[fn] ?? 0));
  expect(tree.reborrowSites.filter(site => over.some(fn => site.includes(`: ${fn}: `)))).toEqual([]);
  // Ratchet the other way too.
  expect(tree.reborrows).toEqual(REBORROWS_STILL_TO_CONVERT);
});
