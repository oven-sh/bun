// When does a message on a worker's stdio port reach the other thread, and in which order? Both
// threads gate on a SharedArrayBuffer, never on time: the parent thread blocks until the worker
// reports, so no message but those that were already queued for the worker can arrive in between.
//
// Main thread: `<mode> ...args` prints one JSON object. Worker thread: runs workerData.mode.
// The file runs under node as well, and the tests expect the same output from both.
const {
  Worker,
  isMainThread,
  workerData,
  parentPort,
  MessageChannel,
  BroadcastChannel,
  postMessageToThread,
} = require("node:worker_threads");
const { once } = require("node:events");
const fs = require("node:fs");

const REQUESTED = 0; // the parent has posted its request for data (or its stdin chunk)
const REPORTED = 1; // the worker has reported
const ACKED = 2; // the callback of the worker's first write had run when the worker reported
const FIRST = 3; // "uncaught": 1 when the 'uncaughtException' handler ran first, 2 when the write callback did
const VALUE = 4; // "stdin": process.stdin.readableLength in the entry, after the parent wrote its chunk

// How long the parent thread waits for a report that a build without the fix never makes.
const REPORT_TIMEOUT = Number(process.env.WORKER_STDIO_REPORT_TIMEOUT) || 30_000;

const flagsOf = data => new Int32Array(data.sab);
const set = (flags, index, value) => {
  Atomics.store(flags, index, value);
  Atomics.notify(flags, index);
};
const nextTick = () => new Promise(resolve => process.nextTick(resolve));

// What a cell of "first-turn" writes and reports with. Waits until the parent has asked for data.
function begin() {
  const flags = flagsOf(workerData);
  Atomics.wait(flags, REQUESTED, 0);
  let acked = false;
  // The worker takes the snapshot: what the parent reads after it wakes is later than the report.
  const report = () => {
    Atomics.store(flags, ACKED, acked ? 1 : 0);
    set(flags, REPORTED, 1);
  };
  const write = callback =>
    process[workerData.stream].write("x\n", () => {
      acked = true;
      Atomics.compareExchange(flags, FIRST, 0, 2);
      callback?.();
    });
  // The report comes one immediate after the write: a request that completes the write at the end
  // of the turn has been handled by then.
  const writeThenReport = () => {
    write();
    setImmediate(report);
  };
  return { flags, report, write, writeThenReport };
}

// A worker's entry, up to its first write. The cell is where that write comes from.
function firstWrite() {
  const { flags, report, write, writeThenReport } = begin();
  switch (workerData.cell) {
    case "sync":
      return writeThenReport();
    case "nextTick":
      return process.nextTick(writeThenReport);
    case "microtask":
      return void Promise.resolve().then(writeThenReport);
    case "reportsFromCallback":
      return void write(report);
    case "setImmediate":
      return void setImmediate(writeThenReport);
    case "timer":
      return void setTimeout(writeThenReport, 1);
    case "fs":
      return fs.readFile(__filename, writeThenReport);
    case "userPort":
      return void workerData.port.once("message", () => {
        workerData.port.close();
        writeThenReport();
      });
    case "portClose": {
      const keepAlive = setInterval(() => {}, 1 << 30);
      const { port1 } = new MessageChannel();
      port1.once("close", () => {
        clearInterval(keepAlive);
        writeThenReport();
      });
      return port1.close();
    }
    case "parentPort":
      return void parentPort.once("message", writeThenReport);
    case "workerMessage": {
      // node does not keep a thread alive for a message of postMessageToThread().
      const keepAlive = setInterval(() => {}, 1 << 30);
      return void process.once("workerMessage", () => {
        clearInterval(keepAlive);
        writeThenReport();
      });
    }
    case "broadcastChannel": {
      const receiver = new BroadcastChannel("first-turn-" + process.pid);
      const sender = new BroadcastChannel("first-turn-" + process.pid);
      receiver.onmessage = () => {
        receiver.close();
        sender.close();
        writeThenReport();
      };
      return sender.postMessage(1);
    }
    // The parent posted a stdin chunk and its request for data, in the order the cell names.
    case "stdinThenRequest":
    case "requestThenStdin":
      return void process.stdin.once("data", writeThenReport);
    case "uncaught":
      process.on("uncaughtException", () => Atomics.compareExchange(flags, FIRST, 0, 1));
      writeThenReport();
      throw new Error("thrown by the entry");
    default:
      throw new Error("unknown cell " + workerData.cell);
  }
}

