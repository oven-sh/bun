/**
 * test/docker/coordinator.ts is spawned by scripts/runner.node.mjs at the start
 * of every Linux CI shard and owns `docker compose` for the container-backed
 * test files in it. The agent can start a shard before dockerd has finished
 * coming up (on the openrc images the agent service is not ordered after
 * docker), and until the coordinator waited for the daemon, its one-shot
 * `docker version` answered every request, and so failed every container-backed
 * test file in the shard including the in-shard retries, with "Docker is not
 * available" (builds 97891, 98647, 98707, 98746: the daemon was still down 3-4.5
 * minutes into the job and came up a few minutes after that).
 *
 * The wait is driven here with a scripted probe and millisecond timings. The
 * tests after that put a fake `docker` on PATH: one whose CLI hangs, to pin
 * the probe's own bound (everything above assumes a probe returns), and one
 * whose daemon is still starting, used both for isDockerEnabled() in
 * test/harness.ts (which used to probe the daemon at import time of ~25 test
 * files and so failed them the same way) and to run the real coordinator end
 * to end.
 */
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

import { waitForDockerDaemon } from "../docker/index.ts";

/** Answers `outcomes` in order, then `finalOutcome` forever. */
function scriptedProbe(outcomes: boolean[], finalOutcome: boolean) {
  const remaining = [...outcomes];
  const probe = async () => {
    probe.calls++;
    return remaining.length ? remaining.shift()! : finalOutcome;
  };
  probe.calls = 0;
  return probe;
}

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("expected the wait to fail");
    },
    (error: Error) => error,
  );

test("a daemon that is already up costs one probe and logs nothing", async () => {
  const probe = scriptedProbe([], true);
  const log: string[] = [];
  const waitFor = waitForDockerDaemon({ windowMs: 10_000, pollMs: 1, probe, log: m => log.push(m) });

  await waitFor(1_000);

  expect(probe.calls).toBe(1);
  expect(log).toEqual([]);
});

test("requests made while the daemon is starting wait for it on one shared poll loop", async () => {
  const probe = scriptedProbe([false, false, false], true);
  const log: string[] = [];
  const waitFor = waitForDockerDaemon({ windowMs: 10_000, pollMs: 1, probe, log: m => log.push(m) });

  // Two services requested at once, as the prestart does.
  await Promise.all([waitFor(5_000), waitFor(5_000)]);

  expect(probe.calls).toBe(4);
  expect(log).toEqual([
    "docker daemon is not reachable yet; waiting up to 10s for it to come up",
    expect.stringMatching(/^docker daemon became reachable after \d+s$/),
  ]);

  // From now on requests neither probe nor wait.
  await waitFor(0);
  expect(probe.calls).toBe(4);
});

test("a request that hits its cap fails by itself; polling continues so a retry gets the daemon", async () => {
  let up = false;
  let calls = 0;
  const probe = async () => {
    calls++;
    return up;
  };
  const waitFor = waitForDockerDaemon({ windowMs: 10_000, pollMs: 1, probe, log: () => {} });

  const error = await rejection(waitFor(20));
  expect(error.message).toMatch(
    /^Docker daemon not reachable \(unreachable for \d+s so far\); gave up waiting for it after 0s for this request$/,
  );

  // The runner retries the file whose request just failed; by then the daemon
  // may be up, and the retry's request must see that.
  const callsAtCap = calls;
  up = true;
  await waitFor(5_000);
  expect(calls).toBeGreaterThan(callsAtCap);
});

test("a request pending when the window closes gets the window failure", async () => {
  const probe = scriptedProbe([], false);
  const log: string[] = [];
  const waitFor = waitForDockerDaemon({ windowMs: 30, pollMs: 1, probe, log: m => log.push(m) });

  const error = await rejection(waitFor(5_000));
  expect(error.message).toMatch(
    /^Docker daemon still unreachable after \d+s \(`docker version` kept failing\); not waiting for it any longer$/,
  );
  // The same line goes to the shard log, so the log explains the failures even
  // when they surface in test files much later.
  expect(log).toEqual(["docker daemon is not reachable yet; waiting up to 0s for it to come up", error.message]);
});

