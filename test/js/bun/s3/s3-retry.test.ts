import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The `retry` option (default 3) is documented as "number of retries" for S3
// operations. Before this fix only multipart part uploads honored it; every
// single-request verb (GET/HEAD/DELETE/LIST/one-part PUT) made exactly one
// attempt and rejected on the first 5xx, so a transient `503 SlowDown` or
// `500 InternalError` failed the call outright even with `retry: 5`.
//
// The S3 client does not honor NO_PROXY, so the fixture runs in a subprocess
// with proxy env cleared (like s3-connection-close.test.ts).

const envWithoutProxy = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

const verbs = {
  text: `s3.file("get-key").text()`,
  arrayBuffer: `s3.file("buf-key").arrayBuffer()`,
  exists: `s3.file("head-key").exists()`,
  stat: `s3.file("stat-key").stat()`,
  delete: `s3.delete("del-key")`,
  write: `s3.write("put-key", "hello")`,
  list: `s3.list()`,
} as const;

function fixture(op: keyof typeof verbs | "not-found", opts: { retry: number; failFirstN: number }) {
  return `
const slowDownBody = '<?xml version="1.0"?><Error><Code>SlowDown</Code><Message>Please reduce your request rate.</Message></Error>';
const listOkBody = '<?xml version="1.0"?><ListBucketResult><Name>bucket</Name><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>';
const notFoundBody = '<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>';

let attempts = 0;
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    attempts++;
    const url = new URL(req.url);
    await req.arrayBuffer();
    ${
      op === "not-found"
        ? `return new Response(notFoundBody, { status: 404, headers: { "Content-Type": "application/xml", "Connection": "close" } });`
        : `if (attempts <= ${opts.failFirstN}) {
      return new Response(slowDownBody, { status: 503, headers: { "Content-Type": "application/xml", "Connection": "close" } });
    }
    const headers = { "Content-Type": "application/xml", "ETag": '"etag"', "Connection": "close" };
    if (req.method === "HEAD") return new Response(null, { status: 200, headers: { ...headers, "Content-Length": "2" } });
    if (req.method === "DELETE") return new Response(null, { status: 204, headers });
    if (req.method === "GET" && url.search.includes("list-type=2"))
      return new Response(listOkBody, { status: 200, headers });
    if (req.method === "GET") return new Response("ok", { status: 200, headers });
    return new Response(null, { status: 200, headers });`
    }
  },
});
server.unref();

const s3 = new Bun.S3Client({
  accessKeyId: "test",
  secretAccessKey: "test",
  region: "us-east-1",
  bucket: "bucket",
  endpoint: "http://127.0.0.1:" + server.port,
  retry: ${opts.retry},
});

const result = await ${op === "not-found" ? `s3.file("missing").text()` : verbs[op]}.then(
  () => "resolved",
  e => "rejected:" + (e?.code ?? e?.name ?? "unknown"),
);
console.log(JSON.stringify({ result, attempts }));
server.stop(true);
`;
}

async function run(op: keyof typeof verbs | "not-found", opts: { retry: number; failFirstN: number }) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture(op, opts)],
    env: envWithoutProxy,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr.trim()).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim()) as { result: string; attempts: number };
}

describe("S3 retry option applies to single-request operations", () => {
  const verbNames = Object.keys(verbs) as (keyof typeof verbs)[];

  test.concurrent.each(verbNames)("%s() retries on 503 and resolves on the next attempt", async op => {
    expect(await run(op, { retry: 5, failFirstN: 1 })).toEqual({ result: "resolved", attempts: 2 });
  });

  test.concurrent.each(verbNames)("%s() rejects after retry attempts are exhausted", async op => {
    // HEAD responses carry no body, so exists()/stat() cannot surface the <Code> and report UnknownError.
    const code = op === "exists" || op === "stat" ? "UnknownError" : "SlowDown";
    expect(await run(op, { retry: 2, failFirstN: 10 })).toEqual({ result: `rejected:${code}`, attempts: 3 });
  });

  test.concurrent("retry: 0 means a single attempt and no retry", async () => {
    expect(await run("text", { retry: 0, failFirstN: 1 })).toEqual({ result: "rejected:SlowDown", attempts: 1 });
  });

  test.concurrent("404 is not retried", async () => {
    expect(await run("not-found", { retry: 5, failFirstN: 0 })).toEqual({ result: "rejected:NoSuchKey", attempts: 1 });
  });
});
