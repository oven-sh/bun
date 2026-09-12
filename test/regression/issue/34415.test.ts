// https://github.com/oven-sh/bun/issues/34415
// Removing Content-Length (what the npm `compression` middleware does) made the
// server advertise `Transfer-Encoding: chunked` to HTTP/1.0 clients while the
// body went out unframed, so nginx (proxy_http_version 1.0) returned 502.
import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

async function serve(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, port: (server.address() as net.AddressInfo).port };
}

async function rawRequest(port: number, request: string): Promise<string> {
  const sock = net.connect(port, "127.0.0.1");
  await once(sock, "connect");
  sock.write(request);
  const chunks: Buffer[] = [];
  sock.on("data", c => chunks.push(c));
  await once(sock, "close");
  return Buffer.concat(chunks).toString("latin1");
}

function parseResponse(raw: string) {
  const idx = raw.indexOf("\r\n\r\n");
  expect(idx).toBeGreaterThan(0);
  const [statusLine, ...headerLines] = raw.slice(0, idx).split("\r\n");
  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const sep = line.indexOf(": ");
    headers[line.slice(0, sep).toLowerCase()] = line.slice(sep + 2);
  }
  return { statusLine, headers, body: raw.slice(idx + 4) };
}

// Strict chunked-framing decoder: throws on anything nginx would reject.
function decodeChunked(body: string): string {
  let out = "";
  let i = 0;
  while (true) {
    const lineEnd = body.indexOf("\r\n", i);
    if (lineEnd === -1) throw new Error(`missing chunk size line at ${i}: ${JSON.stringify(body.slice(i, i + 32))}`);
    const sizeHex = body.slice(i, lineEnd).split(";")[0];
    if (!/^[0-9a-fA-F]+$/.test(sizeHex)) throw new Error(`invalid chunk size ${JSON.stringify(sizeHex)}`);
    const size = parseInt(sizeHex, 16);
    i = lineEnd + 2;
    if (size === 0) {
      if (body.slice(i) !== "\r\n") throw new Error(`bad chunked trailer ${JSON.stringify(body.slice(i))}`);
      return out;
    }
    out += body.slice(i, i + size);
    i += size;
    if (body.slice(i, i + 2) !== "\r\n") throw new Error(`missing CRLF after chunk data at ${i}`);
    i += 2;
  }
}

function removeContentLengthHandler(req: http.IncomingMessage, res: http.ServerResponse) {
  res.removeHeader("Content-Length");
  res.write("hello world");
  res.end();
}

test("HTTP/1.0 response with removed Content-Length is close-delimited, not chunked", async () => {
  const { server, port } = await serve(removeContentLengthHandler);
  try {
    const res = parseResponse(await rawRequest(port, "GET / HTTP/1.0\r\nHost: localhost\r\n\r\n"));
    expect({
      status: res.statusLine,
      transferEncoding: res.headers["transfer-encoding"],
      connection: res.headers.connection,
      body: res.body,
    }).toEqual({
      status: "HTTP/1.1 200 OK",
      transferEncoding: undefined,
      connection: "close",
      body: "hello world",
    });
  } finally {
    server.close();
  }
});

test("HTTP/1.0 request with TE: chunked still gets a well-formed response", async () => {
  const { server, port } = await serve(removeContentLengthHandler);
  try {
    const res = parseResponse(await rawRequest(port, "GET / HTTP/1.0\r\nHost: localhost\r\nTE: chunked\r\n\r\n"));
    // The native writer never chunk-frames HTTP/1.0 responses, so the header
    // must not be advertised and the body goes out close-delimited.
    expect({
      transferEncoding: res.headers["transfer-encoding"],
      connection: res.headers.connection,
      body: res.body,
    }).toEqual({
      transferEncoding: undefined,
      connection: "close",
      body: "hello world",
    });
  } finally {
    server.close();
  }
});

test("HTTP/1.0 response with removed Content-Length, end(data) only", async () => {
  const { server, port } = await serve((req, res) => {
    res.removeHeader("Content-Length");
    res.end("hello world");
  });
  try {
    const res = parseResponse(await rawRequest(port, "GET / HTTP/1.0\r\nHost: localhost\r\n\r\n"));
    expect({
      transferEncoding: res.headers["transfer-encoding"],
      body: res.body,
    }).toEqual({
      transferEncoding: undefined,
      body: "hello world",
    });
  } finally {
    server.close();
  }
});

test("HTTP/1.1 response with removed Content-Length stays chunked with valid framing", async () => {
  const { server, port } = await serve(removeContentLengthHandler);
  try {
    const res = parseResponse(await rawRequest(port, "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
    expect(res.headers["transfer-encoding"]).toBe("chunked");
    expect(decodeChunked(res.body)).toBe("hello world");
  } finally {
    server.close();
  }
});
