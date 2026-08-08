import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDir } from "harness";

describe("a Worker cannot mutate process-global state", () => {
  test("process.chdir() and process.umask(mask) throw ERR_WORKER_UNSUPPORTED_OPERATION", async () => {
    using dir = tempDir("worker-process-state", {
      "index.js": `
        const { Worker, isMainThread, parentPort } = require("node:worker_threads");
        if (isMainThread) {
          process.title = "MAIN-TITLE";
          const before = { cwd: process.cwd(), umask: process.umask(), title: process.title };
          const w = new Worker(__filename);
          let result;
          w.on("message", m => { result = m; });
          w.on("error", e => { console.error("WORKER_ERROR:" + (e && e.message)); process.exitCode = 1; });
          w.on("exit", () => {
            const after = { cwd: process.cwd(), umask: process.umask(), title: process.title };
            console.log(JSON.stringify({ worker: result, before, after }));
          });
        } else {
          const r = {};
          const tryIt = (name, fn) => { try { r[name] = { ok: fn() }; } catch (e) { r[name] = { code: e.code, name: e.name }; } };
          tryIt("chdir", () => process.chdir(require("node:os").tmpdir()));
          tryIt("umask_read", () => process.umask());
          tryIt("umask_write", () => process.umask(0o777));
          r.title_before = process.title;
          process.title = "WORKER-TITLE";
          r.title_after = process.title;
          parentPort.postMessage(r);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("WORKER_ERROR");
    const out = JSON.parse(stdout.trim());

    expect(out.worker.chdir).toEqual({ code: "ERR_WORKER_UNSUPPORTED_OPERATION", name: "TypeError" });
    expect(out.worker.umask_write).toEqual({ code: "ERR_WORKER_UNSUPPORTED_OPERATION", name: "TypeError" });
    // umask() with no argument reads the current mask and must still work
    expect(out.worker.umask_read).toEqual({ ok: out.before.umask });

    // worker's title assignment must round-trip locally without touching the
    // process-wide title; it starts at whatever the main thread had set
    expect(out.worker.title_before).toBe("MAIN-TITLE");
    expect(out.worker.title_after).toBe("WORKER-TITLE");

    // main thread state must be completely unchanged
    expect(out.after).toEqual(out.before);
    expect(out.after.title).toBe("MAIN-TITLE");
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isPosix)(
    "process.setuid/setgid/seteuid/setegid/setgroups throw ERR_WORKER_UNSUPPORTED_OPERATION",
    async () => {
      using dir = tempDir("worker-process-setid", {
        "index.js": `
        const { Worker, isMainThread, parentPort } = require("node:worker_threads");
        if (isMainThread) {
          const w = new Worker(__filename);
          w.on("message", m => console.log(JSON.stringify(m)));
          w.on("error", e => { console.error("WORKER_ERROR:" + (e && e.message)); process.exitCode = 1; });
        } else {
          const r = {};
          const tryIt = (name, fn) => { try { fn(); r[name] = { ok: true }; } catch (e) { r[name] = { code: e.code, name: e.name }; } };
          tryIt("setuid", () => process.setuid(process.getuid()));
          tryIt("setgid", () => process.setgid(process.getgid()));
          tryIt("seteuid", () => process.seteuid(process.geteuid()));
          tryIt("setegid", () => process.setegid(process.getegid()));
          tryIt("setgroups", () => process.setgroups(process.getgroups()));
          parentPort.postMessage(r);
        }
      `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).not.toContain("WORKER_ERROR");
      expect(JSON.parse(stdout.trim())).toEqual({
        setuid: { code: "ERR_WORKER_UNSUPPORTED_OPERATION", name: "TypeError" },
        setgid: { code: "ERR_WORKER_UNSUPPORTED_OPERATION", name: "TypeError" },
        seteuid: { code: "ERR_WORKER_UNSUPPORTED_OPERATION", name: "TypeError" },
        setegid: { code: "ERR_WORKER_UNSUPPORTED_OPERATION", name: "TypeError" },
        setgroups: { code: "ERR_WORKER_UNSUPPORTED_OPERATION", name: "TypeError" },
      });
      expect(exitCode).toBe(0);
    },
  );
});
