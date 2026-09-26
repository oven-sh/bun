/**
 * A CI machine image bake runs test/docker/prepare-ci.ts (the `prefetch` tool
 * of scripts/build/ci-images/spec.ts) to put the Docker image of every test
 * service on the machine. An image that cannot be pulled or built has to end
 * the script with an error, or the bake publishes a machine image without it
 * and every test of that service fails on that image.
 *
 * The script only runs `docker compose`, so `docker` is replaced by a shell
 * script on PATH here: it records the subcommand it was given, answers
 * `config --services` with two services, and fails the subcommand named in
 * FAKE_DOCKER_FAILS. Shell-script fakes don't resolve as executables on
 * Windows, hence the skip.
 *
 * Each run is a fresh process that loads test/docker/index.ts, which takes
 * over 3 seconds in a debug build, hence the timeout.
 */
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "docker", "prepare-ci.ts");

const fakeDocker = [
  "#!/bin/sh",
  "# docker compose -p <project> -f <file> <subcommand> [options]",
  "shift 5",
  'echo "$*" >> "$FAKE_DOCKER_LOG"',
  'if [ "$1" = "$FAKE_DOCKER_FAILS" ]; then',
  '  echo "fake docker: $1 failed" >&2',
  "  exit 1",
  "fi",
  'if [ "$1" = config ]; then',
  "  printf '%s\\n' postgres_plain minio",
  "fi",
  "",
].join("\n");

async function prepareCi(fails: "pull" | "build" | "" = "") {
  using dir = tempDir("docker-prepare-ci", { "bin/docker": fakeDocker, "invocations.log": "" });
  const bin = join(String(dir), "bin");
  const log = join(String(dir), "invocations.log");
  chmodSync(join(bin, "docker"), 0o755);

  await using proc = Bun.spawn({
    cmd: [bunExe(), script],
    env: { ...bunEnv, PATH: `${bin}:${bunEnv.PATH}`, FAKE_DOCKER_LOG: log, FAKE_DOCKER_FAILS: fails },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const invocations = readFileSync(log, "utf8")
    .split("\n")
    .filter(line => line !== "");
  return { invocations, stderr, exitCode };
}

describe.skipIf(isWindows)("test/docker/prepare-ci.ts", () => {
  test.concurrent(
    "pulls the images that no Dockerfile builds, then builds the others one at a time",
    async () => {
      const { invocations, stderr, exitCode } = await prepareCi();
      expect(stderr).toBe("");
      expect({ invocations, exitCode }).toEqual({
        invocations: ["pull --ignore-buildable", "config --services", "build postgres_plain", "build minio"],
        exitCode: 0,
      });
    },
    30_000,
  );

  test.concurrent(
    "fails when an image cannot be pulled",
    async () => {
      const { invocations, stderr, exitCode } = await prepareCi("pull");
      expect(stderr).toContain("Failed to pull images: fake docker: pull failed");
      expect({ invocations, exitCode }).toEqual({ invocations: ["pull --ignore-buildable"], exitCode: 1 });
    },
    30_000,
  );

  test.concurrent(
    "fails when an image cannot be built",
    async () => {
      const { invocations, stderr, exitCode } = await prepareCi("build");
      expect(stderr).toContain("Failed to build service postgres_plain: fake docker: build failed");
      expect({ invocations, exitCode }).toEqual({
        invocations: ["pull --ignore-buildable", "config --services", "build postgres_plain"],
        exitCode: 1,
      });
    },
    30_000,
  );
});
