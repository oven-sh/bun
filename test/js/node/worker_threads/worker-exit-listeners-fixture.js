// `bun worker-exit-listeners-fixture.js <row>`: the main thread starts the row's worker and prints
// what the parent observes. What must not run writes a line to stderr.
const wt = require("node:worker_threads");
const { writeSync } = require("node:fs");

const row = process.argv[2] ?? wt.workerData.row;
const mustNotRun = what => writeSync(2, what + "\n");

// A listener that is stopped leaves its jobs behind.
function queueJobs() {
  Promise.resolve().then(() => mustNotRun("a promise job of the stopped listener"));
  queueMicrotask(() => mustNotRun("a microtask of the stopped listener"));
}

// Tell the parent that the 'exit' listener runs, then wait for a stop. The bound turns a stop that
// never comes into a line on stderr.
function parkUntilStopped() {
  const cell = wt.workerData.cell;
  queueJobs();
  Atomics.store(cell, 0, 1);
  Atomics.notify(cell, 0);
  const deadline = Date.now() + Number(process.env.PARK_MS);
  while (Date.now() < deadline) Atomics.wait(cell, 1, 0, 5);
  mustNotRun("the 'exit' listener was not stopped");
}

function stopsAt(stop) {
  process.on("exit", () => {
    queueJobs();
    stop();
    mustNotRun("the statement after the stop");
  });
  process.on("exit", () => mustNotRun("the second 'exit' listener"));
}

const throwsBoom = () => {
  throw new Error("boom");
};

const workers = {
  "process.exit(5)": () => stopsAt(() => process.exit(5)),
  "process.reallyExit(5)": () => stopsAt(() => process.reallyExit(5)),
  "process.exit() with process.exitCode = 5": () =>
    stopsAt(() => {
      process.exitCode = 5;
      process.exit();
    }),
  "a listener added in 'beforeExit'": () => process.once("beforeExit", () => stopsAt(() => process.exit(5))),
  // These two run as the first preload. The second preload does not resolve on the worker thread,
  // so the load fails with the listeners registered.
  "a preload fails to load": () => stopsAt(() => process.exit(5)),
  "a preload fails to load, then a throw": () => process.on("exit", throwsBoom),

  "terminate()": () => process.on("exit", parkUntilStopped),
  "await using": () => process.on("exit", parkUntilStopped),
  "the parent worker is terminated": () => {
    if (wt.workerData.leaf) return process.on("exit", parkUntilStopped);
    new wt.Worker(__filename, { workerData: { ...wt.workerData, leaf: true } });
    // Keeps this worker alive until the main thread terminates it.
    wt.parentPort.on("message", () => {});
  },

  "a throw": () => {
    process.on("exit", throwsBoom);
    process.on("exit", () => mustNotRun("the second 'exit' listener"));
  },
  "process.emit('error') without a listener": () =>
    process.on("exit", () => {
      process.emit("error", new Error("boom"));
      mustNotRun("the statement after process.emit('error')");
    }),
  "a throw with an 'uncaughtException' listener": () => {
    process.on("uncaughtException", error => writeSync(1, "uncaughtException " + error.message + "\n"));
    process.on("exit", throwsBoom);
  },

  // node:http2 over a JS Duplex: the 'exit' listener queues a DATA frame, and the flush that follows
  // the listeners is what would call the Duplex's write(), on a VM the parent can no longer stop.
  "a write queued for the flush after the listeners": () => {
    const { Duplex } = require("node:stream");
    let answered = false;
    let listenersDone = false;
    const transport = new Duplex({
      read() {},
      write(chunk, encoding, callback) {
        if (listenersDone) mustNotRun("Duplex.write() after the 'exit' listeners");
        if (!answered) {
          answered = true;
          // The peer's SETTINGS frame, then its acknowledgement of ours.
          this.push(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 4, 1, 0, 0, 0, 0]));
        }
        callback();
      },
    });
    const session = require("node:http2").connect("http://localhost", { createConnection: () => transport });
    session.once("remoteSettings", () => {
      const request = session.request({ ":method": "POST" });
      process.on("exit", code => {
        // The precondition: this session's frames do go through the Duplex's write().
        writeSync(1, "in 'exit' " + code + ", answered " + answered + "\n");
        request.write("x");
        listenersDone = true;
      });
    });
  },
};
workers["Worker: process.exit(5)"] = workers["process.exit(5)"];
workers["Worker: terminate()"] = workers["terminate()"];
workers["Worker: a throw"] = workers["a throw"];

if (!wt.isMainThread) {
  workers[row]();
} else {
  const cell = new Int32Array(new SharedArrayBuffer(8));
  const inExitListener = Atomics.waitAsync(cell, 0, 0).value;
  const workerData = { row, cell };
  const print = line => console.log(line);

  if (row.startsWith("Worker: ")) {
    const worker = new Worker(__filename, { workerData });
    // The message of this event is the formatted error, with its source lines.
    worker.addEventListener("error", event => print("error " + event.message.match(/^error: (.*)$/m)[1]));
    worker.addEventListener("close", event => print("close " + event.code));
    if (row === "Worker: terminate()") {
      inExitListener.then(() => {
        // Without this line, a worker whose listener never ran prints the same as one that was stopped.
        print("in 'exit'");
        worker.terminate();
      });
    }
  } else if (row === "await using") {
    (async () => {
      {
        await using worker = new wt.Worker(__filename, { workerData });
        worker.on("exit", code => print("exit " + code));
        await inExitListener;
      }
      print("disposed");
    })();
  } else {
    const failsToLoad = row.startsWith("a preload fails to load");
    const preload = failsToLoad ? [__filename, URL.createObjectURL(new Blob([""]))] : undefined;
    const worker = new wt.Worker(__filename, { workerData, preload });
    worker.on("error", error => print(failsToLoad ? "error" : "error " + error.message));
    worker.on("exit", code => print("exit " + code));
    if (row === "terminate()") inExitListener.then(async () => print("terminate " + (await worker.terminate())));
    if (row === "the parent worker is terminated") inExitListener.then(() => worker.terminate());
  }
}
