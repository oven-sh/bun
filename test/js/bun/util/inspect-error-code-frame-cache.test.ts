import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import path from "node:path";

// Repeatedly calling Bun.inspect() on an error from the same (file, line)
// should not re-read and re-parse the source file (or its external .map)
// on every call. The first inspect populates a per-(path, source_index, line)
// cache on SavedSourceMap; subsequent inspects hit that cache.
//
// Before the cache, each inspect on a runtime-transpiled module re-ran the
// resolver + parser over the whole file to extract the preview lines; for an
// external .map it re-read and JSON-parsed the whole map. The per-inspect cost
// therefore scaled with the size of the source. With the cache it does not.

async function measure(dir: string, entry: string, N: number) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", path.join(dir, "run.ts")],
    env: { ...bunEnv, INSPECT_ENTRY: entry, INSPECT_N: String(N) },
    cwd: dir,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim()) as { loop_ms: number };
}

const RUN_TS = `
  const { err } = require(process.env.INSPECT_ENTRY!);
  const first = Bun.inspect(err);
  if (!first.includes("new Error")) {
    console.error("no code frame in first inspect:\\n" + first);
    process.exit(1);
  }
  const N = Number(process.env.INSPECT_N);
  const t0 = Bun.nanoseconds();
  let last = "";
  for (let i = 0; i < N; i++) last = Bun.inspect(err);
  const loop_ms = (Bun.nanoseconds() - t0) / 1e6;
  if (last !== first) {
    console.error("inspect output changed between calls");
    process.exit(1);
  }
  console.log(JSON.stringify({ loop_ms }));
`;

// serial: small/large are timed in separate subprocesses; concurrent CPU load
// from the other tests could skew the ratio asymmetrically.
test("Bun.inspect(error) reuses the resolved code frame on repeat (transpiled)", async () => {
  const pad = (kb: number) => Buffer.alloc(kb * 1024, "// pppppppppppppppppppp\n").toString();
  using dir = tempDir("inspect-code-frame-cache", {
    "small.ts": `${pad(4)}\nexport const err: Error = new Error("boom");\n`,
    "large.ts": `${pad(600)}\nexport const err: Error = new Error("boom");\n`,
    "run.ts": RUN_TS,
  });

  const N = 150;
  const { loop_ms: small } = await measure(String(dir), "./small.ts", N);
  const { loop_ms: large } = await measure(String(dir), "./large.ts", N);
  console.log(
    `transpiled: small ${small.toFixed(1)} ms, large ${large.toFixed(1)} ms ` +
      `(${((large * 1000) / N).toFixed(1)} us/call), ratio ${(large / small).toFixed(1)}x`,
  );

  // Without the cache the re-parse per call makes the large run ~100x the
  // small run (scales with file size); with the cache both are dominated by
  // the fixed per-inspect work and the ratio is near 1.
  expect(large).toBeLessThan(small * 8);
});

test.concurrent("Bun.inspect(error) serves a stable code frame from the cache (external .map)", async () => {
  // Exercises the external-sourcemap branch of the cache: the first inspect
  // reads sourcesContent out of the .map, later inspects hit the cache. No
  // timing assertion here because release builds show a separate
  // source-size-dependent cost on this path that persists with
  // BUN_DISABLE_SOURCE_CODE_PREVIEW=1 (i.e. unrelated to the code-frame
  // cache); the transpiled test above carries the perf proof.
  const src: string[] = [];
  for (let i = 0; i < 800; i++) src.push(`export const v${i} = ${i};`);
  src.push(`export const err = new Error("boom");`);
  using dir = tempDir("inspect-code-frame-cache-ext", {
    "src.ts": src.join("\n") + "\n",
    "run.ts": RUN_TS,
  });

  await using build = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      path.join(String(dir), "src.ts"),
      "--sourcemap=external",
      "--target=bun",
      "--outdir",
      path.join(String(dir), "out"),
    ],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(buildErr).toBe("");
  expect(buildExit).toBe(0);

  // `measure` asserts the code frame is present in the first inspect and that
  // every subsequent inspect returns an identical string (cache correctness).
  const { loop_ms } = await measure(String(dir), "./out/src.js", 20);
  console.log(`external .map: 20x inspect = ${loop_ms.toFixed(1)} ms`);
});

test.concurrent("Bun.inspect(error) cached code frame matches the first inspect for >1024-char lines", async () => {
  // A minified-style 3000-char line: the printer clamps to 1024 and appends a
  // "... truncated" suffix (color mode). The cache must preserve that suffix.
  const longLine = `/* ${Buffer.alloc(3000, "m").toString()} */ export const err = new Error("boom");`;
  using dir = tempDir("inspect-code-frame-cache-long", {
    "entry.ts": `// short\n${longLine}\n`,
    "run.ts": `
      const { err } = require("./entry");
      const first = Bun.inspect(err, { colors: true });
      const second = Bun.inspect(err, { colors: true });
      if (first !== second) {
        console.error("mismatch:\\n--- first ---\\n" + first + "\\n--- second ---\\n" + second);
        process.exit(1);
      }
      if (!Bun.stripANSI(first).includes("truncated")) {
        console.error("expected truncation marker:\\n" + Bun.stripANSI(first));
        process.exit(1);
      }
      process.stdout.write(Bun.stripANSI(first));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", path.join(String(dir), "run.ts")],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(normalizeBunSnapshot(stdout, dir)).toContain("truncated");
  expect(exitCode).toBe(0);
});
