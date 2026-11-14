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
        const headerLines = lines.slice(1);
        const customCount = headerLines.filter(line => line.toLowerCase().startsWith("x-h-")).length;
        const body = JSON.stringify({ customCount, headerLines });
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

  // More headers than the shared scratch buffer holds (256).
  const headers = new Headers();
  for (let i = 0; i < 300; i++) {
    headers.set(`x-h-${i}`, `v${i}`);
  }

  const res = await fetch(`http://127.0.0.1:${port}/test`, { headers });
  expect(res.status).toBe(200);

  const { customCount } = (await res.json()) as any;
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

  const { customCount } = (await res.json()) as any;
  expect(customCount).toBe(250);
});

test("sends the user's Host, User-Agent and Accept after 251 other headers", async () => {
  await using server = makeRawHttpServer().listen(0);
  await once(server, "listening");
  const port = (server.address() as any).port;

  // fetch() writes headers in code-point order of their case-preserved names, so "A-" sorts before "Accept".
  const headers = new Headers();
  for (let i = 0; i < 251; i++) {
    headers.set(`A-${String(i).padStart(4, "0")}`, `v${i}`);
  }
  headers.set("Host", "custom-host.example.com");
  headers.set("User-Agent", "custom-agent");
  headers.set("Accept", "text/html");

  const res = await fetch(`http://127.0.0.1:${port}/test`, { headers });
  expect(res.status).toBe(200);

  const { headerLines } = (await res.json()) as any;
  expect(headerLines.filter((line: string) => /^(host|user-agent|accept):/i.test(line))).toEqual([
    "Accept: text/html",
    "Host: custom-host.example.com",
    "User-Agent: custom-agent",
  ]);
});

describe("response header field count", () => {
  // MAX_RESPONSE_HEADERS in src/http/lib.rs
  const maxResponseHeaders = 1000;

  // `total` header fields: Set-Cookie lines, then the two fields that frame the body.
  const makeCookies = (total: number) => Array.from({ length: total - 2 }, (_, i) => `c${i}=v${i}`);
  const toWire = (cookies: string[]) =>
    "HTTP/1.1 200 OK\r\n" +
    cookies.map(cookie => `Set-Cookie: ${cookie}\r\n`).join("") +
    "Connection: close\r\nContent-Length: 2\r\n\r\nok";

  // Answers the first request with `parts`, one write per part.
  async function serveRaw(...parts: string[]) {
    const server = createServer(socket => {
      socket.on("error", () => {});
      socket.once("data", async () => {
        socket.setNoDelay(true);
        for (const part of parts.slice(0, -1)) {
          await new Promise(resolve => socket.write(part, resolve));
          // Gives the client a chance to read this part on its own. The result is the same if it doesn't.
          await new Promise(resolve => setImmediate(resolve));
        }
        socket.end(parts.at(-1)!);
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

  test.concurrent.each([256, 257, maxResponseHeaders])("resolves a response with %i header fields", async total => {
    const cookies = makeCookies(total);
    await using server = await serveRaw(toWire(cookies));
    expect(await outcomeOf(server)).toEqual({ status: 200, cookies, contentLength: "2", body: "ok" });
  });

  test.concurrent("rejects one field past the limit with ResponseHeadersTooLarge", async () => {
    await using server = await serveRaw(toWire(makeCookies(maxResponseHeaders + 1)));
    expect(await outcomeOf(server)).toEqual({ rejected: "ResponseHeadersTooLarge" });
  });

  // At the limit every slot is in use when the first read ends, and the parser has to ask for more bytes.
  test.concurrent.each([
    ["300 fields, split after 280 lines", 300, (wire: string) => wire.indexOf("Set-Cookie: c280=")],
    ["the limit, split before the blank line", maxResponseHeaders, (wire: string) => wire.indexOf("\r\n\r\n") + 2],
  ])("resolves a header block that arrives in two reads: %s", async (_, total, cutAt) => {
    const cookies = makeCookies(total);
    const wire = toWire(cookies);
    const cut = cutAt(wire);
    await using server = await serveRaw(wire.slice(0, cut), wire.slice(cut));
    expect(await outcomeOf(server)).toEqual({ status: 200, cookies, contentLength: "2", body: "ok" });
  });

  test.concurrent("still rejects a malformed line after 290 fields with Malformed_HTTP_Response", async () => {
    const wire = toWire(makeCookies(300)).replace("Set-Cookie: c290=v290\r\n", "not a header line\r\n");
    await using server = await serveRaw(wire);
    expect(await outcomeOf(server)).toEqual({ rejected: "Malformed_HTTP_Response" });
  });
});
