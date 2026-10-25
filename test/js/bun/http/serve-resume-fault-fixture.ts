// Sends one Bun.serve request whose socket is paused by request-body backpressure. The peer hangs up, so
// the loop removes the fd from the epoll set, and the injected poll_start failure makes the resume fail.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { connect } from "node:net";

const [mode, unix] = process.argv.slice(2);
// Above REQUEST_BODY_HIGH_WATER_MARK, so the server pauses the socket.
const BODY_CHUNK = 1024 * 1024 + 4096;

const faultArmed = Promise.withResolvers<void>();
const log = (line: string) => console.log(line);

// fetch() would reuse a connection, and a reused connection doesn't register a poll.
function ping(label: string) {
  const { promise, resolve } = Promise.withResolvers<void>();
  let response = "";
  const client = connect({ path: unix });
  client.on("connect", () => client.write("GET /ping HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
  client.on("data", chunk => (response += chunk));
  client.on("error", (error: NodeJS.ErrnoException) => log(`${label}: error ${error.code}`));
  client.on("close", () => {
    if (response) log(`${label}: ${response.slice(0, response.indexOf("\r\n"))}, ${response.split("\r\n\r\n")[1]}`);
    resolve();
  });
  return promise;
}

const server = Bun.serve({
  unix,
  idleTimeout: 0,
  maxRequestBodySize: 64 * 1024 * 1024,
  async fetch(req) {
    if (new URL(req.url).pathname === "/ping") return new Response("pong");

    req.signal.addEventListener("abort", () => log("abort"));
    await faultArmed.promise;

    try {
      if (mode === "body-buffered") {
        log(`body: resolved ${(await req.arrayBuffer()).byteLength}`);
      } else if (mode === "body-stream") {
        // With the stream materialized, text() drains it through the ByteStream.
        void req.body;
        log(`body: resolved ${(await req.text()).length}`);
      }
    } catch (error: any) {
      log(`body: rejected ${error?.name}`);
    }

    if (mode === "response-ends") {
      return new Response(null, { status: 304 });
    }
    return new Response("late");
  },
});

const socket = connect({ path: unix });
socket.on("error", () => {});
await new Promise<void>(resolve => socket.once("connect", resolve));
socket.write(`POST /upload HTTP/1.1\r\nHost: x\r\nContent-Length: ${8 * BODY_CHUNK}\r\n\r\n`);
await new Promise<void>(resolve => socket.write(Buffer.alloc(BODY_CHUNK, 0x61), () => resolve()));
socket.destroy();
await new Promise<void>(resolve => socket.once("close", resolve));

// Makes the loop poll and notice that the socket above hung up.
await ping("before");

// If the resume doesn't consume this rule, the ping after the handler fails.
fault.set({ syscall: "poll_start", action: "errno", errno: "ENOMEM", repeat: 1 });
faultArmed.resolve();

while (server.pendingRequests > 0) await new Promise<void>(resolve => setImmediate(resolve));
await ping("after");
await server.stop();
log("done");
