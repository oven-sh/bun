/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * A request with more header fields than server.maxHeadersCount used to reach
 * the handler with the extra fields cut off, after the parser had framed the
 * body with them: a hidden Content-Length still delimited a body. Node rejects
 * such a request since nodejs/node 821688aaa0 (CVE-2026-58044). The expected
 * values below were recorded from Node v26.5.1.
 *
 * The native server also held 198 fields at most, whatever the option was: it
 * answered the 199th with 431 when maxHeadersCount was 400 or 0, and it
 * delivered the first 199 trailer fields of any number. The expected values
 * for those cases were recorded from Node v26.10.0.
 *
 * A server that does not set the option has a limit of 1000 fields in Node.
 * The native server of Bun keeps its limit of 198 fields for the head of a
 * request on such a server. For a trailer section it has Node's 1000.
 */
import assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import { createRequire } from "node:module";
import net, { type AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { duplexPair, type Duplex } from "node:stream";
import { describe, test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const cert = readFileSync(join(fixtures, "cert.pem"), "utf8");
const key = readFileSync(join(fixtures, "cert.key"), "utf8");

// Node rejects from v22.23.2, v24.18.1 and v26.5.1. An older Node truncates, so
// the reject cases only describe it from those versions on. Bun always runs them.
const runtimeRejects = (() => {
  if (process.versions.bun) return true;
  const [major, minor, patch] = process.versions.node.split(".").map(Number);
  const firstFixed: Record<number, [number, number]> = { 22: [23, 2], 24: [18, 1], 26: [5, 1] };
  const fixed = firstFixed[major];
  if (!fixed) return major > 26;
  return minor > fixed[0] || (minor === fixed[0] && patch >= fixed[1]);
})();
const rejectTest = runtimeRejects ? test : test.skip;

// The llhttp binding. Node has no type declarations for this module.
const { HTTPParser } = createRequire(import.meta.url)("node:_http_common");

const ok = "HTTP/1.1 200 OK";
const badRequest = "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n";
const tooLarge = "HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n";

// A request head with exactly `fields` header fields: Host, then `extra`, then filler. The
// last field is Connection: close unless `close` is false, so an accepted request ends the
// connection after its response.
function requestHead(fields: number, { requestLine = "GET / HTTP/1.1", close = true, extra = [] as string[] } = {}) {
  const lines = [requestLine, "Host: localhost", ...extra];
  for (let i = lines.length - 1; i < fields - 1; i++) lines.push(`X-${i}: ${i}`);
  lines.push(close ? "Connection: close" : "X-Last: 1");
  return lines.join("\r\n") + "\r\n\r\n";
}

// Writes `payload` and resolves with every byte the server sent before it closed the connection.
function exchange(port: number, payload: string, secure = false) {
  return new Promise<string>((resolve, reject) => {
    const socket = secure
      ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] })
      : net.connect(port, "127.0.0.1");
    let received = "";
    socket.setEncoding("latin1");
    socket.on("data", chunk => (received += chunk));
    socket.on("error", reject);
    socket.on("close", () => resolve(received));
    socket.once(secure ? "secureConnect" : "connect", () => socket.write(payload));
  });
}

async function listen(server: net.Server) {
  if (!server.listening) await once(server.listen(0, "127.0.0.1"), "listening");
  return (server.address() as AddressInfo).port;
}

type Transport = {
  name: string;
  // The limit for the fields of a head when the server does not set maxHeadersCount.
  unsetLimit: number;
  // Sends `payload` on a new connection and resolves with every byte the server answered.
  roundtrip: (server: http.Server, payload: string) => Promise<string>;
  // Opens a connection that stays open, for respondsTo().
  connect: (server: http.Server) => Promise<Duplex>;
  close: (server: http.Server) => void;
};
const transports: Transport[] = [
  {
    // Bun parses these connections in the native server, which keeps a limit of 198 fields
    // for a server that does not set the option.
    name: "listen()",
    unsetLimit: process.versions.bun ? 198 : 1000,
    roundtrip: async (server, payload) => exchange(await listen(server), payload),
    connect: async server => {
      const socket = net.connect(await listen(server), "127.0.0.1");
      await once(socket, "connect");
      return socket;
    },
    close: server => void server.close(),
  },
  {
    // Bun parses these with the llhttp binding, like the HTTP/1.1 connections of an
    // allowHTTP1 HTTP/2 server.
    name: 'emit("connection")',
    unsetLimit: 1000,
    connect: async server => {
      const [client, serverSide] = duplexPair();
      server.emit("connection", serverSide);
      return client;
    },
    roundtrip: (server, payload) =>
      new Promise<string>((resolve, reject) => {
        const [client, serverSide] = duplexPair();
        let received = "";
        client.setEncoding("latin1");
        client.on("data", chunk => (received += chunk));
        client.on("error", reject);
        // The server ends its side after a response and destroys it after a parse error.
        client.on("end", () => resolve(received));
        client.on("close", () => resolve(received));
        server.emit("connection", serverSide);
        client.write(payload);
      }),
    close: () => {},
  },
];

// Writes `payload` on an open connection and resolves with the next `responses` responses, each a head
// and the body that its Content-Length gives, or with all that the server sent when it closes the connection.
function respondsTo(connection: Duplex, payload: string, responses = 1) {
  return new Promise<string>((resolve, reject) => {
    let received = "";
    const finish = () => {
      connection.off("data", onData).off("end", finish).off("close", finish).off("error", reject);
      resolve(received);
    };
    const onData = (chunk: Buffer | string) => {
      received += chunk.toString("latin1");
      let end = 0;
      for (let complete = 0; complete < responses; complete++) {
        const headEnd = received.indexOf("\r\n\r\n", end);
        if (headEnd === -1) return;
        const contentLength = /\r\ncontent-length: (\d+)\r\n/i.exec(received.slice(end, headEnd + 2));
        if (!contentLength) return;
        end = headEnd + 4 + Number(contentLength[1]);
        if (received.length < end) return;
      }
      finish();
    };
    connection.on("data", onData).on("end", finish).on("close", finish).on("error", reject);
    connection.write(payload);
  });
}

// req.rawHeaders of a request head: the name and the value of every field line.
function rawHeadersOf(head: string) {
  return head
    .split("\r\n")
    .slice(1, -2)
    .flatMap(line => [line.slice(0, line.indexOf(": ")), line.slice(line.indexOf(": ") + 2)]);
}

