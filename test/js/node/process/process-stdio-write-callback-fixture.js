// One row of the write-callback contract: a stream, the state of its pipe, and a sequence
// of calls. Node and Bun must report the same thing for a row, so Node's report is the
// expected value. To see it:
//
//   node process-stdio-write-callback-fixture.js <stream> <state> <sequence>
//
// stream    stdout | stderr   a FIFO that only this process reads
//           child.stdin       the pipe to a child of this process
// state     idle     the pipe has room, so the sink takes each chunk at once
//           parked   the first chunk is larger than the pipe, which is read after the calls
//           failing  as parked, but the read end closes after the calls
//           broken   the read end is closed before the calls
// sequence  a key of `sequences`
//
// The report is the list of what the stream did after the calls, in order: each callback by
// name (with the code of its error), 'finish' and 'error'. A callback that ran before the
// calls returned says so.
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Writable } = require("node:stream");

// end(chunk) and code that calls Writable.prototype.write() reach the sink through
// _write(), not through the stream's own write().
const protoWrite = (stream, chunk, callback) => Writable.prototype.write.call(stream, chunk, callback);

// `first` is the chunk that decides the state. `cb(name)` makes the callback that reports
// as `name`. A sequence can return its last call, which is then made on the next turn of
// the loop. A sequence is a row in the idle, parked and failing states, or in its `states`.
// With `namesOnly`, Node and Bun agree on which callbacks run and in which order, not on
// what each one gets.
const sequences = {
  "write x3": {
    callbacks: ["w0", "w1", "w2"],
    states: ["idle", "parked", "failing", "broken"],
    run(stream, first, cb) {
      stream.write(first, cb("w0"));
      stream.write("", cb("w1"));
      stream.write("b", cb("w2"));
    },
  },
  "Writable.prototype.write x3": {
    callbacks: ["w0", "w1", "w2"],
    run(stream, first, cb) {
      protoWrite(stream, first, cb("w0"));
      protoWrite(stream, "", cb("w1"));
      protoWrite(stream, "b", cb("w2"));
    },
  },
  "write, Writable.prototype.write, write": {
    callbacks: ["w0", "w1", "w2"],
    run(stream, first, cb) {
      stream.write(first, cb("w0"));
      protoWrite(stream, "b", cb("w1"));
      stream.write("c", cb("w2"));
    },
  },
  "Writable.prototype.write, write": {
    callbacks: ["w0", "w1"],
    run(stream, first, cb) {
      protoWrite(stream, first, cb("w0"));
      stream.write("b", cb("w1"));
    },
  },
  "write, end(chunk, cb)": {
    callbacks: ["w0", "end"],
    run(stream, first, cb) {
      stream.write(first, cb("w0"));
      stream.end("b", cb("end"));
    },
  },
  "write, write, end(cb)": {
    callbacks: ["w0", "w1", "end"],
    run(stream, first, cb) {
      stream.write(first, cb("w0"));
      stream.write("b", cb("w1"));
      stream.end(cb("end"));
    },
  },
  "write, write(''), end(cb)": {
    callbacks: ["w0", "w1", "end"],
    run(stream, first, cb) {
      stream.write(first, cb("w0"));
      stream.write("", cb("w1"));
      stream.end(cb("end"));
    },
  },
  "write without a callback, write": {
    callbacks: ["w1"],
    run(stream, first, cb) {
      stream.write(first);
      stream.write("", cb("w1"));
    },
  },
  // In the broken state the write has failed by the time of uncork().
  "cork, write, write, then uncork": {
    callbacks: ["w0", "w1"],
    states: ["idle", "parked", "failing", "broken"],
    run(stream, first, cb) {
      stream.cork();
      stream.write(first, cb("w0"));
      stream.write("b", cb("w1"));
      return () => stream.uncork();
    },
  },
  // Only 'error' can report this failure.
  "write without a callback": {
    callbacks: [],
    states: ["failing"],
    run(stream, first) {
      stream.write(first);
    },
  },
  // The stream must take a write again after a write has failed. What that later write
  // reports on a pipe that is gone is not part of this contract.
  "write, then write from the 'error' listener": {
    callbacks: ["w0", "late"],
    states: ["failing"],
    namesOnly: true,
    run(stream, first, cb) {
      stream.write(first, cb("w0"));
      stream.once("error", () => stream.write("b", cb("late")));
    },
  },
  "write without a callback, then write from the 'error' listener": {
    callbacks: ["late"],
    states: ["failing"],
    namesOnly: true,
    run(stream, first, cb) {
      stream.write(first);
      stream.once("error", () => stream.write("b", cb("late")));
    },
  },
  "Writable.prototype.write, then write from the 'error' listener": {
    callbacks: ["w0", "late"],
    states: ["failing"],
    namesOnly: true,
    run(stream, first, cb) {
      protoWrite(stream, first, cb("w0"));
      stream.once("error", () => stream.write("b", cb("late")));
    },
  },
  // destroy() decides what each callback gets, and whether end() still reports.
  "write, write, destroy()": {
    callbacks: ["w0", "w1"],
    namesOnly: true,
    run(stream, first, cb) {
      stream.write(first, cb("w0"));
      stream.write("b", cb("w1"));
      stream.destroy();
    },
  },
  "write, write, end(cb), destroy()": {
    callbacks: ["w0", "w1", "end"],
    namesOnly: true,
    run(stream, first, cb) {
      stream.write(first, cb("w0"));
      stream.write("b", cb("w1"));
      stream.end(cb("end"));
      stream.destroy();
    },
  },
};

