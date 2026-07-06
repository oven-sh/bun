// stdout is a FIFO nobody else reads. Fill it until the sink reports
// backpressure, drain the pipe synchronously, then write once more: that last
// write is accepted outright while the previous one is still parked on the
// sink's backpressure promise.
const fs = require("node:fs");

const readFd = fs.openSync(process.env.BUN_TEST_FIFO, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);

const order = [];
let total = -1;
let resolveDone;
const done = new Promise(resolve => (resolveDone = resolve));

function record(index) {
  order.push(index);
  if (total >= 0 && order.length >= total) resolveDone();
}

const chunk = Buffer.alloc(4096, 0x61);
let next = 0;
let backpressured = false;
while (next < 1024) {
  const index = next++;
  if (!process.stdout.write(chunk, () => record(index))) {
    backpressured = true;
    break;
  }
}

// Empty the pipe so the next write can flush the sink's whole buffer in one go.
const scratch = Buffer.alloc(65536);
for (;;) {
  try {
    if (fs.readSync(readFd, scratch, 0, scratch.length, null) === 0) break;
  } catch (err) {
    if (err.code === "EAGAIN") break;
    throw err;
  }
}

const last = next++;
const lastWriteAccepted = process.stdout.write(Buffer.from("."), () => record(last));

total = next;
if (order.length >= total) resolveDone();

done.then(() => {
  process.stderr.write(JSON.stringify({ backpressured, lastWriteAccepted, order }) + "\n");
  process.exit(0);
});
