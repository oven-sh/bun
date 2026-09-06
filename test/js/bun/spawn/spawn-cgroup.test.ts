import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { spawn as cpSpawn, spawnSync as cpSpawnSync, execFile, fork } from "node:child_process";
import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Find somewhere we are allowed to create a cgroup with a memory limit, or
// null if this host doesn't let us (not root, read-only cgroupfs, no memory
// controller). v2: a sibling of our own cgroup (children of a populated cgroup
// can't get controllers). v1: directly under the memory hierarchy root.
function setupCgroup(): { dir: string; version: 1 | 2; relative: string; canOOM: boolean } | null {
  if (!isLinux || process.getuid?.() !== 0) return null;
  const name = `bun-spawn-test-${process.pid}`;
  const candidates: { dir: string; version: 1 | 2; relative: string }[] = [];

  if (existsSync("/sys/fs/cgroup/memory/memory.limit_in_bytes")) {
    candidates.push({ dir: `/sys/fs/cgroup/memory/${name}`, version: 1, relative: `/${name}` });
  }
  if (existsSync("/sys/fs/cgroup/cgroup.controllers")) {
    const self = readFileSync("/proc/self/cgroup", "utf8")
      .split("\n")
      .find(l => l.startsWith("0::"))
      ?.slice(3);
    if (self && self !== "/") {
      const parent = dirname(self);
      candidates.push({
        dir: join("/sys/fs/cgroup", parent, name),
        version: 2,
        relative: join(parent, name),
      });
    }
    candidates.push({ dir: `/sys/fs/cgroup/${name}`, version: 2, relative: `/${name}` });
  }

  for (const c of candidates) {
    try {
      mkdirSync(c.dir);
    } catch {
      continue;
    }
    try {
      let swapCapped = true;
      if (c.version === 2) {
        if (!readFileSync(join(c.dir, "cgroup.controllers"), "utf8").includes("memory")) throw 0;
        writeFileSync(join(c.dir, "memory.max"), String(64 * 1024 * 1024));
        try {
          writeFileSync(join(c.dir, "memory.swap.max"), "0");
        } catch {
          swapCapped = false;
        }
      } else {
        writeFileSync(join(c.dir, "memory.limit_in_bytes"), String(64 * 1024 * 1024));
        try {
          writeFileSync(join(c.dir, "memory.memsw.limit_in_bytes"), String(64 * 1024 * 1024));
        } catch {
          swapCapped = false;
        }
      }
      // Without a swap cap the over-limit child gets swapped instead of OOM-killed.
      const hasSwap = readFileSync("/proc/swaps", "utf8").trim().split("\n").length > 1;
      return { ...c, canOOM: swapCapped || !hasSwap };
    } catch {
      try {
        rmdirSync(c.dir);
      } catch {}
    }
  }
  return null;
}

const cg = setupCgroup();

afterAll(() => {
  if (!cg) return;
  for (let i = 0; i < 100 && existsSync(cg.dir); i++) {
    for (const pid of readFileSync(join(cg.dir, "cgroup.procs"), "utf8").split("\n").filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {}
    }
    try {
      rmdirSync(cg.dir);
    } catch {
      Bun.sleepSync(5);
    }
  }
});

function memoryCgroupOf(text: string): string | undefined {
  // v2: "0::/path"; v1: "N:...memory...:/path"
  for (const line of text.trim().split("\n")) {
    const [id, controllers, path] = line.split(":");
    if ((id === "0" && controllers === "") || controllers?.split(",").includes("memory")) return path;
  }
}

