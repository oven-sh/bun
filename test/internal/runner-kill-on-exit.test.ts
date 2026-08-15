/**
 * killOnExit() (scripts/utils.mjs) ties the helper processes that
 * scripts/runner.node.mjs starts (the crash-report remap server, the docker
 * coordinator) to the runner's lifetime. The runner never drains its event
 * loop: main(), --bail and its signal handlers all end in process.exit(), and a
 * bug in it ends it with an uncaught exception. None of those emit
 * "beforeExit", which the remap server used to be hooked on (so it outlived
 * every CI run); the hook has to fire from "exit".
 *
 * The fixture's helper inherits the fixture's stdout the way the remap server
 * inherits the runner's stderr: stdout reaching EOF proves the helper is dead,
 * and while it lives the pipe stays open, which is how the leak showed up
 * (whatever captured the runner's output kept waiting on the orphan).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExe, tempDir } from "harness";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const utils = pathToFileURL(join(import.meta.dir, "../../scripts/utils.mjs")).href;

const fixture = tempDir("runner-kill-on-exit", {
  "fixture.mjs": `
    import { spawn } from "node:child_process";
    import { writeSync } from "node:fs";
    import { killOnExit } from ${JSON.stringify(utils)};

    const [mode] = process.argv.slice(2);

    async function main() {
      // Idles until it is killed, holding the stdout it inherits from us.
      const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: ["ignore", "inherit", "ignore"],
      });
      helper.unref();
      if (mode !== "leak") killOnExit(helper);
      // Synchronous so that process.exit() below cannot discard it.
      writeSync(2, "helper pid " + helper.pid + "\\n");

      switch (mode) {
        case "exit":
        case "leak":
          process.exit(0);
        case "throw":
          throw new Error("runner bug");
        case "signal":
          process.on("SIGTERM", () => process.exit(3));
          process.kill(process.pid, "SIGTERM");
          setInterval(() => {}, 1000);
      }
    }

    await main();
  `,
});

const env = { ...bunEnv };
// With this set, a bun helper dies with its parent by itself and would hide a missing hook.
delete env.BUN_FEATURE_FLAG_NO_ORPHANS;

// Helpers whose death has not been observed yet; only a failing test leaves any behind.
const liveHelpers = new Set<number>();
afterAll(() => {
  for (const pid of liveHelpers) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function runFixture(exe: string, mode: string) {
  await using proc = Bun.spawn({
    cmd: [exe, join(String(fixture), "fixture.mjs"), mode],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  // stdout is shared with the helper and reaches EOF only once both are gone;
  // stderr is the fixture's alone and reaches EOF when it exits.
  const stdoutEof = proc.stdout.text();
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  const helperPid = Number(/^helper pid (\d+)$/m.exec(stderr)?.[1]);
  if (!helperPid) throw new Error(`fixture did not start its helper:\n${stderr}`);
  liveHelpers.add(helperPid);
  stdoutEof.then(() => liveHelpers.delete(helperPid));
  return { exitCode, helperPid, stdoutEof };
}

function isStillOpen(stdoutEof: Promise<string>): Promise<boolean> {
  return Promise.race([
    stdoutEof.then(() => false),
    new Promise<boolean>(resolve => setImmediate(() => resolve(true))),
  ]);
}

// The runner runs under node; bun is the runtime this suite is about and
// implements the same "exit" semantics. The runner only starts these helpers
// on non-Windows platforms.
for (const [runtime, exe] of [
  ["node", nodeExe()],
  ["bun", bunExe()],
] as const) {
  describe.skipIf(isWindows || !exe)(`under ${runtime}`, () => {
    test.concurrent.each([
      ["process.exit()", "exit", 0],
      ["an uncaught exception", "throw", 1],
      ["a signal handler calling process.exit()", "signal", 3],
    ])("the helper is killed when the parent leaves through %s", async (_, mode, expectedExitCode) => {
      const { exitCode, stdoutEof } = await runFixture(exe!, mode);
      expect(exitCode).toBe(expectedExitCode);
      await stdoutEof;
    });

    test.concurrent("control: without the hook the helper outlives the parent and holds its stdout open", async () => {
      const { exitCode, helperPid, stdoutEof } = await runFixture(exe!, "leak");
      expect(exitCode).toBe(0);
      expect(isAlive(helperPid)).toBe(true);
      expect(await isStillOpen(stdoutEof)).toBe(true);
      process.kill(helperPid, "SIGKILL");
      await stdoutEof;
    });
  });
}
