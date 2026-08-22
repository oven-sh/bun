"use strict";
// Written against node:test and node APIs only (no harness), so that the same file also runs under
// node to confirm the behaviour it pins down: `node child_process_ipc_disconnect_before_exit.test.js`.
//
// A forked child's 'disconnect' is emitted before its 'exit' even when the parent gets to look at
// both only after the channel is gone and the child is dead. The parent below stays off its event
// loop from the moment it makes the channel go away until the child has been killed, so both are
// pending at once. Bun used to report the channel's close through a later event-loop task, so 'exit'
// (reported straight from the exit notification) came first.

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

const assert = require("node:assert");
const { fork } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "ipc-disconnect-before-exit-"));
after(() => fs.rmSync(tmpdir, { recursive: true, force: true }));

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

// On Linux the killed child is dead once /proc shows it as a zombie with no other threads left (the
// last thread to go is the one that closes its descriptors and signals the exit) or no longer shows
// it at all; elsewhere a SIGKILL'd child is gone within a few milliseconds.
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
