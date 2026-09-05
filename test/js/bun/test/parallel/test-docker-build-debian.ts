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

    // ca-certificates: https://github.com/oven-sh/bun/issues/33135
    // git:             https://github.com/oven-sh/bun/issues/4687
    // python3:         https://github.com/oven-sh/bun/issues/9807
    const check = Bun.spawn({
      cmd: [
        docker,
        "run",
        "--rm",
        tag,
        "sh",
        "-c",
        "test -s /etc/ssl/certs/ca-certificates.crt && echo HAS_CA_CERTS; " +
          "git --version >/dev/null && echo HAS_GIT; " +
          "python3 --version >/dev/null && echo HAS_PYTHON3",
      ],
      stdio: ["ignore", "pipe", "inherit"],
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([check.stdout.text(), check.exited]);
    expect(stdout.trim().split("\n")).toEqual(["HAS_CA_CERTS", "HAS_GIT", "HAS_PYTHON3"]);
    expect(exitCode).toBe(0);
  } finally {
    Bun.spawnSync({ cmd: [docker, "rmi", "-f", tag], stdio: ["ignore", "ignore", "ignore"], env: bunEnv });
  }
}
