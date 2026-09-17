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
        const headers: Record<string, string> = {};
        for (let i = 1; i < lines.length; i++) {
          const lower = lines[i].toLowerCase();
          const colonIdx = lines[i].indexOf(":");
          if (colonIdx > 0) {
            const name = lines[i].substring(0, colonIdx).toLowerCase();
            headerNames.push(name);
            headers[name] = lines[i].substring(colonIdx + 1).trim();
          }
          if (lower.startsWith("x-h-")) {
            customCount++;
          }
        }
        const body = JSON.stringify({ customCount, headerNames, headers });
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

  // Build a request with more headers than the inline fixed-size scratch (256).
  const headers = new Headers();
  for (let i = 0; i < 300; i++) {
    headers.set(`x-h-${i}`, `v${i}`);
  }

  const res = await fetch(`http://127.0.0.1:${port}/test`, { headers });
  expect(res.status).toBe(200);

  const { customCount } = await res.json();
  // There is no request-side field-count cap; every header reaches the origin.
  expect(customCount).toBe(300);
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

test("user-supplied Host/User-Agent/Accept sent after >250 other headers keep their values", async () => {
  await using server = makeRawHttpServer().listen(0);
  await once(server, "listening");
  const port = (server.address() as any).port;

  // fetch() writes headers in code-point order of their case-preserved names.
  // "A-" sorts before "Accept", so Accept, Host and User-Agent come last.
  const headers = new Headers();
  for (let i = 0; i < 251; i++) {
    headers.set(`A-${String(i).padStart(4, "0")}`, `v${i}`);
  }
  headers.set("Host", "custom-host.example.com");
  headers.set("User-Agent", "custom-agent");
  headers.set("Accept", "text/html");

  const res = await fetch(`http://127.0.0.1:${port}/test`, { headers });
  expect(res.status).toBe(200);

  const { headerNames, headers: received } = await res.json();
  const count = (name: string) => headerNames.filter((n: string) => n === name).length;

  expect({
    customCount: headerNames.filter((n: string) => n.startsWith("a-")).length,
    hostLines: count("host"),
    userAgentLines: count("user-agent"),
    acceptLines: count("accept"),
    host: received.host,
    "user-agent": received["user-agent"],
    accept: received.accept,
  }).toEqual({
    customCount: 251,
    hostLines: 1,
    userAgentLines: 1,
    acceptLines: 1,
    host: "custom-host.example.com",
    "user-agent": "custom-agent",
    accept: "text/html",
  });
});
