import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir, withoutAsanQuarantine } from "harness";
import { join } from "node:path";

// Regression test for #18265 (fixed by #20102): a "pipe" stdio stream that JS
// never reads must not leak its read buffer.
//
// Each child has the two kinds of unread pipe from that report:
// - stdout carries a payload. The reader buffers it, and the Subprocess keeps
//   the bytes until the GC collects it. The RSS bound is for this buffer.
// - stderr carries nothing. This is the stream that leaked in #18265: its
//   reserved buffer stayed empty and was never freed. A leak of that kind is a
//   few pages per child at most, too little for the RSS bound. LeakSanitizer
//   reports it on the ASAN lane.

const MB = 1024 * 1024;
const BATCH = 50;
const WARMUP_BATCHES = 3;
const MEASURE_BATCHES = 12;
const PAYLOAD_BYTES = 64 * 1024;

// The children run from a process of their own. Its RSS has none of the test
// runner's memory, and ASAN can run there with the quarantine off.
const fixture = /* js */ `
  const { cmd, batch, warmupBatches, measureBatches } = JSON.parse(process.argv.at(-1));
  const exits = {};
  async function rssAfter(batches) {
    for (let i = 0; i < batches; i++) {
      const codes = await Promise.all(
        Array.from({ length: batch }, () => Bun.spawn(cmd, { stdio: ["ignore", "pipe", "pipe"] }).exited),
      );
      for (const code of codes) exits[code] = (exits[code] ?? 0) + 1;
      Bun.gc(true);
    }
    return process.memoryUsage.rss();
  }
  // The warmup puts the state that the runtime creates lazily into the baseline.
  const baseline = await rssAfter(warmupBatches);
  const final = await rssAfter(measureBatches);
  console.log(JSON.stringify({ exits, baseline, final }));
`;

test("unread 'pipe' stdout and stderr do not leak after the child exits", async () => {
  using dir = tempDir("spawn-noread-leak", {
    "payload.bin": Buffer.alloc(PAYLOAD_BYTES, "x").toString(),
  });
  const payload = join(String(dir), "payload.bin");
  // On Windows `cat` is the msys2 build, which is slow to start. `type` is a
  // builtin of the native cmd.
  const cmd = isWindows ? ["cmd", "/c", "type", payload] : ["cat", payload];

  // The precondition: a child that exits with its pipes unread leaves its whole
  // output buffered in the parent. So the read comes after the exit here.
  {
    await using proc = Bun.spawn(cmd, { stdio: ["ignore", "pipe", "pipe"] });
    const exitCode = await proc.exited;
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
    expect({ stdoutBytes: stdout.length, stderr, exitCode }).toEqual({
      stdoutBytes: PAYLOAD_BYTES,
      stderr: "",
      exitCode: 0,
    });
  }

  const options = { cmd, batch: BATCH, warmupBatches: WARMUP_BATCHES, measureBatches: MEASURE_BATCHES };
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture, JSON.stringify(options)],
    // ASAN keeps freed memory in a quarantine. With it on, the RSS grows by the
    // same amount with and without a leak.
    env: withoutAsanQuarantine(bunEnv),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { exits, baseline, final } = JSON.parse(stdout);
  const deltaMB = (final - baseline) / MB;
  console.log(
    `RSS: ${(baseline / MB).toFixed(1)} MB -> ${(final / MB).toFixed(1)} MB ` +
      `(delta ${deltaMB.toFixed(1)} MB over ${MEASURE_BATCHES * BATCH} spawns)`,
  );

  expect(exits).toEqual({ 0: (WARMUP_BATCHES + MEASURE_BATCHES) * BATCH });
  // A leaked stdout buffer is 64 KB per child: 37.5 MB over the 600 measured
  // children. Without a leak the delta is under 1 MB on a release build and
  // about 2 MB with ASAN.
  expect(deltaMB).toBeLessThan(12);
  expect(exitCode).toBe(0);
});
