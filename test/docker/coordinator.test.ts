import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

// `docker compose up` is not safe to run concurrently for one project: two
// invocations can race to create the same container, and the loser exits with
// "Conflict. The container name ... is already in use". coordinator.ts fixes
// that by being the only process that runs compose for a shard: ensure() in
// index.ts sends the service name over the coordinator's unix socket and
// waits for the ready message with the port mapping.
//
// These tests drive both sides deterministically by shimming `docker` with a
// script, so no daemon is required. Windows is skipped because the shims are
// POSIX sh scripts (docker service tests only run on Linux CI anyway).

// Shim used wherever compose is allowed to run. `up` sleeps briefly so
// concurrent client requests provably overlap one in-flight invocation.
const dockerShim = `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$DOCKER_SHIM_LOG"
# capability probes: \`docker version\` / \`docker compose version\`
if [ "$1" = "version" ]; then exit 0; fi
if [ "$2" = "version" ]; then exit 0; fi
# everything else: compose -p <project> -f <file> <verb> ...
case "$6" in
  build | ps | logs) exit 0 ;;
  port) echo "0.0.0.0:$8"; exit 0 ;;
  up)
    if [ "\${DOCKER_SHIM_UP_MODE:-ok}" = "fail" ]; then
      echo 'container coordinator-test-1 is unhealthy' >&2
      exit 1
    fi
    sleep 0.3
    exit 0 ;;
esac
exit 0
`;

// Shim used in client processes that must never run compose themselves: any
// invocation is recorded and fails loudly, so a client quietly falling back
// to direct compose breaks the test.
const poisonShim = `#!/bin/sh
printf '%s\\n' "$*" >> "$POISON_LOG"
echo "docker must not run in the client process" >&2
exit 99
`;

const composeYml = "services:\n  redis_plain:\n    image: busybox\n  postgres_plain:\n    image: busybox\n";

const ensureFixture = (service: string) => `
  import { ensure } from ${JSON.stringify(join(import.meta.dir, "index.ts"))};
  console.log(JSON.stringify(await ensure(${JSON.stringify(service)})));
`;

type Dir = ReturnType<typeof tempDir>;

function makeDir(service: string): Dir {
  const dir = tempDir("docker-coordinator", {
    // Only has to exist; the shims never read it.
    "docker-compose.yml": composeYml,
    "ensure.fixture.ts": ensureFixture(service),
    "bin": { "docker": dockerShim },
    "poison-bin": { "docker": poisonShim },
  });
  chmodSync(join(String(dir), "bin", "docker"), 0o755);
  chmodSync(join(String(dir), "poison-bin", "docker"), 0o755);
  return dir;
}

// Env shared by the coordinator and direct-compose clients. Explicitly drops
// any BUN_DOCKER_COORDINATOR inherited from a real CI shard's coordinator.
function composeEnv(dir: Dir): Record<string, string | undefined> {
  return {
    ...bunEnv,
    BUN_DOCKER_COORDINATOR: undefined,
    BUN_DOCKER_COMPOSE_FILE: join(String(dir), "docker-compose.yml"),
    BUN_DOCKER_PROJECT_NAME: "coordinator-test",
    BUN_DOCKER_TEST_HOST: "127.0.0.1",
    DOCKER_SHIM_LOG: join(String(dir), "shim.log"),
  };
}

async function readUpInvocations(dir: Dir): Promise<string[]> {
  const log = await Bun.file(join(String(dir), "shim.log")).text();
  return log.split("\n").filter(line => line.includes(" up "));
}

function startCoordinator(dir: Dir, testPaths: string[] = [], env: Record<string, string | undefined> = {}) {
  const proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "coordinator.ts"), ...testPaths],
    env: {
      ...composeEnv(dir),
      PATH: `${join(String(dir), "bin")}:${bunEnv.PATH}`,
      BUN_DOCKER_COORDINATOR_SOCKET: join(String(dir), "coordinator.sock"),
      ...env,
    },
    // The coordinator exits on stdin EOF; keep the pipe open for its lifetime.
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const decoder = new TextDecoder();
  const reader = proc.stdout.getReader();
  let output = "";

  return {
    // Await a marker in the coordinator's stdout, e.g. its ready line or a
    // service becoming healthy.
    async outputContains(marker: string): Promise<void> {
      while (!output.includes(marker)) {
        const { done, value } = await reader.read();
        if (done) {
          const stderr = await proc.stderr.text();
          throw new Error(
            `coordinator exited before printing ${JSON.stringify(marker)}\n--- stdout ---\n${output}\n--- stderr ---\n${stderr}`,
          );
        }
        output += decoder.decode(value, { stream: true });
      }
    },
    async [Symbol.asyncDispose]() {
      proc.kill();
      await proc.exited;
    },
  };
}

