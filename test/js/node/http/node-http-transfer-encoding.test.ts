import { describe, expect, test } from "bun:test";
import { once } from "events";
import { bunEnv, bunExe, tls as tlsCert } from "harness";
import { createServer, request } from "http";
import { createServer as createHttpsServer } from "https";
import { AddressInfo, connect, Server } from "net";
import type { Duplex } from "stream";
import { connect as tlsConnect } from "tls";
// The llhttp binding. It has no type declarations, like in node-http-parser.test.ts.
const { HTTPParser, calculateLenientFlags } = require("node:_http_common");

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

// llhttp checks a Transfer-Encoding field against an already-seen Content-Length
// when the field name completes, before it reads the value. So the leniency
// above is one-directional: an empty field before Content-Length is ignored,
// the same field after Content-Length fails the request, and no 'request' is
// emitted because the head never completes.
describe("empty Transfer-Encoding field relative to Content-Length", () => {
  // The pipelined GET carries Connection: close so the socket closes (and the
  // test finishes) whether the POST is rejected or wrongly served.
  async function send(headers: string[], options: { insecureHTTPParser?: boolean } = {}) {
    const events: string[] = [];
    await using server = createServer(options, (req, res) => {
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
        `POST /p HTTP/1.1\r\nHost: x\r\n${headers.join("\r\n")}\r\n\r\nhello` +
          "GET /after HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
      );
    });
    let raw = "";
    socket.on("data", chunk => (raw += chunk.toString()));
    socket.on("error", () => {});
    socket.on("close", () => resolve(raw));
    const response = await promise;
    return { events, statuses: response.match(/HTTP\/1\.1 \d+/g) ?? [] };
  }

  test.each([
    ["empty", ["Content-Length: 5", "Transfer-Encoding:"]],
    ["whitespace-only", ["Content-Length: 5", "Transfer-Encoding:   "]],
    ["a second empty", ["Transfer-Encoding:", "Content-Length: 5", "Transfer-Encoding:"]],
  ])("%s Transfer-Encoding after Content-Length fires clientError like node", async (name, headers) => {
    expect(await send(headers)).toEqual({
      events: ["clientError HPE_INVALID_TRANSFER_ENCODING"],
      statuses: [],
    });
  });

  test("two empty Transfer-Encoding fields before Content-Length are ignored like node", async () => {
    expect(await send(["Transfer-Encoding:", "Transfer-Encoding:", "Content-Length: 5"])).toEqual({
      events: ["request /p body=hello", "request /after body="],
      statuses: ["HTTP/1.1 200", "HTTP/1.1 200"],
    });
  });

  // kLenientAll (insecureHTTPParser) includes LENIENT_CHUNKED_LENGTH, which
  // skips llhttp's name check, so the empty value is ignored in either order.
  test("insecureHTTPParser ignores an empty Transfer-Encoding after Content-Length like node", async () => {
    expect(await send(["Content-Length: 5", "Transfer-Encoding:"], { insecureHTTPParser: true })).toEqual({
      events: ["request /p body=hello", "request /after body="],
      statuses: ["HTTP/1.1 200", "HTTP/1.1 200"],
    });
  });
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

// llhttp flags a request as an upgrade when it is a CONNECT, or when it has an Upgrade header and
// the "upgrade" token in Connection. It takes that verdict before it checks Transfer-Encoding, so
// such a request with no chunked coding and no Content-Length ends at its head. Node raises no
// HPE_INVALID_TRANSFER_ENCODING for it, whether or not the server accepts the upgrade.
// Every expectation below is Node v26.3.0's.
describe("Transfer-Encoding without chunked on a CONNECT or Upgrade request", () => {
  type ServerOptions = { insecureHTTPParser?: boolean; httpValidation?: "relaxed" };
  const connectHead = (te: string, version = "1.1") =>
    `CONNECT example.com:80 HTTP/${version}\r\nHost: example.com:80\r\nTransfer-Encoding: ${te}\r\n\r\n`;
  const upgradeHead = (te: string, connection: string, upgrade = "Upgrade: x", version = "1.1") =>
    `GET /a HTTP/${version}\r\nHost: x\r\n${connection}\r\n${upgrade}\r\nTransfer-Encoding: ${te}\r\n\r\n`;

  // llhttp's own verdict on a head, so that each table below is checked against the parser it
  // mirrors: the upgrade flag that llhttp passes to kOnHeadersComplete, and the error of execute().
  function llhttpVerdict(head: string, options: ServerOptions = {}) {
    const parser = new HTTPParser();
    parser.initialize(
      HTTPParser.REQUEST,
      {},
      0,
      calculateLenientFlags(options.httpValidation, options.insecureHTTPParser),
    );
    let upgrade: boolean | undefined;
    parser[HTTPParser.kOnHeadersComplete] = (...args: unknown[]) => {
      upgrade = args[7] as boolean;
      return 0;
    };
    const result = parser.execute(Buffer.from(head));
    parser.close();
    return { upgrade, error: result instanceof Error ? (result as NodeJS.ErrnoException).code : undefined };
  }

  type Handoff = {
    name: string;
    event: "connect" | "upgrade";
    head: string;
    options?: ServerOptions;
    // The client writes a whole GET first, in the same write as the head.
    behindGet?: boolean;
    // With behindGet: that write stops this many bytes into the head. The client sends the rest
    // once the GET is answered, so the head reaches the parser in two reads.
    splitAt?: number;
  };

  async function handoff({ event, head, options = {}, behindGet, splitAt }: Handoff) {
    const events: string[] = [];
    await using server = createServer(options, (req, res) => {
      events.push(`request ${req.url}`);
      res.end(`answer ${req.url}`);
    });
    server.on("clientError", (err: any, socket) => {
      events.push(`clientError ${err.code}`);
      socket.destroy();
    });
    const accepted =
      event === "connect"
        ? "HTTP/1.1 200 Connection established\r\n\r\n"
        : "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n";
    const afterAccepted = "sent after the response";
    let tunneled = "";
    server.on(event, (req, socket, head) => {
      events.push(`${event} head=${head}`);
      socket.on("data", chunk => {
        tunneled += chunk;
        if (tunneled.length >= afterAccepted.length) socket.end();
      });
      socket.on("error", () => {});
      // A connection that served a request before is handed over corked, and the write below
      // stays buffered: https://github.com/oven-sh/bun/issues/43342
      if (behindGet) socket.uncork();
      socket.write(accepted);
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    // Every outcome closes the client: the handed-over socket ends once it has all the bytes,
    // and a 'clientError' destroys it.
    const { promise, resolve } = Promise.withResolvers<string>();
    const get = behindGet ? "GET /first HTTP/1.1\r\nHost: x\r\n\r\n" : "";
    const withHead = head + "sent with the head";
    let raw = "";
    let sentRest = splitAt === undefined;
    let sentAfterAccepted = false;
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(get + (splitAt === undefined ? withHead : withHead.slice(0, splitAt)));
    });
    socket.on("data", chunk => {
      raw += chunk;
      if (!sentRest && raw.endsWith("answer /first")) {
        sentRest = true;
        socket.write(withHead.slice(splitAt));
      }
      if (!sentAfterAccepted && raw.endsWith(accepted)) {
        sentAfterAccepted = true;
        socket.write(afterAccepted);
      }
    });
    socket.on("error", () => {});
    socket.on("end", () => socket.end());
    socket.on("close", () => resolve(raw));

    const received = await promise;
    const afterGet = behindGet ? received.slice(received.indexOf("answer /first") + "answer /first".length) : received;
    return { afterGet, tunneled, events, accepted, afterAccepted };
  }

  const handoffs: Handoff[] = [
    { name: "CONNECT, gzip", event: "connect", head: connectHead("gzip") },
    { name: "CONNECT, identity", event: "connect", head: connectHead("identity") },
    { name: "CONNECT, two codings", event: "connect", head: connectHead("gzip, deflate") },
    { name: "CONNECT, two fields", event: "connect", head: connectHead("gzip\r\nTransfer-Encoding: deflate") },
    { name: "CONNECT, HTTP/1.0", event: "connect", head: connectHead("gzip", "1.0") },
    {
      name: "CONNECT, insecureHTTPParser",
      event: "connect",
      head: connectHead("gzip"),
      options: { insecureHTTPParser: true },
    },
    { name: "CONNECT pipelined behind a GET", event: "connect", head: connectHead("gzip"), behindGet: true },
    {
      name: "CONNECT after a GET, head split across two reads",
      event: "connect",
      head: connectHead("gzip"),
      behindGet: true,
      splitAt: 10,
    },
    { name: "Upgrade, gzip", event: "upgrade", head: upgradeHead("gzip", "Connection: Upgrade") },
    {
      name: "Upgrade, identity, Connection list",
      event: "upgrade",
      head: upgradeHead("identity", "Connection: keep-alive, Upgrade"),
    },
    { name: "Upgrade, comma-only value", event: "upgrade", head: upgradeHead(",", "Connection: upgrade") },
    {
      name: "Upgrade, empty field before the value",
      event: "upgrade",
      head: upgradeHead("gzip", "Connection: Upgrade", "Upgrade:\r\nUpgrade: x"),
    },
    {
      name: "Upgrade, tab before the Connection token",
      event: "upgrade",
      head: upgradeHead("gzip", "Connection: keep-alive,\tUpgrade"),
    },
    {
      name: "Upgrade, space after the Connection token",
      event: "upgrade",
      head: upgradeHead("gzip", "Connection: Upgrade "),
    },
    {
      name: "Upgrade, control byte after the token's comma, relaxed",
      event: "upgrade",
      head: upgradeHead("gzip", "Connection: upgrade, x\x01"),
      options: { httpValidation: "relaxed" },
    },
    {
      name: "Upgrade, HTTP/1.0",
      event: "upgrade",
      head: upgradeHead("gzip", "Connection: Upgrade", "Upgrade: x", "1.0"),
    },
    {
      name: "Upgrade, insecureHTTPParser",
      event: "upgrade",
      head: upgradeHead("gzip", "Connection: Upgrade"),
      options: { insecureHTTPParser: true },
    },
    {
      name: "Upgrade pipelined behind a GET",
      event: "upgrade",
      head: upgradeHead("gzip", "Connection: Upgrade"),
      behindGet: true,
    },
    {
      name: "Upgrade after a GET, head split across two reads",
      event: "upgrade",
      head: upgradeHead("gzip", "Connection: Upgrade"),
      behindGet: true,
      splitAt: 10,
    },
  ];

  async function expectHandoff(row: Handoff) {
    expect(llhttpVerdict(row.head, row.options)).toEqual({ upgrade: true, error: undefined });
    const { afterGet, tunneled, events, accepted, afterAccepted } = await handoff(row);
    expect({ afterGet, tunneled, events }).toEqual({
      afterGet: accepted,
      tunneled: afterAccepted,
      events: [...(row.behindGet ? ["request /first"] : []), `${row.event} head=sent with the head`],
    });
  }

  test.concurrent.each(handoffs)(
    "$name: the listener gets the head and a working socket, no clientError",
    expectHandoff,
  );

  // llhttp reads the token from Proxy-Connection too.
  test.concurrent.each<Handoff>([
    { name: "Upgrade, Proxy-Connection", event: "upgrade", head: upgradeHead("gzip", "Proxy-Connection: upgrade") },
  ])("$name: the listener gets the head and a working socket, no clientError", expectHandoff);

  test.concurrent.each([
    { name: "Connection", head: upgradeHead("gzip", "Connection: Upgrade") },
    { name: "Proxy-Connection", head: upgradeHead("gzip", "Proxy-Connection: upgrade") },
  ])("a declined upgrade ($name) is a request with no body and the connection stays open", async ({ head }) => {
    expect(llhttpVerdict(head)).toEqual({ upgrade: true, error: undefined });

    const events: string[] = [];
    // No 'upgrade' listener: the request goes to 'request'.
    await using server = createServer((req, res) => {
      let body = "";
      req.on("data", d => (body += d));
      req.on("end", () => {
        events.push(`request ${req.url} body=${body}`);
        res.end(`answer ${req.url}`);
      });
    });
    server.on("clientError", (err: any, socket) => {
      events.push(`clientError ${err.code}`);
      socket.destroy();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const { promise, resolve } = Promise.withResolvers<string>();
    let raw = "";
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(head);
    });
    socket.on("data", chunk => {
      raw += chunk;
      // Sent once /a is answered, not pipelined: node drops the rest of the read that holds a
      // declined upgrade.
      if (raw.endsWith("answer /a")) {
        socket.write("GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => resolve(raw));

    expect(await promise).toEndWith("answer /b");
    expect(events).toEqual(["request /a body=", "request /b body="]);
  });

  // The boundary. llhttp does not flag these heads as upgrades, so node dispatches 'request' and
  // then fails the framing. A coding after chunked fails before any dispatch.
  type Boundary = { name: string; head: string; options?: ServerOptions; expected?: string[] };
  const dispatched = ["request /a", "clientError HPE_INVALID_TRANSFER_ENCODING"];
  const notUpgrades: Boundary[] = [
    { name: "an Upgrade header without the Connection token", head: upgradeHead("gzip", "Connection: keep-alive") },
    {
      name: "the Connection token without an Upgrade header",
      head: "GET /a HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nTransfer-Encoding: gzip\r\n\r\n",
    },
    {
      name: "a CONNECT that names a coding after chunked",
      head: connectHead("chunked, gzip"),
      expected: ["clientError HPE_INVALID_TRANSFER_ENCODING"],
    },
    // The parser and the dispatcher share one upgrade verdict: https://github.com/oven-sh/bun/issues/43297
    {
      name: "an Upgrade header with an empty value",
      head: upgradeHead("gzip", "Connection: Upgrade", "Upgrade:"),
    },
    {
      name: "the Connection token inside a longer token",
      head: upgradeHead("gzip", "Connection: upgrade-x"),
    },
    {
      name: "the Connection token after another word",
      head: upgradeHead("gzip", "Connection: foo upgrade"),
    },
    {
      name: "a control byte before the Connection token, relaxed",
      head: upgradeHead("gzip", "Connection: keep-alive\x01, upgrade"),
      options: { httpValidation: "relaxed" },
    },
  ];

  async function eventsFor({ head, options = {} }: Boundary, withListeners: boolean) {
    const events: string[] = [];
    await using server = createServer(options, (req, res) => {
      events.push(`request ${req.url}`);
      res.end("ok");
    });
    for (const event of withListeners ? ["connect", "upgrade"] : []) {
      server.on(event, (req, socket) => {
        events.push(event);
        socket.destroy();
      });
    }
    server.on("clientError", (err: any, socket) => {
      events.push(`clientError ${err.code}`);
      socket.destroy();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    // Every outcome closes the client. If the header is wrongly ignored, the pipelined /b is
    // served with Connection: close, and a listener or the server destroys a handed-over socket.
    const { promise: closed, resolve: resolveClosed } = Promise.withResolvers<void>();
    const socket = connect(port, "127.0.0.1", () => {
      socket.write(head + "GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    });
    socket.resume();
    socket.on("error", () => {});
    socket.on("close", () => resolveClosed());
    await closed;
    return events;
  }

  test.concurrent.each(notUpgrades)("still fires clientError with $name", async row => {
    expect(llhttpVerdict(row.head, row.options).error).toBe("HPE_INVALID_TRANSFER_ENCODING");
    expect(await eventsFor(row, false)).toEqual(row.expected ?? dispatched);
  });

  test.concurrent.each(notUpgrades)(
    "still fires clientError with $name, with 'connect' and 'upgrade' listeners",
    async row => {
      expect(await eventsFor(row, true)).toEqual(row.expected ?? dispatched);
    },
  );
});

// llhttp sets F_CONNECTION_CLOSE from either field, so nothing behind this request is served.
test.each(["Connection", "Proxy-Connection"])("%s: close ends the connection after the response", async field => {
  const urls: string[] = [];
  const server = createServer((req, res) => {
    urls.push(req.url!);
    res.end("ok");
  });
  server.on("clientError", (_err, socket) => socket.destroy());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const socket = connect((server.address() as AddressInfo).port, "127.0.0.1");
    let received = "";
    socket.on("data", chunk => (received += chunk));
    socket.write(`GET /a HTTP/1.1\r\nHost: x\r\n${field}: close\r\n\r\nGET /b HTTP/1.1\r\nHost: x\r\n\r\n`);
    await once(socket, "close");
    expect({ urls, head: received.split("\r\n").filter(line => /^(HTTP|Connection)/.test(line)) }).toEqual({
      urls: ["/a"],
      head: ["HTTP/1.1 200 OK", "Connection: close"],
    });
  } finally {
    server.close();
  }
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

// llhttp gates these on LENIENT_CHUNKED_LENGTH and LENIENT_TRANSFER_ENCODING, which "relaxed" does not set.
test.each([
  ["Content-Length", "5", "HPE_INVALID_CONTENT_LENGTH"],
  ["Transfer-Encoding", "chunked", "HPE_INVALID_TRANSFER_ENCODING"],
])('httpValidation: "relaxed" rejects %s in trailers', async (field, value, code) => {
  const { promise, resolve } = Promise.withResolvers<string>();
  await using server = createServer({ httpValidation: "relaxed" } as any, (req, res) => {
    req.resume();
    req.on("end", () => {
      resolve("request completed");
      res.end("ok");
    });
  });
  server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
    socket.destroy();
    resolve(err.code!);
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const socket = connect((server.address() as AddressInfo).port, "127.0.0.1");
  socket.on("error", () => {});
  socket.write(
    `POST / HTTP/1.1\r\nHost: h\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nHELLO\r\n0\r\n${field}: ${value}\r\n\r\n`,
  );
  try {
    expect(await promise).toBe(code);
  } finally {
    socket.destroy();
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

// llhttp under LENIENT_TRANSFER_ENCODING (insecureHTTPParser: true, httpValidation: "insecure")
// accepts any Transfer-Encoding list. Its chunked verdict is the last element's. When that is not
// "chunked", the request has no body framing: every byte until the client ends the connection is
// the body (llhttp__after_headers_complete returns 4), and the body bytes are raw. The strict
// parser keeps rejecting such requests. The event sequences below are Node v26.3.0's.
//
// The client's FIN completes the unframed body, so the server answers after 'end' and needs
// server.httpAllowHalfOpen (without it Node ends the socket at the FIN and the response is lost).
describe("insecureHTTPParser: Transfer-Encoding without a final chunked coding", () => {
  const rawBody = "5\r\nHELLO\r\n0\r\n\r\n";

  async function run(
    teFields: string,
    options: { insecure?: boolean; httpValidation?: "insecure"; splitHead?: boolean; bodyAfterRequest?: boolean },
  ) {
    const events: string[] = [];
    const dispatched = Promise.withResolvers<void>();
    const serverOptions: any = {};
    if (options.insecure) serverOptions.insecureHTTPParser = true;
    if (options.httpValidation) serverOptions.httpValidation = options.httpValidation;
    await using server = createServer(serverOptions, (req, res) => {
      if (req.url === "/barrier") {
        res.end();
        return;
      }
      let body = "";
      req.on("data", d => (body += d));
      req.on("end", () => {
        events.push(`end body=${JSON.stringify(body)}`);
        res.end("ok");
      });
      events.push(`request ${req.method} ${req.url}`);
      dispatched.resolve();
    });
    server.httpAllowHalfOpen = true;
    server.on("clientError", (err: any, socket) => {
      events.push(`clientError ${err.code}`);
      socket.destroy();
      dispatched.resolve();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    let raw = "";
    socket.on("data", chunk => (raw += chunk.toString("latin1")));
    const closed = new Promise<void>(resolve => socket.on("close", () => resolve()));
    await once(socket, "connect");

    const head = `POST /p HTTP/1.1\r\nHost: x\r\n${teFields}\r\n\r\n`;
    if (options.splitHead) {
      // A partial head emits nothing on the server, so a whole request on a second connection
      // is the barrier: the server has read the first part once it has answered and closed
      // that connection. Then the second part reaches the parser in its own read.
      socket.write(head.slice(0, 20));
      const barrier = connect(port, "127.0.0.1");
      barrier.resume();
      barrier.end("GET /barrier HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      await once(barrier, "close");
      socket.write(head.slice(20) + rawBody.slice(0, 4));
    } else if (options.bodyAfterRequest) {
      socket.write(head);
    } else {
      socket.write(head + rawBody.slice(0, 4));
    }
    await dispatched.promise;
    // A chunked body ends at its 0-size chunk, an unframed one at the FIN.
    socket.end(options.bodyAfterRequest ? rawBody : rawBody.slice(4));
    await closed;
    return { events, raw };
  }

  const okEvents = (body: string) => ["request POST /p", `end body=${JSON.stringify(body)}`];

  test.concurrent.each([
    ["gzip", "Transfer-Encoding: gzip", rawBody],
    ["identity", "Transfer-Encoding: identity", rawBody],
    ["chunkedchunked", "Transfer-Encoding: chunkedchunked", rawBody],
    ["chunked, gzip", "Transfer-Encoding: chunked, gzip", rawBody],
    ["chunked, (trailing comma)", "Transfer-Encoding: chunked,", rawBody],
    ["chunked field then gzip field", "Transfer-Encoding: chunked\r\nTransfer-Encoding: gzip", rawBody],
    [
      "chunked field, empty field, gzip field",
      "Transfer-Encoding: chunked\r\nTransfer-Encoding:\r\nTransfer-Encoding: gzip",
      rawBody,
    ],
    ["chunked, chunked", "Transfer-Encoding: chunked, chunked", "HELLO"],
    ["chunked, gzip, chunked", "Transfer-Encoding: chunked, gzip, chunked", "HELLO"],
    ["chunked field then chunked field", "Transfer-Encoding: chunked\r\nTransfer-Encoding: chunked", "HELLO"],
    ["chunked field then empty field", "Transfer-Encoding: chunked\r\nTransfer-Encoding:", "HELLO"],
    ["gzip, chunked", "Transfer-Encoding: gzip, chunked", "HELLO"],
  ])("insecureHTTPParser reads the body of %s like node", async (_name, teFields, body) => {
    const { events, raw } = await run(teFields, { insecure: true });
    expect(events).toEqual(okEvents(body));
    expect(raw).toStartWith("HTTP/1.1 200");
    expect(raw).toEndWith("\r\n\r\nok");
  });

  test.concurrent('httpValidation: "insecure" reads the unframed body like node', async () => {
    const { events, raw } = await run("Transfer-Encoding: gzip", { httpValidation: "insecure" });
    expect(events).toEqual(okEvents(rawBody));
    expect(raw).toEndWith("\r\n\r\nok");
  });

  test.concurrent("the unframed body arrives in a read after the head", async () => {
    const { events, raw } = await run("Transfer-Encoding: chunked, gzip", { insecure: true, bodyAfterRequest: true });
    expect(events).toEqual(okEvents(rawBody));
    expect(raw).toEndWith("\r\n\r\nok");
  });

  test.concurrent("the head arrives in two reads", async () => {
    const { events, raw } = await run("Transfer-Encoding: gzip", { insecure: true, splitHead: true });
    expect(events).toEqual(okEvents(rawBody));
    expect(raw).toEndWith("\r\n\r\nok");
  });

  test.concurrent("a large unframed body is delivered whole", async () => {
    const big = Buffer.alloc(256 * 1024, "x").toString();
    const events: string[] = [];
    await using server = createServer({ insecureHTTPParser: true }, (req, res) => {
      let size = 0;
      req.on("data", d => (size += d.length));
      req.on("end", () => {
        events.push(`end size=${size}`);
        res.end("ok");
      });
    });
    server.httpAllowHalfOpen = true;
    server.on("clientError", (err: any, socket) => {
      events.push(`clientError ${err.code}`);
      socket.destroy();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    let raw = "";
    socket.on("data", chunk => (raw += chunk.toString("latin1")));
    const closed = new Promise<void>(resolve => socket.on("close", () => resolve()));
    await once(socket, "connect");
    socket.write(`POST /p HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: gzip\r\n\r\n`);
    socket.end(big);
    await closed;
    expect(events).toEqual([`end size=${big.length}`]);
    expect(raw).toEndWith("\r\n\r\nok");
  });

  // The FIN can arrive before the application reads the body. The native body reader is armed
  // at dispatch (not at the first _read), so the fin is recorded and a later reader still gets
  // the body and 'end'.
  test.concurrent("a FIN that arrives before the application reads the body still ends the request", async () => {
    const events: string[] = [];
    const ended = Promise.withResolvers<void>();
    await using server = createServer({ insecureHTTPParser: true }, async (req, res) => {
      events.push(`request ${req.method} ${req.url}`);
      // The recorded fin is the pushed EOF: wait for it before the first reader attaches.
      while (!req._readableState.ended) {
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      let body = "";
      req.on("data", d => (body += d));
      req.on("end", () => {
        events.push(`end body=${JSON.stringify(body)}`);
        res.end("ok");
        ended.resolve();
      });
    });
    server.httpAllowHalfOpen = true;
    server.on("clientError", (err: any, socket) => {
      events.push(`clientError ${err.code}`);
      socket.destroy();
      ended.resolve();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    socket.resume();
    await once(socket, "connect");
    // Head, body and FIN in one write: the server sees the FIN before the handler's reader exists.
    socket.end(`POST /p HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked, gzip\r\n\r\n${rawBody}`);
    await ended.promise;
    expect(events).toEqual(["request POST /p", `end body=${JSON.stringify(rawBody)}`]);
  });

  // The message boundary: bytes after the head that spell a whole request are body, never a
  // second request. Before the fix, "chunked, gzip" was framed as no body and these bytes were
  // dispatched as GET /smuggled.
  test.concurrent.each([
    ["gzip", "Transfer-Encoding: gzip"],
    ["chunked, gzip", "Transfer-Encoding: chunked, gzip"],
  ])("a request line in the unframed body of %s is not dispatched as a second request", async (_name, teFields) => {
    const smuggled = "GET /smuggled HTTP/1.1\r\nHost: x\r\n\r\n";
    const events: string[] = [];
    await using server = createServer({ insecureHTTPParser: true }, (req, res) => {
      if (req.url === "/barrier") {
        res.end();
        return;
      }
      let body = "";
      req.on("data", d => (body += d));
      req.on("end", () => {
        events.push(`end body=${JSON.stringify(body)}`);
        res.end("ok");
      });
      events.push(`request ${req.method} ${req.url}`);
    });
    server.httpAllowHalfOpen = true;
    server.on("clientError", (err: any, socket) => {
      events.push(`clientError ${err.code}`);
      socket.destroy();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    let raw = "";
    socket.on("data", chunk => (raw += chunk.toString("latin1")));
    const closed = new Promise<void>(resolve => socket.on("close", () => resolve()));
    await once(socket, "connect");
    socket.write(`POST /p HTTP/1.1\r\nHost: x\r\n${teFields}\r\n\r\n`);
    // In its own read, so a parser that ends the first message at its head sees a clean request.
    const barrier = connect(port, "127.0.0.1");
    barrier.resume();
    barrier.end("GET /barrier HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    await once(barrier, "close");
    socket.end(smuggled);
    await closed;
    expect(events).toEqual(["request POST /p", `end body=${JSON.stringify(smuggled)}`]);
    expect(raw.match(/HTTP\/1\.1 200/g)).toHaveLength(1);
  });

  test.concurrent.each([
    ["gzip", "Transfer-Encoding: gzip", ["request POST /p", "clientError HPE_INVALID_TRANSFER_ENCODING"]],
    ["chunked, gzip", "Transfer-Encoding: chunked, gzip", ["clientError HPE_INVALID_TRANSFER_ENCODING"]],
  ])("the strict parser still rejects %s", async (_name, teFields, expected) => {
    const { events } = await run(teFields, {});
    expect(events).toEqual(expected);
  });

  // Bun's lenient mode implements llhttp's LENIENT_TRANSFER_ENCODING but not LENIENT_CHUNKED_LENGTH
  // (HttpContextData.h), so the Transfer-Encoding plus Content-Length conflict still rejects here.
  // Node's kLenientAll includes both bits and reads such a request until EOF.
  test.concurrent("insecureHTTPParser still rejects Transfer-Encoding with Content-Length (Bun)", async () => {
    const { events } = await run("Transfer-Encoding: gzip\r\nContent-Length: 5", { insecure: true });
    expect(events).toEqual(["clientError HPE_INVALID_TRANSFER_ENCODING"]);
  });

  // llhttp takes its upgrade verdict before the Transfer-Encoding one, so a CONNECT or an accepted
  // Upgrade never reads a body until EOF: the bytes after the head belong to the tunnel. Bun still
  // fires the deferred clientError for them (Node does not, that is a separate divergence); what this
  // guards is that the tunnel starts and the connection settles without a FIN from the client.
  test.concurrent.each([
    [
      "CONNECT",
      "connect",
      "CONNECT example.com:80 HTTP/1.1\r\nHost: example.com:80\r\nTransfer-Encoding: gzip\r\n\r\n",
      [`connect example.com:80 head=${JSON.stringify(rawBody)}`, "tunnel data:4"],
    ],
    [
      "Upgrade",
      "upgrade",
      "GET /u HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: x\r\nTransfer-Encoding: gzip\r\n\r\n",
      [`upgrade /u head=${JSON.stringify(rawBody)}`, "tunnel data:4"],
    ],
  ])("insecureHTTPParser does not read a %s request's body until EOF", async (_name, event, head, expected) => {
    const events: string[] = [];
    await using server = createServer({ insecureHTTPParser: true }, (req, res) => {
      events.push(`request ${req.method} ${req.url}`);
      req.on("end", () => events.push("end"));
    });
    server.httpAllowHalfOpen = true;
    // llhttp takes its upgrade verdict before it looks at Transfer-Encoding: the tunnel starts and stays open.
    const { promise: tunnelData, resolve: onTunnelData } = Promise.withResolvers<void>();
    let tunnel: Duplex | undefined;
    server.on(event, (req, socket, tunnelHead: Buffer) => {
      tunnel = socket;
      events.push(`${event} ${req.url} head=${JSON.stringify(tunnelHead.toString())}`);
      socket.write("HTTP/1.1 200 OK\r\n\r\n");
      socket.on("data", (chunk: Buffer) => {
        events.push(`tunnel data:${chunk.length}`);
        onTunnelData();
      });
    });
    server.on("clientError", (err: any, socket) => {
      events.push(`clientError ${err.code}`);
      socket.destroy();
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;
    const socket = connect(port, "127.0.0.1");
    socket.on("error", () => {});
    const { promise: accepted, resolve: onAccepted } = Promise.withResolvers<void>();
    socket.on("data", () => onAccepted());
    await once(socket, "connect");
    socket.write(head + rawBody);
    await accepted;
    socket.write("more");
    await tunnelData;
    socket.destroy();
    // server.close() waits for a tunnel socket, and httpAllowHalfOpen keeps this one open after the client left.
    tunnel!.destroy();
    expect(events).toEqual(expected);
  });
});

// `res.useChunkedEncodingByDefault = false` is Node's switch for serving an
// HTTP/1.1 body with neither Content-Length nor chunked framing: _storeHeader
// takes its `!useChunkedEncodingByDefault` branch before it would write either
// framing header, the body runs until the connection closes, and the response
// advertises `Connection: close`. The expected heads and bodies below are what
// node v26.3.0 puts on the wire for the same handlers.
describe("res.useChunkedEncodingByDefault = false makes the response close-delimited", () => {
  type Exchange = {
    head: string;
    body: string;
    framing: "content-length" | "chunked" | "close-delimited";
    connection: "closed" | "reused";
  };

  // Sends `request` and reads the response the way a client frames it. A
  // body-less, Content-Length or chunked message is complete on its own, so
  // once it is in, a second request probes whether the server kept the
  // connection: either a second response arrives ("reused") or the server's
  // FIN does ("closed"). With neither framing header the body is everything up
  // to the FIN.
  async function exchange(handler: (req: any, res: any) => void, request: string): Promise<Exchange> {
    await using server = createServer(handler);
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const done = Promise.withResolvers<Exchange>();
    const socket = connect(port, "127.0.0.1", () => socket.write(request));
    let raw = "";
    let head: string | undefined;
    let framing: Exchange["framing"] = "close-delimited";
    let firstMessageEnd = -1;
    socket.on("data", (chunk: Buffer) => {
      raw += chunk.toString("latin1");
      const headerEnd = raw.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const bodyStart = headerEnd + 4;
      if (head === undefined) {
        head = raw.slice(0, headerEnd).replace(/^Date: .*$/m, "Date: <D>");
        if (/^content-length:/im.test(head)) framing = "content-length";
        else if (/^transfer-encoding: .*chunked/im.test(head)) framing = "chunked";
      }
      if (firstMessageEnd === -1) {
        if (request.startsWith("HEAD ") || /^HTTP\/1\.1 (?:1\d\d|204|304) /.test(head)) {
          // RFC 9112 6.3: ends at the blank line whatever the header fields say.
          firstMessageEnd = bodyStart;
        } else if (framing === "content-length") {
          const end = bodyStart + Number(/^content-length: *(\d+)/im.exec(head)![1]);
          if (raw.length >= end) firstMessageEnd = end;
        } else if (framing === "chunked") {
          const terminator = raw.indexOf("0\r\n\r\n", bodyStart);
          if (terminator !== -1) firstMessageEnd = terminator + 5;
        }
        if (firstMessageEnd !== -1) socket.write("GET /probe HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      } else if (raw.indexOf("HTTP/1.1 ", firstMessageEnd) === firstMessageEnd) {
        done.resolve({ head: head!, body: raw.slice(bodyStart, firstMessageEnd), framing, connection: "reused" });
        socket.destroy();
      }
    });
    const onClosed = () => {
      const bodyStart = raw.indexOf("\r\n\r\n") + 4;
      done.resolve({
        head: head ?? raw,
        body: raw.slice(bodyStart, firstMessageEnd === -1 ? raw.length : firstMessageEnd),
        framing,
        connection: "closed",
      });
    };
    // The probe written after the server's close may be answered with an RST.
    socket.on("error", onClosed);
    socket.on("close", onClosed);
    // Settle before `server` is disposed: server.close() ends the open connection.
    return await done.promise;
  }

  const GET11 = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";

  test.concurrent.each([
    [
      "write() + end()",
      (res: any) => {
        res.write("hel");
        res.end("lo");
      },
    ],
    ["end(data) with a known length", (res: any) => res.end("hello")],
    [
      "flushHeaders() first",
      (res: any) => {
        res.flushHeaders();
        res.write("hel");
        res.end("lo");
      },
    ],
    [
      "writeHead() first",
      (res: any) => {
        res.writeHead(200);
        res.end("hello");
      },
    ],
  ])("%s", async (_, respond) => {
    const result = await exchange((req, res) => {
      res.useChunkedEncodingByDefault = false;
      respond(res);
    }, GET11);
    expect(result).toEqual({
      head: "HTTP/1.1 200 OK\r\nDate: <D>\r\nConnection: close",
      body: "hello",
      framing: "close-delimited",
      connection: "closed",
    });
  });

  test.concurrent("a user Connection: keep-alive header still gets a close-delimited body", async () => {
    const result = await exchange((req, res) => {
      res.useChunkedEncodingByDefault = false;
      res.setHeader("connection", "keep-alive");
      res.write("hel");
      res.end("lo");
    }, GET11);
    expect(result).toEqual({
      head: "HTTP/1.1 200 OK\r\nconnection: keep-alive\r\nDate: <D>",
      body: "hello",
      framing: "close-delimited",
      connection: "closed",
    });
  });

  test.concurrent("a removed Connection header still gets a close-delimited body", async () => {
    const result = await exchange((req, res) => {
      res.useChunkedEncodingByDefault = false;
      res.setHeader("connection", "keep-alive");
      res.removeHeader("connection");
      res.end("hello");
    }, GET11);
    expect(result).toEqual({
      head: "HTTP/1.1 200 OK\r\nDate: <D>",
      body: "hello",
      framing: "close-delimited",
      connection: "closed",
    });
  });

  // Node's shouldSendKeepAlive is `shouldKeepAlive && (contLen || useChunkedEncodingByDefault)`:
  // an explicit Transfer-Encoding keeps its chunked framing but the connection
  // is not reused, a body-less response closes too, and only an explicit
  // Content-Length keeps the connection alive.
  test.concurrent("an explicit Transfer-Encoding: chunked stays chunked but closes the connection", async () => {
    const result = await exchange((req, res) => {
      res.useChunkedEncodingByDefault = false;
      res.setHeader("transfer-encoding", "chunked");
      res.write("hel");
      res.end("lo");
    }, GET11);
    expect(result).toEqual({
      head: "HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\nDate: <D>\r\nConnection: close",
      body: "3\r\nhel\r\n2\r\nlo\r\n0\r\n\r\n",
      framing: "chunked",
      connection: "closed",
    });
  });

  test.concurrent.each([
    ["HEAD", "HEAD / HTTP/1.1\r\nHost: x\r\n\r\n", (res: any) => res.end("hello"), "HTTP/1.1 200 OK"],
    [
      "204",
      GET11,
      (res: any) => {
        res.statusCode = 204;
        res.end();
      },
      "HTTP/1.1 204 No Content",
    ],
  ])("a body-less %s response advertises and performs the close", async (_, request, respond, statusLine) => {
    const result = await exchange((req, res) => {
      res.useChunkedEncodingByDefault = false;
      respond(res);
    }, request);
    expect(result).toEqual({
      head: `${statusLine}\r\nDate: <D>\r\nConnection: close`,
      body: "",
      framing: "close-delimited",
      connection: "closed",
    });
  });

  test.concurrent("an explicit Content-Length keeps the connection reusable", async () => {
    const result = await exchange((req, res) => {
      res.useChunkedEncodingByDefault = false;
      res.setHeader("content-length", "5");
      res.end("hello");
    }, GET11);
    expect(result).toEqual({
      head: "HTTP/1.1 200 OK\r\ncontent-length: 5\r\nDate: <D>\r\nConnection: keep-alive\r\nKeep-Alive: timeout=5",
      body: "hello",
      framing: "content-length",
      connection: "reused",
    });
  });

  // HTTP/1.0 clears the flag in the ServerResponse constructor, so the same
  // branch applies: node writes no Content-Length even for a one-shot end().
  test.concurrent("HTTP/1.0 one-shot end(data) carries no Content-Length, like node", async () => {
    const result = await exchange((req, res) => res.end("hello"), "GET / HTTP/1.0\r\nHost: x\r\n\r\n");
    expect(result).toEqual({
      head: "HTTP/1.1 200 OK\r\nDate: <D>\r\nConnection: close",
      body: "hello",
      framing: "close-delimited",
      connection: "closed",
    });
  });

  test.concurrent("write() followed by an empty end() is close-delimited too", async () => {
    const result = await exchange((req, res) => {
      res.useChunkedEncodingByDefault = false;
      res.write("hello");
      res.end();
    }, GET11);
    expect(result).toEqual({
      head: "HTTP/1.1 200 OK\r\nDate: <D>\r\nConnection: close",
      body: "hello",
      framing: "close-delimited",
      connection: "closed",
    });
  });

  // The body below is larger than the loopback socket buffers, so end() leaves
  // part of it queued in the server while the pipelined request behind it is
  // parsed from the same read. That request must not be answered (its bytes
  // would land inside the close-delimited body) and the close must still come.
  test.concurrent("a request pipelined behind a close-delimited response is not answered", async () => {
    const body = Buffer.alloc(8 * 1024 * 1024, "a");
    await using server = createServer((req, res) => {
      if (req.url === "/first") {
        res.useChunkedEncodingByDefault = false;
        res.end(body);
      } else {
        res.end("SECOND");
      }
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    const done = Promise.withResolvers<{ head: string; bodyLength: number; tail: string; closedByServer: boolean }>();
    const socket = connect(port, "127.0.0.1", () => {
      socket.write("GET /first HTTP/1.1\r\nHost: x\r\n\r\nGET /second HTTP/1.1\r\nHost: x\r\n\r\n");
    });
    const chunks: Buffer[] = [];
    let received = 0;
    let headBytes = Buffer.alloc(0);
    let headLength = -1;
    const settle = (closedByServer: boolean) => {
      const raw = Buffer.concat(chunks);
      done.resolve({
        head: headBytes.toString("latin1").replace(/^Date: .*$/m, "Date: <D>"),
        bodyLength: raw.length - headLength,
        tail: raw.subarray(raw.length - 8).toString("latin1"),
        closedByServer,
      });
      socket.destroy();
    };
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      received += chunk.length;
      if (headLength === -1) {
        const soFar = chunks.length === 1 ? chunk : Buffer.concat(chunks);
        const headEnd = soFar.indexOf("\r\n\r\n");
        if (headEnd === -1) return;
        headBytes = soFar.subarray(0, headEnd);
        headLength = headEnd + 4;
      }
      // More than head + body can only be a second response inside the body.
      if (received > headLength + body.length) settle(false);
    });
    socket.on("end", () => settle(true));
    socket.on("error", done.reject);

    expect(await done.promise).toEqual({
      head: "HTTP/1.1 200 OK\r\nDate: <D>\r\nConnection: close",
      bodyLength: body.length,
      tail: "aaaaaaaa",
      closedByServer: true,
    });
  });
});
