// usage: stdio-handshake-reader-fixture.js <source> <consumer> <dir> <count> [fifo=<path>] [block=<bytes>] [highWaterMark=<n>] [handler=<event>] [at=<i>] [readOn]
//
// Reads the output of stdio-handshake-writer-fixture.js through <source>. The writer sends
// item i+1 only after this process acknowledged item i, and each consumer waits,
// inside the event that delivered item i, until item i+1 is in the pipe. So the next
// bytes are always readable while the consumer still runs, with no timing involved.
//
// <consumer>:
//   data               a 'data' listener that is detached from each chunk until the next setImmediate
//   pause              the same, and the stream is paused until that setImmediate
//   data-leave         `data`, and the writer exits behind its last item, while the listener for the
//                      item before runs
//   readable           a 'readable' listener that reads exactly what is buffered
//   readable-later     a 'readable' listener that reads what is buffered in the next setImmediate.
//                      It counts bytes, so it also takes blocks.
//   once:<rounds>      a loop of `await once(stream, "data")` that waits <rounds> more times for a
//                      nextTick before it listens again. It counts bytes, so it also takes blocks.
//   exit               the writer sends its last item and a tail on its other stream, and exits,
//                      while a 'data' listener runs. Prints the events in order.
//   exit-nested        `exit` without the tail, and the listener of the last item waits for the
//                      report of the exit in a nested turn of the event loop
//   exit-stopped       the writer sends its last block and exits while the stream holds a full
//                      buffer that nothing reads. Prints how many bytes had arrived at each
//                      report of the exit.
//   exit-stopped-late  the same, and two blocks are in the pipe before the stream is first read
//   exit-bytes         the writer sends its last block and exits while a 'data' listener runs.
//                      Prints how many bytes had arrived at the report of the exit.
//   exit-grandchild    the same count, but the child exits at once, and its child writes the
//                      blocks. Nothing reads before that exit and two blocks are there.
//   throw              a 'data' listener that throws once, at item <i> (the last one by default),
//                      and keeps each chunk. Prints what the process listener for <event> got, and
//                      whether each kept chunk still has its bytes. With `readOn` that listener
//                      reads the stream again. It counts bytes, so it also takes blocks.
//   throw-leave        `throw`, and the writer exits behind its last item, while the listener for
//                      the item before runs
const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const [source, consumer, dir, count, ...rest] = process.argv.slice(2);
const options = Object.fromEntries(rest.map(option => option.split("=")));
const COUNT = Number(count);
const writer = path.join(__dirname, "stdio-handshake-writer-fixture.js");
const writerOptions = options.block ? [`block=${options.block}`] : [];
const readableOptions = options.highWaterMark ? { highWaterMark: Number(options.highWaterMark) } : undefined;
const nap = new Int32Array(new SharedArrayBuffer(4));
const deadline = Date.now() + 30_000;

function waitFor(ready, failure) {
  while (!ready()) {
    if (Date.now() > deadline) {
      console.error(`reader: ${failure}`);
      process.exit(2);
    }
    Atomics.wait(nap, 0, 0, 1);
  }
}

const waitForFile = name => waitFor(() => fs.existsSync(`${dir}/${name}`), `the writer never created ${name}`);

// Tells the writer that item i arrived, then blocks until item i+1 is in the pipe.
function acknowledge(i) {
  fs.writeFileSync(`${dir}/got${i}`, "");
  if (i + 1 < COUNT) waitForFile(`wrote${i + 1}`);
}

// With this flag a thread of Bun waits for each child and reports its exit to the event loop.
const threadWaitsForChildren = process.env.BUN_FEATURE_FLAG_FORCE_WAITER_THREAD === "1";