// Enough for the 2000 and 3000 fields that some cases send. The default is 16 KiB.
const roomy = { maxHeaderSize: 1024 * 1024 };

const statusLine = (response: string) => response.slice(0, response.indexOf("\r\n"));
// For test titles: JSON.stringify prints NaN and Infinity as null.
const show = (value: unknown) => (typeof value === "string" ? JSON.stringify(value) : String(value));

type Seen = { url: string; fields: number; host: string | undefined };
// Answers every request and records what it carried.
function record(seen: Seen[]) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    seen.push({ url: req.url!, fields: req.rawHeaders.length / 2, host: req.headers.host });
    res.end("ok");
  };
}

for (const { name, unsetLimit, roundtrip, connect, close } of transports) {
  describe(`server.maxHeadersCount, ${name}`, () => {
    rejectTest("a request over the limit gets 431 and never reaches the handler", async () => {
      const seen: Seen[] = [];
      const server = http.createServer(record(seen));
      server.maxHeadersCount = 3;
      try {
        // Content-Length is the 5th field. The body holds a second request.
        const response = await roundtrip(
          server,
          "POST /a HTTP/1.1\r\nHost: x\r\nA: 1\r\nB: 2\r\nC: 3\r\nContent-Length: 28\r\nConnection: close\r\n\r\n" +
            "GET /inner HTTP/1.1\r\nX: y\r\n\r\n",
        );
        assert.strictEqual(response, tooLarge);
        assert.deepStrictEqual(seen, []);
      } finally {
        close(server);
      }
    });

    rejectTest("'clientError' receives HPE_HEADER_OVERFLOW and owns the response", async () => {
      const seen: Seen[] = [];
      const server = http.createServer(record(seen));
      server.maxHeadersCount = 2;
      const errors: unknown[] = [];
      server.on("clientError", (err: any, socket) => {
        errors.push({ code: err.code, message: err.message, rawPacket: Buffer.isBuffer(err.rawPacket) });
        socket.end("HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n");
      });
      try {
        const response = await roundtrip(
          server,
          "POST / HTTP/1.1\r\nHost: localhost\r\nX-A: b\r\nContent-Length: 3\r\nConnection: close\r\n\r\nabc",
        );
        assert.strictEqual(response, "HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n");
        assert.deepStrictEqual(errors, [
          { code: "HPE_HEADER_OVERFLOW", message: "Parse Error: Header overflow", rawPacket: true },
        ]);
        assert.deepStrictEqual(seen, []);
      } finally {
        close(server);
      }
    });

    // The llhttp binding hands fields over in blocks of 31, so 31 to 33 cross its first flush.
    // The native server keeps 198 fields in the request itself, so 199 is the first head it moves.
    for (const limit of [2, 31, 32, 33, 100, 198, 199, 2000]) {
      test(`limit ${limit}: a request at the limit passes with every field`, async () => {
        const seen: Seen[] = [];
        const server = http.createServer(roomy, record(seen));
        server.maxHeadersCount = limit;
        try {
          assert.strictEqual(statusLine(await roundtrip(server, requestHead(limit))), ok);
          assert.deepStrictEqual(seen, [{ url: "/", fields: limit, host: "localhost" }]);
        } finally {
          close(server);
        }
      });

      rejectTest(`limit ${limit}: one more field fails`, async () => {
        const seen: Seen[] = [];
        const server = http.createServer(roomy, record(seen));
        server.maxHeadersCount = limit;
        try {
          assert.strictEqual(await roundtrip(server, requestHead(limit + 1)), tooLarge);
          assert.deepStrictEqual(seen, []);
        } finally {
          close(server);
        }
      });
    }

    // Node: parser.maxHeaderPairs = maxHeadersCount << 1, applied when it is a number > 0.
    rejectTest("maxHeadersCount = 2.5 allows 2 fields", async () => {
      const seen: Seen[] = [];
      const server = http.createServer(record(seen));
      server.maxHeadersCount = 2.5;
      try {
        assert.strictEqual(statusLine(await roundtrip(server, requestHead(2))), ok);
        assert.strictEqual(await roundtrip(server, requestHead(3)), tooLarge);
        assert.deepStrictEqual(seen, [{ url: "/", fields: 2, host: "localhost" }]);
      } finally {
        close(server);
      }
    });

    // A number whose int32 `<< 1` is not positive. 1001 fields are more than a server with no option passes.
    for (const value of [0, 0.5, -1, NaN, Infinity, 2 ** 30, 2 ** 31]) {
      test(`maxHeadersCount = ${show(value)} sets no limit`, async () => {
        const seen: Seen[] = [];
        const server = http.createServer(record(seen));
        server.maxHeadersCount = value;
        try {
          assert.strictEqual(statusLine(await roundtrip(server, requestHead(1001))), ok);
          assert.deepStrictEqual(seen, [{ url: "/", fields: 1001, host: "localhost" }]);
        } finally {
          close(server);
        }
      });
    }

    test("maxHeadersCount = 0 passes 3000 fields", async () => {
      const seen: Seen[] = [];
      const server = http.createServer(roomy, record(seen));
      server.maxHeadersCount = 0;
      try {
        assert.strictEqual(statusLine(await roundtrip(server, requestHead(3000))), ok);
        assert.deepStrictEqual(seen, [{ url: "/", fields: 3000, host: "localhost" }]);
      } finally {
        close(server);
      }
    });

    // 199 fields are the first that the native server parses into a larger request.
    for (const fields of [199, 1000]) {
      test(`limit 1000: a head of ${fields} fields arrives with every name and value`, async () => {
        let rawHeaders: string[] | undefined;
        const server = http.createServer((req, res) => {
          rawHeaders = req.rawHeaders;
          res.end("ok");
        });
        server.maxHeadersCount = 1000;
        try {
          const head = requestHead(fields);
          assert.strictEqual(statusLine(await roundtrip(server, head)), ok);
          assert.deepStrictEqual(rawHeaders, rawHeadersOf(head));
        } finally {
          close(server);
        }
      });
    }

    // A value that is not a number is like no option.
    for (const value of [undefined, null, "2"]) {
      const unset = value === undefined ? "not set" : `= ${show(value)}`;
      rejectTest(`maxHeadersCount ${unset}: ${unsetLimit} fields pass and ${unsetLimit + 1} fields fail`, async () => {
        const seen: Seen[] = [];
        const server = http.createServer(record(seen));
        if (value !== undefined) server.maxHeadersCount = value as number;
        try {
          assert.strictEqual(statusLine(await roundtrip(server, requestHead(unsetLimit))), ok);
          assert.strictEqual(await roundtrip(server, requestHead(unsetLimit + 1)), tooLarge);
          assert.deepStrictEqual(seen, [{ url: "/", fields: unsetLimit, host: "localhost" }]);
        } finally {
          close(server);
        }
      });
    }

    // maxHeaderSize counts the url, the names and the values: 14 001 bytes here. It does not count
    // the 4 bytes around each field, and with those this head is 18 018 bytes.
    test("1000 fields of 14 bytes fit the default maxHeaderSize", async () => {
      const seen: Seen[] = [];
      const server = http.createServer(record(seen));
      server.maxHeadersCount = 1000;
      try {
        const lines = ["GET / HTTP/1.1", "Host: localhost"];
        for (let i = 0; i < 998; i++) lines.push(`X-${String(i).padStart(4, "0")}: 12345678`);
        lines.push("Connection: close");
        const head = lines.join("\r\n") + "\r\n\r\n";
        assert.strictEqual(head.length, 18018);
        assert.strictEqual(statusLine(await roundtrip(server, head)), ok);
        assert.deepStrictEqual(seen, [{ url: "/", fields: 1000, host: "localhost" }]);
      } finally {
        close(server);
      }
    });

    // The rest of the second head goes out when the first response is back. The server read the
    // start of that head with the first request, so the head takes two reads.
    for (const fieldsInFirstRead of [150, 250]) {
      test(`a head of 300 fields arrives whole when a read ends after ${fieldsInFirstRead} of them`, async () => {
        const requests: string[][] = [];
        const server = http.createServer((req, res) => {
          requests.push(req.rawHeaders);
          res.end("ok");
        });
        server.maxHeadersCount = 1000;
        const connection = await connect(server);
        try {
          const head = requestHead(300);
          const cut = head.split("\r\n", fieldsInFirstRead + 1).join("\r\n").length + 2;
          const first = requestHead(3, { close: false });
          assert.strictEqual(statusLine(await respondsTo(connection, first + head.slice(0, cut))), ok);
          assert.strictEqual(statusLine(await respondsTo(connection, head.slice(cut))), ok);
          assert.deepStrictEqual(requests, [rawHeadersOf(first), rawHeadersOf(head)]);
        } finally {
          connection.destroy();
          close(server);
        }
      });
    }

    // Node copies server.maxHeadersCount to the parser of a connection when the connection opens.
    rejectTest("a connection keeps the limit that its server had when it opened", async () => {
      const server = http.createServer(record([]));
      const connections: Duplex[] = [];
      const open = async () => connections[connections.push(await connect(server)) - 1];
      try {
        // Each connection answers a request before the assignment, so it is open by then.
        const lowered = await open();
        assert.strictEqual(statusLine(await respondsTo(lowered, requestHead(6, { close: false }))), ok);
        server.maxHeadersCount = 3;
        assert.strictEqual(statusLine(await respondsTo(lowered, requestHead(6, { close: false }))), ok);

        const raised = await open();
        assert.strictEqual(statusLine(await respondsTo(raised, requestHead(3, { close: false }))), ok);
        server.maxHeadersCount = 10;
        assert.strictEqual(await respondsTo(raised, requestHead(6)), tooLarge);

        assert.strictEqual(statusLine(await respondsTo(await open(), requestHead(6))), ok);
      } finally {
        for (const connection of connections) connection.destroy();
        close(server);
      }
    });

    // The listener ends the connection, and with it the parser, while it holds the request.
    test("a head of 300 fields is whole after its 'upgrade' listener destroys the socket", async () => {
      let rawHeaders: string[] | undefined;
      const server = http.createServer(record([]));
      server.on("upgrade", (req, socket) => {
        socket.destroy();
        rawHeaders = req.rawHeaders;
      });
      server.maxHeadersCount = 1000;
      try {
        const head = requestHead(300, { extra: ["Connection: Upgrade", "Upgrade: raw"], close: false });
        assert.strictEqual(await roundtrip(server, head), "");
        assert.deepStrictEqual(rawHeaders, rawHeadersOf(head));
      } finally {
        close(server);
      }
    });

    test("a request with 40 fields keeps its Content-Length and its body", async () => {
      const bodies: unknown[] = [];
      const server = http.createServer((req, res) => {
        let body = "";
        req.setEncoding("latin1");
        req.on("data", chunk => (body += chunk));
        req.on("end", () => {
          bodies.push({ fields: req.rawHeaders.length / 2, contentLength: req.headers["content-length"], body });
          res.end("ok");
        });
      });
      try {
        const head = requestHead(40, { requestLine: "POST / HTTP/1.1", extra: ["Content-Length: 3"] });
        assert.strictEqual(statusLine(await roundtrip(server, head + "abc")), ok);
        assert.deepStrictEqual(bodies, [{ fields: 40, contentLength: "3", body: "abc" }]);
      } finally {
        close(server);
      }
    });

    test("a pipelined request after one with 40 fields gets its own url and fields", async () => {
      const seen: Seen[] = [];
      const server = http.createServer(record(seen));
      try {
        const response = await roundtrip(
          server,
          requestHead(40, { requestLine: "GET /one HTTP/1.1", close: false }) +
            requestHead(3, { requestLine: "GET /two HTTP/1.1" }),
        );
        assert.strictEqual(statusLine(response), ok);
        assert.deepStrictEqual(seen, [
          { url: "/one", fields: 40, host: "localhost" },
          { url: "/two", fields: 3, host: "localhost" },
        ]);
      } finally {
        close(server);
      }
    });

    rejectTest("a pipelined request over the limit fails after the first one is dispatched", async () => {
      const urls: string[] = [];
      const responses: http.ServerResponse[] = [];
      const server = http.createServer((req, res) => {
        urls.push(req.url!);
        responses.push(res);
        // Not reached: the second request must not be dispatched.
        if (req.url === "/two") for (const response of responses) response.end();
      });
      server.maxHeadersCount = 3;
      try {
        const response = await roundtrip(
          server,
          "GET /one HTTP/1.1\r\nHost: x\r\nA: 1\r\n\r\n" +
            "GET /two HTTP/1.1\r\nHost: x\r\nA: 1\r\nB: 2\r\nConnection: close\r\n\r\n",
        );
        assert.strictEqual(response, tooLarge);
        assert.deepStrictEqual(urls, ["/one"]);
      } finally {
        close(server);
      }
    });

    rejectTest("a pipelined request of 1001 fields fails after one of 300 fields is dispatched", async () => {
      const urls: string[] = [];
      // No response: the 431 is then all that the server sends.
      const server = http.createServer(req => void urls.push(req.url!));
      server.maxHeadersCount = 1000;
      try {
        const response = await roundtrip(
          server,
          requestHead(300, { requestLine: "GET /one HTTP/1.1", close: false }) +
            requestHead(1001, { requestLine: "GET /two HTTP/1.1" }),
        );
        assert.strictEqual(response, tooLarge);
        assert.deepStrictEqual(urls, ["/one"]);
      } finally {
        close(server);
      }
    });

    // The native server of Bun parses a head of more than 198 fields a second time, into a larger request.
    // These cases are what is around such a head on its connection, and the options of its parser.
    describe("a head of 300 fields at a limit of 1000", () => {
      const filler = (fields: number, from = 0) => {
        let lines = "";
        for (let i = from; i < from + fields; i++) lines += `X-${i}: ${i}\r\n`;
        return lines;
      };
      // Fields of 4 bytes, which count for 1 byte of maxHeaderSize each.
      const shortest = (fields: number) => Buffer.alloc(4 * fields, "a:\r\n").toString();
      const get = (url: string, fields: number) => `GET ${url} HTTP/1.1\r\nHost: x\r\n${filler(fields - 1)}\r\n`;
      const first = "GET /first HTTP/1.1\r\nHost: x\r\n\r\n";
      const firstSeen = ["GET", "/first", 1, "", 0];
      const last = "GET /last HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n";
      const lastSeen = ["GET", "/last", 2, "", 0];
      const lengthHead = `POST /length HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n${filler(298)}\r\n`;
      const chunkedHead = `POST /chunked HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n${filler(298)}\r\n`;
      // The head up to its field 250, and the rest of it. The server reads the first part with the request
      // in front of it, and the response to that request says so.
      const split = (head: string) => {
        const cut = head.indexOf("X-250:");
        return [first + head.slice(0, cut), head.slice(cut)];
      };
      const controlByte = `GET /control HTTP/1.1\r\nHost: x\r\nConnection: close\r\n${filler(247)}X-Control: a\x01b\r\n${filler(50, 300)}\r\n`;
      const noHost = `GET /no-host HTTP/1.1\r\nConnection: close\r\n${filler(299)}\r\n`;

      // seen: the method, the url, the fields, the body and the trailer fields of every request.
      type Case = {
        title: string;
        options?: http.ServerOptions;
        steps: { write: string; responses: number }[];
        statuses: string[];
        seen: unknown[][];
        clientErrors?: string[];
      };
      const cases: Case[] = [
        {
          title: "two of them in two writes, then a third request",
          steps: [
            { write: get("/a", 300), responses: 1 },
            { write: get("/b", 300), responses: 1 },
            { write: last, responses: 1 },
          ],
          statuses: ["200", "200", "200"],
          seen: [["GET", "/a", 300, "", 0], ["GET", "/b", 300, "", 0], lastSeen],
        },
        {
          title: "behind two empty lines",
          steps: [
            { write: "\r\n\r\n" + get("/a", 300), responses: 1 },
            { write: last, responses: 1 },
          ],
          statuses: ["200", "200"],
          seen: [["GET", "/a", 300, "", 0], lastSeen],
        },
        {
          title: "behind a request of 3 fields in the same write",
          steps: [
            { write: get("/small", 3) + get("/a", 300), responses: 2 },
            { write: last, responses: 1 },
          ],
          statuses: ["200", "200", "200"],
          seen: [["GET", "/small", 3, "", 0], ["GET", "/a", 300, "", 0], lastSeen],
        },
        {
          title: "one of 250 fields, one of 900 fields and a third request in one write",
          steps: [{ write: get("/a", 250) + get("/b", 900) + last, responses: 3 }],
          statuses: ["200", "200", "200"],
          seen: [["GET", "/a", 250, "", 0], ["GET", "/b", 900, "", 0], lastSeen],
        },
        {
          title: "with 4 bytes for each field",
          steps: [{ write: `GET / HTTP/1.1\r\nHost:x\r\n${shortest(298)}Connection:close\r\n\r\n`, responses: 1 }],
          statuses: ["200"],
          seen: [["GET", "/", 300, "", 0]],
        },
        {
          // The url and the fields count for 305 bytes.
          title: "with one counted byte for each field, maxHeaderSize 400",
          options: { maxHeaderSize: 400 },
          steps: [{ write: `GET / HTTP/1.1\r\nHost:x\r\n${shortest(299)}\r\n`, responses: 1 }],
          statuses: ["200"],
          seen: [["GET", "/", 300, "", 0]],
        },
        {
          title: "a body with Content-Length, a chunked body with trailers and a third request in one write",
          steps: [
            {
              write: lengthHead + "hello" + chunkedHead + "3\r\nabc\r\n0\r\nT1: 1\r\nT2: 2\r\n\r\n" + last,
              responses: 3,
            },
          ],
          statuses: ["200", "200", "200"],
          seen: [["POST", "/length", 300, "hello", 0], ["POST", "/chunked", 300, "abc", 2], lastSeen],
        },
        {
          title: "a head in two reads, then its body with Content-Length and a third request",
          steps: [
            { write: split(lengthHead)[0], responses: 1 },
            { write: split(lengthHead)[1] + "hello" + last, responses: 2 },
          ],
          statuses: ["200", "200", "200"],
          seen: [firstSeen, ["POST", "/length", 300, "hello", 0], lastSeen],
        },
        {
          title: "a head in two reads, then its chunked body with a trailer and a third request",
          steps: [
            { write: split(chunkedHead)[0], responses: 1 },
            { write: split(chunkedHead)[1] + "3\r\nabc\r\n0\r\nT1: 1\r\n\r\n" + last, responses: 2 },
          ],
          statuses: ["200", "200", "200"],
          seen: [firstSeen, ["POST", "/chunked", 300, "abc", 1], lastSeen],
        },
        {
          title: "a control byte in the value of field 250 fails the request",
          steps: [{ write: controlByte, responses: 1 }],
          statuses: [],
          seen: [],
          clientErrors: ["HPE_INVALID_HEADER_TOKEN"],
        },
        {
          title: "insecureHTTPParser passes a control byte in the value of field 250",
          options: { insecureHTTPParser: true },
          steps: [{ write: controlByte, responses: 1 }],
          statuses: ["200"],
          seen: [["GET", "/control", 300, "", 0]],
        },
      ];
      // The llhttp connections of Bun do not require a Host field.
      if (name === "listen()") {
        cases.push(
          {
            title: "no Host field gets 400",
            steps: [{ write: noHost, responses: 1 }],
            statuses: ["400"],
            seen: [],
          },
          {
            title: "requireHostHeader false passes a head with no Host field",
            options: { requireHostHeader: false },
            steps: [{ write: noHost, responses: 1 }],
            statuses: ["200"],
            seen: [["GET", "/no-host", 300, "", 0]],
          },
        );
      }

      for (const { title, options = {}, steps, statuses, seen, clientErrors = [] } of cases) {
        test(title, async () => {
          const requests: unknown[][] = [];
          const errors: string[] = [];
          const server = http.createServer(options, (req, res) => {
            let body = "";
            req.setEncoding("latin1");
            req.on("data", chunk => (body += chunk));
            req.on("end", () => {
              requests.push([req.method, req.url, req.rawHeaders.length / 2, body, req.rawTrailers.length / 2]);
              res.end("ok");
            });
          });
          server.on("clientError", (err: any, socket) => {
            errors.push(err.code);
            socket.destroy();
          });
          server.maxHeadersCount = 1000;
          const connection = await connect(server);
          try {
            let received = "";
            for (const { write, responses } of steps) received += await respondsTo(connection, write, responses);
            assert.deepStrictEqual(
              Array.from(received.matchAll(/HTTP\/1\.1 (\d+)/g), match => match[1]),
              statuses,
            );
            assert.deepStrictEqual(requests, seen);
            assert.deepStrictEqual(errors, clientErrors);
          } finally {
            connection.destroy();
            close(server);
          }
        });
      }

      for (const event of ["upgrade", "connect"] as const) {
        test(`the '${event}' listener gets the bytes behind a head that took two reads`, async () => {
          const seen: unknown[] = [];
          const server = http.createServer((req, res) => {
            seen.push(req.url);
            res.end("ok");
          });
          server.on(event, (req, socket, head) => {
            seen.push([req.rawHeaders.length / 2, head.toString("latin1")]);
            socket.end(
              `HTTP/1.1 ${event === "upgrade" ? "101 Switching Protocols" : "200 Connection Established"}\r\n\r\n`,
            );
          });
          server.maxHeadersCount = 1000;
          const connection = await connect(server);
          try {
            const [start, rest] = split(
              event === "upgrade"
                ? `GET /tunnel HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: raw\r\n${filler(297)}\r\n`
                : `CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n${filler(299)}\r\n`,
            );
            assert.strictEqual(statusLine(await respondsTo(connection, start)), ok);
            assert.strictEqual(
              statusLine(await respondsTo(connection, rest + "TUNNEL-BYTES")),
              event === "upgrade" ? "HTTP/1.1 101 Switching Protocols" : "HTTP/1.1 200 Connection Established",
            );
            assert.deepStrictEqual(seen, ["/first", [300, "TUNNEL-BYTES"]]);
          } finally {
            connection.destroy();
            close(server);
          }
        });
      }

      // A socket read holds 512 KiB at most.
      test("a head of 450 fields in 1.1 MB takes more than two reads", async () => {
        const seen: Seen[] = [];
        const server = http.createServer({ maxHeaderSize: 2 * 1024 * 1024 }, record(seen));
        server.maxHeadersCount = 1000;
        try {
          const value = Buffer.alloc(4500, "v").toString();
          let head = "GET / HTTP/1.1\r\nHost: localhost\r\n" + filler(199);
          for (let i = 0; i < 249; i++) head += `Y-${i}: ${value}\r\n`;
          head += "Connection: close\r\n\r\n";
          assert.strictEqual(statusLine(await roundtrip(server, head)), ok);
          assert.deepStrictEqual(seen, [{ url: "/", fields: 450, host: "localhost" }]);
        } finally {
          close(server);
        }
      });

      test("a head over maxHeaderSize behind a head of 198 fields fails with HPE_HEADER_OVERFLOW", async () => {
        const seen: Seen[] = [];
        const errors: string[] = [];
        const server = http.createServer({ maxHeaderSize: 700 }, record(seen));
        server.on("clientError", (err: any, socket) => {
          errors.push(err.code);
          socket.destroy();
        });
        server.maxHeadersCount = 1000;
        try {
          const response = await roundtrip(
            server,
            `GET /a HTTP/1.1\r\nHost: x\r\n${shortest(197)}\r\n` +
              `GET /b HTTP/1.1\r\nHost: x\r\nX-Big: ${Buffer.alloc(700, "v")}\r\n\r\n`,
          );
          assert.strictEqual(statusLine(response), ok);
          assert.deepStrictEqual(seen, [{ url: "/a", fields: 198, host: "x" }]);
          assert.deepStrictEqual(errors, ["HPE_HEADER_OVERFLOW"]);
        } finally {
          close(server);
        }
      });
    });

    describe("trailers count from zero against the same limit", () => {
      const chunked =
        "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n3\r\nabc\r\n0\r\n";
      const trailerSection = (fields: number) => {
        let section = "";
        for (let i = 0; i < fields; i++) section += `T${i}: ${i}\r\n`;
        return section + "\r\n";
      };
      const rawTrailersOf = (fields: number) => Array.from({ length: fields }, (_, i) => [`T${i}`, `${i}`]).flat();

      // The native server held 199 trailer fields, and dropped the rest of a section without an error.
      for (const { limit, fields } of [
        { limit: 3, fields: 3 },
        { limit: undefined, fields: 1000 },
        { limit: 1000, fields: 1000 },
        { limit: 0, fields: 1500 },
      ]) {
        const title = limit === undefined ? "limit not set" : limit === 0 ? "no limit" : `limit ${limit}`;

        test(`${title}: ${fields} fields are delivered`, async () => {
          let rawTrailers: string[] | undefined;
          const server = http.createServer((req, res) => {
            req.resume().on("end", () => {
              rawTrailers = req.rawTrailers;
              res.end("ok");
            });
          });
          if (limit !== undefined) server.maxHeadersCount = limit;
          try {
            const response = await roundtrip(server, chunked + trailerSection(fields));
            assert.strictEqual(statusLine(response), ok);
            assert.deepStrictEqual(rawTrailers, rawTrailersOf(fields));
          } finally {
            close(server);
          }
        });

        if (limit === 0) continue;

        rejectTest(`${title}: one more field fails the request with HPE_HEADER_OVERFLOW`, async () => {
          let ended = false;
          const server = http.createServer();
          if (limit !== undefined) server.maxHeadersCount = limit;
          const requestError = new Promise<any>(resolve => {
            server.on("request", (req, res) => {
              req.resume().on("error", resolve);
              // Not reached: the message never completes.
              req.on("end", () => {
                ended = true;
                res.end("ok");
              });
            });
          });
          const clientError = new Promise<any>(resolve => {
            server.on("clientError", (err, socket) => {
              resolve(err);
              socket.destroy();
            });
          });
          try {
            const response = await roundtrip(server, chunked + trailerSection(fields + 1));
            assert.strictEqual(response, "");
            assert.strictEqual((await clientError).code, "HPE_HEADER_OVERFLOW");
            assert.strictEqual((await requestError).code, "ECONNRESET");
            assert.strictEqual(ended, false);
          } finally {
            close(server);
          }
        });
      }

      // Node counts the names and the values of a trailer section against maxHeaderSize, from zero. The
      // native server had a bound for the bytes of the section only, and that bound grows with the limit.
      for (const limit of [undefined, 1000, 0]) {
        const title = limit === undefined ? "limit not set" : limit === 0 ? "no limit" : `limit ${limit}`;

        test(`${title}: the names and the values count against maxHeaderSize`, async () => {
          const rawTrailers: string[][] = [];
          const errors: string[] = [];
          const server = http.createServer((req, res) => {
            req.on("error", () => {});
            req.resume().on("end", () => {
              rawTrailers.push(req.rawTrailers);
              res.end("ok");
            });
          });
          server.on("clientError", (err: any, socket) => {
            errors.push(err.code);
            socket.destroy();
          });
          if (limit !== undefined) server.maxHeadersCount = limit;
          try {
            // The name is 1 byte, and the default maxHeaderSize is 16 384 bytes.
            const fits = Buffer.alloc(16382, "v").toString();
            assert.strictEqual(statusLine(await roundtrip(server, `${chunked}T: ${fits}\r\n\r\n`)), ok);
            assert.strictEqual(await roundtrip(server, `${chunked}T: ${fits}v\r\n\r\n`), "");
            assert.deepStrictEqual(rawTrailers, [["T", fits]]);
            assert.deepStrictEqual(errors, ["HPE_HEADER_OVERFLOW"]);
          } finally {
            close(server);
          }
        });
      }

      // Node does not count the ": " and the line end of a field, and has no bound for them.
      test("limit not set: 540 fields are delivered, 15 120 counted bytes in a section of 17 282", async () => {
        let fields: number | undefined;
        const server = http.createServer((req, res) => {
          req.resume().on("end", () => {
            fields = req.rawTrailers.length / 2;
            res.end("ok");
          });
        });
        try {
          let section = "";
          for (let i = 100; i < 640; i++) section += `X-Trailer-Field-${i}: value-${i}\r\n`;
          assert.strictEqual(section.length, 17280);
          assert.strictEqual(statusLine(await roundtrip(server, `${chunked}${section}\r\n`)), ok);
          assert.strictEqual(fields, 540);
        } finally {
          close(server);
        }
      });

      test("no limit: 16 000 fields that count one byte each are delivered", async () => {
        let fields: number | undefined;
        const server = http.createServer((req, res) => {
          req.resume().on("end", () => {
            fields = req.rawTrailers.length / 2;
            res.end("ok");
          });
        });
        server.maxHeadersCount = 0;
        try {
          const response = await roundtrip(server, chunked + Buffer.alloc(5 * 16000, "a: \r\n") + "\r\n");
          assert.strictEqual(statusLine(response), ok);
          assert.strictEqual(fields, 16000);
        } finally {
          close(server);
        }
      });

      // The first defect on the wire decides, like in llhttp. The native server parsed the whole section
      // before it looked at the limit and at the names.
      describe("a section with two defects fails with the code of the first one", () => {
        const cases: [
          title: string,
          options: http.ServerOptions,
          limit: number | undefined,
          section: string,
          code: string,
        ][] = [
          [
            "Content-Length, then a malformed line",
            {},
            undefined,
            "Content-Length: 1\r\nbad line\r\n\r\n",
            "HPE_INVALID_CONTENT_LENGTH",
          ],
          [
            "Transfer-Encoding, then a malformed line",
            {},
            undefined,
            "Transfer-Encoding: chunked\r\nbad line\r\n\r\n",
            "HPE_INVALID_TRANSFER_ENCODING",
          ],
          [
            "a malformed line, then Content-Length",
            {},
            undefined,
            "bad line\r\nContent-Length: 1\r\n\r\n",
            "HPE_INVALID_HEADER_TOKEN",
          ],
          [
            "limit 3: Content-Length within the limit, then a field over it",
            {},
            3,
            "A: 1\r\nContent-Length: 1\r\nC: 3\r\nD: 4\r\n\r\n",
            "HPE_INVALID_CONTENT_LENGTH",
          ],
          [
            "limit 3: Transfer-Encoding within the limit, then a field over it",
            {},
            3,
            "A: 1\r\nTransfer-Encoding: chunked\r\nC: 3\r\nD: 4\r\n\r\n",
            "HPE_INVALID_TRANSFER_ENCODING",
          ],
          [
            "limit 3: a field over the limit, then a malformed line",
            {},
            3,
            "A: 1\r\nB: 2\r\nC: 3\r\nD: 4\r\nbad line\r\n\r\n",
            "HPE_HEADER_OVERFLOW",
          ],
          [
            "limit 3, insecureHTTPParser: a field over the limit, then a malformed line",
            { insecureHTTPParser: true },
            3,
            "A: 1\r\nB: 2\r\nC: 3\r\nD: 4\r\nbad line\r\n\r\n",
            "HPE_HEADER_OVERFLOW",
          ],
          [
            "limit 3: the field over the limit has a control byte in its value",
            {},
            3,
            "A: 1\r\nB: 2\r\nC: 3\r\nD: \x01\r\n\r\n",
            "HPE_HEADER_OVERFLOW",
          ],
          [
            "limit 3: the field over the limit is Content-Length",
            {},
            3,
            "A: 1\r\nB: 2\r\nC: 3\r\nContent-Length: 1\r\n\r\n",
            "HPE_HEADER_OVERFLOW",
          ],
          [
            "limit 3: a malformed line where the field over the limit would be",
            {},
            3,
            "A: 1\r\nB: 2\r\nC: 3\r\nbad line\r\n\r\n",
            "HPE_INVALID_HEADER_TOKEN",
          ],
          [
            "limit 1000: a malformed line behind 205 fields",
            {},
            1000,
            trailerSection(205).slice(0, -2) + "bad line\r\n\r\n",
            "HPE_INVALID_HEADER_TOKEN",
          ],
          [
            "no limit: a malformed line behind 205 fields",
            {},
            0,
            trailerSection(205).slice(0, -2) + "bad line\r\n\r\n",
            "HPE_INVALID_HEADER_TOKEN",
          ],
        ];
        for (const [title, options, limit, section, code] of cases) {
          // A limit that is set and not 0 rejects: see rejectTest.
          (limit ? rejectTest : test)(title, async () => {
            let ended = false;
            const server = http.createServer(options, (req, res) => {
              req.resume().on("error", () => {});
              // Not reached: the message never completes.
              req.on("end", () => {
                ended = true;
                res.end("ok");
              });
            });
            if (limit !== undefined) server.maxHeadersCount = limit;
            const clientError = new Promise<any>(resolve => {
              server.on("clientError", (err, socket) => {
                resolve(err);
                socket.destroy();
              });
            });
            try {
              assert.strictEqual(await roundtrip(server, chunked + section), "");
              assert.strictEqual((await clientError).code, code);
              assert.strictEqual(ended, false);
            } finally {
              close(server);
            }
          });
        }

        rejectTest("with no 'clientError' listener the response has the status of the first defect", async () => {
          const server = http.createServer(req => void req.resume().on("error", () => {}));
          server.maxHeadersCount = 3;
          try {
            assert.strictEqual(
              await roundtrip(server, chunked + "A: 1\r\nContent-Length: 1\r\nC: 3\r\nD: 4\r\n\r\n"),
              badRequest,
            );
            assert.strictEqual(
              await roundtrip(server, chunked + "A: 1\r\nB: 2\r\nC: 3\r\nD: 4\r\nbad line\r\n\r\n"),
              tooLarge,
            );
          } finally {
            close(server);
          }
        });
      });
    });
  });
}

