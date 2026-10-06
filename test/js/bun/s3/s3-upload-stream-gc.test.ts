import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// Once a streaming S3 upload starts, the only thing that refers to the source
// stream is the native multipart upload. A GC while the upload is parked on
// part backpressure must not collect the stream pump: the write must still
// settle instead of hanging or crashing.
//
// `makeStream` defines `makeStream()`. `upload` is an expression that starts
// one upload with `key` and `opts` in scope and evaluates to its promise.
function fixture(makeStream: string, upload: string) {
  return `
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
          await req.arrayBuffer();
          // The client waits for this part to finish before it reads more of
          // the stream. Nothing in JS refers to the stream at this point.
          Bun.gc(true);
          return new Response("", { headers: { ETag: '"etag"' } });
        }
        await req.text();
        return new Response(
          '<CompleteMultipartUploadResult><ETag>"etag-1"</ETag></CompleteMultipartUploadResult>',
          { headers: { "content-type": "application/xml" } },
        );
      },
    });
    const credentials = {
      endpoint: "http://127.0.0.1:" + server.port,
      bucket: "bucket",
      accessKeyId: "key",
      secretAccessKey: "secret",
      region: "us-east-1",
    };
    const client = new Bun.S3Client(credentials);
    const partSize = 5 * 1024 * 1024;
    const chunk = new Uint8Array(64 * 1024).fill(97);
    const chunkCount = 2 * (partSize / chunk.byteLength) + 1;
    await Bun.write("source.bin", new Uint8Array(chunkCount * chunk.byteLength).fill(97));
    ${makeStream}
    const results = await Promise.all(
      [1, 2].map(queueSize => {
        const key = "key-" + queueSize;
        const opts = { partSize, queueSize, retry: 0 };
        return (${upload}).then(() => "ok", e => "error:" + e.message);
      }),
    );
    console.log(results.join(" "));
    server.stop(true);
  `;
}

// Everything is enqueued up front, so the pump parks with an unwritten batch tail.
const eagerStream = `
  function makeStream() {
    return new ReadableStream({
      start(controller) {
        for (let i = 0; i < chunkCount; i++) controller.enqueue(chunk);
        controller.close();
      },
    });
  }
`;

// Pulled one chunk at a time.
const pulledStream = (tail: string) => `
  function makeStream() {
    let sent = 0;
    return new ReadableStream({
      pull(controller) {
        if (sent === chunkCount) {
          ${tail}
          return;
        }
        controller.enqueue(chunk);
        sent++;
      },
    });
  }
`;

const env = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

async function run(makeStream: string, upload: string) {
  using dir = tempDir("s3-upload-stream-gc", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture(makeStream, upload)],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: normalizeBunSnapshot(stdout), stderr: normalizeBunSnapshot(stderr), exitCode };
}

const ok = {
  exitCode: 0,
  stderr: "",
  stdout: "ok ok",
};

test.concurrent("S3Client.write(key, new Response(stream)) survives GC during backpressure", async () => {
  expect(await run(eagerStream, `client.write(key, new Response(makeStream()), opts)`)).toEqual(ok);
});

test.concurrent("S3Client.write(key, new Request(url, { body: stream })) survives GC during backpressure", async () => {
  expect(
    await run(
      pulledStream("controller.close();"),
      `client.write(key, new Request("http://localhost/", { method: "PUT", body: makeStream() }), opts)`,
    ),
  ).toEqual(ok);
});

test.concurrent("fetch(s3://, { method: PUT, body: stream }) survives GC during backpressure", async () => {
  expect(
    await run(
      pulledStream("controller.close();"),
      `fetch("s3://bucket/" + key, { method: "PUT", body: makeStream(), s3: { ...credentials, ...opts } })`,
    ),
  ).toEqual(ok);
});

test.concurrent("s3file.write(Bun.file(path)) survives GC during backpressure", async () => {
  // The file stream is created inside bun. JS never holds a reference to it.
  expect(await run("", `client.file(key, opts).write(Bun.file("source.bin"))`)).toEqual(ok);
});

test.concurrent("S3 upload rejects with a stream error raised after GC during backpressure", async () => {
  expect(
    await run(
      pulledStream(`controller.error(new Error("stream failed"));`),
      `client.write(key, new Response(makeStream()), opts)`,
    ),
  ).toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "error:stream failed error:stream failed",
  });
});
