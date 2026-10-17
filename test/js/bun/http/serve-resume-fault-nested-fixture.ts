// Run with `bun test`: the same setup as serve-resume-fault-fixture.ts, but the
// resume fails inside the dispatch of another request, and that dispatch then
// waits on the loop for the outcome. expect().rejects does that wait: not
// awaited, it ticks the loop until the promise settles. The close the resume
// owes has to come from that inner tick, or the wait never ends.
import { socketFaultInjection as fault } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { connect } from "node:net";

// In a directory that the test which spawns this file owns and removes.
const unix = process.env.SERVE_RESUME_FAULT_SOCKET!;
// Above REQUEST_BODY_HIGH_WATER_MARK, so the server pauses the socket.
const BODY_CHUNK = 1024 * 1024 + 4096;

function request(path: string) {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let response = "";
  const client = connect({ path: unix });
  client.on("connect", () => client.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
  client.on("data", chunk => (response += chunk));
  client.on("error", reject);
  client.on("close", () => resolve(response.split("\r\n\r\n")[1]));
  return promise;
}

test("a dispatch that waits on the loop gets the close of the socket it resumed", async () => {
  let upload: Request | undefined;
  let aborted = false;
  const release = Promise.withResolvers<void>();

  const server = Bun.serve({
    unix,
    idleTimeout: 0,
    maxRequestBodySize: 64 * 1024 * 1024,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname === "/ping") return new Response("pong");
      if (pathname === "/wait") {
        // One shot, consumed by the resume that .arrayBuffer() makes.
        fault.set({ syscall: "poll_start", action: "errno", errno: "ENOMEM", repeat: 1 });
        expect(upload!.arrayBuffer()).rejects.toThrow("The connection was closed.");
        return new Response(`aborted: ${aborted}`);
      }
      upload = req;
      req.signal.addEventListener("abort", () => (aborted = true));
      await release.promise;
      return new Response("late");
    },
  });

  try {
    const socket = connect({ path: unix });
    socket.on("error", () => {});
    await new Promise<void>(resolve => socket.once("connect", resolve));
    socket.write(`POST /upload HTTP/1.1\r\nHost: x\r\nContent-Length: ${8 * BODY_CHUNK}\r\n\r\n`);
    await new Promise<void>(resolve => socket.write(Buffer.alloc(BODY_CHUNK, 0x61), () => resolve()));
    socket.destroy();
    await new Promise<void>(resolve => socket.once("close", resolve));

    // A request of its own, so the loop polls: the hangup of the socket above
    // is collected there and parks its fd.
    expect(await request("/ping")).toBe("pong");
    expect(await request("/wait")).toBe("aborted: true");
    // A connection of its own again: a rule the resume did not consume fails
    // its first poll registration.
    expect(await request("/ping")).toBe("pong");
  } finally {
    release.resolve();
    fault.clear();
    await server.stop();
  }
});
