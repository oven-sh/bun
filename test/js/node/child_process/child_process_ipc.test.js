import { $ } from "bun";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { fork, spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

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

// node's kPendingMessages: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L954-L964
describe.concurrent("a 'message' that arrives while there is no 'message' listener is held", () => {
  // An 'internalMessage' (a NODE_ cmd) is never held, so when the marker arrives the messages before it have arrived.
  const marker = JSON.stringify({ cmd: "NODE_TEST_MARKER" });
  const stop = child => {
    if (child.connected) child.disconnect();
    child.kill();
  };

  test.each(["json", "advanced"])("parent: first listener added late (%s)", async serialization => {
    using dir = tempDir("ipc-hold-parent-late", {
      "child.js": `
        for (let i = 0; i < 3; i++) process.send({ i });
        process.send(${marker});
        process.on("message", () => process.send(${marker}));
      `,
    });
    const child = fork(path.join(String(dir), "child.js"), { env: bunEnv, serialization });
    try {
      await once(child, "internalMessage");
      const got = [];
      child.on("message", m => got.push(m));
      // The answer to this comes after the tick that emits the held messages.
      child.send("ping");
      await once(child, "internalMessage");
      expect(got).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }]);
    } finally {
      stop(child);
    }
  });

  test("parent: last listener removed, next one added late", async () => {
    using dir = tempDir("ipc-hold-parent-readd", {
      "child.js": `
        process.on("message", () => {
          for (let i = 0; i < 3; i++) process.send({ i });
          process.send(${marker});
        });
      `,
    });
    const child = fork(path.join(String(dir), "child.js"), { env: bunEnv });
    try {
      const got = [];
      child.on("message", function first(m) {
        got.push(["first", m]);
        child.off("message", first);
      });
      child.send("go");
      await once(child, "internalMessage");
      child.on("message", m => got.push(["second", m]));
      child.send("go");
      await once(child, "internalMessage");
      expect(got).toEqual([
        ["first", { i: 0 }],
        ["second", { i: 1 }],
        ["second", { i: 2 }],
        ["second", { i: 0 }],
        ["second", { i: 1 }],
        ["second", { i: 2 }],
      ]);
    } finally {
      stop(child);
    }
  });

  // A readiness byte on an extra pipe, written after the sends, is what gates the listener here.
  test.skipIf(isWindows)("parent: listener added once the child reports ready on an extra stdio pipe", async () => {
    const script = `
      process.send({ early: 1 });
      process.send({ early: 2 });
      require("fs").writeSync(3, "R");
      process.on("message", () => process.send(${marker}));
    `;
    const child = spawn(bunExe(), ["-e", script], {
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit", "pipe", "ipc"],
    });
    try {
      await once(child.stdio[3], "data");
      const got = [];
      child.on("message", m => got.push(m));
      child.send("ping");
      await once(child, "internalMessage");
      expect(got).toEqual([{ early: 1 }, { early: 2 }]);
    } finally {
      stop(child);
    }
  });

  test("child: last listener removed, next one added late", async () => {
    using dir = tempDir("ipc-hold-child-readd", {
      "child.js": `
        const got = [];
        // Keeps the channel referenced while there is no 'message' listener.
        process.on("disconnect", () => {});
        process.on("message", function first(m) {
          got.push(["first", m]);
          process.off("message", first);
        });
        process.on("internalMessage", () => {
          process.on("message", m => got.push(["second", m]));
          // Runs after the tick that emits the held messages.
          setImmediate(() => process.send(got));
        });
      `,
    });
    const child = fork(path.join(String(dir), "child.js"), { env: bunEnv });
    try {
      for (let i = 0; i < 3; i++) child.send({ i });
      child.send(JSON.parse(marker));
      const [got] = await once(child, "message");
      expect(got).toEqual([
        ["first", { i: 0 }],
        ["second", { i: 1 }],
        ["second", { i: 2 }],
      ]);
    } finally {
      stop(child);
    }
  });

  test("child: process.send() opens the channel before the first listener is added", async () => {
    using dir = tempDir("ipc-hold-child-send-first", {
      "child.js": `
        process.send("ready");
        process.on("disconnect", () => {});
        process.on("internalMessage", () => {
          const got = [];
          process.on("message", m => got.push(m));
          setImmediate(() => process.send(got));
        });
      `,
    });
    const child = fork(path.join(String(dir), "child.js"), { env: bunEnv });
    try {
      const [ready] = await once(child, "message");
      expect(ready).toBe("ready");
      for (let i = 0; i < 3; i++) child.send({ i });
      child.send(JSON.parse(marker));
      const [got] = await once(child, "message");
      expect(got).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }]);
    } finally {
      stop(child);
    }
  });

  // node v26.3.0 loses all but the first here: its flush does not stop when once() has removed the listener.
  describe("each once() listener takes one held message", () => {
    async function takeThree(target) {
      const got = [];
      for (let i = 0; i < 3; i++) {
        const message = Promise.withResolvers();
        target.once("message", message.resolve);
        // A held message is emitted on the tick after the listener is added, so before an immediate.
        const nothing = new Promise(resolve => setImmediate(resolve, "nothing"));
        got.push(await Promise.race([message.promise, nothing]));
      }
      return got;
    }

    test("parent", async () => {
      using dir = tempDir("ipc-hold-once-parent", {
        "child.js": `
          for (let i = 0; i < 3; i++) process.send({ i });
          process.send(${marker});
          process.on("disconnect", () => {});
        `,
      });
      const child = fork(path.join(String(dir), "child.js"), { env: bunEnv });
      try {
        await once(child, "internalMessage");
        expect(await takeThree(child)).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }]);
      } finally {
        stop(child);
      }
    });

    test("child", async () => {
      using dir = tempDir("ipc-hold-once-child", {
        "child.js": `
          ${takeThree}
          process.send("ready");
          process.on("disconnect", () => {});
          process.on("internalMessage", async () => process.send(await takeThree(process)));
        `,
      });
      const child = fork(path.join(String(dir), "child.js"), { env: bunEnv });
      try {
        const [ready] = await once(child, "message");
        expect(ready).toBe("ready");
        for (let i = 0; i < 3; i++) child.send({ i });
        child.send(JSON.parse(marker));
        const [got] = await once(child, "message");
        expect(got).toEqual([{ i: 0 }, { i: 1 }, { i: 2 }]);
      } finally {
        stop(child);
      }
    });
  });

  // node v26.3.0 stops here and emits { i: 0 } again for the next listener.
  test("a listener that throws does not stop the held messages behind it", async () => {
    using dir = tempDir("ipc-hold-throw", {
      "child.js": `
        for (let i = 0; i < 3; i++) process.send({ i });
        process.send(${marker});
        process.on("message", () => process.send(${marker}));
      `,
      "parent.js": `
        const child = require("child_process").fork(require("path").join(__dirname, "child.js"));
        const errors = [];
        process.on("uncaughtException", e => errors.push(e.message));
        child.once("internalMessage", () => {
          const got = [];
          child.on("message", m => {
            got.push(m);
            if (m.i === 0) throw new Error("from the listener");
          });
          child.send("ping");
          child.once("internalMessage", () => {
            console.log(JSON.stringify({ got, errors }));
            child.disconnect();
          });
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "parent.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual({ got: [{ i: 0 }, { i: 1 }, { i: 2 }], errors: ["from the listener"] });
    expect(exitCode).toBe(0);
  });

  test("held messages are dropped when the channel disconnects", async () => {
    using dir = tempDir("ipc-hold-disconnect", {
      "child.js": `process.send({ i: 0 }, () => process.disconnect());`,
    });
    const child = fork(path.join(String(dir), "child.js"), { env: bunEnv });
    try {
      await once(child, "disconnect");
      const got = [];
      child.on("message", m => got.push(m));
      await new Promise(resolve => setImmediate(resolve));
      expect(got).toEqual([]);
    } finally {
      stop(child);
    }
  });
});
