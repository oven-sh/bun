import { $ } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExeAtLeast, tempDir } from "harness";
import { join } from "node:path";

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

// Runs a role of fixtures/ipc-channel-ref-fixture.mjs with the operations, and ends the other side of its channel: it
// kills the kid of "parent", and it has "watch" disconnect from its kid. For a process that is to stay, it does so when
// the fixture is ready. For one that is to leave, it does so when that one has left and has said so.
async function channelRefFixture(runtime, role, operations, expected) {
  await using proc = Bun.spawn({
    cmd: [runtime, join(import.meta.dir, "fixtures", "ipc-channel-ref-fixture.mjs"), role, ...operations],
    env: bunEnv,
    stdin: role === "watch" ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const linesBeforeTheEnd = expected.endsWith("not held") ? 2 : 1;
  const decoder = new TextDecoder();
  let stdout = "";
  let ended = false;
  const readStdout = async () => {
    for await (const chunk of proc.stdout) {
      stdout += decoder.decode(chunk, { stream: true });
      if (ended || stdout.split("\n").length <= linesBeforeTheEnd) continue;
      ended = true;
      if (role === "watch") {
        proc.stdin.write("\n");
        await proc.stdin.end();
      } else {
        try {
          process.kill(Number(stdout.split(/[ \n]/)[1]), "SIGKILL");
        } catch {
          // The kid of a parent that has left is gone already.
        }
      }
    }
  };
  const [stderr, , exitCode] = await Promise.all([proc.stderr.text(), readStdout(), proc.exited]);
  return { result: stdout.trimEnd().split("\n").slice(1), stderr, exitCode, signalCode: proc.signalCode };
}

describe.concurrent("the IPC channel of node:child_process and the event loop", () => {
  // `child.unref` is `subprocess.unref()`. Everything else is a method of `subprocess.channel`, or an event of the
  // subprocess. "held" means that the parent stayed until the channel closed.
  const parent = [
    [[], "held"],
    [["child.unref", "unref"], "not held"],
    [["unref"], "held"],
    [["child.unref", "unref", "ref"], "held"],
    [["child.unref", "ref", "unref"], "not held"],
    [["child.unref", "ref"], "held"],
    [["unref", "ref", "child.unref"], "held"],
    [["child.unref", "unref", "child.ref"], "held"],
    [["child.unref", "unref", "on(message)"], "not held"],
    // refCounted() and unrefCounted() count, and act when the count gets to 1 or back to 0.
    [["child.unref", "refCounted"], "held"],
    [["child.unref", "refCounted", "unrefCounted"], "not held"],
    [["child.unref", "refCounted", "refCounted", "unrefCounted"], "held"],
    // After ref() or unref() the count changes nothing.
    [["child.unref", "unref", "refCounted"], "not held"],
    [["child.unref", "ref", "refCounted", "unrefCounted"], "held"],
    [["child.unref", "disconnect"], "not held"],
    [["child.unref", "disconnect", "ref"], "throws TypeError, not held"],
    [["child.unref", "save", "disconnect", "saved.ref"], "not held"],
    [["child.unref", "unref", "send"], "not held"],
    // A write that does not finish at once is counted until it has finished, and so is one with a handle.
    [["child.unref", "send(8 MB)"], "not held"],
    [["child.unref", "send(8 MB)", "send(8 MB)"], "not held"],
    [["child.unref", "ref", "send(8 MB)"], "held"],
    [["child.unref", "refCounted", "send(8 MB)"], "held"],
    [["child.unref", "send(handle)"], "not held"],
    [["--serialization=advanced", "child.unref", "send(8 MB)"], "not held"],
    [["--door=spawn", "child.unref", "unref"], "not held"],
    [["--door=spawn", "child.unref", "unref", "ref"], "held"],
    [["--door=spawn", "child.unref", "refCounted", "unrefCounted"], "not held"],
    [["--door=spawn", "child.unref", "send(8 MB)"], "not held"],
    [["--door=cluster", "child.unref", "unref"], "not held"],
    [["--door=cluster", "child.unref", "unref", "ref"], "held"],
    [["--kid=other", "child.unref", "unref"], "not held"],
    [["--kid=other", "child.unref", "send(8 MB)"], "not held"],

    // The channel holds the parent from the start.
    [["child.unref"], "held"],
    [["child.unref", "on(message)"], "held"],
    [["child.unref", "unrefCounted"], "held"],
    [["child.unref", "unrefCounted", "refCounted"], "held"],
    [["child.unref", "unrefCounted", "send(8 MB)"], "held"],
    [["child.unref", "unrefCounted", "send(handle)"], "held"],
    [["--serialization=advanced", "child.unref"], "held"],
    [["--door=spawn", "child.unref"], "held"],
    [["--door=cluster", "child.unref"], "held"],
    [["--kid=other", "child.unref"], "held"],
    // No write to a pipe finishes at once on Windows, in Node.js either:
    // https://github.com/libuv/libuv/blob/v1.52.1/src/win/stream.c#L210-L211
    [["child.unref", "send"], isWindows ? "not held" : "held"],
    [["child.unref", "send(32 KB)"], isWindows ? "not held" : "held"],
    [["--serialization=advanced", "child.unref", "send"], isWindows ? "not held" : "held"],
  ];

  // The operations are on `process` and on `process.channel`. Each 'message' and 'disconnect' listener of `process`
  // is counted as one refCounted(). "held" means that the child stayed until its parent disconnected.
  const child = [
    [[], "not held"],
    [["on(message)"], "held"],
    [["once(message)"], "held"],
    [["on(disconnect)"], "held"],
    [["on(message)", "off(message)"], "not held"],
    [["on(message)", "on(message, other)", "removeAllListeners(message)"], "not held"],
    [["on(message)", "on(message, other)", "on(disconnect)", "removeAllListeners()"], "not held"],
    [["on(message)", "unref"], "not held"],
    [["on(message)", "unref", "ref"], "held"],
    [["on(message)", "off(message)", "ref"], "held"],
    [["on(message)", "off(message)", "refCounted"], "held"],
    [["refCounted", "unrefCounted"], "not held"],
    [["on(message)", "unrefCounted"], "not held"],
    [["on(message)", "on(message)", "unrefCounted"], "held"],
    [["unrefCounted", "on(message)"], "not held"],
    [["on(message)", "refCounted", "off(message)"], "held"],
    [["on(message)", "refCounted", "off(message)", "unrefCounted"], "not held"],
    // What execa does in a child: it gives back the count of its two listeners, and takes one while it waits.
    [["on(message)", "on(disconnect)", "unrefCounted"], "held"],
    [["on(message)", "on(disconnect)", "unrefCounted", "unrefCounted"], "not held"],
    [["on(message)", "on(disconnect)", "unrefCounted", "unrefCounted", "refCounted"], "held"],
    [["on(message)", "disconnect"], "not held"],
    [["--kid=other", "on(message)"], "held"],
    [["--kid=other", "on(message)", "unrefCounted"], "not held"],
    [["--kid=other", "on(message)", "on(disconnect)", "unrefCounted", "unrefCounted", "refCounted"], "held"],
  ];

  // The rows are what this Node.js prints. It runs them too where it is installed, and `--kid=other` has each of the
  // two start a kid of the other.
  const bun = bunExe();
  const node = nodeExeAtLeast("26.3.0");
  for (const [name, runtime, other] of [
    ["bun", bun, node],
    ["node", node, bun],
  ]) {
    const rowsOf = rows =>
      rows
        .filter(([operations]) => other || !operations.includes("--kid=other"))
        .map(([operations, expected]) => [
          operations.join(", ") || "nothing",
          operations.map(operation => (operation === "--kid=other" ? `--kid=${other}` : operation)),
          expected,
        ]);

    test.skipIf(!runtime).each(rowsOf(parent))(`${name} parent: %s`, async (_, operations, expected) => {
      expect(await channelRefFixture(runtime, "parent", operations, expected)).toEqual({
        result: [expected],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test.skipIf(!runtime).each(rowsOf(child))(`${name} child: %s`, async (_, operations, expected) => {
      expect(await channelRefFixture(runtime, "watch", operations, expected)).toEqual({
        result: [expected, "kid exited with 0"],
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });
  }

  // In Node.js it does: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L868-L874 counts
  // the handle until it is written. Here the parent stays until the kid has the handle, as it did before.
  test.todo("unref() lets a parent go that waits for the kid to take a handle");

  // Runs a script that forks itself with the argument "kid".
  async function runForkingScript(script, options) {
    using dir = tempDir("ipc-channel-ref", { "script.cjs": script });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "script.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      ...options,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The kid of one of the scripts stays until its stdin ends. Its parent has left by now.
    await proc.stdin?.end();
    return { stdout: stdout.trimEnd().split("\n"), stderr, exitCode, signalCode: proc.signalCode };
  }

  // https://github.com/oven-sh/bun/issues/23686. On Windows the write of the message does not finish at once, so
  // there the parent leaves when it has, in Node.js too.
  test.skipIf(isWindows)("a parent that unrefs its child still gets the answer to what it sent", async () => {
    const script = `
      const { fork } = require("node:child_process");
      if (process.argv[2] === "kid") {
        process.on("message", message => process.send(message + ", and hello from the kid"));
      } else {
        const child = fork(__filename, ["kid"]);
        child.on("message", message => {
          console.log(message);
          child.disconnect();
        });
        child.unref();
        child.send("hello from the parent");
      }
    `;
    expect(await runForkingScript(script)).toEqual({
      stdout: ["hello from the parent, and hello from the kid"],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test("a channel that the child closes lets the parent go, and is null from then on", async () => {
    const script = `
      const { fork } = require("node:child_process");
      if (process.argv[2] === "kid") {
        // It stays for as long as the test holds the other end of stdin.
        process.stdin.resume();
        process.disconnect();
      } else {
        const child = fork(__filename, ["kid"], { stdio: ["inherit", "ignore", "ignore", "ipc"] });
        const channel = child.channel;
        child.unref();
        child.on("disconnect", () => {
          // A method of the channel that is kept does nothing now.
          channel.ref();
          console.log(JSON.stringify({ channel: child.channel, connected: child.connected, exitCode: child.exitCode }));
        });
      }
    `;
    expect(await runForkingScript(script, { stdin: "pipe" })).toEqual({
      stdout: [JSON.stringify({ channel: null, connected: false, exitCode: null })],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test("a channel holds the parent when nothing refers to the subprocess", async () => {
    const script = `
      const { fork } = require("node:child_process");
      // The kid has nothing to do, and exits.
      if (process.argv[2] !== "kid") {
        (() => {
          const child = fork(__filename, ["kid"]);
          child.unref();
          child.on("disconnect", () => console.log("the kid is gone"));
        })();
        Bun.gc(true);
      }
    `;
    expect(await runForkingScript(script)).toEqual({
      stdout: ["the kid is gone"],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // The side that disconnects has no channel from that call on. The other side has none from its 'disconnect' event on.
  test.each([
    ["the parent", ["kid at 'disconnect'", "parent after disconnect()", "parent at 'disconnect'"]],
    ["the child", ["kid after disconnect()", "kid at 'disconnect'", "parent at 'disconnect'"]],
  ])("the channel is null on both sides once %s has disconnected", async (who, moments) => {
    const script = `
      const { fork } = require("node:child_process");
      const say = (moment, it) => console.log(moment, JSON.stringify({ channel: it.channel, connected: it.connected }));
      if (process.argv[2] === "kid") {
        process.on("disconnect", () => say("kid at 'disconnect'", process));
        if (process.argv[3] === "the child") {
          process.disconnect();
          say("kid after disconnect()", process);
        } else {
          process.send("ready");
        }
      } else {
        const child = fork(__filename, ["kid", ${JSON.stringify(who)}]);
        child.on("message", () => {
          child.disconnect();
          say("parent after disconnect()", child);
        });
        child.on("disconnect", () => say("parent at 'disconnect'", child));
      }
    `;
    const { stdout, ...rest } = await runForkingScript(script);
    // The two write to one pipe, in either order.
    expect({ stdout: stdout.sort(), ...rest }).toEqual({
      stdout: moments.map(moment => `${moment} {"channel":null,"connected":false}`),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // https://github.com/oven-sh/bun/issues/33593
  test("subprocess.channel and process.channel have the methods of Node's Control", async () => {
    const script = `
      const { fork } = require("node:child_process");
      const EventEmitter = require("node:events");
      const describeChannel = channel => ({
        name: channel.constructor.name,
        isEventEmitter: channel instanceof EventEmitter,
        // The class of Node.js has a getter too, fd.
        own: Object.getOwnPropertyNames(Object.getPrototypeOf(channel)).sort(),
        results: [channel.refCounted(), channel.unrefCounted(), channel.unref(), channel.ref()].map(String),
      });
      if (process.argv[2] === "kid") {
        process.send(describeChannel(process.channel));
      } else {
        const child = fork(__filename, ["kid"]);
        const ofParent = describeChannel(child.channel);
        child.on("message", ofChild => {
          console.log(JSON.stringify(ofParent));
          console.log(JSON.stringify(ofChild));
          child.disconnect();
        });
      }
    `;
    const control = JSON.stringify({
      name: "Control",
      isEventEmitter: true,
      own: ["constructor", "ref", "refCounted", "unref", "unrefCounted"],
      results: ["undefined", "undefined", "undefined", "undefined"],
    });
    expect(await runForkingScript(script)).toEqual({
      stdout: [control, control],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});
