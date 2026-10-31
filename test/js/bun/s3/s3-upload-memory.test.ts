import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  emptyProcessMaxRSS,
  isASAN,
  isDebug,
  isLinux,
  runCommandMaxRSS,
  tempDir,
  withoutAsanQuarantine,
} from "harness";

// An inherited proxy would take the requests meant for the local sink.
const sinkEnv = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
  ALL_PROXY: undefined,
  all_proxy: undefined,
};

// A multipart upload keeps a StreamBuffer of bytes that did not fit a part
// yet. When every incoming chunk leaves a remainder below partSize, that
// buffer is never empty, so nothing released the consumed prefix and the
// whole payload stayed resident (#42722).
//
// The fixture uploads `totalMiB` to a local sink and prints the peak RSS
// delta. `upload` is an expression that starts one upload with `client`,
// `source` (the file on disk), `totalBytes` and `opts` in scope and evaluates
// to its promise.
function fixture(upload: string, totalMiB: number) {
  return `
    const server = Bun.serve({
      port: 0,
      maxRequestBodySize: 1024 * 1024 * 1024,
      async fetch(req) {
        const url = new URL(req.url);
        if (req.method === "POST" && url.searchParams.has("uploads")) {
          return new Response(
            "<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
            { headers: { "content-type": "application/xml" } },
          );
        }
        if (req.method === "PUT") {
          // Delay each part so the uploader has to hold parts back.
          await Bun.sleep(1);
          for await (const chunk of req.body) {}
          return new Response("", { headers: { ETag: '"etag"' } });
        }
        await req.text();
        return new Response(
          '<CompleteMultipartUploadResult><ETag>"etag-1"</ETag></CompleteMultipartUploadResult>',
          { headers: { "content-type": "application/xml" } },
        );
      },
    });
    const client = new Bun.S3Client({
      endpoint: "http://127.0.0.1:" + server.port,
      bucket: "bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-east-1",
    });
    const partSize = 5 * 1024 * 1024;
    const opts = { partSize, queueSize: 2, retry: 0 };
    const totalBytes = ${totalMiB} * 1024 * 1024;
    const source = "source.bin";
    {
      // Write in small pieces so the baseline does not include a payload
      // sized allocation that the upload could reuse.
      const fileWriter = Bun.file(source).writer();
      const fill = new Uint8Array(1024 * 1024).fill(97);
      for (let written = 0; written < totalBytes; written += fill.byteLength) {
        fileWriter.write(fill);
        await fileWriter.flush();
      }
      await fileWriter.end();
    }
    Bun.gc(true);

    const rss = () => process.memoryUsage.rss();
    const baseline = rss();
    let peak = baseline;
    const sampler = setInterval(() => { peak = Math.max(peak, rss()); }, 10);

    await (${upload});

    clearInterval(sampler);
    server.stop(true);
    console.log(JSON.stringify({ deltaMiB: Math.round((peak - baseline) / 1024 / 1024) }));
  `;
}

async function uploadRssDeltaMiB(upload: string, totalMiB: number): Promise<number> {
  using dir = tempDir("s3-upload-memory", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture(upload, totalMiB)],
    cwd: String(dir),
    env: withoutAsanQuarantine(sinkEnv),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr.trim()).toBe("");
  const { deltaMiB } = JSON.parse(stdout.trim().split("\n").at(-1)!);
  expect(exitCode).toBe(0);
  return deltaMiB;
}

// The steady state of an upload holds a few parts: the buffered tail, the
// parts in flight and their copies. That floor depends on the build, so the
// check is that 128 MiB more payload does not add anything near 128 MiB of
// resident memory. The unfixed build adds at least the payload.
async function expectUploadMemoryNotToGrowWithPayload(upload: string) {
  const [small, large] = await Promise.all([uploadRssDeltaMiB(upload, 64), uploadRssDeltaMiB(upload, 192)]);
  expect(large - small, `peak RSS delta: 64 MiB upload ${small} MiB, 192 MiB upload ${large} MiB`).toBeLessThan(64);
}

