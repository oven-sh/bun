// A signal sent to `bun install` while a lifecycle script runs is forwarded
// to the script. `bun install` waits for the script, then dies by the same
// signal. Without this the script keeps running, reparented to init, and
// keeps writing into node_modules. On Linux a script also dies with a bun
// install that had no chance to forward anything (SIGKILL).
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isPosix, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The hook records its pid, then waits. On TERM/INT/HUP it records the
// signal. In "exit" mode it then exits 0, otherwise it keeps running so that
// the test can check the escalation path. `wait` on a background `sleep`
// returns as soon as a trapped signal arrives, so the trap runs at once.
const hook = `
on_signal() {
  printf %s "$1" > got-signal.tmp && mv got-signal.tmp got-signal
  if [ "$mode" = exit ]; then exit 0; fi
}
mode=$1
trap 'on_signal SIGTERM' TERM
trap 'on_signal SIGINT' INT
trap 'on_signal SIGHUP' HUP
printf %s "$$" > hook-pid.tmp && mv hook-pid.tmp hook-pid
while :; do
  sleep 1 &
  wait $!
done
`;

const files = (mode: "exit" | "stay") => ({
  "package.json": JSON.stringify({
    name: "app",
    version: "1.0.0",
    // `exec` so that the hook is the direct child of bun install whatever
    // the system shell does with `sh -c`.
    scripts: { postinstall: `exec sh hook.sh ${mode}` },
  }),
  "hook.sh": hook,
});

// Both files are written with a rename, so they are never seen half-written.
async function waitForFile(path: string): Promise<string> {
  for (;;) {
    try {
      return readFileSync(path, "utf8");
    } catch {}
    await Bun.sleep(10);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code !== "ESRCH";
  }
}

async function waitForExit(pid: number) {
  while (isAlive(pid)) {
    await Bun.sleep(10);
  }
}

function killQuietly(pid: number) {
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}

// Spawns `bun install` in `dir` and waits until the hook runs. `stderr` is
// drained from the start; it resolves once bun install and the hook (which
// inherits it) are both gone.
async function startInstall(dir: string) {
  const proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
    stdout: "ignore",
    stderr: "pipe",
  });
  const stderr = proc.stderr.text();
  const hookPid = await Promise.race([
    waitForFile(join(dir, "hook-pid")).then(Number),
    proc.exited.then(async code => {
      throw new Error(`bun install exited with ${code} before the hook started: ${await stderr}`);
    }),
  ]);
  // Never hand 0 or NaN to kill(): pid 0 is the whole process group.
  expect(hookPid).toBeGreaterThan(1);
  return { proc, stderr, hookPid };
}

describe.skipIf(!isPosix).concurrent("bun install forwards signals to lifecycle scripts", () => {
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    test(`${signal} reaches the postinstall script and bun install waits for it`, async () => {
      using dir = tempDir("install-signal", files("exit"));
      const { proc, stderr, hookPid } = await startInstall(String(dir));
      await using _ = proc;
      try {
        expect(isAlive(hookPid)).toBe(true);

        proc.kill(signal);
        await proc.exited;

        // bun install reaps the hook before it dies, so the hook is gone by now.
        expect(isAlive(hookPid)).toBe(false);
        expect(await waitForFile(join(String(dir), "got-signal"))).toBe(signal);
        expect(await stderr).not.toContain("error:");
        expect(proc.signalCode).toBe(signal);
      } finally {
        killQuietly(hookPid);
      }
    });
  }

  test("bun install waits for a script that outlives the first signal, a second one ends it", async () => {
    using dir = tempDir("install-signal-twice", files("stay"));
    const { proc, hookPid } = await startInstall(String(dir));
    await using _ = proc;
    try {
      proc.kill("SIGTERM");
      // bun install must still be alive once the hook has seen the signal.
      const first = await Promise.race([waitForFile(join(String(dir), "got-signal")), proc.exited]);
      expect(first).toBe("SIGTERM");
      expect(isAlive(hookPid)).toBe(true);
      expect(proc.exitCode).toBeNull();

      // The hook is out after the first signal, so this one takes the
      // default action.
      proc.kill("SIGTERM");
      await proc.exited;
      expect(proc.signalCode).toBe("SIGTERM");
      if (isLinux) {
        // PR_SET_PDEATHSIG: the kernel kills the script with bun install.
        await waitForExit(hookPid);
      }
    } finally {
      killQuietly(hookPid);
    }
  });

  // No signal to forward here: the kernel does it (PR_SET_PDEATHSIG).
  test.skipIf(!isLinux)("a script does not outlive a bun install that is SIGKILLed", async () => {
    using dir = tempDir("install-sigkill", files("stay"));
    const { proc, hookPid } = await startInstall(String(dir));
    await using _ = proc;
    try {
      proc.kill("SIGKILL");
      await proc.exited;
      await waitForExit(hookPid);
      expect(proc.signalCode).toBe("SIGKILL");
    } finally {
      killQuietly(hookPid);
    }
  });
});
