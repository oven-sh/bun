import { file } from "bun";
import { describe, expect, test } from "bun:test";
import { realpathSync } from "fs";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// A `JsResult` that comes back `Err` means an exception is pending on the VM (or the VM was terminated).
// A frame that observes that and carries on — discarding the result of a call that entered script,
// collapsing the `JsResult` into an `Option`/`bool` on the spot, or taking the exception and dropping it —
// keeps running native code (and often more script) over a state it no longer understands. When the
// exception is a worker's TerminationException that shows up as asserts and use-after-frees far from
// the swallow. Propagate with `?`, or, at a genuine boundary (a uSockets/uWS/timer trampoline), fold it:
// `bun_jsc::task::report_error_or_terminate` / `dispatch::fold`.
//
// This is a ratchet: `jsresult-swallow.inventory.json` counts today's offenders per file and pattern.
// New ones fail the test; fixing one requires lowering its count (the test tells you). Regenerate with
// `bun test/internal/source-lints/jsresult-swallow.test.ts --update` (run as a script) only when removing.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const INVENTORY = import.meta.dir + "/jsresult-swallow.inventory.json";
const SCOPED = ["src/jsc/", "src/runtime/", "src/sql_jsc/", "src/http_jsc/", "src/js_parser_jsc/"];

// Calls whose `JsResult` is legitimately discarded at terminal frames: reporting/folding helpers (their
// `Err` is "the VM stopped", already acted on), and throw helpers (their return *is* the `Err` the caller
// is about to propagate by returning empty).
const TERMINAL =
  /\b(report_error_or_terminate|uncaught_exception|handle_rejected_promises|throw_value|throw_error|throw_js|throw\w*|reject\w*|resolve\w*|emit_error\w*)\s*\(/;

const PATTERNS: [name: string, re: RegExp, applies: (line: string) => boolean][] = [
  [
    "discarded result of a call that enters script",
    /^\s*let _ = .*(\bfrom_js\w*\(|\.call\w*\(|\bcall_check_slow\w*\(|\bfrom_js_host_call\w*\(|\brun_from_js\w*\(|\.delete_property\(|\bcall_next_tick\w*\(|\.for_each\(\s*global|\.to_object\(|\bcall_event_handler\(|\bcall_write_callback\()/,
    // `let _ = f()?;` has propagated the Err; only the Ok value is discarded.
    line => !TERMINAL.test(line) && !/\?\s*;\s*(\/\/.*)?$/.test(line),
  ],
  [
    "JsResult collapsed on the spot",
    // `.ok()` / `.unwrap_or_else(|_| …)` straight off a call taking the global object: the Err is gone
    // and native code carries on. (`unwrap_or` on an `Option` and `is_err()`-then-bail are not this.)
    /\((?:global|global_this|global_object|globalThis)\b[^;?]*\)\.(?:ok\(\)|unwrap_or_else\(\s*\|_\|)/,
    line => !TERMINAL.test(line),
  ],
  ["taken exception discarded", /^\s*let _ = .*\b(?:take_exception|try_take_exception|take_error)\s*\(/, () => true],
];

const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

type Inventory = Record<string, Record<string, number>>;
const found: Inventory = {};
const sites: string[] = [];
let scanned = 0;

for (const abs of globAllSources().rust.filter(p => p.endsWith(".rs"))) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (path.relative(root, realpathSync(abs)).replaceAll(path.sep, "/") !== source) continue;
  if (!SCOPED.some(p => source.startsWith(p))) continue;
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const lines = (await file(abs).text()).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\/\//.test(line)) continue;
    for (const [name, re, applies] of PATTERNS) {
      if (re.test(line) && applies(line)) {
        (((found[source] ??= {})[name] ??= 0), found[source][name]++);
        sites.push(`${source}:${i + 1}: ${name}: ${line.trim()}`);
      }
    }
  }
}

if (process.argv.includes("--update")) {
  const sorted: Inventory = {};
  for (const f of Object.keys(found).sort()) {
    sorted[f] = {};
    for (const n of Object.keys(found[f]).sort()) sorted[f][n] = found[f][n];
  }
  await Bun.write(INVENTORY, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(sorted).length} files to ${path.basename(INVENTORY)}`);
  process.exit(0);
}

const inventory: Inventory = await file(INVENTORY)
  .json()
  .catch(() => ({}));

describe("JsResult swallowing (ratchet)", () => {
  test("scans a non-empty set of tracked Rust sources", () => {
    expect(scanned).toBeGreaterThan(0);
  });

  test("no new swallowed JsResult", () => {
    const grown: string[] = [];
    for (const [f, byName] of Object.entries(found)) {
      for (const [name, count] of Object.entries(byName)) {
        const allowed = inventory[f]?.[name] ?? 0;
        if (count > allowed) {
          grown.push(`${f}: "${name}" ${allowed} → ${count}`);
          for (const s of sites) if (s.startsWith(f + ":") && s.includes(name)) grown.push("    " + s);
        }
      }
    }
    expect(
      grown,
      "propagate with `?`, or fold at a real boundary (report_error_or_terminate / dispatch::fold) — see the header of this test",
    ).toEqual([]);
  });

  test("inventory shrinks when a swallow is fixed", () => {
    const stale: string[] = [];
    for (const [f, byName] of Object.entries(inventory)) {
      for (const [name, allowed] of Object.entries(byName)) {
        const count = found[f]?.[name] ?? 0;
        if (count < allowed) stale.push(`${f}: "${name}" is ${count} now, inventory says ${allowed} — lower it`);
      }
    }
    expect(stale).toEqual([]);
  });
});
