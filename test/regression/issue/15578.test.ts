import { expect, test } from "bun:test";

// Regression test for https://github.com/oven-sh/bun/issues/15578
// Well-known HTTP headers should be sent lowercase (matching Node.js behavior),
// not title-cased.

test("node:http server sends well-known headers in lowercase", async () => {
  const { createServer } = await import("node:http");

  const server = createServer((req, res) => {
    res.setHeader("location", "http://test.com");
    res.setHeader("content-type", "text/plain");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("x-custom-header", "custom-value");
    res.end("ok");
  });

  server.listen(0);
  const port = (server.address() as any).port;

  try {
    const response = await fetch(`http://localhost:${port}/`);
    const text = await response.text();
    expect(text).toBe("ok");

    // Verify well-known headers are lowercase by inspecting raw headers
    // response.headers normalizes casing, so we need to check the raw response
    // Using a raw TCP connection to inspect actual header casing
    const { connect } = await import("node:net");

    const rawResponse = await new Promise<string>((resolve, reject) => {
      const client = connect(port, "127.0.0.1", () => {
        client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
      });
      let data = "";
      client.on("data", chunk => {
        data += chunk.toString();
      });
      client.on("end", () => {
        resolve(data);
      });
      client.on("error", reject);
    });

    // The raw HTTP response should contain lowercase header names
    expect(rawResponse).toContain("location: http://test.com");
    expect(rawResponse).toContain("content-type: text/plain");
    expect(rawResponse).toContain("cache-control: no-cache");
    expect(rawResponse).toContain("x-custom-header: custom-value");

    // Should NOT contain title-cased versions
    expect(rawResponse).not.toContain("Location:");
    expect(rawResponse).not.toContain("Content-Type:");
    expect(rawResponse).not.toContain("Cache-Control:");
  } finally {
    server.close();
  }
});

test("Bun.serve sends well-known headers in lowercase", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      return new Response("ok", {
        headers: {
          "location": "http://test.com",
          "content-type": "text/plain",
          "cache-control": "no-cache",
          "x-custom-header": "custom-value",
        },
      });
    },
  });

  const { connect } = await import("node:net");

  const rawResponse = await new Promise<string>((resolve, reject) => {
    const client = connect(server.port, "127.0.0.1", () => {
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    });
    let data = "";
    client.on("data", chunk => {
      data += chunk.toString();
    });
    client.on("end", () => {
      resolve(data);
    });
    client.on("error", reject);
  });

  // The raw HTTP response should contain lowercase header names
  expect(rawResponse).toContain("location: http://test.com");
  expect(rawResponse).toContain("content-type: text/plain");
  expect(rawResponse).toContain("cache-control: no-cache");
  expect(rawResponse).toContain("x-custom-header: custom-value");

  // Should NOT contain title-cased versions
  expect(rawResponse).not.toContain("Location:");
  expect(rawResponse).not.toContain("Content-Type:");
  expect(rawResponse).not.toContain("Cache-Control:");
});
