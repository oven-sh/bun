import { Socket } from "bun";
import { beforeAll, describe, expect, it, test } from "bun:test";
import { gcTick } from "harness";
import { Readable } from "node:stream";
import { brotliCompressSync, createGzip, deflateRawSync, deflateSync } from "node:zlib";
import path from "path";

const gzipped = path.join(import.meta.dir, "fixture.html.gz");
const html = path.join(import.meta.dir, "fixture.html");
let htmlText: string;
beforeAll(async () => {
  htmlText = (await Bun.file(html).text()).replace(/\r\n/g, "\n");
});

it("fetch() with a buffered gzip response works (one chunk)", async () => {
  using server = Bun.serve({
    port: 0,

    async fetch(req) {
      gcTick(true);
      return new Response(require("fs").readFileSync(gzipped), {
        headers: {
          "Content-Encoding": "gzip",
          "Content-Type": "text/html; charset=utf-8",
        },
      });
    },
  });
  gcTick(true);

  const res = await fetch(server.url, { verbose: true });
  gcTick(true);
  const arrayBuffer = await res.arrayBuffer();
  const clone = new Buffer(arrayBuffer);
  gcTick(true);
  await (async function () {
    const second = Buffer.from(htmlText);
    gcTick(true);
    expect(second.equals(clone)).toBe(true);
  })();
  gcTick(true);
});

it("fetch() with a redirect that returns a buffered gzip response works (one chunk)", async () => {
  using server = Bun.serve({
    port: 0,

    async fetch(req) {
      if (req.url.endsWith("/redirect"))
        return new Response(await Bun.file(gzipped).arrayBuffer(), {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/html; charset=utf-8",
          },
        });

      return Response.redirect("/redirect");
    },
  });

  const url = new URL("hey", server.url);
  const res = await fetch(url, { verbose: true });
  const text = (await res.text()).replace(/\r\n/g, "\n");
  expect(text).toEqual(htmlText);
});

it("fetch() with a protocol-relative redirect that returns a buffered gzip response works (one chunk)", async () => {
  using server = Bun.serve({
    port: 0,

    async fetch(req, server) {
      if (req.url.endsWith("/redirect"))
        return new Response(await Bun.file(gzipped).arrayBuffer(), {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/html; charset=utf-8",
          },
        });

      const { host } = server.url;
      return Response.redirect(`://${host}/redirect`);
    },
  });

  const res = await fetch(new URL("hey", server.url), { verbose: true });
  expect(new URL(res.url)).toEqual(new URL("redirect", server.url));
  expect(res.redirected).toBe(true);
  expect(res.status).toBe(200);
  const text = (await res.text()).replace(/\r\n/g, "\n");
  expect(text).toEqual(htmlText);
});

it("fetch() with a gzip response works (one chunk, streamed, with a delay)", async () => {
  using server = Bun.serve({
    port: 0,

    fetch(req) {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            await 2;

            const buffer = await Bun.file(import.meta.dir + "/fixture.html.gz").arrayBuffer();
            controller.write(buffer);
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": "1",
          },
        },
      );
    },
  });

  const res = await fetch(server.url);
  const text = (await res.text()).replace(/\r\n/g, "\n");
  expect(text).toEqual(htmlText);
});

