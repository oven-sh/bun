import { S3Client, type S3Options } from "bun";
import { describe, expect, it } from "bun:test";
import { createHash, createHmac } from "crypto";

// Content-Type is sent on every S3 upload. Some S3 implementations (Ceph
// RadosGW) reject a request that carries a Content-Type header which is not
// part of SignedHeaders. The server below recomputes the SigV4 signature from
// the headers it receives, so a header that is sent but not signed, or signed
// with a different value, fails the check.

const credentials: S3Options = {
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  region: "us-east-1",
  bucket: "bucket",
};

interface Seen {
  method: string;
  contentType: string | null;
  signedHeaders: string[];
  signatureMatches: boolean;
}

// SigV4 "Trimall": servers hash header values with outer whitespace removed
// and inner runs collapsed to one space.
function trimall(value: string): string {
  return value.trim().replace(/[ \t]+/g, " ");
}

function verifySigV4(req: Request, body: string): Seen {
  const url = new URL(req.url);
  const authorization = req.headers.get("authorization")!;
  const signedHeaders = authorization.match(/SignedHeaders=([^,]*)/)![1].split(";");
  const signature = authorization.match(/Signature=([0-9a-f]+)/)![1];
  const amzDate = req.headers.get("x-amz-date")!;
  const day = amzDate.slice(0, 8);
  const contentHash = req.headers.get("x-amz-content-sha256")!;

  const canonicalHeaders = signedHeaders.map(name => `${name}:${trimall(req.headers.get(name)!)}\n`).join("");
  const canonicalRequest = [
    req.method,
    url.pathname,
    url.search.slice(1),
    canonicalHeaders,
    signedHeaders.join(";"),
    contentHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    `${day}/${credentials.region}/s3/aws4_request`,
    // Header values are byte strings. Hash the bytes the server received, not
    // a UTF-8 re-encoding of them.
    createHash("sha256").update(Buffer.from(canonicalRequest, "latin1")).digest("hex"),
  ].join("\n");
  const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();
  const signingKey = hmac(
    hmac(hmac(hmac("AWS4" + credentials.secretAccessKey, day), credentials.region), "s3"),
    "aws4_request",
  );
  const expected = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    method: req.method,
    contentType: req.headers.get("content-type"),
    signedHeaders,
    signatureMatches: signature === expected,
  };
}

