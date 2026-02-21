import { expect, test } from "bun:test";
import net from "net";

// Regression test for https://github.com/oven-sh/bun/issues/8893
// Bytes >= 0x80 in HTTP header values were incorrectly stripped because
// the whitespace trimming in HttpParser.h compared signed chars against 33.
// On platforms where char is signed (x86_64), bytes 0x80-0xFF are negative
// and thus < 33, causing them to be trimmed as if they were whitespace.

test("header values preserve bytes >= 0x80", async () => {
  let receivedValue: string | null = null;

  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      receivedValue = req.headers.get("x-test");
      return new Response("OK");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");

  // Send a raw HTTP request with 0xFF bytes surrounding the header value
  const request = Buffer.concat([
    Buffer.from("GET / HTTP/1.1\r\nHost: localhost\r\nX-Test: "),
    Buffer.from([0xff]),
    Buffer.from("value"),
    Buffer.from([0xff]),
    Buffer.from("\r\n\r\n"),
  ]);

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      expect(response).toContain("HTTP/1.1 200");
      // The header value should preserve the 0xFF bytes — not strip them.
      // 0xFF as a Latin-1 byte becomes U+00FF (ÿ) in the JS string.
      expect(receivedValue).not.toBeNull();
      expect(receivedValue!.length).toBe(7);
      expect(receivedValue!.charCodeAt(0)).toBe(0xff);
      expect(receivedValue!.charCodeAt(6)).toBe(0xff);
      client.end();
      resolve();
    });
    client.write(request);
  });
});

test("header values still trim actual whitespace (SP, HTAB)", async () => {
  let receivedValue: string | null = null;

  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      receivedValue = req.headers.get("x-test");
      return new Response("OK");
    },
  });

  const client = net.connect(server.port, "127.0.0.1");

  // Send a raw HTTP request with spaces and tabs surrounding the header value
  const request = Buffer.from("GET / HTTP/1.1\r\nHost: localhost\r\nX-Test: \t value \t \r\n\r\n");

  await new Promise<void>((resolve, reject) => {
    client.on("error", reject);
    client.on("data", data => {
      const response = data.toString();
      expect(response).toContain("HTTP/1.1 200");
      expect(receivedValue).toBe("value");
      client.end();
      resolve();
    });
    client.write(request);
  });
});
