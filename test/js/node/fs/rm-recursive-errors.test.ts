import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";

// A second thread deletes the same tree, from the end of each directory
// listing, while the main thread walks it from the front. The two meet in
// the middle, so the walker sees entries that vanish between `getdents` and
// `unlinkat`, and directories that vanish between `getdents` and `openat`.
const deleter = `
  const fs = require("node:fs");
  const path = require("node:path");
  const { workerData } = require("node:worker_threads");
  const { tree, sab } = workerData;
  const dirs = fs.readdirSync(tree).map(d => path.join(tree, d));
  const files = dirs.flatMap(d => fs.readdirSync(d).map(f => path.join(d, f))).reverse();
  Atomics.wait(new Int32Array(sab), 0, 0);
  for (const f of files) {
    try { fs.unlinkSync(f); } catch {}
  }
  for (const d of dirs.reverse()) {
    try { fs.rmdirSync(d); } catch {}
  }
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
  await Promise.race([online, failed]);
  const flag = new Int32Array(sab);
  Atomics.store(flag, 0, 1);
  Atomics.notify(flag, 0);
  try {
    await Promise.race([run(), failed]);
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
      Atomics.wait(flag, 0, 0);
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
    await Promise.race([online, failed]);
    const flag = new Int32Array(sab);
    Atomics.store(flag, 0, 1);
    Atomics.notify(flag, 0);
    expect(Atomics.wait(flag, 0, 1, 10_000)).not.toBe("timed-out");
    try {
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

// Runs `script` in a bun with a small descriptor limit. The script builds
// `root/a/b/c.txt`, then opens descriptors until EMFILE and frees two: enough
// to open `root` and `a`, not `b`.
async function runWithFewDescriptors(dir: string, script: string) {
  const file = path.join(dir, "script.js");
  fs.writeFileSync(
    file,
    `
    const fs = require("node:fs");
    const path = require("node:path");
    const root = path.join(${JSON.stringify(dir)}, "root");
    fs.mkdirSync(path.join(root, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(root, "a", "b", "c.txt"), "");
    const fds = [];
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
    ${script}
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
  test("the error names the entry that failed", async () => {
    using dir = tempDir("rm-emfile-path", {});
    const result = await runWithFewDescriptors(
      String(dir),
      `
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

  test("maxRetries retries after the descriptors are released", async () => {
    using dir = tempDir("rm-emfile-retry", {});
    const result = await runWithFewDescriptors(
      String(dir),
      `
      setTimeout(() => {
        for (const fd of fds.splice(0, 8)) fs.closeSync(fd);
      }, 10);
      fs.promises.rm(root, { recursive: true, maxRetries: 20, retryDelay: 20 }).then(
        () => console.log(JSON.stringify({ ok: true, exists: fs.existsSync(root) })),
        e => console.log(JSON.stringify({ code: e.code, path: e.path })),
      );
      `,
    );
    expect(result).toEqual({ ok: true, exists: false });
  });

  test("without maxRetries the error is reported at once", async () => {
    using dir = tempDir("rm-emfile-noretry", {});
    const result = await runWithFewDescriptors(
      String(dir),
      `
      fs.promises.rm(root, { recursive: true }).then(
        () => console.log(JSON.stringify({ ok: true })),
        e => console.log(JSON.stringify({ code: e.code, path: e.path })),
      );
      `,
    );
    expect(result).toEqual({ code: "EMFILE", path: path.join(String(dir), "root", "a", "b") });
  });
});
