// Fixture for process-stdin-stale-hup.test.ts.
//
// stdin is a named FIFO. The test harness writes a chunk and then closes
// its writer, so the kernel delivers POLLHUP together with the data.
// Bun's PosixBufferedReader.readBlockingPipe() enters its drain loop with
// received_hup=true, reads the chunk, and delivers it to JS via
// onReadChunk → pending.run() → microtask drain → our 'data' handler.
//
// In the 'data' handler we synchronously open the FIFO for writing. Now a
// writer exists again, so the pipe is no longer hung up — but
// readBlockingPipe() is still on the stack with a stale received_hup=true.
// Previously it would loop back and:
//   - on Linux named FIFOs: preadv2(RWF_NOWAIT) → EOPNOTSUPP → fallback to
//     blocking read() → the event loop thread blocks forever in read()
//   - with O_NONBLOCK: read() → EAGAIN → loop → EAGAIN → 100% CPU spin
// Either way the timer below never fires and this process times out.
//
// With the fix, readBlockingPipe re-checks bun.isReadable() after JS ran
// and re-arms the poll instead of looping, so the timer fires and we
// print OK.
const fs = require("fs");
const fifo = process.argv[2];
let writeFd = -1;

process.stdin.resume();
// Signal the harness that our stdin poll is registered so it can
// write + close the writer (delivering POLLIN|POLLHUP together).
process.stderr.write("ready\n");

process.stdin.on("data", d => {
  process.stderr.write(`data len=${d.length}\n`);
  if (writeFd === -1) {
    writeFd = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    process.stderr.write(`opened writer fd=${writeFd}\n`);
  }
});
process.stdin.on("end", () => {
  process.stderr.write("end\n");
});

// If the event loop is alive, this fires ~200ms after the data handler ran.
// If readBlockingPipe is stuck (spinning or blocked), it never does.
setTimeout(() => {
  if (writeFd !== -1) fs.closeSync(writeFd);
  console.log("OK");
  process.exit(0);
}, 500);
