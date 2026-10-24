// Diagnostics for the flaky test/js/node/test/parallel/test-zlib-invalid-input-memory.js.
// Runs that test many times the way the CI runner does, next to instrumented copies that
// report what keeps the stream alive when it survives gc().
import { expect, test } from "bun:test";
import { bunExe, isASAN, isDebug, isMusl, isWindows } from "harness";
import { join } from "node:path";

const repo = join(import.meta.dir, "..", "..", "..", "..");
const config = join(repo, "bunfig.node-test.toml");
const original = join(repo, "test", "js", "node", "test", "parallel", "test-zlib-invalid-input-memory.js");
const diag = join(import.meta.dir, "gc-diag");

// The lanes that show the flake get enough runs to see it. The others get a few, as a control.
const flakyLane = process.arch === "x64" && (isWindows || isMusl);
const runs = isASAN || isDebug ? 6 : flakyLane ? 110 : 16;
// The CI runner gives a test file 3 minutes.
const deadline = Date.now() + 135_000;

const env: Record<string, string | undefined> = {
  ...process.env,
  NODE_ENV: undefined,
  FORCE_COLOR: "0",
  NO_COLOR: "1",
  BUN_DEBUG_QUIET_LOGS: "1",
  BUN_TEST_DRAIN_EVENT_LOOP: "1",
  BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
  BUN_GARBAGE_COLLECTOR_LEVEL: "1",
  BUN_JSC_randomIntegrityAuditRate: "1.0",
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
};

type Batch = { name: string; args: string[]; width: number; env?: Record<string, string> };
const run = ["run", `--config=${config}`];
// Most important first: the deadline can cut the list short.
const batches: Batch[] = [
  { name: "original, 3 at a time", args: [...run, original], width: 3 },
  { name: "v1", args: [...run, join(diag, "v1.js")], width: 3 },
  { name: "original + preload", args: [...run, "--preload", join(diag, "probe-preload.js"), original], width: 3 },
  { name: "v2", args: [...run, join(diag, "v2.js")], width: 3 },
  { name: "write done before the main script ends", args: [...run, join(diag, "write-done-first.js")], width: 3 },
  { name: "original, one GC marker", args: [...run, original], width: 3, env: { BUN_JSC_numberOfGCMarkers: "1" } },
  { name: "original, no JIT", args: [...run, original], width: 3, env: { BUN_JSC_useJIT: "0" } },
  { name: "original, 1 at a time", args: [...run, original], width: 1 },
  { name: "original, 8 at a time", args: [...run, original], width: 8 },
  {
    name: "original, without the runner's GC settings",
    args: [...run, original],
    width: 3,
    env: { BUN_GARBAGE_COLLECTOR_LEVEL: "0", BUN_JSC_randomIntegrityAuditRate: "0.05" },
  },
];

async function runOne(batch: Batch, index: number) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...batch.args],
    env: { ...env, ...batch.env, TEST_SERIAL_ID: String(index) },
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test("what keeps the failed zlib stream alive", async () => {
  const summary: string[] = [];
  let bad = 0;
  console.log(`ZLIB-GC-DIAG ${process.platform}-${process.arch} musl=${isMusl} ${Bun.version} ${Bun.revision}`);
  for (const batch of batches) {
    const results: Awaited<ReturnType<typeof runOne>>[] = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: batch.width }, async () => {
        while (next < runs && Date.now() < deadline) results.push(await runOne(batch, next++));
      }),
    );
    const failed = results.filter(r => r.exitCode !== 0);
    const retained = results.filter(r => r.stdout.includes("RETAINED after gc()"));
    bad += failed.length + retained.length;
    let line = `${batch.name}: ${results.length} runs, ${failed.length} failed, ${retained.length} reported retention`;
    if (batch.name === "v2") {
      // A delay shorter than a full collection means that the write completed before the
      // collection that follows the entry point.
      const delays = (of: typeof results) =>
        of
          .map(r => /ORDER error-after-main-ms=([\d.]+)/.exec(r.stdout)?.[1])
          .map(Number)
          .sort((a, b) => a - b)
          .map(ms => ms.toFixed(1))
          .join(" ");
      line += `\n  ms from the end of the main script to 'error', all runs: ${delays(results)}`;
      line += `\n  the same for the runs that reported retention: ${delays(retained)}`;
    }
    summary.push(line);
    console.log(`ZLIB-GC-DIAG ${line}`);
    for (const r of [...new Set([...retained, ...failed])].slice(0, 4)) {
      console.log(`===== ${batch.name}: exit ${r.exitCode} =====\n${r.stdout}\n${r.stderr}`.trim());
    }
  }
  // On the lanes under study a failure puts the counts into the CI annotations.
  expect(flakyLane ? -1 : bad, summary.join("\n")).toBe(0);
}, 170_000);
