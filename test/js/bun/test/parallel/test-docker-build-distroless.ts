import { expect } from "bun:test";
import { bunEnv, dockerExe, isDockerEnabled, tempDir } from "harness";
import { resolve } from "path";

if (isDockerEnabled()) {
  const docker = dockerExe()!;
  const cwd = resolve(import.meta.dir, "..", "..", "..", "..", "..", "dockerhub", "distroless");

  // Tag the built image so we can run it below to verify libgcc_s.so.1 is
  // available for worker_threads termination (regression test for #31281).
  const tag = `bun-distroless-${process.pid}-${Date.now()}`;
  const buildProc = Bun.spawn({
    cmd: [docker, "build", "--progress=plain", "--no-cache", "--rm", "-t", tag, "."],
    stdio: ["ignore", "inherit", "inherit"],
    cwd,
    env: bunEnv,
  });
  await buildProc.exited;
  expect(buildProc.signalCode).toBeNull();
  expect(buildProc.exitCode).toBe(0);

  try {
    // Worker.terminate() triggers pthread_cancel inside glibc, which dlopens
    // libgcc_s.so.1 for stack unwinding. Without it distroless prints
    // "libgcc_s.so.1 must be installed for pthread_exit to work" to stderr.
    using dir = tempDir("bun-distroless-worker", {
      "main.js": `
        import { Worker } from "node:worker_threads";
        const worker = new Worker(new URL("./worker.js", import.meta.url));
        await new Promise(r => worker.on("online", r));
        await worker.terminate();
        console.log("worker-terminated");
        process.exit(0);
      `,
      "worker.js": `setInterval(() => {}, 1000);`,
    });

    await using runProc = Bun.spawn({
      cmd: [docker, "run", "--rm", "-v", `${String(dir)}:/app`, "-w", "/app", tag, "run", "main.js"],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      runProc.stdout.text(),
      runProc.stderr.text(),
      runProc.exited,
    ]);

    expect(stderr).not.toContain("libgcc_s.so.1");
    expect(stdout).toContain("worker-terminated");
    expect(exitCode).toBe(0);
  } finally {
    // Best-effort cleanup — don't fail the test on rmi errors.
    Bun.spawnSync({ cmd: [docker, "rmi", "-f", tag], stdio: ["ignore", "ignore", "ignore"], env: bunEnv });
  }
}
