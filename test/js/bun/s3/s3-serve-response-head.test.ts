import { S3Client } from "bun";
import { expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";

// Minimal SigV4 query-auth verifier: recomputes X-Amz-Signature for the
// received method + path + query and compares it to the one in the URL.
// Real S3 endpoints (AWS, MinIO) reject any method that doesn't match the
// signed canonical request with 403 SignatureDoesNotMatch.
function verifySigV4(req: Request, secretKey: string): boolean {
  const url = new URL(req.url);
  const received = url.searchParams.get("X-Amz-Signature");
  const credential = url.searchParams.get("X-Amz-Credential");
  const amzDate = url.searchParams.get("X-Amz-Date");
  const signedHeaders = url.searchParams.get("X-Amz-SignedHeaders");
  if (!received || !credential || !amzDate || !signedHeaders) return false;

  const [, date, region, service] = credential.split("/");
  const scope = `${date}/${region}/${service}/aws4_request`;

  const params = [...url.searchParams.entries()]
    .filter(([k]) => k !== "X-Amz-Signature")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .sort()
    .join("&");

  const canonicalHeaders = `host:${req.headers.get("host")}\n`;
  const canonicalRequest = [req.method, url.pathname, params, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join(
    "\n",
  );
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
  const kDate = hmac("AWS4" + secretKey, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const expected = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return expected === received;
}

function makeMockS3(body: string) {
  const seen: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      seen.push(req.method);
      if (!verifySigV4(req, "testsecret")) {
        return new Response('<?xml version="1.0"?><Error><Code>SignatureDoesNotMatch</Code></Error>', {
          status: 403,
          headers: { "x-minio-error-code": "SignatureDoesNotMatch" },
        });
      }
      return new Response(req.method === "HEAD" ? null : body, {
        headers: { "content-length": String(body.length), "content-type": "text/plain" },
      });
    },
  });
  return { server, seen };
}

test("Bun.serve new Response(S3File): HEAD redirects to a HEAD-signed URL (not GET-signed)", async () => {
  const body = "hello bun\n";
  const { server: s3mock, seen } = makeMockS3(body);
  await using _s3mock = s3mock;

  const s3 = new S3Client({
    endpoint: `http://${s3mock.hostname}:${s3mock.port}`,
    accessKeyId: "testkey",
    secretAccessKey: "testsecret",
    bucket: "bkt",
    region: "us-east-1",
  });

  await using app = Bun.serve({
    port: 0,
    fetch: () => new Response(s3.file("obj.txt")),
  });

  const getRes = await fetch(`http://${app.hostname}:${app.port}/`);
  expect(getRes.status).toBe(200);
  expect(await getRes.text()).toBe(body);

  const headRes = await fetch(`http://${app.hostname}:${app.port}/`, { method: "HEAD" });
  expect(headRes.status).toBe(200);
  expect(headRes.headers.get("content-length")).toBe(String(body.length));

  expect(seen).toEqual(["GET", "HEAD"]);
});

test("Bun.serve new Response(S3File): HEAD redirect Location is signed for HEAD", async () => {
  const s3 = new S3Client({
    endpoint: "http://127.0.0.1:1",
    accessKeyId: "testkey",
    secretAccessKey: "testsecret",
    bucket: "bkt",
    region: "us-east-1",
  });

  await using app = Bun.serve({
    port: 0,
    fetch: () => new Response(s3.file("obj.txt")),
  });

  const [getRes, headRes] = await Promise.all([
    fetch(`http://${app.hostname}:${app.port}/`, { redirect: "manual" }),
    fetch(`http://${app.hostname}:${app.port}/`, { method: "HEAD", redirect: "manual" }),
  ]);
  expect(getRes.status).toBe(302);
  expect(headRes.status).toBe(302);

  const asReq = (loc: string, method: string) => new Request(loc, { method, headers: { host: new URL(loc).host } });

  const getLoc = getRes.headers.get("location")!;
  expect(verifySigV4(asReq(getLoc, "GET"), "testsecret")).toBe(true);
  expect(verifySigV4(asReq(getLoc, "HEAD"), "testsecret")).toBe(false);

  const headLoc = headRes.headers.get("location")!;
  expect(verifySigV4(asReq(headLoc, "HEAD"), "testsecret")).toBe(true);
  expect(verifySigV4(asReq(headLoc, "GET"), "testsecret")).toBe(false);
});

test("Bun.serve new Response(S3File): async handler HEAD redirects to a HEAD-signed URL", async () => {
  const body = "hello bun\n";
  const { server: s3mock, seen } = makeMockS3(body);
  await using _s3mock = s3mock;

  const s3 = new S3Client({
    endpoint: `http://${s3mock.hostname}:${s3mock.port}`,
    accessKeyId: "testkey",
    secretAccessKey: "testsecret",
    bucket: "bkt",
    region: "us-east-1",
  });

  await using app = Bun.serve({
    port: 0,
    fetch: async () => {
      await Bun.sleep(0);
      return new Response(s3.file("obj.txt"));
    },
  });

  const headRes = await fetch(`http://${app.hostname}:${app.port}/`, { method: "HEAD" });
  expect(headRes.status).toBe(200);
  expect(seen).toEqual(["HEAD"]);
});