it("fetch() with a gzip response works (multiple chunks, TCP server)", async done => {
  const compressed = await Bun.file(gzipped).arrayBuffer();
  var socketToClose!: Socket;
  let pending,
    pendingChunks = [];
  const server = Bun.listen({
    hostname: "localhost",
    port: 0,
    socket: {
      drain(socket) {
        if (pending) {
          while (pendingChunks.length) {
            const chunk = pendingChunks.shift();
            const written = socket.write(chunk);

            if (written < chunk.length) {
              pendingChunks.push(chunk.slice(written));
              return;
            }
          }
          const resolv = pending;
          pending = null;
          resolv();
        }
      },
      async open(socket) {
        socketToClose = socket;

        var corked: any[] = [];
        var cork = true;
        let written = 0;
        let pendingChunks = [];
        async function write(chunk: any) {
          let defer = Promise.withResolvers();

          if (cork) {
            corked.push(chunk);
          }

          if (!cork && corked.length) {
            const toWrite = corked.join("");
            const wrote = socket.write(toWrite);
            if (wrote !== toWrite.length) {
              pendingChunks.push(toWrite.slice(wrote));
            }
            corked.length = 0;
          }

          if (!cork) {
            if (pendingChunks.length) {
              pendingChunks.push(chunk);
              pending = defer.resolve;
              await defer.promise;
              defer = Promise.withResolvers();
              pending = defer.resolve;
            }

            const written = socket.write(chunk);
            if (written < chunk.length) {
              console.log("written", written);
              pendingChunks.push(chunk.slice(written));
              pending = defer.resolve;
              await defer.promise;
              defer = Promise.withResolvers();
              pending = defer.resolve;
            }
          }

          const promise = defer.promise;
          if (pendingChunks.length) {
            pending = promise;
            await promise;
          } else {
            pending = null;
          }
        }
        await write("HTTP/1.1 200 OK\r\n");
        await write("Content-Encoding: gzip\r\n");
        await write("Content-Type: text/html; charset=utf-8\r\n");
        await write("Content-Length: " + compressed.byteLength + "\r\n");
        await write("X-WTF: " + "lol".repeat(1000) + "\r\n");
        await write("\r\n");
        for (var i = 100; i < compressed.byteLength; i += 100) {
          cork = false;
          await write(compressed.slice(i - 100, i));
        }
        await write(compressed.slice(i - 100));
        await write("\r\n");

        socket.flush();
      },
    },
  });
  await 1;

  const res = await fetch(`http://${server.hostname}:${server.port}`);
  const text = (await res.text()).replace(/\r\n/g, "\n");
  expect(text).toEqual(htmlText);
  socketToClose.end();
  server.stop();
  done();
});

// Regression test for #18413
describe("empty compressed responses", () => {
  test("empty chunked gzip response should work", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Create an empty gzip stream
        const gzipStream = createGzip();
        gzipStream.end(); // End immediately without writing data

        // Convert to web stream
        const webStream = Readable.toWeb(gzipStream);

        return new Response(webStream, {
          headers: {
            "Content-Encoding": "gzip",
            "Transfer-Encoding": "chunked",
            "Content-Type": "text/plain",
          },
        });
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    expect(response.status).toBe(200);

    // This should not throw "Decompression error: ShortRead"
    const text = await response.text();
    expect(text).toBe(""); // Empty response
  });

  test("empty gzip response without chunked encoding", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Create an empty gzip buffer
        const emptyGzip = Bun.gzipSync(Buffer.alloc(0));

        return new Response(emptyGzip, {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/plain",
            "Content-Length": emptyGzip.length.toString(),
          },
        });
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toBe("");
  });

  test("empty chunked response without gzip", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response(
          new ReadableStream({
            start(controller) {
              // Just close immediately
              controller.close();
            },
          }),
          {
            headers: {
              "Transfer-Encoding": "chunked",
              "Content-Type": "text/plain",
            },
          },
        );
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toBe("");
  });

  test("empty chunked brotli response should work", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Create an empty brotli buffer using the proper API
        const emptyBrotli = brotliCompressSync(Buffer.alloc(0));

        // Return as chunked response
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(emptyBrotli);
              controller.close();
            },
          }),
          {
            headers: {
              "Content-Encoding": "br",
              "Transfer-Encoding": "chunked",
              "Content-Type": "text/plain",
            },
          },
        );
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    expect(response.status).toBe(200);

    // Should not throw decompression error
    const text = await response.text();
    expect(text).toBe("");
  });

  test("empty non-chunked brotli response", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Create an empty brotli buffer using the proper API
        const emptyBrotli = brotliCompressSync(Buffer.alloc(0));

        return new Response(emptyBrotli, {
          headers: {
            "Content-Encoding": "br",
            "Content-Type": "text/plain",
            "Content-Length": emptyBrotli.length.toString(),
          },
        });
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toBe("");
  });

  test("empty chunked zstd response should work", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Create an empty zstd buffer using the proper API
        const emptyZstd = Bun.zstdCompressSync(Buffer.alloc(0));

        // Return as chunked response
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(emptyZstd);
              controller.close();
            },
          }),
          {
            headers: {
              "Content-Encoding": "zstd",
              "Transfer-Encoding": "chunked",
              "Content-Type": "text/plain",
            },
          },
        );
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    expect(response.status).toBe(200);

    // Should not throw decompression error
    const text = await response.text();
    expect(text).toBe("");
  });

  test("empty non-chunked zstd response", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Create an empty zstd buffer using the proper API
        const emptyZstd = Bun.zstdCompressSync(Buffer.alloc(0));

        return new Response(emptyZstd, {
          headers: {
            "Content-Encoding": "zstd",
            "Content-Type": "text/plain",
            "Content-Length": emptyZstd.length.toString(),
          },
        });
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toBe("");
  });

  test("empty chunked deflate response should work", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Create an empty deflate buffer
        const emptyDeflate = Bun.deflateSync(Buffer.alloc(0));

        // Return as chunked response
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(emptyDeflate);
              controller.close();
            },
          }),
          {
            headers: {
              "Content-Encoding": "deflate",
              "Transfer-Encoding": "chunked",
              "Content-Type": "text/plain",
            },
          },
        );
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    expect(response.status).toBe(200);

    // Should not throw decompression error
    const text = await response.text();
    expect(text).toBe("");
  });

  test("empty non-chunked deflate response", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Create an empty deflate buffer
        const emptyDeflate = Bun.deflateSync(Buffer.alloc(0));

        return new Response(emptyDeflate, {
          headers: {
            "Content-Encoding": "deflate",
            "Content-Type": "text/plain",
            "Content-Length": emptyDeflate.length.toString(),
          },
        });
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).toBe("");
  });
});

