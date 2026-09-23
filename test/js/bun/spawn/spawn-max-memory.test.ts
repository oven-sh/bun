import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows } from "harness";

const MB = 1024 * 1024;

// Touch every page so the memory is resident, then park.
const hog = (mb: number) =>
  `const b = Buffer.allocUnsafe(${mb} * 1024 * 1024); for (let i = 0; i < b.length; i += 4096) b[i] = 1; globalThis.keep = b; setInterval(() => {}, 1000);`;

// A killed process stays visible as a zombie until its new parent reaps it, so wait for the pid to go away.
async function gone(pid: number) {
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await Bun.sleep(5);
  }
}

describe("Bun.spawn maxMemory", () => {
  test.concurrent("kills a child that exceeds the limit", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", hog(256)],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      maxMemory: 128 * MB,
      killSignal: "SIGKILL",
    });
    await proc.exited;
    if (!isWindows) expect(proc.signalCode).toBe("SIGKILL");
    expect(proc.exitCode === 0).toBe(false);
  });

  test.concurrent("leaves a child under the limit alone", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `Buffer.alloc(8 * 1024 * 1024, 1); console.log("ok")`],
      env: bunEnv,
      stdio: ["ignore", "pipe", "ignore"],
      maxMemory: 1024 * MB,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("ok\n");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });

  test.concurrent("counts and kills grandchildren", async () => {
    // Parent is small; the grandchild is the hog. The limit applies to the tree.
    const parent = `
      const child = Bun.spawn({ cmd: [process.execPath, "-e", ${JSON.stringify(hog(256))}], stdio: ["ignore", "ignore", "ignore"] });
      console.log(child.pid);
      await child.exited;
      console.log("grandchild exited", child.signalCode ?? child.exitCode);
      setInterval(() => {}, 1000);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parent],
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
      maxMemory: 128 * MB,
      killSignal: "SIGKILL",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
    const grandchildPid = parseInt(stdout.split("\n")[0], 10);
    expect(grandchildPid).toBeGreaterThan(0);
    if (!isWindows) expect(proc.signalCode).toBe("SIGKILL");
    // The grandchild must be gone too, not just the direct child. The test times out if it survives.
    await gone(grandchildPid);
  });

  test.concurrent("honors killSignal", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", hog(256)],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      maxMemory: 64 * MB,
      killSignal: "SIGTERM",
    });
    await proc.exited;
    // In a Linux cgroup the kernel does the kill, and it always uses SIGKILL.
    if (isLinux) expect(["SIGTERM", "SIGKILL"]).toContain(proc.signalCode);
    else if (!isWindows) expect(proc.signalCode).toBe("SIGTERM");
  });

  test.concurrent("memoryUsage() reports the tree, with and without maxMemory", async () => {
    for (const maxMemory of [undefined, 2048 * MB]) {
      // The child is small. The grandchild holds 128 MB, so a tree total proves descendants count.
      // The grandchild exits when its stdin closes, which happens when the child dies.
      const grandchild = hog(128) + ` process.stdin.on("close", () => process.exit(0)).resume(); console.log("ready");`;
      const parent = `
        const child = Bun.spawn({ cmd: [process.execPath, "-e", ${JSON.stringify(grandchild)}], stdio: ["pipe", "pipe", "ignore"] });
        for await (const chunk of child.stdout) { if (Buffer.from(chunk).includes("ready")) break; }
        console.log("ready " + child.pid);
        setInterval(() => {}, 1000);
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", parent],
        env: bunEnv,
        stdio: ["ignore", "pipe", "inherit"],
        maxMemory,
      });
      let output = "";
      for await (const chunk of proc.stdout) {
        output += Buffer.from(chunk).toString();
        if (output.includes("\n")) break;
      }
      const grandchildPid = parseInt(output.split(" ")[1], 10);
      expect(grandchildPid).toBeGreaterThan(0);
      const usage = proc.memoryUsage();
      // Windows counts only the root process when there is no Job Object.
      if (!isWindows || maxMemory) expect(usage.current).toBeGreaterThan(128 * MB);
      expect(usage.peak).toBeGreaterThanOrEqual(usage.current);

      proc.kill("SIGKILL");
      await proc.exited;
      const after = proc.memoryUsage();
      expect(after.current).toBe(0);
      expect(after.peak).toBeGreaterThanOrEqual(usage.peak);

      await gone(grandchildPid);
    }
  });

  test("spawnSync reports exitedDueToMaxMemory", () => {
    const over = Bun.spawnSync({
      cmd: [bunExe(), "-e", hog(256)],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      maxMemory: 64 * MB,
      killSignal: "SIGKILL",
    });
    expect(over.exitedDueToMaxMemory).toBe(true);
    expect(over.success).toBe(false);

    const under = Bun.spawnSync({
      cmd: [bunExe(), "-e", "1"],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      maxMemory: 1024 * MB,
    });
    expect(under.exitedDueToMaxMemory).toBe(false);
    expect(under.exitCode).toBe(0);
  });

  test("validates the option", () => {
    expect(() => Bun.spawn({ cmd: [bunExe(), "-e", "1"], maxMemory: -1 })).toThrow(RangeError);
    expect(() => Bun.spawn({ cmd: [bunExe(), "-e", "1"], maxMemory: 1.5 })).toThrow(TypeError);
    // 0, null, undefined and Infinity all mean "no limit".
    for (const maxMemory of [0, null, undefined, Infinity]) {
      const r = Bun.spawnSync({ cmd: [bunExe(), "-e", "1"], env: bunEnv, maxMemory: maxMemory as any });
      expect(r.exitCode).toBe(0);
    }
  });
});
