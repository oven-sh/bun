import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// Everything another thread delivers to the bundle thread (a finished parse,
// a plugin's answer to an onResolve/onLoad, a `defer()` call, the `.defer()`
// hop coming back) goes through `post::<E>()` in src/bundler/post.rs. A bundle
// runs either on the JS loop of the VM that owns it (bake) or on a mini loop
// of its own (`Bun.build`, `bun build`), and the two are fed differently, so
// `post()` is the one place that matches on `AnyEventLoop::Js` /
// `AnyEventLoop::Mini` and the one caller of the mini loop's
// `enqueue_task_concurrent_with_extra_ctx`. Each event is then one
// `Event::run`, whichever loop it arrives on.
//
// This tree used to have that match written out at every producer (parse
// completion twice, resolve and load settlement, defer, and then the deferred
// batch's return), each with its own pair of per-loop handlers that nothing
// kept in step. A new producer gets an `Event` impl and calls `post()`; it
// does not get its own match, not even a one-armed one.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const ALLOWED = "src/bundler/post.rs";

function inScope(source: string): boolean {
  return (
    source.startsWith("src/bundler/") ||
    source.startsWith("src/bundler_jsc/") ||
    source === "src/runtime/api/JSBundler.rs"
  );
}

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

const BANNED = [/\bAnyEventLoop::Js\b/, /\bAnyEventLoop::Mini\b/, /\benqueue_task_concurrent_with_extra_ctx\b/];

const offenders: string[] = [];
let scanned = 0;
let postRs: string | null = null;
for (const abs of globAllSources().rust) {
  if (!abs.endsWith(".rs")) continue;
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (!inScope(source)) continue;
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  if (source === ALLOWED) {
    postRs = content;
    continue;
  }
  // Strip comments (whole-line, then trailing) so prose about `post()` does
  // not count. None of the scanned files has `//` inside a string literal on
  // a line that also names one of the banned identifiers.
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "").replace(/[ \t]\/\/.*$/gm, "");
  const lines = stripped.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of BANNED) {
      if (pattern.test(lines[i])) offenders.push(`${source}:${i + 1}: ${lines[i].trim()}`);
    }
  }
}

test("scans the bundler sources", () => {
  // Guards against the scope/tracked/realpath filters leaving nothing to scan,
  // which would make the ban below pass vacuously.
  expect(scanned).toBeGreaterThan(1);
});

test("post() is where the bundle's loop is matched and fed", () => {
  expect({
    present: postRs !== null,
    matchesJsArm: postRs !== null && BANNED[0].test(postRs),
    matchesMiniArm: postRs !== null && BANNED[1].test(postRs),
    enqueuesOnMiniLoop: postRs !== null && BANNED[2].test(postRs),
  }).toEqual({ present: true, matchesJsArm: true, matchesMiniArm: true, enqueuesOnMiniLoop: true });
});

test("no other bundler code dispatches on the bundle's loop or enqueues on it directly", () => {
  expect(offenders).toEqual([]);
});
