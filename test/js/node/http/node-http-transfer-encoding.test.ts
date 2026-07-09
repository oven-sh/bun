import { describe, expect, test } from "bun:test";
import { once } from "events";
import { createServer, request } from "http";
import { AddressInfo, connect, Server } from "net";

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

// The body framing (chunked vs raw) must match the Transfer-Encoding header the
// handler set, like Node.js: chunkedEncoding is derived from the header value,
// not from Content-Length presence. With a mismatch, a `Transfer-Encoding:
// identity` response carries a chunk-framed body that the client receives as
// content, and a `Content-Length` + `Transfer-Encoding: chunked` response
// desyncs any RFC 9112 §6.3-conforming receiver.
describe("response body framing matches the user's Transfer-Encoding header", () => {
  async function rawGet(port: number, path: string): Promise<{ head: string; body: string }> {
    const { promise, resolve, reject } = Promise.withResolvers<{ head: string; body: string }>();
    const chunks: Buffer[] = [];
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", d => chunks.push(d));
    socket.on("error", reject);
    socket.on("close", () => {
      const all = Buffer.concat(chunks).toString("latin1");
      const i = all.indexOf("\r\n\r\n");
      resolve({ head: all.slice(0, i), body: all.slice(i + 4) });
    });
    return promise;
  }

  function normalizeHead(head: string): string {
    return head
      .split("\r\n")
      .filter(line => !/^(date|keep-alive):/i.test(line))
      .join("\r\n");
  }

  const identityCases: { name: string; te: string | string[] }[] = [
    { name: "identity", te: "identity" },
    { name: "gzip, identity", te: "gzip, identity" },
    { name: "[gzip, identity]", te: ["gzip", "identity"] },
  ];
  describe.each(identityCases)("Transfer-Encoding: $name writes the body raw", ({ te }) => {
    test.concurrent("res.end", async () => {
      await using server = createServer((req, res) => {
        res.setHeader("Transfer-Encoding", te);
        res.end("ok");
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { head, body } = await rawGet((server.address() as AddressInfo).port, "/");
      // Node.js does not chunk-frame, does not add Content-Length, and keeps
      // the connection alive (state.te suppresses _storeHeader's framing).
      expect(head.toLowerCase()).toContain("transfer-encoding:");
      expect(head.toLowerCase()).not.toContain("content-length:");
      expect(head.toLowerCase()).not.toMatch(/transfer-encoding:.*chunked/);
      expect(body).toBe("ok");
    });

    test.concurrent("res.write + res.end", async () => {
      await using server = createServer((req, res) => {
        res.setHeader("Transfer-Encoding", te);
        res.write("ab");
        res.end("cd");
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { body } = await rawGet((server.address() as AddressInfo).port, "/");
      expect(body).toBe("abcd");
    });

    test.concurrent("writeHead", async () => {
      await using server = createServer((req, res) => {
        res.writeHead(200, { "Transfer-Encoding": te });
        res.end("ok");
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { body } = await rawGet((server.address() as AddressInfo).port, "/");
      expect(body).toBe("ok");
    });
  });

  describe("Transfer-Encoding: chunked chunk-frames the body even with Content-Length", () => {
    test.concurrent("res.end", async () => {
      await using server = createServer((req, res) => {
        res.setHeader("Content-Length", "2");
        res.setHeader("Transfer-Encoding", "chunked");
        res.end("ok");
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { head, body } = await rawGet((server.address() as AddressInfo).port, "/");
      expect(normalizeHead(head)).toBe(
        "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\nConnection: close",
      );
      expect(body).toBe("2\r\nok\r\n0\r\n\r\n");
    });

    test.concurrent("res.write + res.end", async () => {
      await using server = createServer((req, res) => {
        res.setHeader("Content-Length", "4");
        res.setHeader("Transfer-Encoding", "chunked");
        res.write("ab");
        res.end("cd");
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { body } = await rawGet((server.address() as AddressInfo).port, "/");
      expect(body).toBe("2\r\nab\r\n2\r\ncd\r\n0\r\n\r\n");
    });

    test.concurrent("writeHead", async () => {
      await using server = createServer((req, res) => {
        res.writeHead(200, { "Content-Length": "2", "Transfer-Encoding": "chunked" });
        res.end("ok");
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { head, body } = await rawGet((server.address() as AddressInfo).port, "/");
      expect(head.toLowerCase()).toContain("content-length: 2");
      expect(head.toLowerCase()).toContain("transfer-encoding: chunked");
      expect(body).toBe("2\r\nok\r\n0\r\n\r\n");
    });

    test.concurrent("array value [gzip, chunked]", async () => {
      await using server = createServer((req, res) => {
        res.setHeader("Content-Length", "2");
        res.setHeader("Transfer-Encoding", ["gzip", "chunked"]);
        res.end("ok");
      });
      await once(server.listen(0, "127.0.0.1"), "listening");
      const { body } = await rawGet((server.address() as AddressInfo).port, "/");
      expect(body).toBe("2\r\nok\r\n0\r\n\r\n");
    });
  });

  test.concurrent("Content-Length + Transfer-Encoding: identity stays identity", async () => {
    await using server = createServer((req, res) => {
      res.setHeader("Content-Length", "2");
      res.setHeader("Transfer-Encoding", "identity");
      res.end("ok");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { head, body } = await rawGet((server.address() as AddressInfo).port, "/");
    expect(normalizeHead(head)).toBe(
      "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nTransfer-Encoding: identity\r\nConnection: close",
    );
    expect(body).toBe("ok");
  });

  test.concurrent("Transfer-Encoding: chunked alone is chunked (unchanged)", async () => {
    await using server = createServer((req, res) => {
      res.setHeader("Transfer-Encoding", "chunked");
      res.write("ab");
      res.end("cd");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { head, body } = await rawGet((server.address() as AddressInfo).port, "/");
    expect(normalizeHead(head)).toBe("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close");
    expect(body).toBe("2\r\nab\r\n2\r\ncd\r\n0\r\n\r\n");
  });
});
