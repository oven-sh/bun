import { file, gc, serve, ServeOptions } from "bun";
import { afterEach, describe, expect, it, test } from "bun:test";
import { readFileSync } from "fs";

// afterEach(() => Bun.gc(true));

var port = 40001;

async function runInServer(
  opts: ServeOptions,
  cb: (url: string) => void | Promise<void>
) {
  var server;
  server = Bun.serve({
    ...opts,
    port: port++,
    fetch(req) {
      try {
        return opts.fetch(req);
      } catch (e) {
        console.error(e.message);
        console.log(e.stack);
        throw e;
      }
    },
    error(err) {
      console.log(err.message);
      console.log(err.stack);
      throw err;
    },
  });
  try {
    await cb(`http://${server.hostname}:${server.port}`);
  } catch (e) {
    throw e;
  } finally {
    queueMicrotask(() => {
      server && server.stop();
      server = undefined;
    });
  }
}

function fillRepeating(dstBuffer, start, end) {
  let len = dstBuffer.length,
    sLen = end - start,
    p = sLen;
  while (p < len) {
    if (p + sLen > len) sLen = len - p;
    dstBuffer.copyWithin(p, start, sLen);
    p += sLen;
    sLen <<= 1;
  }
}

function gc() {
  Bun.gc(true);
}

