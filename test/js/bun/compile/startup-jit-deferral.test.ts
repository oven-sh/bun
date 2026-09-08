// `bun build --compile` executables start with JSC tier-up deferred (startupJITDeferralScale) and end that window when
// the program becomes interactive (docs/bundler/executables.mdx "Startup optimizations"). BUN_JSC_verboseOSR=1 makes
// JSC log "Ending startup JIT deferral window: <reason>" when it ends.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

const ENDED = "Ending startup JIT deferral window: ";

// verboseOSR is chatty; keep only the deferral lines and the program's own stderr markers.
function deferralLines(stderr: string) {
  return stderr.split("\n").filter(line => line.startsWith(ENDED) || line.startsWith("got "));
}

describe("startup JIT deferral window", () => {
  const sources = {
    "write.ts": `process.stdout.write("ready\\n");`,
    "log.ts": `console.log("ready");`,
    "fswrite.ts": `require("fs").writeSync(1, "ready\\n");`,
    "stdin.ts": `
      for await (const chunk of process.stdin) {
        process.stderr.write("got " + chunk.length + "\\n");
        break;
      }
    `,
    "unsafe.ts": `
      Bun.unsafe.endStartupJITDeferral();
      Bun.unsafe.endStartupJITDeferral(); // no-op once ended
      process.stderr.write("got here\\n");
    `,
    // Never interactive: spins past a short deadline, then calls a fresh function often enough that its first tier-up
    // check observes the passed deadline.
    "busy.ts": `
      const end = performance.now() + 200;
      while (performance.now() < end) {}
      function fresh(i) { return i * 2; }
      let n = 0;
      for (let i = 0; i < 200000; i++) n += fresh(i);
      if (n < 0) throw new Error("unreachable");
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

  async function buildApi(dir: string, name: keyof typeof sources, optimize: Bun.BuildConfig["optimize"], tag: string) {
    const outfile = path.join(dir, path.basename(name, ".ts") + "-" + tag + ".exe");
    const result = await Bun.build({ entrypoints: [path.join(dir, name)], compile: { outfile }, optimize });
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
      const { lines, exitCode } = await run(compile(d, "stdin.ts"), {}, "hello");
      expect(lines).toEqual([ENDED + "first stdin data (scale was 8)", "got 5"]);
      expect(exitCode).toBe(0);
    }
    {
      const { lines, exitCode } = await run(compile(d, "busy.ts"), { BUN_STARTUP_JIT_DEFERRAL_MS: "20" });
      expect(lines).toEqual([ENDED + "deadline (scale was 8)"]);
      expect(exitCode).toBe(0);
    }
    for (const env of [{ BUN_STARTUP_JIT_DEFERRAL: "0" }, { BUN_STARTUP_JIT_DEFERRAL_MS: "0" }]) {
      const { stdout, lines, exitCode } = await run(compile(d, "write.ts"), env);
      expect(stdout).toBe("ready\n");
      expect(lines).toEqual([]);
      expect(exitCode).toBe(0);
    }
  }, 60_000);

  test("build options bake the window into the executable", async () => {
    using dir = tempDir("startup-jit-deferral-build", sources);
    const d = String(dir);

    {
      // optimize.startupJITDeferral: false → no window; either env var still turns it on at run time.
      const exe = await buildApi(d, "write.ts", { startupJITDeferral: false }, "off");
      const { stdout, lines, exitCode } = await run(exe);
      expect(stdout).toBe("ready\n");
      expect(lines).toEqual([]);
      expect(exitCode).toBe(0);
      for (const env of [{ BUN_STARTUP_JIT_DEFERRAL: "1" }, { BUN_STARTUP_JIT_DEFERRAL_MS: "500" }]) {
        const forced = await run(exe, env);
        expect(forced.lines).toHaveLength(1);
        expect(forced.exitCode).toBe(0);
      }
    }
    {
      const { stdout, lines, exitCode } = await run(compile(d, "write.ts", ["--no-startup-jit-deferral"]));
      expect(stdout).toBe("ready\n");
      expect(lines).toEqual([]);
      expect(exitCode).toBe(0);
    }
    {
      // { maxMs } is the baked deadline; the env var still overrides it.
      const exe = await buildApi(d, "busy.ts", { startupJITDeferral: { maxMs: 20 } }, "20ms");
      const { lines, exitCode } = await run(exe);
      expect(lines).toEqual([ENDED + "deadline (scale was 8)"]);
      expect(exitCode).toBe(0);
      const off = await run(exe, { BUN_STARTUP_JIT_DEFERRAL: "0" });
      expect(off.lines).toEqual([]);
      expect(off.exitCode).toBe(0);
    }
    {
      const { lines, exitCode } = await run(compile(d, "busy.ts", ["--startup-jit-deferral=20"]));
      expect(lines).toEqual([ENDED + "deadline (scale was 8)"]);
      expect(exitCode).toBe(0);
    }
  }, 60_000);

  test("Bun.unsafe.endStartupJITDeferral() ends it from the program", async () => {
    using dir = tempDir("startup-jit-deferral-unsafe", sources);
    const { lines, exitCode } = await run(compile(String(dir), "unsafe.ts"));
    expect(lines).toEqual([ENDED + "Bun.unsafe.endStartupJITDeferral (scale was 8)", "got here"]);
    expect(exitCode).toBe(0);
    // Outside a compiled executable there is no window: a no-op.
    expect(Bun.unsafe.endStartupJITDeferral()).toBeUndefined();
  });
});