// Makes the calls of `sequence` on `stream`. Resolves with the report once the stream has
// said everything that the row can make it say.
function observe(stream, state, sequence) {
  const { callbacks, run } = sequences[sequence];
  const destroys = sequence.includes("destroy()");
  // destroy() does not owe the end() callback.
  const owed = new Set(destroys ? callbacks.filter(name => name !== "end") : callbacks);
  // The event that comes after the last callback of the row.
  const fails = state === "failing" || state === "broken";
  const last = destroys ? "close" : fails ? "error" : sequence.includes("end(") ? "finish" : null;
  const report = [];
  const { promise, resolve } = Promise.withResolvers();
  let inside = true;
  let sawLast = last === null;
  const check = () => {
    // One more turn of the loop, so that a callback that runs twice is in the report.
    if (owed.size === 0 && sawLast) setImmediate(resolve, report);
  };
  const cb = name => err => {
    report.push(`${inside ? "inside the call: " : ""}${name}${err ? `:${err.code ?? err.message}` : ""}`);
    owed.delete(name);
    check();
  };
  const saw = name => {
    if (name === last) sawLast = true;
    check();
  };
  stream.on("finish", () => (report.push("finish"), saw("finish")));
  stream.on("error", err => (report.push(`error:${err.code ?? err.message}`), saw("error")));
  stream.on("close", () => saw("close"));

  // Larger than a pipe holds, so the sink parks it.
  const lastCall = run(stream, state === "idle" ? "a" : Buffer.alloc((1 << 20) + 1, "a"), cb);
  const returned = () => {
    inside = false;
    check();
  };
  if (lastCall) setImmediate(() => (lastCall(), returned()));
  else returned();
  return promise;
}

// A row on the stdin of a child. The child reads at once, starts to read when told, or
// closes its end: when told, or at once. It stays alive, so that a failure comes from the
// pipe and not from the exit of the child.
async function childStdinRow(state, sequence, execPath = process.execPath, env = process.env) {
  const script = {
    idle: "process.stdin.resume()",
    parked: "process.on('message', () => process.stdin.resume())",
    failing: "process.on('message', () => require('node:fs').closeSync(0))",
    broken: "require('node:fs').closeSync(0); process.on('message', () => {}); process.send('closed')",
  }[state];
  const child = spawn(execPath, ["-e", script], { env, stdio: ["pipe", "ignore", "inherit", "ipc"] });
  try {
    if (state === "broken") await once(child, "message");
    const report = observe(child.stdin, state, sequence);
    if (state === "parked" || state === "failing") child.send("the calls are made");
    return await report;
  } finally {
    child.kill();
  }
}

// A row on process.stdout or process.stderr of this process.
function stdioRow(name, state, sequence) {
  // A row that cannot finish must not outlive the test that waits for it by much.
  setTimeout(() => process.exit(1), 30_000);
  // Held from the start, so that the pipe has a reader until this process decides otherwise.
  const readFd = fs.openSync(process.env.BUN_TEST_FIFO, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  if (state === "broken") fs.closeSync(readFd);
  observe(process[name], state, sequence).then(report => {
    fs.writeSync(name === "stdout" ? 2 : 1, JSON.stringify(report) + "\n");
    process.exit(0);
  });
  if (state === "failing") fs.closeSync(readFd);
  // Another process reads the pipe. A read of an empty FIFO from this process would hold
  // a thread, and an exit that tears the VM down waits for that thread.
  if (state === "parked") spawn("cat", [process.env.BUN_TEST_FIFO], { stdio: "ignore" }).unref();
}

// Without a FIFO from the caller: make one, and run the row in a child whose stream is
// its write end.
function stdioRowOnNewFifo(stream, state, sequence) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "write-callback-"));
  const fifo = path.join(dir, "fifo");
  if (spawnSync("mkfifo", [fifo]).status !== 0) throw new Error("mkfifo failed");
  // Opened for reading first so that the open for writing does not block.
  const readFd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  const writeFd = fs.openSync(fifo, fs.constants.O_WRONLY);
  const stdio = stream === "stderr" ? ["ignore", "inherit", writeFd] : ["ignore", writeFd, "inherit"];
  const child = spawn(process.execPath, [__filename, stream, state, sequence], {
    env: { ...process.env, BUN_TEST_FIFO: fifo },
    stdio,
  });
  // The child is the only reader and the only writer from here on.
  fs.closeSync(writeFd);
  fs.closeSync(readFd);
  child.on("exit", code => {
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(code ?? 1);
  });
}

module.exports = { childStdinRow, sequences };

if (require.main === module) {
  const [stream, state, sequence] = process.argv.slice(2);
  if (stream === "child.stdin") {
    childStdinRow(state, sequence).then(report => {
      console.log(JSON.stringify(report));
      process.exit(0);
    });
  } else if (process.env.BUN_TEST_FIFO) {
    stdioRow(stream, state, sequence);
  } else {
    stdioRowOnNewFifo(stream, state, sequence);
  }
}
