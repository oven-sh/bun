import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `bun_io::IoRequestLoop::schedule` is the hand-over of a ReadFile/WriteFile
// to the io thread. Two ways of spelling its argument are banned:
//
//   IoRequestLoop::schedule(&mut self.io_request)        // from `self`
//   IoRequestLoop::schedule(&raw mut self.io_request)
//   let r = self.io_request(); ... IoRequestLoop::schedule(r)
//   IoRequestLoop::schedule(&mut (*this).io_request)     // a `&mut` reborrow
//
// The argument has to be the request *projected from the owner pointer the
// caller holds* (`&raw mut (*this).io_request`, or a `*mut` returned by an
// accessor that does that), for two reasons:
//
//   - The io thread hands that exact pointer back to the request's callback
//     (`on_request_readable` / `on_request_writable` / `schedule_close`),
//     which recovers the owner from it by container-of. A `&mut` reborrow of
//     the field (which is what a `&mut Request` argument or `&mut x.io_request`
//     coerced to `*mut` is) only has provenance over the field's bytes, so the
//     container-of walk leaves its bounds; `bun_core::container_of`'s
//     contract says as much ("a `&mut field` reborrow does not suffice").
//   - The push is the moment the object changes threads: the io thread (and,
//     through on_ready / on_error / on_done, a pool thread) may be writing to
//     the request and its owner before `schedule` returns. A `&mut self`
//     method publishing its own receiver therefore has a reference argument
//     that stays protected, on this thread's stack, while another thread
//     writes through the object, which both aliasing models (Tree Borrows is
//     what `bun run rust:miri` uses) reject regardless of whether `self` is
//     touched again. `schedule` takes `*mut Request` so that it does not do
//     this itself; a caller spelling the argument from `self` reintroduces it
//     one frame up.
//
// Before `schedule` took a pointer, all three callers had the shape:
// `ReadFile::wait_for_readable` and `WriteFile::wait_for_writable`
// (`schedule(&mut self.io_request)`) and `FileCloser::do_close`
// (`schedule(io_request)` with `io_request` bound from `self.io_request()`).
// The converted versions (`unsafe fn wait_for_readable(this: *mut Self)`,
// `unsafe fn do_close(this: *mut Self, ..)` in src/runtime/webcore/Blob.rs)
// are the templates; `do_write_loop_task` / `on_close_io_request` show how the
// pointer reaches them without a `&mut` being formed on the way.
//
// Scope: calls to `..IoRequestLoop::schedule(` whose argument is spelled from
// `self` (directly, or via a local bound from a `self.` expression earlier in
// the same function), or is any `&mut` expression. An argument derived from a
// reference other than `self` (`fn f(r: &mut ReadFile)` ... `&raw mut
// r.io_request`) is the same bug but outside this lint; convert it on sight.
//
// Siblings: self-receiver-reclaim.test.ts (freeing the receiver),
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

// `IoRequestLoop::schedule(`, however the path in front is spelled, with the
// argument list open. `\s*` after the paren so a rustfmt-wrapped argument
// still matches.
const SCHEDULE = String.raw`\bIoRequestLoop::schedule\(\s*`;

// Any `&mut ...` argument: a reborrow of the field, coerced to `*mut` at the
// call. (`&raw mut` has `raw` in between and is not matched here; it is only
// banned when its base is `self`, below.)
const MUT_REBORROW = new RegExp(SCHEDULE + String.raw`&\s*mut\b`, "g");

// An argument spelled from `self`: `self.` as the base of the argument,
// optionally behind `&mut` / `&raw mut` / one wrapping call such as
// `ptr::from_mut(`.
const FROM_SELF = new RegExp(SCHEDULE + String.raw`(?:[\w:]+\(\s*)?(?:&\s*(?:raw\s+)?(?:mut|const)\s+)?self\s*\.`, "g");

// A local bound from a `self.` expression: `let r = &mut self.io_request;`,
// `let r = self.io_request();`, `if let Some(r) = self.io_request() {`. The
// binding is then looked for as the schedule argument further down the same
// function, which ends at the next `fn` item.
const SELF_BINDING = new RegExp(
  String.raw`let\s+(?:Some\(\s*)?(?:mut\s+)?(\w+)\s*\)?\s*(?::[^=;{]*)?=\s*(?:&\s*(?:raw\s+)?(?:mut|const)\s+)?self\s*\.`,
  "g",
);
const FN_ITEM = /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:(?:const|async|unsafe|extern\s+"[^"]*")\s+)*fn\s/m;

