/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * A request with more header fields than server.maxHeadersCount used to reach
 * the handler with the extra fields cut off, after the parser had framed the
 * body with them: a hidden Content-Length still delimited a body. Node rejects
 * such a request since nodejs/node 821688aaa0 (CVE-2026-58044). The expected
 * values below were recorded from Node v26.5.1.
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
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
  // Sends `payload` on a new connection and resolves with every byte the server answered.
  roundtrip: (server: http.Server, payload: string) => Promise<string>;
  close: (server: http.Server) => void;
};
const transports: Transport[] = [
  {
    // Bun parses these connections in the native server.
    name: "listen()",
    roundtrip: async (server, payload) => exchange(await listen(server), payload),
    close: server => void server.close(),
  },
  {
    // Bun parses these with the llhttp binding, like the HTTP/1.1 connections of an
    // allowHTTP1 HTTP/2 server.
    name: 'emit("connection")',
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

for (const { name, roundtrip, close } of transports) {
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

    for (const value of [0, 0.5, -1, NaN, Infinity, null, "2"]) {
      test(`maxHeadersCount = ${show(value)} sets no limit`, async () => {
        const seen: Seen[] = [];
        const server = http.createServer(record(seen));
        server.maxHeadersCount = value as number;
        try {
          assert.strictEqual(statusLine(await roundtrip(server, requestHead(40))), ok);
          assert.deepStrictEqual(seen, [{ url: "/", fields: 40, host: "localhost" }]);
        } finally {
          close(server);
        }
      });
    }

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
  const { roundtrip } = transports[1];

  // Node's parsers start with maxHeaderPairs = 2000. The native server holds fewer fields.
  test("1000 fields pass when the option is not set", async () => {
    const seen: Seen[] = [];
    const server = http.createServer(record(seen));
    assert.strictEqual(statusLine(await roundtrip(server, requestHead(1000))), ok);
    assert.deepStrictEqual(seen, [{ url: "/", fields: 1000, host: "localhost" }]);
  });

  rejectTest("1001 fields fail when the option is not set", async () => {
    const seen: Seen[] = [];
    const server = http.createServer(record(seen));
    assert.strictEqual(await roundtrip(server, requestHead(1001)), tooLarge);
    assert.deepStrictEqual(seen, []);
  });

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

// Node sets up the parser of a connection in the server's own listener: of 'connection' for
// http.Server, of 'secureConnection' for https.Server. The parser keeps the maxHeadersCount,
// maxHeaderSize, insecureHTTPParser and httpValidation that the server has at that moment.
type ParserOption = {
  name: string;
  test: (name: string, fn: () => Promise<void>) => unknown;
  // The value that rejects `probe`, and the value that accepts it.
  tighten: (server: http.Server) => void;
  loosen: (server: http.Server) => void;
  probe: string;
  rejected: string;
};
const badRequest = "HTTP/1.1 400 Bad Request";
const headerOverflow = "HTTP/1.1 431 Request Header Fields Too Large";
// A request that every value accepts.
const plain = requestHead(2, { close: false });
// llhttp accepts this value byte only with lenient header parsing.
const lenientProbe = requestHead(3, { close: false, extra: ["X-Lenient: a\x08b"] });
const insecureHTTPParser: ParserOption = {
  name: "insecureHTTPParser",
  test,
  tighten: server => void ((server as any).insecureHTTPParser = false),
  loosen: server => void ((server as any).insecureHTTPParser = true),
  probe: lenientProbe,
  rejected: badRequest,
};
const httpValidation: ParserOption = {
  name: "httpValidation",
  test,
  tighten: server => void ((server as any).httpValidation = "strict"),
  loosen: server => void ((server as any).httpValidation = "relaxed"),
  probe: lenientProbe,
  rejected: badRequest,
};
// Over a limit of 1024 bytes, under the default of 16 KiB.
const largeProbe = requestHead(3, { close: false, extra: [`X-Large: ${Buffer.alloc(4000, "a").toString()}`] });
const parserOptions: ParserOption[] = [
  {
    name: "maxHeadersCount",
    test: rejectTest,
    tighten: server => void (server.maxHeadersCount = 3),
    loosen: server => void (server.maxHeadersCount = null),
    probe: requestHead(6, { close: false }),
    rejected: headerOverflow,
  },
  {
    name: "maxHeaderSize",
    test,
    tighten: server => void ((server as any).maxHeaderSize = 1024),
    loosen: server => void ((server as any).maxHeaderSize = undefined),
    probe: largeProbe,
    rejected: headerOverflow,
  },
  insecureHTTPParser,
  httpValidation,
];

// A connection that stays open between requests. request() resolves with the status line of
// the next response, and with "" when the server closed the connection without one.
function keepAlive(socket: net.Socket | ReturnType<typeof duplexPair>[0], connectEvent?: string) {
  let received = "";
  let closed = false;
  let wake = () => {};
  const ready = connectEvent ? once(socket, connectEvent) : Promise.resolve();
  socket.setEncoding("latin1");
  socket.on("data", chunk => {
    received += chunk;
    wake();
  });
  socket.on("error", () => {});
  for (const event of ["end", "close"]) {
    socket.on(event, () => {
      closed = true;
      wake();
    });
  }
  return {
    async request(payload: string) {
      await ready;
      const start = received.length;
      socket.write(payload);
      for (;;) {
        const response = received.slice(start);
        // Every 200 of these servers has the body "ok". Their error responses have no body.
        const complete = response.startsWith(ok) ? response.endsWith("\r\n\r\nok") : response.includes("\r\n\r\n");
        if (complete || closed) return statusLine(response);
        await new Promise<void>(resolve => (wake = resolve));
      }
    },
    close: () => void socket.destroy(),
  };
}
type Client = ReturnType<typeof keepAlive>;

type Setup = {
  name: string;
  // The event of the server's own listener in Node.
  ownEvent: "connection" | "secureConnection";
  // A listener that a program prepends to `ownEvent` runs before the parser is set up.
  prependedRunsFirst: boolean;
  createServer: (listener?: http.RequestListener) => http.Server;
  connect: (server: http.Server) => Promise<Client>;
  close: (server: http.Server) => void;
};
const answer: http.RequestListener = (req, res) => void res.end("ok");
const connectTo = (secure: boolean) => async (server: http.Server) => {
  const port = await listen(server);
  return secure
    ? keepAlive(
        tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] }),
        "secureConnect",
      )
    : keepAlive(net.connect(port, "127.0.0.1"), "connect");
};
const http1: Setup = {
  name: "http.Server, listen()",
  ownEvent: "connection",
  prependedRunsFirst: true,
  createServer: (listener = answer) => http.createServer(listener),
  connect: connectTo(false),
  close: server => void server.close(),
};
const https1: Setup = {
  name: "https.Server, listen()",
  ownEvent: "secureConnection",
  // Bun's https.Server has no listener of its own on 'secureConnection': it reads the options between
  // 'connection' and 'secureConnection', so before every listener of 'secureConnection'.
  prependedRunsFirst: !process.versions.bun,
  createServer: (listener = answer) => https.createServer({ cert, key }, listener),
  connect: connectTo(true),
  close: server => void server.close(),
};
const emitted: Setup = {
  name: 'http.Server, emit("connection")',
  ownEvent: "connection",
  prependedRunsFirst: true,
  createServer: (listener = answer) => http.createServer(listener),
  connect: async server => {
    const [client, serverSide] = duplexPair();
    server.emit("connection", serverSide);
    return keepAlive(client);
  },
  close: () => {},
};

