import { expect, test } from "bun:test";
import { tls } from "harness";
import http2 from "node:http2";

// Regression test for https://github.com/oven-sh/bun/issues/25771
// HTTP/2 origin set should not include default port 443 in origin string
// because URL.origin normalization removes default ports
//
// The issue is that the got HTTP client checks if the requested origin matches
// the server's origin. When connecting to https://example.com:443, the URL
// normalizes to https://example.com, but the HTTP/2 session's originSet was
// incorrectly containing https://example.com:443, causing an origin mismatch.

test("HTTP/2 client originSet should not include :443 for default HTTPS port", async () => {
  // Create a simple HTTP/2 server
  const server = http2.createSecureServer({
    key: tls.key,
    cert: tls.cert,
  });

  const { promise: serverReady, resolve: serverReadyResolve } = Promise.withResolvers<void>();

  server.on("stream", (stream, headers) => {
    stream.respond({
      ":status": 200,
      "content-type": "text/plain",
    });
    stream.end("OK");
  });

  server.listen(443, "127.0.0.1", () => {
    serverReadyResolve();
  });

  await serverReady;

  try {
    const client = http2.connect("https://127.0.0.1:443", {
      rejectUnauthorized: false,
    });

    // Wait for connection to be established
    const { promise: connected, resolve: connectedResolve, reject: connectedReject } = Promise.withResolvers<void>();
    client.on("connect", () => connectedResolve());
    client.on("error", err => connectedReject(err));

    await connected;

    // The originSet should be ["https://127.0.0.1"] without the :443
    // This is what URL.origin returns for https://127.0.0.1:443
    expect(client.originSet).toEqual(["https://127.0.0.1"]);

    // Also verify URL normalization behavior
    const url = new URL("https://127.0.0.1:443");
    expect(url.origin).toBe("https://127.0.0.1");
    expect(url.host).toBe("127.0.0.1");

    client.close();
  } finally {
    server.close();
  }
});

test("HTTP/2 client originSet should include non-default port", async () => {
  // Create a simple HTTP/2 server on a non-default port
  const server = http2.createSecureServer({
    key: tls.key,
    cert: tls.cert,
  });

  const { promise: serverReady, resolve: serverReadyResolve } = Promise.withResolvers<void>();

  server.on("stream", (stream, headers) => {
    stream.respond({
      ":status": 200,
      "content-type": "text/plain",
    });
    stream.end("OK");
  });

  server.listen(0, "127.0.0.1", () => {
    serverReadyResolve();
  });

  await serverReady;
  const port = (server.address() as { port: number }).port;

  try {
    const client = http2.connect(`https://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
    });

    // Wait for connection to be established
    const { promise: connected, resolve: connectedResolve, reject: connectedReject } = Promise.withResolvers<void>();
    client.on("connect", () => connectedResolve());
    client.on("error", err => connectedReject(err));

    await connected;

    // The originSet should include the port since it's not 443
    expect(client.originSet).toEqual([`https://127.0.0.1:${port}`]);

    client.close();
  } finally {
    server.close();
  }
});

test("URL.origin normalization for default ports", () => {
  // This test verifies the expected URL.origin behavior that our
  // HTTP/2 implementation should match

  // HTTPS default port 443 should be omitted
  expect(new URL("https://example.com:443").origin).toBe("https://example.com");
  expect(new URL("https://example.com").origin).toBe("https://example.com");

  // HTTP default port 80 should be omitted
  expect(new URL("http://example.com:80").origin).toBe("http://example.com");
  expect(new URL("http://example.com").origin).toBe("http://example.com");

  // Non-default ports should be included
  expect(new URL("https://example.com:8443").origin).toBe("https://example.com:8443");
  expect(new URL("http://example.com:8080").origin).toBe("http://example.com:8080");
});
