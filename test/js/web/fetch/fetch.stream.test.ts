import { Socket, Server, TCPSocketListener } from "bun";
import { describe, expect, it } from "bun:test";
import { gcTick } from "harness";

describe("fetch() with streaming", () => {
  it("stream still works after response get out of scope", async () => {
    let server: Server | null = null;
    try {
      const content = "Hello, world!\n".repeat(5);
      server = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(controller) {
                const data = Buffer.from(content, "utf8");
                const size = data.byteLength / 5;
                controller.write(data.slice(0, size));
                await controller.flush();
                await Bun.sleep(100);
                controller.write(data.slice(size, size * 2));
                await controller.flush();
                await Bun.sleep(100);
                controller.write(data.slice(size * 2, size * 3));
                await controller.flush();
                await Bun.sleep(100);
                controller.write(data.slice(size * 3, size * 5));
                await controller.flush();

                controller.close();
              },
            }),
            { status: 200, headers: { "Content-Type": "text/plain" } },
          );
        },
      });

      async function getReader() {
        return (await fetch(`http://${server.hostname}:${server.port}`, { verbose: true })).body?.getReader();
      }
      gcTick(true);
      const reader = await getReader();
      gcTick(true);
      let buffer = Buffer.alloc(0);
      let parts = 0;
      while (true) {
        gcTick(true);

        const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
        if (value) {
          buffer = Buffer.concat([buffer, value]);
        }
        parts++;
        if (done) {
          break;
        }
      }

      gcTick(true);
      expect(buffer.toString("utf8")).toBe(content);
      expect(parts).toBeGreaterThan(1);
    } finally {
      server?.stop();
    }
  });

  it("response inspected size should reflect stream state", async () => {
    let server: Server | null = null;
    try {
      const content = "Bun!\n".repeat(4);
      server = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(controller) {
                const data = Buffer.from(content, "utf8");
                const size = data.byteLength / 5;
                controller.write(data.slice(0, size));
                await controller.flush();
                await Bun.sleep(100);
                controller.write(data.slice(size, size * 2));
                await controller.flush();
                await Bun.sleep(100);
                controller.write(data.slice(size * 2, size * 3));
                await controller.flush();
                await Bun.sleep(100);
                controller.write(data.slice(size * 3, size * 4));
                await controller.flush();

                controller.close();
              },
            }),
            { status: 200, headers: { "Content-Type": "text/plain" } },
          );
        },
      });

      function inspectBytes(response: Response) {
        const match = /Response \(([0-9]+ )bytes\)/g.exec(
          Bun.inspect(response, {
            depth: 0,
          }),
        );
        if (!match) return 0;
        return parseInt(match[1]?.trim(), 10);
      }

      const res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
      gcTick(true);
      const reader = res.body?.getReader();
      gcTick(true);
      let size = 0;
      while (true) {
        gcTick(true);

        const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
        if (value) {
          size += value.length;
        }
        expect(inspectBytes(res)).toBe(size);
        if (done) {
          break;
        }
      }

      gcTick(true);
    } finally {
      server?.stop();
    }
  });

  type CompressionType = "no" | "gzip" | "deflate" | "br";
  type TestType = { headers: Record<string, string>; compression: CompressionType; skip?: boolean };
  const types: Array<TestType> = [
    { headers: {}, compression: "no" },
    { headers: { "Content-Encoding": "gzip" }, compression: "gzip" },
    { headers: { "Content-Encoding": "deflate" }, compression: "deflate" },
    { headers: { "Content-Encoding": "br" }, compression: "br", skip: true }, // not implemented yet
  ];

  function compress(compression: CompressionType, data: Uint8Array) {
    switch (compression) {
      case "gzip":
        return Bun.gzipSync(data);
      case "deflate":
        return Bun.deflateSync(data);
      default:
        return data;
    }
  }

  for (const { headers, compression, skip } of types) {
    const test = skip ? it.skip : it;

    test(`chunked response works (single chunk) with ${compression} compression`, async () => {
      let server: Server | null = null;
      try {
        const content = "Hello, world!\n".repeat(5);
        server = Bun.serve({
          port: 0,
          fetch(req) {
            return new Response(
              new ReadableStream({
                type: "direct",
                async pull(controller) {
                  const data = compress(compression, Buffer.from(content, "utf8"));
                  controller.write(data);
                  await controller.flush();
                  controller.close();
                },
              }),
              {
                status: 200,
                headers: {
                  "Content-Type": "text/plain",
                  ...headers,
                },
              },
            );
          },
        });
        let res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
        gcTick(true);
        const result = await res.text();
        gcTick(true);
        expect(result).toBe(content);

        res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
        gcTick(true);
        const reader = res.body?.getReader();

        let buffer = Buffer.alloc(0);
        let parts = 0;
        while (true) {
          gcTick(true);

          const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
          if (value) {
            buffer = Buffer.concat([buffer, value]);
            parts++;
          }
          if (done) {
            break;
          }
        }

        gcTick(true);
        expect(buffer.toString("utf8")).toBe(content);
        expect(parts).toBe(1);
      } finally {
        server?.stop();
      }
    });

    test(`chunked response works (multiple chunks) with ${compression} compression`, async () => {
      let server: Server | null = null;
      try {
        const content = "Hello, world!\n".repeat(5);
        server = Bun.serve({
          port: 0,
          fetch(req) {
            return new Response(
              new ReadableStream({
                type: "direct",
                async pull(controller) {
                  const data = compress(compression, Buffer.from(content, "utf8"));
                  const size = data.byteLength / 5;
                  controller.write(data.slice(0, size));
                  await controller.flush();
                  await Bun.sleep(100);
                  controller.write(data.slice(size, size * 2));
                  await controller.flush();
                  await Bun.sleep(100);
                  controller.write(data.slice(size * 2, size * 3));
                  await controller.flush();
                  await Bun.sleep(100);
                  controller.write(data.slice(size * 3, size * 5));
                  await controller.flush();

                  controller.close();
                },
              }),
              {
                status: 200,
                headers: {
                  "Content-Type": "text/plain",
                  ...headers,
                },
              },
            );
          },
        });
        let res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
        gcTick(true);
        const result = await res.text();
        gcTick(true);
        expect(result).toBe(content);

        res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
        gcTick(true);
        const reader = res.body?.getReader();

        let buffer = Buffer.alloc(0);
        let parts = 0;
        while (true) {
          gcTick(true);

          const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
          if (value) {
            buffer = Buffer.concat([buffer, value]);
          }
          parts++;
          if (done) {
            break;
          }
        }

        gcTick(true);
        expect(buffer.toString("utf8")).toBe(content);
        expect(parts).toBeGreaterThan(1);
      } finally {
        server?.stop();
      }
    });

    test(`Content-Length response works (single part) with ${compression} compression`, async () => {
      let server: Server | null = null;
      try {
        const content = "a".repeat(1024);

        server = Bun.serve({
          port: 0,
          fetch(req) {
            return new Response(compress(compression, Buffer.from(content)), {
              status: 200,
              headers: {
                "Content-Type": "text/plain",
                ...headers,
              },
            });
          },
        });
        let res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
        gcTick(true);
        const result = await res.text();
        gcTick(true);
        expect(result).toBe(content);

        res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
        gcTick(true);
        const reader = res.body?.getReader();

        let buffer = Buffer.alloc(0);
        let parts = 0;
        while (true) {
          gcTick(true);

          const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
          if (value) {
            buffer = Buffer.concat([buffer, value]);
            parts++;
          }
          if (done) {
            break;
          }
        }

        gcTick(true);
        expect(buffer.toString("utf8")).toBe(content);
        expect(parts).toBe(1);
      } finally {
        server?.stop();
      }
    });

    test(`Content-Length response works (multiple parts) with ${compression} compression`, async () => {
      let server: Server | null = null;
      try {
        const content = "a".repeat(64 * 1024);

        server = Bun.serve({
          port: 0,
          fetch(req) {
            return new Response(compress(compression, Buffer.from(content)), {
              status: 200,
              headers: {
                "Content-Type": "text/plain",
                ...headers,
              },
            });
          },
        });
        let res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
        gcTick(true);
        const result = await res.text();
        gcTick(true);
        expect(result).toBe(content);

        res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
        gcTick(true);
        const reader = res.body?.getReader();

        let buffer = Buffer.alloc(0);
        let parts = 0;
        while (true) {
          gcTick(true);

          const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
          if (value) {
            buffer = Buffer.concat([buffer, value]);
            parts++;
          }
          if (done) {
            break;
          }
        }

        gcTick(true);
        expect(buffer.toString("utf8")).toBe(content);
        expect(parts).toBeGreaterThan(1);
      } finally {
        server?.stop();
      }
    });

    test(`Extra data should be ignored on streaming (multiple chunks, TCP server) with ${compression} compression`, async () => {
      let server: TCPSocketListener<any> | null = null;

      try {
        const parts = 5;
        const content = "Hello".repeat(parts);

        server = Bun.listen({
          port: 0,
          hostname: "0.0.0.0",
          socket: {
            async open(socket) {
              var corked: any[] = [];
              var cork = true;
              async function write(chunk: any) {
                await new Promise<void>((resolve, reject) => {
                  if (cork) {
                    corked.push(chunk);
                  }

                  if (!cork && corked.length) {
                    socket.write(corked.join(""));
                    corked.length = 0;
                    socket.flush();
                  }

                  if (!cork) {
                    socket.write(chunk);
                    socket.flush();
                  }

                  resolve();
                });
              }
              const compressed = compress(compression, Buffer.from(content, "utf8"));
              await write("HTTP/1.1 200 OK\r\n");
              await write("Content-Type: text/plain\r\n");
              for (const [key, value] of Object.entries(headers)) {
                await write(key + ": " + value + "\r\n");
              }
              await write("Content-Length: " + compressed.byteLength + "\r\n");
              await write("\r\n");
              const size = compressed.byteLength / 5;
              for (var i = 0; i < 5; i++) {
                cork = false;
                await write(compressed.slice(size * i, size * (i + 1)));
              }
              await write("Extra Data!");
              await write("Extra Data!");
              socket.flush();
            },
            drain(socket) {},
          },
        });

        const res = await fetch(`http://${server.hostname}:${server.port}`, { verbose: true });
        gcTick(true);
        const reader = res.body?.getReader();

        let buffer = Buffer.alloc(0);
        while (true) {
          gcTick(true);

          const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
          if (value) {
            buffer = Buffer.concat([buffer, value]);
          }
          if (done) {
            break;
          }
        }

        gcTick(true);
        expect(buffer.toString("utf8")).toBe(content);
      } finally {
        server?.stop(true);
      }
    });

    test(`Missing data should timeout on streaming (multiple chunks, TCP server) with ${compression} compression`, async () => {
      let server: TCPSocketListener<any> | null = null;

      try {
        const parts = 5;
        const content = "Hello".repeat(parts);

        server = Bun.listen({
          port: 0,
          hostname: "0.0.0.0",
          socket: {
            async open(socket) {
              var corked: any[] = [];
              var cork = true;
              async function write(chunk: any) {
                await new Promise<void>((resolve, reject) => {
                  if (cork) {
                    corked.push(chunk);
                  }

                  if (!cork && corked.length) {
                    socket.write(corked.join(""));
                    corked.length = 0;
                    socket.flush();
                  }

                  if (!cork) {
                    socket.write(chunk);
                    socket.flush();
                  }

                  resolve();
                });
              }
              const compressed = compress(compression, Buffer.from(content, "utf8"));
              await write("HTTP/1.1 200 OK\r\n");
              await write("Content-Type: text/plain\r\n");
              for (const [key, value] of Object.entries(headers)) {
                await write(key + ": " + value + "\r\n");
              }
              // 10 extra missing bytes that we will never sent
              await write("Content-Length: " + compressed.byteLength + 10 + "\r\n");
              await write("\r\n");
              const size = compressed.byteLength / 5;
              for (var i = 0; i < 5; i++) {
                cork = false;
                await write(compressed.slice(size * i, size * (i + 1)));
              }
              socket.flush();
            },
            drain(socket) {},
          },
        });

        const res = await fetch(`http://${server.hostname}:${server.port}`, {
          signal: AbortSignal.timeout(1000),
          verbose: true,
        });
        gcTick(true);
        try {
          const reader = res.body?.getReader();

          let buffer = Buffer.alloc(0);
          while (true) {
            gcTick(true);

            const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
            if (value) {
              buffer = Buffer.concat([buffer, value]);
            }
            if (done) {
              break;
            }
          }

          gcTick(true);
          expect(buffer.toString("utf8")).toBe("unreachable");
        } catch (err) {
          expect((err as Error).name).toBe("TimeoutError");
        }
      } finally {
        server?.stop(true);
      }
    });

    test(`can handle socket close with ${compression} compression`, async () => {
      let server: TCPSocketListener<any> | null = null;

      try {
        const parts = 5;
        const content = "Hello".repeat(parts);
        const { promise, resolve: resolveSocket } = Promise.withResolvers<Socket>();
        server = Bun.listen({
          port: 0,
          hostname: "0.0.0.0",
          socket: {
            async open(socket) {
              var corked: any[] = [];
              var cork = true;
              async function write(chunk: any) {
                await new Promise<void>((resolve, reject) => {
                  if (cork) {
                    corked.push(chunk);
                  }

                  if (!cork && corked.length) {
                    socket.write(corked.join(""));
                    corked.length = 0;
                    socket.flush();
                  }

                  if (!cork) {
                    socket.write(chunk);
                    socket.flush();
                  }

                  resolve();
                });
              }
              const compressed = compress(compression, Buffer.from(content, "utf8"));
              await write("HTTP/1.1 200 OK\r\n");
              await write("Content-Type: text/plain\r\n");
              for (const [key, value] of Object.entries(headers)) {
                await write(key + ": " + value + "\r\n");
              }
              // 10 extra missing bytes that we will never sent in this case we will wait to close
              await write("Content-Length: " + compressed.byteLength + 10 + "\r\n");
              await write("\r\n");
              const size = compressed.byteLength / 5;
              for (var i = 0; i < 5; i++) {
                cork = false;
                await write(compressed.slice(size * i, size * (i + 1)));
              }
              socket.flush();
              resolveSocket(socket);
            },
            drain(socket) {},
          },
        });

        const res = await fetch(`http://${server.hostname}:${server.port}`, {
          verbose: true,
        });
        gcTick(true);

        let socket: Socket | null = await promise;
        try {
          const reader = res.body?.getReader();

          let buffer = Buffer.alloc(0);

          while (true) {
            gcTick(true);
            const read_promise = reader?.read();
            socket?.end();
            socket = null;
            const { done, value } = (await read_promise) as ReadableStreamDefaultReadResult<any>;

            if (value) {
              buffer = Buffer.concat([buffer, value]);
            }

            if (done) {
              break;
            }
          }

          gcTick(true);
          expect(buffer.toString("utf8")).toBe("unreachable");
        } catch (err) {
          expect((err as Error).name).toBe("ConnectionClosed");
        }
      } finally {
        server?.stop(true);
      }
    });
  }
});
