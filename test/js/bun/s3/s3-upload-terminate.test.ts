import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The S3 client fails new requests synchronously once the VM is shutting down. terminate() has to land while a worker
// is enqueuing a part, so several workers each start several uploads.
const WORKERS = 4;
const UPLOADS_PER_WORKER = 8;
// The minimum S3 part size. Each upload's first chunk is exactly one part.
const PART_SIZE = 5 * 1024 * 1024;

const worker = /* js */ `
  const { parentPort, workerData } = require("node:worker_threads");
  const client = new Bun.S3Client({
    endpoint: workerData.endpoint,
    bucket: "bucket",
    accessKeyId: "key",
    secretAccessKey: "secret",
    region: "us-east-1",
  });
  const chunk = new Uint8Array(${PART_SIZE}).fill(97);
  for (let i = 0; i < ${UPLOADS_PER_WORKER}; i++) {
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(chunk); } });
    client
      .write(workerData.key + "-" + i, new Response(stream), { partSize: ${PART_SIZE}, queueSize: 1, retry: 0 })
      .catch(() => {});
  }
  parentPort.postMessage("started");
`;

const host = /* js */ `
  const { Worker } = require("node:worker_threads");
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.searchParams.has("uploads")) {
        return new Response(
          "<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
          { headers: { "content-type": "application/xml" } },
        );
      }
      if (req.method === "PUT") {
        try { await req.arrayBuffer(); } catch {}
        return new Response("", { headers: { ETag: '"etag"' } });
      }
      try { await req.text(); } catch {}
      return new Response(
        '<CompleteMultipartUploadResult><ETag>"etag-1"</ETag></CompleteMultipartUploadResult>',
        { headers: { "content-type": "application/xml" } },
      );
    },
  });
  await Promise.all(
    Array.from({ length: ${WORKERS} }, (_, i) => {
      const w = new Worker(${JSON.stringify(worker)}, {
        eval: true,
        workerData: { endpoint: server.url.origin, key: "key-" + i },
      });
      return new Promise((resolve, reject) => {
        w.once("message", resolve);
        w.once("error", reject);
        w.once("exit", code => reject(new Error("worker exited with code " + code + " before it started its uploads")));
      }).then(() => w.terminate());
    }),
  ).catch(error => {
    console.error(error);
    process.exit(1);
  });
  server.stop(true);
  console.log("ok");
`;

test("terminate() while a multipart upload enqueues a part doesn't double free the part", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", host],
    env: {
      ...bunEnv,
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      ALL_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
      all_proxy: undefined,
      // Uploads still open when their worker exits are never freed, and LeakSanitizer would report them.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr: stderr.trim() }).toEqual({ stdout: "ok", stderr: "" });
  expect(exitCode).toBe(0);
});
