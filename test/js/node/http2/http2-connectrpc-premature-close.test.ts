/**
 * Test for HTTP/2 premature close bug affecting Connect RPC clients.
 *
 * The bug: When a server sends data rapidly and closes the stream immediately,
 * the client may receive END_STREAM before all DATA frames are consumed,
 * resulting in "premature close" errors and data loss.
 *
 * The fix: The streamEnd handler now checks if data is still buffered
 * (ended=true but endEmitted=false) and waits for the 'end' event before
 * destroying the stream, preventing data loss.
 *
 * NOTE: This test demonstrates the pattern but may not reliably trigger the bug
 * without cross-process timing. For a comprehensive reproduction using Connect RPC,
 * see: https://gist.github.com/tomsanbear/ff6d272d404d9d02f62a8f54d55550ea
 */

import { describe, expect, test } from "bun:test";
import http2 from "node:http2";

describe("HTTP/2 premature close bug", () => {
  test("client should handle rapid data + immediate close", async () => {
    // This test demonstrates the pattern but may not reliably trigger the bug
    // without cross-process timing (Node.js server subprocess)
    const messageCount = 100;
    const messageSize = 10000;

    const server = http2.createServer();

    server.on("stream", stream => {
      stream.respond({
        ":status": 200,
        "content-type": "application/octet-stream",
      });

      // Send data rapidly
      for (let i = 0; i < messageCount; i++) {
        stream.write(Buffer.alloc(messageSize, 0x41));
      }

      // Close immediately
      stream.end();
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const client = http2.connect(`http://localhost:${port}`);
    const stream = client.request({ ":path": "/" });

    // Half-close request immediately (gRPC/Connect-style)
    stream.end();

    let receivedBytes = 0;
    let error: Error | null = null;

    stream.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
    });

    stream.on("error", (err: Error) => {
      error = err;
    });

    await new Promise(resolve => {
      stream.once("end", resolve);
      stream.once("error", resolve);
    });

    client.close();
    await new Promise<void>(res => server.close(() => res()));

    // Should receive all data without errors
    expect(error).toBeNull();
    expect(receivedBytes).toBe(messageCount * messageSize);
  });
});
