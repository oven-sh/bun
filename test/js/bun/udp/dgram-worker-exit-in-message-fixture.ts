// Worker side of "process.exit() from the first 'message' of a multi-packet
// batch". The remaining on_data iterations, the drain, and any recv error of
// the SAME poll dispatch then run with a TerminationException pending; each
// native callback must bail instead of re-entering JS (which aborts a debug
// build on JSC's assertNoException).
import { parentPort } from "node:worker_threads";
import { createSocket } from "node:dgram";

const socket = createSocket("udp4");
socket.on("message", () => {
  process.exit(0);
});
socket.bind(0, "127.0.0.1", () => {
  parentPort!.postMessage(socket.address().port);
});
