"use strict";
// Written against node:test and node APIs only, so that the same file also runs under node to
// confirm the behaviour it pins down: `node child_process_ipc_disconnect_before_exit.test.js`.
//
// A forked child's last messages, and the 'disconnect' of a channel that ended with them, are
// emitted before its 'exit', also when the parent only gets to look once the child is dead. The
// parent below stays off its event loop until then, so all of them are pending at once.

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

// What a child does, or a worker of the cluster cases. Each waits for the file that the parent
// writes once it is busy.
const roles = {
  "child"(fs, closed) {
    process.on("message", () => {
      process.disconnect();
      fs.writeFileSync(closed, "");
    });
    setInterval(() => {}, 1000); // Stay alive until the parent kills us.
    console.log("ready");
  },
  "child-that-exits"(fs, parentIsBusy) {
    // The callback runs once the message has left (Windows writes it from the event loop).
    process.send("bye", () => {
      blockUntil("the parent to be busy", () => fs.existsSync(parentIsBusy));
      process.exit(3);
    });
  },
  "child-with-a-last-message"(fs, parentIsBusy) {
    process.send("first", () => {
      blockUntil("the parent to be busy", () => fs.existsSync(parentIsBusy));
      process.send("last", () => process.exit(0));
    });
  },
  "child-with-a-last-handle"(fs, parentIsBusy, kind) {
    process.send("first", () => {
      blockUntil("the parent to be busy", () => fs.existsSync(parentIsBusy));
      const handle =
        kind === "Server" ? require("node:net").createServer() : require("node:dgram").createSocket("udp4");
      const listening = () => {
        process.send("last", handle);
        // Not from a callback of that send: the parent is busy, and Bun calls it once the parent
        // has taken the handle.
        setImmediate(() => process.exit(0));
      };
      if (kind === "Server") handle.listen(0, "127.0.0.1", listening);
      else handle.bind(0, "127.0.0.1", listening);
    });
  },
  "worker-that-dies-as-it-starts"(fs, primaryIsBusy) {
    blockUntil("the primary to be busy", () => fs.existsSync(primaryIsBusy));
    process.exit(3);
  },
};
if (Object.hasOwn(roles, process.argv[2])) {
  // Under node a worker has set itself up by now. Under Bun it does so here.
  if (process.env.NODE_UNIQUE_ID) require("node:cluster");
  roles[process.argv[2]](require("node:fs"), ...process.argv.slice(3));
  return;
}

const assert = require("node:assert");
const { fork, spawn } = require("node:child_process");
const cluster = require("node:cluster");
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
let flags = 0;
const newFlag = () => path.join(tmpdir, `flag-${flags++}`);

const hasProc = process.platform === "linux" || process.platform === "android";
// Where Linux has no pidfd_open (old kernels, some seccomp filters), Bun reaps children on a thread.
// The thread hands the exit to the event loop as a task, and tasks run before the loop reads the
// channel. A case below runs this file again that way.
const threadReaps = !!process.versions.bun && hasProc && !!process.env.BUN_FEATURE_FLAG_FORCE_WAITER_THREAD;

function isReaped(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
    return true;
  }
}

// Returns once the child is dead: its descriptors are closed, and its exit is there for the loop.
function blockUntilDead(pid) {
  if (!hasProc) {
    // Nothing else shows the moment the descriptors close. macOS stops finding a process that has
    // started to exit, so wait for that at most. A process that exits is gone within milliseconds.
    const deadline = Date.now() + 5_000;
    while (process.platform === "darwin" && Date.now() < deadline) {
      try {
        os.getPriority(pid);
      } catch {
        break;
      }
      sleepSync(1);
    }
    return sleepSync(100);
  }
  // A zombie with no other threads left (the last thread to go is the one that closes the
  // descriptors and signals the exit), or reaped already.
  blockUntil("the child to die", () => {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "latin1");
      return stat[stat.lastIndexOf(")") + 2] === "Z" && fs.readdirSync(`/proc/${pid}/task`).length === 1;
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error;
      return true;
    }
  });
  if (!threadReaps) return;
  // The thread posts each exit before it waits for the next process. So the exit has been posted
  // once the thread has reaped a second child that ended after the first was reaped.
  blockUntil("the thread to reap the child", () => isReaped(pid));
  const next = spawn("cat", [], { stdio: ["pipe", "ignore", "ignore"] });
  children.push(next);
  next.kill("SIGKILL");
  blockUntil("the thread to reap the next child", () => isReaped(next.pid));
}

