// `bun build --compile --compile-jit-policy <n>` / `compile: { jitPolicy: n }` bakes a JSC tier-up threshold scale into
// the executable; `Bun.unsafe.setJITPolicy(scale)` changes it at run time (docs/bundler/executables.mdx "JIT policy").
// Under BUN_JSC_verboseOSR=1 JSC logs "Startup JIT deferral scale set to <n>" when a scale > 1 takes effect and
// "Ending startup JIT deferral window: embedder (scale was <n>)" when it returns to 1.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "node:path";

// verboseOSR is chatty and other JSC log lines can interleave with the ones we want, so match by pattern.
function policyLines(stderr: string) {
  return [
    ...stderr.matchAll(
      /Startup JIT deferral scale set to [\d.]+|Ending startup JIT deferral window: [^\n(]*\(scale was [\d.]+\)/g,
    ),
  ].map(m => m[0]);
}

describe("compile jitPolicy", () => {
  const sources = {
    "app.ts": `
      process.stdout.write("started\\n");
      Bun.unsafe.setJITPolicy(1);
      Bun.unsafe.setJITPolicy(1); // already 1: no-op
      process.stdout.write("interactive\\n");
      Bun.unsafe.setJITPolicy(2); // positive signal that verboseOSR logging works in this process
    `,
  };

  async function buildCli(dir: string, flags: string[], tag: string) {
    const outfile = path.join(dir, "app-" + tag + (isWindows ? ".exe" : ""));
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", ...flags, path.join(dir, "app.ts"), "--outfile", outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(stderr).not.toContain("error:");
    expect(exitCode).toBe(0);
    return outfile;
  }

  async function buildApi(dir: string, compile: Bun.CompileBuildOptions, tag: string) {
    const outfile = path.join(dir, "app-" + tag + (isWindows ? ".exe" : ""));
    const result = await Bun.build({ entrypoints: [path.join(dir, "app.ts")], compile: { ...compile, outfile } });
    expect(result.logs.map(String).join("\n")).toBe("");
    expect(result.success).toBe(true);
    return outfile;
  }

  async function run(exe: string) {
    await using proc = Bun.spawn({
      cmd: [exe],
      env: { ...bunEnv, BUN_JSC_verboseOSR: "1" },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, lines: policyLines(stderr), exitCode };
  }

  test.concurrent("default build starts in the normal JIT policy", async () => {
    using dir = tempDir("jit-policy-default", sources);
    const { stdout, lines, exitCode } = await run(await buildCli(String(dir), [], "default"));
    expect(stdout).toBe("started\ninteractive\n");
    expect(lines).toEqual(["Startup JIT deferral scale set to 2"]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("compile.jitPolicy bakes the starting scale into the executable", async () => {
    using dir = tempDir("jit-policy-api", sources);
    const { stdout, lines, exitCode } = await run(await buildApi(String(dir), { jitPolicy: 8 }, "api"));
    expect(stdout).toBe("started\ninteractive\n");
    expect(lines).toEqual([
      "Startup JIT deferral scale set to 8",
      "Ending startup JIT deferral window: embedder (scale was 8)",
      "Startup JIT deferral scale set to 2",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("--compile-jit-policy behaves like compile.jitPolicy", async () => {
    using dir = tempDir("jit-policy-cli", sources);
    const { stdout, lines, exitCode } = await run(await buildCli(String(dir), ["--compile-jit-policy=8"], "cli"));
    expect(stdout).toBe("started\ninteractive\n");
    expect(lines).toEqual([
      "Startup JIT deferral scale set to 8",
      "Ending startup JIT deferral window: embedder (scale was 8)",
      "Startup JIT deferral scale set to 2",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("--compile-jit-policy rejects values below 1", async () => {
    using dir = tempDir("jit-policy-cli-invalid", sources);
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--compile-jit-policy=0.5", path.join(String(dir), "app.ts")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(stderr).toContain("--compile-jit-policy");
    expect(exitCode).toBe(1);
  });

  test.concurrent("Bun.unsafe.setJITPolicy works outside a compiled executable; workers start at 1", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `Bun.unsafe.setJITPolicy(8);
         const w = new Worker("data:text/javascript,Bun.unsafe.setJITPolicy(1); postMessage('ok')");
         await new Promise(r => (w.onmessage = r));
         await w.terminate();
         Bun.unsafe.setJITPolicy(1);`,
      ],
      env: { ...bunEnv, BUN_JSC_verboseOSR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(policyLines(stderr)).toEqual([
      "Startup JIT deferral scale set to 8",
      "Ending startup JIT deferral window: embedder (scale was 8)",
    ]);
    expect(exitCode).toBe(0);
  });

  test("Bun.unsafe.setJITPolicy validates its argument", () => {
    // Outside a compiled executable the policy is already 1: a harmless no-op.
    expect(Bun.unsafe.setJITPolicy(1)).toBeUndefined();
    expect(() => Bun.unsafe.setJITPolicy("x" as unknown as number)).toThrow(TypeError);
    expect(() => Bun.unsafe.setJITPolicy(0.5)).toThrow(RangeError);
    expect(() => Bun.unsafe.setJITPolicy(NaN)).toThrow(RangeError);
    expect(() => Bun.unsafe.setJITPolicy(Infinity)).toThrow(RangeError);
  });
});
