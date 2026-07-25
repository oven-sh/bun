import { expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { bunEnv, dockerExe, isDockerEnabled } from "harness";
import { resolve } from "path";

if (isDockerEnabled()) {
  const docker = dockerExe()!;
  const cwd = resolve(import.meta.dir, "..", "..", "..", "..", "..", "dockerhub", "debian");
  const tag = `bun-docker-build-debian-${randomUUID()}`;

  try {
    const build = Bun.spawn({
      cmd: [docker, "build", "--progress=plain", "--no-cache", "--rm", "-t", tag, "."],
      stdio: ["ignore", "inherit", "inherit"],
      cwd,
      env: bunEnv,
    });
    await build.exited;
    expect(build.signalCode).toBeNull();
    expect(build.exitCode).toBe(0);

    // https://github.com/oven-sh/bun/issues/33135
    const check = Bun.spawn({
      cmd: [docker, "run", "--rm", tag, "sh", "-c", "test -s /etc/ssl/certs/ca-certificates.crt && echo HAS_CA_CERTS"],
      stdio: ["ignore", "pipe", "inherit"],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([check.stdout.text(), check.exited]);
    expect(stdout.trim()).toBe("HAS_CA_CERTS");
    expect(exitCode).toBe(0);
  } finally {
    Bun.spawnSync({ cmd: [docker, "rmi", "-f", tag], stdio: ["ignore", "ignore", "ignore"], env: bunEnv });
  }
}
