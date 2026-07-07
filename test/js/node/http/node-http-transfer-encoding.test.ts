import { expect, test } from "bun:test";
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

// Value lengths landing parseTrailerFields' 8-byte field-value scan on the
// alignments where its last load reaches past the terminating CRLF CRLF: that
// read leaves the heap allocation without the section's post-padding (ASAN).
test("chunked request trailers parse at every field-value scan boundary", async () => {
  const seen: { trailers: Record<string, string | string[] | undefined>; raw: string[] }[] = [];
  await using server = createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      seen.push({ trailers: { ...req.trailers }, raw: [...req.rawTrailers] });
      res.end("ok");
    });
  });

  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const values = [7, 8, 15, 31, 63].map(n => Buffer.alloc(n, "v").toString());
  for (const value of values) {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        "POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nTrailer: X-Boundary\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n" +
          "3\r\nabc\r\n" +
          `0\r\nX-Boundary: ${value}\r\n\r\n`,
      );
    });

    let rawResponse = "";
    socket.on("data", (chunk: Buffer) => {
      rawResponse += chunk.toString();
    });
    socket.on("end", () => resolve(rawResponse));
    socket.on("error", reject);
    expect((await promise).split("\r\n\r\n").at(-1)).toBe("ok");
  }

  expect(seen).toEqual(values.map(value => ({ trailers: { "x-boundary": value }, raw: ["X-Boundary", value] })));
});

test("bare-LF in trailer section fires clientError instead of hanging", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<any>();
  await using server = createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end("ok"));
  });
  server.on("clientError", (err, socket) => {
    socket.destroy();
    resolve(err);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1", () => {
    // "0\r\n\n" — bare LF where the trailer-terminating CRLF belongs
    socket.write("POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\n");
  });
  socket.on("error", () => {});
  const timer = setTimeout(() => reject(new Error("hang: no clientError within 2s")), 2000);
  const err = await promise;
  clearTimeout(timer);
  socket.destroy();
  expect(err.code).toMatch(/^HPE_/);
});

test("bare-LF between trailer fields is rejected, not silently accepted", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<{ trailers: any } | { err: any }>();
  await using server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      resolve({ trailers: { ...req.trailers } });
      res.end("ok");
    });
  });
  server.on("clientError", (err, socket) => {
    socket.destroy();
    resolve({ err });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1", () => {
    // Foo: bar\nBaz: qux — bare LF mid-section, but tail matches \r\n\r\n
    socket.write("POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nFoo: bar\nBaz: qux\r\n\r\n");
  });
  socket.on("error", () => {});
  const timer = setTimeout(() => reject(new Error("hang")), 2000);
  const result = await promise;
  clearTimeout(timer);
  socket.destroy();
  expect("err" in result).toBe(true);
});

test("createServer({maxHeaderSize:0}) still bounds trailer section", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<any>();
  await using server = createServer({ maxHeaderSize: 0 }, (req, res) => {
    req.resume();
    req.on("end", () => res.end("ok"));
  });
  server.on("clientError", (err, socket) => {
    socket.destroy();
    resolve(err);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const big = Buffer.alloc(20 * 1024, "a").toString();
  const socket = connect(port, "127.0.0.1", () => {
    socket.write("POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n" + `0\r\nX-Big: ${big}\r\n\r\n`);
  });
  socket.on("error", () => {});
  const timer = setTimeout(() => reject(new Error("no clientError for 20KB trailer under maxHeaderSize:0")), 2000);
  const err = await promise;
  clearTimeout(timer);
  socket.destroy();
  // Tightened to HPE_HEADER_OVERFLOW once the trailer-overflow error code is
  // wired distinctly (currently reported as HPE_INTERNAL).
  expect(err.code).toMatch(/^HPE_/);
});

test("pipelined non-chunked request does not read prior request's trailers", async () => {
  const seen: any[] = [];
  const done = Promise.withResolvers<void>();
  await using server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      seen.push({ url: req.url, trailers: { ...req.trailers }, raw: [...req.rawTrailers] });
      res.end("ok");
      if (seen.length === 2) done.resolve();
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1", () => {
    socket.write(
      "POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\nX-T: leak\r\n\r\n" +
        "GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    );
  });
  socket.on("error", done.reject);
  socket.resume();
  await done.promise;
  socket.destroy();
  expect(seen).toEqual([
    { url: "/a", trailers: { "x-t": "leak" }, raw: ["X-T", "leak"] },
    { url: "/b", trailers: {}, raw: [] },
  ]);
});
