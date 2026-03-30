import { test, expect } from "bun:test";
import { createServer, Socket } from "node:net";

test("socket.setTimeout resets on incoming data (reads)", async () => {
  // Create a server that pushes data every 200ms
  await using server = createServer((socket) => {
    const interval = setInterval(() => socket.write("ping\n"), 200);
    socket.on("close", () => clearInterval(interval));
    socket.on("error", () => clearInterval(interval));
  });

  const { promise: listening, resolve: onListening } = Promise.withResolvers<number>();
  server.listen(0, () => {
    const addr = server.address();
    if (addr && typeof addr === "object") {
      onListening(addr.port);
    }
  });
  const port = await listening;

  const { promise: done, resolve, reject } = Promise.withResolvers<{ reads: number; timedOut: boolean }>();

  let reads = 0;
  let timedOut = false;

  const client = new Socket();
  // Set a 1s timeout — server sends data every 200ms, so if reads
  // reset the timer this should never fire within our 3s window.
  client.setTimeout(1000);
  client.on("timeout", () => {
    timedOut = true;
    client.end();
    resolve({ reads, timedOut });
  });
  client.on("data", () => {
    reads++;
  });
  client.on("error", (err) => reject(err));

  client.connect(port, "127.0.0.1", () => {
    // After 3s of receiving data, close gracefully — timeout should not have fired
    setTimeout(() => {
      client.end();
      resolve({ reads, timedOut });
    }, 3000);
  });

  const result = await done;

  // With the fix: reads reset the timer, so no timeout fires.
  // The client should have received multiple data events and not timed out.
  expect(result.timedOut).toBe(false);
  expect(result.reads).toBeGreaterThan(5);
});
