#!/usr/bin/env bun
/**
 * Benchmark runner - compares normal mode vs secure mode performance
 *
 * Usage:
 *   bun ./test/js/bun/permissions/run-benchmark.ts
 *
 * Or with debug build:
 *   bun bd ./test/js/bun/permissions/run-benchmark.ts
 */

import { bunEnv, bunExe } from "harness";

const BENCHMARK_FILE = import.meta.dir + "/benchmark-permissions.ts";

async function run() {
  console.log("🚀 Permission System Performance Benchmark\n");

  // Run normal mode
  console.log("Running benchmark in NORMAL mode...");
  const normalProc = Bun.spawnSync({
    cmd: [bunExe(), BENCHMARK_FILE],
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (normalProc.exitCode !== 0) {
    console.error("Normal mode benchmark failed");
    process.exit(1);
  }

  console.log("\n");

  // Run secure mode with --allow-all
  console.log("Running benchmark in SECURE mode (--allow-all)...");
  const secureProc = Bun.spawnSync({
    cmd: [bunExe(), "--secure", "--allow-all", BENCHMARK_FILE],
    env: { ...bunEnv, BUN_BENCHMARK_SECURE: "1" },
    stdout: "inherit",
    stderr: "inherit",
  });

  if (secureProc.exitCode !== 0) {
    console.error("Secure mode benchmark failed");
    process.exit(1);
  }

  // Compare results
  console.log("\n");
  console.log("=".repeat(70));
  console.log("  COMPARISON: Normal vs Secure Mode");
  console.log("=".repeat(70));

  try {
    const normalResults = await Bun.file("/tmp/bun-perm-bench-normal.json").json();
    const secureResults = await Bun.file("/tmp/bun-perm-bench-secure.json").json();

    console.log("\n");
    console.log(
      `${"Operation".padEnd(25)} ${"Normal (ns)".padStart(12)} ${"Secure (ns)".padStart(12)} ${"Overhead".padStart(12)} ${"% Change".padStart(10)}`,
    );
    console.log("-".repeat(70));

    let totalNormalNs = 0;
    let totalSecureNs = 0;

    for (const normalOp of normalResults.results) {
      const secureOp = secureResults.results.find((r: any) => r.name === normalOp.name);
      if (!secureOp) continue;

      const overheadNs = secureOp.avgNs - normalOp.avgNs;
      const pctChange = ((secureOp.avgNs - normalOp.avgNs) / normalOp.avgNs) * 100;

      totalNormalNs += normalOp.avgNs;
      totalSecureNs += secureOp.avgNs;

      const overheadStr = overheadNs >= 0 ? `+${overheadNs.toFixed(0)}` : overheadNs.toFixed(0);
      const pctStr = pctChange >= 0 ? `+${pctChange.toFixed(1)}%` : `${pctChange.toFixed(1)}%`;
      const color = pctChange > 10 ? "🔴" : pctChange > 5 ? "🟡" : "🟢";

      console.log(
        `${normalOp.name.padEnd(25)} ${normalOp.avgNs.toFixed(0).padStart(12)} ${secureOp.avgNs.toFixed(0).padStart(12)} ${overheadStr.padStart(12)} ${(color + " " + pctStr).padStart(12)}`,
      );
    }

    console.log("-".repeat(70));

    const totalOverhead = totalSecureNs - totalNormalNs;
    const totalPctChange = ((totalSecureNs - totalNormalNs) / totalNormalNs) * 100;

    console.log(
      `${"TOTAL".padEnd(25)} ${totalNormalNs.toFixed(0).padStart(12)} ${totalSecureNs.toFixed(0).padStart(12)} ${(totalOverhead >= 0 ? "+" : "") + totalOverhead.toFixed(0).padStart(11)} ${(totalPctChange >= 0 ? "+" : "") + totalPctChange.toFixed(1)}%`,
    );

    console.log("\n");
    console.log("Legend: 🟢 < 5% overhead | 🟡 5-10% overhead | 🔴 > 10% overhead");
    console.log("\n");

    // Summary
    if (totalPctChange < 5) {
      console.log("✅ RESULT: Minimal performance impact (< 5% overhead)");
    } else if (totalPctChange < 10) {
      console.log("⚠️  RESULT: Moderate performance impact (5-10% overhead)");
    } else {
      console.log("❌ RESULT: Significant performance impact (> 10% overhead)");
    }
  } catch (e) {
    console.error("Failed to compare results:", e);
  }
}

run().catch(console.error);
