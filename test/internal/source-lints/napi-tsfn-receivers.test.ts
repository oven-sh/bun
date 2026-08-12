import { file } from "bun";
import { expect, test } from "bun:test";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `ThreadSafeFunction` (src/runtime/napi/napi_body.rs) is reached through a
// raw pointer from every side, never through a `self` receiver.
//
// The object is shared for its whole life: addon threads take `lock`, wait on
// `blocking_condvar` and write `thread_count` / `queue` / `closing` from
// `napi_call_threadsafe_function`, `napi_acquire_threadsafe_function` and
// `napi_release_threadsafe_function` at any time, including while the JS
// thread is inside `dispatch_one` running the user's callback, or inside
// `env_teardown`, after whose last phase an addon thread may even free the
// allocation. A `&self` / `&mut self` argument claims the object for the
// duration of the call: a write to any byte of it from anywhere else while
// the call is running (or, for `env_teardown`, freeing it) is rejected by both
// aliasing models (Tree Borrows, which `bun run rust:miri` uses: "foreign read
// access would cause the protected tag ... to become Disabled; protected tags
// must never be Disabled", naming the `&mut self` method; Stacked Borrows:
// "would remove [Unique for <tag>] which is strongly protected"), and it is
// what rustc's `noalias` on the argument tells LLVM to rely on. The callback
// also re-enters the object from the same thread: `napi_unref_threadsafe_
// function` called from inside it used to form a second `&mut Self` under the
// `&mut self` of `call`, which fails the same way with one thread.
//
// So the methods take `this: *mut ThreadSafeFunction` and borrow one field per
// statement (`(*this).lock.lock_guard()`, `(*this).queue.data.read_item()`),
// and the `extern "C"` entry points project the field they need straight off
// the handle (`(*func).poll_ref.ref_(..)`) instead of reborrowing the whole
// object. This lint holds that shape:
//
//   1. no method of the inherent `impl ThreadSafeFunction` takes a reference
//      receiver, except the ratcheted list below;
//   2. neither those methods nor the `*threadsafe_function*` entry points
//      reborrow the whole object from the pointer (`&mut *this`, `&*func`,
//      `func.as_mut()`), which is the same claim spelled differently.
//
// Trait impls (`Drop`, `Taskable`) are not covered: their receivers are
// dictated by the trait and they run once nothing else can reach the object.
// `TsfnQueue::is_blocked(&self)` borrows only the queue, under `lock`.
// Siblings: fn-long-mut-reborrow.test.ts (the fn-long `let x = &mut *ptr`
// form of the same claim, tree-wide), self-receiver-reclaim.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const napiSources = globAllSources().rust.filter(
  p => p.endsWith(".rs") && path.relative(root, p).replaceAll(path.sep, "/").startsWith("src/runtime/napi/"),
);

// Methods of `impl ThreadSafeFunction` still taking a reference receiver.
// These are the addon-thread half of the same hazard (`push` and `release`
// reach `enqueue` / `release_locked` through an autoref of `*this`; the entry
// point for `acquire` reborrows the whole object, see below); #37741 converts
// them, after which both lists below are empty. Delete each name as it is
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
const TSFN_ENTRY_POINT = /^extern\s+"C"\s+fn\s+(\w*threadsafe_function\w*)\s*\(/gm;
// `fn name(params)`: the receiver, if any, is the first parameter. `[^)]*`
// cannot cross a nested paren, but a receiver never follows one.
const FN_ITEM = /\bfn\s+(\w+)\s*\(\s*([^)]*)\)/g;
const REFERENCE_RECEIVER = /^(?:&\s*(?:mut\s+)?self\b|self\s*:\s*&)/;

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Comments out (full-line and trailing), newlines kept so line numbers hold.
 * The covered code has no string literals containing `//`. */
function stripComments(text: string): string {
  return text.replace(/^[ \t]*\/\/.*$/gm, "").replace(/[ \t]\/\/.*$/gm, "");
}

/** The `{ .. }` block whose opening brace is at `open`, or null if unbalanced. */
function blockAt(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return null;
}