// Whether the child has exited and this thread has not seen that yet. The event loop sees
// the exit of a child once every thread of the child is gone. On Linux the child is then
// a zombie with one task. When a thread of Bun waits for the child, this is false until
// that thread has reaped it.
function childHasExited() {
  if (process.platform !== "linux") {
    // A zombie until this process reaps it, and no file tells. After that `ps` finds no process.
    const { stdout, status } = spawnSync("ps", ["-o", "stat=", "-p", String(writerProcess.pid)]);
    return status === 1 || String(stdout).includes("Z");
  }
  try {
    const stat = fs.readFileSync(`/proc/${writerProcess.pid}/stat`, "utf8");
    if (threadWaitsForChildren || stat[stat.lastIndexOf(")") + 2] !== "Z") return false;
    return fs.readdirSync(`/proc/${writerProcess.pid}/task`).length === 1;
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ESRCH") return true;
    throw err;
  }
}

// Blocks until the child has exited. Linux and macOS only.
const waitUntilExited = () => waitFor(childHasExited, "the child never exited");

// The writer, when <source> is one of its stdio streams, and the listeners for each
// report of its exit: 'exit' of a ChildProcess, `onExit` and `exited` of Bun.spawn().
let writerProcess;
const exitReports = source.startsWith("child.") ? ["exit"] : ["onExit", "exited"];
const exitListeners = [];
const reportExit = report => exitListeners.forEach(listener => listener(report));

function open() {
  const leaves = consumer.startsWith("exit") || consumer.endsWith("-leave") ? ["leave"] : [];
  switch (source) {
    case "child.stdout":
    case "child.stderr": {
      const fd = source === "child.stdout" ? 1 : 2;
      const stdio = ["ignore", "inherit", "inherit"];
      const args = [writer, dir, count, String(fd), ...writerOptions, ...leaves];
      stdio[fd] = "pipe";
      if (consumer === "exit") {
        // The writer also writes a tail to its other stream.
        stdio[3 - fd] = "pipe";
        args.push(`tail=${3 - fd}`);
      }
      writerProcess =
        consumer === "exit-grandchild"
          ? // The shell leaves the writer behind on the pipe that it inherited.
            spawn("sh", ["-c", `"$0" "$@" & exit 0`, process.execPath, ...args], { stdio })
          : spawn(process.execPath, args, { stdio });
      writerProcess.on("exit", () => reportExit("exit"));
      return writerProcess.stdio[fd];
    }
    case "Bun.spawn().stdout": {
      writerProcess = Bun.spawn({
        cmd: [process.execPath, writer, dir, count, "1", ...writerOptions, ...leaves],
        stdin: "ignore",
        stdout: "pipe",
        stderr: "inherit",
        onExit: () => reportExit("onExit"),
      });
      writerProcess.exited.then(() => reportExit("exited"));
      return Readable.fromWeb(writerProcess.stdout, readableOptions);
    }
    case "Bun.file(fifo)": {
      spawn(process.execPath, [writer, dir, count, `fifo:${options.fifo}`, ...writerOptions], { stdio: "inherit" });
      return Readable.fromWeb(Bun.file(options.fifo).stream());
    }
    // The test feeds fd 0 of this process.
    case "Bun.stdin":
      return Readable.fromWeb(Bun.stdin.stream());
    case "process.stdin":
      return process.stdin;
  }
  throw new Error(`unknown source ${source}`);
}

const stream = open();
const items = chunk => String(chunk).split("\n").filter(Boolean);
const sizeOf = i => (options.block ? (i === 0 ? 4096 : Number(options.block)) : `item${i}\n`.length);

// Counts the chunks that the stream pushes from inside a call of `_read()` after its
// first one. The first call also hands over the bytes that were read before it.
const pushes = { insideRead: 0 };
{
  const { _read, push } = stream;
  let calls = 0;
  let depth = 0;
  stream._read = function (...args) {
    calls++;
    depth++;
    try {
      return _read.apply(this, args);
    } finally {
      depth--;
    }
  };
  stream.push = function (chunk, ...args) {
    if (chunk !== null && depth > 0 && calls > 1) pushes.insideRead++;
    return push.call(this, chunk, ...args);
  };
}

