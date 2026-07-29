import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// AbortMultipartUpload returns 204 No Content on success (AWS, MinIO, R2, Ceph).
// Previously the multipart rollback registered an Upload callback, which only
// accepts 200, so every 204 was classified as a failure and the abort was
// re-sent `retry` more times for each failed multipart upload. The same
// misclassification meant a 404 NoSuchUpload (an already-gone uploadId) also
// retried to exhaustion.

function fixture(abortHandler: string) {
  return `
const requests = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    await req.arrayBuffer();
    if (req.method === "POST" && url.search.startsWith("?uploads")) {
      requests.push("initiate");
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?>\\n' +
          "<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key>" +
          "<UploadId>up-1</UploadId></InitiateMultipartUploadResult>",
        { status: 200, headers: { "Content-Type": "application/xml" } },
      );
    }
    if (req.method === "PUT" && url.searchParams.has("partNumber")) {
      requests.push("part");
      // Fail every part so the writer gives up and rolls back.
      return new Response(
        '<?xml version="1.0" encoding="UTF-8"?>\\n' +
          "<Error><Code>InternalError</Code><Message>try again</Message></Error>",
        { status: 500, headers: { "Content-Type": "application/xml" } },
      );
    }
    if (req.method === "DELETE" && url.searchParams.has("uploadId")) {
      requests.push("abort");
      ${abortHandler}
    }
    requests.push(req.method + " " + url.pathname + url.search);
    return new Response(null, { status: 404 });
  },
});

const client = new Bun.S3Client({
  endpoint: "http://127.0.0.1:" + server.port,
  bucket: "b",
  accessKeyId: "AK",
  secretAccessKey: "SK",
  region: "us-east-1",
});

const writer = client.file("obj.bin").writer({
  partSize: 5 * 1024 * 1024,
  queueSize: 1,
  retry: 3,
});
writer.write(new Uint8Array(5 * 1024 * 1024));
writer.write(new Uint8Array(32));
let rejected = false;
try {
  await writer.end();
} catch {
  rejected = true;
}

// The in-flight rollback request keeps the event loop alive via its own
// KeepAlive ref, so once the rollback chain is done the process drains and
// beforeExit fires without any time-based wait.
server.unref();
let printed = false;
process.on("beforeExit", () => {
  if (printed) return;
  printed = true;
  console.log(JSON.stringify({
    rejected,
    aborts: requests.filter(r => r === "abort").length,
    requests,
  }));
  server.stop(true);
});
`;
}

const env = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

describe("S3 multipart rollback (AbortMultipartUpload)", () => {
  test.concurrent("sends exactly one abort when the server answers 204 No Content", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture(`return new Response(null, { status: 204 });`)],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ out: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
      out: {
        rejected: true,
        aborts: 1,
        // retry: 3 means 4 part attempts, then one rollback.
        requests: ["initiate", "part", "part", "part", "part", "abort"],
      },
      stderr: "",
      exitCode: 0,
    });
    expect(proc.signalCode).toBeNull();
  });

  test.concurrent("does not retry after 404 NoSuchUpload", async () => {
    const abortHandler = `return new Response(
        '<?xml version="1.0" encoding="UTF-8"?>\\n' +
          "<Error><Code>NoSuchUpload</Code>" +
          "<Message>The specified upload does not exist.</Message></Error>",
        { status: 404, headers: { "Content-Type": "application/xml" } },
      );`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture(abortHandler)],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ out: JSON.parse(stdout.trim()), stderr, exitCode }).toEqual({
      out: {
        rejected: true,
        aborts: 1,
        requests: ["initiate", "part", "part", "part", "part", "abort"],
      },
      stderr: "",
      exitCode: 0,
    });
    expect(proc.signalCode).toBeNull();
  });

  test.concurrent("still retries on a genuine 5xx failure", async () => {
    // 500 on abort is a real failure; best-effort rollback should retry.
    const abortHandler = `return new Response(
        '<?xml version="1.0" encoding="UTF-8"?>\\n' +
          "<Error><Code>InternalError</Code><Message>boom</Message></Error>",
        { status: 500, headers: { "Content-Type": "application/xml" } },
      );`;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture(abortHandler)],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const out = JSON.parse(stdout.trim());
    expect({ out, stderr, exitCode }).toEqual({
      out: {
        rejected: true,
        aborts: 4,
        requests: ["initiate", "part", "part", "part", "part", "abort", "abort", "abort", "abort"],
      },
      stderr: "",
      exitCode: 0,
    });
    expect(proc.signalCode).toBeNull();
  });
});
