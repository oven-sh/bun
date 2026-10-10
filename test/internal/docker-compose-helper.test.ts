// test/docker/index.ts starts a service with `docker compose up --pull never`.
// The image of a service comes from `docker compose build` only, which is also
// all that a bake of a CI machine image runs. Without the flag, compose pulls
// the image of a service with no `build:` section: the bake leaves that image
// out, and each test machine then fetches it from a registry.
//
// `docker` is a shell script on PATH here. It answers like compose for such a
// service when its image is not on the machine: `up --pull never` fails with
// the error of the daemon, and `up` without the flag pulls the image and
// starts the service. A shell script does not run as a program on Windows,
// hence the skip.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";

const docker = join(import.meta.dir, "../docker");

const fakeDocker = [
  "#!/bin/sh",
  '[ "$1" = version ] && exit 0',
  '[ "$2" = version ] && exit 0',
  "# docker compose -p <project> -f <file> <subcommand> [options] <service>",
  "shift 5",
  'case "$1" in',
  "  up)",
  '    case " $* " in',
  '      *" --pull never "*)',
  '        echo "Error response from daemon: No such image: redis:7-alpine" >&2',
  "        exit 1 ;;",
  "    esac ;;",
  '  port) echo "0.0.0.0:49153" ;;',
  "esac",
  "",
].join("\n");

test.skipIf(isWindows)("ensure() pulls no image: a service with no `build:` section does not start", async () => {
  using dir = tempDir("docker-compose-helper", { "bin/docker": fakeDocker });
  const bin = join(String(dir), "bin");
  chmodSync(join(bin, "docker"), 0o755);

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import { ensure } from ${JSON.stringify(join(docker, "index.ts"))};
       process.stdout.write(await ensure("squid").then(() => "started", error => error.message));`,
    ],
    env: {
      ...bunEnv,
      PATH: `${bin}:${bunEnv.PATH}`,
      BUN_TEST_SERVICE_squid: undefined,
      BUN_DOCKER_COORDINATOR: undefined,
      BUN_DOCKER_COMPOSE_FILE: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [message, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ message, stderr, exitCode }).toEqual({
    message: expect.stringContaining(
      "Failed to start service squid: Error response from daemon: No such image: redis:7-alpine\n\n" +
        "note: `compose up` runs with `--pull never`. The image of squid has to come from a `build:` section in " +
        `${join(docker, "docker-compose.yml")}.\n`,
    ),
    stderr: expect.any(String),
    exitCode: 0,
  });
});
