import { S3Client } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// Test that CRLF characters in S3 options are rejected to prevent header injection.
// See: HTTP Header Injection via S3 Content-Disposition Value

// The S3 client sends through an ambient HTTP_PROXY even for loopback endpoints,
// so the requests below would never reach the stub servers in an environment
// that sets one. Same approach as test/js/bun/http/proxy.test.ts: assign "" (a
// delete does not reach the native env) for the duration of this file.
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

// A raw TCP stub instead of Bun.serve: Bun.serve's parser would refuse a request
// whose header carries a NUL byte before the fetch handler runs, so it could not
// tell "the client never sent the request" apart from "the server dropped it".
function rawEndpoint() {
  const seen = { requests: [] as string[], errors: [] as string[] };
  const server = Bun.listen<{ pending: string }>({
    port: 0,
    hostname: "127.0.0.1",
    socket: {
      open(socket) {
        socket.data = { pending: "" };
      },
      data(socket, chunk) {
        socket.data.pending += chunk.toString("latin1");
        const end = socket.data.pending.indexOf("\r\n\r\n");
        if (end === -1) {
          return;
        }
        seen.requests.push(socket.data.pending.slice(0, end));
        socket.end('HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 2\r\nETag: "stub"\r\n\r\nok');
      },
      close() {},
      error(_socket, error) {
        seen.errors.push(String(error));
      },
    },
  });
  return {
    seen,
    endpoint: `http://127.0.0.1:${server.port}`,
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

const nulCredentials = [
  ["sessionToken", { sessionToken: "FAKE\0TOKEN" }],
  ["accessKeyId", { accessKeyId: "AKIA\0FAKE" }],
  ["region", { region: "us-east-1\0" }],
] as const;

describe.concurrent("S3 NUL bytes in header values", () => {
  // fetch() refuses a header value that contains NUL, CR or LF. The S3 client
  // builds its headers itself, so it has to apply the same rule. CR/LF is
  // covered above; these cover NUL, which used to reach the wire.
  test.each([
    ["contentDisposition", { contentDisposition: 'attachment; filename="a"\0b' }],
    ["contentEncoding", { contentEncoding: "gzip\0identity" }],
    ["type", { type: "text/plain\0x" }],
  ])("upload option %s containing NUL is rejected before a request is made", (option, uploadOptions) => {
    using stub = rawEndpoint();
    const client = new S3Client({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      endpoint: stub.endpoint,
      bucket: "test-bucket",
    });

    expect(() => client.write("test-file.txt", "Hello", uploadOptions)).toThrow(
      `${option} must not contain CR/LF or NUL characters`,
    );
    expect(stub.seen).toEqual({ requests: [], errors: [] });
  });

  // These values go into x-amz-security-token and Authorization, which are
  // assembled while the request is signed. Nothing may be sent for them.
  test.each(nulCredentials)(
    "credential %s containing NUL fails to sign and sends nothing",
    async (_name, credentials) => {
      using stub = rawEndpoint();
      const client = new S3Client({
        accessKeyId: "test-key",
        secretAccessKey: "test-secret",
        endpoint: stub.endpoint,
        bucket: "test-bucket",
        ...credentials,
      });

      await expect(client.file("test-file.txt").text()).rejects.toMatchObject({ code: "ERR_S3_INVALID_SIGNATURE" });
      await expect(client.write("test-file.txt", "Hello")).rejects.toMatchObject({ code: "ERR_S3_INVALID_SIGNATURE" });
      expect(stub.seen).toEqual({ requests: [], errors: [] });
    },
  );

  // A presigned URL carries the same values in its query string, so it is
  // refused too instead of embedding the byte in X-Amz-Credential.
  test.each([...nulCredentials, ["sessionToken (CR/LF)", { sessionToken: "FAKE\r\nTOKEN" }]])(
    "presign with %s containing NUL or CR/LF throws",
    (_name, credentials) => {
      const client = new S3Client({
        accessKeyId: "test-key",
        secretAccessKey: "test-secret",
        endpoint: "http://127.0.0.1:1",
        bucket: "test-bucket",
        ...credentials,
      });

      expect(() => client.presign("test-file.txt")).toThrow(
        expect.objectContaining({ code: "ERR_S3_INVALID_SIGNATURE" }),
      );
    },
  );

  test("the same credentials without NUL are sent", async () => {
    using stub = rawEndpoint();
    const client = new S3Client({
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      endpoint: stub.endpoint,
      bucket: "test-bucket",
      sessionToken: "FAKETOKEN",
    });

    expect(await client.file("test-file.txt").text()).toBe("ok");

    expect(stub.seen.errors).toEqual([]);
    expect(stub.seen.requests).toHaveLength(1);
    const headers = stub.seen.requests[0].split("\r\n").slice(1);
    expect(headers).toContain("x-amz-security-token: FAKETOKEN");
    expect(headers.some(line => line.startsWith("Authorization: AWS4-HMAC-SHA256 Credential=test-key/"))).toBe(true);
    expect(client.presign("test-file.txt")).toContain("X-Amz-Credential=test-key%2F");
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
