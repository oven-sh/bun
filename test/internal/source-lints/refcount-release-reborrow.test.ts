import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `ThreadSafeRefCount::<T>::release(p)` is the decrement that reports the 1→0
// transition instead of destroying (src/ptr/ref_count.rs): its only purpose is
// to let the releasing thread hand the now-unreferenced object to the thread
// that may destroy it, by posting it there. From the moment that post lands
// the consumer may free the object, and it routinely does so before the post
// call has returned: `VmHandle::post` pushes the task and wakes the loop, and
// the JS thread can run the hop during the wake-up. So after `release` has
// returned `true`, the function must reach the object through the raw pointer
// only:
//
//   - No reference to it may be live: a `&self` receiver or a `&LoopHandle`
//     pointing into the object is a protected argument for the whole call it
//     was passed to, and freeing protected memory is UB under both aliasing
//     models whether or not the callee reads it again (Tree Borrows, which
//     `bun run rust:miri` uses: "deallocation through <tag> is forbidden ...
//     the strongly protected tag disallows deallocations"; Stacked Borrows:
//     "deallocating while item [Unique] is strongly protected"). Codegen
//     relies on the same thing: reference arguments are `dereferenceable`
//     for the duration of the call.
//   - In particular the post itself must not go through a field of the
//     object (`(*p).loop_handle.post_task(..)` auto-refs that field for the
//     duration of the post). Copy the handle out first and post through the
//     copy, as `post_job` in src/jsc/VmHandle.rs, `S3HttpSimpleTask::
//     http_callback` in src/runtime/webcore/s3/simple_request.rs and
//     `FetchTasklet::deref_from_thread` in src/runtime/webcore/fetch/
//     FetchTasklet.rs do. `(*p).field` reads that end within their own
//     statement (the clone, an atomic load) are fine.
//
// `FetchTasklet::deref_from_thread` was the instance this was written for: it
// formed `&FetchTasklet` after the release and posted the deinit hop through
// it, so every fetch whose last ref dropped on the HTTP thread freed the
// tasklet under two live reference arguments.
//
// The rule is checked from the release to the end of the function: any
// spelling that forms a reference to `*p` (`&*p`, `&mut *p`, `&(*p).field`,
// `p.as_ref()`, the tree's reborrow helpers applied to `p`, `ParentRef::
// from(..p..)`), any later use of a reference binding made from `p` earlier
// in the same function, and any `.post(..)` / `.post_task(..)` whose receiver
// is spelled from `(*p)`. References that die before the release are fine;
// a reference formed after it is banned even if it happens to die before the
// post, because "raw pointer only after release" is the invariant the next
// edit to the function can be checked against, and "dies before the post"
// is not.
//
// Scope: functions that call `release` with a plain identifier. The same
// hand-over exists without a refcount: a task posted as the object's final
// callback through a field of that object, with the consumer freeing it
// (at the time of writing `S3HttpDownloadStreamingTask::http_callback` in
// src/runtime/webcore/s3/download_stream.rs, `napi_async_work::
// post_to_js_thread` in src/runtime/napi/napi_body.rs and `StatWatcher::
// post_to_js_thread` in src/runtime/node/node_fs_stat_watcher.rs, each
// tracked for its own conversion). Those have no anchor this regex can key
// on; convert anything of that shape on sight the same way. Siblings:
// self-receiver-reclaim.test.ts (freeing through the receiver),
// fn-long-mut-reborrow.test.ts.

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

// `ThreadSafeRefCount::<Self>::release(this)`, however the path in front is
// spelled; the argument is the pointer the rest of the function is checked
// against. `\w*RefCount` also covers a non-atomic `RefCount` gaining the same
// entry point.
const RELEASE = String.raw`\b\w*RefCount(?:::<[^>]*>)?::release\s*\(\s*(\w+)\s*\)`;

// A `fn` item at the start of a line: the unit the check runs within (a
// closure inside the function counts as the function). Same shape as the
// other function-scoped lints in this directory.
const FN_ITEM = String.raw`^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe|extern\s+"[^"]*")\s+)*fn\s`;
const NEXT_FN = new RegExp(FN_ITEM, "m");
const EVERY_FN = new RegExp(FN_ITEM, "gm");

