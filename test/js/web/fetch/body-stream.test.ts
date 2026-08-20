import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tls } from "harness";

// Round-trips request bodies through Bun.serve and back out through fetch(),
// over HTTP/1.1 and over HTTP/3. One server per transport serves every test:
// a request carries its server-side configuration in the `x-config` header and
// the handler reports what it saw in the `x-server` response header, so each
// test is a single `toEqual` over the client's and the server's view of the
// round trip, and the tests are independent enough to run concurrently.
//
// The matrix is factored by what a dimension can influence:
//   - the body *types* (Uint8Array, DataView, Int16Array.subarray(1), Blob, ...)
//     only change how fetch() serializes the request; the server sees bytes
//     either way. They run once per source size against a plain reader.
//   - the server/client *modes* (clone, touchBody, defer, lateReader, direct vs
//     default response stream, every Request body mixin) run at every body size
//     with one body type.
//   - the string / ArrayBuffer / Buffer fixtures and fetch(url) vs
//     fetch(new Request()) only change the client; they run against one mixin.

const port = 0;

const MIXINS = ["arrayBuffer", "bytes", "blob", "text", "json"] as const;
type Mixin = (typeof MIXINS)[number];
const MIXIN_RESULT_TYPE: Record<Mixin, string> = {
  arrayBuffer: "ArrayBuffer",
  bytes: "Uint8Array",
  blob: "Blob",
  text: "string",
  // the handler JSON.stringify()s what json() parsed before summarizing it
  json: "string",
};

// Flags a test combines, and which side acts on them:
//   clone       server: request.clone(), consume both; client: response.clone(), consume both
//   touchBody   read `.body` before consuming, so the buffered native body is turned into a
//               ReadableStream first and consuming it takes the ReadableStream -> X conversion
//               (which clone() then tees). Server side for the mixins, client side everywhere.
//   defer       server: wait a microtask before touching the request body (and, when pumping it
//               into the response, before the first write), i.e. act only after the handler's
//               promise has been handed back to the server
//   lateReader  server: take the request body reader a microtask into the handler instead of
//               synchronously
interface Mode {
  name: string;
  clone: boolean;
  touchBody: boolean;
  defer?: boolean;
  lateReader?: boolean;
}

type ServerConfig = Mode &
  ({ op: "mixin"; mixin: Mixin } | { op: "reader" } | { op: "stream"; kind: "direct" | "default" });

/** Every on/off combination of `flags`; `name` lists the ones that are on. */
function combos(flags: string[]): Mode[] {
  let rows: Array<Record<string, boolean>> = [{}];
  for (const flag of flags) {
    rows = rows.flatMap(row => [
      { ...row, [flag]: false },
      { ...row, [flag]: true },
    ]);
  }
  return rows.map(row => ({ ...row, name: flags.filter(flag => row[flag]).join(" + ") || "plain" })) as Mode[];
}

const plain: Mode = { name: "plain", clone: false, touchBody: false };
const mixinModes = combos(["clone", "touchBody"]);
const readerModes = combos(["clone", "touchBody", "defer"]);
const streamModes = combos(["clone", "touchBody", "defer", "lateReader"]);

function digest(bytes: Uint8Array | ArrayBuffer) {
  return { size: bytes.byteLength, sha1: Bun.SHA1.hash(bytes, "base64") };
}

// Non-repeating contents, so a chunk that is dropped, duplicated or delivered
// out of order anywhere in the body changes the digest.
function makeBody(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  const words = new Uint32Array(bytes.buffer, 0, size >>> 2);
  let x = 0x9e3779b9;
  for (let i = 0; i < words.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    words[i] = x;
  }
  for (let i = words.length * 4; i < size; i++) bytes[i] = 255 - i;
  return bytes;
}

function bodyFixture(size: number) {
  const body = makeBody(size);
  return { size, body, sha1: digest(body).sha1 };
}

