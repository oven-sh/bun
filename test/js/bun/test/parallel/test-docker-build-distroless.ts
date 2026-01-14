import { expect } from "bun:test";
import { bunEnv, dockerExe, isDockerEnabled } from "harness";
import { resolve } from "path";

if (isDockerEnabled()) {
  const docker = dockerExe()!;
  const cwd = resolve(import.meta.dir, "..", "..", "..", "..", "..", "dockerhub", "distroless");
  const proc = Bun.spawn({
    cmd: [docker, "build", "--progress=plain", "--no-cache", "--rm", "."],
    stdio: ["ignore", "inherit", "inherit"],
    cwd,
    env: bunEnv,
  });
  await proc.exited;
  expect(proc.signalCode).toBeNull();
  expect(proc.exitCode).toBe(0);
}
