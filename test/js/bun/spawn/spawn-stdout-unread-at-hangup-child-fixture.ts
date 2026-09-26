// Queues bytes on its stdout socket, hangs up, and reports through a FIFO how many bytes the socket took.
import { closeSync, constants, openSync, writeSync } from "node:fs";
import { positionDependentBytes, unixSockets } from "socketpair";

const [fifo, length, parent] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];

// The open succeeds when the parent reads the FIFO. It does not block: a blocking open never returns in a
// child whose parent is gone, and that child stays.
function openWhenParentReads(): number {
  for (;;) {
    try {
      return openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENXIO" || process.ppid !== parent) throw err;
    }
    Bun.sleepSync(1);
  }
}

// This comes first: if a later step fails, the parent's read still ends when this process exits.
const report = openWhenParentReads();
const sockets = unixSockets(process.env.LIBC_PATH!);
sockets.raiseSendBuffer(1);
const queued = sockets.sendWithoutBlocking(1, positionDependentBytes(length));
// The exit of a process closes its descriptors in no useful order. This close comes before the report, so the
// parent's socket holds the bytes and the hangup when the report arrives.
closeSync(1);
writeSync(report, String(queued));
process.exit(0);