/** The spellings that turn `p` (a raw pointer) into a reference to its pointee. */
function referenceTo(p: string): string {
  return [
    // `&*p`, `&mut *p`, `&(*p).field`, `&mut (*p).field`. `&raw` is a raw
    // pointer and does not match.
    String.raw`&\s*(?:mut\s+)?(?:\*\s*${p}\b|\(\s*\*\s*${p}\s*\))`,
    String.raw`\b${p}\s*\.\s*as_(?:ref|mut)\s*\(`,
    // The tree's `*mut T -> &T` / `&mut T` helpers (`Self::from_raw_ref`,
    // `bun_ptr::callback_ctx::<T>`), applied to `p`.
    String.raw`\b(?:from_raw_ref|from_raw_mut|from_ctx|callback_ctx)(?:::<[^>]*>)?\s*\(\s*${p}\b`,
    // `ParentRef` derefs to `&T`; `p` is usually wrapped (`NonNull::new(p)`).
    String.raw`\bParentRef::from(?:_raw(?:_mut)?)?\s*\([^;]*\b${p}\b`,
  ].join("|");
}

/** `(*p).loop_handle.post_task(..)`, `(*p).post(..)`: the post auto-refs into `*p`. */
function postThrough(p: string): RegExp {
  return new RegExp(String.raw`\(\s*\*\s*${p}\s*\)(?:\s*\.\s*\w+)*\s*\.\s*post(?:_task)?\s*\(`, "g");
}

/** `let r = <reference to *p>;`, optionally typed and/or wrapped in `unsafe { .. }`. */
function referenceBindings(p: string): RegExp {
  return new RegExp(
    String.raw`\blet\s+(?:mut\s+)?(\w+)\s*(?::[^=;]*)?=\s*(?:unsafe\s*\{\s*)?(?:[\w:]+::)?(?:${referenceTo(p)})`,
    "g",
  );
}

/**
 * How many `release` calls `stripped` has, and the byte offset (into
 * `stripped`) of every banned access that follows one of them.
 */
function findOffenders(stripped: string): { releases: number; hits: number[] } {
  const hits = new Set<number>();
  let releases = 0;
  for (const release of stripped.matchAll(new RegExp(RELEASE, "g"))) {
    releases++;
    const p = release[1];
    let fnStart = 0;
    for (const item of stripped.slice(0, release.index).matchAll(EVERY_FN)) fnStart = item.index;
    const tailStart = release.index + release[0].length;
    const rest = stripped.slice(tailStart);
    const fnEnd = rest.search(NEXT_FN);
    const tail = fnEnd === -1 ? rest : rest.slice(0, fnEnd);

    for (const m of tail.matchAll(new RegExp(referenceTo(p), "g"))) hits.add(tailStart + m.index);
    for (const m of tail.matchAll(postThrough(p))) hits.add(tailStart + m.index);
    // A reference made before the release is dead once it returns true; any
    // use of it afterwards is the same bug.
    const head = stripped.slice(fnStart, release.index);
    for (const binding of head.matchAll(referenceBindings(p))) {
      const use = tail.search(new RegExp(String.raw`\b${binding[1]}\b`));
      if (use !== -1) hits.add(tailStart + use);
    }
  }
  return { releases, hits: [...hits].sort((a, b) => a - b) };
}

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

const offenders: string[] = [];
let releases = 0;
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
  const found = findOffenders(stripped);
  releases += found.releases;
  for (const offset of found.hits) {
    const lineStart = stripped.lastIndexOf("\n", offset) + 1;
    const line = stripped.slice(lineStart).split("\n", 1)[0].trim();
    offenders.push(`${source}:${lineOf(stripped, offset)}: ${line}`);
  }
}

test("scans a non-empty set of tracked Rust sources, including a release() caller", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, and against `RELEASE` drifting away from how the tree
  // spells the call; either would make the ban below pass vacuously. If the
  // tree's last `release` caller goes away, delete this lint with it.
  expect(scanned).toBeGreaterThan(0);
  expect(releases).toBeGreaterThan(0);
});