/**
 * The same source bytes handed to fetch() as every kind of BodyInit, each with
 * the digest of the bytes that must reach the server. Small sources are widened
 * element-per-byte (a 95 byte source becomes a 760 byte Float64Array); the
 * largest source is viewed in place so its bodies stay at the source size.
 */
function bodyVariants(source: Uint8Array, viewInPlace: boolean) {
  const widen = (Ctor: any) => (viewInPlace ? new Ctor(source.buffer) : new Ctor(source));
  const int16 = (): Int16Array => widen(Int16Array);
  const int32 = (): Int32Array => widen(Int32Array);
  const variants: Array<[label: string, body: Blob | ArrayBuffer | ArrayBufferView]> = [
    ["Uint8Array", source],
    ["ArrayBuffer", source.buffer],
    ["DataView", new DataView(source.buffer)],
    ["Blob", new Blob([source])],
    ["Int8Array", widen(Int8Array)],
    ["Uint16Array", widen(Uint16Array)],
    ["Uint32Array", widen(Uint32Array)],
    ["Int16Array", int16()],
    ["Int32Array", int32()],
    ["Float64Array", widen(Float64Array)],
    // views that do not span their buffer: byteOffset and byteLength have to be
    // honoured instead of sending the backing ArrayBuffer
    ["Int16Array.subarray(1)", int16().subarray(1)],
    ["Int32Array.subarray(1)", int32().subarray(1)],
    ["Int16Array.subarray(0, -1)", int16().subarray(0, -1)],
    ["Int32Array.subarray(0, -1)", int32().subarray(0, -1)],
    ["Int16Array.subarray(1, -1)", int16().subarray(1, -1)],
    ["Int16Array.subarray(0, 1)", int16().subarray(0, 1)],
    ["Int32Array.subarray(0, 1)", int32().subarray(0, 1)],
    ["Float32Array.subarray(0, 1)", (widen(Float32Array) as Float32Array).subarray(0, 1)],
  ];
  return variants
    .map(([label, body]) => {
      const wire =
        body instanceof Blob
          ? source
          : body instanceof ArrayBuffer
            ? new Uint8Array(body)
            : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
      return { label, body, ...digest(wire) };
    })
    .filter(variant => variant.size > 0);
}

const SHORT = JSON.stringify("Hello World");
const LONG_LATIN1 = JSON.stringify("EXTREMELY LONG VERY LONG STRING WOW SO LONG YOU WONT BELIEVE IT! ".repeat(100));
const LONG_UTF16 = JSON.stringify(
  "EXTREMELY LONG 🔥 UTF16 🔥 VERY LONG STRING WOW SO LONG YOU WONT BELIEVE IT! ".repeat(100),
);

function textFixture(label: string, text: string, body: BodyInit = Buffer.from(text)) {
  return { label, text, body, ...digest(Buffer.from(text)) };
}

// What the server has to decode varies with the length and with whether the
// text is pure latin1; how the client serialized it never reaches the server.
const serverInputs = [
  textFixture("short", SHORT),
  textFixture("long latin1", LONG_LATIN1),
  textFixture("long utf-16", LONG_UTF16),
];

const clientInputs = [
  textFixture("string", SHORT, SHORT),
  textFixture("ArrayBuffer", SHORT, new Uint8Array(Buffer.from(SHORT)).buffer),
  textFixture("Buffer", SHORT),
  textFixture("long latin1 Buffer", LONG_LATIN1),
  textFixture("long utf-16 Buffer", LONG_UTF16),
  // sent as a string: encoded to UTF-8 on the way out and sized in UTF-8 bytes,
  // not in UTF-16 code units
  textFixture("long utf-16 string", LONG_UTF16, LONG_UTF16),
];

const clientCalls = [
  { label: "fetch(url, init)", useRequestObject: false },
  { label: "fetch(new Request({ url, ...init }))", useRequestObject: true },
];

