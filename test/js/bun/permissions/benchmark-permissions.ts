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

async function bench(name: string, fn: () => void | Promise<void>): Promise<BenchResult> {
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

  const totalNs = end - start;
  const totalMs = totalNs / 1_000_000;
  const avgNs = totalNs / ITERATIONS;
  const opsPerSec = Math.round(1_000_000_000 / avgNs);

  return { name, totalMs, avgNs, opsPerSec };
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

  // Benchmark 1: Bun.file().text() - file read
  results.push(
    await bench("Bun.file().text()", async () => {
      await Bun.file(`${tempDir}/test.txt`).text();
    }),
  );

  // Benchmark 2: Bun.file().exists()
  results.push(
    await bench("Bun.file().exists()", async () => {
      await Bun.file(`${tempDir}/test.txt`).exists();
    }),
  );

  // Benchmark 3: Bun.file().size (sync property)
  results.push(
    await bench("Bun.file().size", () => {
      const _ = Bun.file(`${tempDir}/test.txt`).size;
    }),
  );

  // Benchmark 4: Bun.file().json()
  results.push(
    await bench("Bun.file().json()", async () => {
      await Bun.file(`${tempDir}/test.json`).json();
    }),
  );

  // Benchmark 5: Bun.write()
  results.push(
    await bench("Bun.write()", async () => {
      await Bun.write(`${tempDir}/output.txt`, "test content");
    }),
  );

  // Benchmark 6: fs.readFileSync (node:fs)
  const fs = await import("node:fs");
  results.push(
    await bench("fs.readFileSync()", () => {
      fs.readFileSync(`${tempDir}/test.txt`, "utf8");
    }),
  );

  // Benchmark 7: fs.writeFileSync (node:fs)
  results.push(
    await bench("fs.writeFileSync()", () => {
      fs.writeFileSync(`${tempDir}/output2.txt`, "test content");
    }),
  );

  // Benchmark 8: fs.existsSync (node:fs)
  results.push(
    await bench("fs.existsSync()", () => {
      fs.existsSync(`${tempDir}/test.txt`);
    }),
  );

  // Benchmark 9: fs.statSync (node:fs)
  results.push(
    await bench("fs.statSync()", () => {
      fs.statSync(`${tempDir}/test.txt`);
    }),
  );

  // Benchmark 10: process.env access
  results.push(
    await bench("process.env.HOME", () => {
      const _ = process.env.HOME;
    }),
  );

  // Benchmark 11: Bun.env access
  results.push(
    await bench("Bun.env.HOME", () => {
      const _ = Bun.env.HOME;
    }),
  );

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
