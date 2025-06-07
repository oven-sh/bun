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

            function actuallyWrite(socket) {
              while (buffer.length > 0) {
                const written = socket.write(buffer.slice(0, 1));

                if (written == 0) break;

                if (written > 1) {
                  throw new Error(`Written ${written} bytes, expected 1`);
                }
                socket.flush();
                buffer = buffer.slice(written);
              }
            }

            let remainingRequests = 20;

            const socket = await Bun.connect({
              hostname: server.hostname,
              port: server.port!,
              socket: {
                open(socket: Socket) {
                  // Set a very small send buffer to force fragmentation
                  // This simulates the condition that triggered the bug
                  setSocketOptions(socket, 1, 1); // 1 = send buffer, 1 = size

                  const input = `GET /test-${i} HTTP/1.1\r\nHost: ${server.hostname}:${port}\r\nUser-Agent: Bun-Test\r\nAccept: */*\r\n\r\n`;
                  const repeated = Buffer.alloc(input.length * remainingRequests, input);

                  buffer = repeated;
                  actuallyWrite(socket);
                },
                data(socket: Socket, data: Buffer) {
                  // Mini HTTP parser to count complete responses
                  const dataStr = data.toString();
                  const responses = dataStr.split("\r\n\r\n");

                  // Count complete responses (those that have both headers and body)
                  for (let k = 0; k < responses.length - 1; k++) {
                    if (responses[k].includes("HTTP/1.1 200 OK")) {
                      remainingRequests--;
                    }
                  }
                  if (remainingRequests == 0) {
                    socket.end();
                  }
                },
                close() {
                  if (remainingRequests > 0) {
                    throw new Error(`Expected 20 responses, got ${20 - remainingRequests}`);
                  }

                  resolveClose();
                },
                drain(socket: Socket) {
                  actuallyWrite(socket);
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