const CLIENT_HEADERS = { "content-type": "text/plain", "x-custom": "hello" };
// what the handler sees: the headers above plus the user-agent fetch() adds by itself
const REQUEST_HEADERS_SEEN = { ...CLIENT_HEADERS, "user-agent": navigator.userAgent };

function headersSeen(request: Request) {
  return Object.fromEntries(Object.keys(REQUEST_HEADERS_SEEN).map(name => [name, request.headers.get(name)]));
}

async function summarize(result: unknown) {
  if (typeof result === "string") return { type: "string", ...digest(Buffer.from(result)) };
  if (result instanceof Blob) {
    return { type: "Blob", size: result.size, sha1: Bun.SHA1.hash(await result.bytes(), "base64") };
  }
  const buffer = result as ArrayBuffer | Uint8Array;
  return { type: buffer.constructor.name, ...digest(buffer) };
}

async function readAll(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value);
  }
}

async function handle(request: Request): Promise<Response> {
  const config: ServerConfig = JSON.parse(request.headers.get("x-config")!);
  const branches: unknown[] = [];
  const respond = (body: BodyInit) => {
    const headers = new Headers({ "content-type": "text/plain", "x-server": JSON.stringify(branches) });
    const counter = request.headers.get("x-counter");
    if (counter !== null) headers.set("x-counter", counter);
    return new Response(body, { headers });
  };

  try {
    switch (config.op) {
      case "mixin": {
        if (config.touchBody) request.body;
        let result: any;
        for (const req of config.clone ? [request.clone(), request] : [request]) {
          result = await req[config.mixin]();
          // json() returns the parsed value; serializing it again yields the
          // exact text it was parsed from, which is what the fixtures digest
          if (config.mixin === "json") result = JSON.stringify(result);
          branches.push({ headers: headersSeen(req), ...(await summarize(result)) });
        }
        return respond(result);
      }

      case "reader": {
        if (config.defer) await 1;
        let blob!: Blob;
        for (const req of config.clone ? [request.clone(), request] : [request]) {
          blob = new Blob(await readAll(req.body!));
          branches.push({
            headers: headersSeen(req),
            size: blob.size,
            sha1: Bun.SHA1.hash(await blob.arrayBuffer(), "base64"),
          });
        }
        return respond(blob);
      }

      case "stream": {
        if (config.defer) await 1;
        let reader!: ReadableStreamDefaultReader<Uint8Array>;
        for (const req of config.clone ? [request.clone(), request] : [request]) {
          if (config.lateReader) await 1;
          // With clone, the clone's reader is taken and then abandoned: only the
          // last reader (the original request's) is pumped below, so the tee has
          // to let one branch drain while the other stays locked and unread.
          reader = req.body!.getReader();
          branches.push({ headers: headersSeen(req) });
        }
        const pump = async (write: (chunk: Uint8Array) => unknown, close: () => unknown) => {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              close();
              return;
            }
            write(value);
          }
        };
        const stream =
          config.kind === "direct"
            ? new ReadableStream({
                type: "direct",
                async pull(controller) {
                  if (config.defer) await 1;
                  await pump(
                    chunk => controller.write(chunk),
                    () => controller.end(),
                  );
                },
              })
            : new ReadableStream({
                async start() {
                  if (config.defer) await 1;
                },
                pull: controller =>
                  pump(
                    chunk => controller.enqueue(chunk),
                    () => controller.close(),
                  ),
              });
        return respond(stream);
      }
    }
  } catch (error) {
    return new Response(Bun.inspect(error), { status: 500 });
  }
}