function workerMain() {
  if (workerData.mode === "first-turn") return firstWrite();
  const flags = flagsOf(workerData);
  Atomics.wait(flags, REQUESTED, 0);
  const report = () => set(flags, REPORTED, 1);
  switch (workerData.mode) {
    case "stdin":
      Atomics.store(flags, VALUE, process.stdin.readableLength);
      return void process.stdin.resume();
    case "exits-while-parent-blocked":
      process.on("exit", report);
      return void process[workerData.stream].write("the only batch\n");
    case "stream-order":
      // "oeo" writes "o0" to stdout, "e1" to stderr, "o2" to stdout.
      [...workerData.pattern].forEach((letter, index) =>
        process[letter === "o" ? "stdout" : "stderr"].write(letter + index),
      );
      return void setImmediate(report);
    case "ends-on-message":
      console.log("first");
      console.log("second");
      console.log("third");
      parentPort.postMessage("done");
      return void setImmediate(report);
  }
}

function spawnWorker(entry, data, options) {
  const sab = new SharedArrayBuffer(32);
  options = { ...options, workerData: { ...data, sab } };
  // `preload` is an option of Bun. node runs the entry alone.
  if (entry === "preloaded") options.preload = ["node:path"];
  const worker =
    entry === "eval"
      ? new Worker(`require(${JSON.stringify(__filename)}).workerMain();`, { ...options, eval: true })
      : new Worker(entry === "esm" ? __filename.replace(/\.cjs$/, ".mjs") : __filename, options);
  return [worker, new Int32Array(sab)];
}

// Opens the worker's gate once this thread has asked for data, then blocks until the worker reports.
async function untilReported(flags) {
  // An auto-piped stream, and one with a 'data' listener, starts to flow in a nextTick of the
  // constructor's tick: that is when it posts its request.
  await nextTick();
  set(flags, REQUESTED, 1);
  return Atomics.wait(flags, REPORTED, 0, REPORT_TIMEOUT) !== "timed-out";
}

// The parent asks for data in the constructor's tick, then blocks until the worker reports.
async function firstTurn([stream, entry, capture, ...cells]) {
  const captured = capture === "captured";
  const results = {};
  for (const cell of cells) {
    const user = new MessageChannel();
    user.port1.postMessage("queued before the worker starts");
    const stdin = cell === "stdinThenRequest" || cell === "requestThenStdin";
    const [worker, flags] = spawnWorker(
      entry,
      { mode: "first-turn", cell, stream, port: user.port2 },
      { stdin, stdout: captured, stderr: captured, transferList: [user.port2] },
    );
    const exited = once(worker, "exit");
    if (cell === "parentPort") worker.postMessage("queued before the worker starts");
    if (cell === "workerMessage")
      postMessageToThread(worker.threadId, "queued before the worker starts").catch(() => {});
    if (cell === "stdinThenRequest") worker.stdin.write("a chunk");
    // read(0) calls _read(), which posts the request.
    if (captured) worker[stream].read(0);
    if (cell === "requestThenStdin") worker.stdin.write("a chunk");
    const reported = await untilReported(flags);
    let result = !reported ? "no report" : Atomics.load(flags, ACKED) ? "acked" : "withheld";
    if (cell === "uncaught") result += Atomics.load(flags, FIRST) === 1 ? ", handler first" : ", callback first";
    results[cell] = result;
    if (captured) worker[stream].resume();
    if (stdin) worker.stdin.end();
    user.port1.close();
    const [code] = await exited;
    if (code !== 0) results[cell] += `, exit code ${code}`;
  }
  return results;
}

