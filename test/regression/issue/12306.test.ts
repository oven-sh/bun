import { expect, test } from "bun:test";
import { createServer, Socket } from "node:net";

test("socket.setTimeout resets on incoming data (reads)", async () => {
  const { promise: done, resolve, reject } = Promise.withResolvers<{ reads: number; timedOut: boolean }>();

  let reads = 0;
  let timedOut = false;

  // 10 reads at 200ms intervals ≈ 2s, well past the 1s timeout.
  // If reads correctly reset the timer, no timeout fires.
  const READ_THRESHOLD = 10;

  // Create a server that pushes data every 200ms
  const server = createServer((socket) => {
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

  const client = new Socket();
  // Set a 1s timeout — server sends data every 200ms, so if reads
  // reset the timer this should never fire before we hit the threshold.
  client.setTimeout(1000);
  client.on("timeout", () => {
    timedOut = true;
    client.end();
    resolve({ reads, timedOut });
  });
  client.on("data", () => {
    reads++;
    if (reads >= READ_THRESHOLD) {
      client.end();
      resolve({ reads, timedOut });
    }
  });
  client.on("error", (err) => reject(err));

  client.connect(port, "127.0.0.1");

  const result = await done;

  // Close server and wait for it
  const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();
  server.close(() => onClosed());
  await closed;

  // With the fix: reads reset the timer, so no timeout fires.
  // The client should have received multiple data events and not timed out.
  expect(result.timedOut).toBe(false);
  expect(result.reads).toBeGreaterThan(5);
});
