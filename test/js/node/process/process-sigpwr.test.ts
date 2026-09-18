import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { constants } from "node:os";

// On Linux, JSC suspends and resumes threads with SIGPWR (GC stack scans, the
// sampling profiler). A SIGPWR that JSC did not send must not crash or hang
// the process: process.kill(pid, 30), kill -PWR <pid>, or a container manager
// that stops PID 1 with SIGPWR.
describe.skipIf(!isLinux)("SIGPWR that JSC did not send", () => {
  const SIGPWR = constants.signals.SIGPWR;

  // Read stdout until the child has printed "ready". Once the child runs JS,
  // JSC's signal handler is installed, so a signal sent after that reaches
  // the handler and not the default action.
  async function spawnAndWaitForReady(script: string) {
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const decoder = new TextDecoder();
    const reader = proc.stdout.getReader();
    let stdout = "";
    while (!stdout.includes("ready\n")) {
      const { value, done } = await reader.read();
      if (done) break;
      stdout += decoder.decode(value, { stream: true });
    }
    const rest = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return stdout;
        stdout += decoder.decode(value, { stream: true });
      }
    })();
    return { proc, stdout: rest };
  }

  async function expectSurvived(proc: Bun.Subprocess, stdout: Promise<string>, expected: string) {
    const [out, stderr, exitCode] = await Promise.all([stdout, proc.stderr!.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(out).toBe(expected);
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  }

  test("process.kill(process.pid, SIGPWR) does not crash the process", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `process.kill(process.pid, ${SIGPWR}); setTimeout(() => console.log("survived"), 50);`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("survived\n");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });

  test("SIGPWR from another process does not crash the process", async () => {
    const { proc, stdout } = await spawnAndWaitForReady(
      `process.stdin.once("data", () => setTimeout(() => console.log("survived"), 50));
       process.stdin.resume();
       console.log("ready");`,
    );
    await using _ = proc;
    proc.kill(SIGPWR);
    proc.stdin!.write("go\n");
    await proc.stdin!.end();
    await expectSurvived(proc, stdout, "ready\nsurvived\n");
  });

  test("a flood of SIGPWR while the GC suspends the JS thread does not crash or hang", async () => {
    const { proc, stdout } = await spawnAndWaitForReady(
      `console.log("ready");
       let keep = [];
       for (let i = 0; i < 8; i++) {
         for (let j = 0; j < 1000; j++) keep.push({ i, j, s: Buffer.alloc(j % 64, "x").toString() });
         if (keep.length > 50_000) keep = [];
         Bun.gc(true);
       }
       console.log("survived");`,
    );
    await using _ = proc;
    let exited = false;
    proc.exited.then(() => (exited = true));
    while (!exited) {
      for (let i = 0; i < 200 && !exited; i++) {
        try {
          proc.kill(SIGPWR);
        } catch {
          break;
        }
      }
      await Bun.sleep(1);
    }
    await expectSurvived(proc, stdout, "ready\nsurvived\n");
  });
});