// The parent stops reading in the middle of the worker's output.
async function stopReading() {
  const big = `const chunk = Buffer.alloc(128 * 1024, "x");`;
  const loop = `${big} for (let i = 0; i < 40; i++) process.stdout.write(chunk);`;
  const threeBatches = `${big} process.stdout.write(chunk, () => { for (let i = 0; i < 39; i++) process.stdout.write(chunk); });`;
  // Each write waits for the callback of the one before: a batch is always in flight.
  const chain = `${big} const { parentPort } = require("node:worker_threads");
    let done = 0;
    (function next() { if (done < 40) process.stdout.write(chunk, () => { done++; next(); }); })();
    parentPort.on("message", () => parentPort.postMessage(done));`;
  const gate = `Atomics.wait(new Int32Array(require("node:worker_threads").workerData), 0, 0);`;
  const start = source => {
    const sab = new SharedArrayBuffer(4);
    const worker = new Worker(gate + source, { eval: true, stdout: true, workerData: sab });
    return [worker, () => set(new Int32Array(sab), 0, 1)];
  };
  const twoMiB = 2 * 1024 * 1024;
  const afterTwoMiB = (stream, stop) => {
    let seen = 0;
    stream.on("data", chunk => {
      if (seen < twoMiB && (seen += chunk.length) >= twoMiB) stop();
    });
  };
  const breakAfterTwoMiB = async stream => {
    let seen = 0;
    for await (const chunk of stream) if ((seen += chunk.length) >= twoMiB) break;
  };
  // The worker's last batch is acked before the parent stops: the worker exits by itself, as in node.
  const exits = async (source, stop) => {
    const [worker, open] = start(source);
    worker.stdout.read(0);
    open();
    stop(worker.stdout);
    return (await once(worker, "exit"))[0];
  };
  // A batch is in flight when the parent stops, or the parent never asked: node keeps the worker
  // waiting as well, and terminate() ends it. The worker is one write ahead of the 16 chunks of
  // 128 KiB that the parent read.
  const staysParked = async (source, stop) => {
    const [worker, open] = start(source);
    stop(worker.stdout);
    open();
    await once(worker.stdout, "close");
    worker.postMessage("how many writes are done?");
    const [writesDone] = await once(worker, "message");
    return { writesDone, terminateCode: await worker.terminate() };
  };
  const shapes = {
    destroy: exits(loop, stream => afterTwoMiB(stream, () => stream.destroy())),
    forAwaitBreak: exits(loop, breakAfterTwoMiB),
    threeBatchesBreak: exits(threeBatches, breakAfterTwoMiB),
    pause: exits(loop, stream => afterTwoMiB(stream, () => stream.pause())),
    chainDestroy: staysParked(chain, stream => {
      stream.read(0);
      afterTwoMiB(stream, () => stream.destroy());
    }),
    destroyBeforeOutput: staysParked(chain, stream => stream.destroy()),
  };
  const results = {};
  for (const name in shapes) results[name] = "the worker is still alive";
  // Only a build that parks one of these workers gets here: say which, and do not wait for the test to time out.
  const watchdog = setTimeout(() => {
    console.log(JSON.stringify(results));
    process.exit(1);
  }, 2 * REPORT_TIMEOUT);
  await Promise.all(Object.keys(shapes).map(async name => (results[name] = await shapes[name])));
  clearTimeout(watchdog);
  return results;
}

// A chunk written to worker.stdin in the constructor's tick reaches process.stdin after the entry's
// first turn. Nothing reads stdout or stderr, so the chunk is the only stdio message queued.
async function stdin() {
  const [worker, flags] = spawnWorker("eval", { mode: "stdin" }, { stdin: true, stdout: true, stderr: true });
  worker.stdin.end("a chunk");
  set(flags, REQUESTED, 1);
  const [code] = await once(worker, "exit");
  return { readableLengthInTheEntry: Atomics.load(flags, VALUE), code };
}

// A request for data that finds no worker.stdin write in flight is dropped, and does not complete
// a write that comes later.
async function stdinStaleRequest() {
  const sab = new SharedArrayBuffer(4);
  const worker = new Worker(
    `const { workerData, parentPort } = require("node:worker_threads");
     process.stdin.on("data", () => {});
     // The nextTick that on("data") queued has run by the first immediate: _read() posted the request.
     setImmediate(() => {
       parentPort.postMessage("reading");
       Atomics.wait(new Int32Array(workerData), 0, 0);
     });`,
    { eval: true, stdin: true, workerData: sab },
  );
  await once(worker, "message");
  let completed = false;
  worker.stdin.write("a chunk", () => {
    completed = true;
    worker.stdin.end();
  });
  // A message to this thread is dispatched after everything that was already queued for it.
  const self = new MessageChannel();
  self.port1.postMessage(0);
  await once(self.port2, "message");
  self.port2.close();
  const completedWhileWorkerBlocked = completed;
  set(new Int32Array(sab), 0, 1);
  const [code] = await once(worker, "exit");
  return { completedWhileWorkerBlocked, completed, code };
}

