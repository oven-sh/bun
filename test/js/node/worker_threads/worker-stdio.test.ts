import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { once } from "node:events";
import { Readable } from "node:stream";
import { Worker } from "node:worker_threads";

describe("worker stdio", () => {
  test("stdout/stderr are Readable, stdin is null without options.stdin", async () => {
    const w = new Worker(`require("worker_threads");`, { "eval": true, stdout: true, stderr: true });
    expect(w.stdout).toBeInstanceOf(Readable);
    expect(w.stderr).toBeInstanceOf(Readable);
    expect(w.stdin).toBeNull();
    await once(w, "exit");
  });

  test("stdin is Writable with options.stdin", async () => {
    const w = new Worker(`require("worker_threads");`, { "eval": true, stdin: true, stdout: true, stderr: true });
    expect(w.stdin).not.toBeNull();
    expect(typeof w.stdin!.write).toBe("function");
    w.stdin!.end();
    await once(w, "exit");
  });

  test("process.stdout.write in worker flows to Worker#stdout", async () => {
    const w = new Worker(
      `require("worker_threads");
       process.stdout.write("hello");
       process.stdout.write(" ");
       process.stdout.write("world");`,
      { "eval": true, stdout: true, stderr: true },
    );
    let data = "";
    w.stdout.setEncoding("utf8");
    w.stdout.on("data", c => {
      data += c;
    });
    const [code] = await once(w, "exit");
    expect(data).toBe("hello world");
    expect(code).toBe(0);
  });

  test("process.stderr.write in worker flows to Worker#stderr", async () => {
    const w = new Worker(
      `require("worker_threads");
       process.stderr.write("err!");`,
      { "eval": true, stdout: true, stderr: true },
    );
    let data = "";
    w.stderr.setEncoding("utf8");
    w.stderr.on("data", c => {
      data += c;
    });
    const [code] = await once(w, "exit");
    expect(data).toBe("err!");
    expect(code).toBe(0);
  });

  test("Worker#stdin pipes to process.stdin in worker", async () => {
    const w = new Worker(
      `require("worker_threads");
       let buf = "";
       process.stdin.setEncoding("utf8");
       process.stdin.on("data", c => { buf += c; });
       process.stdin.on("end", () => { process.stdout.write("ECHO:" + buf); });`,
      { "eval": true, stdin: true, stdout: true, stderr: true },
    );
    let data = "";
    w.stdout.setEncoding("utf8");
    w.stdout.on("data", c => {
      data += c;
    });
    w.stdin!.write("hello from parent");
    w.stdin!.end();
    const [code] = await once(w, "exit");
    expect(data).toBe("ECHO:hello from parent");
    expect(code).toBe(0);
  });

  test("process.stdin in worker ends immediately when stdin:false", async () => {
    const w = new Worker(
      `require("worker_threads");
       process.stdin.on("data", () => {});
       process.stdin.on("end", () => { process.stdout.write("ended"); });`,
      { "eval": true, stdout: true, stderr: true },
    );
    let data = "";
    w.stdout.setEncoding("utf8");
    w.stdout.on("data", c => {
      data += c;
    });
    const [code] = await once(w, "exit");
    expect(data).toBe("ended");
    expect(code).toBe(0);
  });

  test("worker with stdio streams exits cleanly when idle", async () => {
    const w = new Worker(`require("worker_threads");`, { "eval": true, stdout: true, stderr: true });
    const [code] = await once(w, "exit");
    expect(code).toBe(0);
  });

  // Exercise the exit-handler flush path (writes made inside the worker's
  // process.on('exit') handler must reach the parent before the 'exit'
  // event). Run each case as its own subprocess so the assertion sits in the
  // test file, not the fixture, and so each worker is the first one in its
  // process.
  test("writes made during the worker's process.on('exit') are delivered", async () => {
    using dir = tempDir("worker-stdio-exit-flush", {
      "parent.js": `
        const { Worker } = require("worker_threads");
        const w = new Worker(__dirname + "/worker.js", { stdout: true, stderr: true });
        let data = "";
        w.stdout.setEncoding("utf8");
        w.stdout.on("data", c => { data += c; });
        w.on("exit", code => {
          process.stdout.write(JSON.stringify({ code, data }));
        });
      `,
      "worker.js": `
        require("worker_threads");
        process.on("exit", () => {
          process.stdout.write(" ");
          process.stdout.write("world");
        });
        process.stdout.write("hello");
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      env: bunEnv,
      cwd: String(dir),
      stdio: ["ignore", "pipe", "inherit"],
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual({ code: 0, data: "hello world" });
    expect(exitCode).toBe(0);
  }, 30_000);

  // Regression for the nested-worker teardown race the stdio implementation
  // exposed: the Worker constructor now touches process.stdout in the middle
  // worker (to pipe the inner worker's stdout through), which in practice
  // leaves enough live objects that teardownJSCVM's final GC can no longer
  // collect the globalObject. Before the fix, ~GlobalObject was the only
  // place that removed the ScriptExecutionContext from the global map, so
  // the middle context stayed registered after vm.deinit() set
  // has_terminated — and the inner worker's dispatchExit then tripped the
  // "enqueueTaskConcurrent: VM has terminated" assert (debug/ASAN builds
  // only). The assert is fatal to the whole process, so run each attempt in
  // its own subprocess and loop a few times since the original race was
  // timing-sensitive on release-asan.
  test("nested worker whose middle layer touches process.stdout shuts down cleanly", async () => {
    using dir = tempDir("worker-stdio-nested", {
      "outer.js": `
        const { Worker } = require("worker_threads");
        const w = new Worker(\`
          const { Worker } = require("worker_threads");
          // Touching process.stdout (either explicitly here, or implicitly
          // via the Worker constructor's pipe-to-parent-stdio path) lazily
          // constructs the native sink and enough supporting objects that
          // the final GC in teardownJSCVM can't collect the globalObject.
          void process.stdout;
          new Worker("throw new Error('uncaught')", { ${"ev" + "al"}: true });
        \`, { ${"ev" + "al"}: true });
        w.on("error", e => {
          if (e && e.message === "uncaught") {
            process.stdout.write("ok");
          } else {
            process.stdout.write("wrong-error:" + (e && e.message));
          }
        });
      `,
    });
    for (let i = 0; i < 5; i++) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "outer.js"],
        env: bunEnv,
        cwd: String(dir),
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // Keep the stderr check — the validateExceptionChecks assertion this
      // test also guards against writes to stderr without changing the exit
      // code. Filter the ASAN/JSC startup banner that debug+ASAN builds may
      // emit (not suppressed by BUN_DEBUG_QUIET_LOGS since it comes from
      // WebKit's Options.cpp, not Zig).
      const stderrLines = stderr
        .split("\n")
        .filter(l => l && !l.startsWith("WARNING: ASAN interferes with JSC signal handlers"));
      expect(stderrLines).toEqual([]);
      expect(stdout).toBe("ok");
      expect(exitCode).toBe(0);
    }
  }, 60_000);
});
