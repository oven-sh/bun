import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// An `as_ctx_ptr()` pointer must not be posted as a task. `as_ctx_ptr()`
// (the inherent helpers, and `bun_ptr::AsCtxPtr`) is `ptr::from_ref(self)
// .cast_mut()`: its contract, stated in src/ptr/lib.rs, is that the pointer
// carries the shared provenance of the `&self` it was spelled from and that
// whoever receives it only reads through it. A task post is the opposite kind
// of hand-over: the thread that drains the queue owns whatever the task
// carries, and every task arm in src/runtime/dispatch.rs writes to, releases
// a ref on, or frees the object behind the pointer it is handed. So
//
//   ConcurrentTask::create(Task::init(self.as_ctx_ptr()))
//   let this_ptr: *mut Self = self.as_ctx_ptr(); ... Task::init(this_ptr)
//
// hands over a pointer that cannot do what the consumer does with it:
//
//   - When the consumer releases the ref the task carries and it is the last
//     one, the object is freed through a pointer derived from a shared
//     reference. Both aliasing models reject that regardless of when it
//     happens: Tree Borrows (what `bun run rust:miri` uses) reports
//     "deallocation through <tag> is forbidden ... has state Frozen", Stacked
//     Borrows "trying to retag ... for Unique permission, but that tag only
//     grants SharedReadOnly permission", each pointing at the
//     `from_ref(self)` inside the helper.
//   - When it happens while the posting method is still running (the consumer
//     thread can run the task the moment it is queued), it also deallocates
//     memory that the method's `&self` argument, and the `&self` of whatever
//     field the post goes through, protect for the duration of their calls;
//     codegen marks those arguments dereferenceable for the whole call.
//
// `StatWatcher::post_to_js_thread(&self)` in src/runtime/node/
// node_fs_stat_watcher.rs was the instance this was written for: both of the
// stat watcher's pool-to-JS hops posted `self.as_ctx_ptr()`, and the hop's
// ref is the watcher's last one whenever JS closed and collected it while the
// stat was in flight. The pointer the consumer needs is the one the caller
// already had before it formed `&self` (the work-pool task's field, the queue
// entry), so the fix is to keep it: the posting function takes
// `this: *mut Self`, finishes its own field accesses, clones the loop handle
// out, and posts `this`. `post_to_js_thread` / `restat` there, and `post_job`
// in src/jsc/VmHandle.rs, are the templates.
//
// Scope: an `as_ctx_ptr()` call, or a local bound to one in the same
// function, as the pointer argument of the task constructors (`Task::init`,
// `Task::new(tag, ptr)`, `ConcurrentTask::create_from`, `::from_callback`,
// and the intrusive `.from(ptr, ..)`). A pointer spelled out of `self`
// directly is the sibling self-receiver lints' job; the same hand-over through
// any other helper is the same bug, convert it on sight.

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

// The task constructors, however the path in front is spelled (`jsc::`,
// `bun_event_loop::ConcurrentTask::`, the `ConcurrentTaskItem` alias),
// optionally turbofished, positioned just before their pointer argument:
// the first argument of `Task::init` / `create_from` / `from_callback` / the
// intrusive `.from`, the second of `Task::new(tag, ptr)` (a tag path never
// contains a comma or a paren). `\s*` after the paren so a rustfmt-wrapped
// argument still matches; `\b` before `Task` keeps `NapiFinalizerTask::init(`
// and similar constructors out.
const POINTER_SLOT = [
  String.raw`(?:\bTask::init|\bConcurrentTask\w*::(?:create_from|from_callback)|\.from)(?:::<[^>]*>)?\(\s*`,
  String.raw`\bTask::new\(\s*[^,()]+,\s*`,
].join("|");

// `x.as_ctx_ptr()` for any receiver (`self`, a `&Self` local, a field): the
// helper's result has shared provenance whatever it was called on. Anchored
// at the front only, so a trailing `.cast::<()>()` still matches.
const CTX_PTR_CALL = String.raw`[\w.]+\.as_ctx_ptr\(\)`;

const DIRECT = new RegExp(`(?:${POINTER_SLOT})(?:${CTX_PTR_CALL})`, "g");

// `let this_ptr: *mut Self = self.as_ctx_ptr();` and then that local in a
// pointer slot further down the same function, which ends at the next `fn`
// item (a closure inside it is the same function for this purpose).
const BINDING = new RegExp(String.raw`let\s+(?:mut\s+)?(\w+)\s*(?::[^=;]*)?=\s*${CTX_PTR_CALL}\s*;`, "g");
const FN_ITEM = /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe|extern\s+"[^"]*")\s+)*fn\s/m;

function postOfBinding(name: string): RegExp {
  return new RegExp(`(?:${POINTER_SLOT})${name}\\b`);
}