// Regression test for #18413 - deflate semantics
describe("deflate semantics", () => {
  // Test data
  const deflateTestData = Buffer.from("Hello, World! This is a test of deflate encoding.");

  // Test zlib-wrapped deflate (RFC 1950 - has 2-byte header and 4-byte Adler32 trailer)
  test("deflate with zlib wrapper should work", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Create zlib-wrapped deflate (this is what the spec says deflate should be)
        const compressed = deflateSync(deflateTestData);

        // Verify it has a zlib header: CMF must be 0x78 and (CMF<<8 | FLG) % 31 == 0
        expect(compressed[0]).toBe(0x78);
        expect(((compressed[0] << 8) | compressed[1]) % 31).toBe(0);
        return new Response(compressed, {
          headers: {
            "Content-Encoding": "deflate",
            "Content-Type": "text/plain",
          },
        });
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text).toBe(deflateTestData.toString());
  });

  // Test raw deflate (RFC 1951 - no header/trailer, just compressed data)
  test("raw deflate without zlib wrapper should work", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Create raw deflate (no zlib wrapper)
        const compressed = deflateRawSync(deflateTestData);

        // Verify it doesn't have zlib header (shouldn't start with 0x78)
        expect(compressed[0]).not.toBe(0x78);

        return new Response(compressed, {
          headers: {
            "Content-Encoding": "deflate",
            "Content-Type": "text/plain",
          },
        });
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text).toBe(deflateTestData.toString());
  });

  // Test empty zlib-wrapped deflate
  test("empty zlib-wrapped deflate should work", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const compressed = deflateSync(Buffer.alloc(0));

        return new Response(compressed, {
          headers: {
            "Content-Encoding": "deflate",
            "Content-Type": "text/plain",
          },
        });
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text).toBe("");
  });

  // Test empty raw deflate
  test("empty raw deflate should work", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const compressed = deflateRawSync(Buffer.alloc(0));

        return new Response(compressed, {
          headers: {
            "Content-Encoding": "deflate",
            "Content-Type": "text/plain",
          },
        });
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text).toBe("");
  });

  // Test chunked zlib-wrapped deflate
  test("chunked zlib-wrapped deflate should work", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const compressed = deflateSync(deflateTestData);
        const mid = Math.floor(compressed.length / 2);

        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(compressed.slice(0, mid));
              await Bun.sleep(50);
              controller.enqueue(compressed.slice(mid));
              controller.close();
            },
          }),
          {
            headers: {
              "Content-Encoding": "deflate",
              "Transfer-Encoding": "chunked",
              "Content-Type": "text/plain",
            },
          },
        );
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text).toBe(deflateTestData.toString());
  });

  // Test chunked raw deflate
  test("chunked raw deflate should work", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const compressed = deflateRawSync(deflateTestData);
        const mid = Math.floor(compressed.length / 2);

        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(compressed.slice(0, mid));
              await Bun.sleep(50);
              controller.enqueue(compressed.slice(mid));
              controller.close();
            },
          }),
          {
            headers: {
              "Content-Encoding": "deflate",
              "Transfer-Encoding": "chunked",
              "Content-Type": "text/plain",
            },
          },
        );
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text).toBe(deflateTestData.toString());
  });

  // Test truncated zlib-wrapped deflate (missing trailer)
  test("truncated zlib-wrapped deflate should fail", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const compressed = deflateSync(deflateTestData);
        // Remove the 4-byte Adler32 trailer
        const truncated = compressed.slice(0, -4);

        return new Response(truncated, {
          headers: {
            "Content-Encoding": "deflate",
            "Content-Type": "text/plain",
          },
        });
      },
    });

    try {
      const response = await fetch(`http://localhost:${server.port}`);
      await response.text();
      expect.unreachable("Should have thrown decompression error");
    } catch (err: any) {
      expect(err.code).toMatch(/ZlibError|ShortRead/);
    }
  });

  // Test invalid deflate data (not deflate at all)
  test("invalid deflate data should fail", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Random bytes that are neither zlib-wrapped nor raw deflate
        const invalid = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc, 0xfb]);

        return new Response(invalid, {
          headers: {
            "Content-Encoding": "deflate",
            "Content-Type": "text/plain",
          },
        });
      },
    });

    try {
      const response = await fetch(`http://localhost:${server.port}`);
      await response.text();
      expect.unreachable("Should have thrown decompression error");
    } catch (err: any) {
      expect(err.code).toMatch(/ZlibError/);
    }
  });
});