async function runThisFile(command, args, env) {
  const run = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  run.stdout.on("data", chunk => (output += chunk));
  run.stderr.on("data", chunk => (output += chunk));
  const [code] = await once(run, "close");
  return { code, output: code === 0 ? "" : output };
}

// The rerun with a reaping thread. It starts here, so that it runs beside the cases below.
const rerun =
  process.versions.bun &&
  hasProc &&
  !threadReaps &&
  runThisFile(process.execPath, ["test", __filename], {
    ...process.env,
    BUN_FEATURE_FLAG_FORCE_WAITER_THREAD: "1",
    // The flag is only read together with this one.
    BUN_GARBAGE_COLLECTOR_LEVEL: process.env.BUN_GARBAGE_COLLECTOR_LEVEL || "0",
  });

async function forkChild() {
  const closed = newFlag();
  const child = fork(__filename, ["child", closed], { stdio: ["ignore", "pipe", "inherit", "ipc"] });
  children.push(child);
  const events = [];
  child.on("disconnect", () => events.push("disconnect"));
  child.on("exit", () => events.push("exit"));
  await once(child.stdout, "data");
  return { child, closed, events };
}

test("the child closes its end of the channel and is then killed", async () => {
  const { child, closed, events } = await forkChild();
  child.send("close your end");
  blockUntil("the child to close the channel", () => fs.existsSync(closed));
  child.kill("SIGKILL");
  blockUntilDead(child.pid);
  await once(child, "close");
  assert.deepStrictEqual(events, ["disconnect", "exit"]);
});

test("the child is killed with a message from the parent possibly still unread", async () => {
  const { child, events } = await forkChild();
  child.send("may never be read");
  child.kill("SIGKILL");
  blockUntilDead(child.pid);
  await once(child, "close");
  assert.deepStrictEqual(events, ["disconnect", "exit"]);
});

