/**
 * spawnBackground() (scripts/utils.mjs) is how scripts/runner.node.mjs starts the
 * crash report remap server on CI shards. The server takes seconds to start on a
 * fresh agent, so the runner starts it before its own installs and only calls
 * firstLine() for the port right before the first test. That works only if a line
 * printed before the call is still delivered, if a helper that ends without
 * printing fails the call at once and not after the timeout, if the timeout kills
 * the helper, and if the helper dies with the process that started it.
 *
 * Each case runs in a fixture process, under node (the runner's runtime) and
 * under bun. The helpers are `-e` scripts of the same runtime. The fixture
 * reports one JSON line on stdout; spawnBackground reads the helpers' stdout, so
 * they cannot write there. The helpers inherit the fixture's stderr, so the
 * fixture's stderr reaches EOF only once every helper is gone: runFixture() reads
 * it to EOF, which is how the "killed on exit" cases are proven, and the control
 * case shows that a helper nothing kills does keep it open.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExe, tempDir } from "harness";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const utils = pathToFileURL(join(import.meta.dir, "../../scripts/utils.mjs")).href;

const fixture = tempDir("spawn-background", {
  "spawn-background-fixture.mjs": `
    import { spawn } from "node:child_process";
    import { spawnBackground } from ${JSON.stringify(utils)};

    const [mode] = process.argv.slice(2);
    const helper = code => spawnBackground([process.execPath, "-e", code]);
    const forever = "setInterval(() => {}, 1000)";
    // The helpers are unref'd: hold the event loop open while waiting for one to end.
    async function ended(subprocess) {
      const keepAlive = setInterval(() => {}, 1000);
      if (subprocess.exitCode === null && subprocess.signalCode === null) {
        await new Promise(resolve => subprocess.once("close", resolve));
      }
      clearInterval(keepAlive);
      return subprocess.signalCode ?? subprocess.exitCode;
    }
    function isAlive(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    }

    let report;
    switch (mode) {
      case "ready": {
        const { subprocess, firstLine } = helper("console.log(12345); " + forever);
        report = { ...(await firstLine(30_000)), alive: isAlive(subprocess.pid) };
        break;
      }
      case "printed-before-the-call": {
        const { subprocess, firstLine } = helper("console.log(12345)");
        const exit = await ended(subprocess);
        report = { ...(await firstLine(30_000)), exit };
        break;
      }
      case "exits-without-a-line": {
        const started = Date.now();
        report = { ...(await helper("process.exit(3)").firstLine(30_000)), ms: Date.now() - started };
        break;
      }
      case "does-not-exist": {
        report = await spawnBackground(["/does/not/exist/ci-remap-server"]).firstLine(30_000);
        break;
      }
      case "timeout": {
        const { subprocess, firstLine } = helper(forever);
        report = { ...(await firstLine(250)), exit: await ended(subprocess) };
        break;
      }
      case "control": {
        // Not started through spawnBackground: nothing kills it when this process exits.
        const { pid } = spawn(process.execPath, ["-e", forever], { stdio: ["ignore", "ignore", "inherit"] });
        report = { pid };
        break;
      }
    }
    console.log(JSON.stringify(report));
    // The runner leaves through process.exit() too. It is the "exit" event that kills the helpers.
    process.exit(0);
  `,
});

const env = { ...bunEnv };
// Under this flag a bun helper dies with its parent on its own, which would hide a
// missing "exit" hook.
delete env.BUN_FEATURE_FLAG_NO_ORPHANS;

function startFixture(exe: string, mode: string) {
  return Bun.spawn({
    cmd: [exe, join(String(fixture), "spawn-background-fixture.mjs"), mode],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

/** The JSON line the fixture prints last, or undefined when it did not get that far. */
function parseReport(stdout: string) {
  try {
    return JSON.parse(stdout.trim().split("\n").at(-1)!);
  } catch {
    return undefined;
  }
}

/** Resolves once the fixture has exited and every helper it started is gone. */
async function runFixture(exe: string, mode: string) {
  await using proc = startFixture(exe, mode);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toMatchObject({ stderr: "", exitCode: 0 });
  return parseReport(stdout);
}

function isAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

for (const [runtime, exe] of [
  ["node", nodeExe()],
  ["bun", bunExe()],
] as const) {
  // The runner starts the remap server on non-Windows platforms only.
  describe.skipIf(isWindows || !exe)(`under ${runtime}`, () => {
    test.concurrent("resolves with the line of a helper that stays up, and kills it on exit", async () => {
      expect(await runFixture(exe!, "ready")).toEqual({ line: "12345", alive: true });
    });

    test.concurrent("delivers a line printed before the call, also once the helper is gone", async () => {
      expect(await runFixture(exe!, "printed-before-the-call")).toEqual({ line: "12345", exit: 0 });
    });

    test.concurrent(
      "a helper that exits without a line fails the call at once, not after the 30s timeout",
      async () => {
        const result = await runFixture(exe!, "exits-without-a-line");
        expect(result).toEqual({ error: "code 3", ms: expect.any(Number) });
        expect(result.ms).toBeLessThan(15_000);
      },
    );

    test.concurrent("a command that cannot be spawned fails the call", async () => {
      expect(await runFixture(exe!, "does-not-exist")).toEqual({ error: expect.stringContaining("ENOENT") });
    });

    test.concurrent("the timeout counts from the call and kills the helper", async () => {
      expect(await runFixture(exe!, "timeout")).toEqual({ error: "timeout", exit: "SIGTERM" });
    });

    test.concurrent("control: a helper nothing kills outlives the fixture and holds its stderr open", async () => {
      await using proc = startFixture(exe!, "control");
      // stderr is left pending on purpose: the helper holds it open until the test kills the helper.
      const stderr = proc.stderr.text();
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      const pid: number | undefined = parseReport(stdout)?.pid;
      try {
        expect({ stdout, exitCode }).toMatchObject({ exitCode: 0 });
        expect(pid).toBeNumber();
        expect(isAlive(pid!)).toBe(true);
        expect(
          await Promise.race([stderr.then(() => "eof"), new Promise(resolve => setImmediate(() => resolve("open")))]),
        ).toBe("open");
      } finally {
        if (pid !== undefined) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
      }
      expect(await stderr).toBe("");
    });
  });
}
