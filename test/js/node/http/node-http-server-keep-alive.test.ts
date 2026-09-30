/**
 * The tests in this file run in Bun and in Node.js: `bun test` runs them here,
 * and the last test runs this same file under Node.js.
 * - A test with `expectFailure` asserts what Node.js sends in a case where Bun
 *   does not do the same yet. TRACKER lists those cases.
 * - A `bunOnly` test states a rule that only Bun has. Node.js skips it.
 *
 * llhttp keeps an HTTP/1.0 connection open for a request that has a keep-alive
 * item in Connection, and Node gives that verdict to the response:
 * https://github.com/nodejs/llhttp/blob/v9.4.2/src/native/http.c#L156-L170
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js#L1293
 * _storeHeader then decides if the connection stays open behind the response:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L500-L549
 */
import { HTTPParser } from "node:_http_common";
import assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { connect, createServer as createNetServer } from "node:net";
import { describe, test } from "node:test";
import { connect as connectTLS } from "node:tls";
import { fileURLToPath } from "node:url";

const TRACKER = "https://github.com/oven-sh/bun/issues/44314";

// Node.js cannot import the harness.
const harness = typeof Bun !== "undefined" ? await import("harness") : undefined;
const inBun = harness !== undefined;
const bunOnly = inBun ? test : test.skip;
/** For a test that asserts what Node.js does where Bun does something else: `what` says what Bun does. */
const notYetInBun = (what: string) => ({ expectFailure: inBun && `${what} (${TRACKER})` });

type Listener = (req: http.IncomingMessage, res: http.ServerResponse) => void;
type Transport = "tcp" | "tls" | "connection event";
type Options = {
  transport?: Transport;
  /** All requests go out in one write. */
  pipelined?: boolean;
  server?: http.ServerOptions;
  prepare?: (server: http.Server) => void;
  /** Do not wait for the server to end the connection. */
  leave?: boolean;
};

const fixture = (name: string) => readFileSync(new URL(`../test/fixtures/keys/${name}`, import.meta.url));

/** The length of the chunked body at the start of `bytes`: -1 while it is not complete, Infinity if the bytes are not chunks. */
function chunkedLength(bytes: string) {
  for (let at = 0; ; ) {
    const endOfLine = bytes.indexOf("\r\n", at);
    const size = bytes.slice(at, endOfLine < 0 ? undefined : endOfLine);
    if (!/^[0-9a-f]*$/i.test(size) || (endOfLine >= 0 && size === "")) return Infinity;
    if (endOfLine < 0) return -1;
    if (parseInt(size, 16) === 0) {
      // The trailer section ends with an empty line.
      const end = bytes.indexOf("\r\n\r\n", endOfLine);
      return end < 0 ? -1 : end + 4;
    }
    at = endOfLine + 2 + parseInt(size, 16) + 2;
    if (at > bytes.length) return -1;
    if (bytes.slice(at - 2, at) !== "\r\n") return Infinity;
  }
}

/** A raw client. It reads one response at a time, by the framing that the head of the response states. */
class Peer {
  #socket: Socket;
  #bytes = "";
  #failure: Error | undefined;
  #wake = () => {};
  ended = false;

  constructor(socket: Socket) {
    this.#socket = socket;
    socket.setEncoding("latin1");
    socket.on("data", (chunk: string) => {
      this.#bytes += chunk;
      this.#wake();
    });
    socket.on("end", () => {
      this.ended = true;
      this.#wake();
    });
    socket.on("error", err => {
      this.#failure = err;
      this.#wake();
    });
  }

  send(bytes: string) {
    this.#socket.write(bytes, "latin1");
  }

  destroy() {
    this.#socket.destroy();
  }

