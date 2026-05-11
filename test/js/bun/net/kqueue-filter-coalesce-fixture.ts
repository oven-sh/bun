// Regression test for kqueue filter comparison bug (macOS).
//
// On kqueue, EVFILT_READ (-1) and EVFILT_WRITE (-2) are negative integers. The old
// code used bitwise AND to identify filters:
//
//   events |= (filter & EVFILT_READ) ? READABLE : 0
//   events |= (filter & EVFILT_WRITE) ? WRITABLE : 0
//
// Since all negative numbers AND'd with -1 or -2 produce truthy values, EVERY kqueue
// event was misidentified as BOTH readable AND writable. This caused the drain handler
// to fire spuriously on every readable event and vice versa.
//
// The fix uses equality comparison (filter == EVFILT_READ), plus coalescing duplicate
// kevents for the same fd (kqueue returns separate events per filter) into a single
// dispatch with combined flags — matching epoll's single-entry-per-fd behavior.
//
// This test creates unix socket connections with small buffers to force partial writes
// (which registers EVFILT_WRITE). The client sends pings on each data callback, causing
// EVFILT_READ events on the server. With the bug, each EVFILT_READ also triggers drain,
// giving a drain/data ratio of ~2.0. With the fix, the ratio is ~1.0.
//
// Example output:
//   system bun (bug):  data: 38970  drain: 77940  ratio: 2.0
//   fixed bun:         data: 52965  drain: 52965  ratio: 1.0

import { setSocketOptions } from "bun:internal-for-testing";

const CHUNK = Buffer.alloc(64 * 1024, "x");
const PING = Buffer.from("p");
const sockPath = `kqueue-bench-${process.pid}.sock`;

let drainCalls = 0;
let dataCalls = 0;

const server = Bun.listen({
  unix: sockPath,
  socket: {
    open(socket) {
      setSocketOptions(socket, 1, 512);
      setSocketOptions(socket, 2, 512);
      socket.write(CHUNK);
    },
    data() {
      dataCalls++;
    },
    drain(socket) {
      drainCalls++;
      socket.write(CHUNK);
    },
    close() {},
    error() {},
  },
});

const clients = [];
for (let i = 0; i < 10; i++) {
  clients.push(
    await Bun.connect({
      unix: sockPath,
      socket: {
        open(socket) {
          setSocketOptions(socket, 1, 512);
          setSocketOptions(socket, 2, 512);
        },
        data(socket) {
          socket.write(PING);
        },
        drain() {},
        close() {},
        error() {},
      },
    }),
  );
}

await Bun.sleep(50);
drainCalls = 0;
dataCalls = 0;

await Bun.sleep(100);

const ratio = dataCalls > 0 ? drainCalls / dataCalls : 0;
console.log(`data: ${dataCalls}  drain: ${drainCalls}  ratio: ${ratio.toFixed(1)}`);

for (const c of clients) c.end();
server.stop(true);
try {
  require("fs").unlinkSync(sockPath);
} catch {}
if (dataCalls === 0 || drainCalls === 0) {
  console.error("test invalid: no data or drain callbacks fired");
  process.exit(1);
}
process.exit(ratio < 1.5 ? 0 : 1);