test("the patterns match the banned spellings and nothing else", () => {
  const release = "if !unsafe { bun_ptr::ThreadSafeRefCount::<Self>::release(this) } {\n    return;\n}\n";
  const hop = "let task = ConcurrentTask::create(bun_event_loop::Task::init(this.cast::<FetchTaskletDeinitHop>()));\n";
  const banned = [
    // `deref_from_thread` as it was: `&Self` formed after the release, the
    // hop posted through it.
    `fn deref_from_thread(this: *mut FetchTasklet) {\n${release}let self_ = Self::from_raw_ref(this);\n${hop}let Posted::Queued = self_.post(task) else { unreachable!() };\n}\n`,
    // Posting through the handle field, or through the object itself.
    `${release}${hop}let Posted::Queued = (*this).loop_handle.post_task(task) else { unreachable!() };`,
    `${release}${hop}let Posted::Queued = (*this)\n    .loop_handle\n    .post_task(task)\nelse { unreachable!() };`,
    `${release}${hop}let _ = (*this).post(task);`,
    `${release}${hop}let _ = unsafe { &*this }.post(task);`,
    `${release}let this_ref = unsafe { &mut *this };\n${hop}this_ref.loop_handle.post_task(task);`,
    `${release}let handle = &(*this).loop_handle;\n${hop}handle.post_task(task);`,
    `${release}let handle = this.as_ref().unwrap().loop_handle.clone();`,
    `${release}let this_ref = bun_ptr::ParentRef::from(NonNull::new(this).expect("live"));\n${hop}this_ref.loop_handle.post_task(task);`,
    `${release}let this_ref = unsafe { bun_ptr::callback_ctx::<Self>(this) };\nthis_ref.post(task);`,
    // The reference was made before the release and is used after it.
    `let self_ = Self::from_raw_ref(this);\nself_.mutex.unlock();\n${release}${hop}let _ = self_.post(task);`,
    `let this_ref: &Self = unsafe { &*this };\n${release}let handle = this_ref.loop_handle.clone();`,
    `let this_ref = ParentRef::from(NonNull::new(this).expect("live"));\n${release}let handle = this_ref.loop_handle.clone();`,
    // A differently named pointer is checked under its own name.
    `if !unsafe { ThreadSafeRefCount::<Tasklet>::release(task) } { return; }\nlet t = unsafe { &*task };\nt.post(ct);`,
  ];
  const allowed = [
    // `deref_from_thread` now: the handle is copied out through the raw
    // pointer, the hop is built from the raw pointer, the post goes through
    // the copy.
    `fn deref_from_thread(this: *mut FetchTasklet) {\n${release}let handle = unsafe { (*this).loop_handle.clone() };\n${hop}let Posted::Queued = handle.post_task(task) else { unreachable!() };\n}\n`,
    // Raw place reads, raw pointers to fields, and the pointer itself.
    `${release}let queued = unsafe { (*this).has_schedule_callback.load(Ordering::Acquire) };`,
    `${release}let handle_ptr = unsafe { &raw const (*this).loop_handle };`,
    `${release}unsafe { (*this).scheduled_response_buffer = MutableString::default() };`,
    `${release}Self::post_deinit_hop(this);`,
    // References that die before the release.
    `let this_ref = Self::from_raw_ref(this);\nthis_ref.mutex.unlock();\n${release}let handle = unsafe { (*this).loop_handle.clone() };\nhandle.post_task(task);`,
    // References to other objects, and a different pointer's helpers.
    `${release}let sink = unsafe { &mut *sink_ptr };\nsink.post(task);`,
    `${release}let other = Self::from_raw_ref(other_ptr);\n(*other_ptr).loop_handle.post_task(task);`,
    // The rule only starts at the release; earlier code is not in scope, and
    // neither is the next function.
    `let self_ = Self::from_raw_ref(this);\nself_.post(task);\n${release}`,
    `${release}}\n\nfn clear_sink(this: *mut Self) {\n    let this_ref = unsafe { &mut *this };\n    this_ref.post(task);\n}`,
    // A reference binding in the previous function is not this function's.
    `fn a(this: *mut Self) {\n    let this_ref = unsafe { &*this };\n    this_ref.touch();\n}\n\nfn b(this: *mut Self) {\n    ${release}    let _ = this_ref;\n}`,
    // Not a refcount release.
    `let this = bun_core::heap::release(self);\nlet r = &*this;\nr.post(task);`,
    `if !unsafe { ManagedTask::release(this) } { return; }\nlet r = unsafe { &*this };`,
  ];
  expect(banned.filter(s => findOffenders(s).hits.length === 0)).toEqual([]);
  expect(allowed.filter(s => findOffenders(s).hits.length !== 0)).toEqual([]);
});

test("nothing reaches a released object through a reference", () => {
  expect(offenders).toEqual([]);
});