  /** Waits for `length(bytes)` bytes. False when the server ends the connection first. */
  async #have(length: (bytes: string) => number) {
    for (;;) {
      const wanted = length(this.#bytes);
      if (wanted >= 0 && this.#bytes.length >= wanted) return true;
      if (this.#failure) throw this.#failure;
      if (this.ended) return false;
      await new Promise<void>(resolve => (this.#wake = resolve));
    }
  }

  #take(length = this.#bytes.length) {
    const taken = this.#bytes.slice(0, length);
    this.#bytes = this.#bytes.slice(length);
    return taken;
  }

  /**
   * The next response. "" when the server ended the connection and sent nothing more.
   * A body with no Content-Length and no chunks is all bytes until the server ends the connection.
   */
  async response(method: string) {
    const endOfHead = (bytes: string) => bytes.indexOf("\r\n\r\n") + 4 || -1;
    if (!(await this.#have(endOfHead))) return this.#take();
    const head = this.#take(endOfHead(this.#bytes));
    const status = head.slice(9, 12);
    const length = /\r\nContent-Length: (\d+)\r\n/i.exec(head)?.[1];
    let body = "";
    if (method !== "HEAD" && status !== "204" && status !== "304") {
      const bodyLength = /\r\nTransfer-Encoding: chunked\r\n/i.test(head)
        ? chunkedLength
        : () => (length === undefined ? Infinity : Number(length));
      body = (await this.#have(bodyLength)) ? this.#take(bodyLength(this.#bytes)) : this.#take();
    }
    return head.replace(/\r\nDate: [^\r]*/, "\r\nDate: <date>") + body;
  }

  /** All bytes until the server ends the connection, then "end". */
  async over() {
    await this.#have(() => Infinity);
    return this.#take() + "end";
  }
}

async function connectPeer(port: number, secure = false) {
  const socket = secure
    ? connectTLS({ port, host: "127.0.0.1", rejectUnauthorized: false })
    : connect(port, "127.0.0.1");
  const peer = new Peer(socket);
  await once(socket, secure ? "secureConnect" : "connect");
  return peer;
}

/**
 * Sends the writes one by one, each when the response to the one before it is complete, or all in one write.
 * Returns the responses, then "end" when the server ended the connection and sent nothing more.
 */
async function converse(peer: Peer, writes: string[], { pipelined, leave }: Options = {}) {
  const methods = writes.flatMap(write =>
    [...write.matchAll(/(?:^|\r\n)([A-Z]+) \S+ HTTP\/1\.[01]\r\n/g)].map(match => match[1]),
  );
  assert.notStrictEqual(methods.length, 0, "no request line in the writes");
  const out: string[] = [];
  if (pipelined) peer.send(writes.join(""));
  for (const [i, method] of methods.entries()) {
    if (!pipelined) {
      if (peer.ended) break;
      peer.send(writes[i]);
    }
    const response = await peer.response(method);
    if (response === "") break;
    out.push(response);
  }
  if (!leave) out.push(await peer.over());
  return out;
}

async function listen(listener: Listener, options: Options = {}) {
  const { transport = "tcp" } = options;
  const secure = transport === "tls";
  const server: http.Server = secure
    ? https.createServer({ ...options.server, key: fixture("agent1-key.pem"), cert: fixture("agent1-cert.pem") })
    : http.createServer({ ...options.server });
  server.on("request", listener);
  options.prepare?.(server);
  // The transport "connection event" gives the server a socket that another server accepted.
  const acceptor =
    transport === "connection event" ? createNetServer(socket => server.emit("connection", socket)) : server;
  acceptor.listen(0, "127.0.0.1");
  await once(acceptor, "listening");
  return {
    connect: () => connectPeer((acceptor.address() as AddressInfo).port, secure),
    close() {
      server.closeAllConnections();
      server.close();
      if (acceptor !== server) acceptor.close();
    },
  };
}

/** Sends the writes on one connection to a new server. */
async function exchange(listener: Listener, writes: string[], options: Options = {}) {
  const server = await listen(listener, options);
  let peer: Peer | undefined;
  try {
    peer = await server.connect();
    return await converse(peer, writes, options);
  } finally {
    peer?.destroy();
    server.close();
  }
}

const asksToPersist = (path: string, fields = "Connection: keep-alive\r\n", version = "1.0", method = "GET") =>
  `${method} ${path} HTTP/${version}\r\nHost: x\r\n${fields}\r\n`;
/** An HTTP/1.0 request that does not ask for a persistent connection: the server closes it after the response. */
const last = "GET /last HTTP/1.0\r\nHost: x\r\n\r\n";
/** A request for the same write as one whose response must close the connection. No answer to it must arrive. */
const probe = asksToPersist("/probe");

const persists = "Connection: keep-alive\r\nKeep-Alive: timeout=5\r\n";
const closes = "Connection: close\r\n";
const ok = (body: string, connection: string, length = body.length) =>
  `HTTP/1.1 200 OK\r\nContent-Length: ${length}\r\nDate: <date>\r\n${connection}\r\n${body}`;

/** Answers with the URL, and with its length in Content-Length. */
const withLength: Listener = (req, res) => {
  res.writeHead(200, { "Content-Length": req.url!.length });
  res.end(req.url);
};
/** Answers with the URL, and without a Content-Length. */
const withoutLength: Listener = (req, res) => {
  res.end(req.url);
};
/** The requests `last` and `probe` get the answer of withLength. */
const butLast =
  (listener: Listener): Listener =>
  (req, res) =>
    (req.url === "/last" || req.url === "/probe" ? withLength : listener)(req, res);
const later =
  (listener: Listener): Listener =>
  (req, res) =>
    void setImmediate(listener, req, res);
const timings = [
  ["at once", (listener: Listener) => listener],
  ["later", later],
] as const;

/** The server answers `last` on the connection of `request`: the connection stayed open behind the response. */
const staysOpen = (listener: Listener, request: string, options?: Options) =>
  exchange(butLast(listener), [request, last], options);
const andLast = (response: string) => [response, ok("/last", closes), "end"];
/** `probe` is in the same write as `request`. The server does not answer it if the connection closes behind the response. */
const closesBehind = (listener: Listener, request: string, options?: Options) =>
  exchange(butLast(listener), [request, probe], { ...options, pipelined: true });

describe("an HTTP/1.0 request with Connection: keep-alive", () => {
  describe("keeps the connection open behind a response with a Content-Length", () => {
    const requests: [name: string, request: string][] = [
      ["Connection: keep-alive", asksToPersist("/1")],
      ["Connection: Keep-Alive, TE", asksToPersist("/1", "Connection: Keep-Alive, TE\r\n")],
      ["Connection: keep-alive, close", asksToPersist("/1", "Connection: keep-alive, close\r\n")],
      ["two Connection fields", asksToPersist("/1", "Connection: close\r\nConnection: keep-alive\r\n")],
      ["Proxy-Connection: keep-alive", asksToPersist("/1", "Proxy-Connection: keep-alive\r\n")],
      ["a TE: chunked field", asksToPersist("/1", "Connection: keep-alive\r\nTE: chunked\r\n")],
      ["no Host field", "GET /1 HTTP/1.0\r\nConnection: keep-alive\r\n\r\n"],
    ];
    for (const [name, request] of requests) {
      for (const transport of ["tcp", "tls"] as const) {
        test(`${name} (${transport})`, async () => {
          assert.deepStrictEqual(await staysOpen(withLength, request, { transport }), andLast(ok("/1", persists)));
        });
      }
    }

    test("a request with a body", async () => {
      const echo: Listener = (req, res) => {
        let body = req.url + " ";
        req.setEncoding("latin1");
        req.on("data", chunk => (body += chunk));
        req.on("end", () => {
          res.writeHead(200, { "Content-Length": body.length });
          res.end(body);
        });
      };
      const post = "POST /1 HTTP/1.0\r\nHost: x\r\nConnection: keep-alive\r\nContent-Length: 3\r\n\r\nabc";
      assert.deepStrictEqual(await exchange(echo, [post, asksToPersist("/2"), last]), [
        ok("/1 abc", persists),
        ok("/2 ", persists),
        ok("/last ", closes),
        "end",
      ]);
    });

    const listeners: [name: string, listener: Listener, response: string, method?: string][] = [
      [
        "writeHead(), write() and end()",
        (req, res) => {
          res.writeHead(200, { "Content-Length": 5 });
          res.write("he");
          res.end("llo");
        },
        ok("hello", persists),
      ],
      [
        "flushHeaders() before end()",
        (req, res) => {
          res.setHeader("Content-Length", 5);
          res.flushHeaders();
          res.end("hello");
        },
        ok("hello", persists),
      ],
      [
        "a listener that answers later",
        later((req, res) => {
          res.setHeader("Content-Length", 5);
          res.end("hello");
        }),
        ok("hello", persists),
      ],
      [
        "an empty body",
        (req, res) => {
          res.setHeader("Content-Length", 0);
          res.end();
        },
        ok("", persists),
      ],
      [
        "a 204",
        (req, res) => {
          res.writeHead(204, { "Content-Length": 0 });
          res.end();
        },
        `HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nDate: <date>\r\n${persists}\r\n`,
      ],
      ["a HEAD request", withLength, ok("", persists, 2), "HEAD"],
      [
        "a Connection: keep-alive header of the listener",
        (req, res) => {
          res.writeHead(200, { Connection: "keep-alive", "Content-Length": 5 });
          res.end("hello");
        },
        "HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nContent-Length: 5\r\nDate: <date>\r\n\r\nhello",
      ],
      [
        "a Connection header that the listener removed",
        (req, res) => {
          res.removeHeader("Connection");
          res.setHeader("Content-Length", 5);
          res.end("hello");
        },
        "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nDate: <date>\r\n\r\nhello",
      ],
    ];
    for (const [name, listener, response, method] of listeners) {
      test(name, async () => {
        const request = asksToPersist("/1", undefined, undefined, method);
        assert.deepStrictEqual(await staysOpen(listener, request), andLast(response));
      });
    }

    // The header decides, as for HTTP/1.1: the server does not compare it with the body.
    test("a Content-Length that is not the length of the body", async () => {
      const listener: Listener = (req, res) => {
        res.setHeader("Content-Length", req.url === "/long" ? 1 : 9);
        res.end(req.url);
      };
      const server = await listen(butLast(listener));
      const peer = await server.connect();
      try {
        peer.send(asksToPersist("/long") + asksToPersist("/short") + last);
        const head = (length: number, connection: string) =>
          `HTTP/1.1 200 OK\r\nContent-Length: ${length}\r\nDate: <date>\r\n${connection}\r\n`;
        assert.strictEqual(
          (await peer.over()).replace(/\r\nDate: [^\r]*/g, "\r\nDate: <date>"),
          head(1, persists) + "/long" + head(9, persists) + "/short" + head(5, closes) + "/lastend",
        );
      } finally {
        peer.destroy();
        server.close();
      }
    });
  });

  describe("keeps the connection open behind a response that has no body", () => {
    // For such a response without a Content-Length, _storeHeader writes Connection: close. The connection
    // stays open if the request has TE: chunked, or if the listener sets or removes the Connection header.
    const teChunked = "Connection: keep-alive\r\nTE: chunked\r\n";
    const rows: [name: string, listener: Listener, response: string, method?: string, fields?: string][] = [
      [
        "a 204 with a Connection: keep-alive header of the listener",
        (req, res) => {
          res.writeHead(204, { Connection: "keep-alive" });
          res.end();
        },
        "HTTP/1.1 204 No Content\r\nConnection: keep-alive\r\nDate: <date>\r\n\r\n",
      ],
      [
        "a 304 with a Connection header that the listener removed",
        (req, res) => {
          res.removeHeader("Connection");
          res.statusCode = 304;
          res.end();
        },
        "HTTP/1.1 304 Not Modified\r\nDate: <date>\r\n\r\n",
      ],
      [
        "a HEAD request with a Connection: keep-alive header of the listener",
        (req, res) => {
          res.setHeader("Connection", "keep-alive");
          res.end();
        },
        "HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nDate: <date>\r\n\r\n",
        "HEAD",
      ],
      [
        "a HEAD request with Transfer-Encoding and Connection: keep-alive headers of the listener",
        (req, res) => {
          res.setHeader("Transfer-Encoding", "chunked");
          res.setHeader("Connection", "keep-alive");
          res.end();
        },
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\nDate: <date>\r\n\r\n",
        "HEAD",
      ],
      [
        "a HEAD request with TE: chunked",
        withoutLength,
        `HTTP/1.1 200 OK\r\nDate: <date>\r\n${persists}\r\n`,
        "HEAD",
        teChunked,
      ],
      [
        "a 204 to a request with TE: chunked",
        (req, res) => {
          res.statusCode = 204;
          res.end();
        },
        `HTTP/1.1 204 No Content\r\nDate: <date>\r\n${persists}\r\n`,
        "GET",
        teChunked,
      ],
    ];
    for (const [name, listener, response, method, fields] of rows) {
      test(name, async () => {
        const request = asksToPersist("/1", fields, undefined, method);
        assert.deepStrictEqual(await staysOpen(listener, request), andLast(response));
      });
    }
  });

  describe("shares a connection with HTTP/1.1 requests", () => {
    /** A response to an HTTP/1.1 request has chunks. A response to an HTTP/1.0 request has a Content-Length, but not the last one. */
    const mixed: Listener = (req, res) => {
      if (req.httpVersion === "1.0" && req.url !== "/5") return withLength(req, res);
      res.write("/");
      res.end(req.url!.slice(1));
    };
    const inChunks = (path: string) =>
      `HTTP/1.1 200 OK\r\nDate: <date>\r\n${persists}Transfer-Encoding: chunked\r\n\r\n1\r\n/\r\n1\r\n${path.slice(1)}\r\n0\r\n\r\n`;
    const requests = [
      asksToPersist("/1"),
      asksToPersist("/2", "", "1.1"),
      asksToPersist("/3"),
      asksToPersist("/4", "", "1.1"),
      asksToPersist("/5"),
    ];
    const responses = [
      ok("/1", persists),
      inChunks("/2"),
      ok("/3", persists),
      inChunks("/4"),
      `HTTP/1.1 200 OK\r\nDate: <date>\r\n${closes}\r\n/5`,
      "end",
    ];
    for (const transport of ["tcp", "tls"] as const) {
      for (const pipelined of [false, true]) {
        for (const [when, timing] of timings) {
          test(`${pipelined ? "pipelined" : "one by one"}, answered ${when} (${transport})`, async () => {
            assert.deepStrictEqual(await exchange(timing(mixed), requests, { transport, pipelined }), responses);
          });
        }
      }

      // The client sends the rest of the second request when the first response is complete.
      test(`a request head in two reads (${transport})`, async () => {
        const second = asksToPersist("/2");
        const cut = second.indexOf("keep-al") + 7;
        const writes = [asksToPersist("/1", "", "1.1") + second.slice(0, cut), second.slice(cut), last];
        assert.deepStrictEqual(await exchange(withLength, writes, { transport }), [
          ok("/1", persists),
          ok("/2", persists),
          ok("/last", closes),
          "end",
        ]);
      });
    }
  });

  describe("with pipelined requests", () => {
    for (const [when, timing] of timings) {
      test(`gets every response, from a listener that answers ${when}`, async () => {
        const requests = [asksToPersist("/1"), asksToPersist("/2"), asksToPersist("/3"), last];
        assert.deepStrictEqual(await exchange(timing(withLength), requests, { pipelined: true }), [
          ok("/1", persists),
          ok("/2", persists),
          ok("/3", persists),
          ok("/last", closes),
          "end",
        ]);
      });

      test(`gets no response behind one without a Content-Length, from a listener that answers ${when}`, async () => {
        const listener: Listener = (req, res) => (req.url === "/2" ? withoutLength : withLength)(req, res);
        const requests = [asksToPersist("/1"), asksToPersist("/2"), asksToPersist("/3")];
        assert.deepStrictEqual(await exchange(timing(listener), requests, { pipelined: true }), [
          ok("/1", persists),
          `HTTP/1.1 200 OK\r\nDate: <date>\r\n${closes}\r\n/2`,
          "end",
        ]);
      });
    }

    // The first response has no usable Content-Length, so it is the last one on the connection. The second
    // response is complete before the first one ends: it must not go out behind the body of the first one.
    const endsFirst: [name: string, when: (req: http.IncomingMessage, end: () => void) => void][] = [
      ["the listener of the next request", (req, end) => end()],
      ["a 'data' listener of the next request", (req, end) => void req.once("data", end)],
    ];
    for (const [name, when] of endsFirst) {
      test(`gets no response behind a body that ${name} ends`, async () => {
        let first: http.ServerResponse;
        const listener: Listener = (req, res) => {
          if (req.url === "/1") return void (first = res);
          when(req, () => {
            first.setHeader("Content-Length", []);
            first.write("he");
            first.end("llo");
          });
          req.on("end", () => withLength(req, res)).resume();
        };
        const second = "POST /2 HTTP/1.0\r\nHost: x\r\nConnection: keep-alive\r\nContent-Length: 3\r\n\r\nabc";
        assert.deepStrictEqual(await exchange(listener, [asksToPersist("/1"), second], { pipelined: true }), [
          `HTTP/1.1 200 OK\r\nDate: <date>\r\n${closes}\r\nhello`,
          "end",
        ]);
      });
    }
  });

  describe("with a limit of the server", () => {
    const counted = "Connection: keep-alive\r\nKeep-Alive: timeout=5, max=2\r\n";
    const requests = [asksToPersist("/1"), asksToPersist("/2"), asksToPersist("/3"), last];
    const limit = { prepare: (server: http.Server) => (server.maxRequestsPerSocket = 2) };

    test("the request does not count for maxRequestsPerSocket", async () => {
      const out = await exchange(withLength, requests, limit);
      assert.deepStrictEqual(
        out.map(response => response.replace(", max=2", "")),
        [ok("/1", persists), ok("/2", persists), ok("/3", persists), ok("/last", closes), "end"],
      );
    });

    test("maxRequestsPerSocket is in Keep-Alive", notYetInBun("Bun writes no max"), async () => {
      assert.deepStrictEqual(await exchange(withLength, requests, limit), [
        ok("/1", counted),
        ok("/2", counted),
        ok("/3", counted),
        ok("/last", closes),
        "end",
      ]);
    });

    test("keepAliveTimeout closes the idle connection", async () => {
      const prepare = (server: http.Server) => {
        server.keepAliveTimeout = 50;
        server.keepAliveTimeoutBuffer = 0;
      };
      assert.deepStrictEqual(await exchange(withLength, [asksToPersist("/1")], { prepare }), [
        ok("/1", "Connection: keep-alive\r\nKeep-Alive: timeout=0\r\n"),
        "end",
      ]);
    });

    test("keepAliveTimeout = 0 sends no Keep-Alive header", async () => {
      const prepare = (server: http.Server) => (server.keepAliveTimeout = 0);
      assert.deepStrictEqual(
        await staysOpen(withLength, asksToPersist("/1"), { prepare }),
        andLast(ok("/1", "Connection: keep-alive\r\n")),
      );
    });
  });

  describe("closes the connection", () => {
    const rows: [name: string, listener: Listener, response: string, method?: string][] = [
      [
        "behind end(data) without a Content-Length",
        withoutLength,
        `HTTP/1.1 200 OK\r\nDate: <date>\r\n${closes}\r\n/1`,
      ],
      [
        "behind write() and end() without a Content-Length",
        (req, res) => {
          res.write("he");
          res.end("llo");
        },
        `HTTP/1.1 200 OK\r\nDate: <date>\r\n${closes}\r\nhello`,
      ],
      [
        "behind writeHead() without a Content-Length",
        (req, res) => {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("hello");
        },
        `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nDate: <date>\r\n${closes}\r\nhello`,
      ],
      [
        "behind a body without a Content-Length, with a Connection: keep-alive header of the listener",
        (req, res) => {
          res.writeHead(200, { Connection: "keep-alive" });
          res.end("hello");
        },
        "HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nDate: <date>\r\n\r\nhello",
      ],
      [
        "behind a Content-Length header that has no value",
        (req, res) => {
          res.setHeader("Content-Length", []);
          res.write("he");
          res.end("llo");
        },
        `HTTP/1.1 200 OK\r\nDate: <date>\r\n${closes}\r\nhello`,
      ],
      ["behind an empty end()", (req, res) => void res.end(), `HTTP/1.1 200 OK\r\nDate: <date>\r\n${closes}\r\n`],
      [
        "behind a 204 without a Content-Length",
        (req, res) => {
          res.statusCode = 204;
          res.end();
        },
        `HTTP/1.1 204 No Content\r\nDate: <date>\r\n${closes}\r\n`,
      ],
      [
        "behind a HEAD response without a Content-Length",
        withoutLength,
        `HTTP/1.1 200 OK\r\nDate: <date>\r\n${closes}\r\n`,
        "HEAD",
      ],
      [
        "when the listener removed Connection and the body has no Content-Length",
        (req, res) => {
          res.removeHeader("Connection");
          res.end("hello");
        },
        "HTTP/1.1 200 OK\r\nDate: <date>\r\n\r\nhello",
      ],
      [
        "when the listener sets res.shouldKeepAlive = false",
        (req, res) => {
          res.shouldKeepAlive = false;
          withLength(req, res);
        },
        ok("/1", closes),
      ],
      [
        "when the listener sets Connection: close",
        (req, res) => {
          res.setHeader("Connection", "close");
          res.setHeader("Content-Length", 5);
          res.end("hello");
        },
        "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: 5\r\nDate: <date>\r\n\r\nhello",
      ],
    ];
    for (const [name, listener, response, method] of rows) {
      test(name, async () => {
        const request = asksToPersist("/1", undefined, undefined, method);
        assert.deepStrictEqual(await closesBehind(listener, request), [response, "end"]);
      });
    }
  });
});

describe("an HTTP/1.0 request without a keep-alive item in Connection closes the connection", () => {
  const requests: [name: string, fields: string][] = [
    ["no Connection field", ""],
    ["Connection: close", "Connection: close\r\n"],
    ["Connection: TE", "Connection: TE\r\n"],
    ["Connection: keep-alive-x", "Connection: keep-alive-x\r\n"],
    ["Keep-Alive: timeout=5 only", "Keep-Alive: timeout=5\r\n"],
  ];
  for (const [name, fields] of requests) {
    for (const transport of ["tcp", "tls"] as const) {
      test(`${name} (${transport})`, async () => {
        const out = await closesBehind(withLength, asksToPersist("/1", fields), { transport });
        assert.deepStrictEqual(out, [ok("/1", closes), "end"]);
      });
    }
  }
});

describe("res.shouldKeepAlive is the verdict of the parser on the request", () => {
  /** What llhttp in this runtime says about the head of a request. */
  function llhttp(head: string) {
    const parser = new HTTPParser();
    parser.initialize(HTTPParser.REQUEST, {});
    let shouldKeepAlive: unknown;
    parser[HTTPParser.kOnHeadersComplete] = (...args: unknown[]) => {
      shouldKeepAlive = args[8];
      return 0;
    };
    const result = parser.execute(Buffer.from(head, "latin1"));
    parser.close();
    return result instanceof Error ? (result as NodeJS.ErrnoException).code : shouldKeepAlive;
  }

  const items = [
    "keep-alive",
    "Keep-Alive",
    "KEEP-ALIVE",
    "close",
    "Close",
    "keep-alive, close",
    "close, keep-alive",
    "keep-alive,close",
    "close,keep-alive",
    "keep-alive ,\tclose",
    "\tkeep-alive",
    "keep-alive\t",
    "  close  ",
    "keep-alive-x",
    "x-keep-alive",
    "keepalive",
    "keep alive",
    "closed",
    "close-x",
    "not close",
    "close not",
    "keep-alive;q=1",
    "keep-alive, TE",
    "TE, keep-alive",
    "TE, close",
    "TE",
    "upgrade",
    ", keep-alive",
    "keep-alive,",
    ",close,",
    ",",
    "",
  ];
  const pairs = [
    ["Connection: close", "Connection: keep-alive"],
    ["Connection: keep-alive", "Connection: close"],
    ["Connection: keep-alive", "Proxy-Connection: close"],
    ["Proxy-Connection: keep-alive", "Connection: close"],
    ["Connection: TE", "Connection: keep-alive"],
    ["Keep-Alive: timeout=5", "Connection: keep-alive"],
    ["Keep-Alive: timeout=5", "Accept: keep-alive, close"],
  ];
  for (const version of ["1.0", "1.1"]) {
    const fields = [
      "",
      ...items.flatMap(item => ["Connection", "connection", "Proxy-Connection"].map(name => `${name}: ${item}\r\n`)),
      ...pairs.map(pair => pair.join("\r\n") + "\r\n"),
    ];
    test(`HTTP/${version}: the same as llhttp in this runtime, for ${fields.length} request heads`, async () => {
      const seen: Record<string, unknown> = {};
      const wanted: Record<string, unknown> = {};
      const server = await listen((req, res) => {
        seen[fields[Number(req.url!.slice(1))]] = res.shouldKeepAlive;
        res.writeHead(200, { "Content-Length": 0, Connection: "close" });
        res.end();
      });
      try {
        for (const [i, field] of fields.entries()) {
          const head = `GET /${i} HTTP/${version}\r\nHost: x\r\n${field}\r\n`;
          wanted[field] = llhttp(head);
          const peer = await server.connect();
          await converse(peer, [head]).finally(() => peer.destroy());
        }
      } finally {
        server.close();
      }
      assert.deepStrictEqual(seen, wanted);
    });
  }

  const verdicts: [version: string, fields: string, shouldKeepAlive: boolean][] = [
    ["1.1", "", true],
    ["1.1", "Connection: close\r\n", false],
    ["1.0", "", false],
    ["1.0", "Connection: keep-alive\r\n", true],
    ["1.0", "Connection: keep-alive, close\r\n", true],
  ];
  for (const [version, fields, shouldKeepAlive] of verdicts) {
    test(`HTTP/${version} ${JSON.stringify(fields)}: the Connection header of the response follows it`, async () => {
      const seen: boolean[] = [];
      const listener: Listener = (req, res) => {
        seen.push(res.shouldKeepAlive);
        withLength(req, res);
      };
      const out = await exchange(listener, [asksToPersist("/1", fields, version)], { leave: true });
      assert.deepStrictEqual(
        { seen, out },
        { seen: [shouldKeepAlive], out: [ok("/1", shouldKeepAlive ? persists : closes)] },
      );
    });
  }

  test("a class from the ServerResponse option gets it after its constructor", async () => {
    const seen: boolean[] = [];
    class Response extends http.ServerResponse {
      constructor(req: http.IncomingMessage, options?: object) {
        // @ts-expect-error Node.js passes the options of the response as a second argument.
        super(req, options);
        this.shouldKeepAlive = false;
      }
    }
    const listener: Listener = (req, res) => {
      seen.push(res instanceof Response, res.shouldKeepAlive);
      withLength(req, res);
    };
    const requests = [asksToPersist("/1", "", "1.1"), asksToPersist("/2"), last];
    const out = await exchange(listener, requests, { server: { ServerResponse: Response } });
    assert.deepStrictEqual(
      { seen, out },
      {
        seen: [true, true, true, true, true, false],
        out: [ok("/1", persists), ok("/2", persists), ok("/last", closes), "end"],
      },
    );
  });
});

// Each input of _storeHeader that decides the Connection header, the framing of the body, and `_last`:
// https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L430-L565
describe("every head of _storeHeader for an HTTP/1.0 request with Connection: keep-alive", () => {
  const dimensions = {
    // Sets res.useChunkedEncodingByDefault.
    request: ["", "TE: chunked"],
    method: ["GET", "HEAD"],
    status: [200, 204, 304],
    length: ["", "set", "removed"],
    encoding: ["", "chunked", "removed"],
    connection: ["", "keep-alive", "close", "removed"],
    body: ["end(data)", "write() and end()", "end()"],
  } as const;
  type Row = { [K in keyof typeof dimensions]: (typeof dimensions)[K][number] };
  let rows = [{}] as Row[];
  for (const [key, values] of Object.entries(dimensions)) {
    rows = rows.flatMap(row => values.map(value => ({ ...row, [key]: value })));
  }

  const answer = (row: Row, res: http.ServerResponse) => {
    res.statusCode = row.status;
    if (row.length !== "") res.setHeader("Content-Length", row.body === "end()" ? 0 : 2);
    if (row.length === "removed") res.removeHeader("Content-Length");
    if (row.encoding !== "") res.setHeader("Transfer-Encoding", "chunked");
    if (row.encoding === "removed") res.removeHeader("Transfer-Encoding");
    if (row.connection === "removed") res.removeHeader("Connection");
    else if (row.connection !== "") res.setHeader("Connection", row.connection);
    if (row.body === "write() and end()") res.write("o");
    res.end(row.body === "end()" ? undefined : row.body === "end(data)" ? "ok" : "k");
  };

  const hasBody = (row: Row) => row.method !== "HEAD" && row.status === 200;

  /** What _storeHeader decides: the value of the Connection header, how the body ends, and what follows the response. */
  function storeHeader(row: Row) {
    const chunksByDefault = row.request !== "";
    let chunked = row.encoding === "chunked";
    let shouldKeepAlive = true;
    let last = row.connection === "close";
    if (chunked && row.status !== 200) {
      chunked = false;
      shouldKeepAlive = false;
    }
    let connection: string = row.connection;
    if (row.connection === "removed") {
      connection = "";
      last = !shouldKeepAlive;
    } else if (row.connection === "") {
      connection = shouldKeepAlive && (row.length === "set" || chunksByDefault) ? "keep-alive" : "close";
      last = connection === "close";
    }
    let body = !hasBody(row) ? "none" : chunked ? "chunks" : "length";
    if (row.length !== "set" && row.encoding !== "chunked" && hasBody(row)) {
      if (!chunksByDefault) body = "until the end";
      else if (row.body !== "write() and end()" && row.length !== "removed") body = "length";
      else if (row.encoding !== "removed") body = "chunks";
      else body = "until the end";
      last ||= body === "until the end";
    }
    return { connection, body, then: last ? "end" : "the next response" };
  }

  /**
   * Bun's native writer sends no chunks to an HTTP/1.0 request. So it closes the connection behind a body,
   * unless the head has a Content-Length header and no Transfer-Encoding header. It also closes it behind a
   * 204 or a 304 that has a Transfer-Encoding header.
   */
  const bunCloses = (row: Row) =>
    hasBody(row)
      ? !(row.length === "set" && row.encoding !== "chunked")
      : row.status !== 200 && row.encoding === "chunked";
  /** In Bun: the Connection header and what follows the response. How Bun frames a body is not a subject of this table. */
  function expected(row: Row): { connection: string; body?: string; then: string } {
    const node = storeHeader(row);
    if (!inBun) return node;
    const then = bunCloses(row) ? "end" : node.then;
    // The Connection header that Bun writes says close when the connection closes. The one of Node.js says
    // keep-alive in front of a body that only the end of the connection delimits.
    return { connection: row.connection === "" && then === "end" ? "close" : node.connection, then };
  }

  const listener = butLast((req, res) => answer(rows[Number(req.url!.slice(1))], res));

  async function observe(server: Awaited<ReturnType<typeof listen>>, row: Row, want: ReturnType<typeof expected>) {
    const fields = `Connection: keep-alive\r\n${row.request && row.request + "\r\n"}`;
    const request = asksToPersist(`/${rows.indexOf(row)}`, fields, undefined, row.method);
    const peer = await server.connect();
    try {
      // With a connection that must close, the next request is in the same write: no answer to it must arrive.
      const stays = want.then !== "end";
      const [response, ...rest] = await converse(peer, [request, stays ? last : probe], { pipelined: !stays });
      const head = response.slice(0, response.indexOf("\r\n\r\n") + 4);
      const inChunks =
        /\r\nTransfer-Encoding: chunked\r\n/i.test(head) && chunkedLength(response.slice(head.length)) !== Infinity;
      const body = !hasBody(row)
        ? "none"
        : inChunks
          ? "chunks"
          : /\r\nContent-Length: /i.test(head)
            ? "length"
            : "until the end";
      const then = rest.length === 1 ? rest[0] : rest.length === 2 && rest[1] === "end" ? "the next response" : rest;
      // No runtime keeps the connection open behind a body that nothing delimits.
      if (then !== "end") assert.notStrictEqual(body, "until the end", JSON.stringify(row));
      return { connection: /\r\nConnection: ([^\r]*)/i.exec(head)?.[1] ?? "", ...(want.body && { body }), then };
    } catch (error) {
      return { error: String(error) };
    } finally {
      peer.destroy();
    }
  }

  // A debug build of Bun takes a sample of the table: the whole table takes too long there.
  const step = harness?.isASAN || harness?.isDebug ? 5 : 1;
  for (const method of dimensions.method) {
    for (const status of dimensions.status) {
      const group = rows
        .filter(row => row.method === method && row.status === status)
        .filter((row, i) => i % step === 0);
      test(`${method}, ${status}: ${group.length} heads`, async () => {
        const seen: Record<string, unknown> = {};
        const wanted: Record<string, unknown> = {};
        const server = await listen(listener);
        const one = async (row: Row) => {
          const { method, status, ...inputs } = row;
          const name = JSON.stringify(inputs);
          wanted[name] = expected(row);
          seen[name] = await observe(server, row, expected(row));
        };
        try {
          // Each row has its own connection. Several of them are open at a time.
          for (let at = 0; at < group.length; at += 16) await Promise.all(group.slice(at, at + 16).map(one));
        } finally {
          server.close();
        }
        assert.deepStrictEqual(seen, wanted);
      });
    }
  }
});

describe("Node.js keeps the connection open, and Bun does not yet", () => {
  const teChunked = "Connection: keep-alive\r\nTE: chunked\r\n";
  const helloInChunks: Listener = (req, res) => {
    res.write("he");
    res.end("llo");
  };

  test("a request with TE: chunked, end(data)", notYetInBun("Bun closes the connection"), async () => {
    assert.deepStrictEqual(
      await staysOpen(withoutLength, asksToPersist("/1", teChunked)),
      andLast(`HTTP/1.1 200 OK\r\nDate: <date>\r\n${persists}Content-Length: 2\r\n\r\n/1`),
    );
  });

  test(
    "a request with TE: chunked, write() and end()",
    notYetInBun("Bun sends no chunks and closes the connection"),
    async () => {
      assert.deepStrictEqual(
        await staysOpen(helloInChunks, asksToPersist("/1", teChunked)),
        andLast(
          `HTTP/1.1 200 OK\r\nDate: <date>\r\n${persists}Transfer-Encoding: chunked\r\n\r\n2\r\nhe\r\n3\r\nllo\r\n0\r\n\r\n`,
        ),
      );
    },
  );

  test("res.useChunkedEncodingByDefault = true, end(data)", notYetInBun("Bun closes the connection"), async () => {
    const listener: Listener = (req, res) => {
      res.useChunkedEncodingByDefault = true;
      res.end(req.url);
    };
    assert.deepStrictEqual(
      await staysOpen(listener, asksToPersist("/1")),
      andLast(`HTTP/1.1 200 OK\r\nDate: <date>\r\n${persists}Content-Length: 2\r\n\r\n/1`),
    );
  });

  // test/js/node/test/parallel/test-http-1.0-keep-alive.js has these two. Its client accepts a connection that closes.
  test(
    "a request with TE: chunked, Connection: keep-alive header of the listener",
    notYetInBun("Bun closes the connection"),
    async () => {
      const listener: Listener = (req, res) => {
        res.writeHead(200, { Connection: "keep-alive" });
        res.end("OK");
      };
      assert.deepStrictEqual(
        await staysOpen(listener, asksToPersist("/1", teChunked)),
        andLast(
          "HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nDate: <date>\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nOK\r\n0\r\n\r\n",
        ),
      );
    },
  );

  test(
    "Transfer-Encoding: chunked and Connection: keep-alive headers of the listener",
    notYetInBun("Bun sends no chunks and closes the connection"),
    async () => {
      const listener: Listener = (req, res) => {
        res.writeHead(200, { Connection: "keep-alive", "Transfer-Encoding": "chunked" });
        res.end("OK");
      };
      assert.deepStrictEqual(
        await staysOpen(listener, asksToPersist("/1")),
        andLast(
          "HTTP/1.1 200 OK\r\nConnection: keep-alive\r\nTransfer-Encoding: chunked\r\nDate: <date>\r\n\r\n2\r\nOK\r\n0\r\n\r\n",
        ),
      );
    },
  );

  test("a connection from emit('connection')", notYetInBun("Bun closes the connection"), async () => {
    assert.deepStrictEqual(
      await staysOpen(withLength, asksToPersist("/1"), { transport: "connection event" }),
      andLast(ok("/1", persists)),
    );
  });
});

describe("rules that only Bun has", () => {
  // RFC 9112 6.1: the server closes the connection behind the response to an HTTP/1.0 request that has a
  // Transfer-Encoding field. Node.js keeps it open: llhttp does not read that field for its verdict.
  for (const [name, coding, body] of [
    ["chunked", "chunked", "3\r\nabc\r\n0\r\n\r\n"],
    ["no value", "", ""],
  ] as const) {
    bunOnly(`a request with a Transfer-Encoding field (${name}) closes the connection`, async () => {
      const seen: (boolean | string)[] = [];
      const listener: Listener = (req, res) => {
        seen.push(res.shouldKeepAlive);
        req.setEncoding("latin1");
        req.on("data", chunk => seen.push(chunk));
        req.on("end", () => withLength(req, res));
      };
      const request = `POST /1 HTTP/1.0\r\nHost: x\r\nConnection: keep-alive\r\nTransfer-Encoding: ${coding}\r\n\r\n${body}`;
      const out = await exchange(butLast(listener), [request, probe], { pipelined: true });
      assert.deepStrictEqual({ seen, out }, { seen: body ? [false, "abc"] : [false], out: [ok("/1", closes), "end"] });
    });
  }

  // Node.js sends nothing for a response that the listener destroys. Bun sends an empty line. The bytes
  // and the close must not depend on the keep-alive item of the request.
  bunOnly("res.destroy() sends the same bytes with and without keep-alive", async () => {
    const listener: Listener = (req, res) => void setImmediate(() => res.destroy());
    assert.deepStrictEqual(
      await exchange(butLast(listener), [asksToPersist("/1"), probe], { pipelined: true }),
      await exchange(listener, [asksToPersist("/1", "")]),
    );
  });

  // The first end() throws after Bun marked the head as sent, so the second end() sends a head that the
  // renderer of node:http did not write. Node.js sends a complete head there and keeps the connection open.
  bunOnly("a response whose head node:http did not render closes the connection", async () => {
    const listener: Listener = (req, res) => {
      res.setHeader("Content-Length", 5);
      res.statusMessage = { toString: () => assert.fail("from toString") } as unknown as string;
      assert.throws(() => res.end("hello"), /from toString/);
      res.statusMessage = "OK";
      res.end("hello");
    };
    const out = await exchange(butLast(listener), [asksToPersist("/1"), probe], { pipelined: true });
    assert.deepStrictEqual([out.length, out[0].endsWith("\r\n\r\nhello"), out[1]], [2, true, "end"]);
  });

  // A response that closes the connection is complete, and the client has not read all of it. RFC 9112 9.6:
  // the server does not process a request that arrives then. Node.js gives that request to the listener.
  for (const transport of ["tcp", "tls"] as const) {
    bunOnly(
      `a request behind a closing response that is not sent yet does not reach the listener (${transport})`,
      async () => {
        const secure = transport === "tls";
        const body = Buffer.alloc(32 * 1024 * 1024, "a");
        const seen: string[] = [];
        let first: http.ServerResponse | undefined;
        const listener: Listener = (req, res) => {
          if (req.url === "/ping") return void res.end("pong");
          seen.push(req.url!);
          first ??= res;
          res.shouldKeepAlive = false;
          res.setHeader("Content-Length", body.length);
          res.end(body);
        };
        const server = secure
          ? https.createServer({ key: fixture("agent1-key.pem"), cert: fixture("agent1-cert.pem") }, listener)
          : http.createServer(listener);
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        const { port } = server.address() as AddressInfo;
        // A whole exchange on a second connection: the server has handled what the first connection sent before it.
        const ping = () => {
          const { promise, resolve, reject } = Promise.withResolvers<void>();
          const options = { port, host: "127.0.0.1", path: "/ping", agent: false, rejectUnauthorized: false };
          (secure ? https : http).get(options, res => res.resume().on("end", resolve)).on("error", reject);
          return promise;
        };
        const socket = secure
          ? connectTLS({ port, host: "127.0.0.1", rejectUnauthorized: false })
          : connect(port, "127.0.0.1");
        try {
          await once(socket, secure ? "secureConnect" : "connect");
          // The client reads nothing, so most of the body waits in the server.
          socket.pause();
          socket.write(asksToPersist("/1"));
          await ping();
          // If the kernel took the whole body (Windows does, from one write to a TCP socket), nothing waits: the
          // server has sent the response and closed the connection. A request on it now gets a reset.
          if (first!.writableLength > 0) {
            socket.write(asksToPersist("/2"));
            await ping();
          }
          const chunks: Buffer[] = [];
          socket.on("data", chunk => chunks.push(chunk));
          socket.resume();
          await once(socket, "end");
          const bytes = Buffer.concat(chunks);
          assert.deepStrictEqual(
            { seen, body: bytes.length - bytes.indexOf("\r\n\r\n") - 4 },
            { seen: ["/1"], body: body.length },
          );
        } finally {
          socket.destroy();
          server.closeAllConnections();
          server.close();
        }
      },
    );
  }
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (harness) {
  const node = harness.nodeExe();

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...harness.bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
