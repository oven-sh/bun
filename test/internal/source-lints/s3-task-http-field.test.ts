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
//
// The same window has a second rule, checked below for `S3HttpSimpleTask`: the
// functions that run on the task while it is out (IN_FLIGHT_FNS) take it as a
// raw pointer and borrow one field per statement, never as `&mut self`. While
// the HTTP thread is inside one of them, the JS thread's `stop_for_vm_teardown`
// (VM teardown, and the sweep between files under `bun test`) may store into
// the task's `signal_store`; a `&mut self` argument is a protected exclusive
// borrow of the whole task, atomics included, for the duration of the call, so
// that store is undefined behaviour under Tree Borrows (the model `bun run
// rust:miri` uses: "protected tags must never be Disabled") and Stacked
// Borrows alike, and rustc passes the same claim to LLVM as `noalias`.
// `http_callback` additionally returns only after the post that lets the JS
// thread free the task. The simple task's other methods (`error_with_body`,
// `fail_if_contains_error`, `release_portable`, `Drop`) run from `on_response`,
// after the hand-back, and keep their receivers, hence a list rather than a
// ban on every receiver in the file. The streaming task is not listed: it has
// no after-the-hand-back phase (chunks are delivered while more arrive), so the
// rule there is every method of the type, which is a different check.

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

// file -> the functions that run on the task while it is out on the HTTP thread
// (see the header comment); each must take the task as a raw pointer.
const IN_FLIGHT_FNS: Record<string, readonly string[]> = {
  [`${S3_DIR}simple_request.rs`]: ["http_callback", "stage_http_result", "release_at_shutdown", "stop_for_vm_teardown"],
};

// The first parameter of `fn <name>(..)`, up to the first `,` or `)` (a trailing
// `()` unit type included), across rustfmt's one-parameter-per-line wrapping.
// `(?!\w)` keeps `fn foo` from matching `fn foo_bar`.
function firstParamPattern(fn: string): RegExp {
  return new RegExp(String.raw`\bfn\s+${fn}(?!\w)\s*(?:<[^>]*>)?\s*\(\s*([^,()]*(?:\(\))?)`, "g");
}

// `release_at_shutdown` receives the type-erased `*mut ()`; the others `*mut Self`.
const RAW_TASK_PARAM = /^this\s*:\s*\*\s*mut\b/;

interface Declaration {
  fn: string;
  line: number;
  firstParam: string;
}

function inFlightDeclarations(stripped: string, fns: readonly string[]): Declaration[] {
  const found: Declaration[] = [];
  for (const fn of fns) {
    for (const m of stripped.matchAll(firstParamPattern(fn))) {
      found.push({
        fn,
        line: stripped.slice(0, m.index).split("\n").length,
        firstParam: m[1].replace(/\s+/g, " ").trim(),
      });
    }
  }
  return found;
}

const offenders: string[] = [];
// `file::fn` for every access attributed to an ALLOWED function.
const allowedHits = new Set<string>();
// `file::fn` for every IN_FLIGHT_FNS declaration found, and the ones not taking a pointer.
const inFlightDeclared: string[] = [];
const receiverOffenders: string[] = [];
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
  for (const d of inFlightDeclarations(stripped, IN_FLIGHT_FNS[source] ?? [])) {
    inFlightDeclared.push(`${source}::${d.fn}`);
    if (!RAW_TASK_PARAM.test(d.firstParam)) {
      receiverOffenders.push(`${source}:${d.line}: fn ${d.fn}(${d.firstParam}, ..)`);
    }
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

test("the receiver check reads the first parameter out of the spellings it claims to", () => {
  const parsed = inFlightDeclarations(
    [
      // `stage_http_result` as it was, and as it is.
      "fn stage_http_result(\n        &mut self,\n        async_http: *mut AsyncHTTP<'static>,\n    ) {",
      "unsafe fn stage_http_result(\n        this: *mut Self,\n        async_http: *mut AsyncHTTP<'static>,\n    ) {",
      // The other spellings of a task reference.
      "pub(crate) fn http_callback(&self, async_http: *mut AsyncHTTP<'static>) {",
      "pub(crate) unsafe fn release_at_shutdown(self: &mut Self) {",
      "pub(crate) unsafe fn stop_for_vm_teardown<'a>(this: &'a mut Self) {",
      // Type-erased is still a raw pointer.
      "pub(crate) unsafe fn release_at_shutdown(this: *mut ()) {",
      // Not the functions in question.
      "fn stage_http_result_for_tests(&mut self) {}",
    ].join("\n"),
    IN_FLIGHT_FNS[`${S3_DIR}simple_request.rs`],
  );
  expect(parsed.map(d => [d.fn, d.firstParam, RAW_TASK_PARAM.test(d.firstParam)])).toEqual([
    ["http_callback", "&self", false],
    ["stage_http_result", "&mut self", false],
    ["stage_http_result", "this: *mut Self", true],
    ["release_at_shutdown", "self: &mut Self", false],
    ["release_at_shutdown", "this: *mut ()", true],
    ["stop_for_vm_teardown", "this: &'a mut Self", false],
  ]);
});

test("every in-flight function is still declared under its listed name", () => {
  // A rename would otherwise silently drop the function out of the check below.
  const expected = Object.entries(IN_FLIGHT_FNS).flatMap(([source, fns]) => fns.map(fn => `${source}::${fn}`));
  expect(inFlightDeclared.sort()).toEqual(expected.sort());
});

test("functions that run on an in-flight S3HttpSimpleTask take it as a raw pointer", () => {
  expect(receiverOffenders).toEqual([]);
});
