import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { join } from "path";
import { decode } from "../../js/bun/pprof/pprof-decode";

const script = `
  const kept = [];
  function allocate() {
    for (let i = 0; i < 16; i++) kept.push(new ArrayBuffer(1024 * 1024));
  }
  allocate();
  console.log(Bun.pprof.heap.isRunning);
`;

async function run(dir: string, args: string[], env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: dir,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function expectHeapProfile(path: string, period: number) {
  const profile = decode(readFileSync(path));
  expect(profile.sampleTypes.map(t => t.type)).toEqual([
    "alloc_objects",
    "alloc_space",
    "inuse_objects",
    "inuse_space",
  ]);
  expect(profile.period).toBe(period);
  // An ASAN build gives malloc to the sanitizer, so an ArrayBuffer is not in the profile.
  // TODO: samples have no JavaScript frames on x64 Windows (see heap.test.ts).
  if (!isASAN && !(isWindows && process.arch === "x64")) {
    const allocate = profile.samples.filter(s => s.stack.some(f => f.function === "allocate"));
    // 16 MiB in blocks twice the interval: nearly every block is a sample.
    const inuse = allocate.reduce((sum, s) => sum + s.values.inuse_space, 0);
    expect(Math.abs(inuse - 16 * 1024 * 1024)).toBeLessThan(3 * 1024 * 1024);
    return allocate;
  }
  return [];
}

async function findPprofTool() {
  const go = Bun.which("go");
  if (!go) return null;
  await using proc = Bun.spawn({
    cmd: [go, "env", "GOTOOLDIR"],
    env: { ...bunEnv, GOTOOLCHAIN: "local" },
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const tool = join(stdout.trim(), isWindows ? "pprof.exe" : "pprof");
  return exitCode === 0 && existsSync(tool) ? tool : null;
}
const pprofTool = await findPprofTool();

describe.concurrent("--pprof-heap", () => {
  test("writes the profile of the whole run to the given path on exit", async () => {
    using dir = tempDir("pprof-heap-path", { "script.js": script });
    const result = await run(String(dir), ["--pprof-heap=profiles/heap.pb.gz", "script.js"]);
    expect(result).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
    expectHeapProfile(join(String(dir), "profiles", "heap.pb.gz"), 512 * 1024);
  });

  test("names the file itself when no path is given", async () => {
    using dir = tempDir("pprof-heap-default", { "script.js": script });
    const result = await run(String(dir), ["--pprof-heap", "script.js"]);
    expect(result).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
    const files = readdirSync(String(dir)).filter(f => f.endsWith(".pb.gz"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^Heap\.\d{8}\.\d{6}\.\d+\.0\.001\.pb\.gz$/);
    expectHeapProfile(join(String(dir), files[0]), 512 * 1024);
  });

  test("--pprof-heap-interval sets the sample interval", async () => {
    using dir = tempDir("pprof-heap-interval", { "script.js": script });
    const result = await run(String(dir), ["--pprof-heap=heap.pb.gz", "--pprof-heap-interval=262144", "script.js"]);
    expect(result).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
    expectHeapProfile(join(String(dir), "heap.pb.gz"), 262144);
  });

  test("works through BUN_OPTIONS", async () => {
    using dir = tempDir("pprof-heap-env", { "script.js": script });
    const result = await run(String(dir), ["script.js"], { BUN_OPTIONS: "--pprof-heap=from-env.pb.gz" });
    expect(result).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
    expectHeapProfile(join(String(dir), "from-env.pb.gz"), 512 * 1024);
  });

  test("writes nothing when the script stopped the profile itself", async () => {
    using dir = tempDir("pprof-heap-stopped", {
      "script.js": `require("fs").writeFileSync("mine.pb.gz", Bun.pprof.heap.stop()); console.log(Bun.pprof.heap.isRunning);`,
    });
    const result = await run(String(dir), ["--pprof-heap=exit.pb.gz", "script.js"]);
    expect(result).toEqual({ stdout: "false\n", stderr: "", exitCode: 0 });
    expect(readdirSync(String(dir)).filter(f => f.endsWith(".pb.gz"))).toEqual(["mine.pb.gz"]);
  });

  test("is written on process.exit() too", async () => {
    using dir = tempDir("pprof-heap-exit", { "script.js": script + "process.exit(3);" });
    const result = await run(String(dir), ["--pprof-heap=heap.pb.gz", "script.js"]);
    expect(result).toEqual({ stdout: "true\n", stderr: "", exitCode: 3 });
    expectHeapProfile(join(String(dir), "heap.pb.gz"), 512 * 1024);
  });

  // The decoder these tests use was written with the encoder. pprof's own reader
  // (`profile.Parse`, which also checks every id and string index) comes with Go: run it
  // where the distribution has it prebuilt (`go tool pprof` would compile it otherwise).
  test.skipIf(!pprofTool)("pprof reads the file", async () => {
    using dir = tempDir("pprof-heap-go", { "script.js": script });
    const result = await run(String(dir), ["--pprof-heap=heap.pb.gz", "script.js"]);
    expect(result).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
    await using proc = Bun.spawn({
      cmd: [pprofTool!, "-raw", "heap.pb.gz"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain("PeriodType: space bytes\nPeriod: 524288\n");
    expect(stdout).toContain("alloc_objects/count alloc_space/bytes inuse_objects/count inuse_space/bytes[dflt]\n");
    if (!isASAN && !(isWindows && process.arch === "x64"))
      expect(stdout).toMatch(/ allocate .*script\.js:4(:\d+)? s=3\n/);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  });

  // The profile is the process's, so it is written by whichever thread ends the process.
  test.each([
    ["the main thread", `process.kill(process.pid, "SIGTERM");`],
    ["a Worker", `new (require("worker_threads").Worker)('process.kill(process.pid, "SIGTERM")', { eval: true });`],
  ])("is written before %s ends the process with a signal", async (thread, kill) => {
    using dir = tempDir("pprof-heap-kill", { "script.js": script + kill + "\nsetInterval(() => {}, 1000);" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--pprof-heap=heap.pb.gz", "script.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // uv_kill() on Windows is TerminateProcess(1), which does not wait for the pipe.
    expect({ stdout: isWindows ? "true\n" : stdout, stderr, signalCode: proc.signalCode }).toEqual({
      stdout: "true\n",
      stderr: "",
      signalCode: isWindows ? null : "SIGTERM",
    });
    // Only the main thread can use its sourcemaps: a Worker writes its positions as they ran.
    for (const sample of expectHeapProfile(join(String(dir), "heap.pb.gz"), 512 * 1024))
      expect(sample.labels.generated).toBe(thread === "a Worker" ? "true" : undefined);
  });

  test.skipIf(isWindows)("a Worker's signal that the main thread listens for leaves the profile running", async () => {
    using dir = tempDir("pprof-heap-listener", {
      "script.js":
        script +
        `process.on("SIGUSR2", () => { console.log(Bun.pprof.heap.isRunning); process.exit(0); });
         new (require("worker_threads").Worker)('process.kill(process.pid, "SIGUSR2")', { eval: true });
         setInterval(() => {}, 1000);`,
    });
    const result = await run(String(dir), ["--pprof-heap=heap.pb.gz", "script.js"]);
    expect(result).toEqual({ stdout: "true\ntrue\n", stderr: "", exitCode: 0 });
    expectHeapProfile(join(String(dir), "heap.pb.gz"), 512 * 1024);
  });

  // --watch keeps its SIGINT handler installed, which says nothing about JavaScript listeners.
  test.skipIf(isWindows)("is written before a Worker's SIGINT ends a --watch run", async () => {
    using dir = tempDir("pprof-heap-watch", {
      "script.js":
        script +
        `new (require("worker_threads").Worker)('process.kill(process.pid, "SIGINT")', { eval: true });
         setInterval(() => {}, 1000);`,
    });
    const result = await run(String(dir), ["--watch", "--pprof-heap=heap.pb.gz", "script.js"]);
    expect(result).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
    expectHeapProfile(join(String(dir), "heap.pb.gz"), 512 * 1024);
  });

  test("process.exit() in a Worker leaves the profile running", async () => {
    using dir = tempDir("pprof-heap-worker-exit", {
      "script.js":
        script +
        `new (require("worker_threads").Worker)("process.exit(0)", { eval: true })
           .on("exit", () => console.log(Bun.pprof.heap.isRunning));`,
    });
    const result = await run(String(dir), ["--pprof-heap=heap.pb.gz", "script.js"]);
    expect(result).toEqual({ stdout: "true\ntrue\n", stderr: "", exitCode: 0 });
    expectHeapProfile(join(String(dir), "heap.pb.gz"), 512 * 1024);
  });

  test("--pprof-heap-interval without --pprof-heap is an error", async () => {
    using dir = tempDir("pprof-heap-alone", { "script.js": "console.log('ran')" });
    const result = await run(String(dir), ["--pprof-heap-interval=262144", "script.js"]);
    expect({ ...result, stderr: result.stderr.replace(/^.*?: /, "") }).toEqual({
      stdout: "",
      stderr: "--pprof-heap-interval must be used with --pprof-heap\n",
      exitCode: 9,
    });
  });

  test.each(["0", "131071", "-1", "abc", "1e6", ""])(
    "--pprof-heap-interval=%s is rejected before the script runs",
    async value => {
      using dir = tempDir("pprof-heap-bad", { "script.js": "console.log('ran')" });
      const result = await run(String(dir), ["--pprof-heap", `--pprof-heap-interval=${value}`, "script.js"]);
      expect(result).toEqual({
        stdout: "",
        stderr: `error: --pprof-heap-interval must be a number of bytes, at least 131072 (got "${value}")\n`,
        exitCode: 1,
      });
      expect(readdirSync(String(dir)).filter(f => f.endsWith(".pb.gz"))).toEqual([]);
    },
  );
});
