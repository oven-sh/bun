/**
 * scripts/agent.ts is the Buildkite agent service of a CI machine, and the other CI scripts import
 * what it knows about the machine from it.
 */
import { expect, mock, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import * as os from "node:os";
import { join } from "node:path";
import { getUser } from "../../scripts/agent.ts";

// scripts/runner.node.ts sets USER and HOME of every `bun test` it spawns from this. It used to call
// os.userInfo() per test file, and on a macOS agent whose host had begun to shut down that call threw
// `uv_os_get_passwd returned ENOENT`, which ended the shard with exit 1 under the name of the next test.
test("getUser() looks the user up once", () => {
  const real = { ...os };
  let calls = 0;
  mock.module("node:os", () => ({
    ...real,
    userInfo: () => {
      if (++calls > 1) {
        throw new Error("A system error occurred: uv_os_get_passwd returned ENOENT (no such file or directory)");
      }
      return real.userInfo();
    },
  }));
  try {
    const user = getUser();
    expect(user).toEqual(real.userInfo());
    expect(getUser()).toBe(user);
    expect(calls).toBe(1);
  } finally {
    mock.module("node:os", () => real);
  }
});

// launchd and systemd stop the agent service with a SIGTERM to `agent.ts start`, which runs
// buildkite-agent through run(). The agent has to get that signal: it then takes no new job and exits
// once the one it runs is done, which the nightly cleanup of the macOS agents waits for. However the
// agent ends after that, the service has to exit with 0: launchd starts a service that exits with
// anything else again (KeepAlive, SuccessfulExit=false), with an agent that takes jobs.
for (const [ending, onSigterm] of [
  ["exits with 0", `process.on("SIGTERM", () => setImmediate(() => process.exit(0)));`],
  ["exits with 1", `process.on("SIGTERM", () => setImmediate(() => process.exit(1)));`],
  ["dies of the signal", ``],
] as const) {
  test.concurrent.skipIf(isWindows)(
    `run() passes a signal named in \`forward\` on to a command that then ${ending}`,
    async () => {
      using dir = tempDir("ci-agent-run", {
        "command.fixture.mjs": `
          ${onSigterm}
          process.on("exit", code => console.log("command: exit", code));
          setInterval(() => {}, 1 << 30);
          console.log("command: ready, pid", process.pid);
        `,
        "service.fixture.mjs": `
          import { run } from ${JSON.stringify(join(import.meta.dir, "..", "..", "scripts", "agent.ts"))};
          await run([process.execPath, "command.fixture.mjs"], { forward: ["SIGTERM"] });
          console.log("service: run() returned");
        `,
      });

      await using service = Bun.spawn({
        cmd: [bunExe(), "service.fixture.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = service.stderr.text();

      const reader = service.stdout.getReader();
      const decoder = new TextDecoder();
      let stdout = "";
      const readUntil = async (found: () => boolean) => {
        while (!found()) {
          const { done, value } = await reader.read();
          if (done) break;
          stdout += decoder.decode(value, { stream: true });
        }
      };

      const ready = /^command: ready, pid (\d+)\n/;
      await readUntil(() => ready.test(stdout));
      const commandPid = Number(ready.exec(stdout)?.[1]);
      service.kill("SIGTERM");
      const exitCode = await service.exited;
      // A command that did not get the signal outlives the service and keeps the pipes open.
      try {
        process.kill(commandPid, "SIGKILL");
      } catch {}
      await readUntil(() => false);

      const commandExit = {
        "exits with 0": "command: exit 0\n",
        "exits with 1": "command: exit 1\n",
        "dies of the signal": "",
      };
      expect({ stdout, stderr: await stderr, exitCode, signalCode: service.signalCode }).toEqual({
        stdout: `command: ready, pid ${commandPid}\n${commandExit[ending]}service: run() returned\n`,
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );
}

// Without such a signal, a command that fails is an error, and the service manager starts the agent again.
test.concurrent("run() throws when the command exits with something other than 0", async () => {
  using dir = tempDir("ci-agent-run", {
    "service.fixture.mjs": `
      import { run } from ${JSON.stringify(join(import.meta.dir, "..", "..", "scripts", "agent.ts"))};
      await run([process.execPath, "-e", "process.exit(7)"], { forward: ["SIGTERM"] });
      console.log("service: run() returned");
    `,
  });

  await using service = Bun.spawn({
    cmd: [bunExe(), "service.fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([service.stdout.text(), service.stderr.text(), service.exited]);

  expect(stdout).toBe("");
  expect(stderr).toContain("Command exited with code 7");
  expect(exitCode).toBe(1);
});
