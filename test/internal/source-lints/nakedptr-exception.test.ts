import { file, Glob } from "bun";
import { describe, expect, test } from "bun:test";
import path from "path";

// JSC's `NakedPtr<Exception>&` overloads of `call()` / `profiledCall()` hand the caller whatever the
// callee threw and clear it from the VM, a TerminationException included. A TerminationException is
// not the callee's error: it is the VM's stop (a worker's `process.exit()`, its parent's
// `terminate()`, a `node:vm` timeout). A frame that takes it this way and then reports "the error"
// has dropped the stop: the script that called into native code goes on, and queued work runs on a
// VM that was told to stop.
//
// A frame that calls script and does not re-throw what it threw uses the plain overload under a
// `TopExceptionScope` instead:
//
//     call(globalObject, function, callData, thisValue, args);
//     if (auto* exception = scope.exception()) [[unlikely]] {
//         if (!scope.tryClearException()) {            // the VM's stop
//             Bun::takeTerminationOutsideScript(vm, scope); // pending beneath script, taken outside it
//             return;
//         }
//         report(exception);
//     }
//
// (`EventEmitter::innerInvokeEventListeners`, `JSEventListener::handleEvent`, `NodeTimerObject.cpp`.)
//
// This is a ratchet: `nakedptr-exception.inventory.json` counts today's uses per file. They re-throw
// what they take, or convert it for a caller that does. A new one fails the test; removing one requires
// lowering its count (the test tells you). Regenerate with
// `bun test/internal/source-lints/nakedptr-exception.test.ts --update` (run as a script) only when removing.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const INVENTORY = import.meta.dir + "/nakedptr-exception.inventory.json";
const PATTERN = /\bNakedPtr<\s*(?:JSC::)?Exception\s*>/;

const tracked: Set<string> | null = (() => {
  const r = Bun.spawnSync({
    cmd: ["git", "-C", root, "ls-tree", "-r", "--name-only", "-z", "HEAD", "--", "src"],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (!r.success) return null;
  return new Set(r.stdout.toString().split("\0").filter(Boolean));
})();

type Inventory = Record<string, number>;
const found: Inventory = {};
const sites: string[] = [];
let scanned = 0;

for await (const rel of new Glob("src/**/*.{h,cpp}").scan({ cwd: root })) {
  const source = rel.replaceAll(path.sep, "/");
  if (tracked !== null && !tracked.has(source)) continue;
  scanned++;
  const lines = (await file(path.join(root, rel)).text()).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\/\//.test(line) || !PATTERN.test(line)) continue;
    found[source] = (found[source] ?? 0) + 1;
    sites.push(`${source}:${i + 1}: ${line.trim()}`);
  }
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

describe("NakedPtr<Exception> takes (ratchet)", () => {
  test("scans a non-empty set of tracked C++ sources", () => {
    expect(scanned).toBeGreaterThan(0);
  });

  test("no new NakedPtr<Exception> take", () => {
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
      "call script with the plain overload under a TopExceptionScope and leave a termination to Bun::takeTerminationOutsideScript — see the header of this test",
    ).toEqual([]);
  });

  test("inventory shrinks when a take is removed", () => {
    const stale: string[] = [];
    for (const [f, allowed] of Object.entries(inventory)) {
      const count = found[f] ?? 0;
      if (count < allowed) stale.push(`${f} is ${count} now, inventory says ${allowed} — lower it`);
    }
    expect(stale).toEqual([]);
  });
});
