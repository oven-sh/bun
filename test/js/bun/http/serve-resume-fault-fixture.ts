// Drives one Bun.serve request whose socket is paused by request-body
// backpressure, parked by the dispatcher, and then resumed by the runtime.
//
// The peer of a unix socket closing raises the unmaskable hangup on the
// server's fd. While the fd is paused, loop.c takes it out of the epoll set
// (the hangup is level-triggered and the unread body tail must survive), so the
// next resume is a fresh registration. The injected poll_start failure makes it
// fail, which is the case us_socket_resume() fails the socket on.
//
// `mode` picks what the handler does at that point. Every mode must end with a
// live server, a settled request and exit code 0.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { connect } from "node:net";

// The socket path is in a directory that the test owns and removes.
const [mode, unix] = process.argv.slice(2);
// Above REQUEST_BODY_HIGH_WATER_MARK, so the server pauses the socket.
const BODY_CHUNK = 1024 * 1024 + 4096;

const faultArmed = Promise.withResolvers<void>();
const log = (line: string) => console.log(line);

// One request on a connection of its own. Not fetch(): it keeps unix
// connections alive and reuses them, and a reused connection registers nothing.
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
        // Materialize the stream first: .text() then drains it through the
        // ByteStream buffer action instead of the buffering hook.
        void req.body;
        log(`body: resolved ${(await req.text()).length}`);
      }
    } catch (error: any) {
      log(`body: rejected ${error?.name}`);
    }

    if (mode === "response-ends") {
      // A null-body status ends the response without writing a body, which is
      // the shortest path from the handler to detach_response().
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

// A request of its own, so the loop polls: the hangup of the socket above is
// collected there and parks its fd. Before the fault is armed, because a
// connection needs poll registrations too.
await ping("before");

// One shot. The ping after the handler proves the resume consumed it: a rule
// still armed fails the first poll registration of that connection.
fault.set({ syscall: "poll_start", action: "errno", errno: "ENOMEM", repeat: 1 });
faultArmed.resolve();

// The server releases the request after the resume in every mode: the body
// reads settle on the close that follows it, and the response end makes it.
while (server.pendingRequests > 0) await new Promise<void>(resolve => setImmediate(resolve));
await ping("after");
// Graceful: it resolves once every connection is gone, including the one the
// failed resume owns.
await server.stop();
log("done");
