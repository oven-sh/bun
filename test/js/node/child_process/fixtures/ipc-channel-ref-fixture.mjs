// Whether the IPC channel of node:child_process keeps a process alive. It gives the same answers under Node.js.
//
//   parent [option].. <operation>..   starts a kid and does the operations to it. It prints `ready <pid of the kid>`
//                                     and, when it exits, whether the channel held it until the kid was gone.
//   watch [option].. <operation>..    starts a kid that does the operations to its own channel and prints `ready`.
//                                     It disconnects when a line comes in on stdin, and prints how the kid exited.
//
//   --door=fork|spawn|cluster         what starts the kid
//   --serialization=json|advanced
//   --kid=<executable>                what runs the kid
//
// A process prints "held" if it was there to see the other side close the channel, and "not held" if it left before.
// It does not wait: a process that nothing holds exits without another look at the channel.
import { fork, spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { createServer } from "node:net";

const [role, ...operations] = process.argv.slice(2);
const options = { door: "fork", serialization: "json", kid: process.execPath };
while (operations[0]?.startsWith("--")) {
  const [name, value] = operations.shift().slice(2).split("=");
  options[name] = value;
}

const print = line => writeSync(1, line + "\n");
const notes = [];
let disconnectedItself = false;

async function start(kidRole, kidOperations, output) {
  const stdio = ["ignore", output, output, "ipc"];
  const { serialization, kid: execPath } = options;
  const args = [kidRole, ...kidOperations];
  if (options.door === "spawn") return spawn(execPath, [import.meta.filename, ...args], { stdio, serialization });
  if (options.door === "cluster") {
    const { default: cluster } = await import("node:cluster");
    cluster.setupPrimary({ exec: import.meta.filename, args, stdio, serialization });
    return cluster.fork().process;
  }
  return fork(import.meta.filename, args, { stdio, serialization, execPath });
}

async function run(steps) {
  for (const operation of operations) {
    try {
      await steps[operation]();
    } catch (error) {
      notes.push(`throws ${error.name}`);
    }
  }
}

const result = connected => [...notes, disconnectedItself || connected ? "not held" : "held"].join(", ");

if (role === "parent") {
  // A parent that nothing holds leaves while its kid starts. What the kid then says about its channel is not the test's.
  const child = await start("kid of parent", [], "ignore");
  // Each resolves when the write of the message has finished. With a handle, Bun calls back when the kid has it.
  const send = (message, handle) => new Promise(resolve => child.send(message, handle, resolve));
  let saved;
  await run({
    "child.unref": () => child.unref(),
    "child.ref": () => child.ref(),
    "ref": () => child.channel.ref(),
    "unref": () => child.channel.unref(),
    "refCounted": () => child.channel.refCounted(),
    "unrefCounted": () => child.channel.unrefCounted(),
    "on(message)": () => child.on("message", () => {}),
    "save": () => (saved = child.channel),
    "saved.ref": () => saved.ref(),
    "disconnect": () => {
      disconnectedItself = true;
      child.disconnect();
    },
    "send": () => send("small"),
    "send(32 KB)": () => send(Buffer.alloc(32 << 10, "x").toString()),
    // More than the channel takes at once.
    "send(8 MB)": () => send(Buffer.alloc(8 << 20, "x").toString()),
    "send(handle)": () =>
      new Promise(resolve => {
        const server = createServer().unref();
        server.listen(0, "127.0.0.1", () => resolve(send("handle", server)));
      }),
  });
  process.on("exit", () => print(result(child.connected)));
  print(`ready ${child.pid}`);
} else if (role === "kid of parent") {
  // A worker of Bun is one from here on. A worker of Node.js is one from its start.
  if (process.env.NODE_UNIQUE_ID) await import("node:cluster");
  // It reads what the parent sends, and stays until the parent is gone or somebody kills it.
  process.on("message", (message, handle) => handle?.close());
} else if (role === "watch") {
  const child = await start("kid", operations, "inherit");
  child.on("exit", (code, signal) => print(`kid exited with ${signal ?? code}`));
  // It stays until the line has come, so that the line always has a reader.
  process.stdin.once("data", () => {
    if (child.connected) child.disconnect();
    process.stdin.pause();
  });
} else if (role === "kid") {
  const listener = () => {};
  const otherListener = () => {};
  await run({
    "on(message)": () => process.on("message", listener),
    "on(message, other)": () => process.on("message", otherListener),
    "once(message)": () => process.once("message", listener),
    "off(message)": () => process.off("message", listener),
    "on(disconnect)": () => process.on("disconnect", listener),
    "removeAllListeners(message)": () => process.removeAllListeners("message"),
    "removeAllListeners()": () => process.removeAllListeners(),
    "ref": () => process.channel.ref(),
    "unref": () => process.channel.unref(),
    "refCounted": () => process.channel.refCounted(),
    "unrefCounted": () => process.channel.unrefCounted(),
    "disconnect": () => {
      disconnectedItself = true;
      process.disconnect();
    },
  });
  process.on("exit", () => print(result(process.connected)));
  print("ready");
}