// Regression test for #18413 - truncation and edge cases
describe("compression truncation and edge cases", () => {
  // Helper to create a server that sends truncated compressed data
  function createTruncatedServer(compression: "gzip" | "br" | "zstd" | "deflate", truncateBytes: number = 1) {
    return Bun.serve({
      port: 0,
      async fetch(req) {
        let compressed: Uint8Array;
        const data = Buffer.from("Hello World! This is a test message.");

        switch (compression) {
          case "gzip":
            compressed = Bun.gzipSync(data);
            break;
          case "br":
            compressed = brotliCompressSync(data);
            break;
          case "zstd":
            compressed = Bun.zstdCompressSync(data);
            break;
          case "deflate":
            compressed = Bun.deflateSync(data);
            break;
        }

        // Truncate the compressed data
        const truncated = compressed.slice(0, compressed.length - truncateBytes);

        return new Response(truncated, {
          headers: {
            "Content-Encoding": compression,
            "Content-Type": "text/plain",
            "Content-Length": truncated.length.toString(),
          },
        });
      },
    });
  }

  // Helper to create a server that sends data in delayed chunks
  function createDelayedChunksServer(compression: "gzip" | "br" | "zstd" | "deflate", delayMs: number = 100) {
    return Bun.serve({
      port: 0,
      async fetch(req) {
        let compressed: Uint8Array;
        const data = Buffer.from("Hello World! This is a test message.");

        switch (compression) {
          case "gzip":
            compressed = Bun.gzipSync(data);
            break;
          case "br":
            compressed = brotliCompressSync(data);
            break;
          case "zstd":
            compressed = Bun.zstdCompressSync(data);
            break;
          case "deflate":
            compressed = Bun.deflateSync(data);
            break;
        }

        // Split compressed data into chunks
        const mid = Math.floor(compressed.length / 2);
        const chunk1 = compressed.slice(0, mid);
        const chunk2 = compressed.slice(mid);

        return new Response(
          new ReadableStream({
            async start(controller) {
              // Send first chunk
              controller.enqueue(chunk1);
              // Delay before sending second chunk
              await Bun.sleep(delayMs);
              controller.enqueue(chunk2);
              controller.close();
            },
          }),
          {
            headers: {
              "Content-Encoding": compression,
              "Transfer-Encoding": "chunked",
              "Content-Type": "text/plain",
            },
          },
        );
      },
    });
  }

  // Test truncated gzip stream
  test("truncated gzip stream should throw error", async () => {
    using server = createTruncatedServer("gzip", 5);

    try {
      const response = await fetch(`http://localhost:${server.port}`);
      await response.text();
      expect.unreachable("Should have thrown decompression error");
    } catch (err: any) {
      expect(err.code || err.name || err.message).toMatch(/ZlibError|ShortRead/);
    }
  });

  // Test truncated brotli stream
  test("truncated brotli stream should throw error", async () => {
    using server = createTruncatedServer("br", 5);

    try {
      const response = await fetch(`http://localhost:${server.port}`);
      await response.text();
      expect.unreachable("Should have thrown decompression error");
    } catch (err: any) {
      expect(err.code || err.name || err.message).toMatch(/BrotliDecompressionError/);
    }
  });

  // Test truncated zstd stream
  test("truncated zstd stream should throw error", async () => {
    using server = createTruncatedServer("zstd", 5);

    try {
      const response = await fetch(`http://localhost:${server.port}`);
      await response.text();
      expect.unreachable("Should have thrown decompression error");
    } catch (err: any) {
      expect(err.code || err.name || err.message).toMatch(/ZstdDecompressionError/);
    }
  });

  // Test truncated deflate stream
  test("truncated deflate stream should throw error", async () => {
    using server = createTruncatedServer("deflate", 1);

    try {
      const response = await fetch(`http://localhost:${server.port}`);
      await response.text();
      expect.unreachable("Should have thrown decompression error");
    } catch (err: any) {
      expect(err.code || err.name || err.message).toMatch(/ZlibError|ShortRead/);
    }
  });

  // Test delayed chunks for gzip (should succeed)
  test("gzip with delayed chunks should succeed", async () => {
    using server = createDelayedChunksServer("gzip", 50);

    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text).toBe("Hello World! This is a test message.");
  });

  // Test delayed chunks for brotli (should succeed)
  test("brotli with delayed chunks should succeed", async () => {
    using server = createDelayedChunksServer("br", 50);

    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text).toBe("Hello World! This is a test message.");
  });

  // Test delayed chunks for zstd (should succeed)
  test("zstd with delayed chunks should succeed", async () => {
    using server = createDelayedChunksServer("zstd", 50);

    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text).toBe("Hello World! This is a test message.");
  });

  // Test delayed chunks for deflate (should succeed)
  test("deflate with delayed chunks should succeed", async () => {
    using server = createDelayedChunksServer("deflate", 50);

    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text).toBe("Hello World! This is a test message.");
  });

  // Test mismatched Content-Encoding
  test("mismatched Content-Encoding should fail gracefully", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Send gzip data but claim it's brotli
        const gzipped = Bun.gzipSync(Buffer.from("Hello World"));

        return new Response(gzipped, {
          headers: {
            "Content-Encoding": "br",
            "Content-Type": "text/plain",
          },
        });
      },
    });

    try {
      const response = await fetch(`http://localhost:${server.port}`);
      await response.text();
      expect.unreachable("Should have thrown decompression error");
    } catch (err: any) {
      expect(err.code || err.name || err.message).toMatch(/BrotliDecompressionError/);
    }
  });

  // Test sending zero-byte compressed body
  test("zero-byte body with gzip Content-Encoding and Content-Length: 0", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response(new Uint8Array(0), {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/plain",
            "Content-Length": "0",
          },
        });
      },
    });

    // When Content-Length is 0, the decompressor is not invoked, so this succeeds
    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text).toBe("");
  });

  // Test sending invalid compressed data
  test("invalid gzip data should fail", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        // Send random bytes claiming to be gzip
        const invalid = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]);

        return new Response(invalid, {
          headers: {
            "Content-Encoding": "gzip",
            "Content-Type": "text/plain",
          },
        });
      },
    });

    try {
      const response = await fetch(`http://localhost:${server.port}`);
      await response.text();
      expect.unreachable("Should have thrown decompression error");
    } catch (err: any) {
      expect(err.code || err.name || err.message).toMatch(/ZlibError/);
    }
  });

  // Test sending first chunk delayed with empty initial chunk
  test("empty first chunk followed by valid gzip should succeed", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const gzipped = Bun.gzipSync(Buffer.from("Hello World"));

        return new Response(
          new ReadableStream({
            async start(controller) {
              // Send empty chunk first
              controller.enqueue(new Uint8Array(0));
              await Bun.sleep(50);
              // Then send the actual compressed data
              controller.enqueue(gzipped);
              controller.close();
            },
          }),
          {
            headers: {
              "Content-Encoding": "gzip",
              "Transfer-Encoding": "chunked",
              "Content-Type": "text/plain",
            },
          },
        );
      },
    });

    const response = await fetch(`http://localhost:${server.port}`);
    const text = await response.text();
    expect(text).toBe("Hello World");
  });
});