describe.skipIf(!cg)("spawn({ cgroup })", () => {
  test("child starts inside the cgroup; parent does not move", async () => {
    const before = readFileSync("/proc/self/cgroup", "utf8");
    await using proc = Bun.spawn({
      cmd: ["cat", "/proc/self/cgroup"],
      cgroup: cg!.dir,
      stdout: "pipe",
      stderr: "inherit",
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(memoryCgroupOf(stdout)).toBe(cg!.relative);
    expect(readFileSync("/proc/self/cgroup", "utf8")).toBe(before);
    expect(memoryCgroupOf(before)).not.toBe(cg!.relative);
    expect(exitCode).toBe(0);
  });

  test("accepts a directory fd, and works with spawnSync", () => {
    const fd = openSync(cg!.dir, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      const result = Bun.spawnSync({
        cmd: ["cat", "/proc/self/cgroup"],
        cgroup: fd,
        env: bunEnv,
      });
      expect(memoryCgroupOf(result.stdout.toString())).toBe(cg!.relative);
      expect(result.exitCode).toBe(0);
    } finally {
      closeSync(fd);
    }
  });

  function oomKills(): number {
    const file = cg!.version === 2 ? "memory.events" : "memory.oom_control";
    return Number(/^oom_kill (\d+)$/m.exec(readFileSync(join(cg!.dir, file), "utf8"))?.[1] ?? 0);
  }

  test.skipIf(!cg?.canOOM)("a child that exceeds the cgroup memory limit is OOM-killed, not the parent", async () => {
    // A small process fits: the limit is not what kills things by itself.
    // (Not bunExe(): a debug build's startup footprint alone can exceed 64 MiB.)
    {
      await using ok = Bun.spawn({ cmd: ["sh", "-c", "echo fits"], cgroup: cg!.dir, stdout: "pipe", env: bunEnv });
      const [stdout, exitCode] = await Promise.all([ok.stdout.text(), ok.exited]);
      expect(stdout).toBe("fits\n");
      expect(exitCode).toBe(0);
    }
    // `tail /dev/zero` buffers an endless "line": a portable unbounded allocator.
    const before = oomKills();
    await using proc = Bun.spawn({
      cmd: ["tail", "/dev/zero"],
      cgroup: cg!.dir,
      stdout: "ignore",
      stderr: "pipe",
      env: bunEnv,
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    // Killed by the cgroup OOM killer, not by malloc failing (that would print "memory exhausted").
    expect(stderr).toBe("");
    expect(proc.signalCode).toBe("SIGKILL");
    expect(oomKills()).toBe(before + 1);
    expect(exitCode).not.toBe(0);
  });

  test("descendants of the child are in the cgroup too", async () => {
    await using proc = Bun.spawn({
      cmd: ["sh", "-c", "cat /proc/self/cgroup; exec sh -c 'cat /proc/self/cgroup'"],
      cgroup: cg!.dir,
      stdout: "pipe",
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    // /proc/self/cgroup has one line per hierarchy; both cats print the same count.
    const perProcess = readFileSync("/proc/self/cgroup", "utf8").trim().split("\n").length;
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(perProcess * 2);
    for (const chunk of [lines.slice(0, perProcess), lines.slice(perProcess)]) {
      expect(memoryCgroupOf(chunk.join("\n"))).toBe(cg!.relative);
    }
    expect(exitCode).toBe(0);
  });
});

// These exercise the option's plumbing without root or a writable cgroupfs: a
// plain directory is not a cgroup2 dir, so CLONE_INTO_CGROUP is refused and the
// child falls back to writing "0" into <dir>/cgroup.procs before exec.
// OHOS: the pre-exec cgroup.procs write is compiled out (bun-spawn.cpp),
// so the fallback path never happens there.
describe.concurrent.skipIf(!isLinux || Bun.env.BUN_OHOS === "1")("spawn({ cgroup }) without cgroupfs", () => {
  test("child writes itself into <dir>/cgroup.procs before exec", async () => {
    using dir = tempDir("spawn-cgroup", { "cgroup.procs": "" });
    await using proc = Bun.spawn({
      cmd: ["cat", join(String(dir), "cgroup.procs")],
      cgroup: String(dir),
      stdout: "pipe",
      env: bunEnv,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    // The write happened before exec, so the exec'd `cat` already sees it.
    expect(stdout).toBe("0");
    expect(readFileSync(join(String(dir), "cgroup.procs"), "utf8")).toBe("0");
    expect(exitCode).toBe(0);
  });

  test("directory fd form, spawnSync", () => {
    using dir = tempDir("spawn-cgroup", { "cgroup.procs": "" });
    const fd = openSync(String(dir), constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      const result = Bun.spawnSync({ cmd: ["true"], cgroup: fd, env: bunEnv });
      expect(readFileSync(join(String(dir), "cgroup.procs"), "utf8")).toBe("0");
      expect(result.exitCode).toBe(0);
    } finally {
      closeSync(fd);
    }
  });

  test("a directory that does not exist fails with ENOENT and its path", () => {
    using dir = tempDir("spawn-cgroup", {});
    const missing = join(String(dir), "does-not-exist");
    expect(() => Bun.spawn({ cmd: ["true"], cgroup: missing })).toThrow(
      expect.objectContaining({ code: "ENOENT", path: missing }),
    );
    expect(() => Bun.spawnSync({ cmd: ["true"], cgroup: missing })).toThrow(
      expect.objectContaining({ code: "ENOENT", path: missing }),
    );
  });

  test("a directory without cgroup.procs fails the spawn and names the cgroup, not argv[0]", () => {
    using dir = tempDir("spawn-cgroup", {});
    let error: any;
    try {
      Bun.spawnSync({ cmd: ["true"], cgroup: String(dir) });
    } catch (e) {
      error = e;
    }
    expect(error?.code).toBe("ENOENT");
    expect(error?.path).toBe(String(dir));
    expect(error?.syscall).not.toBe("posix_spawn");
  });

  test("a frozen cgroup is refused up front instead of hanging the parent", () => {
    using v2 = tempDir("spawn-cgroup", { "cgroup.procs": "", "cgroup.freeze": "1\n" });
    expect(() => Bun.spawnSync({ cmd: ["true"], cgroup: String(v2) })).toThrow(
      expect.objectContaining({ code: "EBUSY", path: String(v2) }),
    );
    // Frozen through an ancestor: own cgroup.freeze is 0, cgroup.events says frozen.
    using v2ancestor = tempDir("spawn-cgroup", {
      "cgroup.procs": "",
      "cgroup.freeze": "0\n",
      "cgroup.events": "populated 1\nfrozen 1\n",
    });
    expect(() => Bun.spawnSync({ cmd: ["true"], cgroup: String(v2ancestor) })).toThrow(
      expect.objectContaining({ code: "EBUSY" }),
    );
    using v1 = tempDir("spawn-cgroup", { "cgroup.procs": "", "freezer.state": "FREEZING\n" });
    expect(() => Bun.spawnSync({ cmd: ["true"], cgroup: String(v1) })).toThrow(
      expect.objectContaining({ code: "EBUSY" }),
    );
    expect(readFileSync(join(String(v1), "cgroup.procs"), "utf8")).toBe("");
  });

  test("rejects invalid values", () => {
    expect(() => Bun.spawn({ cmd: ["true"], cgroup: {} as any })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => Bun.spawn({ cmd: ["true"], cgroup: -1 })).toThrow(
      expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
    );
    expect(() => Bun.spawn({ cmd: ["true"], cgroup: 1.5 })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect(() => Bun.spawn({ cmd: ["true"], cgroup: -1 })).toThrow('The value of "cgroup" is out of range');
    expect(() => Bun.spawn({ cmd: ["true"], cgroup: NaN })).toThrow(
      expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
    );
    expect(() => Bun.spawn({ cmd: ["true"], cgroup: "/sys/fs/cgroup/x\0y" })).toThrow("without null bytes");
  });

  test("node:child_process passes cgroup through (spawn, spawnSync, execFile, fork)", async () => {
    using dir = tempDir("spawn-cgroup", {
      "cgroup.procs": "",
      "child.js": "process.send('hi'); process.disconnect();",
    });
    const procs = join(String(dir), "cgroup.procs");
    const reset = () => writeFileSync(procs, "");

    expect(cpSpawnSync("true", [], { cgroup: String(dir) } as any).status).toBe(0);
    expect(readFileSync(procs, "utf8")).toBe("0");

    reset();
    {
      const { promise, resolve } = Promise.withResolvers<number | null>();
      cpSpawn("true", [], { cgroup: String(dir) } as any).on("close", resolve);
      expect(await promise).toBe(0);
      expect(readFileSync(procs, "utf8")).toBe("0");
    }

    reset();
    {
      const { promise, resolve } = Promise.withResolvers<unknown>();
      execFile("true", [], { cgroup: String(dir) } as any, err => resolve(err));
      expect(await promise).toBeNull();
      expect(readFileSync(procs, "utf8")).toBe("0");
    }

    reset();
    {
      const { promise, resolve, reject } = Promise.withResolvers<unknown>();
      const closed = Promise.withResolvers<unknown>();
      const child = fork(join(String(dir), "child.js"), [], {
        cgroup: String(dir),
        execPath: bunExe(),
        env: bunEnv,
      } as any);
      child.on("message", resolve);
      child.on("error", reject);
      child.on("close", (code, signal) => {
        reject(new Error(`child exited before sending a message: ${code ?? signal}`));
        closed.resolve(code);
      });
      expect(await promise).toBe("hi");
      expect(await closed.promise).toBe(0);
      expect(readFileSync(procs, "utf8")).toBe("0");
    }
  });

  test("null and undefined mean no cgroup", () => {
    expect(Bun.spawnSync({ cmd: ["true"], cgroup: undefined }).exitCode).toBe(0);
    expect(Bun.spawnSync({ cmd: ["true"], cgroup: null as any }).exitCode).toBe(0);
  });
});

test.skipIf(isLinux)("cgroup is ignored on platforms without cgroups", () => {
  const result = Bun.spawnSync({ cmd: [bunExe(), "--version"], cgroup: "/definitely/not/a/cgroup", env: bunEnv });
  expect(result.exitCode).toBe(0);
});
