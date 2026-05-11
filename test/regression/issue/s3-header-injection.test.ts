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
