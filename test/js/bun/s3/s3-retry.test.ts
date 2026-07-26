import { S3Client } from "bun";
import { describe, expect, test } from "bun:test";

// The `retry` option (default 3) is documented as "number of retries" for S3
// operations. Before this fix only multipart part uploads honored it; every
// single-request verb (GET/HEAD/DELETE/LIST/one-part PUT) made exactly one
// attempt and rejected on the first 5xx, so a transient `503 SlowDown` or
// `500 InternalError` failed the call outright even with `retry: 5`.

const slowDownBody = `<?xml version="1.0"?><Error><Code>SlowDown</Code><Message>Please reduce your request rate.</Message></Error>`;
const listOkBody = `<?xml version="1.0"?><ListBucketResult><Name>bucket</Name><KeyCount>0</KeyCount><IsTruncated>false</IsTruncated></ListBucketResult>`;

type Attempts = Map<string, number>;

function makeServer(attempts: Attempts, failFirstN: number) {
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const isList = req.method === "GET" && url.search.includes("list-type=2");
      const key = isList ? "LIST" : `${req.method} ${url.pathname}`;
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      // Drain the body so the client sees a clean response boundary.
      await req.arrayBuffer();
      if (n <= failFirstN) {
        return new Response(slowDownBody, {
          status: 503,
          headers: { "Content-Type": "application/xml", "Connection": "close" },
        });
      }
      const headers = { "Content-Type": "application/xml", "ETag": '"etag"', "Connection": "close" };
      if (req.method === "HEAD") return new Response(null, { status: 200, headers: { ...headers, "Content-Length": "2" } });
      if (req.method === "DELETE") return new Response(null, { status: 204, headers });
      if (req.method === "GET" && url.search.includes("list-type=2"))
        return new Response(listOkBody, { status: 200, headers });
      if (req.method === "GET") return new Response("ok", { status: 200, headers });
      // PUT
      return new Response(null, { status: 200, headers });
    },
  });
  server.unref();
  return server;
}

function makeClient(server: ReturnType<typeof Bun.serve>, retry: number) {
  return new S3Client({
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "us-east-1",
    bucket: "bucket",
    endpoint: `http://127.0.0.1:${server.port}`,
    retry,
  });
}

describe("S3 retry option applies to single-request operations", () => {
  const verbs: Array<[string, (s3: S3Client) => Promise<unknown>, string]> = [
    ["text()", s3 => s3.file("get-key").text(), "GET /bucket/get-key"],
    ["arrayBuffer()", s3 => s3.file("buf-key").arrayBuffer(), "GET /bucket/buf-key"],
    ["exists()", s3 => s3.file("head-key").exists(), "HEAD /bucket/head-key"],
    ["stat()", s3 => s3.file("stat-key").stat(), "HEAD /bucket/stat-key"],
    ["delete()", s3 => s3.delete("del-key"), "DELETE /bucket/del-key"],
    ["write() one-part", s3 => s3.write("put-key", "hello"), "PUT /bucket/put-key"],
    ["list()", s3 => s3.list(), "LIST"],
  ];

  test.concurrent.each(verbs)("%s retries on 503 and resolves on the next attempt", async (_name, op, key) => {
    const attempts: Attempts = new Map();
    using server = makeServer(attempts, 1);
    const s3 = makeClient(server, 5);
    // Should retry once and then succeed.
    await expect(op(s3)).resolves.toBeDefined();
    expect(attempts.get(key)).toBe(2);
  });

  test.concurrent.each(verbs)("%s rejects after retry attempts are exhausted", async (_name, op, key) => {
    const attempts: Attempts = new Map();
    using server = makeServer(attempts, 10);
    const s3 = makeClient(server, 2);
    // 1 initial attempt + 2 retries = 3 total, then rejects.
    await expect(op(s3)).rejects.toThrow();
    expect(attempts.get(key)).toBe(3);
  });

  test("retry: 0 means a single attempt and no retry", async () => {
    const attempts: Attempts = new Map();
    using server = makeServer(attempts, 1);
    const s3 = makeClient(server, 0);
    await expect(s3.file("no-retry").text()).rejects.toThrow();
    expect(attempts.get("GET /bucket/no-retry")).toBe(1);
  });

  test("404 is not retried", async () => {
    let attempts = 0;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        attempts++;
        await req.arrayBuffer();
        return new Response(
          `<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>`,
          { status: 404, headers: { "Content-Type": "application/xml", "Connection": "close" } },
        );
      },
    });
    server.unref();
    const s3 = makeClient(server, 5);
    await expect(s3.file("missing").text()).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});