function startServer() {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      seen.push(verifySigV4(req, await req.text()));
      if (req.method === "POST" && new URL(req.url).searchParams.has("uploads")) {
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><UploadId>upload-id</UploadId></InitiateMultipartUploadResult>`,
          { status: 200 },
        );
      }
      return new Response("", { status: 200, headers: { etag: '"etag"' } });
    },
  });
  return { server, seen };
}

describe.concurrent("s3 content-type signing", () => {
  it("signs the Content-Type derived from the key extension", async () => {
    const { server, seen } = startServer();
    using _ = server;
    const client = new S3Client({ ...credentials, endpoint: server.url.href });

    await client.write("a.html", "x");

    expect(seen).toEqual([
      {
        method: "PUT",
        contentType: "text/html;charset=utf-8",
        signedHeaders: ["content-type", "host", "x-amz-content-sha256", "x-amz-date"],
        signatureMatches: true,
      },
    ]);
  });

  it("signs an explicit type together with the other content-* headers", async () => {
    const { server, seen } = startServer();
    using _ = server;
    const client = new S3Client({ ...credentials, endpoint: server.url.href });

    await client.write("b", "x", {
      type: "image/png",
      contentDisposition: "inline",
      contentEncoding: "identity",
    });

    expect(seen).toEqual([
      {
        method: "PUT",
        contentType: "image/png",
        signedHeaders: [
          "content-disposition",
          "content-encoding",
          "content-type",
          "host",
          "x-amz-content-sha256",
          "x-amz-date",
        ],
        signatureMatches: true,
      },
    ]);
  });

  it("collapses whitespace in the type so the wire value matches the signed value", async () => {
    const { server, seen } = startServer();
    using _ = server;
    const client = new S3Client({ ...credentials, endpoint: server.url.href });

    await client.write("h", "x", { type: "  text/html;   charset=utf-8  " });
    await client.write("i", "x", { type: "a/b;    c=d" });

    expect(seen).toEqual([
      {
        method: "PUT",
        contentType: "text/html; charset=utf-8",
        signedHeaders: ["content-type", "host", "x-amz-content-sha256", "x-amz-date"],
        signatureMatches: true,
      },
      {
        method: "PUT",
        contentType: "a/b; c=d",
        signedHeaders: ["content-type", "host", "x-amz-content-sha256", "x-amz-date"],
        signatureMatches: true,
      },
    ]);
  });

  it("signs the Content-Type on S3File.write and on a writer", async () => {
    const { server, seen } = startServer();
    using _ = server;
    const client = new S3Client({ ...credentials, endpoint: server.url.href });

    await client.file("c.txt").write("x");
    const writer = client.file("d.png").writer();
    writer.write("x");
    await writer.end();

    expect(seen).toEqual([
      {
        method: "PUT",
        contentType: "text/plain;charset=utf-8",
        signedHeaders: ["content-type", "host", "x-amz-content-sha256", "x-amz-date"],
        signatureMatches: true,
      },
      {
        method: "PUT",
        contentType: "image/png",
        signedHeaders: ["content-type", "host", "x-amz-content-sha256", "x-amz-date"],
        signatureMatches: true,
      },
    ]);
  });

  it("signs the Content-Type on fetch with an s3:// URL", async () => {
    const { server, seen } = startServer();
    using _ = server;

    const res = await fetch("s3://e.html", {
      method: "PUT",
      body: "x",
      headers: { "content-type": "text/html;charset=utf-8" },
      s3: { ...credentials, endpoint: server.url.href },
    });
    expect(res.status).toBe(200);

    expect(seen).toEqual([
      {
        method: "PUT",
        contentType: "text/html;charset=utf-8",
        signedHeaders: ["content-type", "host", "x-amz-content-sha256", "x-amz-date"],
        signatureMatches: true,
      },
    ]);
  });

  it("signs the raw Latin-1 bytes of a fetch Content-Type header", async () => {
    const { server, seen } = startServer();
    using _ = server;

    const res = await fetch("s3://k.txt", {
      method: "PUT",
      body: "x",
      headers: { "content-type": "text/plain; name=\u00e9" },
      s3: { ...credentials, endpoint: server.url.href },
    });
    expect(res.status).toBe(200);

    expect(seen).toEqual([
      {
        method: "PUT",
        contentType: "text/plain; name=\u00e9",
        signedHeaders: ["content-type", "host", "x-amz-content-sha256", "x-amz-date"],
        signatureMatches: true,
      },
    ]);
  });

  it("signs the Content-Type on a fetch that also sends a Range header", async () => {
    const { server, seen } = startServer();
    using _ = server;

    const res = await fetch("s3://j.html", {
      method: "PUT",
      body: "x",
      headers: { "content-type": "text/html;charset=utf-8", range: "bytes=0-0" },
      s3: { ...credentials, endpoint: server.url.href },
    });
    expect(res.status).toBe(200);

    expect(seen).toEqual([
      {
        method: "PUT",
        contentType: "text/html;charset=utf-8",
        signedHeaders: ["content-type", "host", "x-amz-content-sha256", "x-amz-date"],
        signatureMatches: true,
      },
    ]);
  });

  it("signs the Content-Type on the multipart create request", async () => {
    const { server, seen } = startServer();
    using _ = server;
    const client = new S3Client({ ...credentials, endpoint: server.url.href });

    const writer = client.file("f.html").writer({ partSize: 5 * 1024 * 1024 });
    writer.write(Buffer.alloc(5 * 1024 * 1024 + 1, "a"));
    await writer.end();

    const create = seen.find(s => s.method === "POST" && s.signedHeaders.includes("content-type"));
    expect(create).toEqual({
      method: "POST",
      contentType: "text/html;charset=utf-8",
      signedHeaders: ["content-type", "host", "x-amz-content-sha256", "x-amz-date"],
      signatureMatches: true,
    });
    expect(seen.every(s => s.signatureMatches)).toBe(true);
  });

  it("does not sign a Content-Type on a GET", async () => {
    const { server, seen } = startServer();
    using _ = server;
    const client = new S3Client({ ...credentials, endpoint: server.url.href });

    await client.file("g.html").text();

    expect(seen).toEqual([
      {
        method: "GET",
        contentType: null,
        signedHeaders: ["host", "x-amz-content-sha256", "x-amz-date"],
        signatureMatches: true,
      },
    ]);
  });

  it("presign keeps the type as given and signs only host", async () => {
    const client = new S3Client({ ...credentials, endpoint: "https://s3.example.com" });
    const url = new URL(client.presign("p.html", { method: "PUT", type: " text/plain " }));
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
    expect(url.searchParams.get("response-content-type")).toBe(" text/plain ");
  });
});
