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
    expect(code).toBe(0);
    expect(data).toBe("hello world");
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
    expect(code).toBe(0);
    expect(data).toBe("err!");
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
    expect(code).toBe(0);
    expect(data).toBe("ECHO:hello from parent");
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
    expect(code).toBe(0);
    expect(data).toBe("ended");
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
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ code: 0, data: "hello world" });
    expect(exitCode).toBe(0);
  });
});
