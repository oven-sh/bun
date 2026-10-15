// Drives process.binding("pipe_wrap").Pipe over FIFOs through the lifetime cases
// that a sanitizer build turns into a crash when the handle gets them wrong.
// Prints one JSON object.
const fs = require("node:fs");
const path = require("node:path");
const { Pipe, constants } = process.binding("pipe_wrap");

// The test made `fifo-0` ... `fifo-5` in this directory.
const dir = process.argv[2];
const UV_EOF = -4095;
let fifos = 0;

// The non-blocking read end is opened first so opening the write end does not block.
function openFifo() {
  const file = path.join(dir, `fifo-${fifos++}`);
  const rfd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
  const wfd = fs.openSync(file, "w");
  return { rfd, wfd };
}

function openPipe(rfd) {
  const pipe = new Pipe(constants.SOCKET);
  const err = pipe.open(rfd);
  if (err !== 0) throw new Error("open() = " + err);
  return pipe;
}

// Loop turns for the checks that nothing more arrives. Each turn polls the fds.
async function turns(count) {
  for (let i = 0; i < count; i++) await new Promise(resolve => setImmediate(resolve));
}

async function collect() {
  Bun.gc(true);
  await turns(1);
  Bun.gc(true);
}

// close() from inside onread: the read loop is still on the stack.
async function closeInsideOnread() {
  const { rfd, wfd } = openFifo();
  const pipe = openPipe(rfd);
  const seen = [];
  const closed = Promise.withResolvers();
  pipe.onread = function (nread) {
    seen.push(nread);
    this.close(() => {
      seen.push("closed");
      closed.resolve();
    });
  };
  fs.writeSync(wfd, "hello");
  pipe.readStart();
  await closed.promise;
  // More data and the hang-up reach a closed handle: nothing may be reported.
  fs.writeSync(wfd, "late");
  fs.closeSync(wfd);
  await turns(3);
  await collect();
  fs.closeSync(rfd);
  return seen;
}

// A stopped handle does not keep its wrapper alive: it is collected with its poll released.
async function collectedWhileStopped() {
  const { rfd, wfd } = openFifo();
  let calls = 0;
  (() => {
    const pipe = openPipe(rfd);
    pipe.onread = () => calls++;
    pipe.readStart();
    pipe.readStop();
  })();
  await collect();
  fs.writeSync(wfd, "late");
  fs.closeSync(wfd);
  await turns(3);
  fs.closeSync(rfd);
  return calls;
}

// A reading handle keeps its wrapper alive with no other reference to it.
async function aliveWhileReading() {
  const { rfd, wfd } = openFifo();
  const seen = [];
  const gotData = Promise.withResolvers();
  const gotEof = Promise.withResolvers();
  (() => {
    const pipe = openPipe(rfd);
    pipe.onread = nread => {
      seen.push(nread);
      if (nread > 0) gotData.resolve();
      else gotEof.resolve();
    };
    pipe.readStart();
  })();
  await collect();
  fs.writeSync(wfd, "data");
  await gotData.promise;
  await collect();
  fs.closeSync(wfd);
  await gotEof.promise;
  await collect();
  fs.closeSync(rfd);
  return seen;
}

// After EOF the stream layer calls readStart() again. It must not arm a poll on the finished reader.
async function readStartAfterEof() {
  const { rfd, wfd } = openFifo();
  const pipe = openPipe(rfd);
  const seen = [];
  const gotEof = Promise.withResolvers();
  pipe.onread = function (nread) {
    seen.push(nread);
    if (nread === UV_EOF) {
      seen.push("inside=" + this.readStart());
      gotEof.resolve();
    }
  };
  pipe.readStart();
  fs.writeSync(wfd, "x");
  fs.closeSync(wfd);
  await gotEof.promise;
  seen.push("after=" + pipe.readStart());
  pipe.close();
  pipe.close();
  seen.push("closed=" + pipe.readStart());
  await collect();
  fs.closeSync(rfd);
  return seen;
}

// readStop() leaves the bytes in the pipe. readStart() delivers them.
async function stopAndStart() {
  const { rfd, wfd } = openFifo();
  const pipe = openPipe(rfd);
  const seen = [];
  let next = Promise.withResolvers();
  pipe.onread = function (nread, buffer) {
    seen.push(buffer.toString());
    if (seen.length === 1) {
      // Stop and start again from inside the callback.
      this.readStop();
      this.readStart();
    }
    next.resolve();
    next = Promise.withResolvers();
  };
  pipe.readStart();
  let delivered = next.promise;
  fs.writeSync(wfd, "one");
  await delivered;
  delivered = next.promise;
  fs.writeSync(wfd, "two");
  await delivered;
  pipe.readStop();
  fs.writeSync(wfd, "three");
  await turns(3);
  seen.push("stopped");
  delivered = next.promise;
  pipe.readStart();
  await delivered;
  pipe.close();
  fs.closeSync(wfd);
  fs.closeSync(rfd);
  return seen;
}

// unref() before the first readStart() applies to the poll that readStart() arms.
async function unrefBeforeStart() {
  const { rfd, wfd } = openFifo();
  const pipe = openPipe(rfd);
  pipe.onread = () => {};
  pipe.unref();
  pipe.readStart();
  // Left reading on an open FIFO: the process can only exit if the handle does not hold the loop.
  return { rfd, wfd, pipe };
}

(async () => {
  const results = {
    closeInsideOnread: await closeInsideOnread(),
    collectedWhileStopped: await collectedWhileStopped(),
    aliveWhileReading: await aliveWhileReading(),
    readStartAfterEof: await readStartAfterEof(),
    stopAndStart: await stopAndStart(),
  };
  // Kept reachable: the exit must come from unref(), not from a collected handle.
  globalThis.keep = await unrefBeforeStart();
  console.log(JSON.stringify(results));
})();