test.concurrent("Bun.write(s3file, Bun.file()) does not keep the whole file in memory", async () => {
  await expectUploadMemoryNotToGrowWithPayload(`Bun.write(client.file("key"), Bun.file(source), opts)`);
});

test.concurrent("s3file.writer() fed chunks that do not line up with partSize releases sent bytes", async () => {
  await expectUploadMemoryNotToGrowWithPayload(
    `(async () => {
      const writer = client.file("key").writer(opts);
      const chunk = new Uint8Array(partSize + 1).fill(97);
      for (let sent = 0; sent < totalBytes; sent += chunk.byteLength) {
        writer.write(chunk);
        await writer.flush();
      }
      await writer.end();
    })()`,
  );
});

// A write of a Buffer, a typed array, an ArrayBuffer or a string to S3 is one
// PUT, and the request owns the one copy of the bytes: no Blob store is made
// of them, so on Linux no memfd either. A source that has a store (an array of
// parts, a Blob, a buffered Response) is copied by the request, and the write
// does not keep that store while the PUT is pending.
describe("a write of in-memory data to S3", () => {
  const MiB = 1024 * 1024;

  // Stands in for S3, in this process: the child only writes, so its memory and
  // its memfds are those of the writes. The response to a key that ends in
  // "held" waits for `GET /release`. A key that ends in "denied" gets a 403.
  // `GET /arrived?count=n` answers when n bodies are in.
  function createSink() {
    const requests: { key: string; length: number; fill: number; text?: string; type: string | null }[] = [];
    const held: (() => void)[] = [];
    const waiting: { count: number; resolve: () => void }[] = [];
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      maxRequestBodySize: 1024 * MiB,
      async fetch(req) {
        const url = new URL(req.url);
        if (req.method !== "PUT") {
          const count = Number(url.searchParams.get("count"));
          if (url.pathname === "/arrived" && requests.length < count) {
            await new Promise<void>(resolve => waiting.push({ count, resolve }));
          }
          if (url.pathname === "/release") held.splice(0).forEach(release => release());
          return new Response();
        }
        const key = url.pathname.split("/").at(-1)!;
        let length = 0;
        let fill: number | undefined; // the byte value that fills the body, or -1 when it is not one value repeated
        let start = Buffer.alloc(0);
        for await (const chunk of req.body ?? []) {
          fill ??= chunk[0];
          if (Buffer.compare(chunk, Buffer.alloc(chunk.length, fill)) !== 0) fill = -1;
          if (start.length < 64) start = Buffer.concat([start, chunk.subarray(0, 64)]);
          length += chunk.length;
        }
        requests.push({
          key,
          length,
          fill: fill ?? -1,
          ...(length < 64 && { text: start.toString() }),
          type: req.headers.get("content-type"),
        });
        for (const waiter of waiting.splice(0)) {
          if (requests.length >= waiter.count) waiter.resolve();
          else waiting.push(waiter);
        }
        if (key.endsWith("held")) await new Promise<void>(resolve => held.push(resolve));
        if (key.endsWith("denied")) {
          return new Response("<Error><Code>AccessDenied</Code><Message>no</Message></Error>", {
            status: 403,
            headers: { "content-type": "application/xml" },
          });
        }
        return new Response("", { headers: { ETag: '"etag"' } });
      },
    });
    const request = (key: string) => requests.findLast(request => request.key === key)!;
    const sent = (key: string): { length: number; fill: number; text?: string } => {
      const { type, key: _, ...body } = request(key);
      return body;
    };
    return { server, request, sent, [Symbol.asyncDispose]: () => server.stop(true) };
  }
  type Sink = ReturnType<typeof createSink>;

  // A script that runs `body` with `client` (an S3Client), its `options`, and
  // `arrived(count)` and `release()` for the sink in scope, and prints what `body` returns.
  const fixture = (sink: Sink, body: string) => `
    const MiB = 1024 * 1024;
    const sink = ${JSON.stringify(sink.server.url.origin)};
    const arrived = count => fetch(sink + "/arrived?count=" + count).then(response => response.text());
    const release = () => fetch(sink + "/release").then(response => response.text());
    const options = {
      endpoint: sink,
      bucket: "bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-east-1",
      retry: 0,
    };
    const client = new Bun.S3Client(options);
    console.log(JSON.stringify(await (async () => {${body}})()));
  `;

  async function run(sink: Sink, body: string, args: string[] = []) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args, "-e", fixture(sink, body)],
      // A store that the write frees inside the call must not stay resident.
      env: withoutAsanQuarantine(sinkEnv),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr.trim()).toBe("");
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(exitCode).toBe(0);
    return result;
  }

  // A memfd store exists on Linux only. --smol puts its threshold at 1 MiB.
  // The allocator numbers its memfds in one sequence for the process, so the
  // number of the next store says how many stores a write made.
  test.skipIf(!isLinux)("a buffer makes no memfd store, and no write keeps one", async () => {
    await using sink = createSink();
    const result = await run(
      sink,
      `
        const fs = require("node:fs");
        const stores = () => fs.readFileSync("/proc/self/maps", "utf8").match(/memfd:memfd-num-\\d+/g) ?? [];
        const descriptors = () =>
          fs.readdirSync("/proc/self/fd").filter(fd => {
            try {
              return fs.readlinkSync("/proc/self/fd/" + fd).includes("memfd:memfd-num-");
            } catch {
              return false;
            }
          }).length;
        const number = name => Number(name.slice("memfd:memfd-num-".length));

        // A Blob of this size is a memfd store. It stays alive to the end.
        const control = new Blob([new Uint8Array(2 * MiB)]);
        const before = { stores: stores(), descriptors: descriptors() };
        const held = () => ({
          stores: stores().length - before.stores.length,
          descriptors: descriptors() - before.descriptors,
        });

        const buffer = Bun.write(client.file("buffer-held"), new Uint8Array(2 * MiB).fill(97));
        const afterTheCall = held();
        await arrived(1);
        const whileThePutIsPending = held();
        const storesTheBufferWriteMade = Math.max(...stores().map(number)) - number(before.stores[0]);

        // An array of parts still gets a store, here a memfd. The request copies it inside the call.
        const array = Bun.write(client.file("array-held"), [new Uint8Array(2 * MiB).fill(98)]);
        const afterTheArrayCall = held();
        await arrived(2);
        const whileTheArrayPutIsPending = held();

        await release();
        return {
          control: before.stores.length,
          afterTheCall,
          whileThePutIsPending,
          storesTheBufferWriteMade,
          afterTheArrayCall,
          whileTheArrayPutIsPending,
          resolved: [await buffer, await array],
          controlSize: control.size,
        };
      `,
      ["--smol"],
    );
    const none = { stores: 0, descriptors: 0 };
    expect(result).toEqual({
      control: 1,
      afterTheCall: none,
      whileThePutIsPending: none,
      storesTheBufferWriteMade: 0,
      afterTheArrayCall: none,
      whileTheArrayPutIsPending: none,
      resolved: [2 * MiB, 2 * MiB],
      controlSize: 2 * MiB,
    });
    expect([sink.sent("buffer-held"), sink.sent("array-held")]).toEqual([
      { length: 2 * MiB, fill: 97 },
      { length: 2 * MiB, fill: 98 },
    ]);
  });

  test.each(["buffer", "text", "[buffer]", "new Response(buffer)"])(
    "pending writes of %s hold one copy of the bytes each",
    async source => {
      const count = 16;
      const size = 4 * MiB;
      await using sink = createSink();
      const { pendingMiB, resolved } = await run(
        sink,
        `
          const count = ${count}, size = ${size};
          const buffer = Buffer.alloc(size, 97);
          const text = buffer.toString();
          // The first request starts the HTTP thread. Keep that out of the measurement.
          await arrived(0);
          Bun.gc(true);
          const before = process.memoryUsage.rss();
          const writes = [];
          for (let i = 0; i < count; i++) writes.push(client.write(i + "-held", ${source}));
          await arrived(count);
          Bun.gc(true);
          const pendingMiB = Math.round((process.memoryUsage.rss() - before) / MiB);
          await release();
          return { pendingMiB, resolved: await Promise.all(writes) };
        `,
      );
      expect(resolved).toEqual(Array(count).fill(size));
      // One copy of each body is 64 MiB. With a second copy held too it is 128 MiB or more.
      expect(pendingMiB).toBeLessThan(isASAN || isDebug ? 112 : 96);
    },
  );

  // The source is 64 MiB. One copy for the request is 64 MiB more, a store between the two another 64 MiB.
  test.each(["Buffer.alloc(size, 97)", '"a".repeat(size)'])("one write of %s makes one copy", async source => {
    const size = 64 * MiB;
    await using sink = createSink();
    const body = `
      const size = ${size};
      return await client.write("key", ${source});
    `;
    const [{ stdout, stderr, exitCode, maxRSS }, empty] = await Promise.all([
      runCommandMaxRSS({ cmd: [bunExe(), "-e", fixture(sink, body)], env: withoutAsanQuarantine(sinkEnv) }),
      emptyProcessMaxRSS(),
    ]);
    expect(stderr.trim()).toBe("");
    expect(JSON.parse(stdout.trim())).toBe(size);
    expect(exitCode).toBe(0);
    expect(sink.sent("key")).toEqual({ length: size, fill: 97 });
    expect(Math.round((maxRSS - empty) / MiB)).toBeLessThan(160);
  });

  test("sends the bytes as they were at the call", async () => {
    await using sink = createSink();
    const result = await run(
      sink,
      `
        const settled = (write, withPath) =>
          write.then(
            bytes => bytes,
            error => ({ name: error.name, code: error.code, ...(withPath && { path: error.path }) }),
          );

        // The write has its copy when the call returns: a later change to the buffer is not sent.
        const reused = new Uint8Array(2 * MiB).fill(97);
        const pending = Bun.write(client.file("reused-held"), reused);
        reused.fill(98);
        await arrived(1);
        await release();

        const window = new Uint8Array(3 * MiB).fill(99).fill(100, MiB, 2 * MiB).subarray(MiB, 2 * MiB);
        const words = new Uint16Array(MiB).fill(0x6565);
        const text = "h\\u00e9llo w\\u00f6rld \\u20ac";
        const detached = new ArrayBuffer(8);
        detached.transfer();
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        );
        return {
          "reused-held": await settled(pending),
          subarray: await settled(client.write("subarray", window)),
          "data-view": await settled(client.write("data-view", new DataView(window.buffer, MiB, 7))),
          "array-buffer": await settled(client.write("array-buffer", words.buffer)),
          "uint16-array": await settled(client.write("uint16-array", words)),
          ascii: await settled(client.write("ascii", "a".repeat(2 * MiB))),
          latin1: await settled(client.write("latin1", "caf\\u00e9")),
          utf16: await settled(client.write("utf16", text)),
          file: await settled(client.file("file").write(text)),
          "bun-write": await settled(Bun.write(client.file("bun-write"), text)),
          url: await settled(Bun.write("s3://bucket/url", text, options)),
          static: await settled(Bun.S3Client.write("static", text, options)),
          image: await settled(new Bun.Image(png).png().write(client.file("image.png"))),
          denied: await settled(client.write("denied", new Uint8Array(2 * MiB))),
          "text-denied": await settled(client.write("text-denied", text)),

          // A source with no bytes is an empty PUT, and its failure names the key.
          "empty-string": await settled(client.write("empty-string", "")),
          "empty-buffer": await settled(client.write("empty-buffer", new Uint8Array(0))),
          "detached-buffer": await settled(client.write("detached-buffer", detached)),
          "empty-string-denied": await settled(client.write("empty-string-denied", ""), true),
          "empty-buffer-denied": await settled(client.write("empty-buffer-denied", new Uint8Array(0)), true),

          // Sources that have a Blob store: one PUT of the store's bytes.
          array: await settled(client.write("array", [new Uint8Array(MiB).fill(101)])),
          blob: await settled(Bun.write(client.file("blob"), new Blob([text]))),
          response: await settled(client.write("response", new Response(text))),
          "string-object": await settled(client.write("string-object", new String(text))),
          "to-string": await settled(
            client.write("to-string", Object.assign(new String("wrapped"), { toString: () => "converted" })),
          ),
          "blob-denied": await settled(client.write("blob-denied", new Blob([text]))),
          "array-denied": await settled(client.write("array-denied", [new Uint8Array(3).fill(102)])),
        };
      `,
    );
    const text = "héllo wörld €";
    const utf8 = Buffer.byteLength(text);
    const denied = { name: "S3Error", code: "AccessDenied" };
    const image = sink.request("image.png");
    expect(result).toEqual({
      "reused-held": 2 * MiB,
      subarray: MiB,
      "data-view": 7,
      "array-buffer": 2 * MiB,
      "uint16-array": 2 * MiB,
      ascii: 2 * MiB,
      latin1: 5,
      utf16: utf8,
      file: utf8,
      "bun-write": utf8,
      url: utf8,
      static: utf8,
      image: image.length,
      denied,
      "text-denied": denied,

      "empty-string": 0,
      "empty-buffer": 0,
      "detached-buffer": 0,
      "empty-string-denied": { ...denied, path: "empty-string-denied" },
      "empty-buffer-denied": { ...denied, path: "empty-buffer-denied" },

      array: MiB,
      blob: utf8,
      response: utf8,
      "string-object": utf8,
      "to-string": 9,
      "blob-denied": denied,
      "array-denied": denied,
    });
    expect({ length: image.length > 0, type: image.type }).toEqual({ length: true, type: "image/png" });
    const { image: _, ...rest } = result;
    expect(Object.fromEntries(Object.keys(rest).map(key => [key, sink.sent(key)]))).toEqual({
      "reused-held": { length: 2 * MiB, fill: 97 },
      subarray: { length: MiB, fill: 100 },
      "data-view": { length: 7, fill: 100, text: "ddddddd" },
      "array-buffer": { length: 2 * MiB, fill: 0x65 },
      "uint16-array": { length: 2 * MiB, fill: 0x65 },
      ascii: { length: 2 * MiB, fill: 97 },
      latin1: { length: 5, fill: -1, text: "café" },
      utf16: { length: utf8, fill: -1, text },
      file: { length: utf8, fill: -1, text },
      "bun-write": { length: utf8, fill: -1, text },
      url: { length: utf8, fill: -1, text },
      static: { length: utf8, fill: -1, text },
      denied: { length: 2 * MiB, fill: 0 },
      "text-denied": { length: utf8, fill: -1, text },

      "empty-string": { length: 0, fill: -1, text: "" },
      "empty-buffer": { length: 0, fill: -1, text: "" },
      "detached-buffer": { length: 0, fill: -1, text: "" },
      "empty-string-denied": { length: 0, fill: -1, text: "" },
      "empty-buffer-denied": { length: 0, fill: -1, text: "" },

      array: { length: MiB, fill: 101 },
      blob: { length: utf8, fill: -1, text },
      response: { length: utf8, fill: -1, text },
      "string-object": { length: utf8, fill: -1, text },
      "to-string": { length: 9, fill: -1, text: "converted" },
      "blob-denied": { length: utf8, fill: -1, text },
      "array-denied": { length: 3, fill: 102, text: "fff" },
    });
  });
});
