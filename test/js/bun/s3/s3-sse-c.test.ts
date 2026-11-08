import { S3Client, type S3Options } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { serve } from "s3-server";

const ALGORITHM = "x-amz-server-side-encryption-customer-algorithm";
const KEY = "x-amz-server-side-encryption-customer-key";
const KEY_MD5 = "x-amz-server-side-encryption-customer-key-md5";
const SIGNED = `${ALGORITHM};${KEY};${KEY_MD5}`;

const key = new Uint8Array(32).map((_, i) => i * 7 + 1);
const keyBase64 = Buffer.from(key).toString("base64");
const keyMd5Base64 = new Bun.CryptoHasher("md5").update(key).digest("base64");
const sse = { type: "customer", algorithm: "AES256", key } as const;

const s3Options: S3Options = {
  accessKeyId: "test",
  secretAccessKey: "test",
  region: "eu-west-3",
  bucket: "my_bucket",
};

/** An HTTP server that records the headers of each request and answers 200. */
function captureServer() {
  const requests: { method: string; url: string; headers: Headers }[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      requests.push({ method: req.method, url: req.url, headers: req.headers });
      const url = new URL(req.url);
      if (url.searchParams.has("list-type")) {
        return new Response("<ListBucketResult><KeyCount>0</KeyCount></ListBucketResult>", {
          headers: { "Content-Type": "application/xml" },
        });
      }
      return new Response("content", { headers: { "Content-Type": "text/plain", etag: '"x"' } });
    },
  });
  return { server, requests, [Symbol.dispose]: () => server.stop(true) };
}

function expectSseHeaders(headers: Headers) {
  expect(headers.get(ALGORITHM)).toBe("AES256");
  expect(headers.get(KEY)).toBe(keyBase64);
  expect(headers.get(KEY_MD5)).toBe(keyMd5Base64);
  expect(headers.get("authorization")).toMatch(new RegExp(`SignedHeaders=[^,]*x-amz-security-token;${SIGNED}`));
}

function expectNoSseHeaders(headers: Headers) {
  expect(headers.get(ALGORITHM)).toBeNull();
  expect(headers.get(KEY)).toBeNull();
  expect(headers.get(KEY_MD5)).toBeNull();
  expect(headers.get("authorization")).not.toInclude("x-amz-server-side-encryption");
}

