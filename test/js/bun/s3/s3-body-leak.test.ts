import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// S3 file body methods (.text() / .json() / .arrayBuffer() / .bytes() /
// .formData()) must not leak the downloaded body.
//
// On a successful download, S3HttpSimpleTask moves ownership of its heap
// response_buffer into the S3DownloadResult passed to the callback.
// S3BlobDownloadTask.onS3DownloadResolved forwards the body's bytes to the
// to*WithBytes handler via doReadFromS3's wrapper. The wrapper must use the
// `.temporary` lifetime so the handler frees (or adopts) the allocation; the
// S3 Blob Store only holds path/credentials and cannot free it via `.clone`.
//
// With the leak, each call orphaned a buffer the size of the object. Downloading
// a 1 MiB object 50 times grew RSS by ~50 MiB and never released it.
//
// Uses a local Bun.serve as a mock S3 endpoint so this runs without credentials.

const fixture = /* js */ `
  const { S3Client } = require("bun");

  const method = process.env.S3_BODY_LEAK_METHOD;
  const payloadSize = 1024 * 1024; // 1 MiB
  const filler = Buffer.alloc(payloadSize - 8, "a").toString("latin1");
  // Valid JSON; also accepted by application/x-www-form-urlencoded parsing
  // (no '=' present, so the whole body becomes a single key with empty value).
  const body = '{"x":"' + filler + '"}';

  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const s3 = new S3Client({
    accessKeyId: "test",
    secretAccessKey: "test",
    endpoint: "http://127.0.0.1:" + server.port,
    bucket: "test",
  });

  async function readOnce() {
    switch (method) {
      case "arrayBuffer": {
        const v = await s3.file("key").arrayBuffer();
        if (v.byteLength !== body.length) throw new Error("bad arrayBuffer length: " + v.byteLength);
        break;
      }
      case "bytes": {
        const v = await s3.file("key").bytes();
        if (v.byteLength !== body.length) throw new Error("bad bytes length: " + v.byteLength);
        break;
      }
      case "text": {
        const v = await s3.file("key").text();
        if (v.length !== body.length) throw new Error("bad text length: " + v.length);
        break;
      }
      case "json": {
        const v = await s3.file("key").json();
        if (v.x.length !== body.length - 8) throw new Error("bad json length");
        break;
      }
      case "formData": {
        const f = s3.file("key", { type: "application/x-www-form-urlencoded" });
        const v = await f.formData();
        // '{"x":"aaa..."}' parsed as urlencoded yields key '{"x":"aaa..."}' with value ''.
        const [entry] = v.keys();
        if (entry.length !== body.length) throw new Error("bad formData length: " + entry.length);
        break;
      }
      default:
        throw new Error("unknown method: " + method);
    }
  }

  async function settle() {
    // External strings / ArrayBuffers need their finalizers to run before
    // the backing allocation is released; cycle GC a few times.
    for (let i = 0; i < 4; i++) {
      Bun.gc(true);
      await Bun.sleep(10);
    }
  }

  const iterations = 50;

  // Warmup runs the same number of iterations as the measured phase so that
  // allocator segments, the HTTP connection pool, and JIT state are already
  // sized for steady state when the baseline sample is taken. If the body is
  // being freed, the measured phase reuses the same segments and growth is
  // near zero; if it leaks, the measured phase adds another ~iterations MiB.
  for (let i = 0; i < iterations; i++) await readOnce();
  await settle();
  const baseline = process.memoryUsage.rss();

  for (let i = 0; i < iterations; i++) await readOnce();
  await settle();
  const after = process.memoryUsage.rss();

  const growthMiB = (after - baseline) / 1024 / 1024;
  process.stdout.write(JSON.stringify({ method, iterations, growthMiB }));
  server.stop(true);
`;

describe.concurrent("s3 body methods do not leak the downloaded buffer", () => {
  const env = {
    ...bunEnv,
    // S3 download picks up HTTP(S)_PROXY from the environment without
    // checking NO_PROXY for the endpoint host. Clear them so the request
    // goes straight to our local mock server.
    HTTP_PROXY: undefined,
    http_proxy: undefined,
    HTTPS_PROXY: undefined,
    https_proxy: undefined,
  };

  for (const method of ["arrayBuffer", "bytes", "text", "json", "formData"] as const) {
    test(
      method,
      async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "--smol", "-e", fixture],
          env: { ...env, S3_BODY_LEAK_METHOD: method },
          stdout: "pipe",
          stderr: "pipe",
        });

        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect(stderr).toBe("");
        const { iterations, growthMiB } = JSON.parse(stdout);
        // When leaking, growth is ~`iterations` MiB (one 1 MiB buffer per call).
        // When fixed, the buffer is reused by the allocator and growth stays
        // near zero. Allow generous slack for allocator / GC noise.
        expect(growthMiB).toBeLessThan(iterations / 2);
        expect(exitCode).toBe(0);
      },
      60_000,
    );
  }
});
