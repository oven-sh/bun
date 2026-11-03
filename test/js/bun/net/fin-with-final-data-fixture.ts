// kqueue sets EV_EOF on the readable event that carries the last of the peer's data. The read loop
// stops after one ~512 KiB recv() when 25 or more polls are ready, so acting on that flag there
// closes the socket with the rest of the body still in the kernel buffer.
//
// Each response is one ~600 KiB chunked body written in a single burst followed by FIN, and 32
// requests run at once so a batch routinely carries 25 ready polls. Every request must receive the
// full body.
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
    socket.end(reply);
  });
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const { port } = server.address() as net.AddressInfo;

const ITERATIONS = 128;
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
