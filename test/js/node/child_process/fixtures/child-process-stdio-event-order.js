// Prints the order of a child's stdio stream events, together with the nextTicks and the promise
// jobs that the stream's listeners queue. Node prints the same line.
//
// usage: <runtime> child-process-stdio-event-order.js <stdout|stderr|both> <mode> <consumer> <empty scratch dir>
//
// mode:
//   first-read    the bytes and the EOF are both in the pipe before the parent reads for the first time
//   waiting-read  the parent's read already waits when the child writes
//   two-chunks    the second chunk and the EOF are in the pipe while the 'data' listener of the first chunk runs
//   held-open     the child exits at once, and a grandchild holds the pipe: it writes when the parent has seen 'exit'
// consumer:
//   data          a 'data' listener
//   readable      a 'readable' listener that calls read()
//   destroy       a 'data' listener that destroys the stream from a promise job
//   throw         a 'data' listener that throws
//   destroy-callback-throws  a 'data' listener that calls destroy() with a callback that throws
//   read-on-exit  no listener, and a read() call when the child exits
//   for-await     a `for await` loop, and after it a 'close' listener and `await once(child, "close")`
//   await-end     a 'data' listener and `await once(stream, "end")`, and after it the same two
// "both" reads stdout and stderr, and prints only their 'data' events.
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const [which, mode, consumer, dir] = process.argv.slice(2);
const fds = which === "both" ? [1, 2] : which === "stdout" ? [1] : [2];
// The parent creates `go`. The child creates `written` after it wrote everything and closed the fds.
const go = path.join(dir, "go");
const written = path.join(dir, "written");

const sleeper = new Int32Array(new SharedArrayBuffer(4));
// Blocks the event loop, so that nothing is read or delivered until `file` exists.
function blockUntilExists(file) {
  const deadline = Date.now() + 60_000;
  while (!fs.existsSync(file)) {
    // The test is over and has removed its directory.
    if (!fs.existsSync(dir)) process.exit(1);
    if (Date.now() > deadline) throw new Error(`${file} was not created`);
    Atomics.wait(sleeper, 0, 0, 5);
  }
}

// The child closes the fd itself, so the EOF is in the pipe before `written` exists. (On Windows
// closeSync() of fd 1 or 2 does nothing, and the EOF follows when the child exits.)
const writerSource = `
  const fs = require("node:fs");
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const dir = ${JSON.stringify(dir)};
  ${blockUntilExists}
  const mode = ${JSON.stringify(mode)};
  const fds = ${JSON.stringify(fds)};
  if (mode === "two-chunks") fs.writeSync(fds[0], "AAAA");
  if (mode !== "first-read") blockUntilExists(${JSON.stringify(go)});
  for (const fd of fds) fs.writeSync(fd, fds.length === 2 ? (fd === 1 ? "OUT" : "ERR") : mode === "two-chunks" ? "BBBB" : "AAAABB");
  for (const fd of fds) fs.closeSync(fd);
  fs.writeFileSync(${JSON.stringify(written)}, "");
`;
// held-open: the writer is a grandchild that inherits the pipe, and the child exits without a wait for it.
const childSource =
  mode === "held-open"
    ? `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(writerSource)}], { stdio: "inherit" }).unref();`
    : writerSource;

const stdio = ["ignore", "ignore", "ignore"];
for (const fd of fds) stdio[fd] = "pipe";
const env = { ...process.env };
// The test runner sets this for ASAN builds. With it a Bun child ends its own children when it exits, and the
// grandchild has to outlive the child here.
if (mode === "held-open") delete env.BUN_FEATURE_FLAG_NO_ORPHANS;
const child = spawn(process.execPath, ["-e", childSource], { stdio, env });

const events = [];
// The chain goes from the promise job queue to the nextTick queue and back, twice.
async function queueTickAndJobs(label) {
  process.nextTick(() => events.push(`tick(${label})`));
  await null;
  events.push(`job(${label})`);
  await new Promise(resolve => process.nextTick(resolve));
  events.push(`job2(${label})`);
  await new Promise(resolve => process.nextTick(resolve));
  events.push(`job3(${label})`);
}

const awaitsEnd = consumer === "for-await" || consumer === "await-end";
for (const fd of fds) {
  const stream = child.stdio[fd];
  if (consumer === "data") {
    stream.on("data", chunk => {
      events.push(`data(${chunk})`);
      queueTickAndJobs(chunk);
      if (mode === "two-chunks" && !fs.existsSync(go)) {
        fs.writeFileSync(go, "");
        blockUntilExists(written);
      }
    });
  } else if (consumer === "readable") {
    stream.on("readable", () => {
      let chunk;
      while ((chunk = stream.read()) !== null) {
        events.push(`read(${chunk})`);
        queueTickAndJobs(chunk);
      }
      events.push("read(null)");
    });
  } else if (consumer === "destroy") {
    stream.on("data", async chunk => {
      events.push(`data(${chunk})`);
      await null;
      stream.destroy();
      events.push("destroy");
      queueTickAndJobs("destroy");
    });
  } else if (consumer === "destroy-callback-throws") {
    // destroy() swallows what its callback throws, and 'close' still comes.
    process.on("uncaughtException", () => events.push("uncaughtException"));
    stream.on("data", chunk => {
      events.push(`data(${chunk})`);
      stream.destroy(undefined, () => {
        events.push("destroy-callback");
        throw new Error("the callback threw");
      });
    });
  } else if (consumer === "throw") {
    // Node calls the listener from a libuv callback, so the throw is an uncaught exception, and the handle reads on.
    process.on("uncaughtException", (error, origin) => events.push(`uncaughtException(${origin})`));
    process.on("unhandledRejection", () => events.push("unhandledRejection"));
    stream.on("data", chunk => {
      events.push(`data(${chunk})`);
      queueTickAndJobs(chunk);
      throw new Error("the listener threw");
    });
  } else if (awaitsEnd) {
    // Node emits 'close' from the close callback of the handle, after the promise jobs that 'end' started.
    (async () => {
      if (consumer === "for-await") {
        for await (const chunk of stream) events.push(`data(${chunk})`);
      } else {
        stream.on("data", chunk => events.push(`data(${chunk})`));
        await once(stream, "end");
      }
      events.push("consumed");
      stream.on("close", hadError => events.push(`late-close(${hadError})`));
      await once(child, "close");
      events.push("child-close-settled");
    })();
  } else {
    // Node has read the pipe from the start, so the bytes are in the stream's buffer by now.
    child.on("exit", () => events.push(`read(${stream.read()})`));
  }
  if (which === "both") continue;
  // Not for a consumer that awaits: how many promise jobs an await takes is not what the line is about.
  if (!awaitsEnd) {
    stream.on("end", () => {
      events.push("end");
      queueTickAndJobs("end");
    });
  }
  stream.on("close", hadError => events.push(`close(${hadError})`));
}
if (mode === "held-open") {
  child.on("exit", () => {
    events.push("exit");
    fs.writeFileSync(go, "");
  });
}
child.on("close", () => {
  // A job that runs after 'close' still gets into the line.
  setImmediate(() => console.log(events.join(" ")));
});

if (mode === "first-read") {
  blockUntilExists(written);
} else if (mode === "waiting-read") {
  // The stream started to read in a nextTick, so the read waits by now.
  setImmediate(() => fs.writeFileSync(go, ""));
}
