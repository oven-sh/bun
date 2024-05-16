// @ts-nocheck
import { gc, ServeOptions } from "bun";
import { afterAll, describe, expect, it, test } from "bun:test";

var port = 0;

{
  const BodyMixin = [
    Request.prototype.arrayBuffer,
    Request.prototype.bytes,
    Request.prototype.blob,
    Request.prototype.text,
    Request.prototype.json,
  ];
  const useRequestObjectValues = [true, false];

  test("Should not crash when not returning a promise when stream is in progress", async () => {
    var called = false;
    await runInServer(
      {
        async fetch() {
          var stream = new ReadableStream({
            type: "direct",
            pull(controller) {
              controller.write("hey");
              setTimeout(() => {
                controller.end();
              }, 100);
            },
          });

          return new Response(stream);
        },
      },
      async url => {
        called = true;
        expect(await fetch(url).then(res => res.text())).toContain(
          "Welcome to Bun! To get started, return a Response object.",
        );
      },
    );

    expect(called).toBe(true);
  });

  for (let RequestPrototypeMixin of BodyMixin) {
    for (let useRequestObject of useRequestObjectValues) {
      describe(`Request.prototoype.${RequestPrototypeMixin.name}() ${
        useRequestObject ? "fetch(req)" : "fetch(url)"
      }`, () => {
        const inputFixture = [
          [JSON.stringify("Hello World"), JSON.stringify("Hello World")],
          [JSON.stringify("Hello World 123"), Buffer.from(JSON.stringify("Hello World 123")).buffer],
          [JSON.stringify("Hello World 456"), Buffer.from(JSON.stringify("Hello World 456"))],
          [
            JSON.stringify("EXTREMELY LONG VERY LONG STRING WOW SO LONG YOU WONT BELIEVE IT! ".repeat(100)),
            Buffer.from(
              JSON.stringify("EXTREMELY LONG VERY LONG STRING WOW SO LONG YOU WONT BELIEVE IT! ".repeat(100)),
            ),
          ],
          [
            JSON.stringify("EXTREMELY LONG 🔥 UTF16 🔥 VERY LONG STRING WOW SO LONG YOU WONT BELIEVE IT! ".repeat(100)),
            Buffer.from(
              JSON.stringify(
                "EXTREMELY LONG 🔥 UTF16 🔥 VERY LONG STRING WOW SO LONG YOU WONT BELIEVE IT! ".repeat(100),
              ),
            ),
          ],
        ];

        for (const [name, input] of inputFixture) {
          test(`${name.slice(0, Math.min(name.length ?? name.byteLength, 64))}`, async () => {
            await runInServer(
              {
                async fetch(req) {
                  var result = await RequestPrototypeMixin.call(req);
                  if (RequestPrototypeMixin === Request.prototype.json) {
                    result = JSON.stringify(result);
                  }
                  if (typeof result === "string") {
                    expect(result.length).toBe(name.length);
                    expect(result).toBe(name);
                  } else if (result && result instanceof Blob) {
                    expect(result.size).toBe(new TextEncoder().encode(name).byteLength);
                    expect(await result.text()).toBe(name);
                  } else {
                    expect(result.byteLength).toBe(Buffer.from(input).byteLength);
                    expect(Bun.SHA1.hash(result, "base64")).toBe(Bun.SHA1.hash(input, "base64"));
                  }
                  return new Response(result, {
                    headers: req.headers,
                  });
                },
              },
              async url => {
                var response;

                // once, then batch of 5

                if (useRequestObject) {
                  response = await fetch(
                    new Request({
                      body: input,
                      method: "POST",
                      url: url,
                      headers: {
                        "content-type": "text/plain",
                      },
                    }),
                  );
                } else {
                  response = await fetch(url, {
                    body: input,
                    method: "POST",
                    headers: {
                      "content-type": "text/plain",
                    },
                  });
                }

                expect(response.status).toBe(200);
                expect(response.headers.get("content-length")).toBe(String(Buffer.from(input).byteLength));
                expect(response.headers.get("content-type")).toBe("text/plain");
                expect(await response.text()).toBe(name);

                var promises = new Array(5);
                for (let i = 0; i < 5; i++) {
                  if (useRequestObject) {
                    promises[i] = await fetch(
                      new Request({
                        body: input,
                        method: "POST",
                        url: url,
                        headers: {
                          "content-type": "text/plain",
                          "x-counter": i,
                        },
                      }),
                    );
                  } else {
                    promises[i] = await fetch(url, {
                      body: input,
                      method: "POST",
                      headers: {
                        "content-type": "text/plain",
                        "x-counter": i,
                      },
                    });
                  }
                }

                const results = await Promise.all(promises);
                for (let i = 0; i < 5; i++) {
                  const response = results[i];
                  expect(response.status).toBe(200);
                  expect(response.headers.get("content-length")).toBe(String(Buffer.from(input).byteLength));
                  expect(response.headers.get("content-type")).toBe("text/plain");
                  expect(response.headers.get("x-counter")).toBe(String(i));
                  expect(await response.text()).toBe(name);
                }
              },
            );
          });
        }
      });
    }
  }
}

