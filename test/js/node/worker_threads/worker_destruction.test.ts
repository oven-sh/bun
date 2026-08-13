import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun } from "harness";
import { join } from "path";

describe("Worker destruction", () => {
  const method = ["Bun.connect", "Bun.listen", "fetch"];
  describe.each(method)("bun when %s is used in a Worker that is terminating", method => {
    test.concurrent("exits cleanly", async () => {
      expect(await bunRun([join(import.meta.dir, "worker_thread_check.ts"), method])).toSpawn();
    });
  });

  // The worker owns a child process whose stdin pipe has a large write in flight that can never
  // complete (the child never reads). Terminating the worker must close that pipe through its owner
  // rather than wait for the write; otherwise the worker thread never finishes and terminate() hangs.
  test.concurrent("terminate() a Worker with a child process and a pending stdin write", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("worker_threads");
        const w = new Worker(\`
          const { parentPort } = require("worker_threads");
          const p = Bun.spawn({ cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"], stdin: "pipe", stdout: "ignore", stderr: "ignore" });
          p.stdin.write(Buffer.alloc(4 << 20));
          p.stdin.flush();
          parentPort.postMessage(p.pid);
        \`, { eval: true });
        w.on("error", e => { console.error(e); process.exit(2); });
        w.on("message", async pid => {
          const code = await w.terminate();
          try { process.kill(pid); } catch {}
          console.log("terminated " + code);
          process.exit(0);
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe("terminated 1");
    expect(exitCode).toBe(0);
  });

  // Bun.TOML.parse parks a private mimalloc heap on the worker thread that outlives the worker's
  // JS; the Transpiler call then uses (and destroys) another one. mimalloc's own thread teardown
  // still has to look at the parked heap's thread state after it has released the thread's
  // heap-slot array, and used to dereference the released array there (debug builds abort with
  // `threadlocal.c: assertion "tls!=NULL"`). The parent joins the thread, so that takes down the
  // whole process before "worker exit" is printed.
  test.concurrent("a Worker that used several allocator heaps exits cleanly", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("worker_threads");
        const w = new Worker(\`
          Bun.TOML.parse("a = 1");
          new Bun.Transpiler().transformSync("export const b = 2;");
        \`, { eval: true });
        w.on("error", e => { console.error(e); process.exit(2); });
        w.on("exit", code => console.log("worker exit " + code));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("worker exit 0\n");
    expect(exitCode).toBe(0);
  });
});
