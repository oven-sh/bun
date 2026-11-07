"use strict";
// Written against node:test and node APIs only (no harness), so that the same file also runs under
// node to confirm the behaviour it pins down: `node child_process_ipc_disconnect_before_exit.test.js`.
//
// A forked child's 'disconnect' is emitted before its 'exit' even when the parent gets to look at
// both only after the channel is gone and the child is dead. The parent below stays off its event
// loop until the child is dead, so both are pending at once. Bun used to report the channel's close
// through a later event-loop task, so 'exit' (reported straight from the exit notification) came
// first.

if (process.argv[2] === "child") {
  const fs = require("node:fs");
  process.on("message", () => {
    process.disconnect();
    fs.writeFileSync(process.argv[3], "");
  });
  setInterval(() => {}, 1000); // Stay alive until the parent kills us.
  console.log("ready");
  return;
}

if (process.argv[2] === "child-that-exits") {
  const fs = require("node:fs");
  // The callback runs once the message has left (Windows writes it from the event loop). Then
  // exit on our own, but only when the parent is inside its 'message' handler.
  process.send("bye", () => {
    blockUntil("the parent to get the message", () => fs.existsSync(process.argv[3]));
    process.exit(3);
  });
  return;
}

const assert = require("node:assert");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "ipc-disconnect-before-exit-"));
const children = [];
after(() => {
  // A test that failed early leaves its child running.
  for (const child of children) child.kill("SIGKILL");
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function blockUntil(what, condition) {
  const deadline = Date.now() + 30_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    sleepSync(1);
  }
}

// On Linux the child is dead once /proc shows it as a zombie with no other threads left (the last
// thread to go is the one that closes its descriptors and signals the exit) or no longer shows it
// at all; elsewhere a child that was killed, or is already exiting, is gone within milliseconds.
function blockUntilDead(pid) {
  if (process.platform !== "linux") return sleepSync(100);
  blockUntil("the child to die", () => {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "latin1");
      return stat[stat.lastIndexOf(")") + 2] === "Z" && fs.readdirSync(`/proc/${pid}/task`).length === 1;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
      return true;
    }
  });
}

async function forkChild(name) {
  const closed = path.join(tmpdir, `${name}-channel-closed`);
  const child = fork(__filename, ["child", closed], { stdio: ["ignore", "pipe", "inherit", "ipc"] });
  children.push(child);
  const events = [];
  child.on("disconnect", () => events.push("disconnect"));
  child.on("exit", () => events.push("exit"));
  await once(child.stdout, "data");
  return { child, closed, events };
}

test("the child closes its end of the channel and is then killed", async () => {
  const { child, closed, events } = await forkChild("closed");
  child.send("close your end");
  blockUntil("the child to close the channel", () => fs.existsSync(closed));
  child.kill("SIGKILL");
  blockUntilDead(child.pid);
  await once(child, "close");
  assert.deepStrictEqual(events, ["disconnect", "exit"]);
});

test("the child is killed with a message from the parent possibly still unread", async () => {
  const { child, events } = await forkChild("unread");
  child.send("may never be read");
  child.kill("SIGKILL");
  blockUntilDead(child.pid);
  await once(child, "close");
  assert.deepStrictEqual(events, ["disconnect", "exit"]);
});

test("the child sends a message and exits on its own", async () => {
  const parentIsBusy = path.join(tmpdir, "parent-is-busy");
  const child = fork(__filename, ["child-that-exits", parentIsBusy]);
  children.push(child);
  const events = [];
  const closed = Promise.withResolvers();
  child.on("message", message => {
    events.push(`message:${message}`);
    try {
      // The child exits once it sees this file. Staying in the handler until it is dead leaves
      // the channel's end and the exit both pending.
      fs.writeFileSync(parentIsBusy, "");
      blockUntilDead(child.pid);
    } catch (error) {
      closed.reject(error);
    }
  });
  child.on("disconnect", () => events.push("disconnect"));
  child.on("exit", code => events.push(`exit:${code}`));
  child.on("close", closed.resolve);
  await closed.promise;
  assert.deepStrictEqual(events, ["message:bye", "disconnect", "exit:3"]);
});
