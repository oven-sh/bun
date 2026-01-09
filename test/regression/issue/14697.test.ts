// https://github.com/oven-sh/bun/issues/14697
// node:http ServerResponse should emit close event when client disconnects
import { expect, test } from "bun:test";
import { createServer } from "node:http";

test("ServerResponse emits close event when client disconnects", async () => {
  const events: string[] = [];
  let resolveTest: () => void;
  const testPromise = new Promise<void>(resolve => {
    resolveTest = resolve;
  });

  const server = createServer((req, res) => {
    req.once("close", () => {
      events.push("request-close");
    });

    res.once("close", () => {
      events.push("response-close");
      // Both events should have fired by now
      resolveTest();
    });

    // Don't send any response, let the client disconnect
  });

  await new Promise<void>(resolve => {
    server.listen(0, () => resolve());
  });

  const port = (server.address() as any).port;

  // Connect and immediately disconnect
  const socket = await Bun.connect({
    hostname: "localhost",
    port,
    socket: {
      open(socket) {
        // Send a minimal HTTP request
        socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        // Immediately close the connection
        socket.end();
      },
      data() {},
      error() {},
      close() {},
    },
  });

  // Wait for both close events to fire
  await testPromise;

  server.close();

  // Both request and response should have emitted close events
  expect(events).toContain("request-close");
  expect(events).toContain("response-close");
});
