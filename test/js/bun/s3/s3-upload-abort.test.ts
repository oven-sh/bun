import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// An upload that can never finish must be aborted on the server and released
// natively: the queued part buffers are freed, a started multipart upload gets
// an AbortMultipartUpload, and nothing keeps the event loop alive.
//
// The stub counts each S3 request and the child prints the counts at exit.
// `body` runs with `client` in scope and must leave the upload abandoned.
// The child then waits for `waitFor` before it runs `then`. With `gateCreate`,
// the stub holds the CreateMultipartUpload response until `then` ran. The stub answers
// AbortMultipartUpload with `abortStatus` (204, as S3 does, by default).
function fixture(opts: {
  body: string;
  waitFor: string;
  then?: string;
  gateCreate?: boolean;
  retry?: number;
  abortStatus?: number;
}) {
  return `
    const reqs = { create: 0, part: 0, complete: 0, abort: 0, put: 0 };
    const createGate = Promise.withResolvers();
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (req.method === "POST" && url.searchParams.has("uploads")) {
          reqs.create++;
          ${opts.gateCreate ? "await createGate.promise;" : ""}
          return new Response(
            "<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
            { headers: { "content-type": "application/xml" } },
          );
        }
        if (req.method === "PUT") {
          await req.arrayBuffer();
          if (url.searchParams.has("uploadId")) {
            reqs.part++;
            return new Response("", { headers: { ETag: '"etag"' } });
          }
          reqs.put++;
          return new Response("");
        }
        if (req.method === "DELETE") {
          reqs.abort++;
          return new Response("", { status: ${opts.abortStatus ?? 204} });
        }
        await req.text();
        reqs.complete++;
        return new Response('<CompleteMultipartUploadResult><ETag>"etag"</ETag></CompleteMultipartUploadResult>');
      },
    });
    // Only the abandoned upload may keep the process alive.
    server.unref();
    const client = new Bun.S3Client({
      endpoint: "http://127.0.0.1:" + server.port,
      bucket: "bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-east-1",
    });
    const partSize = 5 * 1024 * 1024;
    const opts = { partSize, queueSize: 2, retry: ${opts.retry ?? 0} };
    const deadline = Date.now() + 4_000;
    ${opts.body}
    while (Date.now() < deadline && !(${opts.waitFor})) {
      await Bun.sleep(10);
    }
    if (!(${opts.waitFor})) throw new Error("not reached: " + ${JSON.stringify(opts.waitFor)});
    ${opts.then ?? ""}
    createGate.resolve();
    process.on("exit", () => console.log(JSON.stringify(reqs)));
  `;
}

const env = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

async function run(opts: Parameters<typeof fixture>[0]) {
  using dir = tempDir("s3-upload-abort", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture(opts)],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  // A leaked upload pins the event loop, so the child never exits and the
  // test times out.
  const [stdout, stderr, exited] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exited };
}

// Uploads a stream that yields one full part, waits for `before`, then errors.
const failingStream = (before: string) => `
  let pulls = 0;
  const stream = new ReadableStream({
    async pull(controller) {
      if (pulls++ === 0) {
        controller.enqueue(new Uint8Array(partSize));
        return;
      }
      while (Date.now() < deadline && !(${before})) await Bun.sleep(10);
      controller.error(new Error("source failed"));
    },
  });
  const result = await client.write("key", new Response(stream), opts).then(
    () => "resolved",
    e => "rejected: " + e.message,
  );
  console.log(result);
`;

// The source stream errors after one full part, while the
// CreateMultipartUpload request is still in flight. The write rejects at
// once. When the Create response lands, the upload it names must be aborted.
test.concurrent("stream error while CreateMultipartUpload is in flight aborts the upload", async () => {
  expect(
    await run({
      body: failingStream(`true`),
      waitFor: `true`,
      then: `createGate.resolve(); while (Date.now() < deadline && reqs.abort === 0) await Bun.sleep(10);`,
      gateCreate: true,
    }),
  ).toEqual({
    stdout: `rejected: source failed\n{"create":1,"part":0,"complete":0,"abort":1,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});

// S3 answers AbortMultipartUpload with 204. A 404 means the store no longer has the upload.
// Both are final: the abort must not be sent again.
test.concurrent.each([204, 404])("AbortMultipartUpload answered with %d is not retried", async abortStatus => {
  expect(
    await run({ body: failingStream(`reqs.part === 1`), waitFor: `reqs.abort > 0`, retry: 3, abortStatus }),
  ).toEqual({
    stdout: `rejected: source failed\n{"create":1,"part":1,"complete":0,"abort":1,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});

// An `S3File.writer()` that is dropped before `end()` can never finish its
// upload. Once the wrapper is collected the upload is aborted and the process
// exits. `w` stays reachable until `collectWriter`: a GC before `waitFor` holds would abort early.
const droppedWriter = (writes: string) => `
  let finalized = 0;
  let w;
  const registry = new FinalizationRegistry(() => finalized++);
  (() => {
    w = client.file("key").writer(opts);
    registry.register(w, 1);
    ${writes}
  })();
`;
const collectWriter = `
  w = undefined;
  while (Date.now() < deadline && finalized === 0) {
    Bun.gc(true);
    await Bun.sleep(10);
  }
  console.log("finalized", finalized);
`;
const twoParts = droppedWriter(`w.write(new Uint8Array(6 * 1024 * 1024)); w.write(new Uint8Array(6 * 1024 * 1024));`);

test.concurrent(
  "dropped writer with uploaded parts aborts the multipart upload and lets the process exit",
  async () => {
    expect(await run({ body: twoParts, waitFor: `reqs.part === 2`, then: collectWriter })).toEqual({
      stdout: `finalized 1\n{"create":1,"part":2,"complete":0,"abort":1,"put":0}\n`,
      stderr: "",
      exited: 0,
    });
  },
);

// The Create response is held until the upload has failed. The only signal script gets for that
// is the dropped writer's pending `flush()`, which rejects.
test.concurrent("dropped writer collected while CreateMultipartUpload is in flight still aborts it", async () => {
  const body = `
    const flush = (() => {
      const w = client.file("key").writer(opts);
      w.write(new Uint8Array(6 * 1024 * 1024));
      w.write(new Uint8Array(6 * 1024 * 1024));
      return w.flush();
    })();
    let flushed;
    flush.then(
      () => (flushed = "flush resolved"),
      e => (flushed = "flush rejected: " + e.message + " (path " + e.path + ")"),
    );
  `;
  const then = `
    while (Date.now() < deadline && flushed === undefined) {
      Bun.gc(true);
      await Bun.sleep(10);
    }
    console.log(flushed);
  `;
  expect(await run({ body, waitFor: `reqs.create === 1`, then, gateCreate: true })).toEqual({
    stdout: `flush rejected: S3 writer was garbage collected before end() was called (path key)\n{"create":1,"part":0,"complete":0,"abort":1,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});

test.concurrent("dropped writer with only buffered bytes lets the process exit", async () => {
  expect(
    await run({ body: droppedWriter(`w.write(new Uint8Array(1000));`), waitFor: `true`, then: collectWriter }),
  ).toEqual({
    stdout: `finalized 1\n{"create":0,"part":0,"complete":0,"abort":0,"put":0}\n`,
    stderr: "",
    exited: 0,
  });
});