test("after the window closes with nothing waiting, later requests fail at once instead of waiting out their cap", async () => {
  const probe = scriptedProbe([], false);
  const { promise: windowClosed, resolve: onWindowClosed } = Promise.withResolvers<string>();
  const waitFor = waitForDockerDaemon({
    windowMs: 30,
    pollMs: 1,
    probe,
    log: message => {
      if (message.startsWith("Docker daemon still unreachable")) onWindowClosed(message);
    },
  });

  // Nobody is waiting while the window closes. The log line is emitted just
  // before the shared promise rejects, so let the event loop turn once: if the
  // wait let that rejection escape, bun:test reports it as an unhandled error
  // here, before any request attaches to it.
  const message = await windowClosed;
  await new Promise<void>(resolve => setImmediate(resolve));
  const callsAtClose = probe.calls;

  const error = await rejection(waitFor(60_000));
  expect(error.message).toBe(message);
  expect(probe.calls).toBe(callsAtClose);
});

// A `docker` CLI whose daemon is still starting: `docker info` fails, `docker
// version` fails the first time it is run and succeeds from then on, `docker
// compose ... port <service> <port>` answers with a fixed host port, and the
// other compose subcommands (version, build, ps, up) succeed silently. Every
// invocation is appended to calls.log in the directory above bin/.
const fakeDocker = `#!/bin/sh
state=$(dirname "$0")/..
echo "$*" >> "$state/calls.log"
case "$1" in
  info)
    exit 1
    ;;
  version)
    if [ -e "$state/probed-once" ]; then exit 0; fi
    : > "$state/probed-once"
    echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" >&2
    exit 1
    ;;
  compose)
    for arg in "$@"; do
      if [ "$arg" = port ]; then echo "0.0.0.0:54321"; exit 0; fi
    done
    ;;
esac
exit 0
`;

// A `docker` CLI stuck talking to a daemon that accepted the connection but
// never answers.
const hangingDocker = `#!/bin/sh
if [ "$1" = version ]; then exec sleep 15; fi
exit 0
`;

function fakeDockerDir(script = fakeDocker) {
  // Short name: the coordinator socket created inside it has to fit in
  // sun_path (104 bytes on macOS).
  const dir = tempDir("coord", { "bin/docker": script });
  chmodSync(join(String(dir), "bin", "docker"), 0o755);
  return dir;
}

const calls = (dir: string) => (existsSync(join(dir, "calls.log")) ? readFileSync(join(dir, "calls.log"), "utf8") : "");

// The docker helpers look the CLI up in the environment their process started
// with (Bun.which and Bun.spawn both read that, not later edits to
// process.env), so the fake CLI has to be first on PATH of a fresh process.
// ensure() also answers from BUN_TEST_SERVICE_<name> without touching docker,
// and BUN_DOCKER_* / COMPOSE_* change what it runs, so none of those may leak
// in from the machine running this file.
function envWithFakeDocker(dir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(bunEnv)) {
    if (value !== undefined && !/^(BUN_TEST_SERVICE_|BUN_DOCKER_|COMPOSE_)/.test(key)) env[key] = value;
  }
  env.PATH = `${join(dir, "bin")}:${env.PATH}`;
  return env;
}

