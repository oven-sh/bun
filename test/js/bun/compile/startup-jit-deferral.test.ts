// `bun build --compile` executables start with JSC tier-up deferred (startupJITDeferralScale) and end that window when the
// program becomes interactive (docs/bundler/executables.mdx "JIT during startup"). BUN_JSC_verboseOSR=1 makes JSC log
// "Ending startup JIT deferral window: <reason>" when it ends.
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
  function compile(dir: string, name: keyof typeof sources) {
    const cached = compiled.get(name);
    if (cached) return cached;
    const out = path.join(dir, path.basename(name, ".ts") + ".exe");
    const build = Bun.spawnSync({
      cmd: [bunExe(), "build", "--compile", path.join(dir, name), "--outfile", out],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    expect(build.stderr.toString()).not.toContain("error:");
    expect(build.exitCode).toBe(0);
    compiled.set(name, out);
    return out;
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
});
