import { describe, expect, test } from "bun:test";
import { once } from "events";
import { createServer, request } from "http";
import { AddressInfo, connect, Server } from "net";

async function rawHTTP10(port: number, path: string): Promise<{ head: string; body: string }> {
  const { promise, resolve, reject } = Promise.withResolvers<{ head: string; body: string }>();
  const chunks: Buffer[] = [];
  const socket = connect(port, "127.0.0.1", () => {
    socket.write(`GET ${path} HTTP/1.0\r\nHost: localhost\r\n\r\n`);
  });
  socket.on("data", d => chunks.push(d));
  socket.on("error", reject);
  socket.on("close", () => {
    const raw = Buffer.concat(chunks).toString("latin1");
    const i = raw.indexOf("\r\n\r\n");
    resolve({ head: raw.slice(0, i), body: raw.slice(i + 4) });
  });
  return promise;
}

const fixture = "node-http-transfer-encoding-fixture.ts";
test(`should not duplicate transfer-encoding header in request`, async () => {
  const { resolve, promise } = Promise.withResolvers();
  const tcpServer = new Server();
  tcpServer.listen(0, "127.0.0.1");

  await once(tcpServer, "listening");

  tcpServer.on("connection", async socket => {
    const requestHeader = await once(socket, "data").then(data => data.toString());
    queueMicrotask(() => {
      socket.write("HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      socket.end(resolve);
    });

    const httpHeadersArray = requestHeader
      .split("\r\n")
      .slice(1) // Skip the first line (HTTP method line)
      .map(line => line.trim())
      .filter((_, index, arr) => index < arr.indexOf(""))
      .reduce(
        (headers, line) => {
          const [key, value] = line.split(/\s*:\s*/);
          return [...headers, { [key.toLowerCase()]: value }];
        },
        [] as { [key: string]: string }[],
      );
    const transferEncodingHeaders = httpHeadersArray.filter(header => header["transfer-encoding"]);
    if (transferEncodingHeaders.length > 1) {
      throw new Error(`Duplicate 'transfer-encoding' header found: ${JSON.stringify(transferEncodingHeaders)}`);
    }
  });

  const serverAddress = tcpServer.address() as AddressInfo;
  const chunkedRequest = request({
    host: "localhost",
    port: serverAddress.port,
    path: "/",
    method: "PUT",
    agent: false,
    headers: {
      "transfer-encoding": "chunked",
    },
  });

  // Requires multiple chunks to trigger streaming behavior
  chunkedRequest.write("Hello, World!");
  chunkedRequest.end("Goodbye, World!");

  return promise;
});

test("should not duplicate transfer-encoding header in response when explicitly set", async () => {
  await using server = createServer((req, res) => {
    res.writeHead(200, { "Transfer-Encoding": "chunked" });
    res.write("Hello, World!");
    res.end("Goodbye, World!");
  });

  await once(server.listen(0, "127.0.0.1"), "listening");

  const { port } = server.address() as AddressInfo;

  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const socket = connect(port, "127.0.0.1", () => {
    socket.write("GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
  });

  let rawResponse = "";
  socket.on("data", (chunk: Buffer) => {
    rawResponse += chunk.toString();
  });
  socket.on("end", () => resolve(rawResponse));
  socket.on("error", reject);

  const response = await promise;
  const headerSection = response.split("\r\n\r\n")[0];
  const headerLines = headerSection
    .split("\r\n")
    .slice(1) // Skip status line
    .filter(line => line.length > 0);

  const transferEncodingHeaders = headerLines.filter(line => line.toLowerCase().startsWith("transfer-encoding:"));

  expect(transferEncodingHeaders).toHaveLength(1);

  // Verify the body content is correctly delivered via chunked encoding
  const bodySection = response.split("\r\n\r\n").slice(1).join("\r\n\r\n");
  expect(bodySection).toContain("Hello, World!");
  expect(bodySection).toContain("Goodbye, World!");
});

// The declared Transfer-Encoding and the emitted body framing must agree for
// HTTP/1.0 requests; a mismatch made curl --http1.0 die with
// "curl: (56) chunk hex-length char not a hex digit".
describe("HTTP/1.0 response framing matches the advertised headers", () => {
  test("removing Content-Length does not invent Transfer-Encoding: chunked", async () => {
    await using server = createServer((req, res) => {
      res.setHeader("Content-Length", 5);
      res.removeHeader("Content-Length");
      res.end("hello");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const { head, body } = await rawHTTP10(port, "/");
    // Node.js never auto-adds Transfer-Encoding here (useChunkedEncodingByDefault
    // is false for HTTP/1.0); the response is close-delimited instead.
    expect(head.toLowerCase()).not.toContain("transfer-encoding");
    expect(head.toLowerCase()).not.toContain("content-length");
    expect(head).toContain("Connection: close");
    expect(body).toBe("hello");
  });

  test.each([
    ["writeHead", (res: any) => res.writeHead(200, { "Transfer-Encoding": "chunked" })],
    ["setHeader", (res: any) => res.setHeader("Transfer-Encoding", "chunked")],
  ])("an explicit Transfer-Encoding: chunked via %s chunk-frames the one-shot body", async (_, setup) => {
    await using server = createServer((req, res) => {
      setup(res);
      res.end("hello");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const { head, body } = await rawHTTP10(port, "/");
    expect(head).toContain("Transfer-Encoding: chunked");
    // Node.js chunk-frames the body to match the header it committed to.
    expect(body).toBe("5\r\nhello\r\n0\r\n\r\n");
  });

  test("an explicit Transfer-Encoding: chunked chunk-frames streaming writes", async () => {
    await using server = createServer((req, res) => {
      res.writeHead(200, { "Transfer-Encoding": "chunked" });
      res.write("hel");
      res.end("lo");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const { head, body } = await rawHTTP10(port, "/");
    expect(head).toContain("Transfer-Encoding: chunked");
    expect(body).toBe("3\r\nhel\r\n2\r\nlo\r\n0\r\n\r\n");
  });

  test("a Transfer-Encoding value without 'chunked' does not chunk-frame the body", async () => {
    // Node.js only sets chunkedEncoding when the TE value contains the
    // 'chunked' token; other codings pass through with identity body bytes.
    await using server = createServer((req, res) => {
      res.setHeader("Transfer-Encoding", "gzip");
      res.end("hello");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const { head, body } = await rawHTTP10(port, "/");
    expect(head).toContain("Transfer-Encoding: gzip");
    expect(body).toBe("hello");
  });
});
