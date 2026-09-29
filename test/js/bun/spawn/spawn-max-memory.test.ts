import { subprocessInternals } from "bun:internal-for-testing";
import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, isWindows } from "harness";
import { spawn as cpSpawn, spawnSync as cpSpawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MB = 1024 * 1024;

// Touch every page so the memory is resident, then park.
const hog = (mb: number) =>
  `const b = Buffer.allocUnsafe(${mb} * 1024 * 1024); for (let i = 0; i < b.length; i += 4096) b[i] = 1; globalThis.keep = b; setInterval(() => {}, 1000);`;

// An idle debug build uses far more memory than a release build, so every limit comes from a measured idle size.
let idleBytes = 0;
beforeAll(async () => {
  await using idle = Bun.spawn({
    cmd: [bunExe(), "-e", `console.log("ready"); setInterval(() => {}, 1000);`],
    env: bunEnv,
    stdio: ["ignore", "pipe", "ignore"],
  });
  for await (const chunk of idle.stdout) {
    if (Buffer.from(chunk).includes("ready")) break;
  }
  idleBytes = idle.memoryUsage().current;
  expect(idleBytes).toBeGreaterThan(0);
});

// A limit that a tree of `processes` idle Bun processes stays well below.
const limitFor = (processes: number) => Math.ceil((processes * idleBytes * 1.5) / MB) * MB + 64 * MB;
// A program that goes well over that limit.
const hogFor = (processes: number) => hog(limitFor(processes) / MB + 256);

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

// True when this host lets us create a memory cgroup inside our own, which is when Bun must pick the cgroup route.
function canCreateMemoryCgroup(): boolean {
  if (!isLinux) return false;
  const name = `bun-max-memory-probe-${process.pid}`;
  const candidates: { dir: string; v2: boolean }[] = [];
  for (const line of readFileSync("/proc/self/cgroup", "utf8").split("\n")) {
    const [, controllers, ...rest] = line.split(":");
    if (controllers === undefined) continue;
    const own = rest.join(":").replace(/\/$/, "");
    // v1 lets a populated cgroup have limited children. v2 allows that only in the real root cgroup.
    if (controllers.split(",").includes("memory"))
      candidates.push({ dir: `/sys/fs/cgroup/memory${own}/${name}`, v2: false });
    else if (controllers === "" && own === "") candidates.push({ dir: `/sys/fs/cgroup/${name}`, v2: true });
  }
  let hasSwap = false;
  try {
    hasSwap = readFileSync("/proc/swaps", "utf8").trim().split("\n").length > 1;
  } catch {}
  for (const { dir, v2 } of candidates) {
    try {
      mkdirSync(dir);
    } catch {
      continue;
    }
    try {
      // "r+" never creates a file. On a tmpfs that is not a cgroup mount, the limit files do not exist, as for Bun.
      writeFileSync(join(dir, v2 ? "memory.max" : "memory.limit_in_bytes"), String(1024 * MB), { flag: "r+" });
      // Bun does not use a v1 cgroup that cannot report its OOM kills (before Linux 4.13) or that has the OOM killer off.
      if (!v2) {
        const control = readFileSync(join(dir, "memory.oom_control"), "utf8");
        if (!/^oom_kill /m.test(control) || /^oom_kill_disable 1/m.test(control)) continue;
      }
      try {
        writeFileSync(join(dir, v2 ? "memory.swap.max" : "memory.memsw.limit_in_bytes"), v2 ? "0" : String(1024 * MB), {
          flag: "r+",
        });
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

// On such a host Bun must pick the cgroup route, and the tests that need the sampler must skip.
const hasMemoryCgroup = canCreateMemoryCgroup();

describe("Bun.spawn maxMemory", () => {
  test("the kernel enforces the limit where it can", async () => {
    const idle = [bunExe(), "-e", "setInterval(() => {}, 1000)"];
    await using limited = Bun.spawn({
      cmd: idle,
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      maxMemory: 1024 * MB,
    });
    const expected = isWindows ? "job" : isMacOS ? "sampler" : hasMemoryCgroup ? "cgroup" : "sampler";
    expect(subprocessInternals.memoryLimitRoute(limited)).toBe(expected);

    await using unlimited = Bun.spawn({ cmd: idle, env: bunEnv, stdio: ["ignore", "ignore", "ignore"] });
    expect(subprocessInternals.memoryLimitRoute(unlimited)).toBeUndefined();
  });

  test.concurrent("kills a child that exceeds the limit", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", hogFor(1)],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      maxMemory: limitFor(1),
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
      const child = Bun.spawn({ cmd: [process.execPath, "-e", ${JSON.stringify(hogFor(2))}], stdio: ["ignore", "ignore", "ignore"] });
      console.log(child.pid);
      await child.exited;
      console.log("grandchild exited", child.signalCode ?? child.exitCode);
      setInterval(() => {}, 1000);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", parent],
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit"],
      maxMemory: limitFor(2),
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
      cmd: [bunExe(), "-e", hogFor(1)],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      maxMemory: limitFor(1),
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
      cmd: [bunExe(), "-e", hogFor(1)],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      maxMemory: limitFor(1),
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
    // NaN must not turn the limit off without an error.
    expect(() => Bun.spawn({ cmd: [bunExe(), "-e", "1"], maxMemory: NaN })).toThrow(RangeError);
    // 0, null, undefined and Infinity all mean "no limit".
    for (const maxMemory of [0, null, undefined, Infinity]) {
      const r = Bun.spawnSync({ cmd: [bunExe(), "-e", "1"], env: bunEnv, maxMemory: maxMemory as any });
      expect(r.exitCode).toBe(0);
    }
  });

  test.concurrent("exitedDueToMaxMemory tells a memory kill from a normal exit", async () => {
    await using over = Bun.spawn({
      cmd: [bunExe(), "-e", hogFor(1)],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      maxMemory: limitFor(1),
      killSignal: "SIGKILL",
    });
    await over.exited;
    expect(over.exitedDueToMaxMemory).toBe(true);

    await using under = Bun.spawn({
      cmd: [bunExe(), "-e", "1"],
      env: bunEnv,
      stdio: ["ignore", "ignore", "ignore"],
      maxMemory: 1024 * MB,
    });
    expect(await under.exited).toBe(0);
    expect(under.exitedDueToMaxMemory).toBe(false);
  });

  // On Windows a child dies with its parent through libuv's kill-on-close job, so a descendant is never reparented there.
  (isWindows ? test.skip : test.concurrent)(
    "a descendant whose parent exited is still counted and killed",
    async () => {
      // root sh -> middle sh -> hog. The hog gets the middle pid and allocates only when that sh is no longer its parent.
      const hogSrc = `const middle = Number(process.argv.at(-1)); const timer = setInterval(() => { if (process.ppid !== middle) { clearInterval(timer); ${hogFor(1)} } }, 5);`;
      const middle = `"$0" -e "$1" $$ >/dev/null 2>&1 & echo $!; read _`;
      await using proc = Bun.spawn({
        cmd: ["sh", "-c", `sh -c '${middle}' "$0" "$1"; exec sleep 100000`, bunExe(), hogSrc],
        // The ASAN CI lanes set BUN_FEATURE_FLAG_NO_ORPHANS, which kills the hog the moment its parent sh exits.
        env: { ...bunEnv, BUN_FEATURE_FLAG_NO_ORPHANS: undefined },
        stdio: ["pipe", "pipe", "inherit"],
        maxMemory: limitFor(1),
        killSignal: "SIGKILL",
      });
      let output = "";
      for await (const chunk of proc.stdout) {
        output += Buffer.from(chunk).toString();
        if (output.includes("\n")) break;
      }
      const hogPid = parseInt(output, 10);
      expect(hogPid).toBeGreaterThan(0);
      // This walk records the hog as a member while its parent is still alive.
      expect(proc.memoryUsage().current).toBeGreaterThan(0);

      proc.stdin.write("\n");
      await proc.stdin.flush();
      await proc.exited;
      expect(proc.exitedDueToMaxMemory).toBe(true);
      await gone(hogPid);
    },
  );
  // A Windows job and a Linux cgroup stop every process at once, so only the sampler can miss a late process.
  (isWindows || hasMemoryCgroup ? test.skip : test.concurrent)(
    "a process that starts after the kill is signalled too",
    async () => {
      // Both processes exit when their stdin closes, so nothing outlives a failed run.
      const lateChild = `process.stdin.on("close", () => process.exit(0)).resume();`;
      const rootSrc = `
      process.stdin.on("close", () => process.exit(0)).resume();
      process.on("SIGTERM", () => {
        const late = Bun.spawn({ cmd: [process.execPath, "-e", ${JSON.stringify(lateChild)}], stdio: ["pipe", "ignore", "ignore"] });
        console.log(late.pid);
      });
      ${hogFor(2)}
    `;
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", rootSrc],
        env: bunEnv,
        stdio: ["pipe", "pipe", "inherit"],
        maxMemory: limitFor(2),
        killSignal: "SIGTERM",
      });
      try {
        expect(subprocessInternals.memoryLimitRoute(proc)).toBe("sampler");
        let output = "";
        for await (const chunk of proc.stdout) {
          output += Buffer.from(chunk).toString();
          if (output.includes("\n")) break;
        }
        const latePid = parseInt(output, 10);
        expect(latePid).toBeGreaterThan(0);
        // The root ignores SIGTERM and stays alive. The late child does not, so it dies only if a later sample signals it.
        await gone(latePid);
      } finally {
        proc.kill("SIGKILL");
        await proc.exited;
      }
    },
  );
});

describe("node:child_process maxMemory", () => {
  test.concurrent("a lower-case killSignal still works, with and without maxMemory", async () => {
    for (const maxMemory of [undefined, 1024 * MB]) {
      const child = cpSpawn(bunExe(), ["-e", "setInterval(() => {}, 1000)"], {
        env: bunEnv,
        killSignal: "sigterm",
        maxMemory,
      });
      const { promise, resolve, reject } = Promise.withResolvers<NodeJS.Signals | null>();
      child.on("error", reject);
      child.on("exit", (_, signal) => resolve(signal));
      child.on("spawn", () => child.kill());
      const signal = await promise;
      if (!isWindows) expect(signal).toBe("SIGTERM");
    }
  });

  test.concurrent("spawn kills a child that exceeds the limit", async () => {
    const child = cpSpawn(bunExe(), ["-e", hogFor(1)], {
      env: bunEnv,
      stdio: "ignore",
      maxMemory: limitFor(1),
      killSignal: "SIGKILL",
    });
    const { promise, resolve, reject } = Promise.withResolvers<[number | null, NodeJS.Signals | null]>();
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve([code, signal]));
    const [code, signal] = await promise;
    if (isWindows) expect(code).not.toBe(0);
    else expect(signal).toBe("SIGKILL");
  });

  test("spawnSync reports ENOMEM", () => {
    const result = cpSpawnSync(bunExe(), ["-e", hogFor(1)], {
      env: bunEnv,
      stdio: "ignore",
      maxMemory: limitFor(1),
      killSignal: "SIGKILL",
    });
    expect((result.error as NodeJS.ErrnoException)?.code).toBe("ENOMEM");
  });

  test("an invalid maxMemory throws before anything is spawned", () => {
    for (const maxMemory of [-1, 1.5, NaN, "64"]) {
      expect(() => cpSpawn(bunExe(), ["-e", "1"], { maxMemory: maxMemory as any })).toThrow(
        expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
      );
      expect(() => cpSpawnSync(bunExe(), ["-e", "1"], { maxMemory: maxMemory as any })).toThrow(
        expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
      );
    }
  });
});
