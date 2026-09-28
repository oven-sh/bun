import { file } from "bun";
import { describe, expect, test } from "bun:test";
import path from "path";
import { globAllSources } from "../../../scripts/glob-sources.ts";

// An uncaught error that no listener takes ends the process with status 1. That is the default of
// `VirtualMachine::uncaught_exception` and of everything that folds into it: `run_callback`,
// `report_error_or_terminate`, `dispatch::fold`, the task queue and the timers. So a native callback
// that nobody looked at exits like node, and cannot leave a process that prints the error and stays in
// the event loop.
//
// A caller that goes on after the report says so by name: `uncaught_exception_keep_alive`,
// `unhandled_rejection_keep_alive`, `run_callback_keep_alive` or
// `report_error_or_terminate_keep_alive` in Rust, `Bun__reportError` in C++, `reportError()` in a
// builtin. These are `reportError()` itself, the macro runner, and the handlers of Bun.serve
// websockets, Bun.listen, Bun.connect, Bun.udpSocket, Bun.spawn ipc and Bun.WebView.
//
// This is a ratchet: `keep-alive-report.inventory.json` counts those call sites per file. A new one
// fails the test, because it is a decision that a throw there does not end the process. Removing one
// requires lowering its count (the test tells you). A builtin of a `node:` module has no such case:
// node ends the process, so use `reportUncaughtException` from internal/shared.
// Regenerate with `bun test/internal/source-lints/keep-alive-report.test.ts --update` (run as a script).

const root = path.resolve(import.meta.dir, "..", "..", "..");
const INVENTORY = import.meta.dir + "/keep-alive-report.inventory.json";

const RUST =
  /\b(?:uncaught_exception_keep_alive|unhandled_rejection_keep_alive|run_callback_keep_alive|report_error_or_terminate_keep_alive)\s*\(/;
const CXX = /\bBun__reportError\s*\(/;
const JS = /(?<![.\w$])reportError\s*\(/;

type Inventory = Record<string, number>;
const found: Inventory = {};
const sites: string[] = [];
let scanned = 0;

async function scan(abs: string, re: RegExp, isDeclaration: (line: string) => boolean) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  scanned++;
  const lines = (await file(abs).text()).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
    if (!re.test(line) || isDeclaration(line)) continue;
    found[source] = (found[source] ?? 0) + 1;
    sites.push(`${source}:${i + 1}: ${line.trim()}`);
  }
}

const sources = globAllSources();
for (const abs of sources.rust.filter(p => p.endsWith(".rs"))) {
  await scan(abs, RUST, line => /\bfn\s+\w+_keep_alive\s*\(/.test(line));
}
for (const abs of sources.cxx.filter(p => p.endsWith(".cpp"))) {
  await scan(abs, CXX, line => /^\s*extern\b/.test(line));
}
for (const abs of sources.js) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  if (!source.startsWith("src/js/node/") && !source.startsWith("src/js/internal/")) continue;
  await scan(abs, JS, () => false);
}

if (process.argv.includes("--update")) {
  const sorted: Inventory = {};
  for (const f of Object.keys(found).sort()) sorted[f] = found[f];
  await Bun.write(INVENTORY, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(sorted).length} files to ${path.basename(INVENTORY)}`);
  process.exit(0);
}

const inventory: Inventory = await file(INVENTORY)
  .json()
  .catch(() => ({}));

describe("reports that keep the process alive (ratchet)", () => {
  test("scans a non-empty set of sources", () => {
    expect(scanned).toBeGreaterThan(0);
  });

  test("no new caller goes on after an uncaught error", () => {
    const grown: string[] = [];
    for (const [f, count] of Object.entries(found)) {
      const allowed = inventory[f] ?? 0;
      if (count > allowed) {
        grown.push(`${f}: ${allowed} → ${count}`);
        for (const s of sites) if (s.startsWith(f + ":")) grown.push("    " + s);
      }
    }
    expect(
      grown,
      "a throw at these sites would print and leave the process running; use the default report, or reportUncaughtException in a builtin — see the header of this test",
    ).toEqual([]);
  });

  test("inventory shrinks when a caller takes the default", () => {
    const stale: string[] = [];
    for (const [f, allowed] of Object.entries(inventory)) {
      const count = found[f] ?? 0;
      if (count < allowed) stale.push(`${f}: ${count} now, inventory says ${allowed} — lower it`);
    }
    expect(stale).toEqual([]);
  });
});