// Runs `body` with a server and closes the server and every connection behind it.
async function withServer(
  setup: Setup,
  body: (server: http.Server, connect: () => Promise<Client>) => Promise<void>,
  listener?: http.RequestListener,
) {
  const server = setup.createServer(listener);
  const clients: Client[] = [];
  try {
    await body(server, async () => {
      const client = await setup.connect(server);
      clients.push(client);
      return client;
    });
  } finally {
    for (const client of clients) client.close();
    setup.close(server);
  }
}

// Runs `script` with this runtime and resolves with what it printed.
async function run(args: string[], script: string) {
  const child = spawn(process.execPath, [...args, "-e", script], { stdio: ["ignore", "pipe", "inherit"] });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
  const [exitCode] = await once(child, "close");
  return { stdout, exitCode };
}

describe("a connection keeps the parser options that its server had when it opened", () => {
  for (const setup of [http1, https1, emitted]) {
    const { ownEvent } = setup;
    describe(setup.name, () => {
      for (const option of parserOptions) {
        option.test(`${option.name}: a tighter value applies to the next connection, not to an open one`, async () => {
          await withServer(setup, async (server, connect) => {
            option.loosen(server);
            const open = await connect();
            assert.strictEqual(await open.request(option.probe), ok);
            option.tighten(server);
            assert.strictEqual(await open.request(option.probe), ok);
            assert.strictEqual(await (await connect()).request(option.probe), option.rejected);
            // Also behind the connection that took the new value.
            assert.strictEqual(await open.request(option.probe), ok);
          });
        });

        option.test(`${option.name}: a looser value applies to the next connection, not to an open one`, async () => {
          await withServer(setup, async (server, connect) => {
            option.tighten(server);
            const open = await connect();
            assert.strictEqual(await open.request(plain), ok);
            option.loosen(server);
            assert.strictEqual(await (await connect()).request(option.probe), ok);
            assert.strictEqual(await open.request(option.probe), option.rejected);
          });
        });

        // The server's own listener is the first one of its event: a listener that a program adds
        // with on() runs behind it, and one that it adds with prependListener() runs before it.
        option.test(
          `${option.name}: a '${ownEvent}' listener added with on() sets it for later connections only`,
          async () => {
            await withServer(setup, async (server, connect) => {
              option.loosen(server);
              server.on(ownEvent, () => option.tighten(server));
              assert.strictEqual(await (await connect()).request(option.probe), ok);
              assert.strictEqual(await (await connect()).request(option.probe), option.rejected);
            });
          },
        );

        option.test(
          `${option.name}: a '${ownEvent}' listener added with prependListener() sets it for ${
            setup.prependedRunsFirst ? "its connection" : "later connections only"
          }`,
          async () => {
            await withServer(setup, async (server, connect) => {
              option.loosen(server);
              server.prependListener(ownEvent, () => option.tighten(server));
              const first = setup.prependedRunsFirst ? option.rejected : ok;
              assert.strictEqual(await (await connect()).request(option.probe), first);
              assert.strictEqual(await (await connect()).request(option.probe), option.rejected);
            });
          },
        );
      }

      // The parser of a connection reads the trailer section of a chunked request with the same options, and
      // req.rawTrailers has what it accepted.
      for (const option of [insecureHTTPParser, httpValidation]) {
        const chunked =
          "POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\nX-T: a\x08b\r\n\r\n";
        const trailer = ["X-T", "a\x08b"];
        // Answers when the request has ended, and records its trailers.
        const record = (rawTrailers: string[][]): http.RequestListener => {
          return (req, res) => {
            req.resume().on("end", () => {
              rawTrailers.push(req.rawTrailers);
              res.end("ok");
            });
          };
        };

        test(`${option.name}: a tighter value does not reach the trailers of an open connection`, async () => {
          const rawTrailers: string[][] = [];
          await withServer(
            setup,
            async (server, connect) => {
              option.loosen(server);
              const open = await connect();
              assert.strictEqual(await open.request(chunked), ok);
              option.tighten(server);
              assert.strictEqual(await open.request(chunked), ok);
              assert.strictEqual(await (await connect()).request(chunked), badRequest);
              assert.deepStrictEqual(rawTrailers, [trailer, trailer]);
            },
            record(rawTrailers),
          );
        });

        test(`${option.name}: a looser value reaches the trailers of the next connection`, async () => {
          const rawTrailers: string[][] = [];
          await withServer(
            setup,
            async (server, connect) => {
              option.tighten(server);
              const open = await connect();
              assert.strictEqual(await open.request(plain), ok);
              option.loosen(server);
              assert.strictEqual(await (await connect()).request(chunked), ok);
              assert.strictEqual(await open.request(chunked), badRequest);
              assert.deepStrictEqual(rawTrailers, [[], trailer]);
            },
            record(rawTrailers),
          );
        });
      }
    });
  }

  // Node's own listener reads the options when it runs, also when a program calls it late.
  describe(`${emitted.name}: a late call of the server's own listener`, () => {
    for (const option of parserOptions) {
      option.test(`${option.name}: the connection takes the value of that moment`, async () => {
        await withServer(emitted, async (server, connect) => {
          const own = server.listeners("connection");
          server.removeAllListeners("connection");
          option.loosen(server);
          const announced = once(server, "connection");
          const response = (await connect()).request(option.probe);
          const [socket] = await announced;
          option.tighten(server);
          for (const listener of own) listener.call(server, socket);
          assert.strictEqual(await response, option.rejected);
        });
      });
    }
  });

  // An https.Server sets up the parser behind the handshake, so behind every listener of 'connection'.
  describe("https.Server, listen(): listeners of 'connection'", () => {
    for (const option of parserOptions) {
      option.test(`${option.name}: a listener added with on() sets it for its connection`, async () => {
        await withServer(https1, async (server, connect) => {
          option.loosen(server);
          server.on("connection", () => option.tighten(server));
          assert.strictEqual(await (await connect()).request(option.probe), option.rejected);
        });
      });
    }

    // httpolyglot serves http and https on one port this way: it takes the last 'connection' listener
    // of an https.Server away and calls it itself, after a look at the first byte of the connection.
    test("a program that removes the server's 'connection' listener and calls it itself gets an answer", async () => {
      await withServer(https1, async (server, connect) => {
        const listeners = server.listeners("connection");
        const tlsHandler = listeners[listeners.length - 1];
        server.removeListener("connection", tlsHandler as (...args: unknown[]) => void);
        server.on("connection", function onConnection(this: http.Server, socket: net.Socket) {
          const data = socket.read(1);
          if (data === null) return void socket.once("readable", () => onConnection.call(this, socket));
          socket.unshift(data);
          if (data[0] < 32 || data[0] >= 127) tlsHandler.call(this, socket);
          else (http as any)._connectionListener.call(this, socket);
        });
        assert.strictEqual(await (await connect()).request(plain), ok);
      });
    });

    // PROXY protocol wrappers (findhit-proxywrap, @kldzj/proxy-protocol) put their own listener around each
    // listener of 'secureConnection'. It makes the address getters of the socket read socket._parent.
    test("a program that wraps the listeners of 'secureConnection' still reads the address of the peer", async () => {
      const server = https.createServer({ cert, key }, (req, res) => void res.end(String(req.socket.remoteAddress)));
      for (const listener of server.listeners("secureConnection")) {
        server.removeListener("secureConnection", listener as (...args: unknown[]) => void);
        server.on("secureConnection", function (this: https.Server, socket: tls.TLSSocket) {
          const parent = (socket as any)._parent;
          Object.defineProperty(socket, "remoteAddress", { configurable: true, get: () => parent.remoteAddress });
          listener.call(this, socket);
        });
      }
      try {
        const response = await exchange(await listen(server), requestHead(2), true);
        assert.deepStrictEqual(
          [statusLine(response), response.slice(response.indexOf("\r\n\r\n") + 4)],
          [ok, "127.0.0.1"],
        );
      } finally {
        server.close();
      }
    });
  });

  // Before, an assignment to httpAllowHalfOpen sent the lenient flags of that moment to every connection.
  test("an assignment to httpAllowHalfOpen does not change the parser of an open connection", async () => {
    await withServer(http1, async (server, connect) => {
      const open = await connect();
      assert.strictEqual(await open.request(plain), ok);
      insecureHTTPParser.loosen(server);
      (server as any).httpAllowHalfOpen = true;
      assert.strictEqual(await open.request(lenientProbe), badRequest);
    });
  });

  test("the options are own data properties of the server", () => {
    for (const server of [http.createServer(), https.createServer({ cert, key })]) {
      const descriptors = Object.getOwnPropertyDescriptors(server) as Record<string, PropertyDescriptor>;
      const data = (value: unknown) => ({ value, writable: true, enumerable: true, configurable: true });
      assert.deepStrictEqual(
        {
          maxHeadersCount: descriptors.maxHeadersCount,
          maxHeaderSize: descriptors.maxHeaderSize,
          insecureHTTPParser: descriptors.insecureHTTPParser,
          httpValidation: descriptors.httpValidation,
        },
        {
          maxHeadersCount: data(null),
          maxHeaderSize: data(undefined),
          insecureHTTPParser: data(undefined),
          httpValidation: data(undefined),
        },
      );
    }
  });

  test("the server's own listener is the only one of its event", () => {
    const count = (server: http.Server) => [
      server.listenerCount("connection"),
      server.listenerCount("secureConnection"),
    ];
    assert.deepStrictEqual(count(http.createServer()), [1, 0]);
    // Bun's https.Server has none on 'secureConnection'.
    assert.deepStrictEqual(count(https.createServer({ cert, key })), [1, process.versions.bun ? 0 : 1]);
  });

  // With --insecure-http-parser a server that sets no option is lenient, for each connection that opens under the flag.
  test("--insecure-http-parser is the default of each connection", async () => {
    const { stdout, exitCode } = await run(
      ["--insecure-http-parser"],
      `
      const http = require("node:http");
      const net = require("node:net");
      const warnings = [];
      process.on("warning", warning => warnings.push(warning.message));
      const tick = () => new Promise(resolve => setImmediate(resolve));
      const lenient = "GET / HTTP/1.1\\r\\nHost: x\\r\\nX-Lenient: a\\bb\\r\\nConnection: close\\r\\n\\r\\n";
      const chunked = "POST / HTTP/1.1\\r\\nHost: x\\r\\nTransfer-Encoding: chunked\\r\\nConnection: close\\r\\n\\r\\n0\\r\\nX-T: a\\bb\\r\\n\\r\\n";
      let rawTrailers;
      const server = http.createServer((req, res) => {
        req.resume().on("end", () => {
          rawTrailers = req.rawTrailers;
          res.end("ok");
        });
      });
      // The status line of the answer to a request on a new connection.
      const send = payload =>
        new Promise(resolve => {
          const socket = net.connect(server.address().port, "127.0.0.1", () => socket.write(payload));
          let received = "";
          socket.setEncoding("latin1").on("data", chunk => (received += chunk));
          socket.on("close", () => resolve(received.slice(0, received.indexOf("\\r\\n"))));
        });
      server.listen(0, "127.0.0.1", async () => {
        const seen = {};
        await tick();
        seen.warningsBeforeTheFirstConnection = warnings.length;
        seen.lenientValue = await send(lenient);
        await tick();
        seen.warnings = warnings;
        seen.trailer = [await send(chunked), rawTrailers];
        server.insecureHTTPParser = false;
        seen.afterInsecureHTTPParserFalse = await send(lenient);
        server.insecureHTTPParser = undefined;
        server.httpValidation = "strict";
        seen.afterHttpValidationStrict = await send(lenient);
        console.log(JSON.stringify(seen));
        process.exit(0);
      });
      `,
    );
    assert.deepStrictEqual(
      { exitCode, seen: exitCode === 0 ? JSON.parse(stdout) : stdout },
      {
        exitCode: 0,
        seen: {
          warningsBeforeTheFirstConnection: 0,
          lenientValue: ok,
          warnings: ["Using insecure HTTP parsing"],
          trailer: [ok, ["X-T", "a\bb"]],
          afterInsecureHTTPParserFalse: badRequest,
          afterHttpValidationStrict: badRequest,
        },
      },
    );
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
  const { bunEnv, bunExe, nodeExe, tempDir } = await import("harness");
  const node = nodeExe();

  // Node sets up no parser for a connection that its own listener does not see, and that connection gets no
  // answer. Here the native parser reads it, as before: with the options that its server has behind the event.
  describe("a connection that the server's own listener does not see", () => {
    for (const setup of [http1, https1]) {
      for (const option of parserOptions) {
        test(`${setup.name}, ${option.name}: the own listener is removed`, async () => {
          await withServer(setup, async (server, connect) => {
            server.removeAllListeners("connection");
            option.loosen(server);
            const open = await connect();
            assert.strictEqual(await open.request(option.probe), ok);
            option.tighten(server);
            assert.strictEqual(await (await connect()).request(option.probe), option.rejected);
            assert.strictEqual(await open.request(option.probe), ok);
          });
        });
      }

      // In Node the other server sets up its parser on the socket too, and the request to an http.Server gets 431.
      test(`${setup.name}: the own listener of another server does not set the options`, async () => {
        await withServer(setup, async (server, connect) => {
          const other = http.createServer(answer);
          other.maxHeadersCount = 3;
          server.prependListener("connection", socket => void other.emit("connection", socket));
          assert.strictEqual(await (await connect()).request(requestHead(6, { close: false })), ok);
        });
      });
    }

    test("something throws before the options of the connection are set", async () => {
      const { stdout, exitCode } = await run(
        [],
        `
        const http = require("node:http");
        const https = require("node:https");
        const net = require("node:net");
        const tls = require("node:tls");
        const { readFileSync } = require("node:fs");
        const fixtures = ${JSON.stringify(fixtures)};
        const secureOptions = { cert: readFileSync(fixtures + "/cert.pem"), key: readFileSync(fixtures + "/cert.key") };
        const uncaught = [];
        process.on("uncaughtException", error => uncaught.push(error.message.startsWith("from ") ? error.message : "other"));
        const throws = message => () => {
          throw new Error(message);
        };
        const sixFields = "GET / HTTP/1.1\\r\\nHost: x\\r\\nA: 1\\r\\nB: 2\\r\\nC: 3\\r\\nConnection: close\\r\\n\\r\\n";
        // The status line of the answer to six fields on a new connection of a server that allows three.
        // It is "" when the server closes the connection without an answer.
        const answer = (configure, secure = false) =>
          new Promise(resolve => {
            const listener = (req, res) => res.end("ok");
            const server = secure ? https.createServer(secureOptions, listener) : http.createServer(listener);
            server.maxHeadersCount = 3;
            // What it returns runs when the server listens.
            const configureListening = configure(server);
            server.listen(0, "127.0.0.1", () => {
              if (typeof configureListening === "function") configureListening();
              const port = server.address().port;
              const socket = secure
                ? tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false })
                : net.connect(port, "127.0.0.1");
              socket.once(secure ? "secureConnect" : "connect", () => socket.write(sixFields));
              let received = "";
              socket.setEncoding("latin1").on("data", chunk => (received += chunk));
              socket.on("error", () => {});
              socket.on("close", () => {
                server.close();
                resolve(received.slice(0, received.indexOf("\\r\\n")));
              });
            });
          });
        (async () => {
          const seen = {};
          try {
            seen.listenerThrows = await answer(server => server.prependListener("connection", throws("from a listener")));
            // The constructor of the socket throws for this timeout.
            seen.noSocket = await answer(server => (server.timeout = -1));
            seen.gateThrows = await answer(server =>
              Object.defineProperty(server, "maxConnections", { get: throws("from maxConnections") }),
            );
            // Nothing can read the options of this server, so its connection is closed.
            seen.optionThrows = await answer(server => () => {
              Object.defineProperty(server, "maxHeadersCount", { get: throws("from maxHeadersCount") });
            });
            // Node still emits 'secureConnection' behind a 'connection' listener that throws.
            seen.secureConnections = 0;
            seen.secureListenerThrows = await answer(server => {
              server.on("connection", throws("from a listener of https"));
              server.on("secureConnection", () => seen.secureConnections++);
            }, true);
          } catch (error) {
            seen.failed = String(error);
          }
          seen.uncaught = uncaught;
          console.log(JSON.stringify(seen));
          process.exit(0);
        })();
        `,
      );
      assert.deepStrictEqual(
        { exitCode, seen: exitCode === 0 ? JSON.parse(stdout) : stdout },
        {
          exitCode: 0,
          seen: {
            listenerThrows: headerOverflow,
            noSocket: headerOverflow,
            gateThrows: headerOverflow,
            optionThrows: "",
            secureConnections: 0,
            secureListenerThrows: headerOverflow,
            uncaught: [
              "from a listener",
              "other",
              "from maxConnections",
              "from maxHeadersCount",
              "from a listener of https",
            ],
          },
        },
      );
    });
  });

  // Node aborts for a maxHeaderSize that is not a number.
  test("a maxHeaderSize that is a string is the number that it spells", async () => {
    await withServer(http1, async (server, connect) => {
      (server as any).maxHeaderSize = "1024";
      assert.strictEqual(await (await connect()).request(largeProbe), headerOverflow);
      (server as any).maxHeaderSize = "8192";
      assert.strictEqual(await (await connect()).request(largeProbe), ok);
    });
  });

  // Node has no setter for http.maxHeaderSize.
  test("a server without maxHeaderSize takes the limit of the process when a connection opens", async () => {
    const processLimit = http.maxHeaderSize;
    try {
      await withServer(http1, async (server, connect) => {
        const open = await connect();
        assert.strictEqual(await open.request(largeProbe), ok);
        (http as any).maxHeaderSize = 1024;
        assert.strictEqual(await (await connect()).request(largeProbe), headerOverflow);
        assert.strictEqual(await open.request(largeProbe), ok);
        (http as any).maxHeaderSize = processLimit;
        assert.strictEqual(await (await connect()).request(largeProbe), ok);
      });
    } finally {
      (http as any).maxHeaderSize = processLimit;
    }
  });

  describe("bun --hot", () => {
    // Reads the lines that a process prints.
    function lines(stdout: ReadableStream<Uint8Array>) {
      const reader = stdout.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      return async () => {
        while (!buffered.includes("\n")) {
          const { value, done } = await reader.read();
          if (done) throw new Error(`the process ended after ${JSON.stringify(buffered)}`);
          buffered += decoder.decode(value, { stream: true });
        }
        const line = buffered.slice(0, buffered.indexOf("\n"));
        buffered = buffered.slice(line.length + 1);
        return line;
      };
    }

    // A reload keeps the native listener and its connections. The next module is a new http.Server.
    test("a connection keeps the parser options of the module that it opened under", async () => {
      using dir = tempDir("hot-node-http-parser-options", {
        "server.mjs": `
          import { createServer } from "node:http";
          import { once } from "node:events";
          import { writeFileSync, readFileSync } from "node:fs";

          globalThis.__reloads ??= 0;
          const generation = globalThis.__reloads++;
          const server = createServer((req, res) => {
            if (req.url === "/reload") {
              const self = new URL(import.meta.url);
              writeFileSync(self, readFileSync(self, "utf8"));
            }
            res.end("ok");
          });
          if (generation > 0) server.maxHeadersCount = 3;
          await once(server.listen(0, "127.0.0.1"), "listening");
          console.log(generation + " " + server.address().port);
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--hot", "server.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "inherit",
      });
      const line = lines(proc.stdout);
      const port = Number((await line()).split(" ")[1]);
      const connect = () => keepAlive(net.connect(port, "127.0.0.1"), "connect");
      const sixFields = requestHead(6, { close: false });
      const open = connect();
      try {
        assert.strictEqual(await open.request(sixFields), ok);
        assert.strictEqual(await connect().request("GET /reload HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"), ok);
        assert.strictEqual(await line(), `1 ${port}`);
        assert.strictEqual(await open.request(sixFields), ok);
        assert.strictEqual(await connect().request(sixFields), headerOverflow);
      } finally {
        open.close();
      }
    });

    // A reload keeps the native listener of an address, and so its kind. The sockets of a Bun.serve listener have
    // the smaller block: a node:http server gets none of them, so it writes no option to them.
    test("a server with an option that takes the listener of a Bun.serve server gets none of its connections", async () => {
      using dir = tempDir("hot-bun-serve-to-node-http-options", {
        "cert.pem": cert,
        "cert.key": key,
        "server.mjs": `
          import { createServer } from "node:http";
          import { createServer as createSecureServer } from "node:https";
          import { once } from "node:events";
          import { connect } from "node:net";
          import { connect as connectSecure } from "node:tls";
          import { writeFileSync, readFileSync } from "node:fs";

          const tls = {
            cert: readFileSync(new URL("cert.pem", import.meta.url), "utf8"),
            key: readFileSync(new URL("cert.key", import.meta.url), "utf8"),
          };

          globalThis.__reloads ??= 0;
          if (globalThis.__reloads++ === 0) {
            // A reload finds a listener again by hostname and port, so the two kinds need two hostnames.
            Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("Bun.serve") });
            Bun.serve({ port: 0, hostname: "0.0.0.0", tls, fetch: () => new Response("Bun.serve") });
            const self = new URL(import.meta.url);
            writeFileSync(self, readFileSync(self, "utf8"));
          } else {
            for (const secure of [false, true]) {
              let connections = 0;
              const handler = (req, res) => res.end("node:http");
              const server = secure ? createSecureServer(tls, handler) : createServer(handler);
              server.maxHeadersCount = 3;
              server.on("connection", () => connections++);
              await once(server.listen(0, secure ? "0.0.0.0" : "127.0.0.1"), "listening");

              const port = server.address().port;
              const socket = secure
                ? connectSecure({ port, host: "127.0.0.1", rejectUnauthorized: false })
                : connect(port, "127.0.0.1");
              let received = "";
              socket.setEncoding("latin1");
              socket.on("data", chunk => (received += chunk));
              socket.on("error", () => {});
              await once(socket, secure ? "secureConnect" : "connect");
              socket.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nA: 1\\r\\nB: 2\\r\\nC: 3\\r\\nConnection: close\\r\\n\\r\\n");
              await once(socket, "close");
              const body = received.slice(received.indexOf("\\r\\n\\r\\n") + 4);
              console.log((secure ? "https" : "http") + ": " + connections + " " + body);
            }
            process.exit(0);
          }
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--hot", "server.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual(
        { stdout, stderr: stderr.replaceAll(/^DEBUG:.*\n/gm, ""), exitCode },
        { stdout: "http: 0 Bun.serve\nhttps: 0 Bun.serve\n", stderr: "", exitCode: 0 },
      );
    });
  });

  describe("Node.js compatibility", () => {
    // The first start of Node after a build reads its binary from the disk: up to 14 s on a slow machine.
    (node ? test : test.skip)("all tests pass in Node.js", { timeout: 60_000 }, async () => {
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