describe("server.maxHeadersCount, listen() only", () => {
  rejectTest("assignment after listen() applies to the next connection", async () => {
    const seen: Seen[] = [];
    const server = http.createServer(record(seen));
    try {
      const port = await listen(server);
      assert.strictEqual(statusLine(await exchange(port, requestHead(6))), ok);
      server.maxHeadersCount = 3;
      assert.strictEqual(server.maxHeadersCount, 3);
      assert.strictEqual(await exchange(port, requestHead(6)), tooLarge);
      server.maxHeadersCount = null;
      assert.strictEqual(server.maxHeadersCount, null);
      assert.strictEqual(statusLine(await exchange(port, requestHead(6))), ok);
      // The default again, and not no limit.
      assert.strictEqual(await exchange(port, requestHead(1001)), tooLarge);
      assert.deepStrictEqual(
        seen.map(request => request.fields),
        [6, 6],
      );
    } finally {
      server.close();
    }
  });

  for (const limit of [3, 1000]) {
    test(`https.Server accepts a request at the limit of ${limit}`, async () => {
      const seen: Seen[] = [];
      const server = https.createServer({ cert, key }, record(seen));
      server.maxHeadersCount = limit;
      try {
        assert.strictEqual(statusLine(await exchange(await listen(server), requestHead(limit), true)), ok);
        assert.deepStrictEqual(seen, [{ url: "/", fields: limit, host: "localhost" }]);
      } finally {
        server.close();
      }
    });

    rejectTest(`https.Server rejects a request over the limit of ${limit}`, async () => {
      const seen: Seen[] = [];
      const server = https.createServer({ cert, key }, record(seen));
      server.maxHeadersCount = limit;
      try {
        assert.strictEqual(await exchange(await listen(server), requestHead(limit + 1), true), tooLarge);
        assert.deepStrictEqual(seen, []);
      } finally {
        server.close();
      }
    });
  }

  // Node reads the option in its own listener of 'connection', and of 'secureConnection' for https.
  // A listener that runs before that one sets the limit of the connection that it gets.
  const setsLimit = (server: http.Server, value: number | null) => () => void (server.maxHeadersCount = value);
  const earlierListeners: [
    title: string,
    secure: boolean,
    limit: number | undefined,
    listen: (server: http.Server) => void,
    status: string,
  ][] = [
    ['https, on("connection") sets 3', true, undefined, server => server.on("connection", setsLimit(server, 3)), "431"],
    [
      'https with a limit of 3, on("connection") sets null',
      true,
      3,
      server => server.on("connection", setsLimit(server, null)),
      "200",
    ],
    [
      'https, prependListener("secureConnection") sets 3',
      true,
      undefined,
      server => server.prependListener("secureConnection", setsLimit(server, 3)),
      "431",
    ],
    [
      'http, prependListener("connection") sets 3',
      false,
      undefined,
      server => server.prependListener("connection", setsLimit(server, 3)),
      "431",
    ],
  ];
  for (const [title, secure, limit, addListener, status] of earlierListeners) {
    rejectTest(`${title}: a request of 6 fields on that connection gets ${status}`, async () => {
      const server = secure ? https.createServer({ cert, key }, record([])) : http.createServer(record([]));
      if (limit !== undefined) server.maxHeadersCount = limit;
      addListener(server);
      try {
        const response = await exchange(await listen(server), requestHead(6), secure);
        assert.strictEqual(response.slice(9, 12), status);
      } finally {
        server.close();
      }
    });
  }

  // 39.8 KB: the head takes more than one TLS record.
  test("https.Server passes 3000 fields when there is no limit", async () => {
    const seen: Seen[] = [];
    const server = https.createServer({ cert, key, ...roomy }, record(seen));
    server.maxHeadersCount = 0;
    try {
      assert.strictEqual(statusLine(await exchange(await listen(server), requestHead(3000), true)), ok);
      assert.deepStrictEqual(seen, [{ url: "/", fields: 3000, host: "localhost" }]);
    } finally {
      server.close();
    }
  });
});

