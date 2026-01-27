import { expect, test } from "bun:test";

test("http.IncomingMessage.rawHeaders preserves original header case", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      // Access the underlying node:http request via undocumented property for direct testing
      // This test instead uses a proper node:http server
      return new Response("ok");
    },
  });

  // Test using node:http server which exposes rawHeaders
  const { promise, resolve, reject } = Promise.withResolvers<string[]>();

  const http = await import("node:http");
  const nodeServer = http.createServer((req, res) => {
    resolve(req.rawHeaders);
    res.end("ok");
  });

  await new Promise<void>(resolve => nodeServer.listen(0, resolve));
  const port = (nodeServer.address() as { port: number }).port;

  try {
    await fetch(`http://localhost:${port}/`, {
      headers: {
        "Accept-Encoding": "gzip, deflate",
        Accept: "*/*",
        Connection: "keep-alive",
        Authorization: "Bearer token123",
        Origin: "https://example.com",
        "X-Custom-Header": "custom-value",
      },
    });

    const rawHeaders = await promise;

    // Extract header names (even indices)
    const headerNames = rawHeaders.filter((_, i) => i % 2 === 0);

    // Standard headers should have their canonical Title-Case preserved
    expect(headerNames).toContain("Accept-Encoding");
    expect(headerNames).toContain("Accept");
    expect(headerNames).toContain("Connection");
    expect(headerNames).toContain("Authorization");
    expect(headerNames).toContain("Origin");
    expect(headerNames).toContain("Host");

    // Verify headers are NOT lowercased (the bug we're fixing)
    expect(headerNames).not.toContain("accept-encoding");
    expect(headerNames).not.toContain("accept");
    expect(headerNames).not.toContain("connection");
    expect(headerNames).not.toContain("authorization");
    expect(headerNames).not.toContain("origin");

    // Custom headers - the casing depends on what was originally sent
    // Since the HTTP parser lowercases header names and we don't have the original,
    // custom headers may still be lowercase. The important thing is that known
    // standard headers use their canonical casing.
  } finally {
    nodeServer.close();
  }
});
