/**
 * Permission system performance benchmark
 *
 * Run with:
 *   bun ./test/js/bun/permissions/benchmark-permissions.ts
 *   bun --secure --allow-all ./test/js/bun/permissions/benchmark-permissions.ts
 *
 * Or use the runner script:
 *   bun ./test/js/bun/permissions/run-benchmark.ts
 */

const ITERATIONS = 10000;
const WARMUP = 1000;

interface BenchResult {
  name: string;
  totalMs: number;
  avgNs: number;
  opsPerSec: number;
}

function computeResult(name: string, totalNs: number): BenchResult {
  const totalMs = totalNs / 1_000_000;
  const avgNs = totalNs / ITERATIONS;
  const opsPerSec = Math.round(1_000_000_000 / avgNs);
  return { name, totalMs, avgNs, opsPerSec };
}

/** Benchmark for async operations */
async function benchAsync(name: string, fn: () => Promise<void>): Promise<BenchResult> {
  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    await fn();
  }

  // Benchmark
  const start = Bun.nanoseconds();
  for (let i = 0; i < ITERATIONS; i++) {
    await fn();
  }
  const end = Bun.nanoseconds();

  return computeResult(name, end - start);
}

/** Benchmark for sync operations - avoids Promise/await overhead */
function benchSync(name: string, fn: () => void): BenchResult {
  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    fn();
  }

  // Benchmark
  const start = Bun.nanoseconds();
  for (let i = 0; i < ITERATIONS; i++) {
    fn();
  }
  const end = Bun.nanoseconds();

  return computeResult(name, end - start);
}

