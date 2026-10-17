// A streaming multipart upload buffers bytes until it has a part, then hands
// that part the bytes to send. When the buffer held exactly one part it handed
// the part the buffer's own allocation and gave the buffer up only after the
// part's request had been started, so a request that failed inside the enqueue
// left two owners of those bytes: the part, which the failure frees, and the
// local buffer, freed again when the error unwinds.
//
// terminate() is what makes the enqueue fail that way. The S3 client sends
// nothing new for a VM that is stopping, so it fails the request in place, and
// the upload reports that failure to its promise. Each worker below starts its
// uploads and is terminated as its first parts are being enqueued. A run that
// frees a part's bytes twice aborts the process under ASAN, so a clean exit is
// the check.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The terminate has to land while a worker enqueues a part, so each worker
// starts several uploads and several workers run at once.
const WORKERS = 4;
const UPLOADS_PER_WORKER = 8;
// The minimum S3 part size. One chunk is one part, so the first chunk of each
// upload fills the buffer with exactly one part.
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
      // Terminate as soon as this worker reports that its uploads are started.
      // A worker that fails before that fails the run instead of hanging it.
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

test("terminate() while a multipart upload enqueues a part frees the part's bytes once", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", host],
    env: {
      ...bunEnv,
      // An inherited proxy would take the requests away from the loopback
      // stand-in.
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      ALL_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
      all_proxy: undefined,
      // An upload still open when its worker goes is not freed (#39692). That
      // leak is not what this checks, and LeakSanitizer would report it.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr: stderr.trim() }).toEqual({ stdout: "ok", stderr: "" });
  expect(exitCode).toBe(0);
});
