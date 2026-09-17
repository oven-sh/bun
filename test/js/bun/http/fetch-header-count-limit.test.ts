import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { type AddressInfo, createServer } from "node:net";

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

describe("response header field count", () => {
  // MAX_RESPONSE_HEADERS in src/http/lib.rs
  const maxResponseHeaders = 2000;

  // `total` header fields: Set-Cookie lines, then the two fields that frame the
  // body. A parser that stops early cannot read the body.
  const makeCookies = (total: number) => Array.from({ length: total - 2 }, (_, i) => `c${i}=v${i}`);
  const toWire = (cookies: string[]) =>
    "HTTP/1.1 200 OK\r\n" +
    cookies.map(cookie => `Set-Cookie: ${cookie}\r\n`).join("") +
    "Connection: close\r\nContent-Length: 2\r\n\r\nok";

  // Answers the first request with `parts`, one write for each part.
  async function serveRaw(...parts: string[]) {
    const server = createServer(socket => {
      socket.on("error", () => {});
      socket.once("data", async () => {
        socket.setNoDelay(true);
        for (const part of parts.slice(0, -1)) {
          await new Promise(resolve => socket.write(part, resolve));
          // Give the client a turn to read this part alone. The client reads on
          // another thread and gives no signal in the middle of a header block.
          await new Promise(resolve => setImmediate(resolve));
        }
        socket.end(parts.at(-1));
      });
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    return server;
  }

  const outcomeOf = (server: Awaited<ReturnType<typeof serveRaw>>) =>
    fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`).then(
      async res => ({
        status: res.status,
        cookies: res.headers.getSetCookie(),
        contentLength: res.headers.get("content-length"),
        body: await res.text(),
      }),
      e => ({ rejected: e.code }),
    );

  // A response with 257 fields used to reject with Malformed_HTTP_Response.
  test.concurrent.each([256, 257, 1000, maxResponseHeaders])("%i fields resolve with every field", async total => {
    const cookies = makeCookies(total);
    await using server = await serveRaw(toWire(cookies));
    expect(await outcomeOf(server)).toEqual({ status: 200, cookies, contentLength: "2", body: "ok" });
  });

  test.concurrent("one field more than the maximum rejects with ResponseHeadersTooLarge", async () => {
    await using server = await serveRaw(toWire(makeCookies(maxResponseHeaders + 1)));
    expect(await outcomeOf(server)).toEqual({ rejected: "ResponseHeadersTooLarge" });
  });

  test.concurrent("300 fields that arrive in two reads resolve with every field", async () => {
    const cookies = makeCookies(300);
    const wire = toWire(cookies);
    // The first read ends after 280 complete field lines, before the end of the header block.
    const cut = wire.indexOf("Set-Cookie: c280=");
    await using server = await serveRaw(wire.slice(0, cut), wire.slice(cut));
    expect(await outcomeOf(server)).toEqual({ status: 200, cookies, contentLength: "2", body: "ok" });
  });

  test.concurrent("a malformed line after 290 fields still rejects with Malformed_HTTP_Response", async () => {
    const wire = toWire(makeCookies(300)).replace("Set-Cookie: c290=v290\r\n", "not a header line\r\n");
    await using server = await serveRaw(wire);
    expect(await outcomeOf(server)).toEqual({ rejected: "Malformed_HTTP_Response" });
  });
});
