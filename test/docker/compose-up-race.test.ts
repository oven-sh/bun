import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

// `docker compose up` is not safe to run concurrently for one project: two
// invocations can race to create the same container, and the loser exits with
// "Conflict. The container name ... is already in use". In CI the background
// warmup (test/docker/warmup-ci.ts) and the first docker-using test's
// ensure() hit this, as can Buildkite shards sharing a host daemon.
// index.ts retries `up` on that failure signature; these tests drive the
// retry deterministically by shimming `docker` with a script, so no daemon is
// required. Windows is skipped because the shim is a POSIX sh script (docker
// service tests only run on Linux CI anyway).

function dockerShim(upBehavior: string): string {
  return `#!/bin/sh
set -eu
printf '%s\n' "$*" >> "$DOCKER_SHIM_LOG"
# capability probes: \`docker version\` / \`docker compose version\`
if [ "$1" = "version" ]; then exit 0; fi
if [ "$2" = "version" ]; then exit 0; fi
# everything else: compose -p <project> -f <file> <verb> ...
case "$6" in
  build | ps | logs) exit 0 ;;
  port) echo "0.0.0.0:6379"; exit 0 ;;
  up)
${upBehavior}
    ;;
esac
exit 0
`;
}

// `up` invocations 1..n lose the create race exactly like the observed CI
// failure; later invocations succeed.
function loseCreateRace(times: number): string {
  return `    if [ "$(grep -c -- ' up ' "$DOCKER_SHIM_LOG")" -le ${times} ]; then
      echo 'Error response from daemon: Conflict. The container name "/bun-test-services-redis_plain-1" is already in use by container "deadbeef". You have to remove (or rename) that container to be able to reuse that name.' >&2
      exit 1
    fi
    exit 0`;
}

// Genuine startup failure, not a create race.
const alwaysUnhealthy = `    echo 'container bun-test-services-redis_plain-1 is unhealthy' >&2
    exit 1`;

async function runEnsure(upBehavior: string) {
  using dir = tempDir("compose-up-race", {
    // Only has to exist; the shim never reads it.
    "docker-compose.yml": "services:\n  redis_plain:\n    image: busybox\n",
    "ensure.fixture.ts": `
      import { ensure } from ${JSON.stringify(join(import.meta.dir, "index.ts"))};
      console.log(JSON.stringify(await ensure("redis_plain")));
    `,
    "bin": {
      "docker": dockerShim(upBehavior),
    },
  });
  chmodSync(join(String(dir), "bin", "docker"), 0o755);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "ensure.fixture.ts"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      PATH: `${join(String(dir), "bin")}:${bunEnv.PATH}`,
      BUN_DOCKER_COMPOSE_FILE: join(String(dir), "docker-compose.yml"),
      BUN_DOCKER_PROJECT_NAME: "compose-up-race-test",
      BUN_DOCKER_TEST_HOST: "127.0.0.1",
      DOCKER_SHIM_LOG: join(String(dir), "shim.log"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const log = await Bun.file(join(String(dir), "shim.log")).text();
  const upCount = log.split("\n").filter(line => line.includes(" up ")).length;
  return { stdout, stderr, exitCode, upCount };
}

test.skipIf(isWindows)("ensure() retries `compose up` after losing a container create race", async () => {
  const { stdout, stderr, exitCode, upCount } = await runEnsure(loseCreateRace(1));
  expect(stderr).not.toContain("Failed to start service");
  expect(JSON.parse(stdout)).toEqual({ host: "127.0.0.1", ports: { 6379: 6379 } });
  expect(upCount).toBe(2);
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)("ensure() retries `compose up` a second time if the race repeats", async () => {
  const { stdout, stderr, exitCode, upCount } = await runEnsure(loseCreateRace(2));
  expect(stderr).not.toContain("Failed to start service");
  expect(JSON.parse(stdout)).toEqual({ host: "127.0.0.1", ports: { 6379: 6379 } });
  expect(upCount).toBe(3);
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)("ensure() stops retrying `compose up` after three conflicted attempts", async () => {
  const { stderr, exitCode, upCount } = await runEnsure(loseCreateRace(1000));
  expect(stderr).toContain("already in use");
  expect(upCount).toBe(3);
  expect(exitCode).not.toBe(0);
});

test.skipIf(isWindows)("ensure() reports non-race `compose up` failures without retrying", async () => {
  const { stderr, exitCode, upCount } = await runEnsure(alwaysUnhealthy);
  expect(stderr).toContain("is unhealthy");
  expect(upCount).toBe(1);
  expect(exitCode).not.toBe(0);
});
