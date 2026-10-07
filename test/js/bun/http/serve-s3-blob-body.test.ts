import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// A Response whose body is an S3-backed Blob comes from `fetch()` of a blob:
// URL for an S3File, from a clone of that, or from `new Response([s3file])`.
// (`new Response(s3file)` has no body: it is a redirect to a presigned URL.)
// The server proxies the object as a stream on GET. HEAD is framed like that
// stream and asks S3 nothing.
describe.concurrent("Response with an S3 file body", () => {
  /** A local server that plays the S3 endpoint for a 10-byte object and records each request. */
  function fakeS3(answer?: (req: Request) => Response) {
    const requests: string[] = [];
    const origin = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const range = req.headers.get("range");
        requests.push(range ? `${req.method} ${range}` : req.method);
        if (answer) return answer(req);
        const window = /^bytes=(\d+)-(\d+)$/.exec(range ?? "");
        if (window) return new Response("0123456789".slice(+window[1], +window[2] + 1), { status: 206 });
        return new Response("0123456789");
      },
    });
    const s3 = new Bun.S3Client({
      accessKeyId: "test",
      secretAccessKey: "test",
      region: "us-east-1",
      bucket: "my-bucket",
      endpoint: origin.url.href,
    });
    return { requests, s3, [Symbol.dispose]: () => void origin.stop(true) };
  }

  // The HEAD requests run in a subprocess: a server that crashes on one shows
  // up as an exit code instead of taking down the test runner.
  async function runHeadFixture(mode: "gc" | "matrix") {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "serve-s3-blob-body-head-fixture.ts"), mode],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stderr, lines: stdout.split("\n").filter(Boolean), exitCode };
  }

  test("HEAD does not wait for S3, so a garbage collection cannot take the Response from under it", async () => {
    const { stderr, lines, exitCode } = await runHeadFixture("gc");
    expect(stderr).toBe("");
    expect(lines.map(line => JSON.parse(line))).toEqual([{ status: 200, contentLength: null, s3Requests: [] }]);
    expect(exitCode).toBe(0);
  });

  test("HEAD states no length and asks S3 nothing, however the Response reaches the server", async () => {
    const { stderr, lines, exitCode } = await runHeadFixture("matrix");
    expect(stderr).toBe("");

    const producers = ["fetch(blob:)", "clone()", "new Response([s3file])"];
    const entries = [
      "returned",
      "fulfilled promise",
      "pending promise",
      "error()",
      "error() fulfilled promise",
      "routes GET",
    ];
    const head = { status: 200, contentLength: null, transferEncoding: "chunked", s3Requests: [], bodyUsed: false };
    // HEAD carries the status and headers that GET carries.
    const framing = { status: 203, headers: { "transfer-encoding": "chunked", "x-custom": "yes" } };
    expect(lines.map(line => JSON.parse(line))).toEqual([
      ...producers.flatMap(producer => entries.map(entry => ({ producer, entry, ...head }))),
      { method: "HEAD", ...framing, body: "", s3Requests: [] },
      { method: "GET", ...framing, body: "0123456789", s3Requests: ["GET"] },
      // HEAD leaves the body unused: one Response answers several HEADs and then a GET.
      { method: "HEAD", status: 200, body: "", bodyUsed: false },
      { method: "HEAD", status: 200, body: "", bodyUsed: false },
      { method: "HEAD", status: 200, body: "", bodyUsed: false },
      { method: "GET", status: 200, body: "0123456789", bodyUsed: true },
    ]);
    expect(exitCode).toBe(0);
  });

  test("GET streams the object", async () => {
    using fake = fakeS3();
    using app = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response([fake.s3.file("object.txt")]),
    });

    const res = await fetch(app.url);
    expect({
      status: res.status,
      contentLength: res.headers.get("content-length"),
      transferEncoding: res.headers.get("transfer-encoding"),
      body: await res.text(),
      s3Requests: fake.requests,
    }).toEqual({
      status: 200,
      contentLength: null,
      transferEncoding: "chunked",
      body: "0123456789",
      s3Requests: ["GET"],
    });
  });

  test("GET streams the window of a slice", async () => {
    using fake = fakeS3();
    const blobUrl = URL.createObjectURL(fake.s3.file("object.txt").slice(2, 7));
    using app = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => fetch(blobUrl),
    });

    try {
      const res = await fetch(app.url);
      expect({ status: res.status, body: await res.text(), s3Requests: fake.requests }).toEqual({
        status: 200,
        body: "23456",
        s3Requests: ["GET bytes=2-6"],
      });
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  });

  test("GET for an empty slice sends an empty body and asks S3 nothing", async () => {
    using fake = fakeS3();
    using app = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response([fake.s3.file("object.txt").slice(4, 4)]),
    });

    const res = await fetch(app.url);
    expect({
      status: res.status,
      contentLength: res.headers.get("content-length"),
      body: await res.text(),
      s3Requests: fake.requests,
    }).toEqual({ status: 200, contentLength: "0", body: "", s3Requests: [] });
  });

  test.each([
    [500, "InternalError"],
    [404, "NoSuchKey"],
  ])("GET calls error() once when S3 answers %d", async (status, code) => {
    using fake = fakeS3(
      () =>
        new Response(
          `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>failed</Message></Error>`,
          { status, headers: { "Content-Type": "application/xml" } },
        ),
    );
    const errors: string[] = [];
    using app = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response([fake.s3.file("object.txt")]),
      error(err) {
        errors.push((err as Error & { code: string }).code);
        return new Response("handled", { status: 502 });
      },
    });

    const res = await fetch(app.url);
    expect({ status: res.status, body: await res.text(), errors, s3Requests: fake.requests }).toEqual({
      status: 502,
      body: "handled",
      errors: [code],
      s3Requests: ["GET"],
    });
  });

  test("GET calls error() once when the S3 request cannot be signed", async () => {
    using fake = fakeS3();
    const errors: string[] = [];
    using app = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      // No key over 1024 bytes can be signed.
      fetch: () => new Response([fake.s3.file(Buffer.alloc(2000, "a").toString())]),
      error(err) {
        errors.push((err as Error & { code: string }).code);
        return new Response("handled", { status: 502 });
      },
    });

    const res = await fetch(app.url);
    expect({ status: res.status, body: await res.text(), errors, s3Requests: fake.requests }).toEqual({
      status: 502,
      body: "handled",
      errors: ["ERR_S3_INVALID_PATH"],
      s3Requests: [],
    });
  });

  test("a client abort cancels the download", async () => {
    const { promise: downloadClosed, resolve: onDownloadClosed } = Promise.withResolvers<void>();
    // S3 sends the first half of the object and then nothing, so the download stays open.
    using fake = fakeS3(req => {
      req.signal.addEventListener("abort", () => onDownloadClosed());
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("01234"));
          },
        }),
      );
    });
    using app = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => new Response([fake.s3.file("object.txt")]),
    });

    const client = new AbortController();
    const res = await fetch(app.url, { signal: client.signal });
    const { value } = await res.body!.getReader().read();
    expect(new TextDecoder().decode(value)).toBe("01234");

    client.abort();
    await downloadClosed;
    expect(app.pendingRequests).toBe(0);
  });
});
