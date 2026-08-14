import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The S3 tasks (`S3HttpSimpleTask` in simple_request.rs, `S3HttpDownloadStreamingTask`
// in download_stream.rs) store their `AsyncHTTP` inline, in a `http` field. From
// the moment `schedule` hands the task to the HTTP thread until the final
// callback comes back to the JS thread, that field is the HTTP thread's: every
// progress callback bitwise-overwrites the whole struct (`stage_http_result`,
// `update_state`), and the JS thread runs concurrently with those writes. A
// JS-thread read of the field in that window (`stop_for_vm_teardown` used to do
// `schedule_shutdown(http.assume_init_ref())` to get at `http.async_http_id`)
// is a data race, even though the bytes it wants never change value. Anything
// that needs to reach the in-flight request from the JS thread goes through the
// task's `async_http_id`, captured by `schedule` before the hand-off, and
// `HttpThread::schedule_shutdown_by_id`.
//
// So the field may be touched in exactly three places per task type, all inside
// the task's own file:
//   - `schedule`: the JS thread initialises it and hands it over.
//   - `stage_http_result` / `update_state`: the HTTP thread's own overwrite.
//   - `release_portable`: `Drop`, which only runs once the final callback has
//     handed the task back.
// Any other access (a new JS-thread abort/resume path, a caller in client.rs
// or multipart.rs) fails here; route it through `async_http_id` instead.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const S3_DIR = "src/runtime/webcore/s3/";

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

// Every spelling that reaches the `AsyncHTTP` inside a `http: MaybeUninit<AsyncHTTP>`
// field: `x.http.assume_init_ref()`, `.assume_init_mut()`, `.assume_init()`,
// `.assume_init_read()`, `.assume_init_drop()`, `.as_ptr()`, `.as_mut_ptr()`,
// `.write(..)`. `\s*` between the tokens so a rustfmt-wrapped chain still matches;
// the `.` after `http` keeps `.http_proxy` and the `bun_http` crate path out.
const HTTP_FIELD_ACCESS = /\.\s*http\s*\.\s*(?:assume_init(?:_ref|_mut|_read|_drop)?|as_ptr|as_mut_ptr|write)\s*\(/g;

// `fn name` item headers. fn-pointer types (`fn(..)`) have no name and do not match.
const FN_HEADER = /\bfn\s+([A-Za-z_]\w*)/g;

// file -> the functions in it that may touch the field (see the header comment).
const ALLOWED: Record<string, readonly string[]> = {
  [`${S3_DIR}simple_request.rs`]: ["schedule", "stage_http_result", "release_portable"],
  [`${S3_DIR}download_stream.rs`]: ["schedule", "update_state", "release_portable"],
};

const offenders: string[] = [];
// `file::fn` for every access attributed to an ALLOWED function.
const allowedHits = new Set<string>();
let scanned = 0;
for (const abs of globAllSources().rust) {
  if (!abs.endsWith(".rs")) continue;
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (!source.startsWith(S3_DIR)) continue;
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip full-line comments so prose about the field doesn't count. `[ \t]*`,
  // not `\s*`: `\s` crosses newlines and would shift the reported line numbers.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  const fns = [...stripped.matchAll(FN_HEADER)].map(m => ({ index: m.index!, name: m[1] }));
  for (const m of stripped.matchAll(HTTP_FIELD_ACCESS)) {
    // The access belongs to the nearest `fn` header above it.
    const fn = fns.findLast(f => f.index < m.index!)?.name ?? "<module scope>";
    if (ALLOWED[source]?.includes(fn)) {
      allowedHits.add(`${source}::${fn}`);
      continue;
    }
    const line = stripped.slice(0, m.index).split("\n").length;
    offenders.push(`${source}:${line} (in fn ${fn}): ${m[0].replace(/\s+/g, "")}`);
  }
}

function matches(snippet: string): boolean {
  HTTP_FIELD_ACCESS.lastIndex = 0;
  return HTTP_FIELD_ACCESS.test(snippet);
}

test("scans the S3 task sources", () => {
  // If the directory moves, the scan would otherwise pass with nothing to check.
  expect(scanned).toBeGreaterThanOrEqual(Object.keys(ALLOWED).length);
});

test("the pattern recognizes the spellings it claims to", () => {
  const banned = [
    // The teardown race this lint was written for.
    "bun_http::http_thread().schedule_shutdown((*this).http.assume_init_ref());",
    "let http = unsafe { self.http.assume_init_mut() };",
    "unsafe { core::ptr::write(self.http.as_mut_ptr(), core::ptr::read(async_http)) };",
    "let id = unsafe { (*task).http.assume_init_ref() }.async_http_id;",
    "unsafe { (*task_ptr).http.write(async_http) };",
    "task.http.write(bun_http::AsyncHTTP::init(",
    "unsafe { task.http.assume_init_mut() }.schedule(&mut batch);",
    "ptr::read((*this).http.as_ptr())",
    // rustfmt-wrapped chain.
    "(*this)\n    .http\n    .assume_init_ref()",
  ];
  const allowed = [
    // The id captured at schedule time is the sanctioned JS-thread handle.
    "bun_http::http_thread().schedule_shutdown_by_id((*this).async_http_id);",
    "(*this).async_http_id = http.async_http_id;",
    // Other things called `http`: the crate, a local, an unrelated field, the declaration.
    "bun_http::http_thread::init(&Default::default());",
    "http.enable_response_body_streaming();",
    "http.schedule(&mut batch);",
    "options.http_proxy.take()",
    "pub(crate) http: core::mem::MaybeUninit<AsyncHTTP<'static>>,",
  ];
  expect(banned.filter(s => !matches(s))).toEqual([]);
  expect(allowed.filter(matches)).toEqual([]);
});

test("the task's `http` field is only touched at schedule, in the HTTP-thread callback, and in Drop", () => {
  expect(offenders).toEqual([]);
});

test("every allowed function still touches the field", () => {
  // Ratchet: an entry whose function no longer accesses `http` (renamed,
  // restructured) must be removed so the name cannot be reused to smuggle in a
  // JS-thread access later. This also proves HTTP_FIELD_ACCESS still matches
  // the real code, so the ban above cannot pass vacuously.
  const expected = Object.entries(ALLOWED).flatMap(([source, fns]) => fns.map(fn => `${source}::${fn}`));
  expect([...allowedHits].sort()).toEqual(expected.sort());
});
