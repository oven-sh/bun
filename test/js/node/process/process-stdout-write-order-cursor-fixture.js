// From inside a parked write's completion callback, co-issue a write and a no-op
// moveCursor. The no-op must report through the same queue as the write so it
// cannot overtake it; a direct process.nextTick would drain between microtasks
// and jump ahead.
const fs = require("node:fs");
const readline = require("node:readline");

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

const order = [];
let pending = 2;
function done(name) {
  order.push(name);
  if (--pending === 0) {
    finished = true;
    fs.writeSync(2, JSON.stringify({ order }) + "\n");
    process.exit(0);
  }
}

const chunk = Buffer.alloc(4096, 0x61);
let parkedIndex = -1;
let index = 0;
while (parkedIndex === -1) {
  const i = index++;
  const accepted = process.stdout.write(chunk, () => {
    if (i === parkedIndex) {
      process.stdout.write("B", () => done("write"));
      readline.moveCursor(process.stdout, 0, 0, () => done("moveCursor"));
    }
  });
  if (!accepted) parkedIndex = i;
}

drain();

let finished = false;
(function pump() {
  drain();
  if (!finished) setImmediate(pump);
})();
