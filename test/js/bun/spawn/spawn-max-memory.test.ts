import { subprocessInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows } from "harness";
import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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

// True when this host lets us create a memory cgroup with a swap cap, which is when Bun must pick the cgroup route.
function canCreateMemoryCgroup(): boolean {
  if (!isLinux) return false;
  const name = `bun-max-memory-probe-${process.pid}`;
  const candidates: { dir: string; v2: boolean }[] = [];
  if (existsSync("/sys/fs/cgroup/memory/memory.limit_in_bytes")) {
    candidates.push({ dir: `/sys/fs/cgroup/memory/${name}`, v2: false });
  }
  if (existsSync("/sys/fs/cgroup/cgroup.controllers")) {
    const own = readFileSync("/proc/self/cgroup", "utf8")
      .split("\n")
      .find(l => l.startsWith("0::"))
      ?.slice(3);
    if (own) candidates.push({ dir: join("/sys/fs/cgroup", dirname(own), name), v2: true });
    candidates.push({ dir: `/sys/fs/cgroup/${name}`, v2: true });
  }
  const hasSwap = readFileSync("/proc/swaps", "utf8").trim().split("\n").length > 1;
  for (const { dir, v2 } of candidates) {
    try {
      mkdirSync(dir);
    } catch {
      continue;
    }
    try {
      writeFileSync(join(dir, v2 ? "memory.max" : "memory.limit_in_bytes"), String(1024 * MB));
      try {
        writeFileSync(join(dir, v2 ? "memory.swap.max" : "memory.memsw.limit_in_bytes"), v2 ? "0" : String(1024 * MB));
      } catch {
        if (hasSwap) continue;
      }
      return true;
    } catch {
    } finally {
      try {
        rmdirSync(dir);
      } catch {}
    }
  }
  return false;
}

describe("Bun.spawn maxMemory", () => {
  test("the kernel enforces the limit where it can", async () => {
    const idle = [bunExe(), "-e", "setInterval(() => {}, 1000)"];
    await using limited = Bun.spawn({
      cmd: idle,
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      maxMemory: 1024 * MB,
    });
    const expected = isWindows ? "job" : isMacOS ? "sampler" : canCreateMemoryCgroup() ? "cgroup" : "sampler";
    expect(subprocessInternals.memoryLimitRoute(limited)).toBe(expected);

    await using unlimited = Bun.spawn({ cmd: idle, env: bunEnv, stdio: ["ignore", "ignore", "ignore"] });
    expect(subprocessInternals.memoryLimitRoute(unlimited)).toBeUndefined();
  });

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