/** Runs `script` (which must print one JSON value) in a fresh bun with the fake docker on PATH. */
async function evalWithFakeDocker(env: Record<string, string>, script: string): Promise<unknown> {
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

const harnessPath = JSON.stringify(join(import.meta.dir, "..", "harness.ts"));
const dockerIndexPath = JSON.stringify(join(import.meta.dir, "..", "docker", "index.ts"));

function isDockerEnabledWith(dir: string, coordinator: string | undefined): Promise<unknown> {
  const env = envWithFakeDocker(dir);
  if (coordinator !== undefined) env.BUN_DOCKER_COORDINATOR = coordinator;
  return evalWithFakeDocker(
    env,
    `import { isDockerEnabled } from ${harnessPath};
     let result;
     try { result = isDockerEnabled(); } catch (error) { result = "threw: " + error.message; }
     console.log(JSON.stringify(result));`,
  );
}

test.concurrent.skipIf(isWindows)(
  "a probe whose docker CLI hangs counts as unreachable instead of hanging the wait",
  async () => {
    using dir = fakeDockerDir(hangingDocker);
    const result = await evalWithFakeDocker(
      envWithFakeDocker(String(dir)),
      `import { isDockerDaemonReachable } from ${dockerIndexPath};
     const startedAt = Date.now();
     const reachable = await isDockerDaemonReachable(250);
     console.log(JSON.stringify({ reachable, tookMs: Date.now() - startedAt }));`,
    );
    // Without the bound the probe returns only when the fake CLI's 15s sleep ends.
    expect(result).toEqual({ reachable: false, tookMs: expect.any(Number) });
    expect((result as { tookMs: number }).tookMs).toBeLessThan(15_000);
  },
);

// On Linux arm64 isDockerEnabled() is false before it looks at anything else.
test.concurrent.skipIf(isWindows || (isLinux && process.arch === "arm64"))(
  "isDockerEnabled() trusts the shard's coordinator instead of probing the daemon from every test file",
  async () => {
    using withCoordinator = fakeDockerDir();
    using withoutCoordinator = fakeDockerDir();
    const [enabled, enabledWithout] = await Promise.all([
      isDockerEnabledWith(String(withCoordinator), join(String(withCoordinator), "coordinator.sock")),
      isDockerEnabledWith(String(withoutCoordinator), undefined),
    ]);

    expect(enabled).toBe(true);
    expect(calls(String(withCoordinator))).toBe("");

    // Without a coordinator the daemon is probed as before, and this one is
    // down: false, or on Linux CI the harness's own "docker is required" error.
    expect(enabledWithout).not.toBe(true);
    expect(calls(String(withoutCoordinator))).toBe("info\n");
  },
);

test.concurrent.skipIf(isWindows)(
  "the coordinator answers a request made while the daemon is still starting",
  async () => {
    using dir = fakeDockerDir();
    const socketPath = join(String(dir), "coordinator.sock");

    const env = envWithFakeDocker(String(dir));
    env.BUN_DOCKER_COORDINATOR_SOCKET = socketPath;

    await using coordinator = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "..", "docker", "coordinator.ts")],
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // The runner connects tests to the socket only after this line. stdout has
    // to be read incrementally for that, so it is collected by hand; a
    // coordinator that exits before printing it fails the test right away.
    let stdout = "";
    const stderr = coordinator.stderr.text();
    const { promise: listening, resolve: onListening, reject: onExitedFirst } = Promise.withResolvers<void>();
    const stdoutDrained = (async () => {
      for await (const chunk of coordinator.stdout) {
        stdout += Buffer.from(chunk).toString();
        if (stdout.includes(`COORDINATOR_READY ${socketPath}\n`)) onListening();
      }
      onExitedFirst(
        new Error(`coordinator exited before COORDINATOR_READY\nstdout:\n${stdout}\nstderr:\n${await stderr}`),
      );
    })();
    await listening;

    // What ensureViaCoordinator() in test/docker/index.ts sends and reads back.
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = connect(socketPath, () =>
        socket.write(JSON.stringify({ type: "ensure", service: "postgres_plain" }) + "\n"),
      );
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("data", chunk => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline !== -1) {
          socket.end();
          resolve(buffer.slice(0, newline));
        }
      });
      socket.on("error", reject);
      socket.on("close", () => reject(new Error(`coordinator closed the socket without replying; got: ${buffer}`)));
    });
    expect(JSON.parse(reply)).toEqual({ ok: true, info: { host: "127.0.0.1", ports: { 5432: 54321 } } });

    // The probe that failed, the poll that found the daemon, and only then any
    // compose invocation.
    const invocations = calls(String(dir)).trim().split("\n");
    expect(invocations.slice(0, 2)).toEqual(["version", "version"]);
    expect(invocations.findIndex(call => call.startsWith("compose "))).toBeGreaterThanOrEqual(2);
    expect(invocations).toContainEqual(
      expect.stringMatching(/^compose .* up -d --wait --wait-timeout 180 postgres_plain$/),
    );

    // EOF on stdin is how the coordinator learns the shard is over.
    coordinator.stdin.end();
    const exitCode = await coordinator.exited;
    await stdoutDrained;
    expect(stdout).toMatch(/^coordinator: docker daemon became reachable after \d+s$/m);
    expect(stdout).toContain("coordinator: postgres_plain ready\n");
    expect(await stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(existsSync(socketPath)).toBeFalse();
  },
);
