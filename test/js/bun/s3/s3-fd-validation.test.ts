import { afterAll, beforeAll, expect, test } from "bun:test";

// The S3 client sends through an ambient HTTP_PROXY even for loopback endpoints,
// so the upload below would never reach the local server in an environment that
// sets one. Same approach as test/js/bun/http/proxy.test.ts: assign "" (a delete
// does not reach the native env) for the duration of this file.
const PROXY_ENV_KEYS = ["NO_PROXY", "no_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"];
const savedProxyEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of PROXY_ENV_KEYS) {
    savedProxyEnv[key] = process.env[key];
    process.env[key] = "";
  }
});

afterAll(() => {
  for (const key of PROXY_ENV_KEYS) {
    process.env[key] = savedProxyEnv[key] ?? "";
  }
});

test("S3Client.write does not crash with out-of-range float as path", () => {
  expect(() => Bun.S3Client.write(-1.5379890021597998e308, "data")).toThrow();
  expect(() => Bun.S3Client.write(1e308, "data")).toThrow();
  expect(() => Bun.S3Client.write(Infinity, "data")).toThrow();
  expect(() => Bun.S3Client.write(-Infinity, "data")).toThrow();
  expect(() => Bun.S3Client.write(NaN, "data")).toThrow();
});

test("S3 file type option containing CR/LF or other control characters is not reflected into upload request headers", async () => {
  const seenRequests: { headers: Headers; url: string }[] = [];
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      seenRequests.push({ headers: req.headers, url: req.url });
      return new Response("", { status: 200 });
    },
  });

  const client = new Bun.S3Client({
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "eu-west-3",
    bucket: "my_bucket",
    endpoint: server.url.href,
  });

  // A `type` value embedding CR/LF is rejected outright at option-parsing time,
  // before any request is made, so it can never become extra request headers.
  expect(() => client.file("report.txt", { type: "text/plain\r\nx-amz-acl: public-read" })).toThrow(
    "type must not contain CR/LF or NUL characters",
  );

  // Other control characters in `type` must not be stored as the file's content
  // type, and must not leak into the outgoing object-storage request headers.
  const file = client.file("report.txt", { type: "text/plain\x0bx-amz-acl: public-read" });
  expect(file.type).not.toContain("\x0b");
  expect(file.type).not.toContain("public-read");
  await file.write("hello");

  expect(seenRequests.length).toBeGreaterThan(0);
  for (const seen of seenRequests) {
    expect(seen.headers.get("x-amz-acl")).toBeNull();
    expect(seen.headers.get("content-type") ?? "").not.toContain("public-read");
    expect(seen.headers.get("content-type") ?? "").not.toContain("\x0b");
  }

  // A legitimate content type still reaches the server unchanged.
  const before = seenRequests.length;
  await client.file("plain.txt", { type: "text/plain" }).write("hello");
  const legit = seenRequests.slice(before);
  expect(legit.length).toBeGreaterThan(0);
  expect(legit.some(seen => (seen.headers.get("content-type") ?? "").startsWith("text/plain"))).toBe(true);
  for (const seen of legit) {
    expect(seen.headers.get("x-amz-acl")).toBeNull();
  }
});
