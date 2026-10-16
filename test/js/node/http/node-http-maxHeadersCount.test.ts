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
 * The native server also kept at most 198 fields of a request, so the option
 * could lower the limit and not raise it. In Node the option alone is the limit,
 * and there is none when `maxHeadersCount << 1` is not positive. The cases with
 * more than 198 fields were recorded from Node v26.12.0.
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
import { duplexPair } from "node:stream";
import { describe, test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

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
const tooLarge = "HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n";

// A request head with exactly `fields` header fields: Host (unless `host` is false), then
// `extra`, then filler. `at` gives the line of a field by its number, counted from 1, in the
// place of the filler. The last field is Connection: close unless `close` is false, so an
// accepted request ends the connection after its response.
function requestHead(
  fields: number,
  {
    requestLine = "GET / HTTP/1.1",
    close = true,
    host = true,
    extra = [] as string[],
    at = {} as Record<number, string>,
  } = {},
) {
  const lines = [requestLine, ...(host ? ["Host: localhost"] : []), ...extra];
  for (let i = lines.length - 1; i < fields - 1; i++) lines.push(at[i + 1] ?? `X-${i}: ${i}`);
  lines.push(at[fields] ?? (close ? "Connection: close" : "X-Last: 1"));
  return lines.join("\r\n") + "\r\n\r\n";
}

// The [name, value, ...] list that a head from requestHead carries.
function rawHeadersOf(head: string) {
  return head
    .split("\r\n")
    .slice(1, -2)
    .flatMap(line => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()]);
}

// `bytes` in `parts` pieces of the same size.
function inParts(bytes: string, parts: number) {
  const size = Math.ceil(bytes.length / parts);
  return Array.from({ length: parts }, (_, i) => bytes.slice(i * size, (i + 1) * size));
}

// A string is one write. The strings of an array are written one by one, with a turn of the
// event loop between them, so that the server can read a part before the next one is sent.
// No result depends on where the reads split.
type Payload = string | string[];
async function writePayload(socket: NodeJS.WritableStream, payload: Payload) {
  if (typeof payload === "string") return void socket.write(payload);
  for (const part of payload) {
    socket.write(part);
    await new Promise(resolve => setImmediate(resolve));
  }
}

// Writes `payload` and resolves with every byte the server sent before it closed the connection.
function exchange(port: number, payload: Payload, secure = false) {
  return new Promise<string>((resolve, reject) => {
    const socket = secure
      ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] })
      : net.connect(port, "127.0.0.1");
    let received = "";
    socket.setEncoding("latin1");
    socket.setNoDelay(true);
    socket.on("data", chunk => (received += chunk));
    socket.on("error", reject);
    socket.on("close", () => resolve(received));
    socket.once(secure ? "secureConnect" : "connect", () => void writePayload(socket, payload));
  });
}

async function listen(server: net.Server) {
  if (!server.listening) await once(server.listen(0, "127.0.0.1"), "listening");
  return (server.address() as AddressInfo).port;
}

type Transport = {
  name: string;
  // The fields that a server takes when the option is not a number.
  unsetLimit: number;
  // Sends `payload` on a new connection and resolves with every byte the server answered.
  roundtrip: (server: http.Server, payload: Payload) => Promise<string>;
  close: (server: http.Server) => void;
};
const transports: Transport[] = [
  {
    // Bun parses these connections in the native server. Node's parser starts with
    // maxHeaderPairs = 2000, which is 1000 fields. Bun's native server keeps 198 for now:
    // see the fetch() test below.
    name: "listen()",
    unsetLimit: process.versions.bun ? 198 : 1000,
    roundtrip: async (server, payload) => exchange(await listen(server), payload),
    close: server => void server.close(),
  },
  {
    // Bun parses these with the llhttp binding, like the HTTP/1.1 connections of an
    // allowHTTP1 HTTP/2 server.
    name: 'emit("connection")',
    unsetLimit: 1000,
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
        void writePayload(client, payload);
      }),
    close: () => {},
  },
];

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

