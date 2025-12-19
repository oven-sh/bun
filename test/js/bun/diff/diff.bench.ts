/**
 * Benchmark bun:diff against git diff --no-index
 *
 * Run with:
 *   bun run test/js/bun/diff/diff.bench.ts          # release bun
 *   bun bd test/js/bun/diff/diff.bench.ts           # debug build
 */

import { spawnSync } from "bun";
import { diff } from "bun:diff";

// Generate test content
function generateLines(count: number, prefix: string): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(`${prefix} line ${i}: ${"x".repeat(50 + (i % 50))}`);
  }
  return lines.join("\n") + "\n";
}

function generateModifiedContent(original: string, changePercent: number): string {
  const lines = original.split("\n");
  const numChanges = Math.floor((lines.length * changePercent) / 100);
  const indices = new Set<number>();

  // Pick random lines to change
  while (indices.size < numChanges && indices.size < lines.length) {
    indices.add(Math.floor(Math.random() * lines.length));
  }

  return lines.map((line, i) => (indices.has(i) ? `MODIFIED: ${line}` : line)).join("\n");
}

interface BenchmarkResult {
  name: string;
  bunDiffMs: number;
  gitDiffMs: number;
  speedup: number;
  linesA: number;
  linesB: number;
  edits: number;
}

async function benchmarkGitDiff(a: string, b: string): Promise<number> {
  // Write temp files
  const tmpA = `/tmp/bun-diff-bench-a-${Date.now()}.txt`;
  const tmpB = `/tmp/bun-diff-bench-b-${Date.now()}.txt`;

  await Bun.write(tmpA, a);
  await Bun.write(tmpB, b);

  const start = performance.now();
  spawnSync(["git", "diff", "--no-index", "--no-color", tmpA, tmpB], {
    stdout: "ignore",
    stderr: "ignore",
  });
  const elapsed = performance.now() - start;

  // Cleanup
  await Bun.$`rm -f ${tmpA} ${tmpB}`.quiet();

  return elapsed;
}

function benchmarkBunDiff(a: string, b: string): { ms: number; edits: number } {
  const start = performance.now();
  const result = diff(a, b);
  const elapsed = performance.now() - start;
  return { ms: elapsed, edits: result.edits.length };
}

async function runBenchmark(
  name: string,
  a: string,
  b: string,
  warmupRuns = 3,
  benchRuns = 10,
): Promise<BenchmarkResult> {
  const linesA = a.split("\n").length;
  const linesB = b.split("\n").length;

  // Warmup
  for (let i = 0; i < warmupRuns; i++) {
    diff(a, b);
    await benchmarkGitDiff(a, b);
  }

  // Benchmark bun:diff
  let bunTotal = 0;
  let edits = 0;
  for (let i = 0; i < benchRuns; i++) {
    const result = benchmarkBunDiff(a, b);
    bunTotal += result.ms;
    edits = result.edits;
  }
  const bunDiffMs = bunTotal / benchRuns;

  // Benchmark git diff
  let gitTotal = 0;
  for (let i = 0; i < benchRuns; i++) {
    gitTotal += await benchmarkGitDiff(a, b);
  }
  const gitDiffMs = gitTotal / benchRuns;

  return {
    name,
    bunDiffMs,
    gitDiffMs,
    speedup: gitDiffMs / bunDiffMs,
    linesA,
    linesB,
    edits,
  };
}

async function main() {
  console.log("bun:diff Benchmark");
  console.log("==================");
  console.log(`Bun version: ${Bun.version}`);
  console.log(`Build: ${Bun.version.includes("debug") ? "DEBUG" : "RELEASE"}`);
  console.log("");

  const results: BenchmarkResult[] = [];

  // Test cases
  const testCases = [
    { name: "Small identical (100 lines)", lines: 100, changePercent: 0 },
    { name: "Small 10% changed (100 lines)", lines: 100, changePercent: 10 },
    { name: "Medium identical (1K lines)", lines: 1000, changePercent: 0 },
    { name: "Medium 5% changed (1K lines)", lines: 1000, changePercent: 5 },
    { name: "Medium 20% changed (1K lines)", lines: 1000, changePercent: 20 },
    { name: "Large identical (10K lines)", lines: 10000, changePercent: 0 },
    { name: "Large 5% changed (10K lines)", lines: 10000, changePercent: 5 },
    { name: "Large 50% changed (10K lines)", lines: 10000, changePercent: 50 },
  ];

  for (const tc of testCases) {
    process.stdout.write(`Running: ${tc.name}...`);
    const a = generateLines(tc.lines, "original");
    const b = tc.changePercent === 0 ? a : generateModifiedContent(a, tc.changePercent);
    const result = await runBenchmark(tc.name, a, b);
    results.push(result);
    console.log(" done");
  }

  // Print results table
  console.log("\nResults:");
  console.log("─".repeat(90));
  console.log(
    "Test Case".padEnd(35),
    "bun:diff".padStart(12),
    "git diff".padStart(12),
    "Speedup".padStart(10),
    "Edits".padStart(8),
  );
  console.log("─".repeat(90));

  for (const r of results) {
    console.log(
      r.name.padEnd(35),
      `${r.bunDiffMs.toFixed(2)}ms`.padStart(12),
      `${r.gitDiffMs.toFixed(2)}ms`.padStart(12),
      `${r.speedup.toFixed(1)}x`.padStart(10),
      r.edits.toString().padStart(8),
    );
  }
  console.log("─".repeat(90));

  // Summary
  const avgSpeedup = results.reduce((sum, r) => sum + r.speedup, 0) / results.length;
  console.log(`\nAverage speedup: ${avgSpeedup.toFixed(1)}x`);
}

main().catch(console.error);
