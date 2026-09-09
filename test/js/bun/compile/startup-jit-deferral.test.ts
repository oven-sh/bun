// `bun build --compile` executables start with JSC tier-up thresholds scaled (compile.jitPolicy, default 8) and return
// to the normal policy when the program becomes interactive (docs/bundler/executables.mdx "Startup optimizations").
// BUN_JSC_verboseOSR=1 makes JSC log "Ending startup JIT deferral window: <reason>" when that happens.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

const ENDED = "Ending startup JIT deferral window: ";

// verboseOSR is chatty and unbuffered, and other JSC log lines can interleave with (or be glued onto) the one we
// want, so extract the deferral messages by pattern rather than by whole lines. The program's own markers go to
// stdout, which JSC does not write to.
function deferralLines(stderr: string) {
  return [...stderr.matchAll(/Ending startup JIT deferral window: [^\n(]*\(scale was [\d.]+\)/g)].map(m => m[0]);
}

describe("startup JIT deferral window", () => {
  const sources = {
    "write.ts": `process.stdout.write("ready\\n");`,
    "log.ts": `console.log("ready");`,
    "fswrite.ts": `require("fs").writeSync(1, "ready\\n");`,
    "stdin.ts": `
      for await (const chunk of process.stdin) {
        process.stdout.write("got " + chunk.length + "\\n");
        break;
      }
    `,
    "unsafe.ts": `
      Bun.unsafe.setJITPolicy(1);
      Bun.unsafe.setJITPolicy(1); // no-op once ended
      process.stdout.write("got here\\n");
    `,
    "rearm.ts": `
      Bun.unsafe.setJITPolicy(1);
      Bun.unsafe.setJITPolicy(4);
      process.stdout.write("got here\\n");
    `,
  };

  const compiled = new Map<string, string>();
  function compile(dir: string, name: keyof typeof sources, flags: string[] = []) {
    const key = path.join(dir, name + flags.join(""));
    const cached = compiled.get(key);
    if (cached) return cached;
    const out = path.join(dir, path.basename(name, ".ts") + flags.join("").replaceAll("=", "") + ".exe");
    const build = Bun.spawnSync({
      cmd: [bunExe(), "build", "--compile", ...flags, path.join(dir, name), "--outfile", out],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(build.stderr.toString()).not.toContain("error:");
    expect(build.exitCode).toBe(0);
    compiled.set(key, out);
    return out;
  }

  async function buildApi(dir: string, name: keyof typeof sources, compile: Bun.CompileBuildOptions, tag: string) {
    const outfile = path.join(dir, path.basename(name, ".ts") + "-" + tag + ".exe");
    const result = await Bun.build({ entrypoints: [path.join(dir, name)], compile: { ...compile, outfile } });
    expect(result.logs.map(String).join("\n")).toBe("");
    expect(result.success).toBe(true);
    return outfile;
  }

  async function run(exe: string, env: Record<string, string | undefined> = {}, stdin?: string) {
    await using proc = Bun.spawn({
      cmd: [exe],
      env: { ...bunEnv, BUN_JSC_verboseOSR: "1", ...env },
      // A Blob stdin is a memfd/file: the read completes synchronously inside the pull (the non-polling path).
      stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, lines: deferralLines(stderr), exitCode };
  }

  test("ends on the event that makes the program interactive", async () => {
    using dir = tempDir("startup-jit-deferral", sources);
    const d = String(dir);

    {
      const { stdout, lines, exitCode } = await run(compile(d, "write.ts"));
      expect(stdout).toBe("ready\n");
      // FileSink fast path or node:fs, whichever process.stdout.write reaches first; both are "first output".
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^Ending startup JIT deferral window: first (fs\.)?write to stdout\/stderr /);
      expect(exitCode).toBe(0);
    }
    {
      const { stdout, lines, exitCode } = await run(compile(d, "log.ts"));
      expect(stdout).toBe("ready\n");
      expect(lines).toEqual([ENDED + "first console write (scale was 8)"]);
      expect(exitCode).toBe(0);
    }
    {
      const { stdout, lines, exitCode } = await run(compile(d, "fswrite.ts"));
      expect(stdout).toBe("ready\n");
      expect(lines).toEqual([ENDED + "first fs.write to stdout/stderr (scale was 8)"]);
      expect(exitCode).toBe(0);
    }
    {
      // Ended by the read, i.e. before the program wrote anything.
      const { stdout, lines, exitCode } = await run(compile(d, "stdin.ts"), {}, "hello");
      expect(stdout).toBe("got 5\n");
      expect(lines).toEqual([ENDED + "first stdin data (scale was 8)"]);
      expect(exitCode).toBe(0);
    }
    {
      const { stdout, lines, exitCode } = await run(compile(d, "write.ts"), { BUN_STARTUP_JIT_DEFERRAL: "0" });
      expect(stdout).toBe("ready\n");
      expect(lines).toEqual([]);
      expect(exitCode).toBe(0);
    }
  }, 60_000);

  test("compile.jitPolicy / --compile-jit-policy bake the starting policy into the executable", async () => {
    using dir = tempDir("startup-jit-deferral-build", sources);
    const d = String(dir);

    {
      // jitPolicy: 1 → no window; BUN_STARTUP_JIT_DEFERRAL=1 still turns it on at run time.
      const exe = await buildApi(d, "write.ts", { jitPolicy: 1 }, "off");
      const { stdout, lines, exitCode } = await run(exe);
      expect(stdout).toBe("ready\n");
      expect(lines).toEqual([]);
      expect(exitCode).toBe(0);
      const forced = await run(exe, { BUN_STARTUP_JIT_DEFERRAL: "1" });
      expect(forced.lines).toHaveLength(1);
      expect(forced.exitCode).toBe(0);
    }
    {
      const { stdout, lines, exitCode } = await run(compile(d, "write.ts", ["--compile-jit-policy=1"]));
      expect(stdout).toBe("ready\n");
      expect(lines).toEqual([]);
      expect(exitCode).toBe(0);
    }
    {
      const { stdout, lines, exitCode } = await run(compile(d, "log.ts", ["--compile-jit-policy=4"]));
      expect(stdout).toBe("ready\n");
      expect(lines).toEqual([ENDED + "first console write (scale was 4)"]);
      expect(exitCode).toBe(0);
    }
    for (const jitPolicy of [0, 0.5, 1e40, Infinity, NaN, "8"]) {
      // @ts-expect-error
      expect(() => Bun.build({ entrypoints: [path.join(d, "write.ts")], compile: { jitPolicy } })).toThrow(
        /compile\.jitPolicy/,
      );
    }
  }, 60_000);

  test("Bun.unsafe.setJITPolicy() sets it from the program", async () => {
    using dir = tempDir("startup-jit-deferral-unsafe", sources);
    const d = String(dir);
    {
      const { stdout, lines, exitCode } = await run(compile(d, "unsafe.ts"));
      expect(stdout).toBe("got here\n");
      expect(lines).toEqual([ENDED + "Bun.unsafe.setJITPolicy (scale was 8)"]);
      expect(exitCode).toBe(0);
    }
    {
      // > 1 after the window ended re-arms it (no deadline); the first output ends it again.
      await using proc = Bun.spawn({
        cmd: [compile(d, "rearm.ts")],
        env: { ...bunEnv, BUN_JSC_verboseOSR: "1" },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("got here\n");
      expect(stderr).toContain("Startup JIT deferral scale set to 4");
      const lines = deferralLines(stderr);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe(ENDED + "Bun.unsafe.setJITPolicy (scale was 8)");
      expect(lines[1]).toMatch(
        /^Ending startup JIT deferral window: first (fs\.)?write to stdout\/stderr \(scale was 4\)/,
      );
      expect(exitCode).toBe(0);
    }
    // Outside a compiled executable the policy is already 1: a no-op.
    expect(Bun.unsafe.setJITPolicy(1)).toBeUndefined();
    expect(() => Bun.unsafe.setJITPolicy("x" as unknown as number)).toThrow(TypeError);
    expect(() => Bun.unsafe.setJITPolicy(0.5)).toThrow(RangeError);
    expect(() => Bun.unsafe.setJITPolicy(Infinity)).toThrow(RangeError);
  });
});
