import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isGlibc, isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";

// A second thread deletes the same tree, from the end of each directory
// listing, while the main thread walks it from the front. The two meet in
// the middle, so the walker sees entries that vanish between `getdents` and
// `unlinkat`, and directories that vanish between `getdents` and `openat`.
// Windows reports an entry that the other thread is deleting with several
// codes, so there the deleter ignores every error.
const deleter = `
  const fs = require("node:fs");
  const path = require("node:path");
  const { parentPort, workerData } = require("node:worker_threads");
  const { tree, sab } = workerData;
  const flag = new Int32Array(sab);
  const dirs = fs.readdirSync(tree).map(d => path.join(tree, d));
  const files = dirs.flatMap(d => fs.readdirSync(d).map(f => path.join(d, f))).reverse();
  // The listing is done: report ready, then wait for the walk to start.
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
  Atomics.wait(flag, 0, 1, 30_000);
  const remove = (fn, target) => {
    try {
      fn(target);
    } catch (e) {
      if (e.code !== "ENOENT" && process.platform !== "win32") throw e;
    }
  };
  for (const f of files) remove(fs.unlinkSync, f);
  for (const d of dirs.reverse()) remove(fs.rmdirSync, d);
  parentPort.postMessage("done");
`;

function makeTree(dir: string) {
  const tree = path.join(dir, "tree");
  fs.mkdirSync(tree);
  for (let d = 0; d < 8; d++) {
    const sub = path.join(tree, "d" + d);
    fs.mkdirSync(sub);
    for (let i = 0; i < 250; i++) fs.writeFileSync(path.join(sub, "f" + i), "");
  }
  return tree;
}

function startWorker(source: string, workerData: object) {
  const worker = new Worker(source, { eval: true, workerData });
  const failed = new Promise<never>((_, reject) => worker.once("error", reject));
  const online = new Promise<void>(resolve => worker.once("online", resolve));
  return { worker, failed, online };
}

async function raceDeleter(tree: string, run: () => Promise<void> | void) {
  const sab = new SharedArrayBuffer(4);
  const { worker, failed, online } = startWorker(deleter, { tree, sab });
  const done = new Promise<void>(resolve => worker.once("message", () => resolve()));
  try {
    await Promise.race([online, failed]);
    const flag = new Int32Array(sab);
    // Start the walk only when the deleter has listed the tree. Without this a
    // slow (debug) build lets the walk finish before the deleter removes anything.
    expect(Atomics.wait(flag, 0, 0, 10_000)).not.toBe("timed-out");
    Atomics.store(flag, 0, 2);
    Atomics.notify(flag, 0);
    await Promise.race([run(), failed]);
    await Promise.race([done, failed]);
  } finally {
    await worker.terminate();
  }
}

describe("fs.rm recursive while another thread deletes the same tree", () => {
  test("rmSync with force removes the whole tree", async () => {
    using dir = tempDir("rm-race-sync", {});
    const tree = makeTree(String(dir));
    await raceDeleter(tree, () => fs.rmSync(tree, { recursive: true, force: true }));
    expect(fs.existsSync(tree)).toBe(false);
  });

  test("rmSync without force does not report a vanished child as ENOENT", async () => {
    using dir = tempDir("rm-race-sync-noforce", {});
    const tree = makeTree(String(dir));
    await raceDeleter(tree, () => fs.rmSync(tree, { recursive: true }));
    expect(fs.existsSync(tree)).toBe(false);
  });

  test("fs.promises.rm removes the whole tree", async () => {
    using dir = tempDir("rm-race-async", {});
    const tree = makeTree(String(dir));
    await raceDeleter(tree, () => fs.promises.rm(tree, { recursive: true, force: true }));
    expect(fs.existsSync(tree)).toBe(false);
  });

  // Two recursive walkers on the same tree, started at the same instant. The
  // one that falls behind in a directory still holds it open when the other
  // removes it, and its next `getdents64` on that directory reports ENOENT.
  // If one walker is stalled until the other has removed the root, it sees a
  // missing root, which `rm` without `force` reports as ENOENT on the root.
  // That is not the bug under test, so a root ENOENT counts as a success.
  test("two rmSync walkers on the same tree both succeed", async () => {
    using dir = tempDir("rm-race-two-walkers", {});
    const tree = makeTree(String(dir));
    const sab = new SharedArrayBuffer(4);
    const { worker, failed, online } = startWorker(
      `
      const fs = require("node:fs");
      const { parentPort, workerData } = require("node:worker_threads");
      const flag = new Int32Array(workerData.sab);
      Atomics.wait(flag, 0, 0, 30_000);
      Atomics.store(flag, 0, 2);
      Atomics.notify(flag, 0);
      try {
        fs.rmSync(workerData.tree, { recursive: true });
        parentPort.postMessage("ok");
      } catch (e) {
        parentPort.postMessage(e.code + " " + e.path);
      }
      `,
      { tree, sab },
    );
    const workerResult = new Promise<string>(resolve => worker.once("message", resolve));
    try {
      await Promise.race([online, failed]);
      const flag = new Int32Array(sab);
      Atomics.store(flag, 0, 1);
      Atomics.notify(flag, 0);
      expect(Atomics.wait(flag, 0, 1, 10_000)).not.toBe("timed-out");
      let main = "ok";
      try {
        fs.rmSync(tree, { recursive: true });
      } catch (e: any) {
        main = e.code + " " + e.path;
      }
      const results = [main, await Promise.race([workerResult, failed])];
      expect(results.filter(r => r !== "ok" && r !== `ENOENT ${tree}`)).toEqual([]);
      expect(results).toContain("ok");
      expect(fs.existsSync(tree)).toBe(false);
    } finally {
      await worker.terminate();
    }
  });
});

