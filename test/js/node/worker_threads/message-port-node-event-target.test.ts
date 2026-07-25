import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// MessagePort is a NodeEventTarget in node: .on/.addListener/.once share the
// same listener list as addEventListener, so listenerCount/eventNames/
// removeAllListeners/getEventListeners see both, cross-remove works, and
// emit() returns a boolean while passing the raw argument by identity.
//
// Each row of the coherence matrix runs in its own subprocess so that a throw
// in one row cannot mask another, and so row 15 can observe the surface
// without any prior import of node:worker_threads.
describe.concurrent("MessagePort NodeEventTarget", () => {
  // Row 15 first so nothing else in this file can accidentally load
  // node:worker_threads into a shared state that would mask the bug.
  test("surface exists without importing node:worker_threads", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        if (require.cache["node:worker_threads"]) throw new Error("worker_threads preloaded");
        const { port1 } = new MessageChannel();
        const names = ["on","off","once","emit","addListener","removeListener","listenerCount","eventNames","removeAllListeners","setMaxListeners","getMaxListeners"];
        for (const n of names) {
          if (typeof port1[n] !== "function") throw new Error("missing " + n + ": " + typeof port1[n]);
        }
        port1.close();
        process.stdout.write("OK");
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("OK");
    expect(exitCode).toBe(0);
  });

  test("same fn via .on + addEventListener is one listener, invoked once", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1, port2 } = new MessageChannel();
        let n = 0;
        const fn = () => { n++ };
        port1.on("message", fn);
        port1.addEventListener("message", fn);
        port2.postMessage("x");
        setImmediate(() => {
          port1.close();
          process.stdout.write(String(n));
        });
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("1");
    expect(exitCode).toBe(0);
  });

  test("listenerCount counts both .on and addEventListener listeners", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1 } = new MessageChannel();
        port1.on("message", () => {});
        port1.addEventListener("message", () => {});
        process.stdout.write(String(port1.listenerCount("message")));
        port1.close();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("2");
    expect(exitCode).toBe(0);
  });

  test("eventNames reports types registered via addEventListener", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1 } = new MessageChannel();
        port1.addEventListener("foo", () => {});
        process.stdout.write(JSON.stringify(port1.eventNames()));
        port1.close();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe('["foo"]');
    expect(exitCode).toBe(0);
  });

  test("removeEventListener removes a listener added via .on", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1 } = new MessageChannel();
        const fn = () => {};
        port1.on("message", fn);
        port1.removeEventListener("message", fn);
        process.stdout.write(String(port1.listenerCount("message")));
        port1.close();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("0");
    expect(exitCode).toBe(0);
  });

  test("removeAllListeners clears addEventListener listeners too", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1, port2 } = new MessageChannel();
        let n = 0;
        port1.addEventListener("message", () => { n++ });
        port1.on("message", () => { n++ });
        port1.removeAllListeners("message");
        port1.start();
        port2.postMessage("x");
        setImmediate(() => {
          port1.close();
          process.stdout.write(String(n));
        });
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("0");
    expect(exitCode).toBe(0);
  });

  test("emit passes the argument by identity to .on listeners", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1 } = new MessageChannel();
        const payload = { a: 1 };
        let got;
        port1.on("message", v => { got = v });
        port1.emit("message", payload);
        process.stdout.write(String(got === payload));
        port1.close();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("true");
    expect(exitCode).toBe(0);
  });

  test("emit returns a boolean (true when listeners, false otherwise)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1 } = new MessageChannel();
        const r1 = port1.emit("nope", 1);
        port1.on("hit", () => {});
        const r2 = port1.emit("hit", 1);
        process.stdout.write(JSON.stringify([r1, r2]));
        port1.close();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("[false,true]");
    expect(exitCode).toBe(0);
  });

  test("emit with a primitive payload does not throw", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1 } = new MessageChannel();
        let got;
        port1.on("message", v => { got = v });
        port1.emit("message", 1);
        process.stdout.write(String(got));
        port1.close();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("1");
    expect(exitCode).toBe(0);
  });

  test("emit('error', err) passes the error by identity", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1 } = new MessageChannel();
        const err = new Error("boom");
        let got;
        port1.on("error", e => { got = e });
        port1.emit("error", err);
        process.stdout.write(String(got === err));
        port1.close();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("true");
    expect(exitCode).toBe(0);
  });

  test(".once dedupes against .on for the same fn", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1 } = new MessageChannel();
        const fn = () => {};
        port1.on("foo", fn);
        port1.once("foo", fn);
        process.stdout.write(String(port1.listenerCount("foo")));
        port1.close();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("1");
    expect(exitCode).toBe(0);
  });

  test("events.getEventListeners returns the user fn, not a wrapper", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { getEventListeners } = require("node:events");
        const { port1 } = new MessageChannel();
        const fn = () => {};
        port1.on("message", fn);
        const list = getEventListeners(port1, "message");
        process.stdout.write(String(list.length === 1 && list[0] === fn));
        port1.close();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("true");
    expect(exitCode).toBe(0);
  });

  test("addEventListener listeners still receive an Event; .on listeners get the payload", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1, port2 } = new MessageChannel();
        let a, b;
        port1.on("message", v => { a = v });
        port1.addEventListener("message", ev => { b = ev });
        port2.postMessage(42);
        setImmediate(() => {
          port1.close();
          process.stdout.write(JSON.stringify([a, b instanceof MessageEvent, b.data]));
        });
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("[42,true,42]");
    expect(exitCode).toBe(0);
  });

  test("emit with an addEventListener listener delivers an Event with matching data/detail", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1 } = new MessageChannel();
        let msg, custom;
        port1.addEventListener("message", ev => { msg = ev.data });
        port1.addEventListener("foo", ev => { custom = ev.detail });
        port1.emit("message", 7);
        port1.emit("foo", 8);
        process.stdout.write(JSON.stringify([msg, custom]));
        port1.close();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("[7,8]");
    expect(exitCode).toBe(0);
  });

  test(".off removes a listener added via addEventListener", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1 } = new MessageChannel();
        const fn = () => {};
        port1.addEventListener("message", fn);
        port1.off("message", fn);
        process.stdout.write(String(port1.listenerCount("message")));
        port1.close();
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("0");
    expect(exitCode).toBe(0);
  });

  test("removeAllListeners('message') re-buffers instead of dropping", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        require("node:worker_threads");
        const { port1, port2 } = new MessageChannel();
        port1.on("message", () => { throw new Error("should not fire") });
        port1.removeAllListeners("message");
        port2.postMessage("x");
        setImmediate(() => {
          let got;
          port1.on("message", v => { got = v });
          setImmediate(() => {
            process.stdout.write(String(got));
            port1.close();
          });
        });
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("x");
    expect(exitCode).toBe(0);
  });

  // Spawns a worker inside a debug subprocess; give it more than the default 5s.
  test("parentPort.listenerCount / eventNames / removeAllListeners work in a worker", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { Worker } = require("node:worker_threads");
        const w = new Worker(
          "const { parentPort } = require('node:worker_threads');" +
          "const fn = () => {};" +
          "parentPort.on('message', fn);" +
          "const lc = parentPort.listenerCount('message');" +
          "const en = parentPort.eventNames().includes('message');" +
          "parentPort.removeAllListeners('message');" +
          "const after = parentPort.listenerCount('message');" +
          "const ml = parentPort.getMaxListeners();" +
          "parentPort.postMessage([lc, en, after, ml]);",
          { eval: true }
        );
        w.on("message", m => {
          process.stdout.write(JSON.stringify(m));
          w.terminate();
        });
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("[1,true,0,10]");
    expect(exitCode).toBe(0);
  }, 30_000);
});
