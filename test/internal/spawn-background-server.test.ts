/**
 * spawnBackgroundServer() (scripts/utils.mjs) is how scripts/runner.node.mjs starts
 * the crash report remap server on CI shards. The server takes seconds to start on
 * a fresh agent, so the runner starts it before its own installs and only calls
 * port() right before the first test. That works only if a port printed before the
 * call is still delivered, if a server that ends without printing one fails the
 * call at once and not after the timeout, if a server that prints something else
 * or runs into the timeout is killed, and if the server dies with the process that
 * started it, on every way out of that process.
 *
 * Each case runs in a fixture process, under node (the runner's runtime) and
 * under bun. The servers are `-e` scripts of the same runtime. The fixture reports
 * one JSON line on stdout; spawnBackgroundServer reads the servers' stdout, so
 * they cannot write there. The servers inherit the fixture's stderr, so the
 * fixture's stderr reaches EOF only once every server is gone: runFixture() reads
 * it to EOF, which is how the "killed on exit" cases are proven, and the control
 * case shows that a server nothing kills does keep it open.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExe, tempDir } from "harness";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const utils = pathToFileURL(join(import.meta.dir, "../../scripts/utils.mjs")).href;

const fixture = tempDir("spawn-background-server", {
  "spawn-background-server-fixture.mjs": `
    import { spawn } from "node:child_process";
    import { spawnBackgroundServer } from ${JSON.stringify(utils)};

    const [mode] = process.argv.slice(2);
    const server = code => spawnBackgroundServer([process.execPath, "-e", code]);
    const forever = "setInterval(() => {}, 1000)";
    const listening = "console.log(12345); " + forever;
    // The servers are unref'd: hold the event loop open while waiting for one to end.
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
    // A listening server, plus whether it was still up when the fixture left.
    async function up() {
      const { subprocess, port } = server(listening);
      return { ...(await port(30_000)), alive: isAlive(subprocess.pid) };
    }

    const report = value => console.log(JSON.stringify(value));

    // Like the runner, this process leaves through process.exit() (below), an
    // uncaught exception out of main(), or a signal handler that calls
    // process.exit(). The server has to die on each of them.
    async function main() {
      switch (mode) {
        case "ready":
          return up();
        case "uncaught-exception":
          report(await up());
          throw new Error("runner bug");
        case "signal-handler":
          process.on("SIGTERM", () => process.exit(3));
          report(await up());
          process.kill(process.pid, "SIGTERM");
          // The handler ends the process; keep the event loop alive until it runs.
          setInterval(() => {}, 1000);
          return new Promise(() => {});
        case "printed-before-the-call": {
          const { subprocess, port } = server("console.log(12345)");
          const exit = await ended(subprocess);
          return { ...(await port(30_000)), exit };
        }
        case "exits-3-without-a-line":
          return server("process.exit(3)").port(30_000);
        case "exits-0-without-a-line":
          return server("0").port(30_000);
        case "does-not-exist":
          return spawnBackgroundServer(["/does/not/exist/ci-remap-server"]).port(30_000);
        case "prints-something-else": {
          const { subprocess, port } = server("console.log('listening on 12345'); " + forever);
          return { ...(await port(30_000)), exit: await ended(subprocess) };
        }
        case "timeout": {
          const { subprocess, port } = server(forever);
          return { ...(await port(250)), exit: await ended(subprocess) };
        }
        case "control": {
          // Not started through spawnBackgroundServer: nothing kills it when this process exits.
          const { pid } = spawn(process.execPath, ["-e", forever], { stdio: ["ignore", "ignore", "inherit"] });
          return { pid };
        }
      }
    }

    report(await main());
    process.exit(0);
  `,
});

const env = { ...bunEnv };
// Under this flag a bun server dies with its parent on its own, which would hide a
// missing "exit" hook.
delete env.BUN_FEATURE_FLAG_NO_ORPHANS;

function startFixture(exe: string, mode: string) {
  return Bun.spawn({
    cmd: [exe, join(String(fixture), "spawn-background-server-fixture.mjs"), mode],
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

/** Resolves once the fixture has exited and every server it started is gone. */
async function runFixture(exe: string, mode: string, expected: object = { stderr: "", exitCode: 0 }) {
  await using proc = startFixture(exe, mode);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toMatchObject(expected);
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

const listening = { port: 12345, alive: true };

for (const [runtime, exe] of [
  ["node", nodeExe()],
  ["bun", bunExe()],
] as const) {
  // The runner starts the remap server on non-Windows platforms only.
  describe.skipIf(isWindows || !exe)(`under ${runtime}`, () => {
    test.concurrent("resolves with the port of a server that stays up, and kills it on process.exit()", async () => {
      expect(await runFixture(exe!, "ready")).toEqual(listening);
    });

    test.concurrent("kills the server when the process dies of an uncaught exception", async () => {
      const expected = { exitCode: 1, stderr: expect.stringContaining("runner bug") };
      expect(await runFixture(exe!, "uncaught-exception", expected)).toEqual(listening);
    });

    test.concurrent("kills the server when a signal handler calls process.exit()", async () => {
      expect(await runFixture(exe!, "signal-handler", { stderr: "", exitCode: 3 })).toEqual(listening);
    });

    test.concurrent("delivers a port printed before the call, also once the server is gone", async () => {
      expect(await runFixture(exe!, "printed-before-the-call")).toEqual({ port: 12345, exit: 0 });
    });

    test.concurrent.each([
      ["exits-3-without-a-line", "code 3"],
      ["exits-0-without-a-line", "code 0"],
    ])("a server that ends without a line (%s) fails the call at once, not after the timeout", async (mode, error) => {
      expect(await runFixture(exe!, mode)).toEqual({ error });
    });

    test.concurrent("a command that cannot be spawned fails the call", async () => {
      expect(await runFixture(exe!, "does-not-exist")).toEqual({ error: expect.stringContaining("ENOENT") });
    });

    test.concurrent("a server whose first line is not a port fails the call and is killed", async () => {
      expect(await runFixture(exe!, "prints-something-else")).toEqual({
        error: 'printed "listening on 12345" instead of a port',
        exit: "SIGTERM",
      });
    });

    test.concurrent("the timeout counts from the call and kills the server", async () => {
      expect(await runFixture(exe!, "timeout")).toEqual({ error: "timeout", exit: "SIGTERM" });
    });

    test.concurrent("control: a server nothing kills outlives the fixture and holds its stderr open", async () => {
      await using proc = startFixture(exe!, "control");
      // stderr is left pending on purpose: the server holds it open until the test kills the server.
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