function spawnClient(dir: Dir, env: Record<string, string | undefined>) {
  return Bun.spawn({
    cmd: [bunExe(), "ensure.fixture.ts"],
    cwd: String(dir),
    env: {
      ...composeEnv(dir),
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function collect(proc: ReturnType<typeof spawnClient>) {
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.skipIf(isWindows)("coordinator runs one compose up for concurrent clients", async () => {
  using dir = makeDir("redis_plain");
  await using coordinator = startCoordinator(dir);
  await coordinator.outputContains("COORDINATOR_READY");

  // Clients get the poison docker: only the coordinator may run compose, and
  // a client quietly using the direct-compose fallback fails the test.
  const clientEnv = {
    PATH: `${join(String(dir), "poison-bin")}:${bunEnv.PATH}`,
    BUN_DOCKER_COORDINATOR: join(String(dir), "coordinator.sock"),
    POISON_LOG: join(String(dir), "poison.log"),
  };
  await using clientA = spawnClient(dir, clientEnv);
  await using clientB = spawnClient(dir, clientEnv);
  const [a, b] = await Promise.all([collect(clientA), collect(clientB)]);

  const expected = { host: "127.0.0.1", ports: { 6379: 6379 } };
  expect({ a: JSON.parse(a.stdout), b: JSON.parse(b.stdout) }).toEqual({ a: expected, b: expected });
  expect(await readUpInvocations(dir)).toEqual([expect.stringContaining("redis_plain")]);
  expect(await Bun.file(join(String(dir), "poison.log")).exists()).toBe(false);
  expect({ a: a.exitCode, b: b.exitCode }).toEqual({ a: 0, b: 0 });
});

test.skipIf(isWindows)("coordinator prestarts services predicted from test paths", async () => {
  using dir = makeDir("postgres_plain");
  await using coordinator = startCoordinator(dir, ["js/sql/sql.test.ts"]);
  await coordinator.outputContains("postgres_plain ready");

  expect(await readUpInvocations(dir)).toEqual([expect.stringContaining("postgres_plain")]);
});

test.skipIf(isWindows)("coordinator reports compose failures to the client", async () => {
  using dir = makeDir("redis_plain");
  await using coordinator = startCoordinator(dir, [], { DOCKER_SHIM_UP_MODE: "fail" });
  await coordinator.outputContains("COORDINATOR_READY");

  await using client = spawnClient(dir, {
    PATH: `${join(String(dir), "poison-bin")}:${bunEnv.PATH}`,
    BUN_DOCKER_COORDINATOR: join(String(dir), "coordinator.sock"),
    POISON_LOG: join(String(dir), "poison.log"),
  });
  const { stderr, exitCode } = await collect(client);

  expect(stderr).toContain("via coordinator");
  expect(stderr).toContain("is unhealthy");
  // The failure is reported, not retried.
  expect(await readUpInvocations(dir)).toHaveLength(1);
  expect(exitCode).not.toBe(0);
});

test.skipIf(isWindows)("ensure() runs compose directly when no coordinator is configured", async () => {
  using dir = makeDir("redis_plain");
  await using client = spawnClient(dir, {
    PATH: `${join(String(dir), "bin")}:${bunEnv.PATH}`,
  });
  const { stdout, stderr, exitCode } = await collect(client);

  expect(stderr).not.toContain("Failed to start service");
  expect(JSON.parse(stdout)).toEqual({ host: "127.0.0.1", ports: { 6379: 6379 } });
  expect(await readUpInvocations(dir)).toHaveLength(1);
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)("ensure() falls back to direct compose when the coordinator socket is dead", async () => {
  using dir = makeDir("redis_plain");
  await using client = spawnClient(dir, {
    PATH: `${join(String(dir), "bin")}:${bunEnv.PATH}`,
    BUN_DOCKER_COORDINATOR: join(String(dir), "does-not-exist.sock"),
  });
  const { stdout, stderr, exitCode } = await collect(client);

  expect(stderr).not.toContain("Failed to start service");
  expect(JSON.parse(stdout)).toEqual({ host: "127.0.0.1", ports: { 6379: 6379 } });
  expect(await readUpInvocations(dir)).toHaveLength(1);
  expect(exitCode).toBe(0);
});
