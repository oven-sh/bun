// isDockerServiceEnabled() in test/harness.ts gates the suites that talk to a
// docker-compose service. ensure() in test/docker/index.ts can provide a
// service from BUN_TEST_SERVICE_<service> or from the shard's coordinator
// socket without any docker, so the gate has to answer yes for those before it
// falls back to isDockerEnabled(), which needs a docker CLI and throws on Linux
// CI when there is none. The fixture runs with a PATH that has no docker on it,
// so every answer that reached the docker probe shows up as false, or as
// "threw" on Linux with CI set.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, mergeWindowEnvs, tempDir } from "harness";
import { join } from "node:path";

describe.concurrent("isDockerServiceEnabled", () => {
  test.each([
    ["outside CI", false, false],
    ["in CI", true, isLinux ? "threw" : false],
  ])("%s, without docker: env override and coordinator win, nothing else does", async (_, ci, dockerProbe) => {
    using emptyPath = tempDir("docker-service-gate", {});
    const env = mergeWindowEnvs([bunEnv, { PATH: String(emptyPath) }]);
    if (ci) {
      env.CI = "1";
    } else {
      delete env.CI;
    }

    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "docker-service-gate.fixture.ts")],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(JSON.parse(stdout), stderr).toEqual({
      unconfigured: dockerProbe,
      override: true,
      emptyOverride: dockerProbe,
      overrideForAnotherService: dockerProbe,
      coordinator: true,
    });
    expect(exitCode).toBe(0);
  });
});
