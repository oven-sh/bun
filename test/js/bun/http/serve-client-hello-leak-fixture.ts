// A server with `tls.clientHello` keeps one copy of the ClientHello per
// connection and frees it when the connection closes. Each client here sends a
// ClientHello of about 13 KB, so a copy that outlives its connection shows in
// the RSS of the server: 13 KB per connection.
//
//   serve-client-hello-leak-fixture.ts <connections>      the server, which measures itself
//   serve-client-hello-leak-fixture.ts client <port> <n>  the clients, in a process of their own
import { tls as cert } from "harness";
import { once } from "node:events";
import tls from "node:tls";
import { F, PREFACE, T, baseHeaders, frame, hpackLiteral } from "./serve-http2-helpers";

// BoringSSL accepts a ClientHello of up to 16 KB. 46 names of 255 bytes stay below that.
const padding = Array.from({ length: 46 }, (_, i) => Buffer.alloc(253, "x").toString() + String(i).padStart(2, "0"));

function connect(port: number, protocol: string) {
  return tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false, ALPNProtocols: [protocol, ...padding] });
}

/** Two requests on one HTTP/1.1 connection. */
async function overHTTP1(port: number) {
  const socket = connect(port, "http/1.1");
  await once(socket, "secureConnect");
  for (let i = 0; i < 2; i++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    let text = "";
    const onData = (chunk: Buffer) => {
      text += chunk.toString("latin1");
      const end = text.indexOf("\r\n\r\n");
      if (end === -1) return;
      const length = Number(/\r\ncontent-length: (\d+)/i.exec(text.slice(0, end))![1]);
      if (text.length < end + 4 + length) return;
      socket.off("data", onData);
      resolve();
    };
    socket.on("data", onData);
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await promise;
  }
  socket.destroy();
  await once(socket, "close");
}

/** Two streams on one HTTP/2 connection. */
async function overHTTP2(port: number) {
  const socket = connect(port, "h2");
  await once(socket, "secureConnect");
  socket.write(Buffer.concat([PREFACE, frame(T.SETTINGS, 0, 0)]));
  let received = Buffer.alloc(0);
  for (const streamId of [1, 3]) {
    const { promise, resolve } = Promise.withResolvers<void>();
    const onData = (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      while (received.length >= 9) {
        const length = received.readUIntBE(0, 3);
        if (received.length < 9 + length) return;
        const [type, flags] = [received[3], received[4]];
        const ended = type === T.DATA && flags & F.END_STREAM && (received.readUInt32BE(5) & 0x7fffffff) === streamId;
        received = received.subarray(9 + length);
        if (!ended) continue;
        socket.off("data", onData);
        return resolve();
      }
    };
    socket.on("data", onData);
    socket.write(frame(T.HEADERS, F.END_HEADERS | F.END_STREAM, streamId, hpackLiteral(baseHeaders("/"))));
    await promise;
  }
  socket.destroy();
  await once(socket, "close");
}

if (process.argv[2] === "client") {
  const [port, count] = process.argv.slice(3).map(Number);
  for (let i = 0; i < count; i++) await (i % 2 ? overHTTP2(port) : overHTTP1(port));
  process.exit(0);
}

const connections = Number(process.argv[2]);
const rss = process.memoryUsage.rss;
let requests = 0;
let clientHelloBytes = 0;

const server = Bun.serve({
  port: 0,
  http2: true,
  tls: { ...cert, clientHello: true },
  fetch(req, server) {
    requests++;
    clientHelloBytes = server.clientHello(req)!.raw.length;
    return new Response("ok");
  },
});

async function clients(count: number) {
  const proc = Bun.spawn({
    cmd: [process.execPath, import.meta.path, "client", String(server.port), String(count)],
    env: process.env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  if ((await proc.exited) !== 0) throw new Error("the clients failed");
}

// The floor over several rounds drops the transient peaks of the allocator.
async function settledRss() {
  let min = Infinity;
  for (let i = 0; i < 5; i++) {
    Bun.gc(true);
    await Bun.sleep(50);
    min = Math.min(min, rss());
  }
  return min;
}

// The first connections grow the heap of the server to its working size.
await clients(200);
const before = await settledRss();
await clients(connections);
const after = await settledRss();
await server.stop(true);

console.log(JSON.stringify({ deltaMiB: (after - before) / 1024 / 1024, clientHelloBytes, connections, requests }));