async function runBenchmarks() {
  // Detect secure mode by checking if permissions API reports restricted state
  let isSecure = false;
  try {
    const status = Bun.permissions.querySync({ name: "read" });
    // In normal mode, status is "granted". In secure mode with --allow-all, it's also "granted"
    // but we can detect secure mode by checking if the permissions object behavior differs
    // Better approach: check an env var we set
    isSecure = process.env.BUN_BENCHMARK_SECURE === "1";
  } catch {
    isSecure = false;
  }
  const mode = isSecure ? "SECURE MODE" : "NORMAL MODE";

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Permission Benchmark - ${mode}`);
  console.log(`  Iterations: ${ITERATIONS.toLocaleString()}`);
  console.log(`${"=".repeat(60)}\n`);

  const results: BenchResult[] = [];

  // Create temp files for benchmarks
  const tempDir = (await Bun.file("/tmp/bun-perm-bench").exists())
    ? "/tmp/bun-perm-bench"
    : (() => {
        Bun.spawnSync({ cmd: ["mkdir", "-p", "/tmp/bun-perm-bench"] });
        return "/tmp/bun-perm-bench";
      })();

  await Bun.write(`${tempDir}/test.txt`, "hello world");
  await Bun.write(`${tempDir}/test.json`, '{"key": "value"}');

  // Async benchmarks
  // Benchmark 1: Bun.file().text() - file read (async)
  results.push(
    await benchAsync("Bun.file().text()", async () => {
      await Bun.file(`${tempDir}/test.txt`).text();
    }),
  );

  // Benchmark 2: Bun.file().exists() (async)
  results.push(
    await benchAsync("Bun.file().exists()", async () => {
      await Bun.file(`${tempDir}/test.txt`).exists();
    }),
  );

  // Benchmark 3: Bun.file().json() (async)
  results.push(
    await benchAsync("Bun.file().json()", async () => {
      await Bun.file(`${tempDir}/test.json`).json();
    }),
  );

  // Benchmark 4: Bun.write() (async)
  results.push(
    await benchAsync("Bun.write()", async () => {
      await Bun.write(`${tempDir}/output.txt`, "test content");
    }),
  );

  // Sync benchmarks - no await overhead
  const fs = await import("node:fs");

  // Benchmark 5: Bun.file().size (sync property)
  results.push(
    benchSync("Bun.file().size", () => {
      const _ = Bun.file(`${tempDir}/test.txt`).size;
    }),
  );

  // Benchmark 6: fs.readFileSync (sync)
  results.push(
    benchSync("fs.readFileSync()", () => {
      fs.readFileSync(`${tempDir}/test.txt`, "utf8");
    }),
  );

  // Benchmark 7: fs.writeFileSync (sync)
  results.push(
    benchSync("fs.writeFileSync()", () => {
      fs.writeFileSync(`${tempDir}/output2.txt`, "test content");
    }),
  );

  // Benchmark 8: fs.existsSync (sync)
  results.push(
    benchSync("fs.existsSync()", () => {
      fs.existsSync(`${tempDir}/test.txt`);
    }),
  );

  // Benchmark 9: fs.statSync (sync)
  results.push(
    benchSync("fs.statSync()", () => {
      fs.statSync(`${tempDir}/test.txt`);
    }),
  );

  // Benchmark 10: process.env access (sync)
  results.push(
    benchSync("process.env.HOME", () => {
      const _ = process.env.HOME;
    }),
  );

  // Benchmark 11: Bun.env access (sync)
  results.push(
    benchSync("Bun.env.HOME", () => {
      const _ = Bun.env.HOME;
    }),
  );

  // Symlink resolution benchmarks (only in secure mode)
  if (isSecure) {
    // Create symlink for testing
    const symlinkDir = `${tempDir}/symlink-test`;
    Bun.spawnSync({ cmd: ["rm", "-rf", symlinkDir] });
    Bun.spawnSync({ cmd: ["mkdir", "-p", symlinkDir] });
    await Bun.write(`${symlinkDir}/target.txt`, "symlink target content");
    Bun.spawnSync({ cmd: ["ln", "-sf", `${symlinkDir}/target.txt`, `${symlinkDir}/link.txt`] });

    // Create a chain of symlinks
    Bun.spawnSync({ cmd: ["ln", "-sf", `${symlinkDir}/link.txt`, `${symlinkDir}/link2.txt`] });
    Bun.spawnSync({ cmd: ["ln", "-sf", `${symlinkDir}/link2.txt`, `${symlinkDir}/link3.txt`] });

    // Benchmark 12: Read through symlink (includes realpath overhead)
    results.push(
      benchSync("fs.readFileSync (symlink)", () => {
        fs.readFileSync(`${symlinkDir}/link.txt`, "utf8");
      }),
    );

    // Benchmark 13: Read direct file (baseline for comparison)
    results.push(
      benchSync("fs.readFileSync (direct)", () => {
        fs.readFileSync(`${symlinkDir}/target.txt`, "utf8");
      }),
    );

    // Benchmark 14: Read through symlink chain (3 levels)
    results.push(
      benchSync("fs.readFileSync (3 symlinks)", () => {
        fs.readFileSync(`${symlinkDir}/link3.txt`, "utf8");
      }),
    );

    // Benchmark 15: stat through symlink
    results.push(
      benchSync("fs.statSync (symlink)", () => {
        fs.statSync(`${symlinkDir}/link.txt`);
      }),
    );

    // Benchmark 16: stat direct file
    results.push(
      benchSync("fs.statSync (direct)", () => {
        fs.statSync(`${symlinkDir}/target.txt`);
      }),
    );
  }

  // Print results
  console.log("Results:");
  console.log("-".repeat(60));
  console.log(
    `${"Operation".padEnd(25)} ${"Total (ms)".padStart(12)} ${"Avg (ns)".padStart(12)} ${"ops/sec".padStart(12)}`,
  );
  console.log("-".repeat(60));

  for (const r of results) {
    console.log(
      `${r.name.padEnd(25)} ${r.totalMs.toFixed(2).padStart(12)} ${r.avgNs.toFixed(0).padStart(12)} ${r.opsPerSec.toLocaleString().padStart(12)}`,
    );
  }

  console.log("-".repeat(60));

  // Output JSON for comparison script
  const jsonOutput = {
    mode,
    iterations: ITERATIONS,
    results: results.map(r => ({
      name: r.name,
      avgNs: r.avgNs,
      opsPerSec: r.opsPerSec,
    })),
  };

  await Bun.write(`/tmp/bun-perm-bench-${isSecure ? "secure" : "normal"}.json`, JSON.stringify(jsonOutput, null, 2));

  console.log(`\nResults saved to /tmp/bun-perm-bench-${isSecure ? "secure" : "normal"}.json`);
}

runBenchmarks().catch(console.error);
