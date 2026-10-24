import { $ } from "bun";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";
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

// A child does not read its channel before its script uses it (a listener, send() or disconnect()), so what the parent
// sent stays in the socket for the first listener. The child still has to learn that the parent closed the channel.
// A Windows pipe reports its close only to a read, so there the child learns of it at the first use.
describe.todoIf(isWindows)("a child that has not used its IPC channel", () => {
  const children = new Set();
  afterAll(() => children.forEach(child => child.kill("SIGKILL")));

  // One question on the child's stdin, one line back on its stdout. Each question turns the child's event loop at least once.
  function asker(child) {
    const answers = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
    const next = async () => (await answers.next()).value;
    return { next, ask: question => (child.stdin.write(question + "\n"), next()) };
  }
  // fd 3 carries a byte when the child has started, and fd 4 is the channel.
  function idleChild(args, options) {
    const child = spawn(bunExe(), args, {
      env: bunEnv,
      stdio: ["pipe", "pipe", "inherit", "pipe", "ipc"],
      ...options,
    });
    children.add(child);
    return { child, started: once(child.stdio[3], "data"), exited: once(child, "exit"), ...asker(child) };
  }
  const prelude = `
    const say = line => console.log(line);
    const answer = fn => process.stdin.on("data", data => String(data).trim().split("\\n").forEach(fn));
    const started = () => require("fs").writeSync(3, "R");`;
  // Adds the first listeners when asked to, and says what they got once the channel ends.
  const listenWhenAsked = `
    const got = [];
    answer(question => {
      if (question === "connected") return say(String(process.connected));
      process.on("message", message => got.push(message));
      process.on("disconnect", () => say(JSON.stringify([...got, "disconnect"])));
    });`;

  // Resolves once the parent's end of the channel is closed.
  async function disconnect(child) {
    const disconnected = once(child, "disconnect");
    child.disconnect();
    await disconnected;
  }
  // The close reaches the child through its event loop: the answer is "false" within a few questions, or never.
  async function untilDisconnected(ask) {
    let connected;
    for (let i = 0; i < 10 && connected !== "false"; i++) connected = await ask("connected");
    return connected;
  }
  const sendAll = (child, messages) => Promise.all(messages.map(m => new Promise(resolve => child.send(m, resolve))));

  describe.each(["json", "advanced"])("%s", serialization => {
    test.concurrent("process.connected is false after the parent disconnects", async () => {
      const { child, started, exited, ask } = idleChild(
        [
          "-e",
          `${prelude}
           answer(() => console.log(process.connected));
           started();`,
        ],
        { serialization },
      );
      await started;
      expect(await ask("connected")).toBe("true");
      await disconnect(child);
      expect(await untilDisconnected(ask)).toBe("false");
      child.stdin.end();
      expect(await exited).toEqual([0, null]);
    });

    test.concurrent("the first 'message' listener gets what the parent sent before it", async () => {
      const { child, started, exited, ask } = idleChild(
        [
          "-e",
          `${prelude}
           const got = [];
           answer(() => process.on("message", message => got.push(message) === 3 && console.log(JSON.stringify(got))));
           started();`,
        ],
        { serialization },
      );
      await started;
      await sendAll(child, [1, 2, 3]);
      expect(await ask("listen")).toBe("[1,2,3]");
      child.disconnect();
      child.stdin.end();
      expect(await exited).toEqual([0, null]);
    });

    // Node read these messages when the child started, and drops them at the disconnect.
    test.concurrent("the first listeners get what the parent sent before it disconnected", async () => {
      const { child, started, exited, ask } = idleChild(["-e", `${prelude} ${listenWhenAsked} started();`], {
        serialization,
      });
      await started;
      await sendAll(child, [1, 2, 3]);
      await disconnect(child);
      // Enough turns of the child's event loop for it to see the close.
      for (let i = 0; i < 3; i++) await ask("connected");
      expect(await ask("listen")).toBe('[1,2,3,"disconnect"]');
      child.stdin.end();
      expect(await exited).toEqual([0, null]);
    });
  });

  test.concurrent("process.channel.ref() does not hold a child whose parent disconnected", async () => {
    const { child, started, exited } = idleChild([
      "-e",
      `${prelude}
       process.channel.ref();
       started();`,
    ]);
    await started;
    child.disconnect();
    expect(await exited).toEqual([0, null]);
  });

  test.concurrent("the first send() and disconnect() report the channel that the parent closed", async () => {
    const { child, started, exited, ask } = idleChild([
      "-e",
      `${prelude}
       process.on("error", error => console.log("error " + error.code));
       answer(question => {
         if (question === "connected") console.log(process.connected);
         else if (question === "disconnect") process.disconnect();
         else {
           const sent = process.send("late", error => console.log("send " + sent + " " + error?.code));
         }
       });
       started();`,
    ]);
    await started;
    await disconnect(child);
    expect(await untilDisconnected(ask)).toBe("false");
    expect(await ask("send")).toBe("send false ERR_IPC_CHANNEL_CLOSED");
    expect(await ask("disconnect")).toBe("error ERR_IPC_DISCONNECTED");
    child.stdin.end();
    expect(await exited).toEqual([0, null]);
  });

  // The kernel resets a channel whose parent dies with bytes of the child unread. That is an error event, not a hangup.
  test.concurrent("a reset of the channel is a close, and what the parent sent is kept", async () => {
    // The parent is killed, and its stdio with it, so the child talks to the test over TCP.
    // With BUN_FEATURE_FLAG_NO_ORPHANS (the ASAN lane sets it) the child would die with that parent.
    const { BUN_FEATURE_FLAG_NO_ORPHANS: _, ...env } = bunEnv;
    const server = net.createServer().listen(0, "127.0.0.1");
    await once(server, "listening");
    const accepted = once(server, "connection");
    // The channel is fd 3. The child writes there by number, which is no use of the channel.
    const childScript = `
      const socket = require("node:net").connect(${server.address().port}, "127.0.0.1");
      const say = line => socket.write(line + "\\n");
      const answer = fn => socket.on("data", data => String(data).trim().split("\\n").forEach(fn));
      ${listenWhenAsked}
      require("fs").writeSync(3, JSON.stringify({ unread: true }) + "\\n");
      say("started");`;
    const parent = spawn(
      bunExe(),
      [
        "-e",
        `const child = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], {
           stdio: ["ignore", "ignore", "inherit", "ipc"],
         });
         for (const message of [1, 2, 3]) child.send(message);
         // Reads nothing from here on.
         Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);`,
      ],
      { env, stdio: ["ignore", "ignore", "inherit"] },
    );
    children.add(parent);
    const [connection] = await accepted;
    try {
      const { next, ask } = asker({ stdin: connection, stdout: connection });
      expect(await next()).toBe("started");
      const killed = once(parent, "exit");
      parent.kill("SIGKILL");
      await killed;
      expect(await untilDisconnected(ask)).toBe("false");
      expect(await ask("listen")).toBe('[1,2,3,"disconnect"]');
    } finally {
      // The child leaves when this connection ends.
      connection.destroy();
      server.close();
    }
  });

  // The event loop runs while an ESM entry point loads its imports. The close that arrives then is not known on the first line, as in node.
  test.concurrent("an ESM entry point finds the channel connected on its first line", async () => {
    const deps = Array.from({ length: 40 }, (_, i) => `dep${i}.mjs`);
    using dir = tempDir("ipc-esm-entry", {
      "entry.mjs": `${deps.map(dep => `import "./${dep}";`).join("\n")}
        const got = [process.connected];
        process.on("message", message => got.push(message));
        process.on("disconnect", () => console.log(JSON.stringify([...got, "disconnect"])));`,
      ...Object.fromEntries(deps.map((dep, i) => [dep, `export default ${i};`])),
    });
    const child = spawn(bunExe(), [join(String(dir), "entry.mjs")], {
      env: bunEnv,
      stdio: ["ignore", "pipe", "inherit", "ipc"],
    });
    children.add(child);
    for (const message of [1, 2, 3]) child.send(message);
    child.disconnect();
    const [stdout, exit] = await Promise.all([child.stdout.toArray(), once(child, "exit")]);
    expect(Buffer.concat(stdout).toString()).toBe('[true,1,2,3,"disconnect"]\n');
    expect(exit).toEqual([0, null]);
  });

  // A top-level await in an import lets the event loop turn before the first line of the entry point. Node also knows of the close there.
  test.concurrent("an ESM entry point behind a top-level await knows of the close on its first line", async () => {
    using dir = tempDir("ipc-esm-await", {
      "entry.mjs": `import "./dep.mjs";
        const got = [process.connected];
        process.on("message", message => got.push(message));
        process.on("disconnect", () => console.log(JSON.stringify([...got, "disconnect"])));`,
      "dep.mjs": `import { writeSync } from "node:fs";
        writeSync(3, "R");
        await new Promise(resolve => process.stdin.once("data", resolve));`,
    });
    const { child, started, exited, ask } = idleChild([join(String(dir), "entry.mjs")]);
    await started;
    await sendAll(child, [1, 2, 3]);
    await disconnect(child);
    expect(await ask("go on")).toBe('[false,1,2,3,"disconnect"]');
    child.stdin.end();
    expect(await exited).toEqual([0, null]);
  });

  // node:cluster sets a worker up when it is first loaded. The worker then finds out that its primary is gone, and exits.
  test.concurrent("a cluster worker exits when its primary left before node:cluster loaded", async () => {
    using dir = tempDir("ipc-late-cluster", {
      "worker.js": `${prelude}
        answer(question => (question === "connected" ? console.log(process.connected) : require("node:cluster")));
        started();`,
    });
    const { child, started, exited, ask } = idleChild([join(String(dir), "worker.js")], {
      env: { ...bunEnv, NODE_UNIQUE_ID: "1" },
    });
    await started;
    await disconnect(child);
    for (let i = 0; i < 3; i++) await ask("connected");
    child.stdin.write("cluster\n");
    expect(await exited).toEqual([0, null]);
  });

  // The commands of a script chain share one channel. A command that does not use it leaves the messages to the next one.
  test.concurrent("a package script gets the messages that arrived while its pre-script ran", async () => {
    using dir = tempDir("ipc-script-chain", {
      "package.json": JSON.stringify({
        scripts: { prestart: `${bunExe()} pre.mjs`, start: `${bunExe()} main.mjs` },
      }),
      "pre.mjs": `await new Promise(resolve => setImmediate(resolve));`,
      "main.mjs": `
        const got = [];
        process.on("message", message => {
          if (got.push(message) < 3) return;
          console.log(JSON.stringify(got));
          process.disconnect();
        });`,
    });
    const child = spawn(bunExe(), ["run", "start"], {
      cwd: String(dir),
      env: bunEnv,
      stdio: ["ignore", "pipe", "ignore", "ipc"],
    });
    children.add(child);
    for (const message of [1, 2, 3]) child.send(message);
    const [stdout, exit] = await Promise.all([child.stdout.toArray(), once(child, "exit")]);
    expect(Buffer.concat(stdout).toString()).toBe("[1,2,3]\n");
    expect(exit).toEqual([0, null]);
  });
});