describe("s3 - SSE-C", () => {
  describe("sends the three headers, signed", () => {
    const cases: [string, (client: S3Client) => Promise<unknown>, string][] = [
      ["write (PUT)", client => client.write("file.txt", "content"), "PUT"],
      ["text (GET)", client => client.file("file.txt").text(), "GET"],
      ["slice (ranged GET)", client => client.file("file.txt").slice(1, 3).text(), "GET"],
      ["stream (GET)", client => client.file("file.txt").stream().text(), "GET"],
      ["stat (HEAD)", client => client.file("file.txt").stat(), "HEAD"],
    ];
    for (const [name, op, method] of cases) {
      it(`on ${name}`, async () => {
        using capture = captureServer();
        // A session token shows that the signed header list stays in byte order.
        const client = new S3Client({ ...s3Options, endpoint: capture.server.url.href, sessionToken: "tok", sse });
        await op(client);
        expect(capture.requests).toHaveLength(1);
        expect(capture.requests[0].method).toBe(method);
        expectSseHeaders(capture.requests[0].headers);
      });
    }

    it("per file, over a client without the option", async () => {
      using capture = captureServer();
      const client = new S3Client({ ...s3Options, endpoint: capture.server.url.href, sessionToken: "tok" });
      await client.file("file.txt", { sse }).text();
      await client.file("plain.txt").text();
      expect(capture.requests).toHaveLength(2);
      expectSseHeaders(capture.requests[0].headers);
      expectNoSseHeaders(capture.requests[1].headers);
    });

    it("with the key as base64", async () => {
      using capture = captureServer();
      await S3Client.file("file.txt", {
        ...s3Options,
        endpoint: capture.server.url.href,
        sessionToken: "tok",
        sse: { type: "customer", key: keyBase64 },
      }).text();
      expectSseHeaders(capture.requests[0].headers);
    });

    it("through fetch(s3://)", async () => {
      using capture = captureServer();
      const s3 = { ...s3Options, endpoint: capture.server.url.href, sessionToken: "tok", sse };
      await fetch("s3://my_bucket/file.txt", { s3 }).then(r => r.text());
      expectSseHeaders(capture.requests[0].headers);
    });
  });

  describe("does not send the headers", () => {
    it("on delete and list", async () => {
      using capture = captureServer();
      const client = new S3Client({ ...s3Options, endpoint: capture.server.url.href, sse });
      await client.delete("file.txt");
      await client.list();
      expect(capture.requests.map(r => r.method)).toEqual(["DELETE", "GET"]);
      for (const request of capture.requests) expectNoSseHeaders(request.headers);
    });

    it("without the option", async () => {
      using capture = captureServer();
      await S3Client.file("file.txt", { ...s3Options, endpoint: capture.server.url.href }).write("content");
      expectNoSseHeaders(capture.requests[0].headers);
    });
  });

  describe("presign", () => {
    it("signs the three headers and keeps the key out of the URL", () => {
      const client = new S3Client({ ...s3Options, endpoint: "https://s3.example.com", sse });
      for (const method of ["GET", "PUT", "HEAD"] as const) {
        const url = new URL(client.presign("file.txt", { method }));
        expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(`host;${SIGNED}`);
        expect(url.href).not.toInclude(keyBase64);
        expect(url.href).not.toInclude("customer-key=");
      }
    });

    it("per call", () => {
      const client = new S3Client({ ...s3Options, endpoint: "https://s3.example.com" });
      const url = new URL(client.presign("file.txt", { sse }));
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe(`host;${SIGNED}`);
    });

    it("signs only host without the option", () => {
      const client = new S3Client({ ...s3Options, endpoint: "https://s3.example.com" });
      const url = new URL(client.presign("file.txt"));
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    });
  });

  describe("option validation", () => {
    const make = (sse: unknown) => () => new S3Client({ ...s3Options, sse: sse as any });

    it("rejects a key that is not 32 bytes", () => {
      expect(make({ type: "customer", key: new Uint8Array(31) })).toThrow("sse.key must be 32 bytes");
      expect(make({ type: "customer", key: new Uint8Array(33) })).toThrow("sse.key must be 32 bytes");
      expect(make({ type: "customer", key: Buffer.from(new Uint8Array(16)).toString("base64") })).toThrow(
        "sse.key must be 32 bytes",
      );
      expect(make({ type: "customer", key: "not base64 at all!" })).toThrow("sse.key must be 32 bytes");
    });

    it("rejects a key of another type", () => {
      expect(make({ type: "customer", key: 42 })).toThrow('The "sse.key" argument must be of type');
      expect(make({ type: "customer" })).toThrow("sse.key is required");
    });

    it("rejects another type or algorithm", () => {
      expect(make({ type: "kms", key })).toThrow('sse.type must be "customer"');
      expect(make({ key })).toThrow('sse.type must be "customer"');
      expect(make({ type: "customer", algorithm: "AES128", key })).toThrow('sse.algorithm must be "AES256"');
      expect(make("customer")).toThrow('The "sse" argument must be of type object');
    });

    it("accepts an ArrayBuffer and a Buffer", () => {
      expect(make({ type: "customer", key: key.buffer })).not.toThrow();
      expect(make({ type: "customer", key: Buffer.from(key) })).not.toThrow();
    });
  });

  it("redacts the key in the inspect output", () => {
    const client = new S3Client({ ...s3Options, sse });
    const output = Bun.inspect(client);
    expect(output).toInclude('sse: { type: "customer", algorithm: "AES256", key: "[REDACTED]" }');
    expect(output).not.toInclude(keyBase64);
    expect(output).not.toInclude(keyMd5Base64);
  });

  it("new Response(s3File) refuses to redirect to an object that uses SSE-C", () => {
    const client = new S3Client({ ...s3Options, endpoint: "https://s3.example.com", sse });
    expect(() => new Response(client.file("file.txt"))).toThrow("cannot redirect to an object that uses SSE-C");
  });

  describe("against an S3 server that checks the key", () => {
    // The in-repo S3 server refuses SSE-C over plain HTTP, as S3 does, so it
    // needs TLS. The client runs in a child process that accepts the test
    // certificate.
    async function run(script: string) {
      await using server = serve({ tls, buckets: ["buntest"] });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script, JSON.stringify(server.clientOptions("buntest")), keyBase64],
        env: { ...bunEnv, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      return { output: JSON.parse(stdout), requests: server.requests };
    }

    const prelude = `
      const options = JSON.parse(process.argv[1]);
      const key = Buffer.from(process.argv[2], "base64");
      const sse = { type: "customer", key };
      const client = new Bun.S3Client({ ...options, sse });
      const code = e => e?.code ?? String(e);
    `;

    it("writes, reads and stats an object, and refuses the wrong key", async () => {
      const { output, requests } = await run(`${prelude}
        await client.write("secret.txt", "top secret");
        const text = await client.file("secret.txt").text();
        const size = (await client.stat("secret.txt")).size;
        const sliced = await client.file("secret.txt").slice(4).text();

        const otherKey = Buffer.from(key); otherKey[0] ^= 1;
        const wrongKey = await client.file("secret.txt", { sse: { type: "customer", key: otherKey } }).text().then(() => "ok", code);
        const plain = new Bun.S3Client(options);
        const noKey = await plain.file("secret.txt").text().then(() => "ok", code);
        // A HEAD response has no body, so there is no error code to read.
        const noKeyStat = await plain.stat("secret.txt").then(() => "ok", () => "error");
        console.log(JSON.stringify({ text, size, sliced, wrongKey, noKey, noKeyStat }));
      `);
      expect(output).toEqual({
        text: "top secret",
        size: 10,
        sliced: "secret",
        wrongKey: "AccessDenied",
        noKey: "InvalidRequest",
        noKeyStat: "error",
      });
      expect(requests.map(r => [r.operation, r.status, r.errorCode])).toEqual([
        ["PutObject", 200, undefined],
        ["GetObject", 200, undefined],
        ["HeadObject", 200, undefined],
        ["GetObject", 206, undefined],
        ["GetObject", 403, "AccessDenied"],
        ["GetObject", 400, "InvalidRequest"],
        ["HeadObject", 400, "InvalidRequest"],
      ]);
    });

    it("sends the key on every leg of a multipart upload", async () => {
      const partSize = 5 * 1024 * 1024;
      const { output, requests } = await run(`${prelude}
        // One part size plus 1 KiB so the writer takes the multipart path instead of a single PUT.
        const body = Buffer.alloc(${partSize} + 1024, "x");
        const writer = client.file("big.bin").writer({ partSize: ${partSize} });
        writer.write(body);
        await writer.end();
        const back = await client.file("big.bin").bytes();
        console.log(JSON.stringify({ same: Buffer.compare(body, back) === 0, size: back.length }));
      `);
      expect(output).toEqual({ same: true, size: partSize + 1024 });
      const legs = requests.map(r => r.operation);
      expect(legs).toEqual([
        "CreateMultipartUpload",
        "UploadPart",
        "UploadPart",
        "CompleteMultipartUpload",
        "GetObject",
      ]);
      for (const request of requests) {
        expect(request.status).toBe(200);
        expect(request.headers.get(KEY)).toBe(keyBase64);
        expect(request.headers.get(KEY_MD5)).toBe(keyMd5Base64);
      }
    });
  });
});