var existingServer;
async function runInServer(opts: ServeOptions, cb: (url: string) => void | Promise<void>) {
  var server;
  const handler = {
    ...opts,
    port: 0,
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
  };

  if (!existingServer) {
    existingServer = server = Bun.serve(handler);
  } else {
    server = existingServer;
    server.reload(handler);
  }

  try {
    await cb(`http://${server.hostname}:${server.port}`);
  } catch (e) {
    throw e;
  } finally {
  }
}

afterAll(() => {
  existingServer && existingServer.stop();
  existingServer = null;
});

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
  for (let withDelay of [false, true]) {
    try {
      // - 1 byte
      // - less than the InlineBlob limit
      // - multiple chunks
      // - backpressure

      for (let inputLength of [1, 2, 12, 95, 1024, 1024 * 1024, 1024 * 1024 * 2]) {
        var bytes = new Uint8Array(inputLength);
        {
          const chunk = Math.min(bytes.length, 256);
          for (var i = 0; i < chunk; i++) {
            bytes[i] = 255 - i;
          }
        }

        if (bytes.length > 255) fillRepeating(bytes, 0, bytes.length);

        for (const huge_ of [
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
          new Float32Array(bytes).subarray(0, new Float32Array(bytes).byteLength - 1),
          new Int16Array(bytes).subarray(0, 1),
          new Int32Array(bytes).subarray(0, 1),
          new Float32Array(bytes).subarray(0, 1),
        ]) {
          gc();
          const thisArray = huge_;
          if (Number(thisArray.byteLength ?? thisArray.size) === 0) continue;

          it(
            `works with ${thisArray.constructor.name}(${
              thisArray.byteLength ?? thisArray.size
            }:${inputLength}) via req.body.getReader() in chunks` + (withDelay ? " with delay" : ""),
            async () => {
              var huge = thisArray;
              var called = false;
              gc();

              const expectedHash =
                huge instanceof Blob ? Bun.SHA1.hash(await huge.bytes(), "base64") : Bun.SHA1.hash(huge, "base64");
              const expectedSize = huge instanceof Blob ? huge.size : huge.byteLength;

              const out = await runInServer(
                {
                  async fetch(req) {
                    try {
                      if (withDelay) await 1;

                      expect(req.headers.get("x-custom")).toBe("hello");
                      expect(req.headers.get("content-type")).toBe("text/plain");
                      expect(req.headers.get("user-agent")).toBe(navigator.userAgent);

                      gc();
                      expect(req.headers.get("x-custom")).toBe("hello");
                      expect(req.headers.get("content-type")).toBe("text/plain");
                      expect(req.headers.get("user-agent")).toBe(navigator.userAgent);

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
                      expect(Bun.SHA1.hash(await out.arrayBuffer(), "base64")).toBe(expectedHash);
                      expect(req.headers.get("x-custom")).toBe("hello");
                      expect(req.headers.get("content-type")).toBe("text/plain");
                      expect(req.headers.get("user-agent")).toBe(navigator.userAgent);
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
                async url => {
                  gc();
                  if (withDelay) await 1;
                  const pendingResponse = await fetch(url, {
                    body: huge,
                    method: "POST",
                    headers: {
                      "content-type": "text/plain",
                      "x-custom": "hello",
                      "x-typed-array": thisArray.constructor.name,
                    },
                  });
                  if (withDelay) {
                    await 1;
                  }
                  const response = await pendingResponse;
                  huge = undefined;
                  expect(response.status).toBe(200);
                  const response_body = await response.bytes();

                  expect(response_body.byteLength).toBe(expectedSize);
                  expect(Bun.SHA1.hash(response_body, "base64")).toBe(expectedHash);

                  gc();
                  expect(response.headers.get("content-type")).toBe("text/plain");
                  gc();
                },
              );
              expect(called).toBe(true);
              gc();
              return out;
            },
          );

          for (let isDirectStream of [true, false]) {
            const positions = ["begin", "end"];
            const inner = thisArray => {
              for (let position of positions) {
                it(`streaming back ${thisArray.constructor.name}(${
                  thisArray.byteLength ?? thisArray.size
                }:${inputLength}) starting request.body.getReader() at ${position}`, async () => {
                  var huge = thisArray;
                  var called = false;
                  gc();

                  const expectedHash =
                    huge instanceof Blob ? Bun.SHA1.hash(await huge.bytes(), "base64") : Bun.SHA1.hash(huge, "base64");
                  const expectedSize = huge instanceof Blob ? huge.size : huge.byteLength;

                  const out = await runInServer(
                    {
                      async fetch(req) {
                        try {
                          var reader;

                          if (withDelay) await 1;

                          if (position === "begin") {
                            reader = req.body.getReader();
                          }

                          if (position === "end") {
                            await 1;
                            reader = req.body.getReader();
                          }

                          expect(req.headers.get("x-custom")).toBe("hello");
                          expect(req.headers.get("content-type")).toBe("text/plain");
                          expect(req.headers.get("user-agent")).toBe(navigator.userAgent);

                          gc();
                          expect(req.headers.get("x-custom")).toBe("hello");
                          expect(req.headers.get("content-type")).toBe("text/plain");
                          expect(req.headers.get("user-agent")).toBe(navigator.userAgent);

                          const direct = {
                            type: "direct",
                            async pull(controller) {
                              if (withDelay) await 1;

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
                          };

                          const web = {
                            async start() {
                              if (withDelay) await 1;
                            },
                            async pull(controller) {
                              while (true) {
                                const { done, value } = await reader.read();
                                if (done) {
                                  called = true;
                                  controller.close();
                                  return;
                                }
                                controller.enqueue(value);
                              }
                            },
                          };

                          return new Response(new ReadableStream(isDirectStream ? direct : web), {
                            headers: req.headers,
                          });
                        } catch (e) {
                          console.error(e);
                          throw e;
                        }
                      },
                    },
                    async url => {
                      gc();
                      const response = await fetch(url, {
                        body: huge,
                        method: "POST",
                        headers: {
                          "content-type": "text/plain",
                          "x-custom": "hello",
                          "x-typed-array": thisArray.constructor.name,
                        },
                      });
                      huge = undefined;
                      expect(response.status).toBe(200);
                      const response_body = await response.bytes();

                      expect(response_body.byteLength).toBe(expectedSize);
                      expect(Bun.SHA1.hash(response_body, "base64")).toBe(expectedHash);

                      gc();
                      if (!response.headers.has("content-type")) {
                        console.error(Object.fromEntries(response.headers.entries()));
                      }

                      expect(response.headers.get("content-type")).toBe("text/plain");
                      gc();
                    },
                  );
                  expect(called).toBe(true);
                  gc();
                  return out;
                });
              }
            };

            if (isDirectStream) {
              describe(" direct stream", () => inner(thisArray));
            } else {
              describe("default stream", () => inner(thisArray));
            }
          }
        }
      }
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
});