// A worker that writes one batch and has nothing else to do ends while the parent thread is
// blocked, and the parent still reads all of it.
async function exitsWhileParentBlocked([stream, capture]) {
  const captured = capture === "captured";
  const [worker, flags] = spawnWorker(
    "eval",
    { mode: "exits-while-parent-blocked", stream },
    { stdout: captured, stderr: captured },
  );
  let output = "";
  if (captured) worker[stream].setEncoding("utf8").on("data", chunk => (output += chunk));
  const exited = once(worker, "exit");
  const exitedWhileParentBlocked = await untilReported(flags);
  const [code] = await exited;
  return { exitedWhileParentBlocked, output, code };
}

// The order in which the first-turn writes of a worker to stdout and stderr reach the parent: each
// stream has one batch in flight, and the two share one channel.
async function streamOrder([capture, ...patterns]) {
  const captured = capture === "captured";
  const results = {};
  for (const pattern of patterns) {
    const arrived = [];
    const [worker, flags] = spawnWorker(
      "eval",
      { mode: "stream-order", pattern },
      { stdout: captured, stderr: captured },
    );
    // An auto-piped stream of the worker writes to the stream of this process with the same name.
    const own = [process.stdout, process.stderr];
    const writes = own.map(stream => stream.write);
    if (captured) {
      for (const stream of [worker.stdout, worker.stderr])
        stream.setEncoding("utf8").on("data", chunk => arrived.push(chunk));
    } else {
      for (const stream of own) stream.write = chunk => arrived.push(String(chunk));
    }
    const exited = once(worker, "exit");
    await untilReported(flags);
    await exited;
    own.forEach((stream, index) => (stream.write = writes[index]));
    results[pattern] = arrived.join(" ");
  }
  return results;
}

// The parent ends itself, or the worker, on the message that the worker posts after its output.
// Prints no JSON: the output of the worker is the result.
async function endsOnMessage([how]) {
  const [worker, flags] = spawnWorker("eval", { mode: "ends-on-message" }, {});
  worker.on("message", () => (how === "exit" ? process.exit(0) : worker.terminate()));
  await untilReported(flags);
}

// An uncaught error in the first turn of a worker: the worker ends with the code that its 'exit'
// handler set.
async function exitCode() {
  const run = source => {
    const worker = new Worker(`process.on("exit", () => { process.exitCode = 42; }); ${source}`, {
      eval: true,
      stdout: true,
    });
    worker.stdout.resume();
    let thrown;
    worker.on("error", error => (thrown = error.message));
    return new Promise(resolve => worker.on("exit", code => resolve(`${thrown}, exit code ${code}`)));
  };
  return {
    writeCallback: await run(`process.stdout.write("x", () => { throw new Error("thrown by the write callback"); });`),
    nextTick: await run(`process.nextTick(() => { throw new Error("thrown by the tick"); });`),
  };
}

// A message of postMessageToThread() that is queued for a worker when its entry calls
// process.exit(): no 'workerMessage' listener runs after the 'exit' handlers.
async function workerMessageAfterExit([capture]) {
  const captured = capture === "captured";
  const sab = new SharedArrayBuffer(8);
  const flags = new Int32Array(sab);
  const worker = new Worker(
    `const flags = new Int32Array(require("node:worker_threads").workerData);
     Atomics.wait(flags, 0, 0);
     process.on("workerMessage", () => Atomics.store(flags, 1, 1));
     process.exit(3);`,
    { eval: true, workerData: sab, stdout: captured, stderr: captured },
  );
  postMessageToThread(worker.threadId, "queued before the worker starts").catch(() => {});
  set(flags, 0, 1);
  const [code] = await once(worker, "exit");
  return { listenerRan: Atomics.load(flags, 1) === 1, code };
}

if (require.main === module) {
  if (isMainThread) {
    const [mode, ...args] = process.argv.slice(2);
    const modes = {
      "first-turn": firstTurn,
      "stop-reading": stopReading,
      "stdin": stdin,
      "stdin-stale-request": stdinStaleRequest,
      "exits-while-parent-blocked": exitsWhileParentBlocked,
      "stream-order": streamOrder,
      "ends-on-message": endsOnMessage,
      "exit-code": exitCode,
      "workerMessage-after-exit": workerMessageAfterExit,
    };
    modes[mode](args).then(result => result !== undefined && console.log(JSON.stringify(result)));
  } else {
    workerMain();
  }
}

module.exports = { begin, workerMain };
