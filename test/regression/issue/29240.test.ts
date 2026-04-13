// https://github.com/oven-sh/bun/issues/29240
//
// --cpu-prof wrote the sample position into callFrame.lineNumber /
// callFrame.columnNumber and emitted no positionTicks, diverging from the
// Chrome DevTools CPU profile format used by Node and Deno. Tools that key
// profile nodes on (functionName, url, lineNumber, columnNumber) could not
// merge repeated calls because every sampled statement looked like a distinct
// function.
//
// The fix makes callFrame.lineNumber / columnNumber point at the function's
// DEFINITION (0-indexed), and surfaces per-sample lines as a positionTicks
// array of {line, ticks} pairs (1-indexed), matching Node/Deno output.

import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { bunEnv, bunExe, tempDir } from "harness";

test("cpu-prof callFrame.lineNumber/columnNumber point at function definition, not sample position (#29240)", async () => {
  // fibonacci is recursive so it shows up on many stacks at many different
  // sample lines — this is the exact case where the old Bun output fragmented
  // into dozens of nodes per function. Same for the busy loop body in
  // `anotherFunction`, which gives us per-line ticks to assert on.
  using dir = tempDir("issue-29240", {
    "script.js": `function fibonacci(n) {
  if (n < 2) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

function doWork() {
  let sum = 0;
  for (let i = 0; i < 30; i++) {
    sum += fibonacci(22);
  }
  return sum;
}

function anotherFunction() {
  let x = 0;
  for (let i = 0; i < 200000; i++) {
    x += Math.sqrt(i);
  }
  return x;
}

const deadline = performance.now() + 200;
while (performance.now() < deadline) {
  doWork();
  anotherFunction();
}
console.log("done");
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--cpu-prof", "--cpu-prof-dir=.", "--cpu-prof-name=out.cpuprofile", "script.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The script must run cleanly. Stderr may contain the debug-build ASAN
  // warning, so we only assert that stdout/exitCode look right.
  expect(stdout).toBe("done\n");
  expect(exitCode).toBe(0);

  const files = readdirSync(String(dir)).filter(f => f.endsWith(".cpuprofile"));
  expect(files).toEqual(["out.cpuprofile"]);

  const profile = JSON.parse(readFileSync(join(String(dir), "out.cpuprofile"), "utf8"));

  const scriptNodes = profile.nodes.filter(
    (n: any) => typeof n.callFrame.url === "string" && n.callFrame.url.endsWith("script.js"),
  );
  expect(scriptNodes.length).toBeGreaterThan(0);

  const fibNodes = scriptNodes.filter((n: any) => n.callFrame.functionName === "fibonacci");
  expect(fibNodes.length).toBeGreaterThan(0);

  // Every fibonacci node must report the SAME callFrame line/column, pointing
  // at the definition site of `function fibonacci(n) {` on line 1. Emitted
  // 0-indexed, so lineNumber must be 0. Before the fix, each sampled line
  // became its own node with a different line/col.
  for (const n of fibNodes) {
    expect(n.callFrame.functionName).toBe("fibonacci");
    expect(n.callFrame.lineNumber).toBe(0);
    // Column must be on the definition line, not e.g. column 10 of `return fibonacci`.
    expect(n.callFrame.columnNumber).toBeGreaterThanOrEqual(0);
  }
  // All fibonacci nodes agree on column (they're the same function).
  const fibColumns = new Set(fibNodes.map((n: any) => n.callFrame.columnNumber));
  expect(fibColumns.size).toBe(1);

  // The dedup key now collapses same-function-same-parent into one node, so
  // fibonacci should produce at most a small call-chain of nodes (one per
  // recursion depth observed), not one node per sampled statement. Before the
  // fix this was >100 nodes on a tight recursive workload; cap loosely at 40.
  expect(fibNodes.length).toBeLessThan(40);

  // Other functions report their own definition lines. Line numbers are
  // 0-indexed in the callFrame, so `function doWork() {` on line 6 → 5.
  const doWorkNodes = scriptNodes.filter((n: any) => n.callFrame.functionName === "doWork");
  expect(doWorkNodes.length).toBeGreaterThan(0);
  for (const n of doWorkNodes) {
    expect(n.callFrame.lineNumber).toBe(5);
  }

  const anotherNodes = scriptNodes.filter((n: any) => n.callFrame.functionName === "anotherFunction");
  expect(anotherNodes.length).toBeGreaterThan(0);
  for (const n of anotherNodes) {
    expect(n.callFrame.lineNumber).toBe(13);
  }

  // positionTicks: at least one node from the script must have a populated
  // positionTicks array (the hot loop is long enough that SOME sampled line
  // gets recorded). Each entry is {line, ticks} with line 1-indexed inside
  // the source file and ticks being positive integers that sum to the node's
  // hitCount.
  const nodesWithTicks = scriptNodes.filter(
    (n: any) => Array.isArray(n.positionTicks) && n.positionTicks.length > 0,
  );
  expect(nodesWithTicks.length).toBeGreaterThan(0);

  for (const node of nodesWithTicks) {
    let sum = 0;
    for (const entry of node.positionTicks) {
      expect(typeof entry.line).toBe("number");
      expect(typeof entry.ticks).toBe("number");
      // Lines are 1-indexed and must fall within the script (29 source lines).
      expect(entry.line).toBeGreaterThan(0);
      expect(entry.line).toBeLessThanOrEqual(29);
      expect(entry.ticks).toBeGreaterThan(0);
      sum += entry.ticks;
    }
    // positionTicks only records the top frame of each sample, so its total
    // must equal hitCount for that node.
    expect(sum).toBe(node.hitCount);
  }

  // Keying on (functionName, lineNumber, columnNumber) must collapse
  // repeated calls of the same function — the exact guarantee the issue
  // reporter asked for so cross-runtime cpuprofile code can merge nodes.
  // (The `url` field may appear in two forms — `/abs/path.js` vs
  // `file:///abs/path.js` — depending on how the provider's sourceURL
  // surfaces; that's a pre-existing URL-normalization quirk not in scope
  // for this issue. The line/column merge key is what matters.)
  const uniqueFibKeys = new Set(
    fibNodes.map((n: any) => `${n.callFrame.functionName}|${n.callFrame.lineNumber}|${n.callFrame.columnNumber}`),
  );
  expect(uniqueFibKeys.size).toBe(1);
});
