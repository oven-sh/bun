import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tls } from "harness";

type BodyInput = ArrayBuffer | ArrayBufferView | Blob;
type Position = "begin" | "end";
type Mode = "reader" | "direct" | "web";

const globalFetch = fetch;

// One macrotask. The "end" position attaches the body reader only after the
// event loop ran once, so the request body can already be buffered.
const nextTick = () => new Promise<void>(resolve => setImmediate(resolve));

function bytesOf(input: Exclude<BodyInput, Blob>): Uint8Array {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

function repeat(bytes: Uint8Array, times: number): Uint8Array {
  const out = new Uint8Array(bytes.byteLength * times);
  for (let i = 0; i < times; i++) out.set(bytes, i * bytes.byteLength);
  return out;
}

function fillRepeating(dstBuffer: Uint8Array, start: number, end: number) {
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

// The headers the server saw on the request, echoed back as JSON so the
// client can assert them with one toEqual.
function seenRequestHeaders(req: Request): string {
  return JSON.stringify({
    "content-length": req.headers.get("content-length"),
    "content-type": req.headers.get("content-type"),
    "user-agent": req.headers.get("user-agent"),
    "x-custom": req.headers.get("x-custom"),
  });
}

// Run the entire suite once over plain HTTP/1.1 and once over HTTP/3 so the
// streaming-body matrix exercises both transports end-to-end. The http/3 row
// uses `http1: false` so a regression that silently falls back to TCP fails
// outright.
describe.each([
  { name: "http/1.1", http3: false },
  { name: "http/3", http3: true },
])("body-stream over $name", ({ http3 }) => {
  const fetch: typeof globalFetch = http3
    ? (input, init) => globalFetch(input, { ...init, protocol: "http3", tls: { rejectUnauthorized: false } } as any)
    : globalFetch;

  let server: Server;
  let url: string;
  let syncPull: { controller: any; pulled: PromiseWithResolvers<void> } | undefined;

  // A single server for the whole matrix. Each request selects its case
  // with the path and the x-* headers, so the tests can run concurrently.
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      ...(http3 ? { tls, http3: true, http1: false } : {}),
      async fetch(request) {
        const { pathname } = new URL(request.url);
        const doClone = request.headers.get("x-clone") === "1";
        const fast = request.headers.get("x-fast") === "1";
        const position = request.headers.get("x-position") as Position;
        const responseHeaders = {
          "content-type": request.headers.get("content-type") ?? "",
          "x-counter": request.headers.get("x-counter") ?? "",
          "x-request-headers": seenRequestHeaders(request),
        };

        if (pathname === "/flush") {
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(controller) {
                controller.write("hey");
                await nextTick();
                await controller.end();
              },
            }),
          );
        }

        if (pathname === "/sync-pull") {
          return new Response(
            new ReadableStream({
              type: "direct",
              pull(controller) {
                controller.write("hey");
                syncPull!.controller = controller;
                syncPull!.pulled.resolve();
              },
            }),
          );
        }

        if (pathname === "/mixin") {
          if (fast) {
            // Going through req.body first makes the mixin read from a
            // ReadableStream via Bun.readableStreamTo${Method}(stream).
            request.body;
          }
          const requests = doClone ? [request.clone(), request] : [request];
          const mixin = request.headers.get("x-mixin") as "arrayBuffer" | "bytes" | "blob" | "text" | "json";
          const parts: BlobPart[] = [];
          for (const req of requests) {
            let result = await req[mixin]();
            if (mixin === "json") result = JSON.stringify(result);
            parts.push(result as BlobPart);
          }
          // One part per read. The client expects the input repeated once
          // per request it asked the server to read.
          return new Response(new Blob(parts), { headers: responseHeaders });
        }

        const mode = request.headers.get("x-mode") as Mode;
        const requests = doClone ? [request.clone(), request] : [request];
        const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
        for (const req of requests) {
          if (position === "end") await nextTick();
          readers.push(req.body!.getReader());
        }

        if (mode === "reader") {
          const parts: Uint8Array[] = [];
          for (const reader of readers) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              parts.push(value);
            }
          }
          return new Response(new Blob(parts), { headers: responseHeaders });
        }

        async function pump(write: (chunk: Uint8Array) => unknown) {
          for (const reader of readers) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              write(value);
            }
          }
        }

        const stream =
          mode === "direct"
            ? new ReadableStream({
                type: "direct",
                async pull(controller) {
                  await pump(chunk => controller.write(chunk));
                  controller.end();
                },
              })
            : new ReadableStream({
                async pull(controller) {
                  await pump(chunk => controller.enqueue(chunk));
                  controller.close();
                },
              });
        return new Response(stream, { headers: responseHeaders });
      },
      error(err) {
        console.error(err);
        return new Response(String(err), { status: 500 });
      },
    });
    url = `${http3 ? "https" : "http"}://${server.hostname}:${server.port}`;
  });

  afterAll(() => {
    server.stop(true);
  });

  // A buffered response carries an exact content-length. A streamed response
  // carries content-length only when the whole body was ready before the
  // headers were flushed, otherwise HTTP/1.1 uses chunked transfer encoding.
  // HTTP/3 has no transfer-encoding header at all.
  function expectFraming(response: Response, byteLength: number, streamed: boolean) {
    const contentLength = response.headers.get("content-length");
    const transferEncoding = response.headers.get("transfer-encoding");
    if (!streamed) {
      expect(contentLength).toBe(String(byteLength));
      expect(transferEncoding).toBeNull();
    } else if (http3) {
      expect(contentLength === null || contentLength === String(byteLength)).toBe(true);
      expect(transferEncoding).toBeNull();
    } else if (contentLength !== null) {
      expect(contentLength).toBe(String(byteLength));
      expect(transferEncoding).toBeNull();
    } else {
      expect(transferEncoding).toBe("chunked");
    }
  }

  test("Should receive the response body when direct stream is properly flushed", async () => {
    const response = await fetch(`${url}/flush`);
    expect(await response.text()).toBe("hey");
    expect(response.status).toBe(200);
  });

  test("Should not crash when not returning a promise when stream is in progress", async () => {
    syncPull = { controller: undefined, pulled: Promise.withResolvers<void>() };
    const responsePromise = fetch(`${url}/sync-pull`);
    await syncPull.pulled.promise;
    syncPull.controller.end();
    // the response stays open until controller.end() is called
    const response = await responsePromise;
    expect(await response.text()).toBe("hey");
    expect(response.status).toBe(200);
  });

  const mixinFixtures: [name: string, input: string | ArrayBuffer | Buffer][] = [
    [JSON.stringify("Hello World"), JSON.stringify("Hello World")],
    [JSON.stringify("Hello World 123"), Buffer.from(JSON.stringify("Hello World 123")).buffer],
    [JSON.stringify("Hello World 456"), Buffer.from(JSON.stringify("Hello World 456"))],
    [
      JSON.stringify("EXTREMELY LONG VERY LONG STRING WOW SO LONG YOU WONT BELIEVE IT! ".repeat(100)),
      Buffer.from(JSON.stringify("EXTREMELY LONG VERY LONG STRING WOW SO LONG YOU WONT BELIEVE IT! ".repeat(100))),
    ],
    [
      JSON.stringify("EXTREMELY LONG 🔥 UTF16 🔥 VERY LONG STRING WOW SO LONG YOU WONT BELIEVE IT! ".repeat(100)),
      Buffer.from(
        JSON.stringify("EXTREMELY LONG 🔥 UTF16 🔥 VERY LONG STRING WOW SO LONG YOU WONT BELIEVE IT! ".repeat(100)),
      ),
    ],
  ];

  for (const doClone of [true, false]) {
    for (const mixin of ["arrayBuffer", "bytes", "blob", "text", "json"] as const) {
      for (const useRequestObject of [true, false]) {
        for (const forceReadableStreamConversionFastPath of [true, false]) {
          describe(
            `Request.prototype.${mixin}() ${useRequestObject ? "fetch(req)" : "fetch(url)"}` +
              (forceReadableStreamConversionFastPath ? " (force fast ReadableStream conversion)" : "") +
              (doClone ? " (clone)" : ""),
            () => {
              const reads = doClone ? 2 : 1;
              const headers = {
                "content-type": "text/plain",
                "x-clone": doClone ? "1" : "0",
                "x-fast": forceReadableStreamConversionFastPath ? "1" : "0",
                "x-mixin": mixin,
              };
              const send = (input: string | ArrayBuffer | Buffer, counter?: number) => {
                const init = {
                  body: input,
                  method: "POST",
                  headers: counter === undefined ? headers : { ...headers, "x-counter": String(counter) },
                };
                return useRequestObject
                  ? fetch(new Request({ url: `${url}/mixin`, ...init } as any))
                  : fetch(`${url}/mixin`, init);
              };
              const check = async (response: Response, name: string, byteLength: number, counter: string) => {
                if (forceReadableStreamConversionFastPath) {
                  response.body;
                }
                for (const res of doClone ? [response.clone(), response] : [response]) {
                  const text = await res.text();
                  expect(text).toBe(name.repeat(reads));
                  expect(res.status).toBe(200);
                  expectFraming(res, byteLength * reads, false);
                  expect(res.headers.get("content-type")).toBe("text/plain");
                  expect(res.headers.get("x-counter")).toBe(counter);
                  expect(JSON.parse(res.headers.get("x-request-headers")!)).toEqual({
                    "content-length": String(byteLength),
                    "content-type": "text/plain",
                    "user-agent": navigator.userAgent,
                    "x-custom": null,
                  });
                }
              };

              for (const [name, input] of mixinFixtures) {
                test.concurrent(name.slice(0, 64), async () => {
                  const byteLength = Buffer.from(input as any).byteLength;
                  // once, then a batch of 5
                  await check(await send(input), name, byteLength, "");
                  const responses = await Promise.all(Array.from({ length: 5 }, (_, i) => send(input, i)));
                  await Promise.all(responses.map((response, i) => check(response, name, byteLength, String(i))));
                });
              }
            },
          );
        }
      }
    }
  }

  // Sizes: one byte, a few bytes, under one socket read, a few KiB, a 64 KiB
  // chunk boundary, and one body large enough to need backpressure both ways.
  // Over QUIC in a debug+ASAN build the 1 MiB row does not fit in the
  // timeout and exercises no path the 64 KiB row does not.
  const inputLengths = http3 ? [1, 12, 95, 1024, 64 * 1024] : [1, 12, 95, 1024, 64 * 1024, 1024 * 1024];

  for (const doClone of [true, false]) {
    for (const forceReadableStreamConversionFastPath of [true, false]) {
      describe(
        "reader" +
          (doClone ? " (clone)" : "") +
          (forceReadableStreamConversionFastPath ? " (force ReadableStream conversion)" : ""),
        () => {
          const reads = doClone ? 2 : 1;

          for (const inputLength of inputLengths) {
            const bytes = new Uint8Array(inputLength);
            for (let i = 0; i < Math.min(bytes.length, 256); i++) {
              bytes[i] = 255 - i;
            }
            if (bytes.length > 255) fillRepeating(bytes, 0, bytes.length);

            // On the 1 MiB row, element-per-byte construction balloons the
            // multi-byte-element bodies to 2-8 MiB. View `bytes.buffer`
            // instead (same element types, byteLength == inputLength).
            const isLargeRow = inputLength >= 1024 * 1024;
            const Int16 = () => (isLargeRow ? new Int16Array(bytes.buffer) : new Int16Array(bytes));
            const Int32 = () => (isLargeRow ? new Int32Array(bytes.buffer) : new Int32Array(bytes));
            const Float32 = () => (isLargeRow ? new Float32Array(bytes.buffer) : new Float32Array(bytes));
            const Float64 = () => (isLargeRow ? new Float64Array(bytes.buffer) : new Float64Array(bytes));

            // Every shape the native side reads differently: a plain byte
            // view, a bare ArrayBuffer, a DataView, a Blob, views whose
            // element count differs from their byte length, and subarray()
            // views with a non-zero byteOffset or a byteLength shorter than
            // the buffer. Signed and unsigned views of the same width produce
            // identical bytes, so only one of each width is here.
            const shapes: [label: string, input: BodyInput][] = [
              ["Uint8Array", bytes],
              ["ArrayBuffer", bytes.buffer],
              ["DataView", new DataView(bytes.buffer)],
              ["Blob", new Blob([bytes])],
              ["Float64Array", Float64()],
              ["Int16Array", Int16()],
              ["Int32Array", Int32()],
              ["Int16Array.subarray(1)", Int16().subarray(1)],
              ["Int32Array.subarray(1)", Int32().subarray(1)],
              ["Int16Array.subarray(0, -1)", Int16().subarray(0, -1)],
              ["Int32Array.subarray(0, -1)", Int32().subarray(0, -1)],
            ];
            if (inputLength === 12) {
              // A one-element view over a larger buffer. The bytes are the
              // same on every row, so it runs once.
              shapes.push(
                ["Int16Array.subarray(0, 1)", Int16().subarray(0, 1)],
                ["Int32Array.subarray(0, 1)", Int32().subarray(0, 1)],
                ["Float32Array.subarray(0, 1)", Float32().subarray(0, 1)],
              );
            }

            for (const [label, input] of shapes) {
              const byteLength = input instanceof Blob ? input.size : input.byteLength;
              if (byteLength === 0) continue;
              const expected = input instanceof Blob ? bytes : bytesOf(input);
              const expectedResponse = repeat(expected, reads);

              async function roundTrip(mode: Mode, position: Position) {
                const response = await fetch(`${url}/echo`, {
                  body: input,
                  method: "POST",
                  headers: {
                    "content-type": "text/plain",
                    "x-custom": "hello",
                    "x-clone": doClone ? "1" : "0",
                    "x-fast": forceReadableStreamConversionFastPath ? "1" : "0",
                    "x-mode": mode,
                    "x-position": position,
                  },
                });
                if (forceReadableStreamConversionFastPath) {
                  response.body;
                }
                for (const res of doClone ? [response.clone(), response] : [response]) {
                  const body = await res.bytes();
                  expect(res.status).toBe(200);
                  expect(body.byteLength).toBe(expectedResponse.byteLength);
                  expect(body).toEqual(expectedResponse);
                  expectFraming(res, expectedResponse.byteLength, mode !== "reader");
                  expect(res.headers.get("content-type")).toBe("text/plain");
                  expect(JSON.parse(res.headers.get("x-request-headers")!)).toEqual({
                    "content-length": String(byteLength),
                    "content-type": "text/plain",
                    "user-agent": navigator.userAgent,
                    "x-custom": "hello",
                  });
                }
              }

              const title = `${label}(${byteLength}:${inputLength})`;
              for (const position of ["begin", "end"] as const) {
                test.concurrent(`works with ${title} via req.body.getReader() at ${position}`, () =>
                  roundTrip("reader", position),
                );
                test.concurrent(`streaming back ${title} via direct stream, getReader() at ${position}`, () =>
                  roundTrip("direct", position),
                );
                test.concurrent(`streaming back ${title} via default stream, getReader() at ${position}`, () =>
                  roundTrip("web", position),
                );
              }
            }
          }
        },
      );
    }
  }
});
