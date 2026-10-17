import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open() {},
      data(_socket, data) {
        const text = new TextDecoder().decode(data);
        const line = text.slice(0, text.indexOf("\r\n"));
        if (/^[A-Z]+ /.test(line)) requests.push(line.replace(/ HTTP\/1\.1$/, ""));
      },
      error() {},
    },
  });
  return {
    requests,
    port: server.port,
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
  expect(error.message).not.toBe("an unexpected error has occurred");
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
    await Bun.sleep(50);
    controller.abort(new Error("stop"));
    const { error, elapsed } = await promise;
    expect(error).toBe(controller.signal.reason);
    expect(elapsed).toBeLessThan(MIN_ELAPSED_MS);
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
    const results = await Promise.all([
      rejection(s3.exists("key", { signal })),
      rejection(s3.size("key", { signal })),
      rejection(s3.delete("key", { signal })),
      rejection(s3.write("key", "hello", { signal })),
      rejection(s3.list({ prefix: "k" }, { signal })),
      rejection(s3.file("key").stat({ signal })),
      rejection(s3.file("key").exists({ signal })),
      rejection(s3.file("key").unlink({ signal })),
      rejection(s3.file("key").write("hello", { signal })),
    ]);
    expect(results.map(r => r.error.name)).toEqual(Array(results.length).fill("TimeoutError"));
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
    expect(() => s3.file("key").writer({ signal })).toThrow(signal.reason);
    await Bun.sleep(50);
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
    let partSeen = Promise.withResolvers<void>();
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
    controller.abort(new Error("stop"));
    const { error, elapsed } = await rejection(writer.end());
    expect(error).toBe(controller.signal.reason);
    expect(elapsed).toBeLessThan(MIN_ELAPSED_MS);
    const deadline = Date.now() + 5_000;
    while (requests.abort === 0 && Date.now() < deadline) await Bun.sleep(10);
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
    await Bun.sleep(50);
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
        const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open() {}, data() {} } });
        server.unref();
        const s3 = new Bun.S3Client({ accessKeyId: "k", secretAccessKey: "s", bucket: "b", region: "us-east-1", endpoint: "http://127.0.0.1:" + server.port });
        const controller = new AbortController();
        const promise = s3.stat("key", { signal: controller.signal }).then(() => "resolved", e => e === controller.signal.reason ? "aborted" : "other: " + e);
        setTimeout(() => controller.abort(), 50);
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