interface Audit {
  /** Inherent impl blocks found (normally one). */
  impls: number;
  /** Every method of those impls, in source order. */
  methods: string[];
  /** Methods whose receiver is a reference. */
  referenceReceivers: string[];
  /** `*threadsafe_function*` entry points found. */
  entryPoints: string[];
  /** `function name -> count` of whole-object reborrows, impl methods and entry points alike. */
  reborrows: Record<string, number>;
  /** `file:line: function: text` of every reborrow, for the failure message. */
  reborrowSites: string[];
}

function audit(source: string, text: string, into: Audit): void {
  const stripped = stripComments(text);
  for (const m of stripped.matchAll(INHERENT_IMPL)) {
    const body = blockAt(stripped, m.index + m[0].length - 1);
    if (body === null) throw new Error(`${source}:${lineOf(stripped, m.index)}: unbalanced impl block`);
    into.impls++;
    const base = m.index + m[0].length - 1;
    // Split the impl into per-method regions so reborrows are attributed to
    // the method containing them.
    const items = [...body.matchAll(FN_ITEM)];
    items.forEach((item, i) => {
      const name = item[1];
      into.methods.push(name);
      if (REFERENCE_RECEIVER.test(item[2].trim())) into.referenceReceivers.push(name);
      const end = i + 1 < items.length ? items[i + 1].index : body.length;
      countReborrows(source, stripped, base, body.slice(item.index, end), item.index, name, into);
    });
  }
  for (const m of stripped.matchAll(TSFN_ENTRY_POINT)) {
    const open = stripped.indexOf("{", m.index);
    const body = open === -1 ? null : blockAt(stripped, open);
    if (body === null) throw new Error(`${source}:${lineOf(stripped, m.index)}: could not find the body of ${m[1]}`);
    into.entryPoints.push(m[1]);
    countReborrows(source, stripped, open, body, 0, m[1], into);
  }
}

function countReborrows(
  source: string,
  stripped: string,
  base: number,
  region: string,
  regionOffset: number,
  fn: string,
  into: Audit,
): void {
  for (const r of region.matchAll(WHOLE_OBJECT_REBORROW)) {
    into.reborrows[fn] = (into.reborrows[fn] ?? 0) + 1;
    into.reborrowSites.push(`${source}:${lineOf(stripped, base + regionOffset + r.index)}: ${fn}: ${r[0]}`);
  }
}

function emptyAudit(): Audit {
  return { impls: 0, methods: [], referenceReceivers: [], entryPoints: [], reborrows: {}, reborrowSites: [] };
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
        unsafe { (*this).queue.data.read_item() }.is_some()
    }
    pub(crate) unsafe fn destroy(this: *mut ThreadSafeFunction) {
        drop(unsafe { bun_core::heap::take(this) });
    }
    fn is_closing(&self) -> bool { true }
    fn enqueue(&mut self, ctx: *mut c_void) {}
    fn by_ref(self: &Self) {}
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
extern "C" fn napi_ref_threadsafe_function(env_: napi_env, func: napi_threadsafe_function) -> napi_status {
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
extern "C" fn napi_create_async_work(env: napi_env) -> napi_status { unsafe { &mut *env }.ok() }
`,
    a,
  );
  expect(a).toEqual({
    impls: 1,
    methods: ["new", "dispatch_one", "destroy", "is_closing", "enqueue", "by_ref", "reborrows"],
    referenceReceivers: ["is_closing", "enqueue", "by_ref"],
    entryPoints: [
      "napi_acquire_threadsafe_function",
      "napi_ref_threadsafe_function",
      "napi_internal_threadsafe_function_env_teardown",
    ],
    reborrows: { reborrows: 3, napi_acquire_threadsafe_function: 1 },
    reborrowSites: [
      "x.rs:17: reborrows: &mut *this",
      "x.rs:18: reborrows: & *this",
      "x.rs:19: reborrows: this.as_mut(",
      "x.rs:26: napi_acquire_threadsafe_function: &mut *func",
    ],
  });
});

test("ThreadSafeFunction is still where this lint looks for it", () => {
  // If this fails, the impl or the entry points moved or were renamed: update
  // the patterns above rather than the assertions below.
  expect(tree.impls).toBe(1);
  expect(tree.methods).toContain("on_dispatch");
  expect(tree.methods).toContain("env_teardown");
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
