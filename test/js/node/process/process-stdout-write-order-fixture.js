// stdout is a FIFO nobody else reads. Fill it until the sink reports backpressure,
// drain the pipe, then write once more: that last write is accepted outright while
// the earlier ones are still parked on the sink's backpressure promise.
//
// BUN_TEST_MODE perturbs what runs while that promise's reactions are still queued,
// which is where the reporting order is easy to get wrong:
//   write-on-drain       a 'drain' listener writes
//   write-in-callback    the parked write's own callback writes
//   two-parked-in-cb     two writes park on the same promise (the sink hands back the
//                        same one for both), and the second one's callback writes
const fs = require("node:fs");

const mode = process.env.BUN_TEST_MODE ?? "";
// The sink hands the same promise to every write it parks, so reaching the second
// one means writing past the first `false` rather than stopping at it.
const parkTarget = mode === "two-parked-in-cb" ? 2 : 1;
const readFd = fs.openSync(process.env.BUN_TEST_FIFO, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);

const order = [];
let next = 0;
let total = -1;
let resolveDone;
const done = new Promise(resolve => (resolveDone = resolve));

function seal() {
  total = next;
  if (order.length >= total) resolveDone();
}

function record(index) {
  order.push(index);
  if (total >= 0 && order.length >= total) resolveDone();
}

// Empty whatever is currently in the pipe. Non-blocking: returns when it would block.
function drainPipe() {
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

// The re-entrant write, issued from user code that runs while the sink's promise
// reactions are still queued. It has to report after every write issued before it.
let reentrant = -1;
function writeReentrant() {
  if (reentrant !== -1) return;
  reentrant = next++;
  process.stdout.write(Buffer.from("!"), () => record(reentrant));
  seal();
}

if (mode === "write-on-drain") {
  process.stdout.once("drain", writeReentrant);
}

const chunk = Buffer.alloc(4096, 0x61);
const parked = [];
while (next < 1024 && parked.length < parkTarget) {
  const index = next++;
  const accepted = process.stdout.write(chunk, () => {
    record(index);
    const reenterAt = parked[parkTarget - 1];
    if ((mode === "write-in-callback" || mode === "two-parked-in-cb") && index === reenterAt) {
      writeReentrant();
    }
  });
  if (!accepted) parked.push(index);
}

// Empty the pipe so the next write is accepted outright while the earlier ones stay
// parked. The last write's ordering versus those parked callbacks is the point.
drainPipe();

const last = next++;
const lastWriteAccepted = process.stdout.write(Buffer.from("."), () => record(last));

// The re-entrant modes seal once their extra write is issued.
if (reentrant === -1 && mode !== "write-on-drain" && mode !== "write-in-callback" && mode !== "two-parked-in-cb") {
  seal();
}

// Keep reading on every event-loop turn so the sink can flush its whole buffer and
// the parked promises settle, whatever the platform's pipe capacity. The pipe is the
// only thing blocking progress; draining it lets every queued write complete.
let finished = false;
done.then(() => {
  finished = true;
  const payload = { parkedCount: parked.length, lastWriteAccepted, reentrant, order };
  process.stderr.write(JSON.stringify(payload) + "\n");
  process.exit(0);
});

(function pump() {
  drainPipe();
  if (!finished) setImmediate(pump);
})();
