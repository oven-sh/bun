import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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
    env: {
      ...bunEnv,
      // An inherited proxy would take the requests away from the loopback sink.
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      ALL_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
      all_proxy: undefined,
      // ASAN's quarantine pins freed blocks and keeps RSS at peak.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
        .filter(Boolean)
        .join(":"),
    },
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
