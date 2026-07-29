import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

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

type Options = {
  retry: number | "default";
  failFirstN: number;
  failStatus?: number;
  failCode?: string;
};

function fixture(op: keyof typeof verbs, opts: Options) {
  const failStatus = opts.failStatus ?? 503;
  const failCode = opts.failCode ?? "SlowDown";
  return `
const failBody = '<?xml version="1.0"?><Error><Code>${failCode}</Code><Message>mock failure</Message></Error>';
const listOkBody = '<?xml version="1.0"?><ListBucketResult><Name>bucket</Name><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>';

let attempts = 0;
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    attempts++;
    const url = new URL(req.url);
    await req.arrayBuffer();
    if (attempts <= ${opts.failFirstN}) {
      return new Response(failBody, { status: ${failStatus}, headers: { "Content-Type": "application/xml", "Connection": "close" } });
    }
    const headers = { "Content-Type": "application/xml", "ETag": '"etag"', "Connection": "close" };
    if (req.method === "HEAD") return new Response(null, { status: 200, headers: { ...headers, "Content-Length": "2" } });
    if (req.method === "DELETE") return new Response(null, { status: 204, headers });
    if (req.method === "GET" && url.search.includes("list-type=2"))
      return new Response(listOkBody, { status: 200, headers });
    if (req.method === "GET") return new Response("ok", { status: 200, headers });
    return new Response(null, { status: 200, headers });
  },
});
server.unref();

const s3 = new Bun.S3Client({
  accessKeyId: "test",
  secretAccessKey: "test",
  region: "us-east-1",
  bucket: "bucket",
  endpoint: "http://127.0.0.1:" + server.port,
  ${opts.retry === "default" ? "" : `retry: ${opts.retry},`}
});

const result = await ${verbs[op]}.then(
  () => "resolved",
  e => "rejected:" + (e?.code ?? e?.name ?? "unknown"),
);
console.log(JSON.stringify({ result, attempts }));
server.stop(true);
`;
}

async function run(op: keyof typeof verbs, opts: Options) {
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

  test.concurrent("default retry is 3 (4 total attempts) when the option is omitted", async () => {
    expect(await run("text", { retry: "default", failFirstN: 10 })).toEqual({
      result: "rejected:SlowDown",
      attempts: 4,
    });
  });

  test.concurrent("retry: 0 means a single attempt and no retry", async () => {
    expect(await run("text", { retry: 0, failFirstN: 1 })).toEqual({ result: "rejected:SlowDown", attempts: 1 });
  });

  for (const [status, code] of [
    [403, "AccessDenied"],
    [400, "InvalidRequest"],
    [404, "NoSuchKey"],
  ] as const) {
    test.concurrent(`${status} ${code} is not retried`, async () => {
      expect(await run("text", { retry: 5, failFirstN: 10, failStatus: status, failCode: code })).toEqual({
        result: `rejected:${code}`,
        attempts: 1,
      });
    });
  }

  test.concurrent("429 is retried", async () => {
    expect(await run("text", { retry: 5, failFirstN: 1, failStatus: 429, failCode: "TooManyRequests" })).toEqual({
      result: "resolved",
      attempts: 2,
    });
  });
});