describe.each([
  { name: "http/1.1", http3: false },
  { name: "http/3", http3: true },
])("body-stream over $name", ({ http3 }) => {
  // `http1: false` so an http/3 request that silently fell back to TCP fails
  // instead of passing against a TCP listener on the same port.
  const serveOptions = http3 ? { port, tls, http3: true, http1: false } : { port };
  const transportInit = http3 ? ({ protocol: "http3", tls: { rejectUnauthorized: false } } as RequestInit) : undefined;

  // The MB rows are what makes request bodies arrive in many reads and response
  // writes hit backpressure over TCP. Over QUIC in a debug+ASAN build their
  // per-packet cost blows the timeout, and 64 KB already spans many packets
  // and flow-control windows, so http/3 stops there.
  const largest = http3 ? 64 * 1024 : 1024 * 1024;
  const sizes = [1, 2, 12, 95, 1024, largest, ...(http3 ? [] : [2 * largest])];
  const bodies = sizes.map(bodyFixture);

  let sharedServer: ReturnType<typeof Bun.serve>;
  beforeAll(() => {
    sharedServer = Bun.serve({ ...serveOptions, fetch: handle });
  });
  afterAll(() => sharedServer.stop(true));

  async function post<T>(
    config: ServerConfig,
    body: BodyInit,
    consume: (response: Response) => Promise<T>,
    responseHeaders: string[],
    { counter, useRequestObject = false }: { counter?: number; useRequestObject?: boolean } = {},
  ) {
    const init: RequestInit = {
      method: "POST",
      body,
      headers: {
        ...CLIENT_HEADERS,
        ...(counter !== undefined && { "x-counter": String(counter) }),
        "x-config": JSON.stringify(config),
      },
    };
    const response = useRequestObject
      ? await fetch(new Request({ url: sharedServer.url.href, ...init } as any), transportInit)
      : await fetch(sharedServer.url, { ...init, ...transportInit });
    if (response.status !== 200) throw new Error(`server responded ${response.status}: ${await response.text()}`);

    if (config.touchBody) response.body;
    const bodies: T[] = [];
    for (const branch of config.clone ? [response.clone(), response] : [response]) bodies.push(await consume(branch));

    return {
      status: response.status,
      headers: Object.fromEntries(responseHeaders.map(name => [name, response.headers.get(name)])),
      server: JSON.parse(response.headers.get("x-server")!),
      bodies,
    };
  }

  function perBranch<T>(mode: Mode, value: T) {
    return mode.clone ? [value, value] : [value];
  }

  async function expectMixinEcho(
    config: ServerConfig & { op: "mixin" },
    input: (typeof serverInputs)[number],
    useRequestObject = false,
  ) {
    const run = (counter: number) =>
      post(config, input.body, response => response.text(), ["content-type", "content-length", "x-counter"], {
        counter,
        useRequestObject,
      });
    // One request on its own, then a concurrent batch: the batch reuses the
    // first request's keep-alive connection and opens fresh ones next to it
    // (over http/3, parallel streams on the one connection). The echoed counter
    // pairs each response with its request.
    const results = [await run(0), ...(await Promise.all([1, 2, 3].map(run)))];

    const branch = {
      headers: REQUEST_HEADERS_SEEN,
      type: MIXIN_RESULT_TYPE[config.mixin],
      size: input.size,
      sha1: input.sha1,
    };
    expect(results).toEqual(
      [0, 1, 2, 3].map(counter => ({
        status: 200,
        headers: { "content-type": "text/plain", "content-length": String(input.size), "x-counter": String(counter) },
        server: perBranch(config, branch),
        bodies: perBranch(config, input.text),
      })),
    );
  }

  async function expectReaderEcho(mode: Mode, body: BodyInit, { size, sha1 }: { size: number; sha1: string }) {
    const result = await post({ op: "reader", ...mode }, body, async response => digest(await response.bytes()), [
      "content-type",
      "content-length",
    ]);
    expect(result).toEqual({
      status: 200,
      headers: { "content-type": "text/plain", "content-length": String(size) },
      server: perBranch(mode, { headers: REQUEST_HEADERS_SEEN, size, sha1 }),
      bodies: perBranch(mode, { size, sha1 }),
    });
  }

  async function expectStreamEcho(
    mode: Mode,
    kind: "direct" | "default",
    { body, size, sha1 }: ReturnType<typeof bodyFixture>,
  ) {
    // Whether a pumped response goes out with a content-length (everything was
    // written before the headers were flushed) or chunked depends on the body
    // size and on when the request body arrived, so the framing is not
    // asserted, only the bytes.
    const result = await post({ op: "stream", kind, ...mode }, body, async response => digest(await response.bytes()), [
      "content-type",
    ]);
    expect(result).toEqual({
      status: 200,
      headers: { "content-type": "text/plain" },
      server: perBranch(mode, { headers: REQUEST_HEADERS_SEEN }),
      bodies: perBranch(mode, { size, sha1 }),
    });
  }

  describe.concurrent("direct stream responses", () => {
    // https://github.com/oven-sh/bun/pull/18707: a chunk written by pull() is
    // flushed to the client on its own; the end() that follows has to close the
    // response without dropping or repeating it.
    test("a chunk written before end() arrives on its own, and end() then closes the response", async () => {
      const chunkReceived = Promise.withResolvers<void>();
      using server = Bun.serve({
        ...serveOptions,
        fetch() {
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(controller) {
                controller.write("hey");
                await chunkReceived.promise;
                await controller.end();
              },
            }),
          );
        },
      });

      const response = await fetch(server.url, transportInit);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (text.length < "hey".length) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      const beforeEnd = text;
      chunkReceived.resolve();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      expect({ status: response.status, beforeEnd, text }).toEqual({ status: 200, beforeEnd: "hey", text: "hey" });
    });

    // https://github.com/oven-sh/bun/issues/32137: a pull() that returns without
    // a promise keeps the response open until the captured controller ends it.
    test("sync pull() keeps the response open until the controller is ended later", async () => {
      const pulled = Promise.withResolvers<ReadableStreamDirectController>();
      using server = Bun.serve({
        ...serveOptions,
        fetch() {
          return new Response(
            new ReadableStream({
              type: "direct",
              pull(controller) {
                controller.write("hey");
                pulled.resolve(controller);
              },
            }),
          );
        },
      });

      const pending = fetch(server.url, transportInit);
      // a failing fetch() rejects here instead of leaving the test waiting for pull()
      const controller = await Promise.race([pulled.promise, pending.then(() => pulled.promise)]);
      controller.end();
      const response = await pending;
      expect({ status: response.status, text: await response.text() }).toEqual({ status: 200, text: "hey" });
    });
  });

  describe.concurrent("Request body mixins", () => {
    describe.each(mixinModes)("$name", mode => {
      describe.each([...MIXINS])("request.%s()", mixin => {
        test.each(serverInputs)("$label", input => expectMixinEcho({ op: "mixin", mixin, ...mode }, input));
      });
    });
  });

  describe.concurrent("request body serialization", () => {
    describe.each(clientCalls)("$label", ({ useRequestObject }) => {
      test.each(clientInputs)("$label", input =>
        expectMixinEcho({ op: "mixin", mixin: "text", ...plain }, input, useRequestObject),
      );
    });

    // 1: one element per view, so the offset views are empty and skipped.
    // 2: the smallest source where every offset view has an element.
    // 95: odd length, many elements. largest: viewed in place, many chunks.
    describe.each([1, 2, 95, largest])("source of %d bytes", source => {
      test.each(bodyVariants(makeBody(source), source === largest))("$label -> $size bytes", ({ body, size, sha1 }) =>
        expectReaderEcho(plain, body, { size, sha1 }),
      );
    });
  });

  describe.concurrent("request.body.getReader() read to the end, echoed as a Blob", () => {
    describe.each(readerModes)("$name", mode => {
      test.each(bodies)("$size-byte body", fixture => expectReaderEcho(mode, fixture.body, fixture));
    });
  });

  describe.concurrent("request.body pumped into the response stream", () => {
    describe.each(["direct", "default"])("%s stream", kind => {
      describe.each(streamModes)("$name", mode => {
        test.each(bodies)("$size-byte body", fixture => expectStreamEcho(mode, kind, fixture));
      });
    });
  });
});