// Runs `script` in a bun with a small descriptor limit. After
// `exhaustDescriptors()` two descriptors are free: enough for a walk to open
// two nested directories, not a third.
async function runWithFewDescriptors(dir: string, script: string) {
  const file = path.join(dir, "script-fixture.js");
  fs.writeFileSync(
    file,
    `
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const { Worker } = require("node:worker_threads");
    const base = ${JSON.stringify(dir)};

    // <name>/a/b/c.txt: a walk holds <name> and a open when it needs b.
    function makeTree(name) {
      const root = path.join(base, name);
      fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
      fs.writeFileSync(path.join(root, "a", "b", "c.txt"), "");
      return root;
    }

    // The same tree with files beside b. A walk removes the entries of a in
    // listing order, so when b is not listed first, an attempt that fails at
    // b has removed \`marker\` before.
    function makeMarkedTree(name) {
      for (let i = 0; ; i++) {
        const root = path.join(base, name + "-" + i);
        const a = path.join(root, "a");
        fs.mkdirSync(a, { recursive: true });
        const makeFiles = () => {
          for (let k = 0; k < 4; k++) fs.writeFileSync(path.join(a, "m" + i + "-" + k), "");
        };
        if (i % 2) makeFiles();
        fs.mkdirSync(path.join(a, "b"));
        fs.writeFileSync(path.join(a, "b", "c.txt"), "");
        if (!(i % 2)) makeFiles();
        const first = fs.readdirSync(a)[0];
        if (first !== "b") return { root, marker: path.join(a, first), leaf: path.join(a, "b", "c.txt") };
        if (i === 15) throw new Error("b is listed first in every layout");
      }
    }

    const fds = [];
    function exhaustDescriptors() {
      for (;;) {
        try {
          fds.push(fs.openSync(__filename, "r"));
        } catch (e) {
          if (e.code !== "EMFILE") throw e;
          break;
        }
      }
      fs.closeSync(fds.pop());
      fs.closeSync(fds.pop());
    }

    (async () => {
      ${script}
    })();
    `,
  );
  await using proc = Bun.spawn({
    cmd: ["sh", "-c", `ulimit -n 64 && exec "$0" "$1"`, bunExe(), file],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

describe.skipIf(isWindows)("fs.rm recursive under EMFILE", () => {
  test.concurrent("the error names the entry that failed", async () => {
    using dir = tempDir("rm-emfile-path", {});
    const result = await runWithFewDescriptors(
      String(dir),
      `
      const root = makeTree("root");
      exhaustDescriptors();
      try {
        fs.rmSync(root, { recursive: true });
        console.log(JSON.stringify({ ok: true }));
      } catch (e) {
        console.log(JSON.stringify({ code: e.code, syscall: e.syscall, path: e.path }));
      }
      `,
    );
    expect(result).toEqual({
      code: "EMFILE",
      syscall: "rm",
      path: path.join(String(dir), "root", "a", "b"),
    });
  });

  test.concurrent("without maxRetries the error is reported at once", async () => {
    using dir = tempDir("rm-emfile-noretry", {});
    const result = await runWithFewDescriptors(
      String(dir),
      `
      const root = makeTree("root");
      exhaustDescriptors();
      try {
        await fs.promises.rm(root, { recursive: true });
        console.log(JSON.stringify({ ok: true }));
      } catch (e) {
        console.log(JSON.stringify({ code: e.code, path: e.path }));
      }
      `,
    );
    expect(result).toEqual({ code: "EMFILE", path: path.join(String(dir), "root", "a", "b") });
  });

  // Both retry tests free descriptors only when an attempt has failed: the
  // marker is gone (the attempt holds both free descriptors and cannot open
  // b), then a descriptor can be opened again (the attempt gave them back)
  // while c.txt is still there. So a removed tree proves a later attempt.
  test.concurrent("fs.promises.rm with maxRetries tries again after a failed attempt", async () => {
    using dir = tempDir("rm-emfile-retry", {});
    const result = await runWithFewDescriptors(
      String(dir),
      `
      const { root, marker, leaf } = makeMarkedTree("retry");
      exhaustDescriptors();
      let settled = false;
      const rm = fs.promises.rm(root, { recursive: true, maxRetries: 50, retryDelay: 10 });
      rm.then(() => (settled = true), () => (settled = true));
      const tick = () => new Promise(resolve => setImmediate(resolve));
      while (fs.existsSync(marker) && !settled) await tick();
      for (;;) {
        try {
          fs.closeSync(fs.openSync(__filename, "r"));
          break;
        } catch (e) {
          if (e.code !== "EMFILE") throw e;
          await tick();
        }
      }
      const failedAttempt = fs.existsSync(leaf);
      for (const fd of fds.splice(0, 8)) fs.closeSync(fd);
      try {
        await rm;
        console.log(JSON.stringify({ ok: true, failedAttempt, exists: fs.existsSync(root) }));
      } catch (e) {
        console.log(JSON.stringify({ code: e.code, path: e.path, failedAttempt }));
      }
      `,
    );
    expect(result).toEqual({ ok: true, failedAttempt: true, exists: false });
  });

  // rmSync blocks the main thread between attempts, so a worker frees the
  // descriptors. It shares the descriptor table of the process.
  test.concurrent("fs.rmSync with maxRetries tries again after a failed attempt", async () => {
    using dir = tempDir("rm-emfile-retry-sync", {});
    const result = await runWithFewDescriptors(
      String(dir),
      `
      const { root, marker, leaf } = makeMarkedTree("retry-sync");
      // [0] go, [1] never changes (a cell to sleep on), [2] outcome, [3..] descriptors to free
      const shared = new Int32Array(new SharedArrayBuffer(4 * 11));
      const worker = new Worker(
        \`
        const fs = require("node:fs");
        const { shared, marker, leaf, file } = require("node:worker_threads").workerData;
        Atomics.wait(shared, 0, 0, 30_000);
        const nap = () => Atomics.wait(shared, 1, 0, 1);
        while (fs.existsSync(marker)) nap();
        for (;;) {
          try {
            fs.closeSync(fs.openSync(file, "r"));
            break;
          } catch (e) {
            if (e.code !== "EMFILE") throw e;
            nap();
          }
        }
        Atomics.store(shared, 2, fs.existsSync(leaf) ? 1 : 2);
        for (let i = 3; i < shared.length; i++) fs.closeSync(shared[i]);
        \`,
        { eval: true, workerData: { shared, marker, leaf, file: __filename } },
      );
      let workerError;
      worker.on("error", e => (workerError = String(e)));
      await new Promise(resolve => worker.once("online", resolve));
      exhaustDescriptors();
      for (let i = 3; i < shared.length; i++) shared[i] = fds.pop();
      Atomics.store(shared, 0, 1);
      Atomics.notify(shared, 0);
      let result;
      try {
        fs.rmSync(root, { recursive: true, maxRetries: 50, retryDelay: 10 });
        result = { ok: true };
      } catch (e) {
        result = { code: e.code, path: e.path };
      }
      await worker.terminate();
      console.log(
        JSON.stringify({ ...result, workerError, failedAttempt: Atomics.load(shared, 2) === 1, exists: fs.existsSync(root) }),
      );
      `,
    );
    expect(result).toEqual({ ok: true, failedAttempt: true, exists: false });
  });

  // More retrying calls than the work pool has threads. Their delays run on
  // timers, so an unrelated call still gets a thread at once: it settles
  // before any of them gives up.
  test.concurrent("a retry delay of fs.promises.rm does not hold a work-pool thread", async () => {
    using dir = tempDir("rm-emfile-pool", {});
    const result = await runWithFewDescriptors(
      String(dir),
      `
      const trees = [];
      for (let i = 0; i < os.availableParallelism() * 2 + 4; i++) trees.push(makeTree("pool-" + i));
      exhaustDescriptors();
      let first;
      const rms = trees.map(tree =>
        fs.promises.rm(tree, { recursive: true, maxRetries: 2, retryDelay: 300 }).then(
          () => ((first ??= "rm"), "ok"),
          e => ((first ??= "rm"), e.code),
        ),
      );
      await fs.promises.stat(__filename);
      first ??= "stat";
      console.log(JSON.stringify({ first, codes: [...new Set(await Promise.all(rms))] }));
      `,
    );
    expect(result).toEqual({ first: "stat", codes: ["EMFILE"] });
  });
});

// A directory can list an entry under a name that does not resolve to it (an
// unpaired surrogate on NTFS, a lossy iocharset on vfat). The unlink of that
// name reports ENOENT like a vanished entry does, but the directory never
// gets empty. LD_PRELOAD a shim that lists "real.txt" as "geal.txt". bun
// issues getdents64 through libc's syscall(), the interposable symbol, so
// this is glibc-only.
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
test.skipIf(!isGlibc || !cc)("fs.rm recursive reports ENOTEMPTY for an entry it cannot remove by name", async () => {
  using dir = tempDir("rm-unresolvable-entry", {
    "shim.c": `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdarg.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

static long (*next_syscall)(long, ...);

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (!next_syscall) next_syscall = dlsym(RTLD_NEXT, "syscall");
  long rc = next_syscall(nr, a1, a2, a3, a4, a5, a6);
  if (nr == SYS_getdents64 && rc > 0) {
    // struct linux_dirent64 { u64 d_ino; s64 d_off; u16 d_reclen; u8 d_type; char d_name[]; }
    char *buf = (char *)a2;
    for (long pos = 0; pos < rc;) {
      unsigned short reclen;
      memcpy(&reclen, buf + pos + 16, sizeof reclen);
      char *name = buf + pos + 19;
      if (strcmp(name, "real.txt") == 0) name[0] = 'g';
      pos += reclen;
    }
  }
  return rc;
}
`,
    "child-fixture.js": `
const fs = require("node:fs");
const path = require("node:path");

// <root>/d1/.../d<depth>/ghost/real.txt
function makeTree(root, depth) {
  let dir = root;
  for (let i = 1; i <= depth; i++) dir = path.join(dir, "d" + i);
  dir = path.join(dir, "ghost");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "real.txt"), "");
  return dir;
}
async function attempt(fn) {
  try {
    await fn();
    return "removed";
  } catch (e) {
    return { code: e.code, syscall: e.syscall, path: e.path };
  }
}

(async () => {
  const kept = [makeTree("sync", 0), makeTree("async", 0), makeTree("deep", 20)];
  console.log(
    JSON.stringify({
      sync: await attempt(() => fs.rmSync("sync", { recursive: true })),
      async: await attempt(() => fs.promises.rm("async", { recursive: true, force: true })),
      // Past 16 levels a second walker takes over. It names the directory where it started.
      deep: await attempt(() => fs.rmSync("deep", { recursive: true })),
      kept: kept.map(ghost => fs.existsSync(path.join(ghost, "real.txt"))),
    }),
  );
})();
`,
  });

  const soPath = path.join(String(dir), "shim.so");
  const compile = Bun.spawnSync({
    cmd: [cc!, "-shared", "-fPIC", "-o", soPath, path.join(String(dir), "shim.c"), "-ldl"],
    env: bunEnv,
  });
  if (compile.exitCode !== 0) {
    throw new Error(`Failed to build getdents64 rename shim:\n${compile.stderr.toString()}`);
  }

  const existing = bunEnv.LD_PRELOAD;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "child-fixture.js"],
    env: { ...bunEnv, LD_PRELOAD: existing ? `${soPath}:${existing}` : soPath },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");

  const deepStart = path.join("deep", ...Array.from({ length: 15 }, (_, i) => "d" + (i + 1)));
  expect(JSON.parse(stdout)).toEqual({
    sync: { code: "ENOTEMPTY", syscall: "rm", path: path.join("sync", "ghost") },
    async: { code: "ENOTEMPTY", syscall: "rm", path: path.join("async", "ghost") },
    deep: { code: "ENOTEMPTY", syscall: "rm", path: deepStart },
    kept: [true, true, true],
  });
  expect(exitCode).toBe(0);
});
