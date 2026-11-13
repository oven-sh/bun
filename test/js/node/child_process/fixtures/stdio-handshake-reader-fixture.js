// usage: stdio-handshake-reader-fixture.js <source> <consumer> <dir> <count> [fifo]
//
// Reads the output of stdio-handshake-writer-fixture.js through <source>. The writer sends
// item i+1 only after this process acknowledged item i, and each consumer waits,
// inside the event that delivered item i, until item i+1 is in the pipe. So the next
// bytes are always readable while the consumer still runs, with no timing involved.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");

const [source, consumer, dir, count, fifo] = process.argv.slice(2);
const COUNT = Number(count);
const writer = path.join(__dirname, "stdio-handshake-writer-fixture.js");
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

// Tells the writer that item i arrived, then blocks until item i+1 is in the pipe.
function acknowledge(i) {
  fs.writeFileSync(`${dir}/got${i}`, "");
  if (i + 1 === COUNT) return;
  waitFor(() => fs.existsSync(`${dir}/wrote${i + 1}`), `the writer never sent item${i + 1}`);
}

// Blocks until the process has exited and this thread has not seen that yet: it is
// a zombie, or it is gone because a thread of Bun waited for it. Linux only.
function waitUntilExited(pid) {
  waitFor(() => {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat[stat.lastIndexOf(")") + 2] === "Z";
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "ESRCH") return true;
      throw err;
    }
  }, "the writer never exited");
}

// The writer, when <source> is one of its stdio streams.
let child;

function open() {
  switch (source) {
    case "child.stdout":
    case "child.stderr": {
      const fd = source === "child.stdout" ? 1 : 2;
      const stdio = ["ignore", "inherit", "inherit"];
      const args = [writer, dir, count, String(fd)];
      stdio[fd] = "pipe";
      if (consumer === "exit") {
        // The writer ends with a tail on its other stream.
        stdio[3 - fd] = "pipe";
        args.push(String(3 - fd));
      }
      child = spawn(process.execPath, args, { stdio });
      return child.stdio[fd];
    }
    case "Bun.spawn": {
      const proc = Bun.spawn({
        cmd: [process.execPath, writer, dir, count, "1"],
        stdin: "ignore",
        stdout: "pipe",
        stderr: "inherit",
      });
      return Readable.fromWeb(proc.stdout);
    }
    case "Bun.file(fifo)": {
      spawn(process.execPath, [writer, dir, count, `fifo:${fifo}`], { stdio: "inherit" });
      return Readable.fromWeb(Bun.file(fifo).stream());
    }
    // The test pipes the writer into these two with a shell.
    case "Bun.stdin":
      return Readable.fromWeb(Bun.stdin.stream());
    case "process.stdin":
      return process.stdin;
  }
  throw new Error(`unknown source ${source}`);
}

const stream = open();
const items = chunk => String(chunk).split("\n").filter(Boolean);

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
  stream.on("end", () => console.log(JSON.stringify({ chunks, bufferedAfterRead })));
} else if (consumer === "exit") {
  // The writer sends its last item, then a tail on its other stream, then exits.
  // The listener for the item before the last returns only after all three.
  const events = [];
  const other = child.stdio[source === "child.stdout" ? 2 : 1];
  other.on("data", chunk => events.push(...items(chunk).map(item => `other stream: ${item}`)));
  child.on("exit", () => events.push("exit"));
  let received = 0;
  stream.on("data", chunk => {
    for (const item of items(chunk)) {
      events.push(item);
      acknowledge(received++);
      if (received + 1 === COUNT) waitUntilExited(child.pid);
    }
  });
  child.on("close", () => console.log(JSON.stringify({ events })));
} else {
  const all = [];
  const seen = [];
  // Always attached. It keeps the writer going.
  stream.on("data", chunk => {
    for (const item of items(chunk)) acknowledge(all.push(item) - 1);
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
  stream.on("end", () => console.log(JSON.stringify({ all, seen })));
}