describe("reader", function () {
  try {
    // - empty
    // - 1 byte
    // - less than the InlineBlob limit
    // - multiple chunks
    for (let inputLength of [
      0,
      1,
      2,
      12,
      63,
      128,
      1024 * 1024 * 2,
      1024 * 1024 * 4,
    ]) {
      var bytes = new Uint8Array(inputLength);
      {
        const chunk = Math.min(bytes.length, 256);
        for (var i = 0; i < chunk; i++) {
          bytes[i] = i % 256;
        }
      }

      if (bytes.length > 255) fillRepeating(bytes, 0, bytes.length);

      for (var huge_ of [
        bytes,
        bytes.buffer,
        new DataView(bytes.buffer),
        new Int8Array(bytes),
        new Blob([bytes]),

        new Uint16Array(bytes),
        new Uint32Array(bytes),
        new Float64Array(bytes),

        new Int16Array(bytes),
        new Int32Array(bytes),
        new Float32Array(bytes),

        // make sure we handle subarray() as expected when reading
        // typed arrays from native code
        new Int16Array(bytes).subarray(1),
        new Int16Array(bytes).subarray(0, new Int16Array(bytes).byteLength - 1),
        new Int32Array(bytes).subarray(1),
        new Int32Array(bytes).subarray(0, new Int32Array(bytes).byteLength - 1),
        new Float32Array(bytes).subarray(1),
        new Float32Array(bytes).subarray(
          0,
          new Float32Array(bytes).byteLength - 1
        ),
        new Int16Array(bytes).subarray(0, 1),
        new Int32Array(bytes).subarray(0, 1),
        new Float32Array(bytes).subarray(0, 1),
      ]) {
        gc();

        it(`works with ${huge_.constructor.name}(${
          huge_.byteLength ?? huge_.size
        }:${inputLength})`, async () => {
          var huge = huge_;
          var called = false;
          gc();

          const expectedHash =
            huge instanceof Blob
              ? Bun.SHA1.hash(
                  new Uint8Array(await huge.arrayBuffer()),
                  "base64"
                )
              : Bun.SHA1.hash(huge, "base64");
          const expectedSize =
            huge instanceof Blob ? huge.size : huge.byteLength;

          const out = await runInServer(
            {
              async fetch(req) {
                try {
                  expect(req.headers.get("x-custom")).toBe("hello");
                  expect(req.headers.get("content-type")).toBe("text/plain");
                  expect(req.headers.get("user-agent")).toBe(
                    navigator.userAgent
                  );

                  gc();
                  expect(req.headers.get("x-custom")).toBe("hello");
                  expect(req.headers.get("content-type")).toBe("text/plain");
                  expect(req.headers.get("user-agent")).toBe(
                    navigator.userAgent
                  );
                  var reader = req.body.getReader();
                  called = true;
                  var buffers = [];
                  while (true) {
                    var { done, value } = await reader.read();
                    if (done) break;
                    buffers.push(value);
                  }
                  const out = new Blob(buffers);
                  gc();
                  expect(out.size).toBe(expectedSize);
                  expect(Bun.SHA1.hash(await out.arrayBuffer(), "base64")).toBe(
                    expectedHash
                  );
                  expect(req.headers.get("x-custom")).toBe("hello");
                  expect(req.headers.get("content-type")).toBe("text/plain");
                  expect(req.headers.get("user-agent")).toBe(
                    navigator.userAgent
                  );
                  gc();
                  return new Response(out, {
                    headers: req.headers,
                  });
                } catch (e) {
                  console.error(e);
                  throw e;
                }
              },
            },
            async (url) => {
              gc();
              const response = await fetch(url, {
                body: huge,
                method: "POST",
                headers: {
                  "content-type": "text/plain",
                  "x-custom": "hello",
                },
              });
              huge = undefined;
              expect(response.status).toBe(200);
              const response_body = new Uint8Array(
                await response.arrayBuffer()
              );

              expect(response_body.byteLength).toBe(expectedSize);
              expect(Bun.SHA1.hash(response_body, "base64")).toBe(expectedHash);

              gc();
              expect(response.headers.get("content-type")).toBe("text/plain");
              gc();
            }
          );
          expect(called).toBe(true);
          gc();
          return out;
        });

        for (let isDirectStream of [true, false]) {
          const inner = () => {
            for (let position of ["begin" /*"end"*/]) {
              it(`streaming back ${huge_.constructor.name}(${
                huge_.byteLength ?? huge_.size
              }:${inputLength}) starting request.body.getReader() at ${position}`, async () => {
                var huge = huge_;
                var called = false;
                gc();

                const expectedHash =
                  huge instanceof Blob
                    ? Bun.SHA1.hash(
                        new Uint8Array(await huge.arrayBuffer()),
                        "base64"
                      )
                    : Bun.SHA1.hash(huge, "base64");
                const expectedSize =
                  huge instanceof Blob ? huge.size : huge.byteLength;

                const out = await runInServer(
                  {
                    async fetch(req) {
                      try {
                        var reader;

                        if (position === "begin") reader = req.body.getReader();
                        expect(req.headers.get("x-custom")).toBe("hello");
                        expect(req.headers.get("content-type")).toBe(
                          "text/plain"
                        );
                        expect(req.headers.get("user-agent")).toBe(
                          navigator.userAgent
                        );

                        gc();
                        expect(req.headers.get("x-custom")).toBe("hello");
                        expect(req.headers.get("content-type")).toBe(
                          "text/plain"
                        );
                        expect(req.headers.get("user-agent")).toBe(
                          navigator.userAgent
                        );
                        if (position === "end") {
                          await 1;
                          await 123;

                          await new Promise((resolve, reject) => {
                            setTimeout(resolve, 1);
                          });
                          reader = req.body.getReader();
                        }

                        return new Response(
                          new ReadableStream({
                            type: "direct",
                            async pull(controller) {
                              while (true) {
                                const { done, value } = await reader.read();
                                if (done) {
                                  called = true;
                                  controller.end();

                                  return;
                                }
                                controller.write(value);
                              }
                            },
                          }),
                          {
                            headers: req.headers,
                          }
                        );
                      } catch (e) {
                        console.error(e);
                        throw e;
                      }
                    },
                  },
                  async (url) => {
                    gc();
                    const response = await fetch(url, {
                      body: huge,
                      method: "POST",
                      headers: {
                        "content-type": "text/plain",
                        "x-custom": "hello",
                      },
                    });
                    huge = undefined;
                    expect(response.status).toBe(200);
                    const response_body = new Uint8Array(
                      await response.arrayBuffer()
                    );

                    expect(response_body.byteLength).toBe(expectedSize);
                    expect(Bun.SHA1.hash(response_body, "base64")).toBe(
                      expectedHash
                    );

                    gc();
                    expect(response.headers.get("content-type")).toBe(
                      "text/plain"
                    );
                    gc();
                  }
                );
                expect(called).toBe(true);
                gc();
                return out;
              });
            }
          };

          if (isDirectStream) {
            describe("direct stream", () => inner());
          } else {
            describe("default stream", () => inner());
          }
        }
      }
    }
  } catch (e) {
    console.error(e);
    throw e;
  }
});

{
  const inputFixture = [
    ["Hello World", "Hello World"],
    ["Hello World 123", Buffer.from("Hello World 123").buffer],
    ["Hello World 456", Buffer.from("Hello World 456")],
  ];
  describe("echo", () => {
    for (const [name, input] of inputFixture) {
      test(`${name}`, async () => {
        return await runInServer(
          {
            fetch(req) {
              return new Response(req.body, { headers: req.headers });
            },
          },
          async (url) => {
            var request = new Request({
              body: input,
              method: "POST",
              url: url,
              headers: {
                "content-type": "text/plain",
              },
            });
            var response = await fetch(request);
            expect(response.status).toBe(200);
            expect(response.headers.get("content-type")).toBe("text/plain");
            expect(await response.text()).toBe(name);
          }
        );
      });
    }
  });
}
