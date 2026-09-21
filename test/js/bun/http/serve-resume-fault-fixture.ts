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
import { rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mode = process.argv[2];
const unix = join(tmpdir(), `serve-resume-fault-${process.pid}.sock`);
// Above REQUEST_BODY_HIGH_WATER_MARK, so the server pauses the socket.
const BODY_CHUNK = 1024 * 1024 + 4096;

const faultArmed = Promise.withResolvers<void>();
const handlerDone = Promise.withResolvers<void>();
const log = (line: string) => console.log(line);
const ping = async (label: string) => {
  const response = await fetch("http://localhost/ping", { unix });
  log(`${label}: ${response.status} ${await response.text()}`);
};

using server = Bun.serve({
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

    handlerDone.resolve();
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
// still armed would fail the next connection's first poll registration.
fault.set({ syscall: "poll_start", action: "errno", errno: "ENOMEM", repeat: 1 });
faultArmed.resolve();

await handlerDone.promise;
await ping("after");
// Graceful: it resolves once every connection is gone, including the one the
// failed resume owns.
await server.stop();
rmSync(unix, { force: true });
log("done");
