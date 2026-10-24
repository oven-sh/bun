import { $ } from "bun";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { ChildProcess, spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import net from "node:net";
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

// A 'message' that no listener takes waits in the channel. The channel holds 256 KiB of them, and then its socket is not read.
describe("a 'message' that arrives while there is no 'message' listener is not lost", () => {
  const children = new Set();
  afterAll(() => children.forEach(child => child.kill("SIGKILL")));
  // fd 3 carries a byte when the child is ready, and fd 4 the channel.
  function ipcChild(script, options) {
    const child = spawn(bunExe(), ["-e", script], {
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit", "pipe", "ipc"],
      ...options,
    });
    children.add(child);
    return child;
  }
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
  // The child writes to fd 3 after it sent its messages, so they are in the channel by then.
  const ready = child => once(child.stdio[3], "data");
  const burst = `for (let i = 0; i < 3; i++) process.send({ i }); require("fs").writeSync(3, "R");`;
  const three = [{ i: 0 }, { i: 1 }, { i: 2 }];
  // "pong" answers a message that is sent once the listener is added, so it arrives behind the messages under test.
  const untilPong = (target, got = []) => {
    const { promise, resolve } = Promise.withResolvers();
    target.on("message", m => got.push(m) && m === "pong" && resolve(got));
    target.send("ping");
    return promise;
  };
  // An 'internalMessage' never waits, so it tells a child to go on while the messages in front of it still wait.
  const go = { cmd: "NODE_TEST_GO" };
  const lines = child => createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  // One question to the child, one line back from its stdout. Each question turns both event loops.
  function asker(child, ask = question => child.send(question)) {
    const answers = lines(child);
    return async question => {
      ask(question);
      return (await answers.next()).value;
    };
  }
  // For a child that must not read its channel: the questions come on stdin.
  const onStdin = child => question => child.stdin.write(question + "\n");
  const onLine = `const onLine = answer => process.stdin.on("data", data => String(data).trim().split("\\n").forEach(answer));`;

  // Sends 64 KiB messages (64 are 4 MiB, far more than a channel holds), each once the one before it is written, so `onSent` counts what the channel took. Returns how to stop.
  function flood(target, onSent, count = 64) {
    const chunk = Buffer.alloc(64 * 1024, "x").toString();
    let i = 0;
    (function next() {
      target.send({ i: i++, chunk }, () => (onSent(), i < count && next()));
    })();
    return () => (count = 0);
  }
  const upTo = last => Array.from({ length: last + 1 }, (_, i) => i);
  // The count is the same for four questions in a row: the channel takes no more.
  async function untilStalled(count) {
    for (let same = 0, last = 0; same < 3;) {
      const now = Number(await count());
      same = now > 0 && now === last ? same + 1 : 0;
      last = now;
    }
  }

  // Few children start at once: the tests run in small concurrent groups, and a test that is not concurrent ends a group.
  const bothEnds = serialization => () => {
    // The messages that waited are emitted on the next tick, as in node: to both listeners, and before anything queued later.
    test("parent: first listeners added late", async () => {
      const child = ipcChild(`${burst} process.on("message", () => {});`, { serialization });
      await withChild(child, async () => {
        await ready(child);
        const order = [];
        child.on("message", m => order.push(["first", m]));
        child.on("message", m => order.push(["second", m]));
        process.nextTick(() => order.push("tick"));
        await new Promise(resolve => setImmediate(resolve));
        expect(order).toEqual([
          ...three.flatMap(m => [
            ["first", m],
            ["second", m],
          ]),
          "tick",
        ]);
      });
    });

    // Each next listener is added before the channel reads the close that came with the burst. node v26.3.0 emits its held messages all at once, and loses the ones behind the first once() listener.
    test("parent: once() in a loop gets every message of a child that exits", async () => {
      const child = ipcChild(`for (let i = 0; i < 5; i++) process.send(i);`, { serialization });
      const got = [];
      while (got.length < 5) got.push((await once(child, "message"))[0]);
      expect(got).toEqual([0, 1, 2, 3, 4]);
    });

    // "pong" answers a message sent after the first one arrived, so it is the last message.
    async function takeUntilPong(target) {
      const got = [(await once(target, "message"))[0]];
      target.send("ping");
      while (got.at(-1) !== "pong") got.push((await once(target, "message"))[0]);
      return got;
    }

    test("child: once() in a loop gets every message", async () => {
      const child = ipcChild(
        `const { once } = require("events");
         ${takeUntilPong}
         takeUntilPong(process).then(got => process.send({ got }));`,
        { serialization },
      );
      await withChild(child, async () => {
        const { promise, resolve } = Promise.withResolvers();
        child.on("message", m => (m === "ping" ? child.send("pong") : resolve(m.got)));
        for (const m of three) child.send(m);
        expect(await promise).toEqual([...three, "pong"]);
      });
    });

    test("parent: a child that sends more than the channel holds waits for a listener", async () => {
      const child = ipcChild(
        `${flood}
         let sent = 0;
         const stop = flood(process, () => sent++);
         process.on("message", m => console.log(m === "stop" ? (stop(), sent) : sent));`,
        { serialization },
      );
      await withChild(child, async () => {
        const ask = asker(child);
        await untilStalled(() => ask("?"));
        // That many were written. One more is on its way, and the child sends nothing behind it.
        const sent = Number(await ask("stop"));
        expect(sent).toBeLessThan(64);
        const got = [];
        const { promise, resolve } = Promise.withResolvers();
        child.on("message", m => got.push(m.i) > sent && resolve());
        await promise;
        expect(got).toEqual(upTo(sent));
        while (Number(await ask("?")) !== sent + 1);
      });
    });

    test("child: a parent that sends more than the channel holds waits for a listener", async () => {
      const child = ipcChild(
        `${onLine}
         process.send("ready");
         const got = [];
         onLine(last => {
           if (last !== "?") process.on("message", m => got.push(m.i) > Number(last) && process.send(got));
           console.log(last);
         });`,
        { serialization },
      );
      await withChild(child, async () => {
        expect((await once(child, "message"))[0]).toBe("ready");
        const turn = asker(child, onStdin(child));
        let sent = 0;
        const stop = flood(child, () => sent++);
        await untilStalled(async () => (await turn("?"), sent));
        // That many were written. One more is on its way, and nothing is sent behind it.
        stop();
        const last = sent;
        expect(last).toBeLessThan(64);
        const got = once(child, "message");
        await turn(last);
        expect((await got)[0]).toEqual(upTo(last));
        expect(sent).toBe(last + 1);
      });
    });
  };

  describe.concurrent("json", bothEnds("json"));

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

  describe.concurrent("advanced", bothEnds("advanced"));

  // Fewer bytes than the channel holds: every send is written, so the child has nothing left to wait for.
  test("parent: a child that sends 20,000 messages to no listener exits", async () => {
    const child = ipcChild(`for (let i = 0; i < 20_000; i++) process.send({ i });`);
    expect(await once(child, "exit")).toEqual([0, null]);
  });

  describe.concurrent("parent", () => {
    test("last listener removed, next one added late", async () => {
      const child = ipcChild(
        `process.on("message", m => { if (m === "ping") return process.send("pong"); ${burst} });`,
      );
      await withChild(child, async () => {
        const got = [];
        const { promise: removed, resolve } = Promise.withResolvers();
        child.on("message", function first(m) {
          got.push(["first", m]);
          child.off("message", first);
          resolve();
        });
        child.send("burst");
        await Promise.all([removed, ready(child)]);
        expect(await untilPong(child, got)).toEqual([["first", { i: 0 }], { i: 1 }, { i: 2 }, "pong"]);
      });
    });

    // A 'disconnect' listener needs the close of the channel, not its messages.
    test("a 'disconnect' listener does not take the messages", async () => {
      const child = ipcChild(`${burst} process.on("message", () => process.send("pong"));`);
      child.on("disconnect", () => {});
      await withChild(child, async () => {
        await ready(child);
        expect(await untilPong(child)).toEqual([...three, "pong"]);
      });
    });

    // Each of these removes the 'newListener' listener that asks for the messages that wait. The next read asks again.
    test.each([
      [`removeAllListeners("newListener")`, child => child.removeAllListeners("newListener")],
      ["EventEmitter.prototype.removeAllListeners", child => EventEmitter.prototype.removeAllListeners.call(child)],
    ])("a listener added after %s gets the messages", async (_, remove) => {
      const child = ipcChild(`${burst} process.on("message", () => process.send("pong"));`);
      await ready(child);
      remove(child);
      await withChild(child, async () => {
        expect(await untilPong(child)).toEqual([...three, "pong"]);
      });
    });

    // The messages that wait are emitted on the tick after a listener is added, so not to one that is gone by then.
    test("a listener removed in the tick it was added gets nothing", async () => {
      const child = ipcChild(`${burst} process.on("message", () => process.send("pong"));`);
      await withChild(child, async () => {
        await ready(child);
        const removed = [];
        const listener = m => removed.push(m);
        child.on("message", listener);
        child.off("message", listener);
        await new Promise(resolve => setImmediate(resolve));
        expect({ removed, later: await untilPong(child) }).toEqual({ removed: [], later: [...three, "pong"] });
      });
    });

    test("a listener added after disconnect() gets nothing", async () => {
      const child = ipcChild(`${burst} process.on("disconnect", () => {});`);
      await ready(child);
      const got = [];
      child.disconnect();
      child.on("message", m => got.push(m));
      await once(child, "close");
      expect({ got, connected: child.connected }).toEqual({ got: [], connected: false });
    });
  });

  // `Bun.spawn` has no 'message' listeners: its callback takes every message, whatever it returns.
  test("Bun.spawn({ ipc }) gets every message at once", async () => {
    const got = [];
    const { promise, resolve } = Promise.withResolvers();
    await using child = Bun.spawn({
      cmd: [bunExe(), "-e", `for (let i = 0; i < 3; i++) process.send({ i });`],
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
      ipc: m => (got.push(m) === 3 && resolve(), 0),
    });
    await promise;
    expect(got).toEqual(three);
  });

  test("child: a ref() of the channel does not outlive the channel", async () => {
    const child = ipcChild(
      `process.send("ready"); process.channel.ref(); setTimeout(() => process.exit(1), 10_000).unref();`,
    );
    const exited = once(child, "exit");
    expect((await once(child, "message"))[0]).toBe("ready");
    child.disconnect();
    expect((await exited)[0]).toBe(0);
  });

  describe.concurrent("parent", () => {
    test("a message that was not read is dropped when the child exits", async () => {
      const child = ipcChild(`process.send({ i: 0 }); process.send({ i: 1 }, () => process.exit(0));`);
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

    // The channel of the parent holds more than it reads here, so it does not read the close either.
    test("the channel of an exited child is closed inside 'exit'", async () => {
      const child = ipcChild(
        `${flood}
         let sent = 0;
         flood(process, () => sent++);
         process.on("message", m => (m === "exit" ? process.exit(0) : console.log(sent)));`,
      );
      const ask = asker(child);
      await untilStalled(() => ask("?"));
      const { promise, resolve } = Promise.withResolvers();
      child.on("exit", () => resolve({ connected: child.connected, sent: child.send("late", () => {}) }));
      child.send("exit");
      expect(await promise).toEqual({ connected: false, sent: false });
    });

    // An 'internalMessage' never waits, as in node: it passes the 'message' in front of it, which has no listener yet.
    test("an 'internalMessage' passes a 'message' that waits", async () => {
      const child = ipcChild(
        `process.send("user"); process.send({ cmd: "NODE_TEST" }); process.on("message", () => process.send("pong"));`,
      );
      await withChild(child, async () => {
        expect((await once(child, "internalMessage"))[0]).toEqual({ cmd: "NODE_TEST" });
        expect(await untilPong(child)).toEqual(["user", "pong"]);
      });
    });

    // The ack of the handle is behind the three messages, and passes them: they wait for a listener, and the ack does not.
    test("the ack of a sent handle passes the messages that wait", async () => {
      const child = ipcChild(
        `${burst} process.on("message", (m, server) => (m === "ping" ? process.send("pong") : server.close()));`,
      );
      const server = net.createServer();
      await once(server.listen(0, "127.0.0.1"), "listening");
      try {
        await withChild(child, async () => {
          await ready(child);
          const { promise: acked, resolve } = Promise.withResolvers();
          child.send("server", server, resolve);
          expect(await acked).toBeNull();
          expect(await untilPong(child)).toEqual([...three, "pong"]);
        });
      } finally {
        server.close();
      }
    });
  });

  // A handle is acked when it is read, as in node, so its sender does not wait for a listener. The message keeps its handle.
  test.skipIf(isWindows)(
    "child: handles sent before the first 'message' listener is added arrive with their messages",
    async () => {
      const child = ipcChild(`
      setInterval(() => {}, 60_000);
      process.send("ready");
      process.once("internalMessage", () => {
        const got = [];
        process.on("message", (m, server) => {
          got.push([m, server?.constructor.name]);
          server?.close();
          if (m === "end") process.send(got);
        });
      });
    `);
      const server = net.createServer();
      await once(server.listen(0, "127.0.0.1"), "listening");
      try {
        await withChild(child, async () => {
          expect((await once(child, "message"))[0]).toBe("ready");
          const sent = [];
          for (let i = 0; i < 20; i++) sent.push(new Promise(resolve => child.send(i, server, resolve)));
          sent.push(new Promise(resolve => child.send("end", resolve)));
          expect(await Promise.all(sent)).toEqual(Array(21).fill(null));
          child.send(go);
          expect((await once(child, "message"))[0]).toEqual([
            ...Array.from({ length: 20 }, (_, i) => [i, "Server"]),
            ["end", null],
          ]);
        });
      } finally {
        server.close();
      }
    },
  );

  describe.concurrent("child", () => {
    // The three messages are in the channel before the child starts, so one read gets them all.
    test("last listener removed, next one added late", async () => {
      const child = ipcChild(`
        const got = [];
        process.on("message", function first(m) {
          got.push(["first", m]);
          process.off("message", first);
          setImmediate(() => {
            process.on("message", m => (m === "report" ? process.send(got) : got.push(["second", m])));
            process.send("attached");
          });
        });
      `);
      await withChild(child, async () => {
        for (const m of three) child.send(m);
        expect((await once(child, "message"))[0]).toBe("attached");
        child.send("report");
        expect((await once(child, "message"))[0]).toEqual([
          ["first", { i: 0 }],
          ["second", { i: 1 }],
          ["second", { i: 2 }],
        ]);
      });
    });

    // Both listeners are added in one tick, so both get the messages that waited.
    test.each([
      ["no other listener", `setInterval(() => {}, 60_000);`],
      ["a 'disconnect' listener", `process.on("disconnect", () => {});`],
    ])("process.send() opens the channel before the first 'message' listeners are added (%s)", async (_, other) => {
      const child = ipcChild(`
        ${other}
        process.send("ready");
        process.once("internalMessage", () => {
          const first = [], second = [];
          process.on("message", m => first.push(m));
          process.on("message", m => (m === "report" ? process.send({ first, second }) : second.push(m)));
          process.send("attached");
        });
      `);
      await withChild(child, async () => {
        expect((await once(child, "message"))[0]).toBe("ready");
        for (const m of three) child.send(m);
        child.send(go);
        expect((await once(child, "message"))[0]).toBe("attached");
        child.send("report");
        expect((await once(child, "message"))[0]).toEqual({ first: [...three, "report"], second: three });
      });
    });

    // An 'internalMessage' never waits, as in node: it passes the 'message' in front of it, which has no listener yet.
    test("an 'internalMessage' passes a 'message' that waits", async () => {
      const child = ipcChild(`
        process.on("disconnect", () => {});
        process.on("internalMessage", internal => {
          process.on("message", m => process.send({ internal, m }));
        });
        process.send("ready");
      `);
      await withChild(child, async () => {
        expect((await once(child, "message"))[0]).toBe("ready");
        child.send("user");
        child.send({ cmd: "NODE_TEST" });
        expect((await once(child, "message"))[0]).toEqual({ internal: { cmd: "NODE_TEST" }, m: "user" });
      });
    });
  });

  // node:cluster gets its control messages from the channel through a native callback, not through a listener.
  test("child: a cluster worker with no 'message' listener still listens", async () => {
    using dir = tempDir("ipc-cluster-no-listener", {
      "cluster.js": `
        const cluster = require("cluster");
        const net = require("net");
        if (cluster.isPrimary) {
          const worker = cluster.fork();
          worker.on("listening", () => {
            console.log("listening");
            worker.process.kill();
            process.exit(0);
          });
        } else {
          process.removeAllListeners("message");
          // Nothing else keeps the worker alive until the primary answers.
          setTimeout(() => process.exit(1), 10_000);
          net.createServer().listen(0, "127.0.0.1");
        }`,
    });
    await using primary = Bun.spawn({
      cmd: [bunExe(), "cluster.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    children.add(primary);
    const [stdout, exitCode] = await Promise.all([primary.stdout.text(), primary.exited]);
    expect(stdout).toBe("listening\n");
    expect(exitCode).toBe(0);
  });

  describe.concurrent("child", () => {
    // The poll has a deadline, so a child that never sees the close still answers.
    const untilClosed = `const untilClosed = then => {
      const deadline = Date.now() + 10_000;
      (function poll() { process.connected && Date.now() < deadline ? setImmediate(poll) : then(); })();
    };`;

    test("an end with no listener sees the close of the channel", async () => {
      const child = ipcChild(`
        ${untilClosed}
        process.send("ready");
        untilClosed(() => {
          const sent = process.send("late", error => console.log(JSON.stringify({ sent, code: error?.code })));
        });
      `);
      await withChild(child, async () => {
        expect((await once(child, "message"))[0]).toBe("ready");
        child.disconnect();
        expect(JSON.parse((await lines(child).next()).value)).toEqual({ sent: false, code: "ERR_IPC_CHANNEL_CLOSED" });
      });
    });

    // The channel of the child holds more than it reads here. It still finds out that the parent is gone.
    test("a channel that is not read closes when the parent is gone", async () => {
      const child = ipcChild(`
        ${untilClosed}
        ${onLine}
        process.send("ready");
        onLine(line => {
          if (line !== "send") return console.log(line);
          process.send("late", () => {});
          untilClosed(() => console.log(process.connected));
        });
      `);
      await withChild(child, async () => {
        expect((await once(child, "message"))[0]).toBe("ready");
        const turn = asker(child, onStdin(child));
        let sent = 0;
        flood(child, () => sent++);
        await untilStalled(async () => (await turn("?"), sent));
        // The write comes after the close, or the unread "late" would reset the channel of the child.
        child.disconnect();
        await once(child, "disconnect");
        expect(await turn("send")).toBe("false");
      });
    });

    // With a 'disconnect' listener the socket is read on past what the channel holds, and a 'message' that arrives then is dropped.
    test("a 'disconnect' listener sees the close when more than the channel holds is unread", async () => {
      const child = ipcChild(`
        process.on("disconnect", () => console.log("disconnect"));
        process.send("ready");
        process.once("internalMessage", () => {
          const got = [];
          process.on("message", m => (m === "report" ? process.send(got) : got.push(m.i)));
          process.send("attached");
        });
      `);
      await withChild(child, async () => {
        expect((await once(child, "message"))[0]).toBe("ready");
        const { promise: allSent, resolve } = Promise.withResolvers();
        let sent = 0;
        flood(child, () => ++sent === 16 && resolve(), 16);
        await allSent;
        child.send(go);
        expect((await once(child, "message"))[0]).toBe("attached");
        child.send("report");
        const [got] = await once(child, "message");
        expect(got.slice(0, 2)).toEqual([0, 1]);
        expect(got.length).toBeLessThan(16);
        expect(got).toEqual(got.toSorted((a, b) => a - b));
        const answers = lines(child);
        child.disconnect();
        expect((await answers.next()).value).toBe("disconnect");
      });
    });
  });
});