describe('server.maxHeadersCount, emit("connection") only', () => {
  rejectTest("an allowHTTP1 HTTP/2 server enforces the limit on HTTP/1.1 connections", async () => {
    let requests = 0;
    const server = http2.createSecureServer({ cert, key, allowHTTP1: true }, (req, res) => {
      requests++;
      res.end("ok");
    });
    (server as any).maxHeadersCount = 3;
    try {
      const port = await listen(server);
      assert.strictEqual(statusLine(await exchange(port, requestHead(3), true)), ok);
      assert.strictEqual(await exchange(port, requestHead(4), true), tooLarge);
      assert.strictEqual(requests, 1);
    } finally {
      server.close();
    }
  });
});

// The client is unchanged: res.headers is cut at req.maxHeadersCount and nothing fails.
test("a response over ClientRequest.maxHeadersCount is truncated, not rejected", async () => {
  const server = net.createServer(socket => {
    socket.once("data", () => {
      socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\nA: 1\r\nB: 2\r\nC: 3\r\nD: 4\r\n\r\nok");
    });
  });
  try {
    const port = await listen(server);
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request({ port, host: "127.0.0.1" }, resolve);
      req.maxHeadersCount = 4;
      req.on("error", reject);
      req.end();
    });
    assert.deepStrictEqual(Object.keys(res.headers), ["content-length", "connection", "a", "b"]);
    assert.deepStrictEqual(await res.setEncoding("utf8").toArray(), ["ok"]);
  } finally {
    server.close();
  }
});

