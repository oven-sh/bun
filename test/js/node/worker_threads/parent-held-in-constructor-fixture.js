// The parent of one node:worker_threads Worker, held inside `new Worker()` until the worker has ended.
//
// The hold starts at the first listener the constructor adds after it started the thread. Today that is
// the 'message' listener of the stdout port. It ends when the worker ran its process 'exit' listeners.
// On Linux it also waits until the worker's thread has left /proc/self/task: a thread that cannot turn
// its event loop sees there that another thread has ended, and so that the worker has queued everything
// it had for this thread, its exit included.
//
// The hold proves something only while it sits at or before the listeners of the ports under test. The
// "no-early-start" runs check that: they take MessagePort.prototype.start away from `new Worker()`, and
// the tests expect the worker's output and messages to come late or not at all there.
//
//   argv[2]   the worker's source
//   argv[3]   "capture": { stdout: true, stderr: true }. What the two streams delivered by 'error' and
//             by 'exit' is printed as one JSON line.
//             "stdout" | "stderr": the worker's output is piped, as by default. 'error' and 'exit' are
//             marked on that stream, so the marks stay in order with the output.
//             "messages": the 'message', 'error' and 'exit' events are printed in order as one JSON
//             line, each 'message' with the Worker's state ("live" or "ended") inside the listener.
//   argv[4..] "no-early-start", see above.
//             "terminate": with "messages", the first 'message' listener calls worker.terminate().
//             "values": with "messages", each 'message' is printed without the Worker's state.
//             "keeper": workerData.keeper is a port. The parent keeps open what the worker posts on it.
const { existsSync, writeSync } = require("node:fs");

const workerSource = process.argv[2];
const mode = process.argv[3];
const flags = process.argv.slice(4);

const nativeStart = MessagePort.prototype.start;
if (flags.includes("no-early-start")) MessagePort.prototype.start = function () {};
const { Worker, MessageChannel } = require("node:worker_threads");

// [0] becomes 1 when the worker ran its 'exit' listeners. [1] is the worker's thread id (Linux).
const shared = new Int32Array(new SharedArrayBuffer(8));
const announce = `{
  const shared = new Int32Array(require("node:worker_threads").workerData.shared);
  process.on("exit", () => {
    Atomics.store(shared, 0, 1);
    Atomics.notify(shared, 0);
  });
  if (process.platform === "linux") {
    Atomics.store(shared, 1, Number(require("node:fs").readlinkSync("/proc/thread-self").split("/").pop()));
  }
}\n`;

const deadline = Date.now() + Number(process.env.WORKER_HOLD_BUDGET_MS);
function giveUp(stage) {
  writeSync(2, `the parent is still held inside new Worker(): ${stage}\n`);
  process.exit(1);
}

let threadStarted = false;
let held = false;
const workerData = {
  shared: shared.buffer,
  // Read while `new Worker()` serializes workerData, which is the last step before it starts the thread.
  get threadStartsNow() {
    threadStarted = true;
    return true;
  },
};

const addEventListener = EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener = function (...args) {
  if (threadStarted && !held) {
    held = true;
    if (Atomics.wait(shared, 0, 0, deadline - Date.now()) === "timed-out") {
      giveUp("the worker did not run its 'exit' listeners");
    }
    if (process.platform === "linux") {
      const task = "/proc/self/task/" + Atomics.load(shared, 1);
      const pause = new Int32Array(new SharedArrayBuffer(4));
      while (existsSync(task)) {
        if (Date.now() > deadline) giveUp("the worker's thread is still in /proc/self/task");
        Atomics.wait(pause, 0, 0, 1);
      }
    }
  }
  return addEventListener.apply(this, args);
};

const transferList = [];
const kept = [];
if (flags.includes("keeper")) {
  const { port1, port2 } = new MessageChannel();
  port1.on("message", port => {
    kept.push(port);
    port1.close();
  });
  workerData.keeper = port2;
  transferList.push(port2);
}

const capture = mode === "capture";
const worker = new Worker(announce + workerSource, {
  eval: true,
  workerData,
  transferList,
  stdout: capture,
  stderr: capture,
});
EventTarget.prototype.addEventListener = addEventListener;
MessagePort.prototype.start = nativeStart;
if (!held) throw new Error("`new Worker()` added no listener after it started the thread, so the parent was not held");

if (capture) {
  const seen = { out: "", err: "" };
  let atError = null;
  worker.stdout.setEncoding("utf8").on("data", chunk => (seen.out += chunk));
  worker.stderr.setEncoding("utf8").on("data", chunk => (seen.err += chunk));
  worker.on("error", () => (atError = { ...seen }));
  worker.on("exit", code => console.log(JSON.stringify({ atError, atExit: seen, code })));
} else if (mode === "messages") {
  const events = [];
  let terminated = "not called";
  worker.on("message", value => {
    const state = flags.includes("values") ? "" : worker.threadId === -1 ? " ended" : " live";
    events.push(`message ${value}${state}`);
    if (flags.includes("terminate") && terminated === "not called") {
      terminated = "pending";
      worker.terminate().then(code => (terminated = `resolved ${code}`));
    }
  });
  worker.on("error", () => events.push("error"));
  worker.on("exit", code => events.push(`exit ${code}`));
  // Not at 'exit': a terminate() that is still pending then would look the same as one that settles next.
  process.on("exit", () => console.log(JSON.stringify({ events, terminated })));
} else {
  worker.on("error", () => process[mode].write("[error]\n"));
  worker.on("exit", code => process[mode].write(`[exit ${code}]\n`));
}
