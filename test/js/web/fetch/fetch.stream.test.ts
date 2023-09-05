import { Socket, Server, TCPSocketListener } from "bun";
import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "bun:test";
import { gcTick } from "harness";
import zlib from "zlib";
import http from "http";
import { createReadStream } from "fs";
import { pipeline } from "stream";
import type { AddressInfo } from "net";

const files = [
  join(import.meta.dir, "fixture.html"),
  join(import.meta.dir, "fixture.png"),
  join(import.meta.dir, "fixture.png.gz"),
];

const fixtures = {
  "fixture": readFileSync(join(import.meta.dir, "fixture.html")),
  "fixture.png": readFileSync(join(import.meta.dir, "fixture.png")),
  "fixture.png.gz": readFileSync(join(import.meta.dir, "fixture.png.gz")),
};

const invalid = Buffer.from([0xc0]);

const bigText = Buffer.from("a".repeat(1 * 1024 * 1024));
const smallText = Buffer.from("Hello".repeat(16));
const empty = Buffer.alloc(0);

describe("fetch() with streaming", () => {
  it("can deflate with and without headers #4478", async () => {
    let server: Server | null = null;
    try {
      server = Bun.serve({
        port: 0,
        fetch(req) {
          if (req.url.endsWith("/with_headers")) {
            const content = zlib.deflateSync(Buffer.from("Hello, World"));
            return new Response(content, {
              headers: {
                "Content-Type": "text/plain",
                "Content-Encoding": "deflate",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
          const content = zlib.deflateRawSync(Buffer.from("Hello, World"));
          return new Response(content, {
            headers: {
              "Content-Type": "text/plain",
              "Content-Encoding": "deflate",
              "Access-Control-Allow-Origin": "*",
            },
          });
        },
      });
      const url = `http://${server.hostname}:${server.port}/`;
      expect(await fetch(`${url}with_headers`).then(res => res.text())).toBe("Hello, World");
      expect(await fetch(url).then(res => res.text())).toBe("Hello, World");
    } finally {
      server?.stop();
    }
  });

  for (let file of files) {
    it("stream can handle response.body + await response.something() #4500", async () => {
      let server: ReturnType<typeof http.createServer> | null = null;
      try {
        const errorHandler = (err: any) => expect(err).toBeUndefined();

        server = http
          .createServer(function (req, res) {
            res.writeHead(200, { "Content-Type": "text/plain" });

            pipeline(createReadStream(file), res, errorHandler);
          })
          .listen(0);

        const address = server.address() as AddressInfo;
        const url = `http://${address.address}:${address.port}`;
        async function getRequestLen(url: string) {
          const response = await fetch(url);
          const hasBody = response.body;
          if (hasBody) {
            const res = await response.blob();
            return res.size;
          }
          return 0;
        }

        for (let i = 0; i < 10; i++) {
          let len = await getRequestLen(url);
          if (len <= 0) {
            throw new Error("Request length is 0");
          }
          await Bun.sleep(50);
        }

        expect(true).toBe(true);
      } finally {
        server?.close();
      }
    });
  }

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
        return (await fetch(`http://${server.hostname}:${server.port}`, {})).body?.getReader();
      }
      gcTick(false);
      const reader = await getReader();
      gcTick(false);
      let buffer = Buffer.alloc(0);
      let parts = 0;
      while (true) {
        gcTick(false);

        const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
        if (value) {
          buffer = Buffer.concat([buffer, value]);
        }
        parts++;
        if (done) {
          break;
        }
      }

      gcTick(false);
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

      const res = await fetch(`http://${server.hostname}:${server.port}`, {});
      gcTick(false);
      const reader = res.body?.getReader();
      gcTick(false);
      let size = 0;
      while (true) {
        gcTick(false);

        const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
        if (value) {
          size += value.length;
        }
        expect(inspectBytes(res)).toBe(size);
        if (done) {
          break;
        }
      }

      gcTick(false);
    } finally {
      server?.stop();
    }
  });

  it("can handle multiple simultaneos requests", async () => {
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
            {
              status: 200,
              headers: {
                "Content-Type": "text/plain",
              },
            },
          );
        },
      });

      const server_url = `http://${server.hostname}:${server.port}`;
      async function doRequest() {
        await Bun.sleep(10);
        const res = await fetch(server_url);
        const reader = res.body?.getReader();
        let buffer = Buffer.alloc(0);
        let parts = 0;
        while (true) {
          const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
          if (value) {
            buffer = Buffer.concat([buffer, value]);
            parts++;
          }
          if (done) {
            break;
          }
        }

        gcTick(false);
        expect(buffer.toString("utf8")).toBe(content);
        expect(parts).toBeGreaterThan(1);
      }

      await Promise.all([doRequest(), doRequest(), doRequest(), doRequest(), doRequest(), doRequest()]);
    } finally {
      server?.stop();
    }
  });

  it(`can handle transforms`, async () => {
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
            {
              status: 200,
              headers: {
                "Content-Type": "text/plain",
              },
            },
          );
        },
      });

      const server_url = `http://${server.hostname}:${server.port}`;
      const res = await fetch(server_url);

      const transform = new TransformStream({
        transform(chunk, controller) {
          controller.enqueue(Buffer.from(chunk).toString("utf8").toUpperCase());
        },
      });

      const reader = res.body?.pipeThrough(transform).getReader();

      let result = "";
      while (true) {
        const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
        if (value) {
          result += value;
        }
        if (done) {
          break;
        }
      }

      gcTick(false);
      expect(result).toBe(content.toUpperCase());
    } finally {
      server?.stop();
    }
  });

  it(`can handle gz images`, async () => {
    let server: Server | null = null;
    try {
      server = Bun.serve({
        port: 0,
        fetch(req) {
          const data = fixtures["fixture.png.gz"];
          return new Response(data, {
            status: 200,
            headers: {
              "Content-Type": "text/plain",
              "Content-Encoding": "gzip",
            },
          });
        },
      });

      const server_url = `http://${server.hostname}:${server.port}`;
      const res = await fetch(server_url);

      const reader = res.body?.getReader();

      let buffer = Buffer.alloc(0);
      while (true) {
        const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
        if (value) {
          buffer = Buffer.concat([buffer, value]);
        }
        if (done) {
          break;
        }
      }

      gcTick(false);
      expect(buffer).toEqual(fixtures["fixture.png"]);
    } finally {
      server?.stop();
    }
  });

  it(`can proxy fetch with Bun.serve`, async () => {
    let server: Server | null = null;
    let server_original: Server | null = null;
    try {
      const content = "a".repeat(64 * 1024);

      server_original = Bun.serve({
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
            {
              status: 200,
              headers: {
                "Content-Type": "text/plain",
              },
            },
          );
        },
      });

      server = Bun.serve({
        port: 0,
        async fetch(req) {
          const response = await fetch(`http://${server_original.hostname}:${server_original.port}`, {});
          await Bun.sleep(10);
          return new Response(response.body, {
            status: 200,
            headers: {
              "Content-Type": "text/plain",
            },
          });
        },
      });

      let res = await fetch(`http://${server.hostname}:${server.port}`, {});
      gcTick(false);
      const reader = res.body?.getReader();

      let buffer = Buffer.alloc(0);
      let parts = 0;
      while (true) {
        gcTick(false);

        const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
        if (value) {
          buffer = Buffer.concat([buffer, value]);
          parts++;
        }
        if (done) {
          break;
        }
      }

      gcTick(false);
      expect(buffer.toString("utf8")).toBe(content);
      expect(parts).toBeGreaterThanOrEqual(1);
    } finally {
      server?.stop();
      server_original?.stop();
    }
  });
  const matrix = [
    { name: "small", data: fixtures["fixture"] },
    { name: "small text", data: smallText },
    { name: "big text", data: bigText },
    { name: "img", data: fixtures["fixture.png"] },
    { name: "empty", data: empty },
  ];
  for (let i = 0; i < matrix.length; i++) {
    const fixture = matrix[i];
    for (let j = 0; j < matrix.length; j++) {
      const fixtureb = matrix[j];
      it(`can handle fixture ${fixture.name} x ${fixtureb.name}`, async () => {
        let server: Server | null = null;
        try {
          //@ts-ignore
          const data = fixture.data;
          //@ts-ignore
          const data_b = fixtureb.data;
          const content = Buffer.concat([data, data_b]);
          server = Bun.serve({
            port: 0,
            fetch(req) {
              return new Response(
                new ReadableStream({
                  type: "direct",
                  async pull(controller) {
                    controller.write(data);
                    await controller.flush();
                    await Bun.sleep(100);
                    controller.write(data_b);
                    await controller.flush();
                    controller.close();
                  },
                }),
                {
                  status: 200,
                  headers: {
                    "Content-Type": "text/plain",
                  },
                },
              );
            },
          });

          const server_url = `http://${server.hostname}:${server.port}`;
          const res = await fetch(server_url);
          const reader = res.body?.getReader();
          let buffer = Buffer.alloc(0);
          while (true) {
            const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
            if (value) {
              buffer = Buffer.concat([buffer, value]);
            }
            if (done) {
              break;
            }
          }
          gcTick(false);
          expect(buffer).toEqual(content);
        } finally {
          server?.stop();
        }
      });
    }
  }

  type CompressionType = "no" | "gzip" | "deflate" | "br" | "deflate_with_headers";
  type TestType = { headers: Record<string, string>; compression: CompressionType; skip?: boolean };
  const types: Array<TestType> = [
    { headers: {}, compression: "no" },
    { headers: { "Content-Encoding": "gzip" }, compression: "gzip" },
    { headers: { "Content-Encoding": "deflate" }, compression: "deflate" },
    { headers: { "Content-Encoding": "deflate" }, compression: "deflate_with_headers" },
    // { headers: { "Content-Encoding": "br" }, compression: "br", skip: true }, // not implemented yet
  ];

  function compress(compression: CompressionType, data: Uint8Array) {
    switch (compression) {
      case "gzip":
        return Bun.gzipSync(data);
      case "deflate":
        return Bun.deflateSync(data);
      case "deflate_with_headers":
        return zlib.deflateSync(data);
      default:
        return data;
    }
  }

  for (const { headers, compression, skip } of types) {
    const test = skip ? it.skip : it;

    test(`with invalid utf8 with ${compression} compression`, async () => {
      let server: Server | null = null;
      try {
        const content = Buffer.concat([invalid, Buffer.from("Hello, world!\n".repeat(5), "utf8"), invalid]);
        server = Bun.serve({
          port: 0,
          fetch(req) {
            return new Response(
              new ReadableStream({
                type: "direct",
                async pull(controller) {
                  const data = compress(compression, content);
                  const size = data.byteLength / 4;
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

        let res = await fetch(`http://${server.hostname}:${server.port}`, {});
        gcTick(false);
        const reader = res.body?.getReader();

        let buffer = Buffer.alloc(0);
        while (true) {
          gcTick(false);

          const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
          if (value) {
            buffer = Buffer.concat([buffer, value]);
          }
          if (done) {
            break;
          }
        }

        gcTick(false);
        expect(buffer).toEqual(content);
      } finally {
        server?.stop();
      }
    });

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
        let res = await fetch(`http://${server.hostname}:${server.port}`, {});
        gcTick(false);
        const result = await res.text();
        gcTick(false);
        expect(result).toBe(content);

        res = await fetch(`http://${server.hostname}:${server.port}`, {});
        gcTick(false);
        const reader = res.body?.getReader();

        let buffer = Buffer.alloc(0);
        let parts = 0;
        while (true) {
          gcTick(false);

          const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
          if (value) {
            buffer = Buffer.concat([buffer, value]);
            parts++;
          }
          if (done) {
            break;
          }
        }

        gcTick(false);
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
        let res = await fetch(`http://${server.hostname}:${server.port}`, {});
        gcTick(false);
        const result = await res.text();
        gcTick(false);
        expect(result).toBe(content);

        res = await fetch(`http://${server.hostname}:${server.port}`, {});
        gcTick(false);
        const reader = res.body?.getReader();

        let buffer = Buffer.alloc(0);
        let parts = 0;
        while (true) {
          gcTick(false);

          const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
          if (value) {
            buffer = Buffer.concat([buffer, value]);
          }
          parts++;
          if (done) {
            break;
          }
        }

        gcTick(false);
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
        let res = await fetch(`http://${server.hostname}:${server.port}`, {});
        gcTick(false);
        const result = await res.text();
        gcTick(false);
        expect(result).toBe(content);

        res = await fetch(`http://${server.hostname}:${server.port}`, {});
        gcTick(false);
        const reader = res.body?.getReader();

        let buffer = Buffer.alloc(0);
        let parts = 0;
        while (true) {
          gcTick(false);

          const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
          if (value) {
            buffer = Buffer.concat([buffer, value]);
            parts++;
          }
          if (done) {
            break;
          }
        }

        gcTick(false);
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
        let res = await fetch(`http://${server.hostname}:${server.port}`, {});
        gcTick(false);
        const result = await res.text();
        gcTick(false);
        expect(result).toBe(content);

        res = await fetch(`http://${server.hostname}:${server.port}`, {});
        gcTick(false);
        const reader = res.body?.getReader();

        let buffer = Buffer.alloc(0);
        let parts = 0;
        while (true) {
          gcTick(false);

          const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
          if (value) {
            buffer = Buffer.concat([buffer, value]);
            parts++;
          }
          if (done) {
            break;
          }
        }

        gcTick(false);
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

        const res = await fetch(`http://${server.hostname}:${server.port}`, {});
        gcTick(false);
        const reader = res.body?.getReader();

        let buffer = Buffer.alloc(0);
        while (true) {
          gcTick(false);

          const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
          if (value) {
            buffer = Buffer.concat([buffer, value]);
          }
          if (done) {
            break;
          }
        }

        gcTick(false);
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
        try {
          const res = await fetch(`http://${server.hostname}:${server.port}`, {
            signal: AbortSignal.timeout(1000),
          });
          gcTick(false);
          const reader = res.body?.getReader();

          let buffer = Buffer.alloc(0);
          while (true) {
            gcTick(false);

            const { done, value } = (await reader?.read()) as ReadableStreamDefaultReadResult<any>;
            if (value) {
              buffer = Buffer.concat([buffer, value]);
            }
            if (done) {
              break;
            }
          }

          gcTick(false);
          expect(buffer.toString("utf8")).toBe("unreachable");
        } catch (err) {
          expect((err as Error).name).toBe("TimeoutError");
        }
      } finally {
        server?.stop(true);
      }
    });

    if (compression !== "no") {
      test(`can handle corrupted ${compression} compression`, async () => {
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
                // 10 extra missing bytes that we will never sent in this case we will wait to close
                await write("Content-Length: " + compressed.byteLength + "\r\n");
                await write("\r\n");
                const size = compressed.byteLength / 5;
                compressed[0] = 0; // corrupt data
                cork = false;
                for (var i = 0; i < 5; i++) {
                  compressed[size * i] = 0; // corrupt data even more
                  await write(compressed.slice(size * i, size * (i + 1)));
                }
                socket.flush();
              },
              drain(socket) {},
            },
          });

          try {
            const res = await fetch(`http://${server.hostname}:${server.port}`, {});
            gcTick(false);

            const reader = res.body?.getReader();

            let buffer = Buffer.alloc(0);

            while (true) {
              gcTick(false);
              const read_promise = reader?.read();
              const { done, value } = (await read_promise) as ReadableStreamDefaultReadResult<any>;

              if (value) {
                buffer = Buffer.concat([buffer, value]);
              }

              if (done) {
                break;
              }
            }

            gcTick(false);
            expect(buffer.toString("utf8")).toBe("unreachable");
          } catch (err) {
            expect((err as Error).name).toBe("ZlibError");
          }
        } finally {
          server?.stop(true);
        }
      });
    }

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

              resolveSocket(socket);

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

        let socket: Socket | null = null;

        try {
          const res = await fetch(`http://${server.hostname}:${server.port}`, {});
          socket = await promise;
          gcTick(false);

          const reader = res.body?.getReader();

          let buffer = Buffer.alloc(0);

          while (true) {
            gcTick(false);
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

          gcTick(false);
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
