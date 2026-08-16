import { expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:net";

// Use a raw TCP server to avoid header count limits in HTTP servers.
// The server reads the raw request, extracts header info, and sends a JSON response.
function makeRawHttpServer() {
  const server = createServer(socket => {
    let data = "";
    socket.on("data", chunk => {
      data += chunk.toString();
      // Wait for the end of the HTTP headers (double CRLF).
      if (data.includes("\r\n\r\n")) {
        const headerSection = data.split("\r\n\r\n")[0];
        const lines = headerSection.split("\r\n");
        // First line is the request line, rest are headers.
        let customCount = 0;
        const headerNames: string[] = [];
        for (let i = 1; i < lines.length; i++) {
          const lower = lines[i].toLowerCase();
          const colonIdx = lines[i].indexOf(":");
          if (colonIdx > 0) {
            headerNames.push(lines[i].substring(0, colonIdx).toLowerCase());
          }
          if (lower.startsWith("x-h-")) {
            customCount++;
          }
        }
        const body = JSON.stringify({ customCount, headerNames });
        socket.write(
          `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
        );
        socket.end();
      }
    });
  });
  return server;
}

test("fetch with many headers does not crash", async () => {
  await using server = makeRawHttpServer().listen(0);
  await once(server, "listening");
  const port = (server.address() as any).port;

  // Build a request with more headers than the internal fixed-size buffer (256).
  const headers = new Headers();
  for (let i = 0; i < 300; i++) {
    headers.set(`x-h-${i}`, `v${i}`);
  }

  const res = await fetch(`http://127.0.0.1:${port}/test`, { headers });
  expect(res.status).toBe(200);

  const { customCount } = await res.json();
  // Excess headers beyond the internal cap (250 user headers) are silently dropped.
  expect(customCount).toBe(250);
});

test("fetch with exactly 250 custom headers sends all of them", async () => {
  await using server = makeRawHttpServer().listen(0);
  await once(server, "listening");
  const port = (server.address() as any).port;

  const headers = new Headers();
  for (let i = 0; i < 250; i++) {
    headers.set(`x-h-${i}`, `v${i}`);
  }

  const res = await fetch(`http://127.0.0.1:${port}/test`, { headers });
  expect(res.status).toBe(200);

  const { customCount } = await res.json();
  expect(customCount).toBe(250);
});

test("default headers preserved when user headers overflow the buffer", async () => {
  await using server = makeRawHttpServer().listen(0);
  await once(server, "listening");
  const port = (server.address() as any).port;

  // Use "a-" prefixed headers which sort alphabetically before "accept",
  // "host", "user-agent", etc. This ensures the filler headers consume all
  // 250 user-header slots first, pushing the special headers into overflow.
  // Without the fix, the override flags for Host/Accept/User-Agent would
  // still be set (suppressing defaults), but the headers themselves would be
  // dropped — resulting in missing mandatory headers like Host.
  const headers = new Headers();
  for (let i = 0; i < 250; i++) {
    headers.set(`a-${String(i).padStart(4, "0")}`, `v${i}`);
  }
  // These special headers sort after "a-*" and will overflow.
  headers.set("Host", "custom-host.example.com");
  headers.set("User-Agent", "custom-agent");
  headers.set("Accept", "text/html");

  const res = await fetch(`http://127.0.0.1:${port}/test`, { headers });
  expect(res.status).toBe(200);

  const { headerNames } = await res.json();

  // Even though the user-supplied Host, User-Agent, and Accept were dropped
  // due to overflow, the DEFAULT versions of these headers must still be
  // present (the override flags should not have been set for dropped headers).
  expect(headerNames).toContain("host");
  expect(headerNames).toContain("user-agent");
  expect(headerNames).toContain("accept");
});
