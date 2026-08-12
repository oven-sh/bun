import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// `bun_http::http_thread()` returns `&'static mut HTTPThread` by re-deriving
// it from the `HTTP_THREAD` static on every call, and nearly everything a
// request does on the HTTP thread calls it again (`connect`, `deflater`,
// `get_request_body_send_buffer`, the completion callback's `remove_in_flight`,
// ...). So one of these borrows is only sound while no request code runs under
// it: the result is used for a single statement (`http_thread().method()`,
// `http_thread().field`), and `HTTPThread` methods reached that way do not run
// request code. Anything held longer is a `&mut` that a nested call
// invalidates (Stacked Borrows) or that has the nested access happen under it
// while it is still live (Tree Borrows; for a `&mut self` argument the access
// is UB on the spot), and anything projected out of it as a raw pointer is
// stale as soon as the next call happens.
//
// The shapes this bans are the ones that existed:
//
//   - `let thread = crate::http_thread();` in `on_start`, held across the
//     whole lifetime of the thread (`process_events` never returns).
//   - `let in_flight = &mut crate::http_thread().in_flight;` and
//     `let hctx = &raw mut crate::http_thread().https_context;` -- borrows and
//     raw pointers projected out of one borrow and then carried through code
//     that takes the next one (`HTTPClient::get_ssl_ctx` did the same in
//     expression position; it now uses `HTTPThread::default_context_ptr`,
//     which is projected out of the static instead).
//
// Replacements: a field read or a single method call on the temporary; a
// `&mut self` method on `HTTPThread` for anything touching more than one field
// (`take_queued`, `remove_in_flight`, `wake_if_tasks_waiting`); an associated
// function that borrows per statement when the body runs request code
// (`HTTPThread::connect`, `process_events`, the `drain_*` family); and
// `HTTPThread::default_context_ptr()` for a context pointer that has to
// survive across request code.
//
// `HTTPContext` is the struct embedded in `HTTPThread` and is only ever reached
// through a borrow of it (`attach_loop`, `connect`), so it must not call the
// accessor at all; it takes the uSockets loop as an `init` parameter instead.
//
// Sibling guards: fn-long-mut-reborrow.test.ts, frozen-nonnull-reborrow.test.ts.

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

// The call itself; `http_thread_timer_read()` and the `http_thread::` module
// path do not match. `http_thread_mut` was a since-deleted alias of it.
const ACCESSOR = String.raw`\bhttp_thread(?:_mut)?\(\)`;
// The call however it is pathed: `crate::`, `http::`, `bun_http::`, bare.
const PATHED_ACCESSOR = String.raw`(?:\w+::)*` + ACCESSOR;
// `\s` crosses newlines so a rustfmt-wrapped binding still counts.
const BINDING_HEAD = String.raw`let\s+(?:mut\s+)?\w+\s*(?::[^=;]*)?=\s*`;
const SHAPES: { name: string; re: RegExp }[] = [
  // `let thread = crate::http_thread();`
  { name: "binding", re: new RegExp(BINDING_HEAD + PATHED_ACCESSOR + String.raw`\s*;`, "g") },
  // `let x = &mut crate::http_thread().field;` / `let x = &crate::http_thread().field;`
  {
    name: "field borrow",
    re: new RegExp(BINDING_HEAD + String.raw`&(?:mut\s+)?` + PATHED_ACCESSOR + String.raw`\s*\.`, "g"),
  },
  // `&raw mut crate::http_thread().field` anywhere: a raw pointer projected
  // out of a temporary borrow exists only to outlive it.
  { name: "raw projection", re: new RegExp(String.raw`&raw\s+(?:mut|const)\s+` + PATHED_ACCESSOR, "g") },
];
const ACCESSOR_CALL = new RegExp(ACCESSOR, "g");

// Files whose types live inside `HTTPThread` and are therefore always entered
// through a live borrow of it.
const EMBEDDED_IN_HTTP_THREAD = ["src/http/HTTPContext.rs"];

const offenders: string[] = [];
const embeddedOffenders: string[] = [];
let scanned = 0;
let scannedEmbedded = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  // `src/cli` is a symlink into `src/runtime/cli`; count each file once under
  // its canonical path.
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  // Strip full-line comments so prose mentions don't count. `[ \t]*`, not
  // `\s*`: `\s` crosses newlines and would shift the reported line numbers.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  const lineOf = (index: number) => stripped.slice(0, index).split("\n").length;
  for (const { name, re } of SHAPES) {
    for (const m of stripped.matchAll(re)) {
      offenders.push(`${source}:${lineOf(m.index)}: [${name}] ${m[0].replace(/\s+/g, " ")}`);
    }
  }
  if (EMBEDDED_IN_HTTP_THREAD.includes(source)) {
    scannedEmbedded++;
    for (const m of stripped.matchAll(ACCESSOR_CALL)) {
      embeddedOffenders.push(`${source}:${lineOf(m.index)}: ${m[0]}`);
    }
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  // Guards against the tracked/realpath filters above over-firing and leaving
  // nothing to scan, which would make the bans below pass vacuously.
  expect(scanned).toBeGreaterThan(0);
  expect(scannedEmbedded).toBe(EMBEDDED_IN_HTTP_THREAD.length);
});

test("an http_thread() borrow is never bound to a local or projected into a pointer", () => {
  expect(offenders).toEqual([]);
});

test("types embedded in HTTPThread do not re-borrow it through http_thread()", () => {
  expect(embeddedOffenders).toEqual([]);
});
