import { describe, expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import { createServer, request } from "http";
import { createServer as createHttpsServer } from "https";
import { AddressInfo, connect, Server } from "net";
import { connect as tlsConnect } from "tls";

function expectResetBeforeClose(err) {
  expect(["ECONNRESET", "EPIPE"]).toContain(err.code);
}

test.each([0, 1024])("chunked trailer section is bounded when maxHeaderSize is %d", async maxHeaderSize => {
  let sawRequestEnd = false;
  const server = createServer({ maxHeaderSize }, (req, res) => {
    req.resume();
    req.on("end", () => {
      sawRequestEnd = true;
      res.end("done");
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const socket = connect((server.address() as AddressInfo).port, "127.0.0.1");
    await once(socket, "connect");
    let response = "";
    socket.on("data", chunk => (response += chunk.toString()));
    socket.on("error", () => {});
    const closed = once(socket, "close").catch(expectResetBeforeClose);
    socket.write("POST / HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n");
    const junkLine = Buffer.from("x-trailer-flood: yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy\r\n");
    for (let sent = 0; sent < 64 * 1024; sent += junkLine.length) {
      socket.write(junkLine);
    }
    await closed;
    expect(response).not.toContain("HTTP/1.1 200");
    expect(sawRequestEnd).toBe(false);
  } finally {
    server.close();
  }
});

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

// llhttp flags Transfer-Encoding as present only once a non-whitespace value
// byte arrives, so node treats a TE field with an empty (or whitespace-only)
// value as if the header were absent: no clientError, Content-Length framing
// applies. oven-sh/bun#40124: Bun served the request AND fired a spurious
// clientError, so a typical handler destroyed the live connection.
test.each([
  ["empty", ""],
  ["whitespace-only", "   "],
])("%s Transfer-Encoding value is ignored like node, no clientError", async (name, te) => {
  const events: string[] = [];
  await using server = createServer((req, res) => {
    events.push(`request ${req.url}`);
    res.end("ok");
  });
  server.on("clientError", (err: any, socket) => {
    events.push(`clientError ${err.code}`);
    socket.destroy();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const { promise, resolve } = Promise.withResolvers<string>();
  // Pipeline a second request: the spurious clientError kills the
  // connection after the first response, so /b proves it survived.
  const socket = connect(port, "127.0.0.1", () => {
    socket.write(
      `GET /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding:${te}\r\n\r\n` +
        "GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    );
  });
  let raw = "";
  socket.on("data", chunk => (raw += chunk.toString()));
  socket.on("error", () => {});
  socket.on("close", () => resolve(raw));
  const response = await promise;
  expect(events).toEqual(["request /a", "request /b"]);
  expect(response.match(/HTTP\/1\.1 200/g)).toHaveLength(2);
});

test("empty Transfer-Encoding with Content-Length frames the body like node", async () => {
  const events: string[] = [];
  await using server = createServer((req, res) => {
    let body = "";
    req.on("data", d => (body += d));
    req.on("end", () => {
      events.push(`request ${req.url} body=${body}`);
      res.end("ok");
    });
  });
  server.on("clientError", (err: any, socket) => {
    events.push(`clientError ${err.code}`);
    socket.destroy();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const { promise, resolve } = Promise.withResolvers<string>();
  const socket = connect(port, "127.0.0.1", () => {
    socket.write(
      "POST /p HTTP/1.1\r\nHost: x\r\nTransfer-Encoding:\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello",
    );
  });
  let raw = "";
  socket.on("data", chunk => (raw += chunk.toString()));
  socket.on("error", () => {});
  socket.on("close", () => resolve(raw));
  const response = await promise;
  expect(events).toEqual(["request /p body=hello"]);
  expect(response).toStartWith("HTTP/1.1 200");
});

// An empty field followed by "Transfer-Encoding: chunked" combines to just
// "chunked" (RFC 9110 5.6.1). llhttp frames the body as chunked and node
// delivers it. The has-body decision must look at every Transfer-Encoding
// field: reading only the first one sees an empty value and drops the body.
test.each([
  ["empty", ""],
  ["whitespace-only", "   "],
])("%s Transfer-Encoding field followed by chunked delivers the body like node", async (name, te) => {
  const events: string[] = [];
  await using server = createServer((req, res) => {
    let body = "";
    req.on("data", d => (body += d));
    req.on("end", () => {
      events.push(`request ${req.url} body=${body}`);
      res.end("ok");
    });
  });
  server.on("clientError", (err: any, socket) => {
    events.push(`clientError ${err.code}`);
    socket.destroy();
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const { promise, resolve } = Promise.withResolvers<string>();
  const socket = connect(port, "127.0.0.1", () => {
    socket.write(
      `POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding:${te}\r\nTransfer-Encoding: chunked\r\n\r\n` +
        "5\r\nhello\r\n0\r\n\r\n" +
        "GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    );
  });
  let raw = "";
  socket.on("data", chunk => (raw += chunk.toString()));
  socket.on("error", () => {});
  socket.on("close", () => resolve(raw));
  const response = await promise;
  expect(events).toEqual(["request /a body=hello", "request /b body="]);
  expect(response.match(/HTTP\/1\.1 200/g)).toHaveLength(2);
});

// Boundary of the leniency: node errors once any non-whitespace value byte
// arrives, even one that names no coding.
test("comma-only Transfer-Encoding value still fires clientError like node", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<any>();
  const urls: string[] = [];
  await using server = createServer((req, res) => {
    urls.push(req.url!);
    req.resume();
    res.end("ok");
  });
  server.on("clientError", (err, socket) => {
    socket.destroy();
    resolve(err);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  // Pipeline a follow-up with Connection: close so that, if the comma value
  // were wrongly treated as absent, /b is served and the socket closes,
  // rejecting below instead of idling on keep-alive until the test times out.
  const socket = connect(port, "127.0.0.1", () => {
    socket.write(
      "GET /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: ,\r\n\r\n" +
        "GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    );
  });
  socket.resume();
  socket.on("error", () => {});
  socket.on("close", () => reject(new Error(`socket closed without clientError, served: ${urls.join(",")}`)));
  const err = await promise;
  socket.destroy();
  expect(err.code).toBe("HPE_INVALID_TRANSFER_ENCODING");
  expect(urls).toEqual(["/a"]);
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
  socket.on("close", () => reject(new Error("connection closed without clientError")));
  const err = await promise;
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
  socket.on("close", () => reject(new Error("connection closed without clientError")));
  const result = await promise;
  socket.destroy();
  expect("err" in result).toBe(true);
});

test("CTL byte in a trailer value fires clientError HPE_INVALID_HEADER_TOKEN", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<any>();
  await using server = createServer((req, res) => {
    req.resume();
    // Completing the request would mean the malformed trailer was silently dropped (node fails the message).
    req.on("end", () => reject(new Error("request completed despite a malformed trailer")));
  });
  server.on("clientError", (err, socket) => {
    socket.destroy();
    resolve(err);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1", () => {
    socket.write(
      "POST / HTTP/1.1\r\nHost: x\r\nTrailer: X-T\r\nTransfer-Encoding: chunked\r\n\r\n1\r\na\r\n0\r\nX-T: a\bb\r\n\r\n",
    );
  });
  socket.on("error", () => {});
  const err = await promise;
  socket.destroy();
  expect(err.code).toBe("HPE_INVALID_HEADER_TOKEN");
});

test("insecureHTTPParser accepts a CTL byte in a trailer value like node", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<{ trailers: any; raw: string[] }>();
  await using server = createServer({ insecureHTTPParser: true }, (req, res) => {
    req.resume();
    req.on("end", () => {
      resolve({ trailers: { ...req.trailers }, raw: [...req.rawTrailers] });
      res.end("ok");
    });
  });
  server.on("clientError", (err, socket) => {
    socket.destroy();
    reject(err);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1", () => {
    socket.write(
      "POST / HTTP/1.1\r\nHost: x\r\nTrailer: X-T\r\nTransfer-Encoding: chunked\r\n\r\n1\r\na\r\n0\r\nX-T: a\bb\r\n\r\n",
    );
  });
  socket.on("error", reject);
  const result = await promise;
  socket.destroy();
  expect(result).toEqual({ trailers: { "x-t": "a\bb" }, raw: ["X-T", "a\bb"] });
});

// RFC 9110 6.5.1: framing fields (Content-Length, Transfer-Encoding) are forbidden
// in trailers. llhttp runs trailers through the same header state machine and the
// already-set F_CHUNKED collides, so node rejects both before the body completes.
for (const { field, value, code } of [
  { field: "Content-Length", value: "5", code: "HPE_INVALID_CONTENT_LENGTH" },
  { field: "content-length", value: "5", code: "HPE_INVALID_CONTENT_LENGTH" },
  { field: "Transfer-Encoding", value: "chunked", code: "HPE_INVALID_TRANSFER_ENCODING" },
  { field: "Transfer-Encoding", value: "gzip", code: "HPE_INVALID_TRANSFER_ENCODING" },
  { field: "transfer-encoding", value: "chunked", code: "HPE_INVALID_TRANSFER_ENCODING" },
]) {
  test(`${field}: ${value} in trailer section fires clientError ${code}`, async () => {
    const { promise, resolve } = Promise.withResolvers<{ err?: any; trailers?: any }>();
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
      socket.write(
        "POST /a HTTP/1.1\r\nHost: h\r\nTransfer-Encoding: chunked\r\n\r\n" +
          `5\r\nHELLO\r\n0\r\n${field}: ${value}\r\n\r\n`,
      );
    });
    socket.on("error", () => {});
    const result = await promise;
    socket.destroy();
    expect(result.err?.code).toBe(code);
    expect(result.trailers).toBeUndefined();
  });
}

test("framing field in trailers is rejected before a pipelined follow-up is served", async () => {
  const paths: string[] = [];
  await using server = createServer((req, res) => {
    paths.push(req.url!);
    req.resume();
    req.on("end", () => res.end(`u=${req.url} trailers=${JSON.stringify(req.trailers)}`));
  });
  server.on("clientError", (err, socket) => {
    try {
      socket.end(`HTTP/1.1 400 x\r\nx-cerr: ${(err as any).code}\r\nconnection: close\r\n\r\n`);
    } catch {}
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const { promise, resolve } = Promise.withResolvers<string>();
  const socket = connect(port, "127.0.0.1", () => {
    socket.write(
      "POST /a HTTP/1.1\r\nHost: h\r\nTransfer-Encoding: chunked\r\n\r\n" +
        "5\r\nHELLO\r\n0\r\nContent-Length: 5\r\n\r\n" +
        "GET /after HTTP/1.1\r\nHost: h\r\nConnection: close\r\n\r\n",
    );
  });
  let wire = "";
  socket.on("data", d => (wire += d));
  socket.on("error", () => {});
  socket.on("close", () => resolve(wire));
  const response = await promise;
  expect(response).toContain("x-cerr: HPE_INVALID_CONTENT_LENGTH");
  expect(response).not.toContain('content-length":"5"');
  expect(response).not.toContain("u=/after");
  expect(paths).toEqual(["/a"]);
});

test("insecureHTTPParser accepts Content-Length / Transfer-Encoding in trailers like node", async () => {
  for (const { field, value } of [
    { field: "Content-Length", value: "5" },
    { field: "Transfer-Encoding", value: "chunked" },
  ]) {
    const { promise, resolve, reject } = Promise.withResolvers<{ trailers: any; raw: string[] }>();
    await using server = createServer({ insecureHTTPParser: true }, (req, res) => {
      req.resume();
      req.on("end", () => {
        resolve({ trailers: { ...req.trailers }, raw: [...req.rawTrailers] });
        res.end("ok");
      });
    });
    server.on("clientError", (err, socket) => {
      socket.destroy();
      reject(err);
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const socket = connect(port, "127.0.0.1", () => {
      socket.write(
        "POST / HTTP/1.1\r\nHost: h\r\nTransfer-Encoding: chunked\r\n\r\n" +
          `5\r\nHELLO\r\n0\r\n${field}: ${value}\r\n\r\n`,
      );
    });
    socket.on("error", reject);
    const result = await promise;
    socket.destroy();
    expect(result).toEqual({ trailers: { [field.toLowerCase()]: value }, raw: [field, value] });
  }
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
  socket.on("close", () => reject(new Error("connection closed without clientError")));
  const err = await promise;
  socket.destroy();
  expect(err.code).toBe("HPE_HEADER_OVERFLOW");
});

test("pipelined responses arrive in request order when handlers complete out of order", async () => {
  await using server = createServer((req, res) => {
    if (req.url === "/1") setImmediate(() => res.end("/1"));
    else res.end(req.url);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const socket = connect(port, "127.0.0.1", () => {
    socket.write(
      "GET /1 HTTP/1.1\r\nHost: x\r\n\r\n" +
        "GET /2 HTTP/1.1\r\nHost: x\r\n\r\n" +
        "GET /3 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    );
  });
  let out = "";
  socket.on("data", chunk => (out += chunk.toString()));
  socket.on("close", () => resolve(out));
  socket.on("error", reject);
  const raw = await promise;
  // Response bodies must appear in wire order /1 /2 /3 even though /2 and /3
  // completed before /1 in the handler.
  expect(raw).toMatch(/\/1[\s\S]*HTTP\/1\.1 200[\s\S]*\/2[\s\S]*HTTP\/1\.1 200[\s\S]*\/3/);
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

// Node validates the `Trailer` response header in _storeHeader, after it has decided the
// body framing. Bun's server frames the body natively and never sets
// `res.chunkedEncoding`, so the check has to recompute that decision instead of reading
// it, or it rejects every `Trailer` header.
function collectResponse(handler: (req: any, res: any) => void) {
  const done = Promise.withResolvers<{ raw: Buffer; thrown: string | null }>();
  let thrown: string | null = null;
  const server = createServer((req, res) => {
    try {
      handler(req, res);
    } catch (err: any) {
      thrown = err.code ?? err.message;
      res.end();
    }
  });
  once(server.listen(0, "127.0.0.1"), "listening").then(() => {
    const { port } = server.address() as AddressInfo;
    const socket = connect(port, "127.0.0.1", () => {
      socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    });
    const chunks: Buffer[] = [];
    socket.on("data", c => chunks.push(c));
    socket.on("error", done.reject);
    socket.on("end", () => {
      server.close();
      done.resolve({ raw: Buffer.concat(chunks), thrown });
    });
  }, done.reject);
  return done.promise;
}

test("Trailer response header is allowed on a chunked response", async () => {
  const { raw, thrown } = await collectResponse((req, res) => {
    res.writeHead(200, { Trailer: "X-Foo" });
    res.write("hi");
    res.addTrailers({ "X-Foo": String.fromCharCode(0xe9) });
    res.end();
  });
  expect(thrown).toBeNull();
  const text = raw.toString("latin1");
  expect(text).toMatch(/^trailer: X-Foo$/im);
  expect(text).toMatch(/transfer-encoding: chunked/i);
  expect(text).toMatch(/^X-Foo: \xe9$/im);
  // obs-text goes on the wire as Latin-1 (0xE9), never UTF-8 (0xC3 0xA9).
  expect(raw.includes(0xe9)).toBe(true);
  expect(raw.includes(Buffer.from([0xc3, 0xa9]))).toBe(false);
});

test("Trailer response header is allowed with an explicit Transfer-Encoding: chunked", async () => {
  const { raw, thrown } = await collectResponse((req, res) => {
    res.writeHead(200, { Trailer: "X-Foo", "Transfer-Encoding": "chunked" });
    res.write("hi");
    res.addTrailers({ "X-Foo": "bar" });
    res.end();
  });
  expect(thrown).toBeNull();
  expect(raw.toString("latin1")).toMatch(/^x-foo: bar$/im);
});

test("Trailer response header with Content-Length throws ERR_HTTP_TRAILER_INVALID", async () => {
  const { raw, thrown } = await collectResponse((req, res) => {
    res.writeHead(200, { "Content-Length": "2", Trailer: "X-Foo" });
    res.end("hi");
  });
  expect(thrown).toBe("ERR_HTTP_TRAILER_INVALID");
  expect(raw.toString("latin1")).not.toMatch(/^trailer:/im);
});

test("Trailer response header on a body-less status throws ERR_HTTP_TRAILER_INVALID", async () => {
  for (const status of [204, 304]) {
    const { raw, thrown } = await collectResponse((req, res) => {
      res.writeHead(status, { Trailer: "X-Foo" });
      res.end();
    });
    expect(thrown).toBe("ERR_HTTP_TRAILER_INVALID");
    expect(raw.toString("latin1")).not.toMatch(/^trailer:/im);
  }
});

// The trailer section is captured on the CONNECTION during the parse. Both
// tests pipeline two requests in one TCP segment, so the second request's
// parse runs before the first request's handler drains its trailers; only a
// per-REQUEST snapshot at each body's fin keeps them apart.

test("pipelined request whose body is never read does not inherit trailers", async () => {
  const done = Promise.withResolvers<{ trailers: object; raw: string[] }>();
  await using server = createServer((req, res) => {
    if (req.method === "POST") {
      // Never read the body; answer on a later tick so /b is pipelined behind it.
      setImmediate(() => res.end("a"));
      return;
    }
    req.resume();
    req.on("end", () => {
      res.end("b");
      done.resolve({ trailers: { ...req.trailers }, raw: [...req.rawTrailers] });
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1", () => {
    socket.write(
      "POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nTrailer: X-T\r\n\r\n0\r\nX-T: leak\r\n\r\n" +
        "GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    );
  });
  socket.on("error", done.reject);
  socket.resume();
  const got = await done.promise;
  socket.destroy();
  expect(got).toEqual({ trailers: {}, raw: [] });
});

test("pipelined chunked request keeps its own trailers when the next one is parsed first", async () => {
  // /a is chunked with its own trailer and its body is read two ticks late; /b, a
  // second chunked request in the SAME segment, has a different one. /b's parse
  // overwrites the connection's trailer buffer before /a's late drain runs, so
  // without the per-request snapshot /a receives /b's trailers instead of its own.
  const done = Promise.withResolvers<Record<string, string | string[] | undefined>>();
  await using server = createServer((req, res) => {
    if (req.url === "/a") {
      setImmediate(() =>
        setImmediate(() => {
          req.resume();
          req.on("end", () => {
            res.setHeader("Content-Length", "1");
            res.end("a");
            done.resolve({ ...req.trailers });
          });
        }),
      );
      return;
    }
    req.resume();
    req.on("end", () => {
      res.setHeader("Content-Length", "1");
      res.end("b");
    });
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const socket = connect(port, "127.0.0.1", () => {
    socket.write(
      "POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nTrailer: X-A\r\n\r\n0\r\nX-A: a\r\n\r\n" +
        "POST /b HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nTrailer: X-B\r\n\r\n0\r\nX-B: b\r\n\r\n",
    );
  });
  socket.on("error", done.reject);
  socket.resume();
  const trailers = await done.promise;
  socket.destroy();
  expect(trailers).toEqual({ "x-a": "a" });
});

// Once the header section is on the wire, tearing a response down (res.destroy(),
// req.destroy(), a handler throwing) must not write anything else: the header
// terminator is gone, so header bytes would land inside the body. Node writes
// nothing and closes the socket; these tests pin the bytes received after the
// header section to exactly what the handler wrote before the teardown.
describe("tearing down a response with its headers on the wire adds no bytes", () => {
  // Sends one raw request, waits until `marker` (the part of the response the
  // handler wrote) has arrived so the handler's teardown runs with those bytes
  // already flushed, then returns what arrived after the header section once
  // the server closed the connection.
  async function bodyAfterTeardown({
    handler,
    marker,
    request = "GET / HTTP/1.1\r\nHost: x\r\n\r\n",
    https = false,
  }: {
    handler: (req: any, res: any, markerArrived: Promise<void>) => void;
    marker: string;
    request?: string;
    https?: boolean;
  }) {
    const markerArrived = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    const listener = (req: any, res: any) => handler(req, res, markerArrived.promise);
    await using server = https ? createHttpsServer(tlsCert, listener) : createServer(listener);
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const socket = https
      ? tlsConnect({ port, host: "127.0.0.1", rejectUnauthorized: false }, () => socket.write(request))
      : connect(port, "127.0.0.1", () => socket.write(request));
    let raw = "";
    socket.on("data", (chunk: Buffer) => {
      raw += chunk.toString("latin1");
      if (raw.includes(marker)) markerArrived.resolve();
    });
    // The teardown may surface as ECONNRESET; what matters is what arrived before 'close'.
    socket.on("error", () => {});
    socket.on("close", closed.resolve);
    await closed.promise;

    const headerEnd = raw.indexOf("\r\n\r\n");
    expect(raw.slice(0, headerEnd)).toStartWith("HTTP/1.1 200 OK\r\n");
    return raw.slice(headerEnd + 4);
  }

  test.concurrent("res.destroy() after res.write() on a chunked response", async () => {
    const body = await bodyAfterTeardown({
      marker: "hello",
      handler(req, res, markerArrived) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("hello");
        markerArrived.then(() => res.destroy());
      },
    });
    expect(body).toBe("5\r\nhello\r\n");
  });

  test.concurrent("res.destroy() after res.flushHeaders() on a chunked response", async () => {
    const body = await bodyAfterTeardown({
      marker: "\r\n\r\n",
      handler(req, res, markerArrived) {
        res.writeHead(200);
        res.flushHeaders();
        markerArrived.then(() => res.destroy());
      },
    });
    expect(body).toBe("");
  });

  test.concurrent("res.destroy() after res.write() on a Content-Length response", async () => {
    const body = await bodyAfterTeardown({
      marker: "hello",
      handler(req, res, markerArrived) {
        res.writeHead(200, { "content-length": "10" });
        res.write("hello");
        markerArrived.then(() => res.destroy());
      },
    });
    expect(body).toBe("hello");
  });

  test.concurrent("res.destroy() after res.write() on an HTTP/1.0 (close-delimited) response", async () => {
    const body = await bodyAfterTeardown({
      marker: "hello",
      request: "GET / HTTP/1.0\r\nHost: x\r\n\r\n",
      handler(req, res, markerArrived) {
        res.writeHead(200);
        res.write("hello");
        markerArrived.then(() => res.destroy());
      },
    });
    expect(body).toBe("hello");
  });

  test.concurrent("req.destroy() after res.write() on a chunked response", async () => {
    const body = await bodyAfterTeardown({
      marker: "hello",
      handler(req, res, markerArrived) {
        res.writeHead(200);
        res.write("hello");
        markerArrived.then(() => req.destroy());
      },
    });
    expect(body).toBe("5\r\nhello\r\n");
  });

  test.concurrent("res.destroy() after res.write() on a chunked https response", async () => {
    const body = await bodyAfterTeardown({
      https: true,
      marker: "hello",
      handler(req, res, markerArrived) {
        res.writeHead(200);
        res.write("hello");
        markerArrived.then(() => res.destroy());
      },
    });
    expect(body).toBe("5\r\nhello\r\n");
  });

  // A synchronous throw out of the request listener is ended natively by the
  // server dispatch rather than by res.destroy(); same rule applies. Runs in a
  // child because the throw reaches uncaughtException.
  test.concurrent("request listener throwing after res.write() on a chunked response", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { createServer } = require("node:http");
        const { connect } = require("node:net");
        process.on("uncaughtException", err => {
          if (err.message !== "boom") throw err;
        });
        const server = createServer((req, res) => {
          res.writeHead(200);
          res.write("hello");
          throw new Error("boom");
        });
        server.listen(0, "127.0.0.1", () => {
          const socket = connect(server.address().port, "127.0.0.1", () => {
            socket.write("GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
          });
          let raw = "";
          socket.on("data", chunk => (raw += chunk.toString("latin1")));
          socket.on("error", () => {});
          socket.on("close", () => {
            console.log(JSON.stringify(raw.slice(raw.indexOf("\\r\\n\\r\\n") + 4)));
            server.close();
          });
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toBe("5\r\nhello\r\n");
    expect(exitCode).toBe(0);
  });
});