/** Byte offsets (into `stripped`) of every banned post in one file. */
function findPosts(stripped: string): number[] {
  const hits: number[] = [];
  for (const m of stripped.matchAll(DIRECT)) hits.push(m.index);
  for (const binding of stripped.matchAll(BINDING)) {
    const start = binding.index + binding[0].length;
    const rest = stripped.slice(start);
    const fnEnd = rest.search(FN_ITEM);
    const body = fnEnd === -1 ? rest : rest.slice(0, fnEnd);
    const post = body.search(postOfBinding(binding[1]));
    if (post !== -1) hits.push(start + post);
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
  for (const offset of findPosts(stripped)) {
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
    // `StatWatcher::post_to_js_thread(&self)` as it was.
    "let task = ConcurrentTask::create(Task::init(self.as_ctx_ptr()));",
    // The other constructors, other path spellings, a turbofish, a wrapped
    // argument, a cast after the call.
    "let ct = jsc::ConcurrentTask::create_from(self.as_ctx_ptr());",
    "bun_event_loop::ConcurrentTask::ConcurrentTask::from_callback(self.as_ctx_ptr(), Self::resume)",
    "let task = ConcurrentTaskItem::create_from::<Self>(self.as_ctx_ptr());",
    "loop_.enqueue_task(Task::init(\n    self.as_ctx_ptr(),\n));",
    "Task::new(task_tag::StatWatcherHop, self.as_ctx_ptr().cast::<()>())",
    "Task::new(\n    <Self as bun_event_loop::Taskable>::TAG,\n    self.as_ctx_ptr().cast(),\n)",
    // The intrusive form.
    "let ct = self.concurrent_task.from(self.as_ctx_ptr(), AutoDeinit::ManualDeinit);",
    // Any receiver: the helper's result has shared provenance whatever it
    // was called on.
    "let ct = ConcurrentTask::create_from(this_ref.as_ctx_ptr());",
    "Task::init(self.inner.as_ctx_ptr())",
    // Through a local, with and without a type annotation.
    "let this_ptr: *mut StatWatcher = self.as_ctx_ptr();\nSelf::ref_(this_ptr);\nlet task = ConcurrentTask::create(Task::init(this_ptr));",
    "let p = self.as_ctx_ptr();\nif done {\n    return;\n}\nloop_.enqueue_task(Task::init(p));",
    "let p = self.as_ctx_ptr();\nlet ct = self.concurrent_task.from(p, AutoDeinit::ManualDeinit);",
    "let p = self.as_ctx_ptr();\nlet task = Task::new(Self::TAG, p.cast());",
  ];
  const allowed = [
    // Posting the pointer the caller handed over is the intended shape.
    "let task = ConcurrentTask::create(Task::init(this));",
    "let ct = ConcurrentTask::create_from(this);",
    "(*this).concurrent_task.from(this, AutoDeinit::ManualDeinit)",
    "let ct = ConcurrentTask::create(Task::new(Self::TAG, holder.cast::<()>()));",
    // `as_ctx_ptr()` in the ctx slots it is for: refcount brackets, C
    // callback userdata, back-pointers stored in a child.
    "let _guard = unsafe { bun_ptr::ScopedRef::adopt(self.as_ctx_ptr()) };",
    "Self::deref(self.as_ctx_ptr());",
    "uws_socket_set_ext(socket, self.as_ctx_ptr().cast());",
    "let this_ptr: *mut Self = self.as_ctx_ptr();\nlet poll = UvDnsPoll::new(this_ptr, fd);",
    "let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();\nstdout_writer.set_interp(interp_ptr);",
    // A different local is what gets posted.
    "let p = self.as_ctx_ptr();\nregister(p);\nlet ct = ConcurrentTask::create_from(holder);",
    // A name that merely starts with the bound one.
    "let p = self.as_ctx_ptr();\nregister(p);\nlet ct = ConcurrentTask::create_from(ptr);",
    // The local is posted in the next function, where it is a raw-pointer
    // parameter of the same name.
    "let this_ptr = self.as_ctx_ptr();\nregister(this_ptr);\n}\n\nunsafe fn resume(this_ptr: *mut Self) {\n    let ct = ConcurrentTask::create_from(this_ptr);\n}",
    // Constructors whose names merely end in `Task`, and path calls to `from`.
    "NapiFinalizerTask::init(self.as_ctx_ptr());",
    "let s = String::from(self.as_ctx_ptr() as usize);",
  ];
  expect(banned.map(s => findPosts(s).length)).toEqual(banned.map(() => 1));
  expect(allowed.map(s => findPosts(s).length)).toEqual(allowed.map(() => 0));
});

test("no as_ctx_ptr() pointer is posted as a task", () => {
  expect(offenders).toEqual([]);
});