test("the child sends a message and exits on its own", async () => {
  const parentIsBusy = newFlag();
  const child = fork(__filename, ["child-that-exits", parentIsBusy]);
  children.push(child);
  const events = [];
  const closed = Promise.withResolvers();
  child.on("message", message => {
    events.push(`message:${message}`);
    try {
      // The child exits once it sees this file. Staying in the listener until it is dead leaves
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

// Forks a child that sends "first", and "last" once the parent is inside its listener for "first".
// The parent stays there until the child is dead. That leaves the last message, the channel's end
// and the exit all pending. Returns the events in their order.
async function eventsOfALastMessage(role, onMessage, ...args) {
  const parentIsBusy = newFlag();
  const child = fork(__filename, [role, parentIsBusy, ...args]);
  children.push(child);
  const events = [];
  const failed = Promise.withResolvers();
  child.on("message", (message, handle) => {
    try {
      if (message === "first") {
        fs.writeFileSync(parentIsBusy, "");
        blockUntilDead(child.pid);
      }
      return onMessage(events, message, handle, child);
    } catch (error) {
      failed.reject(error);
    }
  });
  child.on("error", error => events.push(`error:${error.code}`));
  child.on("disconnect", () => events.push("disconnect"));
  child.on("exit", code => events.push(`exit:${code}`));
  // Not 'close': node emits none after a disconnect() of the parent's.
  await Promise.race([failed.promise, Promise.all([once(child, "disconnect"), once(child, "exit")])]);
  return events;
}

// The last message comes before 'exit' everywhere. Bun then emits 'disconnect' before 'exit'. So
// does node up to libuv 1.51 (node 22). From libuv 1.52 (node 24.16, 26) node finds the end of the
// channel one loop turn after the message, and emits 'disconnect' after 'exit' and 'close':
// https://github.com/libuv/libuv/commit/2e2114ed8957a0124bc629c61d034c387b8ce42a
function assertTheLastMessageIsFirst(events) {
  const exitFirst = !process.versions.bun && events.indexOf("exit:0") < events.indexOf("disconnect");
  const end = exitFirst ? ["exit:0", "disconnect"] : ["disconnect", "exit:0"];
  assert.deepStrictEqual(events, ["message:first", "message:last", ...end]);
}

// Not on Windows: there the pipe's data and the exit reach the loop through one completion queue,
// and the exit is queued first when the parent was busy.
const withALastMessage = { skip: process.platform === "win32" };

test("the child sends a last message and exits while the parent is busy", withALastMessage, async () => {
  const record = (events, message) => void events.push(`message:${message}`);
  assertTheLastMessageIsFirst(await eventsOfALastMessage("child-with-a-last-message", record));
});

test("a listener that awaits has the last message before 'exit'", withALastMessage, async () => {
  const record = async (events, message) => {
    await null;
    events.push(`message:${message}`);
  };
  assertTheLastMessageIsFirst(await eventsOfALastMessage("child-with-a-last-message", record));
});

// The parent listens on what it is handed before it emits the message. That is done before 'exit' too.
for (const [kind, name] of [
  ["Server", "server"],
  ["Socket", "datagram socket"],
]) {
  test(`the child's last message carries a ${name}`, withALastMessage, async () => {
    const record = (events, message, handle) => {
      events.push(`message:${message}${handle ? ` with a ${handle.constructor.name}` : ""}`);
      handle?.close();
    };
    const events = await eventsOfALastMessage("child-with-a-last-handle", record, kind);
    assertTheLastMessageIsFirst(events.map(event => event.replace(` with a ${kind}`, "")));
    assert.ok(events.includes(`message:last with a ${kind}`), events.join(", "));
  });
}

// The channel is open to the parent then, whether or not the child is dead already, so its
// disconnect() is no error.
test("the parent disconnects when it gets the child's last message", withALastMessage, async () => {
  const record = (events, message, handle, child) => {
    events.push(`message:${message}`);
    if (message === "last") child.disconnect();
  };
  const events = await eventsOfALastMessage("child-with-a-last-message", record);
  assert.deepStrictEqual(events, ["message:first", "message:last", "disconnect", "exit:0"]);
});

// node:cluster acts on the 'exit' of a worker: it drops the worker, and it hands a connection that
// the worker has not taken yet to another worker. What the worker sent before it died has to come
// before that.
const view = worker =>
  `in cluster.workers: ${cluster.workers[worker.id] === worker}, connected: ${worker.isConnected()}, dead: ${worker.isDead()}`;

test("a worker's last message comes for a worker that the primary still has", withALastMessage, async () => {
  const primaryIsBusy = newFlag();
  cluster.setupPrimary({ exec: __filename, args: ["child-with-a-last-message", primaryIsBusy] });
  const worker = cluster.fork();
  children.push(worker.process);
  const seen = [];
  worker.on("message", message => {
    seen.push(`message:${message} (${view(worker)})`);
    if (message !== "first") return;
    fs.writeFileSync(primaryIsBusy, "");
    blockUntilDead(worker.process.pid);
  });
  await Promise.all([once(worker, "exit"), once(worker, "disconnect")]);
  assert.deepStrictEqual(seen, [
    "message:first (in cluster.workers: true, connected: true, dead: false)",
    "message:last (in cluster.workers: true, connected: true, dead: false)",
  ]);
  assert.strictEqual(cluster.workers[worker.id], undefined);
});

test("a worker that dies as it starts is 'online' before it is gone", withALastMessage, async () => {
  const primaryIsBusy = newFlag();
  cluster.setupPrimary({ exec: __filename, args: ["worker-that-dies-as-it-starts", primaryIsBusy] });
  const worker = cluster.fork();
  children.push(worker.process);
  const seen = [];
  worker.on("online", () => seen.push(`online (${view(worker)})`));
  worker.on("exit", code => seen.push(`exit:${code}`));
  const gone = Promise.all([once(worker, "exit"), once(worker, "disconnect")]);
  // The worker has told the primary that it is online, and exits once it sees this file.
  fs.writeFileSync(primaryIsBusy, "");
  blockUntilDead(worker.process.pid);
  await gone;
  assert.deepStrictEqual(seen, ["online (in cluster.workers: true, connected: true, dead: false)", "exit:3"]);
  assert.strictEqual(cluster.workers[worker.id], undefined);
});

// Only in Bun: node must not run this file from inside itself. Not in the rerun either.
if (process.versions.bun && !threadReaps) {
  test("the same order when a thread reaps the child", { skip: !hasProc, timeout: 60_000 }, async () => {
    assert.deepStrictEqual(await rerun, { code: 0, output: "" });
  });

  const { bunEnv, nodeExeAtLeast } = require("harness");
  // Promise.withResolvers came with node 22.
  const node = nodeExeAtLeast("22.0.0");
  test("all tests pass in Node.js", { skip: !node }, async () => {
    assert.deepStrictEqual(await runThisFile(node, [__filename], bunEnv), { code: 0, output: "" });
  });
}
