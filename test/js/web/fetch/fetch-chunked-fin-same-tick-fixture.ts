// kqueue used to derive `eof` from EV_EOF on either filter. Two ways that
// dropped bytes:
//   (1) An EVFILT_WRITE-only event with EV_EOF skipped the recv loop and
//       closed with the response still in the kernel buffer.
//   (2) The recv loop bails after one ~512 KiB read when num_ready_polls ≥ 25,
//       and the eof flag (already set by kqueue) then closed the socket with
//       the rest of the chunked body unread.
// Linux has neither: epoll only maps EPOLLHUP, so half-close is discovered via
// recv()==0 after the buffer is drained.
//
// This fixture targets (2) deterministically: each response is one ~600 KiB
// chunked body written in a single burst followed by FIN, and 32 requests run
// at once so a kevent batch routinely carries ≥ 25 ready polls. Every request
// must receive the full body.
import net from "node:net";

const payload = Buffer.alloc(600 * 1024, "x");
const reply = Buffer.concat([
  Buffer.from(
    "HTTP/1.1 200 OK\r\n" +
      "Connection: close\r\n" +
      "Transfer-Encoding: chunked\r\n" +
      "\r\n" +
      payload.length.toString(16) +
      "\r\n",
  ),
  payload,
  Buffer.from("\r\n0\r\n\r\n"),
]);

const server = net.createServer(socket => {
  socket.on("error", () => {});
  socket.once("data", () => {
    // Single write + FIN so the data and EV_EOF land in the same kevent batch.
    socket.end(reply);
  });
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const { port } = server.address() as net.AddressInfo;

const ITERATIONS = 200;
const CONCURRENCY = 32;
let failures = 0;
let firstError = "";

async function once() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, { keepalive: false });
    const buf = await res.arrayBuffer();
    if (buf.byteLength !== payload.length) {
      failures++;
      firstError ||= `body mismatch: got ${buf.byteLength} bytes, want ${payload.length}`;
    }
  } catch (e: any) {
    failures++;
    firstError ||= `${e?.code ?? e?.name}: ${e?.message}`;
  }
}

let i = 0;
async function worker() {
  while (i < ITERATIONS) {
    i++;
    await once();
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

server.close();

if (failures > 0) {
  console.error(`FAIL ${failures}/${ITERATIONS}: ${firstError}`);
  process.exit(1);
}
console.log(`OK ${ITERATIONS}`);
