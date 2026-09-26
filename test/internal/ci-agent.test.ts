// scripts/agent.ts starts the Buildkite agent on a CI machine. A job starts the
// moment the agent registers, so the agent first waits for the Docker daemon
// the job's tests use. Here `docker` is a script that records what it is asked.
import { expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { waitForDockerDaemon } from "../../scripts/agent.ts";

/** A `docker` that answers as `answer` (sh) does, in a directory of its own. */
function fakeDocker(answer: string) {
  const dir = tempDir("ci-agent", { docker: `#!/bin/sh\necho "$*" >> "$(dirname "$0")/asked"\n${answer}\n` });
  const docker = join(String(dir), "docker");
  const asked = join(String(dir), "asked");
  chmodSync(docker, 0o755);
  return {
    docker,
    /** The arguments of each call. */
    asked: () => (existsSync(asked) ? readFileSync(asked, "utf8").trimEnd().split("\n") : []),
    [Symbol.dispose]: () => dir[Symbol.dispose](),
  };
}

test.skipIf(isWindows)("the agent waits until the Docker daemon answers", async () => {
  // Like the docker CLI with no daemon, it fails. The daemon is up when it is asked for the third time.
  using fake = fakeDocker(`[ "$(grep -c version "$(dirname "$0")/asked")" -ge 3 ]`);

  expect(await waitForDockerDaemon(fake.docker, 60_000, 1)).toBe(true);
  expect(fake.asked()).toEqual(["version", "version", "version"]);
});

test.skipIf(isWindows)("a daemon that is up is asked once", async () => {
  using fake = fakeDocker("exit 0");

  expect(await waitForDockerDaemon(fake.docker, 60_000, 1)).toBe(true);
  expect(fake.asked()).toEqual(["version"]);
});

test.skipIf(isWindows)("the wait ends without a daemon when its time is used up", async () => {
  using fake = fakeDocker("exit 1");

  expect(await waitForDockerDaemon(fake.docker, 200, 10)).toBe(false);
});

test.skipIf(isWindows)("a question the daemon does not answer ends with the wait", async () => {
  // Like the docker CLI while dockerd has its socket and does not serve yet.
  using fake = fakeDocker("exec sleep 600");

  expect(await waitForDockerDaemon(fake.docker, 200, 10)).toBe(false);
});
