import { file } from "bun";
import { expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// The table of built-ins (src/codegen/builtins/collect-bindgen.ts, computeReceiverUses) takes a bindgen member that
// runs no JavaScript and has no `passThis` to neither keep nor answer the wrapper of its receiver: the body is handed
// `&self` alone. `JsClass::wrapper_value()` (src/jsc/bindgen.rs) is the one way from `&self` back to the wrapper, so a
// body that calls it can break that claim, and compiled code then calls the next method on the instance without a test.
//
// A body that is handed its wrapper stores it at most in a `JsCell` field of the object, and its row keeps Retains: a
// stored field is no second way to the wrapper.
//
// Every file that calls `wrapper_value()` is listed here with how many calls it has, the members whose bodies reach them,
// and why the claim still holds for them. A body that needs its wrapper asks for it with `passThis`, or has
// `capability: "js"`.
const allowed: Record<string, { calls: number; why: string }> = {
  "src/runtime/webcore/Sink.rs": {
    calls: 1,
    why: "ReadableSinkController::this_value, under take_sink and detach_with_reason, which run under end, close and write, all of capability js",
  },
};

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

const callers: Record<string, number> = {};
let scanned = 0;
for (const abs of rustSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const content = await file(abs).text();
  const stripped = content.replace(/\/\*[^]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  // Every call, and not the definition `unsafe fn wrapper_value(&self)`.
  const calls = stripped.match(/(?<!fn\s+)\bwrapper_value\s*\(/g)?.length ?? 0;
  if (calls > 0) callers[source] = calls;
}

test("scans a non-empty set of tracked Rust sources", () => {
  expect(scanned).toBeGreaterThan(0);
});

test("every call of wrapper_value() is in a file listed with the members that reach it", () => {
  expect(callers).toEqual(Object.fromEntries(Object.entries(allowed).map(([source, { calls }]) => [source, calls])));
});
