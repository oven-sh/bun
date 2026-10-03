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
 * The native server of Bun keeps its limit of 198 fields for it.
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
  // The limit of a server that does not set maxHeadersCount.
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

// Writes `payload` on an open connection and resolves with the next response: its head and the
// body that its Content-Length gives, or all that the server sent when it closes the connection.
function respondsTo(connection: Duplex, payload: string) {
  return new Promise<string>((resolve, reject) => {
    let received = "";
    const finish = () => {
      connection.off("data", onData).off("end", finish).off("close", finish).off("error", reject);
      resolve(received);
    };
    const onData = (chunk: Buffer | string) => {
      received += chunk.toString("latin1");
      const headEnd = received.indexOf("\r\n\r\n");
      const contentLength = /\r\ncontent-length: (\d+)\r\n/i.exec(received.slice(0, headEnd + 2));
      if (headEnd !== -1 && contentLength && received.length === headEnd + 4 + Number(contentLength[1])) finish();
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
        { limit: undefined, fields: unsetLimit },
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