for (const { name, unsetLimit, roundtrip, close } of transports) {
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
    for (const limit of [2, 31, 32, 33, 100]) {
      test(`limit ${limit}: a request at the limit passes with every field`, async () => {
        const seen: Seen[] = [];
        const server = http.createServer(record(seen));
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
        const server = http.createServer(record(seen));
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

    // The native server keeps 198 fields inside the request object. These limits are above that.
    for (const limit of [199, 500, 1500]) {
      test(`limit ${limit}: a request at the limit passes with every field`, async () => {
        const seen: Seen[] = [];
        const server = http.createServer(record(seen));
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
        const server = http.createServer(record(seen));
        server.maxHeadersCount = limit;
        try {
          assert.strictEqual(await roundtrip(server, requestHead(limit + 1)), tooLarge);
          assert.deepStrictEqual(seen, []);
        } finally {
          close(server);
        }
      });
    }

    // `maxHeadersCount << 1` is not positive for these values, and then Node's parser does not count.
    for (const value of [0, 0.5, -1, NaN, Infinity, 2 ** 30]) {
      test(`maxHeadersCount = ${show(value)} sets no limit`, async () => {
        const seen: Seen[] = [];
        const server = http.createServer(record(seen));
        server.maxHeadersCount = value;
        try {
          assert.strictEqual(statusLine(await roundtrip(server, requestHead(1200))), ok);
          assert.deepStrictEqual(seen, [{ url: "/", fields: 1200, host: "localhost" }]);
        } finally {
          close(server);
        }
      });
    }

    // Only a number sets the limit.
    for (const value of [undefined, null, "2", true]) {
      const title = value === undefined ? "the option not set" : `maxHeadersCount = ${show(value)}`;

      test(`${title}: ${unsetLimit} fields pass, each in its place`, async () => {
        let rawHeaders: string[] = [];
        const server = http.createServer((req, res) => {
          rawHeaders = req.rawHeaders;
          res.end("ok");
        });
        if (value !== undefined) server.maxHeadersCount = value as number;
        try {
          const head = requestHead(unsetLimit);
          assert.strictEqual(statusLine(await roundtrip(server, head)), ok);
          assert.deepStrictEqual(rawHeaders, rawHeadersOf(head));
        } finally {
          close(server);
        }
      });

      rejectTest(`${title}: ${unsetLimit + 1} fields fail`, async () => {
        const seen: Seen[] = [];
        const server = http.createServer(record(seen));
        if (value !== undefined) server.maxHeadersCount = value as number;
        try {
          assert.strictEqual(await roundtrip(server, requestHead(unsetLimit + 1)), tooLarge);
          assert.deepStrictEqual(seen, []);
        } finally {
          close(server);
        }
      });
    }

    // The limit is a number to compare with. No storage has its size: this is the largest one.
    test("maxHeadersCount = 2 ** 30 - 1 passes a request with 300 fields", async () => {
      const seen: Seen[] = [];
      const server = http.createServer(record(seen));
      server.maxHeadersCount = 2 ** 30 - 1;
      try {
        assert.strictEqual(statusLine(await roundtrip(server, requestHead(300))), ok);
        assert.deepStrictEqual(seen, [{ url: "/", fields: 300, host: "localhost" }]);
      } finally {
        close(server);
      }
    });

    test("a head with 1000 fields that arrives in 16 parts passes, each field in its place", async () => {
      let rawHeaders: string[] = [];
      const server = http.createServer((req, res) => {
        rawHeaders = req.rawHeaders;
        res.end("ok");
      });
      server.maxHeadersCount = 1000;
      try {
        const head = requestHead(1000);
        assert.strictEqual(statusLine(await roundtrip(server, inParts(head, 16))), ok);
        assert.deepStrictEqual(rawHeaders, rawHeadersOf(head));
      } finally {
        close(server);
      }
    });

    test("pipelined requests with 8, 500, 600 and 3 fields each get their own fields", async () => {
      const seen: Seen[] = [];
      const server = http.createServer(record(seen));
      server.maxHeadersCount = 600;
      try {
        const response = await roundtrip(
          server,
          requestHead(8, { requestLine: "GET /a HTTP/1.1", close: false }) +
            requestHead(500, { requestLine: "GET /b HTTP/1.1", close: false }) +
            requestHead(600, { requestLine: "GET /c HTTP/1.1", close: false }) +
            requestHead(3, { requestLine: "GET /d HTTP/1.1" }),
        );
        assert.strictEqual(statusLine(response), ok);
        assert.deepStrictEqual(seen, [
          { url: "/a", fields: 8, host: "localhost" },
          { url: "/b", fields: 500, host: "localhost" },
          { url: "/c", fields: 600, host: "localhost" },
          { url: "/d", fields: 3, host: "localhost" },
        ]);
      } finally {
        close(server);
      }
    });

    // The second head has one field more than the first one.
    for (const parts of [1, 2]) {
      const arrival = parts === 1 ? "" : ", and the first head arrives in two parts";
      test(`a pipelined request with 301 fields passes behind one with 300${arrival}`, async () => {
        const rawHeaders: string[][] = [];
        const server = http.createServer((req, res) => {
          rawHeaders.push(req.rawHeaders);
          res.end("ok");
        });
        server.maxHeadersCount = 301;
        try {
          const first = requestHead(300, { requestLine: "GET /a HTTP/1.1", close: false });
          const second = requestHead(301, { requestLine: "GET /b HTTP/1.1" });
          const payload = parts === 1 ? first + second : [first.slice(0, 2000), first.slice(2000) + second];
          assert.strictEqual(statusLine(await roundtrip(server, payload)), ok);
          assert.deepStrictEqual(rawHeaders, [rawHeadersOf(first), rawHeadersOf(second)]);
        } finally {
          close(server);
        }
      });
    }

    rejectTest("a pipelined request with 301 fields fails behind one with 300 under a limit of 300", async () => {
      const seen: Seen[] = [];
      let code: string | undefined;
      const server = http.createServer(record(seen));
      server.maxHeadersCount = 300;
      server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
        code = err.code;
        socket.destroy();
      });
      try {
        await roundtrip(
          server,
          requestHead(300, { requestLine: "GET /one HTTP/1.1", close: false }) +
            requestHead(301, { requestLine: "GET /two HTTP/1.1" }),
        );
        assert.strictEqual(code, "HPE_HEADER_OVERFLOW");
        assert.deepStrictEqual(seen, [{ url: "/one", fields: 300, host: "localhost" }]);
      } finally {
        close(server);
      }
    });

    test("an upgrade request with 300 fields reaches 'upgrade' with every field", async () => {
      let fields = 0;
      const server = http.createServer();
      server.maxHeadersCount = 300;
      server.on("upgrade", (req, socket) => {
        // The answer goes out first. The listener owns the socket from there on and still reads the fields.
        socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: x\r\n\r\n");
        fields = req.rawHeaders.length / 2;
        socket.end();
      });
      try {
        const head = requestHead(300, { extra: ["Connection: Upgrade", "Upgrade: x"], close: false });
        assert.strictEqual(statusLine(await roundtrip(server, head)), "HTTP/1.1 101 Switching Protocols");
        assert.strictEqual(fields, 300);
      } finally {
        close(server);
      }
    });

    test("a CONNECT request with 300 fields reaches 'connect' with every field", async () => {
      let fields = 0;
      const server = http.createServer();
      server.maxHeadersCount = 300;
      server.on("connect", (req, socket) => {
        fields = req.rawHeaders.length / 2;
        socket.end("HTTP/1.1 200 Connection Established\r\n\r\n");
      });
      try {
        const head = requestHead(300, { requestLine: "CONNECT example.com:443 HTTP/1.1", close: false });
        assert.strictEqual(statusLine(await roundtrip(server, head)), "HTTP/1.1 200 Connection Established");
        assert.strictEqual(fields, 300);
      } finally {
        close(server);
      }
    });

    test("a request with Expect: 100-continue and 300 fields reaches 'checkContinue' with every field", async () => {
      let fields = 0;
      const server = http.createServer();
      server.maxHeadersCount = 300;
      server.on("checkContinue", (req, res) => {
        fields = req.rawHeaders.length / 2;
        res.end("ok");
      });
      try {
        const head = requestHead(300, { extra: ["Expect: 100-continue"] });
        assert.strictEqual(statusLine(await roundtrip(server, head)), ok);
        assert.strictEqual(fields, 300);
      } finally {
        close(server);
      }
    });

    test("req.headers, req.headersDistinct and req.rawHeaders agree for 300 fields", async () => {
      let seen: unknown;
      const server = http.createServer((req, res) => {
        // req.headers is read first: Bun builds it from the parsed head when rawHeaders was not read.
        const headers = { ...req.headers };
        seen = { headers, headersDistinct: { ...req.headersDistinct }, rawHeaders: req.rawHeaders };
        res.end("ok");
      });
      server.maxHeadersCount = 300;
      try {
        // X-Twice is on both sides of field 198.
        const head = requestHead(300, { at: { 10: "X-Twice: a", 250: "X-Twice: b" } });
        assert.strictEqual(statusLine(await roundtrip(server, head)), ok);
        const rawHeaders = rawHeadersOf(head);
        const headers: Record<string, string> = {};
        const headersDistinct: Record<string, string[]> = {};
        for (let i = 0; i < rawHeaders.length; i += 2) {
          const name = rawHeaders[i].toLowerCase();
          headers[name] = name in headers ? `${headers[name]}, ${rawHeaders[i + 1]}` : rawHeaders[i + 1];
          (headersDistinct[name] ??= []).push(rawHeaders[i + 1]);
        }
        assert.deepStrictEqual(seen, { headers, headersDistinct, rawHeaders });
      } finally {
        close(server);
      }
    });

    describe("a field behind field 198 frames the body", () => {
      // The body is a complete request. A server that does not see the field dispatches it.
      const inner = "GET /inner HTTP/1.1\r\nHost: localhost\r\n\r\n";
      const next = requestHead(3, { requestLine: "GET /next HTTP/1.1" });
      type Body = { url: string; fields: number; body: string };
      function recordBodies(bodies: Body[]) {
        return (req: http.IncomingMessage, res: http.ServerResponse) => {
          let body = "";
          req.setEncoding("latin1");
          req.on("data", chunk => (body += chunk));
          req.on("end", () => {
            bodies.push({ url: req.url!, fields: req.rawHeaders.length / 2, body });
            res.end("ok");
          });
        };
      }

      for (const [fields, position] of [
        [600, 500],
        [199, 199],
      ]) {
        for (const parts of [1, 3]) {
          const arrival = parts === 1 ? "" : `, the head in ${parts} parts`;
          test(`Content-Length as field ${position} of ${fields}${arrival}`, async () => {
            const bodies: Body[] = [];
            const server = http.createServer(recordBodies(bodies));
            server.maxHeadersCount = 600;
            try {
              const head = requestHead(fields, {
                requestLine: "POST /outer HTTP/1.1",
                close: false,
                at: { [position]: `Content-Length: ${inner.length}` },
              });
              const payload = parts === 1 ? head + inner + next : [...inParts(head, parts), inner + next];
              assert.strictEqual(statusLine(await roundtrip(server, payload)), ok);
              assert.deepStrictEqual(bodies, [
                { url: "/outer", fields, body: inner },
                { url: "/next", fields: 3, body: "" },
              ]);
            } finally {
              close(server);
            }
          });
        }
      }

      test("Transfer-Encoding: chunked as field 500 of 600", async () => {
        const bodies: Body[] = [];
        const server = http.createServer(recordBodies(bodies));
        server.maxHeadersCount = 600;
        try {
          const head = requestHead(600, {
            requestLine: "POST /outer HTTP/1.1",
            close: false,
            at: { 500: "Transfer-Encoding: chunked" },
          });
          const chunks = `${inner.length.toString(16)}\r\n${inner}\r\n0\r\n\r\n`;
          assert.strictEqual(statusLine(await roundtrip(server, head + chunks + next)), ok);
          assert.deepStrictEqual(bodies, [
            { url: "/outer", fields: 600, body: inner },
            { url: "/next", fields: 3, body: "" },
          ]);
        } finally {
          close(server);
        }
      });

      for (const [title, at, code] of [
        [
          "Content-Length as field 10 and Transfer-Encoding as field 500",
          { 10: "Content-Length: 4", 500: "Transfer-Encoding: chunked" },
          "HPE_INVALID_TRANSFER_ENCODING",
        ],
        [
          "a second Content-Length with another value as field 500",
          { 10: "Content-Length: 4", 500: "Content-Length: 5" },
          "HPE_UNEXPECTED_CONTENT_LENGTH",
        ],
      ] as const) {
        test(`${title} fail`, async () => {
          const bodies: Body[] = [];
          let seenCode: string | undefined;
          const server = http.createServer(recordBodies(bodies));
          server.maxHeadersCount = 600;
          server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
            seenCode = err.code;
            socket.destroy();
          });
          try {
            const head = requestHead(600, { requestLine: "POST /outer HTTP/1.1", close: false, at });
            await roundtrip(server, head + "abcd" + next);
            assert.deepStrictEqual({ code: seenCode, bodies }, { code, bodies: [] });
          } finally {
            close(server);
          }
        });
      }

      test("Host as field 500 of 600 is the host of the request", async () => {
        const seen: Seen[] = [];
        const server = http.createServer(record(seen));
        server.maxHeadersCount = 600;
        try {
          const head = requestHead(600, { host: false, at: { 500: "Host: behind" } });
          assert.strictEqual(statusLine(await roundtrip(server, head)), ok);
          assert.deepStrictEqual(seen, [{ url: "/", fields: 600, host: "behind" }]);
        } finally {
          close(server);
        }
      });
    });

    // A head with more than 198 fields is checked like a shorter one.
    test("a control byte in the value of field 300 fails", async () => {
      const seen: Seen[] = [];
      let code: string | undefined;
      const server = http.createServer(record(seen));
      server.maxHeadersCount = 400;
      server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
        code = err.code;
        socket.destroy();
      });
      try {
        await roundtrip(server, requestHead(400, { at: { 300: "X-Bad: a\u0001b" } }));
        assert.deepStrictEqual({ code, seen }, { code: "HPE_INVALID_HEADER_TOKEN", seen: [] });
      } finally {
        close(server);
      }
    });

    test("names and values of 16 KiB fail when they pass that size behind field 198", async () => {
      const seen: Seen[] = [];
      const server = http.createServer(record(seen));
      server.maxHeadersCount = 400;
      try {
        const at: Record<number, string> = {};
        for (let i = 199; i < 249; i++) at[i] = `X-Big-${i}: ${Buffer.alloc(330, "v").toString()}`;
        assert.strictEqual(await roundtrip(server, requestHead(249, { at })), tooLarge);
        assert.deepStrictEqual(seen, []);
      } finally {
        close(server);
      }
    });

    test("a malformed line behind 250 fields fails before the head is complete", async () => {
      const seen: Seen[] = [];
      const server = http.createServer(record(seen));
      server.maxHeadersCount = 400;
      try {
        // No blank line: the server must not wait for one.
        const head = requestHead(250, { close: false }).slice(0, -2) + "no colon\r\n";
        assert.strictEqual(statusLine(await roundtrip(server, head)), "HTTP/1.1 400 Bad Request");
        assert.deepStrictEqual(seen, []);
      } finally {
        close(server);
      }
    });

    // Node counts the URL, the names and the values against maxHeaderSize (16 KiB), and not the
    // ": " and the line ends. A head can be larger than maxHeaderSize by those bytes. A
    // maxHeaderSize of 0 selects the default size.
    for (const maxHeaderSize of [undefined, 0]) {
      const size = maxHeaderSize === undefined ? "" : `, maxHeaderSize = ${maxHeaderSize}`;
      test(`1000 fields of 14 bytes each pass in a head of 18 KB${size}`, async () => {
        const seen: Seen[] = [];
        const server = http.createServer({ maxHeaderSize }, record(seen));
        server.maxHeadersCount = 1000;
        try {
          const lines = ["GET / HTTP/1.1", "Host: localhost"];
          for (let i = lines.length - 1; i < 999; i++) lines.push(`X-Field-${String(i).padStart(3, "0")}: abc`);
          lines.push("Connection: close");
          const head = lines.join("\r\n") + "\r\n\r\n";
          assert.ok(head.length > 18000);
          assert.strictEqual(statusLine(await roundtrip(server, head)), ok);
          assert.deepStrictEqual(seen, [{ url: "/", fields: 1000, host: "localhost" }]);
        } finally {
          close(server);
        }
      });
    }

    // The space in front of a value does not count either. `fields` fields with 400 spaces each.
    const paddedHead = (fields: number) => {
      const lines = ["GET / HTTP/1.1", "Host: localhost"];
      for (let i = 0; i < fields - 2; i++) lines.push(`X-${i}:${Buffer.alloc(400, " ").toString()}v`);
      lines.push("Connection: close");
      return lines.join("\r\n") + "\r\n\r\n";
    };

    test("a head of 17000 bytes passes under a limit of 50", async () => {
      const seen: Seen[] = [];
      const server = http.createServer(record(seen));
      server.maxHeadersCount = 50;
      try {
        const head = paddedHead(44);
        assert.ok(head.length > 17000);
        assert.strictEqual(statusLine(await roundtrip(server, head)), ok);
        assert.deepStrictEqual(seen, [{ url: "/", fields: 44, host: "localhost" }]);
      } finally {
        close(server);
      }
    });

    test("a head of 18000 bytes passes in three parts under a limit of 1000", async () => {
      const seen: Seen[] = [];
      const server = http.createServer(record(seen));
      server.maxHeadersCount = 1000;
      try {
        const head = paddedHead(47);
        assert.ok(head.length > 18000);
        assert.strictEqual(statusLine(await roundtrip(server, inParts(head, 3))), ok);
        assert.deepStrictEqual(seen, [{ url: "/", fields: 47, host: "localhost" }]);
      } finally {
        close(server);
      }
    });

    test("1500 fields pass in a head of 21 KB when there is no limit", async () => {
      const seen: Seen[] = [];
      const server = http.createServer(record(seen));
      server.maxHeadersCount = 0;
      try {
        const lines = ["GET / HTTP/1.1", "Host: localhost"];
        for (let i = lines.length - 1; i < 1499; i++) lines.push(`X-${String(i).padStart(4, "0")}:     v`);
        lines.push("Connection: close");
        const head = lines.join("\r\n") + "\r\n\r\n";
        assert.ok(head.length > 20448);
        assert.strictEqual(statusLine(await roundtrip(server, head)), ok);
        assert.deepStrictEqual(seen, [{ url: "/", fields: 1500, host: "localhost" }]);
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

    describe("trailers count from zero against the same limit", () => {
      const chunked =
        "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n3\r\nabc\r\n0\r\n";

      test("at the limit they are delivered", async () => {
        let rawTrailers: string[] | undefined;
        const server = http.createServer((req, res) => {
          req.resume().on("end", () => {
            rawTrailers = req.rawTrailers;
            res.end("ok");
          });
        });
        server.maxHeadersCount = 3;
        try {
          const response = await roundtrip(server, chunked + "A: 1\r\nB: 2\r\nC: 3\r\n\r\n");
          assert.strictEqual(statusLine(response), ok);
          assert.deepStrictEqual(rawTrailers, ["A", "1", "B", "2", "C", "3"]);
        } finally {
          close(server);
        }
      });

      rejectTest("over the limit the request fails with HPE_HEADER_OVERFLOW", async () => {
        let ended = false;
        const server = http.createServer();
        server.maxHeadersCount = 3;
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
          const response = await roundtrip(server, chunked + "A: 1\r\nB: 2\r\nC: 3\r\nD: 4\r\n\r\n");
          assert.strictEqual(response, "");
          assert.strictEqual((await clientError).code, "HPE_HEADER_OVERFLOW");
          assert.strictEqual((await requestError).code, "ECONNRESET");
          assert.strictEqual(ended, false);
        } finally {
          close(server);
        }
      });

      // How the request arrives. The native server reads a trailer section in three places: behind
      // the head and the body of the same read, in a read of its own, and behind a head that took
      // several reads.
      const chunkedHead = chunked.slice(0, chunked.indexOf("\r\n\r\n") + 4);
      const chunkedBody = chunked.slice(chunkedHead.length);
      const arrivals: Record<string, (trailers: string) => Payload> = {
        "in one write": trailers => chunked + trailers + "\r\n",
        "the head, the body and the trailers in three writes": trailers => [
          chunkedHead,
          chunkedBody,
          trailers + "\r\n",
        ],
        "the head in three writes": trailers => [
          chunkedHead.slice(0, 20),
          chunkedHead.slice(20, 50),
          chunkedHead.slice(50) + chunkedBody + trailers + "\r\n",
        ],
      };

      // Sends the chunked request with the field lines `trailers` behind its last chunk. Resolves
      // with the rawTrailers that the request got, or with the code of the 'clientError'.
      async function sendTrailers(trailers: string, maxHeadersCount?: number, arrival = "in one write") {
        let rawTrailers: string[] | undefined;
        let code: string | undefined;
        const server = http.createServer((req, res) => {
          req.on("error", () => {});
          req.resume().on("end", () => {
            rawTrailers = req.rawTrailers;
            res.end("ok");
          });
        });
        if (maxHeadersCount !== undefined) server.maxHeadersCount = maxHeadersCount;
        server.on("clientError", (err: NodeJS.ErrnoException, socket) => {
          code = err.code;
          socket.destroy();
        });
        try {
          const status = statusLine(await roundtrip(server, arrivals[arrival](trailers)));
          return code ? { code } : { status, rawTrailers };
        } finally {
          close(server);
        }
      }
      // `count` trailer fields: "T0: 0" and so on.
      const trailerFields = (count: number) => Array.from({ length: count }, (_, i) => [`T${i}`, `${i}`]);
      const trailerLines = (fields: string[][]) => fields.map(([name, value]) => `${name}: ${value}\r\n`).join("");

      for (const arrival of Object.keys(arrivals)) {
        test(`250 of them are delivered under a limit of 250, ${arrival}`, async () => {
          const fields = trailerFields(250);
          assert.deepStrictEqual(await sendTrailers(trailerLines(fields), 250, arrival), {
            status: ok,
            rawTrailers: fields.flat(),
          });
        });

        rejectTest(`251 of them fail under a limit of 250, ${arrival}`, async () => {
          assert.deepStrictEqual(await sendTrailers(trailerLines(trailerFields(251)), 250, arrival), {
            code: "HPE_HEADER_OVERFLOW",
          });
        });
      }

      test(`${unsetLimit} of them are delivered when the option is not set`, async () => {
        const fields = trailerFields(unsetLimit);
        assert.deepStrictEqual(await sendTrailers(trailerLines(fields)), { status: ok, rawTrailers: fields.flat() });
      });

      rejectTest(`${unsetLimit + 1} of them fail when the option is not set`, async () => {
        assert.deepStrictEqual(await sendTrailers(trailerLines(trailerFields(unsetLimit + 1))), {
          code: "HPE_HEADER_OVERFLOW",
        });
      });

      test("1200 of them are delivered when there is no limit", async () => {
        const fields = trailerFields(1200);
        assert.deepStrictEqual(await sendTrailers(trailerLines(fields), 0), { status: ok, rawTrailers: fields.flat() });
      });

      // The names and the values count against maxHeaderSize (16 KiB) from zero, like the ones of
      // the head. The space in front of a value does not count, and the space behind it does.
      const value = (bytes: number, fill = "v") => Buffer.alloc(bytes, fill).toString();
      test("names and values of 16383 bytes are delivered", async () => {
        assert.deepStrictEqual(await sendTrailers(`T: ${value(16382)}\r\n`, 10), {
          status: ok,
          rawTrailers: ["T", value(16382)],
        });
      });

      test("names and values of 16384 bytes fail", async () => {
        assert.deepStrictEqual(await sendTrailers(`T: ${value(16383)}\r\n`, 10), { code: "HPE_HEADER_OVERFLOW" });
      });

      test("space in front of a value does not count", async () => {
        assert.deepStrictEqual(await sendTrailers(`T:${value(600, " ")}${value(16000)}\r\n`, 10), {
          status: ok,
          rawTrailers: ["T", value(16000)],
        });
      });

      test("space behind a value counts", async () => {
        assert.deepStrictEqual(await sendTrailers(`T: ${value(16000)}${value(400, " ")}\r\n`, 10), {
          code: "HPE_HEADER_OVERFLOW",
        });
      });

      test("1000 of them pass in a section of 19 KB", async () => {
        const fields = Array.from({ length: 1000 }, (_, i) => [`X-Trailer-${String(i).padStart(4, "0")}`, "v"]);
        const lines = trailerLines(fields);
        assert.ok(lines.length >= 19000);
        assert.deepStrictEqual(await sendTrailers(lines, 1000), { status: ok, rawTrailers: fields.flat() });
      });

      test("42 of them pass in a section of 18 KB that arrives in a read of its own", async () => {
        const fields = Array.from({ length: 42 }, (_, i) => [`T${i}`, "v"]);
        const lines = fields.map(([name, v]) => `${name}:${value(420, " ")}${v}\r\n`).join("");
        assert.ok(lines.length > 17248);
        assert.deepStrictEqual(await sendTrailers(lines, 1000, "the head, the body and the trailers in three writes"), {
          status: ok,
          rawTrailers: fields.flat(),
        });
      });

      // The first violation in the order of the bytes decides, as in Node's parser.
      const CL = "Content-Length: 1\r\n";
      const TE = "Transfer-Encoding: chunked\r\n";
      const malformed = "no colon\r\n";
      const big = `T: ${value(16384)}\r\n`;
      const lines = (count: number) => trailerLines(trailerFields(count));
      // [title, trailers, limit, code, whether the code comes from the count]
      const verdicts: [string, string, number, string, boolean][] = [
        ["Content-Length, then a field over the limit", CL + lines(3), 3, "HPE_INVALID_CONTENT_LENGTH", false],
        ["Transfer-Encoding, then a field over the limit", TE + lines(3), 3, "HPE_INVALID_TRANSFER_ENCODING", false],
        ["a field over the limit, then Content-Length", lines(4) + CL, 3, "HPE_HEADER_OVERFLOW", true],
        ["Content-Length as the field over the limit", lines(3) + CL, 3, "HPE_HEADER_OVERFLOW", true],
        ["a field over the limit, then a malformed line", lines(4) + malformed, 3, "HPE_HEADER_OVERFLOW", true],
        ["a malformed line, then a field over the limit", malformed + lines(4), 3, "HPE_INVALID_HEADER_TOKEN", false],
        ["a NUL in the value of the field over the limit", lines(3) + "T3: a\0b\r\n", 3, "HPE_HEADER_OVERFLOW", true],
        ["Content-Length, then a malformed line", CL + malformed, 10, "HPE_INVALID_CONTENT_LENGTH", false],
        ["a NUL in the value of Content-Length", "Content-Length: \0\r\n", 10, "HPE_INVALID_CONTENT_LENGTH", false],
        ["Content-Length, then a value of 16 KiB", CL + big, 10, "HPE_INVALID_CONTENT_LENGTH", false],
        ["Transfer-Encoding, then a value of 16 KiB", TE + big, 10, "HPE_INVALID_TRANSFER_ENCODING", false],
        ["a value of 16 KiB, then Content-Length", big + CL, 10, "HPE_HEADER_OVERFLOW", false],
        ["a value of 16 KiB, then a malformed line", big + malformed, 10, "HPE_HEADER_OVERFLOW", false],
        ["Content-Length behind 200 fields", lines(200) + CL, 250, "HPE_INVALID_CONTENT_LENGTH", false],
        ["a malformed line behind 200 fields", lines(200) + malformed, 250, "HPE_INVALID_HEADER_TOKEN", false],
        ["Content-Length as field 251 under a limit of 250", lines(250) + CL, 250, "HPE_HEADER_OVERFLOW", true],
      ];
      for (const [title, trailers, limit, code, fromCount] of verdicts) {
        (fromCount ? rejectTest : test)(`${title}: ${code}`, async () => {
          assert.deepStrictEqual(await sendTrailers(trailers, limit), { code });
        });
      }
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
      assert.deepStrictEqual(
        seen.map(request => request.fields),
        [6, 6],
      );
    } finally {
      server.close();
    }
  });

  test("a WebSocket handshake with 300 fields is answered, Sec-WebSocket-Key as the last field", async () => {
    const server = http.createServer();
    server.maxHeadersCount = 300;
    const wss = new WebSocketServer({ server });
    const protocol = new Promise<string>(resolve => {
      wss.on("connection", ws => {
        ws.on("error", () => {});
        resolve(ws.protocol);
      });
    });
    try {
      const head = requestHead(300, {
        extra: ["Connection: Upgrade", "Upgrade: websocket", "Sec-WebSocket-Version: 13"],
        // The key and the accept value of RFC 6455, section 1.3.
        at: { 299: "Sec-WebSocket-Protocol: chat", 300: "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" },
      });
      const port = await listen(server);
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1", () => socket.write(head));
        let received = "";
        socket.setEncoding("latin1");
        socket.on("data", chunk => {
          received += chunk;
          // The answer has no body, and the connection is a WebSocket behind it.
          if (received.includes("\r\n\r\n")) socket.destroy();
        });
        socket.on("error", reject);
        socket.on("close", () => resolve(received));
      });
      const lines = response.slice(0, response.indexOf("\r\n\r\n")).split("\r\n");
      assert.strictEqual(lines[0], "HTTP/1.1 101 Switching Protocols");
      assert.ok(lines.includes("Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo="), response);
      assert.ok(lines.includes("Sec-WebSocket-Protocol: chat"), response);
      assert.strictEqual(await protocol, "chat");
    } finally {
      wss.close();
      server.close();
    }
  });

  // Why Bun's native server keeps 198 fields when the option is not set: its fetch() sends 250
  // request headers and drops the others in name order, with no error. A handler that forwards a
  // larger head loses fields, its own too. https://github.com/oven-sh/bun/pull/36433
  // When fetch() sends every header, this test passes in Bun and its mark fails it. Remove the
  // mark then, and make 1000 fields the default: `nativeMaxHeadersCount` in
  // src/js/node/_http_server.ts, and `unsetLimit` of the listen() transport above.
  test(
    "fetch() forwards the 300 fields of a request and the fields that the handler adds",
    { expectFailure: process.versions.bun ? "fetch() sends 250 request headers" : false },
    async () => {
      let received = "";
      const upstream = net.createServer(socket => {
        socket.setEncoding("latin1");
        socket.on("data", chunk => {
          received += chunk;
          if (received.includes("\r\n\r\n"))
            socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok");
        });
      });
      const upstreamPort = await listen(upstream);
      const server = http.createServer(async (req, res) => {
        const { host, connection, ...headers } = req.headers;
        const response = await fetch(`http://127.0.0.1:${upstreamPort}/`, {
          headers: { ...headers, "x-forwarded-for": "203.0.113.1", "x-authenticated-user": "alice" } as Record<
            string,
            string
          >,
        });
        res.end(await response.text());
      });
      server.maxHeadersCount = 300;
      try {
        const at: Record<number, string> = {};
        for (let i = 2; i < 300; i++) at[i] = `a-${String(i).padStart(4, "0")}: ${i}`;
        assert.strictEqual(statusLine(await exchange(await listen(server), requestHead(300, { at }))), ok);
        const names = new Set(
          received
            .slice(0, received.indexOf("\r\n\r\n"))
            .split("\r\n")
            .slice(1)
            .map(line => line.slice(0, line.indexOf(":")).toLowerCase()),
        );
        const sent = [
          ...Object.values(at).map(line => line.slice(0, line.indexOf(":"))),
          "x-forwarded-for",
          "x-authenticated-user",
        ];
        assert.deepStrictEqual(
          sent.filter(name => !names.has(name)),
          [],
        );
      } finally {
        server.close();
        upstream.close();
      }
    },
  );

  test("https.Server accepts a request at the limit", async () => {
    const seen: Seen[] = [];
    const server = https.createServer({ cert, key }, record(seen));
    server.maxHeadersCount = 3;
    try {
      assert.strictEqual(statusLine(await exchange(await listen(server), requestHead(3), true)), ok);
      assert.deepStrictEqual(seen, [{ url: "/", fields: 3, host: "localhost" }]);
    } finally {
      server.close();
    }
  });

  rejectTest("https.Server rejects a request over the limit", async () => {
    const seen: Seen[] = [];
    const server = https.createServer({ cert, key }, record(seen));
    server.maxHeadersCount = 3;
    try {
      assert.strictEqual(await exchange(await listen(server), requestHead(4), true), tooLarge);
      assert.deepStrictEqual(seen, []);
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

  // Bun.serve has no option for the field count, and this limit of its HTTP/1 parser is not
  // node:http's to change.
  describe("Bun.serve", () => {
    test("takes 198 fields and answers 431 to 199", async () => {
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: req => new Response(String([...req.headers].length)),
      });
      try {
        const atTheLimit = await exchange(server.port!, requestHead(198));
        assert.strictEqual(statusLine(atTheLimit), ok);
        assert.strictEqual(atTheLimit.slice(atTheLimit.indexOf("\r\n\r\n") + 4), "198");
        assert.strictEqual(
          statusLine(await exchange(server.port!, requestHead(199))),
          "HTTP/1.1 431 Request Header Fields Too Large",
        );
      } finally {
        await server.stop(true);
      }
    });
  });

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