function scheduleOf(name: string): RegExp {
  return new RegExp(SCHEDULE + name + String.raw`\s*,?\s*\)`);
}

/** Byte offsets (into `stripped`) of every banned schedule call in one file. */
function findBanned(stripped: string): number[] {
  const hits = new Set<number>();
  for (const m of stripped.matchAll(MUT_REBORROW)) hits.add(m.index);
  for (const m of stripped.matchAll(FROM_SELF)) hits.add(m.index);
  for (const binding of stripped.matchAll(SELF_BINDING)) {
    const start = binding.index + binding[0].length;
    const rest = stripped.slice(start);
    const fnEnd = rest.search(FN_ITEM);
    const body = fnEnd === -1 ? rest : rest.slice(0, fnEnd);
    const call = body.search(scheduleOf(binding[1]));
    if (call !== -1) hits.add(start + call);
  }
  return [...hits].sort((a, b) => a - b);
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
  for (const offset of findBanned(stripped)) {
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
    // `wait_for_readable` / `wait_for_writable` as they were.
    "io::IoRequestLoop::schedule(&mut self.io_request);",
    // `FileCloser::do_close` as it was.
    "if let Some(io_request) = self.io_request() {\n    io_request.store_callback_seq_cst(Self::schedule_close);\n    if !io_request.scheduled {\n        bun_io::IoRequestLoop::schedule(io_request);\n    }\n}",
    // The pointer-typed argument spelled from `self` anyway.
    "io::IoRequestLoop::schedule(&raw mut self.io_request);",
    "bun_io::IoRequestLoop::schedule(self.io_request_ptr());",
    "IoRequestLoop::schedule(core::ptr::from_mut(&mut self.io_request));",
    "let request = &raw mut self.io_request;\nrequest.scheduled;\nio::IoRequestLoop::schedule(request);",
    "let mut request = self.io_request();\nio::IoRequestLoop::schedule(request);",
    // A `&mut` reborrow, whatever it is based on: its provenance stops at the field.
    "io::IoRequestLoop::schedule(&mut (*this).io_request);",
    "bun_io::IoRequestLoop::schedule(&mut *io_request);",
    // rustfmt-wrapped.
    "::bun_io::IoRequestLoop::schedule(\n    &mut self.io_request,\n);",
    "::bun_io::IoRequestLoop::schedule(\n    &raw mut self.io_request,\n);",
  ];
  const allowed = [
    // Projected from the pointer the caller holds: the intended shape.
    "io::IoRequestLoop::schedule(&raw mut (*this).io_request);",
    "if let Some(io_request) = Self::io_request(this) {\n    (*io_request).store_callback_seq_cst(Self::schedule_close);\n    if !(*io_request).scheduled {\n        bun_io::IoRequestLoop::schedule(io_request);\n    }\n}",
    "let request = unsafe { Self::io_request_of(this) };\nbun_io::IoRequestLoop::schedule(request);",
    // A self-derived binding that is not what gets scheduled.
    "let fd = self.opened_fd;\nio::IoRequestLoop::schedule(request);",
    // The binding is scheduled, but in the next function, where it is a
    // raw-pointer parameter of the same name.
    "let request = &mut self.io_request;\nrequest.scheduled = false;\n}\n\nunsafe fn publish(request: *mut io::Request) {\n    io::IoRequestLoop::schedule(request);\n}",
    // Other things called `schedule`.
    "WorkPool::schedule(&raw mut self.task);",
    "bun_jsc::Job::<ReadFile>::schedule(&global.js_thread(), this, completion);",
    "self.schedule(&mut self.io_request);",
  ];
  expect(banned.map(s => findBanned(s).length)).toEqual(banned.map(() => 1));
  expect(allowed.map(s => findBanned(s).length)).toEqual(allowed.map(() => 0));
});

test("nothing schedules an io request spelled from self or through a &mut reborrow", () => {
  expect(offenders).toEqual([]);
});
