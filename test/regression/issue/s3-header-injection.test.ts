import { S3Client } from "bun";
import { describe, expect, test } from "bun:test";

// Test that CRLF characters in S3 options are rejected to prevent header injection.
// See: HTTP Header Injection via S3 Content-Disposition Value

describe("S3 header injection prevention", () => {
  test("contentDisposition with CRLF should throw", () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    const client = new S3Client({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      endpoint: server.url.href,
      bucket: "test-bucket",
    });

    expect(() =>
      client.write("test-file.txt", "Hello", {
        contentDisposition: 'attachment; filename="evil"\r\nX-Injected: value',
      }),
    ).toThrow(/CR\/LF/);
  });

  test("contentEncoding with CRLF should throw", () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    const client = new S3Client({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      endpoint: server.url.href,
      bucket: "test-bucket",
    });

    expect(() =>
      client.write("test-file.txt", "Hello", {
        contentEncoding: "gzip\r\nX-Injected: value",
      }),
    ).toThrow(/CR\/LF/);
  });

  test("type (content-type) with CRLF should throw", () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    const client = new S3Client({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      endpoint: server.url.href,
      bucket: "test-bucket",
    });

    expect(() =>
      client.write("test-file.txt", "Hello", {
        type: "text/plain\r\nX-Injected: value",
      }),
    ).toThrow(/CR\/LF/);
  });

  test("contentDisposition with only CR should throw", () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    const client = new S3Client({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      endpoint: server.url.href,
      bucket: "test-bucket",
    });

    expect(() =>
      client.write("test-file.txt", "Hello", {
        contentDisposition: "attachment\rinjected",
      }),
    ).toThrow(/CR\/LF/);
  });

  test("contentDisposition with only LF should throw", () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK", { status: 200 });
      },
    });

    const client = new S3Client({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      endpoint: server.url.href,
      bucket: "test-bucket",
    });

    expect(() =>
      client.write("test-file.txt", "Hello", {
        contentDisposition: "attachment\ninjected",
      }),
    ).toThrow(/CR\/LF/);
  });

  test("valid contentDisposition without CRLF should not throw", async () => {
    const { promise: requestReceived, resolve: onRequestReceived } = Promise.withResolvers<Headers>();

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        onRequestReceived(req.headers);
        return new Response("OK", { status: 200 });
      },
    });

    const client = new S3Client({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      endpoint: server.url.href,
      bucket: "test-bucket",
    });

    // Valid content-disposition values should not throw synchronously.
    // The write may eventually fail because the mock server doesn't speak S3 protocol,
    // but the option parsing should succeed and a request should be initiated.
    expect(() =>
      client.write("test-file.txt", "Hello", {
        contentDisposition: 'attachment; filename="report.pdf"',
      }),
    ).not.toThrow();

    const receivedHeaders = await requestReceived;
    expect(receivedHeaders.get("content-disposition")).toBe('attachment; filename="report.pdf"');
  });
});

describe("S3 multipart upload id validation", () => {
  // The upload id returned by CreateMultipartUpload is echoed into the request
  // line ("?partNumber=N&uploadId=...") of every subsequent UploadPart /
  // CompleteMultipartUpload / AbortMultipartUpload request. An id containing
  // control characters must cause the upload to fail instead of being reused.
  test(
    "rejects an endpoint-supplied upload id containing CR/LF",
    async () => {
      let createMultipartRequests = 0;
      let sawInjectedHeader = false;

      using server = Bun.serve({
        port: 0,
        async fetch(req) {
          // If the upload id were echoed back unvalidated, the CR/LF inside it
          // would terminate the request line early and "X-Injected: 1 ..."
          // would arrive as a header on the next request this server parses.
          if (req.headers.get("x-injected") !== null) {
            sawInjectedHeader = true;
          }

          const isCreateMultipartUploadRequest = req.method === "POST" && req.url.includes("?uploads=");
          if (isCreateMultipartUploadRequest) {
            createMultipartRequests++;
            return new Response(
              "<InitiateMultipartUploadResult>" +
                "<Bucket>test-bucket</Bucket>" +
                "<Key>big-file</Key>" +
                "<UploadId>abc HTTP/1.1\r\nX-Injected: 1</UploadId>" +
                "</InitiateMultipartUploadResult>",
              { headers: { "Content-Type": "text/xml" }, status: 200 },
            );
          }

          return new Response(undefined, {
            status: 200,
            headers: { "ETag": '"f9a5ddddf9e0fcbd05c15bb44b389171-1"' },
          });
        },
      });

      const client = new S3Client({
        accessKeyId: "test-key",
        secretAccessKey: "test-secret",
        endpoint: server.url.href,
        bucket: "test-bucket",
      });

      const writer = client.file("big-file").writer({
        partSize: 5 * 1024 * 1024,
        retry: 0,
      });

      // A single chunk >= partSize forces the multipart code path
      // (in-memory writes below partSize are sent as a single PUT).
      writer.write(new Uint8Array(5 * 1024 * 1024 + 1024));

      await expect(writer.end()).rejects.toThrow("Failed to initiate multipart upload");

      expect(createMultipartRequests).toBe(1);
      // The upload must stop before any UploadPart/Complete request reuses the id.
      expect(sawInjectedHeader).toBe(false);
    },
    { timeout: 15_000 },
  );
});
