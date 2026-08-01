// https://github.com/oven-sh/bun/issues/8290
// `bun test --coverage` line mapping for class methods was shifted, and lcov
// reported nonzero hit counts for method bodies that never executed.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { readFileSync } from "node:fs";
import path from "node:path";

test("coverage maps uncovered class methods to the correct source lines", async () => {
  using dir = tempDir("cov-8290", {
    "live.mock.mjs":
      "export class MockLive {\n" +
      "\n" +
      "    calls = []\n" +
      "\n" +
      "    async consume(event) {\n" +
      "        this.calls.push({ consume: { event } })\n" +
      "    }\n" +
      "\n" +
      "    covered() { return 1 }\n" +
      "\n" +
      "    another() { return 2 }\n" +
      "}\n",
    "derived.mjs":
      "class Base { hit() { return 1 } }\n" + //
      "export class Derived extends Base {\n" +
      "    miss() { return 2 }\n" +
      "}\n",
    "spin.mjs":
      "export function spin() {\n" + //
      "    let n = 0;\n" +
      "    for (let i = 0; i < 5; i++) {\n" +
      "        n++;\n" +
      "    }\n" +
      "    return n;\n" +
      "}\n",
    "live.test.mjs":
      `import { test, expect } from "bun:test";\n` +
      `import { MockLive } from "./live.mock.mjs";\n` +
      `import { Derived } from "./derived.mjs";\n` +
      `import { spin } from "./spin.mjs";\n` +
      `test("x", () => {\n` +
      `  expect(new MockLive().covered()).toBe(1);\n` +
      `  expect(new Derived().hit()).toBe(1);\n` +
      `  expect(spin()).toBe(5);\n` +
      `});\n`,
  });

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "test",
      "--coverage",
      "--coverage-reporter=text",
      "--coverage-reporter=lcov",
      "--coverage-dir=./coverage",
      "live.test.mjs",
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const text = normalizeBunSnapshot(stderr, dir);
  // `consume` is declared on lines 5-7 and `another` on line 11; neither runs.
  // The report previously said `3-5` (shifted into the `calls = []` field) and
  // omitted `another` entirely.
  expect(text).toContain("5-6,11");
  expect(text).not.toContain("3-5");

  const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8");
  const mock = lcov.split("end_of_record").find(r => r.includes("live.mock.mjs"))!;
  const da: Record<number, number> = {};
  for (const m of mock.matchAll(/^DA:(\d+),(\d+)$/gm)) {
    da[Number(m[1])] = Number(m[2]);
  }

  // Never-called method bodies must report 0 hits.
  expect(da[5]).toBe(0);
  expect(da[6]).toBe(0);
  expect(da[11]).toBe(0);
  // Lines that did run (class decl, field initializer, the called method) must
  // be nonzero, and the hit count must be an execution count, not a byte count.
  for (const line of [1, 3, 9]) {
    expect(da[line]).toBeGreaterThan(0);
    expect(da[line]).toBeLessThan(10);
  }

  const fnf = Number(mock.match(/^FNF:(\d+)$/m)![1]);
  // consume, covered, another. The synthetic default constructor must not be
  // counted as a user function.
  expect(fnf).toBe(3);

  // Derived class without an explicit constructor: the synthetic derived
  // default constructor (and the base default constructor) must not be
  // counted, and must not clear line 1.
  const derived = lcov.split("end_of_record").find(r => r.includes("derived.mjs"))!;
  const derivedFnf = Number(derived.match(/^FNF:(\d+)$/m)![1]);
  // hit, miss only.
  expect(derivedFnf).toBe(2);
  const derivedDa: Record<number, number> = {};
  for (const m of derived.matchAll(/^DA:(\d+),(\d+)$/gm)) {
    derivedDa[Number(m[1])] = Number(m[2]);
  }
  expect(derivedDa[1]).toBeGreaterThan(0);
  expect(derivedDa[3]).toBe(0);

  // Loop body must report the block's execution count (5 iterations), not 1.
  // This distinguishes reading `block.execution_count` from a hardcoded 1 and
  // from the old per-byte accumulation.
  const spinRec = lcov.split("end_of_record").find(r => r.includes("spin.mjs"))!;
  const spinDa: Record<number, number> = {};
  for (const m of spinRec.matchAll(/^DA:(\d+),(\d+)$/gm)) {
    spinDa[Number(m[1])] = Number(m[2]);
  }
  expect(spinDa[4]).toBe(5);

  expect(text).toContain("1 pass");
  expect(stdout).toContain("bun test");
  expect(exitCode).toBe(0);
});

test("coverage text reporter prints a trailing single-line uncovered range", async () => {
  using dir = tempDir("cov-8290-trailing", {
    "mod.ts":
      "export function hit() {\n" + //
      "  return 1;\n" +
      "}\n" +
      "export function miss() { return 2 }\n",
    "mod.test.ts":
      `import { test, expect } from "bun:test";\n` +
      `import { hit } from "./mod.ts";\n` +
      `test("x", () => { expect(hit()).toBe(1); });\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "mod.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const text = normalizeBunSnapshot(stderr, dir);
  // `miss` is on line 4 and is the only uncovered line. The range printer
  // previously dropped a trailing single-line range entirely.
  const row = text.split("\n").find(l => /^\s*mod\.ts\b/.test(l))!;
  expect(row).toMatch(/\|\s*4\s*$/);
  expect(exitCode).toBe(0);
});

test("coverage no-sourcemap path reports execution counts and clears uncalled functions", async () => {
  using dir = tempDir("cov-8290-nosm", {
    "bunfig.toml": "[test]\ncoverageIgnoreSourcemaps = true\n",
    "spin.mjs":
      "export function spin() {\n" +
      "    let n = 0;\n" +
      "    for (let i = 0; i < 5; i++) {\n" +
      "        n++;\n" +
      "    }\n" +
      "    return n;\n" +
      "}\n" +
      "export function miss() { return 2 }\n",
    "spin.test.mjs":
      `import { test, expect } from "bun:test";\n` +
      `import { spin } from "./spin.mjs";\n` +
      `test("x", () => { expect(spin()).toBe(5); });\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--coverage", "--coverage-reporter=lcov", "--coverage-dir=./coverage", "spin.test.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const lcov = readFileSync(path.join(String(dir), "coverage", "lcov.info"), "utf-8");
  const rec = lcov.split("end_of_record").find(r => r.includes("spin.mjs"))!;
  const da = [...rec.matchAll(/^DA:(\d+),(\d+)$/gm)].map(m => [Number(m[1]), Number(m[2])] as const);

  // Loop body ran 5x; at least one line must carry the block execution_count.
  expect(da.some(([, hits]) => hits === 5)).toBe(true);
  // `miss()` never ran; its lines must be cleared to 0 through the inclusive
  // max_line bound.
  const zeroLines = da.filter(([, hits]) => hits === 0).map(([line]) => line);
  expect(zeroLines.length).toBeGreaterThanOrEqual(2);
  // Every hit count is an execution count, not a byte count.
  for (const [, hits] of da) expect(hits).toBeLessThan(10);

  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
});
