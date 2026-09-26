import { $ } from "bun";
import { bunEnv, bunExe, tempDir } from "harness";
import { ChildProcess, fork, spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";

test("child_process ipc", async () => {
  const output = await $`${bunExe()} ${import.meta.dir}/fixtures/ipc_fixture.js`.text();
  // node (v23.4.0) has identical output
  expect(output).toMatchInlineSnapshot(`
    "Parent received: {"status":"Child process started"}
    Child process exited with code 0
    send returned false
    uncaughtException ERR_IPC_CHANNEL_CLOSED
    cb ERR_IPC_CHANNEL_CLOSED
    "
  `);
});

// The channel is not read while there is no 'message' listener, so the messages wait in the kernel buffer.
describe.concurrent("a 'message' that arrives while there is no 'message' listener is not lost", () => {
  // A child that exits before the body is done fails the test at once, with its exit status.
  async function withChild(child, body) {
    const { promise: exited, reject } = Promise.withResolvers();
    child.once("exit", (code, signal) => reject(new Error(`the child exited too early: ${code} ${signal}`)));
    try {
      return await Promise.race([body(), exited]);
    } finally {
      if (child.connected) child.disconnect();
      child.kill();
    }
  }
  const stdoutLines = child => createInterface({ input: child.stdout })[Symbol.asyncIterator]();

  // "pong" answers a message that the parent sends once its listener is added, so it arrives after the three.
  const burstThenPong = `
    for (let i = 0; i < 3; i++) process.send({ i });
    console.log("sent");
    process.on("message", () => process.send("pong"));
  `;
  const untilPong = (child, got = []) => {
    const { promise, resolve } = Promise.withResolvers();
    child.on("message", m => got.push(m) && m === "pong" && resolve(got));
    child.send("ping");
    return promise;
  };

  test.each(["json", "advanced"])("parent: first listener added late (%s)", async serialization => {
    using dir = tempDir("ipc-late-parent", { "child.js": burstThenPong });
    const child = fork(path.join(String(dir), "child.js"), {
      env: bunEnv,
      serialization,
      stdio: ["ignore", "pipe", "inherit", "ipc"],
    });
    await withChild(child, async () => {
      expect((await stdoutLines(child).next()).value).toBe("sent");
      expect(await untilPong(child)).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }, "pong"]);
    });
  });

  test("parent: last listener removed, next one added late", async () => {
    using dir = tempDir("ipc-readd-parent", {
      "child.js": `process.once("message", () => { ${burstThenPong} });`,
    });
    const child = fork(path.join(String(dir), "child.js"), {
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit", "ipc"],
    });
    await withChild(child, async () => {
      const got = [];
      child.on("message", function first(m) {
        got.push(["first", m]);
        child.off("message", first);
      });
      child.send("burst");
      expect((await stdoutLines(child).next()).value).toBe("sent");
      expect(await untilPong(child, got)).toEqual([["first", { i: 0 }], { i: 1 }, { i: 2 }, "pong"]);
    });
  });

  test("parent: listener added before spawn()", async () => {
    const child = new ChildProcess();
    const message = once(child, "message");
    child.spawn({
      file: bunExe(),
      args: [bunExe(), "-e", `process.send("hello")`],
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    await withChild(child, async () => expect((await message)[0]).toBe("hello"));
  });

  // The child reports that it is ready on an extra pipe, after it sent its messages.
  test("parent: listener added once the child reports ready on an extra stdio pipe", async () => {
    const script = `
      process.send({ early: 1 });
      process.send({ early: 2 });
      require("fs").writeSync(3, "R");
      process.on("message", () => process.send("pong"));
    `;
    const child = spawn(bunExe(), ["-e", script], {
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit", "pipe", "ipc"],
    });
    await withChild(child, async () => {
      await once(child.stdio[3], "data");
      expect(await untilPong(child)).toEqual([{ early: 1 }, { early: 2 }, "pong"]);
    });
  });

  // The three messages are in the kernel buffer before the child starts, so one read gets them all.
  test("child: last listener removed, next one added late", async () => {
    using dir = tempDir("ipc-readd-child", {
      "child.js": `
        const got = [];
        process.on("message", function first(m) {
          got.push(["first", m]);
          process.off("message", first);
          setImmediate(() => {
            process.on("message", m => (m === "report" ? process.send(got) : got.push(["second", m])));
            process.send("attached");
          });
        });
      `,
    });
    const child = fork(path.join(String(dir), "child.js"), { env: bunEnv });
    await withChild(child, async () => {
      for (let i = 0; i < 3; i++) child.send({ i });
      expect((await once(child, "message"))[0]).toBe("attached");
      child.send("report");
      expect((await once(child, "message"))[0]).toEqual([
        ["first", { i: 0 }],
        ["second", { i: 1 }],
        ["second", { i: 2 }],
      ]);
    });
  });

  test("child: process.send() opens the channel before the first listener is added", async () => {
    using dir = tempDir("ipc-send-first-child", {
      "child.js": `
        process.send("ready");
        process.stdin.once("data", () => {
          const got = [];
          process.on("message", m => (m === "report" ? process.send(got) : got.push(m)));
          process.send("attached");
        });
      `,
    });
    const child = fork(path.join(String(dir), "child.js"), {
      env: bunEnv,
      stdio: ["pipe", "inherit", "inherit", "ipc"],
    });
    await withChild(child, async () => {
      expect((await once(child, "message"))[0]).toBe("ready");
      for (let i = 0; i < 3; i++) child.send({ i });
      // Written after the messages, so the child gets them first.
      child.stdin.write("attach\n");
      expect((await once(child, "message"))[0]).toBe("attached");
      child.send("report");
      expect((await once(child, "message"))[0]).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }]);
    });
  });

  // node v26.3.0 emits all its held messages at once, so it loses the ones behind the first once() listener.
  describe("once() in a loop gets every message", () => {
    // "pong" answers a message sent after the first one arrived, so it is the last message.
    async function takeUntilPong(target) {
      const got = [(await once(target, "message"))[0]];
      target.send("ping");
      while (got.at(-1) !== "pong") got.push((await once(target, "message"))[0]);
      return got;
    }

    test("parent", async () => {
      using dir = tempDir("ipc-once-parent", { "child.js": burstThenPong });
      const child = fork(path.join(String(dir), "child.js"), {
        env: bunEnv,
        stdio: ["ignore", "ignore", "inherit", "ipc"],
      });
      await withChild(child, async () => {
        expect(await takeUntilPong(child)).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }, "pong"]);
      });
    });

    test("child", async () => {
      using dir = tempDir("ipc-once-child", {
        "child.js": `
          const { once } = require("events");
          ${takeUntilPong}
          takeUntilPong(process).then(got => process.send({ got }));
        `,
      });
      const child = fork(path.join(String(dir), "child.js"), { env: bunEnv });
      await withChild(child, async () => {
        const { promise, resolve } = Promise.withResolvers();
        child.on("message", m => (m === "ping" ? child.send("pong") : resolve(m.got)));
        for (let i = 0; i < 3; i++) child.send({ i });
        expect(await promise).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }, "pong"]);
      });
    });
  });

  test("a message that was not read is dropped when the channel closes", async () => {
    using dir = tempDir("ipc-closed-unread", {
      "child.js": `
        process.send({ i: 0 });
        process.send({ i: 1 }, () => process.exit(0));
      `,
    });
    const child = fork(path.join(String(dir), "child.js"), { env: bunEnv });
    const got = [];
    child.on("message", function first(m) {
      got.push(["first", m]);
      child.off("message", first);
    });
    await once(child, "close");
    child.on("message", m => got.push(["second", m]));
    await new Promise(resolve => setImmediate(resolve));
    expect(got).toEqual([["first", { i: 0 }]]);
  });

  // The ack arrives on the same stream as the messages, so a sender that waits for one reads.
  test("a sent handle is acknowledged while the sender has no listener", async () => {
    using dir = tempDir("ipc-ack-no-listener", {
      "child.js": `process.on("message", (m, server) => server.close());`,
    });
    const server = net.createServer();
    await once(server.listen(0, "127.0.0.1"), "listening");
    const child = fork(path.join(String(dir), "child.js"), { env: bunEnv });
    try {
      await withChild(child, async () => {
        const { promise, resolve } = Promise.withResolvers();
        child.send("server", server, resolve);
        expect(await promise).toBeNull();
      });
    } finally {
      server.close();
    }
  });
});
