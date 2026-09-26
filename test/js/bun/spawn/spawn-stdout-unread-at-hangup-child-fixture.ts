// Queues bytes on its stdout socket, hangs up, and reports through a FIFO how many bytes the socket took.
import { closeSync, openSync, writeSync } from "node:fs";
import { positionDependentBytes, unixSockets } from "socketpair";

const [fifo, length] = [process.argv[2], Number(process.argv[3])];
// Blocks until the parent opens the FIFO for reading. It comes first: if a later step fails, the parent's read
// still ends when this process exits.
const report = openSync(fifo, "w");
const sockets = unixSockets(process.env.LIBC_PATH!);
sockets.raiseSendBuffer(1);
const queued = sockets.sendWithoutBlocking(1, positionDependentBytes(length));
// The exit of a process closes its descriptors in no useful order. This close comes before the report, so the
// parent's socket holds the bytes and the hangup when the report arrives.
closeSync(1);
writeSync(report, String(queued));
process.exit(0);