describe("HTTPParser maxHeaderPairs", () => {
  // Drives the binding with the callback protocol of node:_http_common: once the parser has
  // flushed through kOnHeaders, kOnHeadersComplete gets no headers argument.
  function parse(type: number, maxHeaderPairs: unknown, input: string) {
    const parser = new HTTPParser();
    parser.initialize(type, {});
    if (maxHeaderPairs !== undefined) parser.maxHeaderPairs = maxHeaderPairs;
    const headers: string[][] = [];
    const trailers: string[][] = [];
    let flushed: string[] = [];
    parser[HTTPParser.kOnHeaders] = (fields: string[]) => {
      flushed = flushed.concat(fields);
    };
    parser[HTTPParser.kOnHeadersComplete] = (_major: number, _minor: number, fields?: string[]) => {
      headers.push(fields ?? flushed);
      flushed = [];
    };
    parser[HTTPParser.kOnMessageComplete] = () => {
      trailers.push(flushed);
      flushed = [];
    };
    const result = parser.execute(Buffer.from(input, "latin1"));
    parser.close();
    return { result, headers, trailers };
  }

  rejectTest("a request parser fails on the first field past maxHeaderPairs / 2", () => {
    const { result, headers } = parse(HTTPParser.REQUEST, 4, "GET / HTTP/1.1\r\nA: 1\r\nB: 2\r\nC: 3\r\n\r\n");
    assert.ok(result instanceof Error);
    assert.deepStrictEqual(
      { code: (result as any).code, reason: (result as any).reason, message: result.message },
      { code: "HPE_HEADER_OVERFLOW", reason: "Header overflow", message: "Parse Error" },
    );
    assert.deepStrictEqual(headers, []);
  });

  test("the count restarts for every message and for the trailers", () => {
    const message = "POST / HTTP/1.1\r\nA: 1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nT1: 1\r\nT2: 2\r\n\r\n";
    const { result, headers, trailers } = parse(HTTPParser.REQUEST, 4, message + message);
    assert.strictEqual(result, message.length * 2);
    assert.deepStrictEqual(headers, [
      ["A", "1", "Transfer-Encoding", "chunked"],
      ["A", "1", "Transfer-Encoding", "chunked"],
    ]);
    assert.deepStrictEqual(trailers, [
      ["T1", "1", "T2", "2"],
      ["T1", "1", "T2", "2"],
    ]);
  });

  rejectTest("trailers past the limit fail", () => {
    const { result, headers } = parse(
      HTTPParser.REQUEST,
      4,
      "POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nT1: 1\r\nT2: 2\r\nT3: 3\r\n\r\n",
    );
    assert.ok(result instanceof Error);
    assert.strictEqual((result as any).code, "HPE_HEADER_OVERFLOW");
    assert.deepStrictEqual(headers, [["Transfer-Encoding", "chunked"]]);
  });

  for (const maxHeaderPairs of [undefined, 0, -2, "4", null]) {
    test(`maxHeaderPairs = ${show(maxHeaderPairs)} sets no limit`, () => {
      const input = "GET / HTTP/1.1\r\nA: 1\r\nB: 2\r\nC: 3\r\n\r\n";
      const { result, headers } = parse(HTTPParser.REQUEST, maxHeaderPairs, input);
      assert.strictEqual(result, input.length);
      assert.deepStrictEqual(headers, [["A", "1", "B", "2", "C", "3"]]);
    });
  }

  rejectTest("an exception from a maxHeaderPairs getter leaves execute()", () => {
    const parser = new HTTPParser();
    parser.initialize(HTTPParser.REQUEST, {});
    Object.defineProperty(parser, "maxHeaderPairs", {
      get() {
        throw new Error("from the getter");
      },
    });
    assert.throws(() => parser.execute(Buffer.from("GET / HTTP/1.1\r\nA: 1\r\n\r\n")), { message: "from the getter" });
    parser.close();
  });

  test("a response parser does not count fields", () => {
    const input = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nA: 1\r\nB: 2\r\nC: 3\r\n\r\n";
    const { result, headers } = parse(HTTPParser.RESPONSE, 4, input);
    assert.strictEqual(result, input.length);
    assert.deepStrictEqual(headers, [["Content-Length", "0", "A", "1", "B", "2", "C", "3"]]);
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExe } = await import("harness");
  const node = nodeExe();

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
