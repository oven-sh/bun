import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { decode } from "./pprof-decode";

// An ASAN build gives malloc to the sanitizer: only Bun's arenas reach the allocator that is
// being profiled, so there is nothing to measure for an ArrayBuffer.
// TODO: on x64 Windows rbp does not point at a frame record, so a sample has nothing to check
// JavaScriptCore's record of the top frame against and leaves the JavaScript frames out; the
// cases below find their samples by function name.
const quantitative = !isASAN && !(isWindows && process.arch === "x64");
const MiB = 1024 * 1024;

// The fixtures import each other and the decoder: each run gets its own copy of this directory.
async function runFixture(name: string, ...args: string[]) {
  using dir = tempDir("pprof-heap-fixture", import.meta.dir);
  await using proc = Bun.spawn({
    cmd: [bunExe(), name, ...args],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function runScript(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("Bun.pprof.heap", () => {
  test("start, profile, stop and isRunning follow the state of the one session", async () => {
    const { stdout, stderr, exitCode } = await runScript(`
      const out = [];
      const attempt = fn => {
        try {
          const value = fn();
          out.push(value instanceof Uint8Array ? "Uint8Array gzip=" + (value[0] === 0x1f && value[1] === 0x8b) : value);
        } catch (e) {
          out.push(e.constructor.name + " " + e.code + ": " + e.message);
        }
      };
      const heap = Bun.pprof.heap;
      attempt(() => Object.keys(heap));
      attempt(() => heap.isRunning);
      attempt(() => heap.stop());
      attempt(() => heap.profile());
      attempt(() => heap.start());
      attempt(() => heap.isRunning);
      attempt(() => heap.start());
      attempt(() => heap.profile());
      attempt(() => heap.isRunning);
      attempt(() => heap.stop());
      attempt(() => heap.isRunning);
      attempt(() => heap.stop());
      attempt(() => heap.start({ sampleInterval: 1024 * 1024 }));
      attempt(() => heap.stop());
      attempt(() => heap.start({}));
      attempt(() => heap.stop());
      attempt(() => heap.start({ sampleInterval: undefined }));
      attempt(() => heap.stop());
      console.log(JSON.stringify(out, null, 2));
    `);
    expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({
      stdout: [
        ["start", "profile", "stop", "isRunning"],
        false,
        "Error ERR_INVALID_STATE: No heap profile is running. Call Bun.pprof.heap.start() first.",
        "Error ERR_INVALID_STATE: No heap profile is running. Call Bun.pprof.heap.start() first.",
        undefined,
        true,
        "Error ERR_INVALID_STATE: A heap profile is already running. There is one per process: call Bun.pprof.heap.stop() first.",
        "Uint8Array gzip=true",
        true,
        "Uint8Array gzip=true",
        false,
        "Error ERR_INVALID_STATE: No heap profile is running. Call Bun.pprof.heap.start() first.",
        undefined,
        "Uint8Array gzip=true",
        undefined,
        "Uint8Array gzip=true",
        undefined,
        "Uint8Array gzip=true",
      ].map(v => (v === undefined ? null : v)),
      stderr: "",
      exitCode: 0,
    });
  });

  test("start rejects options it cannot honor and leaves no session behind", async () => {
    const { stdout, stderr, exitCode } = await runScript(`
      const out = [];
      for (const options of [{ sampleInterval: 0 }, { sampleInterval: 65535 }, { sampleInterval: -1 }, { sampleInterval: 1.5 },
                             { sampleInterval: NaN }, { sampleInterval: Infinity }, { sampleInterval: "524288" }, "524288", null, 1]) {
        try {
          Bun.pprof.heap.start(options);
          out.push("started");
        } catch (e) {
          out.push(e.constructor.name + " " + e.code);
        }
        out.push(Bun.pprof.heap.isRunning);
      }
      Bun.pprof.heap.start({ sampleInterval: 65536 });
      out.push(Bun.pprof.heap.isRunning);
      console.log(JSON.stringify(out));
    `);
    expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({
      stdout: [
        ...[
          "RangeError ERR_OUT_OF_RANGE", // 0
          "RangeError ERR_OUT_OF_RANGE", // one below the minimum
          "RangeError ERR_OUT_OF_RANGE", // -1
          "TypeError ERR_INVALID_ARG_TYPE", // 1.5
          "RangeError ERR_OUT_OF_RANGE", // NaN
          "RangeError ERR_OUT_OF_RANGE", // Infinity
          "TypeError ERR_INVALID_ARG_TYPE", // { sampleInterval: "524288" }
          "TypeError ERR_INVALID_ARG_TYPE", // "524288"
          "TypeError ERR_INVALID_ARG_TYPE", // null
          "TypeError ERR_INVALID_ARG_TYPE", // 1
        ].flatMap(e => [e, false]),
        true,
      ],
      stderr: "",
      exitCode: 0,
    });
  });

  test.skipIf(!quantitative)(
    "kept memory stays in use, dropped memory does not, and JavaScript frames name their source",
    async () => {
      const { stdout, stderr, exitCode } = await runFixture("heap-fixture-allocate.ts");
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const result = JSON.parse(stdout);

      expect(result.sampleTypes).toEqual([
        { type: "alloc_objects", unit: "count" },
        { type: "alloc_space", unit: "bytes" },
        { type: "inuse_objects", unit: "count" },
        { type: "inuse_space", unit: "bytes" },
      ]);
      expect(result.periodType).toEqual({ type: "space", unit: "bytes" });
      expect(result.period).toBe(512 * 1024);
      expect(result.defaultSampleType).toBe("inuse_space");
      expect(result.emptyString).toBe("");
      expect(result.hasTime).toBe(true);
      expect(result.stillRunning).toBe(true);
      expect(result.keptBuffers).toBe(64);

      // 64 MiB each, in blocks twice the interval: nearly every block is a sample, and the
      // weight of a sample carries what was allocated since the one before. (The object count
      // is weight / size, which is large when a sample lands on a small allocation in between.)
      const within = (value: number, expected: number) => Math.abs(value - expected) <= expected * 0.15;
      expect(result.keep.alloc_objects).toBeGreaterThan(48);
      expect(within(result.keep.alloc_space, 64 * MiB)).toBe(true);
      expect(within(result.keep.inuse_space, 64 * MiB)).toBe(true);
      expect(result.keep.inuse_space).toBeLessThanOrEqual(result.keep.alloc_space);
      expect(within(result.keepWhileRunning.inuse_space, 64 * MiB)).toBe(true);
      expect(result.drop.alloc_objects).toBeGreaterThan(48);
      expect(within(result.drop.alloc_space, 64 * MiB)).toBe(true);
      expect(result.drop.inuse_space).toBeLessThan(2 * MiB);

      // The file is TypeScript: line 12 is where it is in the source, not in what ran.
      expect({ ...result.keepFrame, file: result.keepFrame.file.replaceAll("\\", "/").split("/").pop() }).toEqual({
        function: "keepBuffers",
        file: "heap-fixture-allocate.ts",
        line: 12,
        column: expect.any(Number),
        startLine: 11,
      });
      expect(result.callerOfKeep.function).toBe("(module)");
      expect(result.callerOfKeep.line).toBe(22);
      expect(result.labels.worker).toBeUndefined();
      if (!isWindows) {
        // Native frames on both sides of the JavaScript ones, each inside a loaded image.
        expect(result.hasNativeFramesBelow).toBe(true);
        expect(result.hasNativeFramesAbove).toBe(true);
        expect(result.nativeFramesHaveMappings).toBe(true);
        // Every Linux build of Bun is linked with --build-id=sha1.
        if (isLinux) expect(result.executableBuildId).toMatch(/^[0-9a-f]{40}$/);
        // macOS gives the main thread no name.
        if (isLinux) expect(result.labels.thread).toBeString();
      }
    },
  );

  test.skipIf(!quantitative)("a Worker's allocations carry its labels, resolved once it has exited", async () => {
    const { stdout, stderr, exitCode } = await runFixture("heap-fixture-worker.ts");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { whileWorkerRuns, afterWorkerExit } = JSON.parse(stdout);
    const file = (frame: { file: string }) => frame.file.replaceAll("\\", "/").split("/").pop();

    expect(afterWorkerExit.threadId).toBeGreaterThan(0);
    for (const result of [whileWorkerRuns, afterWorkerExit]) {
      expect(Math.abs(result.allocSpace - 32 * MiB)).toBeLessThan(4 * MiB);
      expect(result.labels.length).toBeGreaterThan(0);
      for (const labels of result.labels) expect(labels.worker).toBe(result.threadId);
      expect(result.frame.function).toBe("allocateInWorker");
      expect(file(result.frame)).toBe("heap-fixture-worker-child.ts");
      expect(result.mainThreadLabels?.worker).toBeUndefined();
    }
    // Only the Worker's own thread can use its sourcemaps: while it runs, another thread
    // gets the positions of the transpiled code and says so.
    for (const labels of whileWorkerRuns.labels) expect(labels.generated).toBe("true");
    for (const labels of afterWorkerExit.labels) expect(labels.generated).toBeUndefined();
    expect(afterWorkerExit.frame.line).toBe(7);
    if (!isWindows) for (const labels of afterWorkerExit.labels) expect(labels.thread).toBeString();
  });

  test.skipIf(!quantitative)("a free of what an earlier session sampled does not count in the next one", async () => {
    const { stdout, stderr, exitCode } = await runFixture("heap-fixture-sessions.ts");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const result = JSON.parse(stdout);
    // The first session's 32 blocks were freed while the second ran...
    expect(result.freedMiB).toBe(32);
    expect(result.first.inuse_objects).toBeGreaterThan(24);
    expect(result.firstInSecondProfile.alloc_objects).toBe(0);
    // ...and the second session's own 32 are all still there. Were the frees counted, they
    // would hit its first samples: both sessions number theirs from zero.
    expect(result.kept).toBe(32);
    expect(result.second.alloc_objects).toBeGreaterThan(24);
    expect(Math.abs(result.second.alloc_space - 32 * MiB)).toBeLessThan(5 * MiB);
    expect(result.second.inuse_objects).toBe(result.second.alloc_objects);
    expect(result.second.inuse_space).toBe(result.second.alloc_space);
  });

  test("a sample that lands in code that is tiering up does not crash", async () => {
    const { stdout, stderr, exitCode } = await runFixture("heap-fixture-tiering.ts");
    expect({ stdout: quantitative ? stdout : "", stderr, exitCode }).toEqual({
      stdout: quantitative ? '{"sampled":true}\n' : "",
      stderr: "",
      exitCode: 0,
    });
  });

  test.skipIf(!quantitative)("reading the profile again and again neither repeats nor loses samples", async () => {
    const { stdout, stderr, exitCode } = await runFixture("heap-fixture-scrape.ts");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const result = JSON.parse(stdout);
    expect(result.kept).toBe(48);
    expect(result.found).toBe(true);
    expect(result.repeatedSamplesPerScrape).toEqual([0, 0, 0, 0, 0, 0]);
    // A position first sampled after an earlier read of the profile resolved the others.
    expect({ ...result.laterFrame, file: result.laterFrame.file.replaceAll("\\", "/").split("/").pop() }).toEqual({
      function: "allocateLater",
      file: "heap-fixture-scrape-b.ts",
      line: 8,
      column: expect.any(Number),
      startLine: 6,
    });
    for (const labels of result.laterLabels) expect(labels.generated).toBeUndefined();
  });

  test.skipIf(!quantitative)("a sample inside the lazy decode of a bytecode cache does not deadlock", async () => {
    // Code from a bytecode cache decodes names and source positions on first use, under a
    // lock, and allocates while it holds it. An Error's stack is such a first use.
    const count = 16000;
    let source = "";
    for (let i = 0; i < count; i++)
      source += `function f${i}(a, b) {\n  let x = a + ${i};\n  let y = b * 2;\n  if (x > y) { x -= 1; } else { y += 1; }\n  const o = { x, y, z: [x, y, ${i}] };\n  try { throw new Error("e${i}" + o.z.length); } catch (e) { return e.line + e.stack.length; }\n}\n`;
    source += `Bun.pprof.heap.start();\nlet total = 0;\nfor (const f of [${Array.from({ length: count }, (_, i) => "f" + i).join(",")}]) total += f(1, 2);\nconsole.log(JSON.stringify({ total: total > 0, profile: Bun.pprof.heap.stop().byteLength > 0 }));\n`;
    using dir = tempDir("pprof-heap-bytecode", { "app.js": source });
    const executable = join(String(dir), isWindows ? "app.exe" : "app");
    {
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "--bytecode", "app.js", "--outfile", executable],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    }
    await using proc = Bun.spawn({ cmd: [executable], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: '{"total":true,"profile":true}\n',
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test("memory of an arena that is freed whole is not reported as in use", async () => {
    const { stdout, stderr, exitCode } = await runFixture("heap-fixture-arena.ts");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { rounds, transpiled } = JSON.parse(stdout) as {
      rounds: { allocSpace: number; inuseSpace: number }[];
      transpiled: boolean;
    };
    expect(transpiled).toBe(true);
    // Each call parses into its own arena: tens of MiB sampled per round, all of it gone
    // when the call returns. Counted as in use, it would be most of what was allocated.
    const last = rounds.at(-1)!;
    expect(last.allocSpace).toBeGreaterThan(rounds[0].allocSpace * 3);
    expect(last.allocSpace).toBeGreaterThan(64 * MiB);
    expect(last.inuseSpace).toBeLessThan(last.allocSpace * 0.1);
  });

  test("the decoder these tests read profiles with rejects a truncated or oversized packed varint", () => {
    // Sample { location_id: [packed] } with one varint.
    const sampleWithLocation = (...varint: number[]) =>
      gzipSync(new Uint8Array([0x12, varint.length + 2, 0x0a, varint.length, ...varint]));
    expect(() => decode(sampleWithLocation(0x80))).toThrow("truncated varint");
    expect(() => decode(sampleWithLocation(0x80, 0x01))).toThrow("a sample refers to a missing location 128");
    const nine = Array(9).fill(0xff);
    expect(() => decode(sampleWithLocation(...nine, 0x01))).toThrow(
      "a sample refers to a missing location 18446744073709551615",
    );
    expect(() => decode(sampleWithLocation(...nine, 0x02))).toThrow("varint overflow");
    expect(() => decode(sampleWithLocation(...nine, 0x81, 0x00))).toThrow("varint overflow");
  });

  test("stop() releases what the session held", async () => {
    const { stdout, stderr, exitCode } = await runFixture("heap-fixture-leak.ts");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { growthMiB, profileBytes } = JSON.parse(stdout);
    if (quantitative) expect(profileBytes).toBeGreaterThan(200 * 1500);
    // 200 sessions of about a quarter MiB of tables each: 50 MiB if they were kept. Not
    // under ASAN: the fixture's freed buffers sit in its quarantine, which moves RSS by more.
    if (!isASAN) expect(growthMiB).toBeLessThan(isDebug ? 32 : 16);
  });
});