if (consumer === "readable") {
  // Paused mode: each read(n) takes exactly what is buffered.
  const chunks = [];
  const bufferedAfterRead = [];
  let acknowledged = 0;
  stream.on("readable", () => {
    if (stream.readableLength === 0) {
      stream.read();
      return;
    }
    while (stream.readableLength > 0) {
      acknowledge(acknowledged++);
      chunks.push(String(stream.read(stream.readableLength)));
      bufferedAfterRead.push(stream.readableLength);
    }
  });
  stream.on("end", () => console.log(JSON.stringify({ chunks, bufferedAfterRead, pushes })));
} else if (consumer === "readable-later") {
  // Paused mode. The next block is in the pipe before this listener returns, and nothing
  // reads the stream until the next setImmediate.
  let taken = 0;
  let acknowledged = 0;
  let nextEnd = sizeOf(0);
  const acknowledgeBlocks = arrived => {
    while (acknowledged < COUNT && arrived >= nextEnd) {
      acknowledge(acknowledged++);
      nextEnd += sizeOf(acknowledged);
    }
  };
  stream.on("readable", () => {
    acknowledgeBlocks(taken + stream.readableLength);
    setImmediate(() => {
      for (let chunk; (chunk = stream.read()) !== null;) taken += chunk.length;
      acknowledgeBlocks(taken);
    });
  });
  stream.on("end", () => console.log(JSON.stringify({ taken, pushes })));
} else if (consumer === "exit") {
  // The listener for the item before the last returns only after the writer wrote the
  // last item and the tail, and exited.
  const events = [];
  const other = writerProcess.stdio[source === "child.stdout" ? 2 : 1];
  other.on("data", chunk => events.push(...items(chunk).map(item => `other stream: ${item}`)));
  exitListeners.push(report => events.push(report));
  let received = 0;
  stream.on("data", chunk => {
    for (const item of items(chunk)) {
      events.push(item);
      acknowledge(received++);
      if (received + 1 === COUNT) waitUntilExited();
    }
  });
  writerProcess.on("close", () => console.log(JSON.stringify({ events })));
} else if (consumer === "exit-nested") {
  // The listener of the last item waits for the report of the exit in a nested turn of the
  // event loop: Bun.build() runs the event loop until an async plugin setup settles.
  const events = [];
  let reported = false;
  exitListeners.push(report => {
    reported = true;
    events.push(report);
  });
  let received = 0;
  stream.on("data", chunk => {
    for (const item of items(chunk)) {
      events.push(item);
      acknowledge(received++);
      if (received + 1 === COUNT) waitUntilExited();
      if (received < COUNT) continue;
      const plugin = {
        name: "nested wait",
        async setup() {
          if (!reported) await once(writerProcess, "exit");
        },
      };
      Bun.build({ entrypoints: ["./does-not-exist.js"], plugins: [plugin] }).catch(() => {});
      events.push(reported ? "the wait returned behind the report" : "the wait returned with no report");
    }
  });
  process.on("exit", () => console.log(JSON.stringify({ events })));
} else if (consumer.startsWith("exit-stopped")) {
  // Paused mode. Nothing reads the stream until push() has stopped the native reader and
  // the writer has sent its last block and exited. Then this reads all of it.
  if (consumer === "exit-stopped-late") {
    waitForFile("wrote0");
    acknowledge(0);
  }
  const arrivedAt = {};
  let acknowledged = 0;
  let nextEnd = sizeOf(0);
  let taken = 0;
  let stopped = null;
  let ended = false;
  const print = () => {
    if (ended && exitReports.every(report => report in arrivedAt)) {
      console.log(JSON.stringify({ stopped, arrivedAt, taken }));
    }
  };
  exitListeners.push(report => {
    arrivedAt[report] = taken;
    print();
  });
  stream.on("readable", () => {
    // Acknowledges each whole block that is buffered, up to the block before the last.
    while (acknowledged < COUNT - 1 && taken + stream.readableLength >= nextEnd) {
      acknowledge(acknowledged++);
      nextEnd += sizeOf(acknowledged);
    }
    if (acknowledged < COUNT - 1) return;
    stopped ??= stream.readableLength >= stream.readableHighWaterMark;
    waitUntilExited();
    for (let chunk; (chunk = stream.read()) !== null;) taken += chunk.length;
  });
  stream.on("end", () => {
    ended = true;
    print();
  });
} else if (consumer === "exit-bytes" || consumer === "exit-grandchild") {
  let all = 0;
  let acknowledged = 0;
  let nextEnd = sizeOf(0);
  let atExit = null;
  if (consumer === "exit-grandchild") {
    waitUntilExited();
    waitForFile("wrote0");
    acknowledge(acknowledged++);
    nextEnd += sizeOf(1);
  }
  let ended = false;
  const print = () => {
    if (ended && atExit !== null) console.log(JSON.stringify({ all, atExit }));
  };
  exitListeners.push(() => {
    atExit ??= all;
    print();
  });
  // Each block is in the pipe before the listener for the block before returns.
  stream.on("data", chunk => {
    all += chunk.length;
    while (acknowledged < COUNT && all >= nextEnd) {
      acknowledge(acknowledged++);
      nextEnd += sizeOf(acknowledged);
      if (consumer === "exit-bytes" && acknowledged + 1 === COUNT) waitUntilExited();
    }
  });
  stream.on("end", () => {
    ended = true;
    print();
  });
} else if (consumer.startsWith("once:")) {
  const rounds = Number(consumer.slice("once:".length));
  let all = 0;
  let seen = 0;
  let acknowledged = 0;
  let nextEnd = sizeOf(0);
  // Always attached. It keeps the writer going, one whole item at a time.
  stream.on("data", chunk => {
    all += chunk.length;
    while (acknowledged < COUNT && all >= nextEnd) {
      acknowledge(acknowledged++);
      nextEnd += sizeOf(acknowledged);
    }
  });
  stream.on("end", () => console.log(JSON.stringify({ all, seen, pushes })));
  (async () => {
    for (;;) {
      const [chunk] = await once(stream, "data");
      seen += chunk.length;
      for (let round = 0; round < rounds; round++) await new Promise(resolve => process.nextTick(resolve));
    }
  })();
} else if (consumer === "throw" || consumer === "throw-leave") {
  const at = Number(options.at ?? COUNT - 1);
  const kept = [];
  const copies = [];
  let all = 0;
  let acknowledged = 0;
  let nextEnd = sizeOf(0);
  let thrown = false;
  let ended = false;
  let got = null;
  process.on(options.handler, (error, origin) => {
    got = { message: error.message, origin: typeof origin === "string" ? origin : "a promise" };
    // Nothing reads a web stream again after a read of it was rejected.
    if ("readOn" in options) stream.read(0);
  });
  process.on("exit", () => {
    const intact = kept.every((chunk, i) => chunk.equals(copies[i]));
    console.log(JSON.stringify({ all, ended, intact, got }));
  });
  stream.on("end", () => (ended = true));
  stream.on("data", chunk => {
    kept.push(chunk);
    copies.push(Buffer.from(chunk));
    all += chunk.length;
    let reached = false;
    while (acknowledged < COUNT && all >= nextEnd) {
      reached ||= acknowledged === at;
      acknowledge(acknowledged++);
      nextEnd += sizeOf(acknowledged);
      if (consumer === "throw-leave" && acknowledged + 1 === COUNT) waitUntilExited();
    }
    if (reached && !thrown) {
      thrown = true;
      throw new Error(`thrown at item${at}`);
    }
  });
} else {
  const all = [];
  const seen = [];
  // Always attached. It keeps the writer going.
  stream.on("data", chunk => {
    for (const item of items(chunk)) {
      acknowledge(all.push(item) - 1);
      if (consumer === "data-leave" && all.length + 1 === COUNT) waitUntilExited();
    }
    if (consumer === "pause") {
      stream.pause();
      setImmediate(() => stream.resume());
    }
  });
  // Detached from each chunk until the next setImmediate.
  const detached = chunk => {
    seen.push(...items(chunk));
    stream.off("data", detached);
    setImmediate(() => stream.on("data", detached));
  };
  stream.on("data", detached);
  stream.on("end", () => console.log(JSON.stringify({ all, seen, pushes })));
}
