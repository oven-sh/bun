// A parked write whose callback throws must not leak the pending-report count. If it
// does, the sink's promise stays parked for the life of the stream, and every later
// accepted write reports from a microtask while readline's no-op moveCursor reports
// from process.nextTick, permanently reordering them.
//
// Park one write with a throwing callback, drain, then after its promise has settled
// write once more alongside a no-op moveCursor and report which callback ran first.
const fs = require("node:fs");
const readline = require("node:readline");

// The parked write's callback throws inside the fulfillment handler's try/finally.
// The finally runs the decrement, then the throw rejects the derived promise that
// nothing consumes: that unhandled rejection is phase two's barrier, no wall clock.
const settled = Promise.withResolvers();
process.on("unhandledRejection", () => settled.resolve());

const readFd = fs.openSync(process.env.BUN_TEST_FIFO, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);

function drain() {
  const scratch = Buffer.alloc(65536);
  for (;;) {
    try {
      if (fs.readSync(readFd, scratch, 0, scratch.length, null) === 0) break;
    } catch (err) {
      if (err.code === "EAGAIN") break;
      throw err;
    }
  }
}

const chunk = Buffer.alloc(4096, 0x61);
let parkedIndex = -1;
let index = 0;
while (parkedIndex === -1) {
  const i = index++;
  // Only the parked write throws; the accepted ones must report cleanly.
  const accepted = process.stdout.write(chunk, () => {
    if (i === parkedIndex) throw new Error("boom");
  });
  if (!accepted) parkedIndex = i;
}

drain();

// Keep reading on every event-loop turn so the sink flushes its whole buffer and the
// parked write's promise settles, whatever the platform's pipe capacity.
let finished = false;
(function pump() {
  drain();
  if (!finished) setImmediate(pump);
})();

// Phase two runs once the parked write's promise reaction has run (and decremented).
settled.promise
  .then(() => new Promise(resolve => setImmediate(resolve)))
  .then(() => {
    const order = [];
    let pending = 2;
    const done = name => {
      order.push(name);
      if (--pending === 0) {
        finished = true;
        fs.writeSync(2, JSON.stringify({ order }) + "\n");
        process.exit(0);
      }
    };
    process.stdout.write("A", () => done("write"));
    readline.moveCursor(process.stdout, 0, 0, () => done("moveCursor"));
  });
