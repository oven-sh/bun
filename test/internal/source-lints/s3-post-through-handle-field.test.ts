import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// In src/runtime/webcore/s3/ the HTTP thread hands a request back to the JS
// thread by posting the request's own allocation (`S3HttpSimpleTask`,
// `S3HttpDownloadStreamingTask`: the inline `concurrent_task` carries the
// object that embeds it), and the JS thread frees that allocation as soon as
// it observes the final state (`on_response` in both files): from the moment
// `VmHandle::post` has pushed the task or, on the streaming download's final
// callback, from the moment `process_http_callback` unlocks if a task is
// already queued. Either way the allocation can be gone while the HTTP thread
// is still inside the call that handed it over. So in these files
//
//   (*this).loop_handle.post_task(task)
//   (*this).loop_handle.embedded_work_finished()
//
// is banned: both calls take `&(*this).loop_handle`, a reference into that
// allocation, as an argument, and a reference argument is protected for the
// duration of its call. Freeing memory a protected reference points into is UB
// under both aliasing models whether or not the callee reads through it again.
// Miri, on a reduction of this exact shape (free on a second thread while the
// poster is still inside `post_task(&self)`), reports it under Tree Borrows
// (the model `bun run rust:miri` uses) as "deallocation through <tag> is
// forbidden ... protected tags must never be Disabled" and under Stacked
// Borrows as "not granting access ... would remove [SharedReadOnly for <tag>]
// which is strongly protected", pointing at `&self` both times; codegen relies
// on the same thing (the argument is annotated dereferenceable for the whole
// call). The shape every other hand-off in the directory uses copies the
// handle out first and posts and hands back through the copy:
//
//   let handle = (*this).loop_handle.clone();
//   ... handle.post_task(task) ...
//   handle.embedded_work_finished();
//
// `embedded_work_scheduled()` through the field is fine: it runs on the JS
// thread, before the request is handed to the HTTP thread.
//
// Scope: src/runtime/webcore/s3/, where the rule holds for every object that
// stores a `LoopHandle`. Elsewhere a post through a stored handle is
// sometimes sound (the poster holds a ref or a lock that outlives the post),
// so the same spelling cannot be banned tree-wide by a regex; the sites of
// this class outside the directory are converted one at a time. Within the
// directory, a reference to the field parked in a local
// (`let h = &(*this).loop_handle;`) or returned by a helper is the same bug
// spelled in a way this lint does not see; convert it on sight. Sibling
// guard for the receiver-spelled forms of the same hand-over:
// self-receiver-reclaim.test.ts.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const SCOPE = "src/runtime/webcore/s3/";
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

// The two calls that follow a hand-off.
const AFTER_HANDOFF = String.raw`(?:post_task|embedded_work_finished)`;

const BANNED = new RegExp(
  [
    // `x.loop_handle.post_task(..)`, whatever `x` is (`(*this)`, `self`, `task`),
    // including rustfmt's one-segment-per-line wrapping of the chain.
    String.raw`\.\s*loop_handle\s*\.\s*${AFTER_HANDOFF}\s*\(`,
    // The same call spelled as a path call: `LoopHandle::post_task(&(*this).loop_handle, task)`,
    // `LoopHandle::embedded_work_finished(&self.loop_handle)`.
    String.raw`\b${AFTER_HANDOFF}\s*\(\s*&\s*(?:\(\s*\*+\s*[\w.]+\s*\)|[\w.]+)\s*\.\s*loop_handle\b`,
  ].join("|"),
  "g",
);

// What keeps the ban from passing vacuously: the scanned files still store
// the handle under this name (a rename would otherwise silently blind the
// regex above) and still post through it.
const HANDLE_FIELD = /\bloop_handle\s*:\s*(?:[\w:]+::)?LoopHandle\b/g;
const HANDOFF = /\.post_task\s*\(/g;

const offenders: string[] = [];
const scanned: string[] = [];
let handleFields = 0;
let handoffs = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (!source.startsWith(SCOPE)) continue;
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned.push(source);
  const content = await file(abs).text();
  // Strip full-line comments so prose (like the comments describing this very
  // hazard) doesn't count. `[ \t]*`, not `\s*`: `\s` crosses newlines and
  // would swallow blank lines, shifting the reported line numbers.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  handleFields += [...stripped.matchAll(HANDLE_FIELD)].length;
  handoffs += [...stripped.matchAll(HANDOFF)].length;
  for (const m of stripped.matchAll(BANNED)) {
    const line = stripped.slice(0, m.index).split("\n").length;
    offenders.push(`${source}:${line}: ${m[0].replace(/\s+/g, " ")}`);
  }
}

function matches(snippet: string): boolean {
  BANNED.lastIndex = 0;
  return BANNED.test(snippet);
}

test("scans the hand-off sites it is about", () => {
  expect(scanned).toContain(`${SCOPE}download_stream.rs`);
  expect(scanned).toContain(`${SCOPE}simple_request.rs`);
  // Both task types still keep their handle in a field called `loop_handle`
  // and still post through it; otherwise the regexes below match nothing and
  // the ban would need re-anchoring rather than passing for free.
  expect(handleFields).toBeGreaterThan(0);
  expect(handoffs).toBeGreaterThan(0);
});

test("the pattern recognizes the spellings it claims to", () => {
  const banned = [
    // `S3HttpDownloadStreamingTask::http_callback`, as it was.
    "let bun_jsc::vm_handle::Posted::Queued = (*this).loop_handle.post_task(task) else {",
    "self.loop_handle.post_task(ct)",
    "task.loop_handle.embedded_work_finished();",
    "unsafe { (*this).loop_handle.embedded_work_finished() };",
    // rustfmt-wrapped chains.
    "(*this)\n    .loop_handle\n    .post_task(task)",
    "this.loop_handle\n    .embedded_work_finished();",
    // Path-call spellings of the same thing.
    "bun_jsc::LoopHandle::post_task(&(*this).loop_handle, task)",
    "LoopHandle::embedded_work_finished(&self.loop_handle)",
  ];
  const allowed = [
    // The required shape: copy out, then post and hand back through the copy.
    "let handle = (*this).loop_handle.clone();",
    "let bun_jsc::vm_handle::Posted::Queued = handle.post_task(task) else {",
    "done_handle.embedded_work_finished();",
    // A copy that happens to be called `loop_handle` is a local, not the field.
    "let loop_handle = (*this).loop_handle.clone();\nloop_handle.post_task(task);",
    // JS thread, before the request leaves it.
    "task.loop_handle.embedded_work_scheduled();",
    "unsafe { (*task_ptr).loop_handle.embedded_work_scheduled() };",
    // Capturing the handle at construction.
    "loop_handle: VirtualMachine::get().loop_handle(),",
    "pub(crate) loop_handle: bun_jsc::LoopHandle,",
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("S3 hand-offs post and hand back through a copy of the handle, not the field", () => {
  expect(offenders).toEqual([]);
});
