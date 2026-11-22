import { file, Glob } from "bun";
import { describe, expect, test } from "bun:test";
import path from "path";

// JSC's catching overloads of `call()` and `profiledCall()` (the ones with a `NakedPtr<Exception>&`
// out-parameter) and every `JSC::evaluate()` (the forms without the parameter declare one and discard it)
// clear whatever the callee threw from the VM, a TerminationException included. A TerminationException is
// not the callee's error: it is the VM's stop (a worker's `process.exit()`, its parent's `terminate()`, a
// `node:vm` timeout). A frame that script can call and that takes it this way has dropped the stop: the
// script beneath goes on, and queued work runs on a VM that was told to stop.
//
// Such a frame reads `mustNotEnterScript()` (BunClientData.h, ScriptExecutionContext.h), calls with the
// plain overload under a `TopExceptionScope`, and hands what it finds there to
// `Bun::clearExceptionOrTakeTermination()` before it reports anything:
//
//     if (WebCore::clientData(vm)->mustNotEnterScript(vm)) [[unlikely]]
//         return;
//     call(globalObject, function, callData, thisValue, args);
//     if (auto* exception = scope.exception()) [[unlikely]] {
//         if (!Bun::clearExceptionOrTakeTermination(vm, scope))
//             return; // the VM's stop: pending beneath script, taken outside it
//         report(exception);
//     }
//
// (`EventEmitter::innerInvokeEventListeners`, `JSEventListener::handleEvent`, `JSCallbackData::invokeCallback`.)
// A frame that throws it again uses the plain overload and `RETURN_IF_EXCEPTION`.
//
// The other half of the rule has no spelling to count: a report can stop the VM and leave nothing pending,
// so a loop that reports an error and then calls script again reads the gate first, as
// `JSNextTickQueue::drain` does. The tests in "a worker stopped by the handler of its uncaught error"
// (worker_threads.test.ts) guard that half.
//
// This is a ratchet. `nakedptr-exception.inventory.json` counts the lines of today's uses per file: they are
// grandfathered, and each conversion lowers a count. A new use fails the test. Regenerate with
// `bun test/internal/source-lints/nakedptr-exception.test.ts --update` (run as a script) only when removing.
// It counts two spellings. A bare `scope.clearException()` and `CLEAR_AND_RETURN_IF_EXCEPTION` clear a
// termination too, and pass.

const root = path.resolve(import.meta.dir, "..", "..", "..");
const INVENTORY = import.meta.dir + "/nakedptr-exception.inventory.json";
const PATTERN =
  /\bNakedPtr<\s*(?:JSC::)?Exception\s*>|\bJSC::(?:evaluate|profiledEvaluate|evaluateWithScopeExtension)\s*\(/;
// A node:vm run owns the termination of its own timeout and withdraws it (NodeVMRunTermination).
const OWNS_ITS_TERMINATION = new Set([
  "src/jsc/bindings/NodeVM.cpp",
  "src/jsc/bindings/NodeVM.h",
  "src/jsc/bindings/NodeVMScript.cpp",
  "src/jsc/bindings/NodeVMScript.h",
]);

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
  if (OWNS_ITS_TERMINATION.has(source)) continue;
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

describe("calls that clear what script threw, a termination too (ratchet)", () => {
  test("scans a non-empty set of tracked C++ sources", () => {
    expect(scanned).toBeGreaterThan(0);
  });

  test("no new NakedPtr<Exception> or JSC::evaluate()", () => {
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
      "call script with the plain overload under a TopExceptionScope and hand what it threw to Bun::clearExceptionOrTakeTermination, see the header of this test",
    ).toEqual([]);
  });

  test("inventory shrinks when a use is removed", () => {
    const stale: string[] = [];
    for (const [f, allowed] of Object.entries(inventory)) {
      const count = found[f] ?? 0;
      if (count < allowed) stale.push(`${f} is ${count} now, inventory says ${allowed}: lower it`);
    }
    expect(stale).toEqual([]);
  });
});
