import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// An empty `JSValue` is not a value: by JSC convention it means "an exception is
// pending on the VM". A native completion that converts its result to JS can
// see that conversion fail — a `worker.terminate()` landing mid-conversion is
// the common case — and `to_js(..).unwrap_or(JSValue::ZERO)` then hands the
// empty value on to a promise settlement / callback argument / property store,
// where JSC asserts or crashes.
//
// Carry the `JsResult` to the boundary instead:
//   promise.resolve(global, v.unwrap_or(JSValue::ZERO))  → promise.settle(global, v)
//   cb.call(global, this, &[v.unwrap_or(JSValue::ZERO)]) → let Ok(v) = v else { report/return }
//   fn host_getter(..) -> JSValue { v.unwrap_or(ZERO) } → v.or_pending_exception()  (bun_jsc::HostReturn)
//   opt.unwrap_or(JSValue::ZERO)  (an Option<JSValue>)   → opt.unwrap_or_default()
//
// `JSPromise::{resolve,reject}` also refuse an empty value at runtime (they turn
// it into "reject with the pending exception", or bail on a termination); this
// lint keeps the laundering pattern from being written in the first place.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const rustSources = globAllSources().rust.filter(abs => abs.endsWith(".rs"));

const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

const BANNED: { name: string; re: RegExp; hint: string }[] = [
  {
    name: "unwrap_or(JSValue::ZERO)",
    re: /\.unwrap_or\(\s*JSValue::ZERO\s*\)/g,
    hint: "carry the JsResult to the boundary (JSPromise::settle / `?` / HostReturn::or_pending_exception); for an Option use unwrap_or_default()",
  },
  {
    name: "unwrap_or_else(|_| JSValue::ZERO)",
    re: /\.unwrap_or_else\(\s*\|_\|\s*JSValue::ZERO\s*\)/g,
    hint: "as above",
  },
];

const offenders: string[] = [];
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  const stripped = content.replace(/^[ \t]*\/\/.*$/gm, "");
  for (const { name, re, hint } of BANNED) {
    for (const m of stripped.matchAll(re)) {
      const line = stripped.slice(0, m.index).split("\n").length;
      offenders.push(`${source}:${line}: ${name} → ${hint}`);
    }
  }
}

test("scans a non-empty set of tracked Rust sources", () => {
  expect(scanned).toBeGreaterThan(0);
});

test("no JsResult<JSValue> is laundered into an empty JSValue", () => {
  expect(offenders).toEqual([]);
});
