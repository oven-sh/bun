import { expect, test } from "bun:test";
import { expectRssDeltaBelow, isWindows, tempDir } from "harness";

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

const BATCH = 50;
const WARMUP_BATCHES = 3;
const MEASURE_BATCHES = 12;
const PAYLOAD_BYTES = 64 * 1024;
// More than an unread pipe holds on any platform. The largest is macOS, where
// bun sets the two socket buffers to 512 KB each.
const DRAIN_BYTES = 2 * 1024 * 1024;
// A cold run of a debug build can take longer than the default of 5 s.
const TIMEOUT_MS = 30_000;

// On Windows `cat` is the msys2 build, which is slow to start. `type` is a
// builtin of the native cmd. The file name is relative to the cwd, so that cmd
// never parses the path of the temporary directory.
const cat = (file: string) => (isWindows ? ["cmd", "/c", "type", file] : ["cat", file]);

// expectRssDeltaBelow runs this in a process of its own, with the ASAN
// quarantine off. With the quarantine on, the RSS grows by the same amount with
// and without a leak.
const fixture = /* js */ `
  const { cmd, cwd, batch, warmupBatches, measureBatches } = JSON.parse(process.argv.at(-1));
  async function rssAfter(batches) {
    for (let i = 0; i < batches; i++) {
      const codes = await Promise.all(
        Array.from({ length: batch }, () => Bun.spawn(cmd, { cwd, stdio: ["ignore", "pipe", "pipe"] }).exited),
      );
      const failed = codes.filter(code => code !== 0);
      if (failed.length > 0) throw new Error(failed.length + " of " + batch + " children failed: " + failed);
      Bun.gc(true);
    }
    return process.memoryUsage.rss();
  }
  // The warmup puts the state that the runtime creates lazily into the baseline.
  const baseline = await rssAfter(warmupBatches);
  const final = await rssAfter(measureBatches);
  console.log(JSON.stringify({ deltaMiB: (final - baseline) / 1024 / 1024 }));
`;

test(
  "unread 'pipe' stdout and stderr do not leak after the child exits",
  async () => {
    using dir = tempDir("spawn-noread-leak", {
      "payload.bin": Buffer.alloc(PAYLOAD_BYTES, "x").toString(),
      "drain.bin": Buffer.alloc(DRAIN_BYTES, "x").toString(),
    });
    const cwd = String(dir);

    // The precondition: bun takes the output of a pipe that JS does not read.
    // This child writes more than the pipe holds, so it can exit only when the
    // parent has taken the bytes. The read comes after the exit.
    {
      await using proc = Bun.spawn(cat("drain.bin"), { cwd, stdio: ["ignore", "pipe", "pipe"] });
      const exitCode = await proc.exited;
      const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
      expect({ stdoutBytes: stdout.length, stderr, exitCode }).toEqual({
        stdoutBytes: DRAIN_BYTES,
        stderr: "",
        exitCode: 0,
      });
    }

    const options = {
      cmd: cat("payload.bin"),
      cwd,
      batch: BATCH,
      warmupBatches: WARMUP_BATCHES,
      measureBatches: MEASURE_BATCHES,
    };
    // A leaked stdout buffer is 64 KB per child. Over the 600 measured children
    // that is 37.5 MB (47 MB with ASAN). Without a leak the delta is under 1 MB
    // on a release build and about 2 MB with ASAN.
    await expectRssDeltaBelow(["-e", fixture, JSON.stringify(options)], { release: 12, debug: 16 });
  },
  TIMEOUT_MS,
);
