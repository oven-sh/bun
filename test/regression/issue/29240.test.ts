// https://github.com/oven-sh/bun/issues/29240

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

test("cpu-prof callFrame.lineNumber/columnNumber point at function definition, not sample position (#29240)", async () => {
  // fibonacci is recursive so it shows up on many stacks at many different
  // sample lines — this is the exact case where the old Bun output fragmented
  // into dozens of nodes per function. Same for the busy loop body in
  // `anotherFunction`, which gives us per-line ticks to assert on. Each
  // function is time-bounded (not iteration-bounded) so it occupies the CPU
  // for a contiguous 100ms and is guaranteed to span multiple sampler ticks
  // even on Windows, where JSC's SamplingProfiler effectively ticks at the
  // ~15.6ms default timer quantum — an iteration-bounded loop can finish in
  // <1ms once JIT'd and never be on top of stack when sampled.
  using dir = tempDir("issue-29240", {
    "script.js": `function fibonacci(n) {
  if (n < 2) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

function doWork() {
  let sum = 0;
  for (const end = performance.now() + 100; performance.now() < end; ) {
    sum += fibonacci(22);
  }
  return sum;
}

function anotherFunction() {
  let x = 0;
  for (const end = performance.now() + 100; performance.now() < end; ) {
    for (let i = 0; i < 1000; i++) x += Math.sqrt(i);
  }
  return x;
}

doWork();
anotherFunction();
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

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The script must run cleanly. Stderr may contain the debug-build ASAN
  // warning, so we only assert that stdout/exitCode look right.
  expect(stdout).toBe("done\n");
  expect(exitCode).toBe(0);

  const files = readdirSync(String(dir)).filter(f => f.endsWith(".cpuprofile"));
  expect(files).toEqual(["out.cpuprofile"]);

  const profile = JSON.parse(readFileSync(join(String(dir), "out.cpuprofile"), "utf8"));

  // callFrame.url must be a proper `file://` URL for absolute-path scripts —
  // Chrome DevTools and other cpuprofile viewers won't resolve source views
  // from bare paths. Matches Node's `file:///path/to/script.js` format.
  const scriptNodes = profile.nodes.filter(
    (n: any) => typeof n.callFrame.url === "string" && n.callFrame.url.endsWith("/script.js"),
  );
  expect(scriptNodes.length).toBeGreaterThan(0);
  for (const n of scriptNodes) {
    expect(n.callFrame.url).toStartWith("file://");
  }

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
  // the source file and ticks being positive integers whose sum is bounded
  // above by the node's hitCount — only top-frame samples with expression
  // info contribute, so a JIT frame without expression info can bump
  // hitCount without adding a tick.
  const nodesWithTicks = scriptNodes.filter((n: any) => Array.isArray(n.positionTicks) && n.positionTicks.length > 0);
  expect(nodesWithTicks.length).toBeGreaterThan(0);

  for (const node of nodesWithTicks) {
    let sum = 0;
    for (const entry of node.positionTicks) {
      expect(typeof entry.line).toBe("number");
      expect(typeof entry.ticks).toBe("number");
      // Lines are 1-indexed and must fall within the script body
      // (24 content lines; last line is `console.log("done")`).
      expect(entry.line).toBeGreaterThan(0);
      expect(entry.line).toBeLessThanOrEqual(24);
      expect(entry.ticks).toBeGreaterThan(0);
      sum += entry.ticks;
    }
    // positionTicks only records samples that had expression info — which
    // is most but not all of them. Its total is therefore bounded above by
    // the node's hitCount and bounded below by 1 (we filtered for > 0).
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeLessThanOrEqual(node.hitCount);
  }

  // Keying on (functionName, url, lineNumber, columnNumber) must collapse
  // repeated calls of the same function — the exact guarantee the issue
  // reporter asked for so cross-runtime cpuprofile code can merge nodes.
  const uniqueFibKeys = new Set(
    fibNodes.map(
      (n: any) =>
        `${n.callFrame.functionName}|${n.callFrame.url}|${n.callFrame.lineNumber}|${n.callFrame.columnNumber}`,
    ),
  );
  expect(uniqueFibKeys.size).toBe(1);
});

test("cpu-prof respects sourcemaps for both function definition and positionTicks (#29240)", async () => {
  // Bun transpiles `.ts` files through its bundler at load time, which sets
  // up an internal sourcemap from the generated JS back to the original TS.
  // That's the exact path `computeLineColumnWithSourcemap` is wired to.
  // A TS-specific type annotation forces the transpile step (a plain JS file
  // can be loaded raw), giving us a reliable way to exercise the sourcemap
  // codepath in the CPU profiler without hand-rolling a .js.map file.
  using dir = tempDir("issue-29240-sourcemap", {
    "script.ts": `function fibonacci(n: number): number {
  if (n < 2) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

function hot(): number {
  let total = 0;
  const deadline = performance.now() + 200;
  while (performance.now() < deadline) {
    for (let i = 0; i < 40; i++) {
      total += fibonacci(20);
    }
  }
  return total;
}

console.log("result", hot() > 0);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--cpu-prof", "--cpu-prof-dir=.", "--cpu-prof-name=out.cpuprofile", "script.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("result true\n");
  expect(exitCode).toBe(0);

  const files = readdirSync(String(dir)).filter(f => f.endsWith(".cpuprofile"));
  expect(files).toEqual(["out.cpuprofile"]);

  const profile = JSON.parse(readFileSync(join(String(dir), "out.cpuprofile"), "utf8"));

  // After sourcemap remapping, callFrame.url should be the ORIGINAL .ts URL
  // (not a transpiled-bundle `bun://` / `file://...js` URL), and must still
  // be wrapped in a `file://` scheme for tool compatibility.
  const scriptNodes = profile.nodes.filter(
    (n: any) => typeof n.callFrame.url === "string" && n.callFrame.url.endsWith("/script.ts"),
  );
  expect(scriptNodes.length).toBeGreaterThan(0);
  for (const n of scriptNodes) {
    expect(n.callFrame.url).toStartWith("file://");
  }

  // `fibonacci` is defined on line 1 of the ORIGINAL TS source. After the
  // sourcemap is applied, callFrame.lineNumber must be 0 (0-indexed).
  const fibNodes = scriptNodes.filter((n: any) => n.callFrame.functionName === "fibonacci");
  expect(fibNodes.length).toBeGreaterThan(0);
  for (const n of fibNodes) {
    expect(n.callFrame.lineNumber).toBe(0);
  }

  // `hot` is defined on line 6 of the ORIGINAL TS source → 0-indexed 5.
  const hotNodes = scriptNodes.filter((n: any) => n.callFrame.functionName === "hot");
  expect(hotNodes.length).toBeGreaterThan(0);
  for (const n of hotNodes) {
    expect(n.callFrame.lineNumber).toBe(5);
  }

  // positionTicks line numbers must also be remapped to the ORIGINAL TS —
  // within the 17 content lines of script.ts above. If positionTicks surfaced
  // transpiled-source lines, this would drift into high numbers.
  const nodesWithTicks = scriptNodes.filter((n: any) => Array.isArray(n.positionTicks) && n.positionTicks.length > 0);
  expect(nodesWithTicks.length).toBeGreaterThan(0);
  for (const node of nodesWithTicks) {
    let sum = 0;
    for (const entry of node.positionTicks) {
      expect(entry.line).toBeGreaterThan(0);
      expect(entry.line).toBeLessThanOrEqual(17);
      expect(entry.ticks).toBeGreaterThan(0);
      sum += entry.ticks;
    }
    // Same aggregate invariant as the plain-JS test: positionTicks only
    // records top-frame samples that had expression info, so its total is
    // bounded above by the node's hitCount. Guards against a sourcemap-path
    // regression that could inflate ticks (e.g. mistakenly recording ticks
    // for non-top frames or for frames with stale sample lines).
    expect(sum).toBeGreaterThan(0);
    expect(sum).toBeLessThanOrEqual(node.hitCount);
  }

  // Crucially, tools keying on (url, lineNumber, columnNumber) must see the
  // same triplet for every fibonacci node — same URL (the original .ts),
  // same definition line/column. If the sourcemap-mapped URL and line/column
  // were ever computed from different remap calls, recursive fibonacci would
  // fragment into multiple keys.
  const fibKeys = new Set(
    fibNodes.map((n: any) => `${n.callFrame.url}|${n.callFrame.lineNumber}|${n.callFrame.columnNumber}`),
  );
  expect(fibKeys.size).toBe(1);
});
