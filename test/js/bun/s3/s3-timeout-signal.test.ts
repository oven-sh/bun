import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `timeout` bounds each request's idle time, `signal` aborts one operation.
// Every server here accepts the connection and never answers, so without
// either knob a request waits for the process-wide idle timeout (5 minutes).

const env = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

// Accepts and never writes. Counts the request lines it sees.
function silentServer() {
  const requests: string[] = [];
  let waiters: ((line: string) => void)[] = [];
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open() {},
      data(_socket, data) {
        const text = new TextDecoder().decode(data);
        const line = text.slice(0, text.indexOf("\r\n"));
        if (!/^[A-Z]+ /.test(line)) return;
        const request = line.replace(/ HTTP\/1\.1$/, "");
        requests.push(request);
        const pending = waiters;
        waiters = [];
        for (const resolve of pending) resolve(request);
      },
      error() {},
    },
  });
  return {
    requests,
    port: server.port,
    /** Resolves with the next request line the server reads. */
    nextRequest() {
      return new Promise<string>(resolve => waiters.push(resolve));
    },
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

function client(port: number, options: Record<string, unknown> = {}) {
  return new Bun.S3Client({
    accessKeyId: "key",
    secretAccessKey: "secret",
    bucket: "bucket",
    region: "us-east-1",
    endpoint: `http://127.0.0.1:${port}`,
    ...options,
  });
}

// The idle timer runs on a 4 second wheel, so `timeout: 500` fires after 4 to
// 8 seconds. The bound below is what the test checks, not the exact value.
const TIMEOUT_MS = 500;
const MIN_ELAPSED_MS = 1_000;
const MAX_ELAPSED_MS = 15_000;

async function rejection(promise: Promise<unknown>) {
  const start = performance.now();
  const error = await promise.then(
    () => {
      throw new Error("resolved");
    },
    e => e,
  );
  return { error, elapsed: performance.now() - start };
}

function expectTimeout({ error, elapsed }: { error: any; elapsed: number }) {
  expect(error).toBeInstanceOf(Error);
  expect(error.name).toBe("S3Error");
  expect(error.code).toBe("Timeout");
  expect(error.message).toBe("The request timed out: the connection was idle for longer than the timeout");
  expect(elapsed).toBeGreaterThan(MIN_ELAPSED_MS);
  expect(elapsed).toBeLessThan(MAX_ELAPSED_MS);
}

describe("timeout", () => {
  test.concurrent(
    "stat rejects with S3Error code Timeout",
    async () => {
      using server = silentServer();
      const s3 = client(server.port);
      expectTimeout(await rejection(s3.stat("key", { timeout: TIMEOUT_MS })));
      expect(server.requests).toEqual(["HEAD /bucket/key"]);
    },
    30_000,
  );

  test.concurrent(
    "the client-level timeout applies to every operation",
    async () => {
      using server = silentServer();
      const s3 = client(server.port, { timeout: TIMEOUT_MS });
      expectTimeout(await rejection(s3.file("key").text()));
      expectTimeout(await rejection(s3.delete("key")));
      expect(server.requests).toEqual(["GET /bucket/key", "DELETE /bucket/key"]);
    },
    30_000,
  );

  test.concurrent(
    "a timeout on the handle bounds stream() and a writer() made without options",
    async () => {
      using server = silentServer();
      const file = client(server.port).file("key", { timeout: TIMEOUT_MS });
      const [stream, writer] = await Promise.all([
        rejection(new Response(file.stream()).text()),
        rejection(
          (async () => {
            const writer = file.writer({ retry: 0 });
            writer.write("hello");
            await writer.end();
          })(),
        ),
      ]);
      expectTimeout(stream);
      expectTimeout(writer);
      expect(server.requests.sort()).toEqual(["GET /bucket/key", "PUT /bucket/key"]);
    },
    30_000,
  );

  test.concurrent(
    "each retry of an upload gets a fresh timeout",
    async () => {
      using server = silentServer();
      const s3 = client(server.port, { timeout: TIMEOUT_MS, retry: 1 });
      const writer = s3.file("key").writer();
      writer.write("hello");
      const { error, elapsed } = await rejection(writer.end());
      expect(error.code).toBe("Timeout");
      expect(server.requests).toEqual(["PUT /bucket/key", "PUT /bucket/key"]);
      expect(elapsed).toBeGreaterThan(2 * MIN_ELAPSED_MS);
    },
    45_000,
  );

  test.concurrent(
    "timeout: false or 0 turns off the client-level and the process-wide idle timeout",
    async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open() {}, data() {} } });
          const s3 = new Bun.S3Client({ accessKeyId: "k", secretAccessKey: "s", bucket: "b", region: "us-east-1", endpoint: "http://127.0.0.1:" + server.port, timeout: ${TIMEOUT_MS} });
          const name = p => p.then(() => "resolved", e => e.name === "S3Error" ? e.name + ":" + e.code : e.name);
          console.log(JSON.stringify(await Promise.all([
            name(s3.stat("off", { timeout: false, signal: AbortSignal.timeout(11_000) })),
            name(s3.stat("zero", { timeout: 0, signal: AbortSignal.timeout(11_000) })),
            name(s3.list({ prefix: "k" }, { timeout: ${TIMEOUT_MS} })),
            name(s3.stat("default")),
          ])));
          process.exit(0);
          `,
        ],
        env: { ...env, BUN_CONFIG_HTTP_IDLE_TIMEOUT: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(["TimeoutError", "TimeoutError", "S3Error:Timeout", "S3Error:Timeout"]);
      expect(exitCode).toBe(0);
    },
    30_000,
  );

  // A multipart upload against a stub that answers CreateMultipartUpload, then
  // behaves as `part` and `abort` say. The child prints the outcome and the
  // request counts, and exits only once nothing holds the loop (the server is unref'd).
  function multipartFixture(opts: { part: "stall" | "500"; abort: "stall" | "204"; retry: number }) {
    return `
      const reqs = { create: 0, part: 0, complete: 0, abort: 0 };
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);
          if (req.method === "POST" && url.searchParams.has("uploads")) {
            reqs.create++;
            return new Response("<InitiateMultipartUploadResult><UploadId>u</UploadId></InitiateMultipartUploadResult>");
          }
          if (req.method === "PUT") {
            reqs.part++;
            await req.arrayBuffer();
            ${opts.part === "stall" ? "await new Promise(() => {});" : 'return new Response("", { status: 500 });'}
          }
          if (req.method === "DELETE") {
            reqs.abort++;
            ${opts.abort === "stall" ? "await new Promise(() => {});" : 'return new Response("", { status: 204 });'}
          }
          reqs.complete++;
          return new Response("<CompleteMultipartUploadResult/>");
        },
      });
      server.unref();
      const s3 = new Bun.S3Client({ accessKeyId: "k", secretAccessKey: "s", bucket: "b", region: "us-east-1", endpoint: "http://127.0.0.1:" + server.port });
      const partSize = 5 * 1024 * 1024;
      const writer = s3.file("key").writer({ partSize, queueSize: 1, retry: ${opts.retry}, timeout: ${TIMEOUT_MS} });
      writer.write(new Uint8Array(partSize));
      const start = performance.now();
      const outcome = await writer.end().then(() => "resolved", e => e.name + ":" + e.code);
      console.log(JSON.stringify({ outcome, rejectedAfter: Math.round(performance.now() - start) }));
      process.on("exit", () => console.log(JSON.stringify({ reqs, exitedAfter: Math.round(performance.now() - start) })));
    `;
  }

  async function runMultipart(opts: Parameters<typeof multipartFixture>[0]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", multipartFixture(opts)],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const [outcome, exit] = stdout.trim().split("\n");
    return { ...JSON.parse(outcome), ...JSON.parse(exit) };
  }

  test.concurrent(
    "a multipart part that stalls is retried with a fresh timeout, then the upload is aborted",
    async () => {
      const result = await runMultipart({ part: "stall", abort: "204", retry: 1 });
      expect(result).toEqual({
        outcome: "S3Error:Timeout",
        rejectedAfter: expect.any(Number),
        reqs: { create: 1, part: 2, complete: 0, abort: 1 },
        exitedAfter: expect.any(Number),
      });
      expect(result.rejectedAfter).toBeGreaterThan(2 * MIN_ELAPSED_MS);
      expect(result.rejectedAfter).toBeLessThan(2 * MAX_ELAPSED_MS);
    },
    60_000,
  );

  test.concurrent(
    "a rollback that times out is not retried, so the process exits after one timeout",
    async () => {
      const result = await runMultipart({ part: "500", abort: "stall", retry: 3 });
      expect(result).toEqual({
        outcome: "S3Error:UnknownError",
        rejectedAfter: expect.any(Number),
        reqs: { create: 1, part: 4, complete: 0, abort: 1 },
        exitedAfter: expect.any(Number),
      });
      expect(result.rejectedAfter).toBeLessThan(MIN_ELAPSED_MS);
      expect(result.exitedAfter).toBeGreaterThan(MIN_ELAPSED_MS);
      expect(result.exitedAfter).toBeLessThan(MAX_ELAPSED_MS);
    },
    60_000,
  );

  test("option parsing", () => {
    using server = silentServer();
    const s3 = client(server.port);
    expect(() => s3.file("key", { timeout: -1 })).toThrow(RangeError);
    expect(() => s3.file("key", { timeout: "soon" as any })).toThrow(TypeError);
    expect(() => s3.file("key", { timeout: false })).not.toThrow();
    expect(() => s3.file("key", { timeout: 0 })).not.toThrow();
    expect(() => s3.file("key", { timeout: Infinity })).not.toThrow();
    expect(() => s3.file("key", { timeout: 1000 })).not.toThrow();
    expect(() => new Bun.S3Client({ timeout: -5 })).toThrow(RangeError);
  });
});

describe("signal", () => {
  test.concurrent("stat rejects with signal.reason", async () => {
    using server = silentServer();
    const s3 = client(server.port);
    const controller = new AbortController();
    const promise = rejection(s3.stat("key", { signal: controller.signal }));
    expect(await server.nextRequest()).toBe("HEAD /bucket/key");
    controller.abort(new Error("stop"));
    const { error, elapsed } = await promise;
    expect(error).toBe(controller.signal.reason);
    expect(elapsed).toBeLessThan(MIN_ELAPSED_MS);
  });

  test.concurrent("an abort in the same tick as the call rejects with the reason", async () => {
    using server = silentServer();
    const s3 = client(server.port);
    const controller = new AbortController();
    const promise = rejection(s3.stat("key", { signal: controller.signal }));
    controller.abort(new Error("stop"));
    expect((await promise).error).toBe(controller.signal.reason);
  });

  test.concurrent("the reason survives a GC of the controller", async () => {
    using server = silentServer();
    const s3 = client(server.port);
    const promise = (() => {
      const controller = new AbortController();
      const promise = rejection(s3.stat("key", { signal: controller.signal }));
      controller.abort(new Error("custom reason"));
      return promise;
    })();
    Bun.gc(true);
    const { error } = await promise;
    expect(error.message).toBe("custom reason");
  });

  test.concurrent("a signal that fires after the response arrived still rejects", async () => {
    await using server = Bun.serve({ port: 0, fetch: () => new Response("", { headers: { etag: '"e"' } }) });
    const s3 = client(server.port);
    for (let i = 0; i < 20; i++) {
      const controller = new AbortController();
      const promise = s3.stat("key", { signal: controller.signal }).then(
        () => {
          if (controller.signal.aborted) throw new Error("resolved after abort");
        },
        e => {
          if (e !== controller.signal.reason) throw e;
        },
      );
      await Bun.sleep(i % 5);
      controller.abort(new Error("late"));
      await promise;
    }
  });

  test.concurrent("AbortSignal.timeout bounds the whole operation", async () => {
    using server = silentServer();
    const s3 = client(server.port);
    const { error, elapsed } = await rejection(s3.stat("key", { signal: AbortSignal.timeout(100) }));
    expect(error.name).toBe("TimeoutError");
    expect(elapsed).toBeLessThan(MIN_ELAPSED_MS);
  });

  test.concurrent("every operation accepts it", async () => {
    using server = silentServer();
    const s3 = client(server.port);
    const signal = AbortSignal.timeout(100);
    using dir = tempDir("s3-signal", { "source.txt": "hello" });
    const creds = {
      accessKeyId: "key",
      secretAccessKey: "secret",
      bucket: "bucket",
      region: "us-east-1",
      endpoint: `http://127.0.0.1:${server.port}`,
    };
    const stream = () =>
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(16));
          c.close();
        },
      });
    const results = await Promise.all([
      rejection(s3.exists("key", { signal })),
      rejection(s3.size("key", { signal })),
      rejection(s3.delete("key", { signal })),
      rejection(s3.write("key", "hello", { signal })),
      rejection(s3.write("key", new Response(stream()), { signal })),
      rejection(s3.write("key", Bun.file(`${dir}/source.txt`), { signal })),
      rejection(s3.list({ prefix: "k" }, { signal })),
      rejection(s3.file("key").stat({ signal })),
      rejection(s3.file("key").exists({ signal })),
      rejection(s3.file("key").unlink({ signal })),
      rejection(s3.file("key").write("hello", { signal })),
      rejection(Bun.write(s3.file("key"), stream(), { signal })),
      rejection(Bun.S3Client.stat("key", { ...creds, signal })),
      rejection(Bun.S3Client.write("key", "hello", { ...creds, signal })),
    ]);
    expect(results.map(r => r.error.name)).toEqual(Array(results.length).fill("TimeoutError"));
    expect((await rejection(Bun.S3Client.exists(s3.file("key"), { signal }))).error.name).toBe("TimeoutError");
  });

  test.concurrent("a signal that fired already rejects before a request is sent", async () => {
    using server = silentServer();
    const s3 = client(server.port);
    const signal = AbortSignal.abort(new Error("never"));
    const results = await Promise.all([
      rejection(s3.stat("key", { signal })),
      rejection(s3.write("key", "hello", { signal })),
      rejection(s3.write("key", new Response("hello"), { signal })),
      rejection(s3.list(null, { signal })),
    ]);
    expect(results.map(r => r.error)).toEqual(Array(results.length).fill(signal.reason));
    const writer = s3.file("key").writer({ signal });
    expect(writer.write("hello")).toBe(0);
    expect((await rejection(writer.flush())).error).toBe(signal.reason);
    expect((await rejection(writer.end())).error).toBe(signal.reason);
    expect(server.requests).toEqual([]);
  });

  test.concurrent("a signal on file() or presign() is ignored", async () => {
    using server = silentServer();
    const s3 = client(server.port);
    const signal = AbortSignal.abort();
    expect(s3.file("key", { signal } as any).name).toBe("key");
    expect(s3.presign("key", { signal } as any)).toStartWith("http://127.0.0.1:");
  });

  test.concurrent("a writer aborted mid-upload rejects end() and aborts the upload on the server", async () => {
    const requests = { create: 0, part: 0, complete: 0, abort: 0 };
    const partSeen = Promise.withResolvers<void>();
    const abortSeen = Promise.withResolvers<void>();
    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (req.method === "POST" && url.searchParams.has("uploads")) {
          requests.create++;
          return new Response(
            "<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
          );
        }
        if (req.method === "PUT") {
          requests.part++;
          partSeen.resolve();
          await new Promise(() => {}); // never answers
        }
        if (req.method === "DELETE") {
          requests.abort++;
          abortSeen.resolve();
          return new Response("", { status: 204 });
        }
        requests.complete++;
        return new Response("<CompleteMultipartUploadResult/>");
      },
    });
    const s3 = client(server.port);
    const controller = new AbortController();
    const partSize = 5 * 1024 * 1024;
    const writer = s3.file("key").writer({ partSize, queueSize: 1, retry: 3, signal: controller.signal });
    writer.write(new Uint8Array(partSize));
    await partSeen.promise;
    const ending = rejection(writer.end());
    controller.abort(new Error("stop"));
    const { error, elapsed } = await ending;
    expect(error).toBe(controller.signal.reason);
    expect(elapsed).toBeLessThan(MIN_ELAPSED_MS);
    expect((await rejection(writer.end())).error).toBe(controller.signal.reason);
    await abortSeen.promise;
    expect(requests).toEqual({ create: 1, part: 1, complete: 0, abort: 1 });
  });

  test.concurrent("fetch of an s3:// URL with a stream body forwards the signal", async () => {
    using server = silentServer();
    const controller = new AbortController();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(16));
        c.close();
      },
    });
    const promise = rejection(
      fetch(`s3://bucket/key`, {
        method: "PUT",
        body: stream,
        signal: controller.signal,
        s3: {
          accessKeyId: "key",
          secretAccessKey: "secret",
          region: "us-east-1",
          endpoint: `http://127.0.0.1:${server.port}`,
        },
      }),
    );
    expect(await server.nextRequest()).toBe("PUT /bucket/key");
    controller.abort(new Error("stop"));
    const { error } = await promise;
    expect(error).toBe(controller.signal.reason);
  });

  test.concurrent("an aborted request does not keep the process alive", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const controller = new AbortController();
        const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open() {}, data() { controller.abort(); } } });
        server.unref();
        const s3 = new Bun.S3Client({ accessKeyId: "k", secretAccessKey: "s", bucket: "b", region: "us-east-1", endpoint: "http://127.0.0.1:" + server.port });
        const promise = s3.stat("key", { signal: controller.signal }).then(() => "resolved", e => e === controller.signal.reason ? "aborted" : "other: " + e);
        console.log(await promise);
        `,
      ],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("aborted\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
