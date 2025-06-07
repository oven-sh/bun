import type { Socket } from "bun";
import { setSocketOptions } from "bun:internal-for-testing";
import { describe, test } from "bun:test";
import { isPosix } from "harness";

describe.if(isPosix)("HTTP server handles fragmented requests", () => {
  test("handles requests with tiny send buffer (regression test)", async () => {
    using server = Bun.serve({
      hostname: "localhost",

      port: 0,
      async fetch(req) {
        const body = await req.text();
        const headers: Record<string, string> = {};
        req.headers.forEach((value, key) => {
          headers[key] = value;
        });
        return new Response(
          JSON.stringify({
            method: req.method,
            url: req.url,
            headers,
            body,
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    const { port } = server;
    let remaining = 100;
    const batchSize = 10;

    for (let i = 0; i < remaining; i += batchSize) {
      const promises: Promise<void>[] = [];
      for (let j = 0; j < batchSize; j++) {
        promises.push(
          (async i => {
            const { resolve: resolveClose, reject: rejectClose, promise: closePromise } = Promise.withResolvers();

            let buffer: Buffer;

            const socket = await Bun.connect({
              hostname: server.hostname,
              port: server.port!,
              socket: {
                open(socket: Socket) {
                  // Set a very small send buffer to force fragmentation
                  // This simulates the condition that triggered the bug
                  setSocketOptions(socket, 1, 1); // 1 = send buffer, 1 = size

                  const input = `GET /test-${i} HTTP/1.1\r\nHost: ${server.hostname}:${port}\r\nUser-Agent: Bun-Test\r\nAccept: */*\r\n\r\n`;
                  const repeated = Buffer.alloc(input.length * 20, input);

                  buffer = repeated;
                  const written = socket.write(buffer);
                  if (written > 20) {
                    throw new Error(`Written ${written} bytes, expected 1`);
                  }
                  buffer = buffer.slice(written);
                },
                data(socket: Socket, data: Buffer) {
                  const response = data.toString();
                  // Basic validation that we got a valid HTTP response
                  if (!response.includes("HTTP/1.1 200 OK")) {
                    rejectClose(new Error(`Invalid response: ${response}`));
                  }
                  socket.end();
                },
                close() {
                  resolveClose();
                },
                drain(socket: Socket) {
                  if (buffer.length > 0) {
                    const written = socket.write(buffer);

                    if (written > 20) {
                      throw new Error(`Written ${written} bytes, expected 1`);
                    }
                    buffer = buffer.slice(written);
                  }
                },
                error(_socket: Socket, error: Error) {
                  rejectClose(error);
                },
              },
            });

            // Wait for the socket to close
            await closePromise;
          })(i),
        );
      }

      await Promise.all(promises);
    }

    server.stop();
  });
});
