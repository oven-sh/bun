/**
 * The tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js. The exceptions
 * are the "Bun only" block, and the tests that are todo in Bun.
 *
 * res.writeHead(status, headers) on a response with no header set before. Node
 * does not put these headers in the header store. It renders the argument as
 * given, inside writeHead():
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js#L432-L468
 * The expected values below were recorded from Node v26.3.0.
 */
import assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { type Duplex, duplexPair } from "node:stream";
import { after, describe, test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const cert = readFileSync(join(fixtures, "cert.pem"), "utf8");
const key = readFileSync(join(fixtures, "cert.key"), "utf8");

type Handler = (res: http.ServerResponse, req: http.IncomingMessage) => unknown;

// A server and a way to reach it. Every request goes to `answer`, the handler of the running test.
type Transport = {
  name: string;
  server: net.Server;
  // Opens a connection to the server. `event` tells when the connection takes bytes.
  connect: () => Promise<{ socket: Duplex; event: string | null }>;
};

let answer: Handler = res => res.end();
// What `answer` returned, one entry per request.
let returned: unknown[] = [];
let thrown: unknown;
function onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  try {
    returned.push(answer(res, req));
  } catch (error) {
    // Reported by respond(): a throw from a 'request' listener would end the process.
    thrown ??= error;
    res.destroy();
  }
}

const opened: net.Server[] = [];
after(() => {
  for (const server of opened) {
    (server as http.Server).closeAllConnections?.();
    server.close();
  }
});

async function port(server: net.Server) {
  if (!server.listening) {
    opened.push(server);
    await once(server.listen(0, "127.0.0.1"), "listening");
  }
  return (server.address() as AddressInfo).port;
}

function overTcp(name: string, server: net.Server): Transport {
  return {
    name,
    server,
    connect: async () => ({ socket: net.connect(await port(server), "127.0.0.1"), event: "connect" }),
  };
}

function overTls(name: string, server: net.Server): Transport {
  return {
    name,
    server,
    connect: async () => ({
      socket: tls.connect({
        port: await port(server),
        host: "127.0.0.1",
        rejectUnauthorized: false,
        ALPNProtocols: ["http/1.1"],
      }),
      event: "secureConnect",
    }),
  };
}

const plain = (options: http.ServerOptions = {}) => overTcp("http", http.createServer(options, onRequest));
const shared = plain();
const transports: Transport[] = [
  shared,
  overTls("https", https.createServer({ key, cert }, onRequest)),
  overTls("http2 with allowHTTP1", http2.createSecureServer({ key, cert, allowHTTP1: true }, onRequest as any)),
  {
    // A socket that the server did not accept itself. Bun parses it with the llhttp binding.
    name: 'emit("connection")',
    server: http.createServer(onRequest),
    async connect() {
      const [socket, serverSide] = duplexPair();
      this.server.emit("connection", serverSide);
      return { socket, event: null };
    },
  },
];

const GET = "GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n";
const KEEP_ALIVE = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";
const HEAD = "HEAD / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n";
const HTTP_1_0 = "GET / HTTP/1.0\r\n\r\n";
const HTTP_1_0_KEEP_ALIVE = "GET / HTTP/1.0\r\nConnection: keep-alive\r\n\r\n";
// Header lines that the server adds by itself.
const ADDED = /^(date|connection|keep-alive):/i;

type Reply = {
  status: string;
  // The header lines without the ones that the server adds, and all of them.
  headers: string[];
  all: string[];
  // The bytes after the head, as sent.
  body: string;
  // What `handler` returned.
  result: any;
  // How many requests reached the server on this connection.
  requests: number;
};

// Whether `raw` holds a whole reply to a GET request: a 204, a 304, or a body with a Content-Length or in chunks.
function isWhole(raw: string) {
  const end = raw.indexOf("\r\n\r\n");
  if (end === -1) return false;
  const head = raw.slice(0, end);
  if (/^HTTP\/1\.1 (204|304) /.test(head)) return true;
  const length = /^content-length: (\d+)$/im.exec(head);
  return length ? raw.length >= end + 4 + Number(length[1]) : raw.endsWith("0\r\n\r\n");
}

// Sends `request` on a new connection, answers it with `handler`, and reads the connection to its end.
// `then` is a second request, sent when the first reply is whole. The server answers it only if the first
// reply left the connection open.
async function respond(
  handler: Handler,
  { request = GET, transport = shared, then = "" }: { request?: string; transport?: Transport; then?: string } = {},
): Promise<Reply> {
  answer = handler;
  returned = [];
  thrown = undefined;
  const { socket, event } = await transport.connect();
  let raw = "";
  const { promise: closed, resolve, reject } = Promise.withResolvers<void>();
  let sentSecond = false;
  socket.setEncoding("latin1");
  socket.on("data", chunk => {
    raw += chunk;
    if (then && !sentSecond && isWhole(raw)) {
      sentSecond = true;
      answer = res => res.end();
      socket.write(then);
    }
  });
  // The second request can meet a connection that the server has closed: that is an end, not a failure.
  socket.on("error", error => (sentSecond ? resolve() : reject(error)));
  socket.on("end", resolve);
  socket.on("close", resolve);
  if (event) socket.once(event, () => socket.write(request));
  else socket.write(request);
  await closed;
  socket.destroy();
  if (thrown) throw thrown;
  const end = raw.indexOf("\r\n\r\n");
  const [status, ...all] = raw.slice(0, end).split("\r\n");
  return {
    status,
    headers: all.filter(line => !ADDED.test(line)),
    all,
    body: raw.slice(end + 4),
    result: returned[0],
    requests: returned.length,
  };
}

// The code of the error that `fn` throws, or the name of its class when it has no code.
function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error: any) {
    return error.code ?? error.name;
  }
  return undefined;
}

// The message of the error that `fn` throws.
function message(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error: any) {
    return error.message;
  }
  return undefined;
}

// The same text in a string of 16-bit characters: a slice of a string with a character above 0xff keeps them.
const wide = (text: string) => ("\u0100" + text).slice(1);

// A test of what Node.js does where Bun still differs, and not because of these headers: todo in Bun.
const differs = typeof Bun === "undefined" ? test : test.todo;

// The three forms of the headers argument, each built from name, value, name, value...
type Form = (...pairs: unknown[]) => any;
const pairsOf = (list: unknown[]) => list.flatMap((_, i) => (i % 2 ? [] : [[list[i], list[i + 1]]]));
const forms: [string, Form][] = [
  ["an object", (...list) => Object.fromEntries(pairsOf(list))],
  ["a flat list", (...list) => list],
  ["a list of pairs", (...list) => pairsOf(list)],
];
const [, flat] = forms[1];
const [, pairs] = forms[2];

const stored = (res: http.ServerResponse) => ({
  names: res.getHeaderNames(),
  // @types/node has no getRawHeaderNames().
  rawNames: (res as any).getRawHeaderNames() as string[],
  headers: { ...res.getHeaders() },
  has: res.hasHeader("X-A"),
  get: res.getHeader("X-A"),
});
const nothingStored = { names: [], rawNames: [], headers: {}, has: false, get: undefined };
const removed = (res: any) => ({
  connection: res._removedConnection,
  transferEncoding: res._removedTE,
  contentLength: res._removedContLen,
});

describe("writeHead(status, headers) with no header set before sends the header lines as given", () => {
  for (const transport of transports) {
    describe(transport.name, () => {
      test("an object with two spellings of one name", async () => {
        const { headers } = await respond(
          res => res.writeHead(200, { "Set-Cookie": "a=1", "set-cookie": "b=2", "X-A": "1" }).end(),
          { transport },
        );
        assert.deepStrictEqual(headers, ["Set-Cookie: a=1", "set-cookie: b=2", "X-A: 1", "Transfer-Encoding: chunked"]);
      });

      test("a flat list with a name repeated around another", async () => {
        const { headers } = await respond(res => res.writeHead(200, ["X-D", "1", "X-A", "q", "X-D", "2"]).end(), {
          transport,
        });
        assert.deepStrictEqual(headers, ["X-D: 1", "X-A: q", "X-D: 2", "Transfer-Encoding: chunked"]);
      });

      test("a list of pairs with a name repeated around another", async () => {
        const { headers } = await respond(res => res.writeHead(200, pairs("X-D", "1", "X-A", "q", "X-D", "2")).end(), {
          transport,
        });
        assert.deepStrictEqual(headers, ["X-D: 1", "X-A: q", "X-D: 2", "Transfer-Encoding: chunked"]);
      });
    });
  }

  for (const [name, message] of [
    ["a status message", "Fine"],
    ["undefined for the status message", undefined],
    ["null for the status message", null],
  ] as const) {
    test(`${name}, then a flat list`, async () => {
      const { status, headers } = await respond(res =>
        res.writeHead(200, message as any, ["X-B", "1", "X-A", "q", "X-B", "2"]).end(),
      );
      assert.deepStrictEqual(
        { status, headers },
        {
          status: `HTTP/1.1 200 ${message ?? "OK"}`,
          headers: ["X-B: 1", "X-A: q", "X-B: 2", "Transfer-Encoding: chunked"],
        },
      );
    });
  }

  test("array values: one line for each element, none for an empty array, Cookie joined with '; '", async () => {
    const { headers } = await respond(res =>
      res
        .writeHead(
          200,
          flat("Set-Cookie", ["a=1", "b=2"], "X-A", 1, "Set-Cookie", "c=3", "Cookie", ["c=1", "d=2"], "X-E", []),
        )
        .end(),
    );
    assert.deepStrictEqual(headers, [
      "Set-Cookie: a=1",
      "Set-Cookie: b=2",
      "X-A: 1",
      "Set-Cookie: c=3",
      "Cookie: c=1; d=2",
      "Transfer-Encoding: chunked",
    ]);
  });

  test("a Cookie array is joined by its own join()", async () => {
    class Jar extends Array<string> {
      join() {
        return "from the subclass";
      }
    }
    const { headers, result } = await respond(res => {
      const own = ["a", "b"];
      own.join = () => "from its own join";
      const cyclic: unknown[] = ["x"];
      cyclic.push(cyclic);
      const broken = ["a", "b"];
      (broken as any).join = 5;
      const thrown = code(() => res.writeHead(200, [["Cookie", broken]] as any));
      res.writeHead(200, [
        ["Cookie", Jar.from(["a", "b"])],
        ["cookie", own],
        ["COOKIE", cyclic],
      ] as any);
      res.end();
      return thrown;
    });
    assert.deepStrictEqual(
      { headers, result },
      {
        headers: [
          "Cookie: from the subclass",
          "cookie: from its own join",
          "COOKIE: x; ",
          "Transfer-Encoding: chunked",
        ],
        result: "TypeError",
      },
    );
  });

  test("a Cookie array of one element is not joined, and one of no element is no line", async () => {
    const { headers } = await respond(res =>
      res.writeHead(200, flat("Cookie", [], "cookie", [null], "X-A", "1")).end(),
    );
    assert.deepStrictEqual(headers, ["cookie: null", "X-A: 1", "Transfer-Encoding: chunked"]);
  });

  test("an object: only its own properties are headers", async () => {
    const { headers } = await respond(res =>
      res.writeHead(200, Object.assign(Object.create({ "X-Inherited": "1" }), { "X-A": "1" })).end(),
    );
    assert.deepStrictEqual(headers, ["X-A: 1", "Transfer-Encoding: chunked"]);
  });

  test("an array value of a name in the uniqueHeaders option is joined with '; '", async () => {
    const transport = plain({ uniqueHeaders: ["x-u"] });
    const { headers } = await respond(res => res.writeHead(200, { "X-U": ["1", "2"], "X-A": ["3", "4"] }).end(), {
      transport,
    });
    assert.deepStrictEqual(headers, ["X-U: 1; 2", "X-A: 3", "X-A: 4", "Transfer-Encoding: chunked"]);
  });

  test("an array value of a name in the uniqueHeaders option: an empty array is an empty value", async () => {
    const transport = plain({ uniqueHeaders: ["x-u", "x-v"] });
    const { headers } = await respond(res => res.writeHead(200, { "X-U": [], "X-V": ["1"] }).end(), { transport });
    assert.deepStrictEqual(headers, ["X-U: ", "X-V: 1", "Transfer-Encoding: chunked"]);
  });

  test("Cookie joins null and undefined as empty strings", async () => {
    const { headers } = await respond(res => res.writeHead(200, { Cookie: ["a", null, undefined, "b"] as any }).end());
    assert.deepStrictEqual(headers, ["Cookie: a; ; ; b", "Transfer-Encoding: chunked"]);
  });

  test("a Proxy of each form of the argument", async () => {
    const sent: string[][] = [];
    for (const [, form] of forms) {
      const { headers } = await respond(res => res.writeHead(200, new Proxy(form("X-A", "1", "X-B", "2"), {})).end());
      sent.push(headers);
    }
    const lines = ["X-A: 1", "X-B: 2", "Transfer-Encoding: chunked"];
    assert.deepStrictEqual(sent, [lines, lines, lines]);
  });

  test("a Proxy of an object: the value of a header is what the get trap gives", async () => {
    const { headers, result } = await respond(res => {
      const traps: string[] = [];
      const proxy = new Proxy(
        { "X-A": "1" },
        {
          ownKeys(target) {
            traps.push("ownKeys");
            return Reflect.ownKeys(target);
          },
          getOwnPropertyDescriptor(target, key) {
            traps.push(`getOwnPropertyDescriptor ${String(key)}`);
            return Reflect.getOwnPropertyDescriptor(target, key);
          },
          get(target, key, receiver) {
            traps.push(`get ${String(key)}`);
            return key === "X-A" ? "from get" : Reflect.get(target, key, receiver);
          },
        },
      );
      res.writeHead(200, proxy).end();
      return traps;
    });
    assert.deepStrictEqual(
      { headers, result },
      {
        headers: ["X-A: from get", "Transfer-Encoding: chunked"],
        result: ["ownKeys", "getOwnPropertyDescriptor X-A", "getOwnPropertyDescriptor X-A", "get X-A"],
      },
    );
  });

  test("an object: a getter is read, and a property that is not enumerable or has a Symbol for its name is not a header", async () => {
    const sent: string[][] = [];
    // With a getter and with none: Bun reads the names of a plain object with no getter from its shape.
    for (const object of [
      {
        get "X-A"() {
          return "got";
        },
      },
      { "X-A": "got" },
    ] as Record<string | symbol, string>[]) {
      const { headers } = await respond(res => {
        object["X-B"] = "2";
        object[Symbol("s")] = "3";
        Object.defineProperty(object, "X-Hidden", { value: "4", enumerable: false });
        res.writeHead(200, object as Record<string, string>).end();
      });
      sent.push(headers);
    }
    const lines = ["X-A: got", "X-B: 2", "Transfer-Encoding: chunked"];
    assert.deepStrictEqual(sent, [lines, lines]);
  });

  test("an object: the names that are array indexes come first", async () => {
    const { headers } = await respond(res => res.writeHead(200, { b: "1", 1: "one", a: "2", 0: "zero" }).end());
    assert.deepStrictEqual(headers, ["0: zero", "1: one", "b: 1", "a: 2", "Transfer-Encoding: chunked"]);
  });

  test("values that are not strings: null, a boolean, a number and a BigInt", async () => {
    const { headers } = await respond(res =>
      res.writeHead(200, { "X-A": null, "X-B": true, "X-C": 0, "X-D": 5n } as any).end(),
    );
    assert.deepStrictEqual(headers, ["X-A: null", "X-B: true", "X-C: 0", "X-D: 5", "Transfer-Encoding: chunked"]);
  });

  test("a string in the place of the headers, and a string in the place of a pair", async () => {
    const sent: string[][] = [];
    for (const head of [
      (res: http.ServerResponse) => res.writeHead(200, undefined, "ab" as any),
      (res: http.ServerResponse) => res.writeHead(200, [["X-A", "1"], "xy"] as any),
    ]) {
      const { headers } = await respond(res => head(res).end());
      sent.push(headers);
    }
    assert.deepStrictEqual(sent, [
      ["0: a", "1: b", "Transfer-Encoding: chunked"],
      ["X-A: 1", "x: y", "Transfer-Encoding: chunked"],
    ]);
  });

  test("a value with a character above 0x7f is sent as one byte, and a tab is sent", async () => {
    const { headers } = await respond(res => res.writeHead(200, { "X-A": "caf\u00e9", "X-B": "a\tb" }).end());
    assert.deepStrictEqual(headers, ["X-A: caf\u00e9", "X-B: a\tb", "Transfer-Encoding: chunked"]);
  });

  test("a name and a value in strings of 16-bit characters are sent as bytes", async () => {
    const sent: string[][] = [];
    for (const [, form] of forms) {
      const { headers } = await respond(res =>
        // Node.js sends a head as UTF-8 when it goes out in one string with the body. A body of bytes keeps them apart.
        res
          .writeHead(200, form(wide("X-A"), wide("caf\u00e9"), wide("Content-Length"), wide("2")))
          .end(Buffer.from("ok")),
      );
      sent.push(headers);
    }
    const lines = ["X-A: caf\u00e9", "Content-Length: 2"];
    assert.deepStrictEqual(sent, [lines, lines, lines]);
  });

  for (const transport of transports.slice(0, 2)) {
    test(`a head of 20 KiB, and one line of 20 KiB: ${transport.name}`, async () => {
      const sent: unknown[] = [];
      const cookies = Array.from({ length: 20 }, (_, i) => `c${i}=${Buffer.alloc(1000, "x").toString()}`);
      const long = Buffer.alloc(20000, "y").toString();
      for (const value of [cookies, [long]]) {
        const { headers, body } = await respond(
          res => res.writeHead(200, { "Set-Cookie": value, "Content-Length": "2" }).end("ok"),
          { transport },
        );
        sent.push({
          same: headers.join() === [...value.map(cookie => `Set-Cookie: ${cookie}`), "Content-Length: 2"].join(),
          body,
        });
      }
      assert.deepStrictEqual(sent, [
        { same: true, body: "ok" },
        { same: true, body: "ok" },
      ]);
    });
  }

  // The server answers such a request itself, with writeHead(400, { Connection: "close" }) in Bun.
  test("the reply to a request with no Host header closes the connection", async () => {
    const { status, all, requests } = await respond(res => res.end(), { request: "GET / HTTP/1.1\r\n\r\n", then: GET });
    assert.deepStrictEqual(
      { status, headers: all.filter(line => !/^date:/i.test(line)), requests },
      { status: "HTTP/1.1 400 Bad Request", headers: ["Connection: close", "Transfer-Encoding: chunked"], requests: 0 },
    );
  });

  test("a server with insecureHTTPParser sends a control character in a value", async () => {
    const transport = plain({ insecureHTTPParser: true });
    const { headers } = await respond(res => res.writeHead(200, { "X-A": "a\u0001b\u007f" }).end(), { transport });
    assert.deepStrictEqual(headers, ["X-A: a\u0001b\u007f", "Transfer-Encoding: chunked"]);
  });

  test("a server with insecureHTTPParser refuses NUL, a line break and a character above 0xff in a value", async () => {
    const transport = plain({ insecureHTTPParser: true });
    const { result } = await respond(
      res => {
        const thrown = ["a\u0000b", "a\nb", "a\rb", "a\u0100b"].map(value =>
          code(() => res.writeHead(200, { "X-A": value })),
        );
        res.end();
        return thrown;
      },
      { transport },
    );
    assert.deepStrictEqual(result, ["ERR_INVALID_CHAR", "ERR_INVALID_CHAR", "ERR_INVALID_CHAR", "ERR_INVALID_CHAR"]);
  });

  test("a Date in the list replaces the Date of the server, and res.sendDate stays true", async () => {
    const { all, result } = await respond(res => {
      res.writeHead(200, ["Date", "Mon, 01 Jan 2024 00:00:00 GMT", "X-A", "1"]);
      const sendDate = res.sendDate;
      res.end();
      return sendDate;
    });
    assert.deepStrictEqual(
      { date: all.filter(line => /^date:/i.test(line)), sendDate: result },
      { date: ["Date: Mon, 01 Jan 2024 00:00:00 GMT"], sendDate: true },
    );
  });

  for (const [name, form] of forms) {
    // As in `name + ": " + value`.
    test(`a value with valueOf() and toString() is sent as valueOf() gives it: ${name}`, async () => {
      const value = () => ({ toString: () => "ts", valueOf: () => "vo" });
      const { headers } = await respond(res => res.writeHead(200, form("X-A", value(), "X-B", [value(), "2"])).end());
      assert.deepStrictEqual(headers, ["X-A: vo", "X-B: vo", "X-B: 2", "Transfer-Encoding: chunked"]);
    });
  }

  for (const [via, drive] of [
    ["end()", (res: http.ServerResponse) => res.end("hi")],
    ["write()", (res: http.ServerResponse) => (res.write("hi"), res.end())],
    ["flushHeaders()", (res: http.ServerResponse) => (res.flushHeaders(), res.end("hi"))],
  ] as const) {
    // end() knows the length of the body when it calls writeHead(). write() and flushHeaders() do not.
    const framing = via === "end()" ? "Content-Length: 2" : "Transfer-Encoding: chunked";

    test(`a replaced writeHead that passes a list on, called by ${via}`, async () => {
      const { headers, result } = await respond(res => {
        const original = res.writeHead;
        res.writeHead = function (this: http.ServerResponse, status: number) {
          return original.call(this, status, ["X-D", "1", "X-A", "q", "X-D", "2"]);
        } as typeof res.writeHead;
        drive(res);
        return res.getHeaderNames();
      });
      assert.deepStrictEqual({ headers, result }, { headers: ["X-D: 1", "X-A: q", "X-D: 2", framing], result: [] });
    });

    test(`a subclass whose writeHead passes an object on, called by ${via}`, async () => {
      class Response extends http.ServerResponse {
        writeHead(status: number): this {
          return super.writeHead(status, { "Set-Cookie": "a=1", "set-cookie": "b=2" });
        }
      }
      const transport = plain({ ServerResponse: Response as any });
      const { headers, result } = await respond(res => (drive(res), res.getHeaderNames()), { transport });
      assert.deepStrictEqual(
        { headers, result },
        { headers: ["Set-Cookie: a=1", "set-cookie: b=2", framing], result: [] },
      );
    });
  }

  // The response has no socket, and on some transports no handle, while its constructor runs.
  class WritesHeadInConstructor extends http.ServerResponse {
    constructor(req: http.IncomingMessage) {
      super(req);
      // The server gives the response its keep-alive state after the constructor. `close` here ends the connection.
      this.writeHead(200, {
        "X-A": "1",
        "Set-Cookie": "a=1",
        "set-cookie": "b=2",
        "Content-Length": "2",
        "Connection": "close",
      });
    }
  }
  const inConstructor: Transport[] = [
    plain({ ServerResponse: WritesHeadInConstructor as any }),
    overTls("https", https.createServer({ key, cert, ServerResponse: WritesHeadInConstructor as any }, onRequest)),
    overTls(
      "http2 with allowHTTP1",
      http2.createSecureServer(
        { key, cert, allowHTTP1: true, Http1ServerResponse: WritesHeadInConstructor as any },
        onRequest as any,
      ),
    ),
    { ...transports[3], server: http.createServer({ ServerResponse: WritesHeadInConstructor as any }, onRequest) },
  ];
  for (const transport of inConstructor) {
    test(`a subclass that calls writeHead() in its constructor: ${transport.name}`, async () => {
      // The request asks for keep-alive. `close` in the argument closes the connection: the second request gets no answer.
      // A socket that is not a net.Socket is ended and not destroyed, so there the server still reads the second request.
      const { all, body, requests } = await respond(res => res.end("ok"), {
        transport,
        request: KEEP_ALIVE,
        then: GET,
      });
      assert.deepStrictEqual(
        { headers: all.filter(line => !/^date:/i.test(line)), body, requests },
        {
          headers: ["X-A: 1", "Set-Cookie: a=1", "set-cookie: b=2", "Content-Length: 2", "Connection: close"],
          body: "ok",
          requests: transport === inConstructor[3] ? 2 : 1,
        },
      );
    });
  }

  // /(?:^|\W)close(?:$|\W)/i and /(?:^|\W)chunked(?:$|\W)/i in Node.js.
  test("`close` in a Connection line and `chunked` in a Transfer-Encoding line are whole words, in any case", async () => {
    const found: Record<string, unknown> = {};
    for (const [header, field, values] of [
      ["Connection", "_last", ["close", "Close", "keep-alive, close", "not-close", "closed", "x_close", "close_"]],
      [
        "Transfer-Encoding",
        "chunkedEncoding",
        ["chunked", "CHUNKED", "gzip, chunked", "chunked;q=1", "chunked2", "x_chunked", "unchunked"],
      ],
    ] as const) {
      for (const value of values) {
        const { result } = await respond(res => {
          res.writeHead(200, [header, value]);
          const after = (res as any)[field];
          // Not end(): the body has no framing that a client can read for some of these.
          res.destroy();
          return after;
        });
        found[`${header}: ${value}`] = result;
      }
    }
    assert.deepStrictEqual(found, {
      "Connection: close": true,
      "Connection: Close": true,
      "Connection: keep-alive, close": true,
      "Connection: not-close": true,
      "Connection: closed": false,
      "Connection: x_close": false,
      "Connection: close_": false,
      "Transfer-Encoding: chunked": true,
      "Transfer-Encoding: CHUNKED": true,
      "Transfer-Encoding: gzip, chunked": true,
      "Transfer-Encoding: chunked;q=1": true,
      "Transfer-Encoding: chunked2": false,
      "Transfer-Encoding: x_chunked": false,
      "Transfer-Encoding: unchunked": false,
    });
  });

  test("a ServerResponse with no socket", () => {
    const res = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 } as any);
    res.writeHead(200, { "Set-Cookie": "a=1", "set-cookie": "b=2" });
    const head: string = (res as any)._header;
    assert.deepStrictEqual(
      { cookies: head.split("\r\n").filter(line => /^set-cookie:/i.test(line)), stored: res.getHeaderNames() },
      { cookies: ["Set-Cookie: a=1", "set-cookie: b=2"], stored: [] },
    );
  });

  test("a ServerResponse with no socket: a writeHead() that throws can be called again", () => {
    const res = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 } as any);
    res.sendDate = false;
    const first = code(() => res.writeHead(200, { "X-A": "1", "bad name": "1" }));
    const headersSent = res.headersSent;
    const second = code(() => res.writeHead(201, ["X-B", "2", "X-C", "3", "X-B", "4"]));
    assert.deepStrictEqual(
      { first, headersSent, second, head: (res as any)._header },
      {
        first: "ERR_INVALID_HTTP_TOKEN",
        headersSent: false,
        second: undefined,
        // The status message is the one of the call that threw.
        head: "HTTP/1.1 201 OK\r\nX-B: 2\r\nX-C: 3\r\nX-B: 4\r\nConnection: keep-alive\r\nTransfer-Encoding: chunked\r\n\r\n",
      },
    );
  });

  // @mswjs/interceptors, and so nock and msw, answer a mocked request in this way.
  test("a ServerResponse on a socket of the caller, after removeHeader()", async () => {
    const [socket, client] = duplexPair();
    let raw = "";
    client.setEncoding("latin1");
    client.on("data", chunk => (raw += chunk));
    const res = new http.ServerResponse(new http.IncomingMessage(socket as any));
    res.assignSocket(socket as any);
    res.removeHeader("connection");
    res.removeHeader("date");
    res.writeHead(200, "Fine", pairs("Set-Cookie", "a=1", "set-cookie", "b=2", "X-A", "1"));
    res.write(new Uint8Array([111, 107]));
    res.end();
    while (!raw.endsWith("\r\n\r\nok")) await once(client, "data");
    assert.deepStrictEqual(
      { raw, stored: res.getHeaderNames() },
      { raw: "HTTP/1.1 200 Fine\r\nSet-Cookie: a=1\r\nset-cookie: b=2\r\nX-A: 1\r\n\r\nok", stored: [] },
    );
  });

  test("a ServerResponse with no socket: a Content-Disposition that is not ASCII, after a Content-Length, throws", () => {
    const res = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 } as any);
    // Node.js does not reach the two lines behind the one that it refuses.
    const thrown = code(() =>
      res.writeHead(
        200,
        pairs(
          "Content-Length",
          "2",
          "Content-Disposition",
          'attachment; filename="caf\u00e9.txt"',
          "Connection",
          "close",
          "Transfer-Encoding",
          "chunked",
        ),
      ),
    );
    assert.deepStrictEqual(
      {
        thrown,
        headersSent: res.headersSent,
        head: (res as any)._header,
        last: (res as any)._last,
        chunkedEncoding: res.chunkedEncoding,
      },
      { thrown: "ERR_INVALID_CHAR", headersSent: false, head: null, last: false, chunkedEncoding: false },
    );
  });

  for (const [name, form] of forms) {
    test(`a ServerResponse with no socket: a Content-Disposition that is not ASCII, before a Content-Length, is rendered: ${name}`, () => {
      const res = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 } as any);
      res.sendDate = false;
      res.writeHead(200, form("Content-Disposition", 'attachment; filename="caf\u00e9.txt"', "Content-Length", "2"));
      assert.strictEqual(
        (res as any)._header,
        'HTTP/1.1 200 OK\r\nContent-Disposition: attachment; filename="caf\u00e9.txt"\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\n',
      );
    });
  }

  test("a ServerResponse with no socket: res._contentLength is the number of the value, not of its text", () => {
    const res = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 } as any);
    res.sendDate = false;
    res.writeHead(200, { "Content-Length": true } as any);
    assert.deepStrictEqual(
      { head: (res as any)._header, contentLength: (res as any)._contentLength },
      { head: "HTTP/1.1 200 OK\r\nContent-Length: true\r\nConnection: keep-alive\r\n\r\n", contentLength: 1 },
    );
  });
});

describe("writeHead(status, headers) with no header set before keeps the headers out of the header store", () => {
  for (const [name, form] of forms) {
    test(name, async () => {
      const { result } = await respond(res => {
        res.writeHead(200, form("X-A", "1", "Content-Type", "text/plain"));
        const after = stored(res);
        res.end();
        return after;
      });
      assert.deepStrictEqual(result, nothingStored);
    });
  }

  // Node's matchHeader() clears the mark of removeHeader() for a header that it sees.
  test("a header that the argument names is not a removed header any more", async () => {
    const results: unknown[] = [];
    for (const connection of ["close", "keep-alive"]) {
      const { result } = await respond(res => {
        for (const name of ["Connection", "Transfer-Encoding", "Content-Length"]) res.removeHeader(name);
        const before = { ...removed(res) };
        res.writeHead(200, { "Connection": connection, "Transfer-Encoding": "chunked", "Content-Length": "2" });
        const after = removed(res);
        // Not end(): after `keep-alive` the connection would stay open.
        res.destroy();
        return { before, after };
      });
      results.push(result);
    }
    const cleared = {
      before: { connection: true, transferEncoding: true, contentLength: true },
      after: { connection: false, transferEncoding: false, contentLength: false },
    };
    assert.deepStrictEqual(results, [cleared, cleared]);
  });

  test("a header that a value's toString() sets is stored and not sent", async () => {
    const { headers, result } = await respond(res => {
      const value = {
        toString() {
          res.setHeader("X-Late", "1");
          return "a";
        },
      };
      res.writeHead(200, { "X-A": value as any, "X-B": "b" });
      const names = res.getHeaderNames();
      res.end();
      return names;
    });
    assert.deepStrictEqual(
      { headers, result },
      { headers: ["X-A: a", "X-B: b", "Transfer-Encoding: chunked"], result: ["x-late"] },
    );
  });

  test("removeHeader() alone makes no store: the argument is sent as given", async () => {
    const { headers, result } = await respond(res => {
      res.removeHeader("X-None");
      res.writeHead(200, { "Set-Cookie": "a=1", "set-cookie": "b=2" });
      const names = res.getHeaderNames();
      res.end();
      return names;
    });
    assert.deepStrictEqual(
      { headers, result },
      { headers: ["Set-Cookie: a=1", "set-cookie: b=2", "Transfer-Encoding: chunked"], result: [] },
    );
  });

  test("strictContentLength still fails end() for a Content-Length of NaN in the header store", async () => {
    const { result } = await respond(res => {
      res.strictContentLength = true;
      res.setHeader("Content-Length", NaN);
      const thrown = code(() => res.end("x"));
      res.destroy();
      return thrown;
    });
    assert.strictEqual(result, "ERR_HTTP_CONTENT_LENGTH_MISMATCH");
  });

  test("strictContentLength: end() ends a response whose _contentLength is NaN with no header", async () => {
    const { headers, result } = await respond(res => {
      res.strictContentLength = true;
      (res as any)._contentLength = NaN;
      const thrown = code(() => res.end());
      if (thrown) res.destroy();
      return thrown;
    });
    assert.deepStrictEqual({ headers, result }, { headers: ["Content-Length: 0"], result: undefined });
  });

  test("a header set before: the argument goes through the store", async () => {
    const { headers, result } = await respond(res => {
      res.setHeader("X-Pre", "pre");
      res.writeHead(200, ["X-D", "1", "X-A", "q", "X-D", "2"]);
      const after = stored(res);
      res.end();
      return after;
    });
    assert.deepStrictEqual(
      { headers, result },
      {
        headers: ["X-Pre: pre", "X-D: 1", "X-D: 2", "X-A: q", "Transfer-Encoding: chunked"],
        result: {
          names: ["x-pre", "x-d", "x-a"],
          rawNames: ["X-Pre", "X-D", "X-A"],
          headers: { "x-pre": "pre", "x-d": ["1", "2"], "x-a": "q" },
          has: true,
          get: "q",
        },
      },
    );
  });

  test("a header set and removed before: the store exists, so the argument goes through it", async () => {
    const { headers, result } = await respond(res => {
      res.setHeader("X-Pre", "pre");
      res.removeHeader("X-Pre");
      res.writeHead(200, { "Set-Cookie": "a=1", "set-cookie": "b=2" });
      const names = res.getHeaderNames();
      res.end();
      return names;
    });
    assert.deepStrictEqual(
      { headers, result },
      { headers: ["set-cookie: b=2", "Transfer-Encoding: chunked"], result: ["set-cookie"] },
    );
  });
});

describe("writeHead(status, headers) with no header set before reads the argument inside writeHead()", () => {
  test("a change to the flat list after writeHead() is not sent", async () => {
    const { headers } = await respond(res => {
      const list = ["X-D", "1", "X-A", "q"];
      res.writeHead(200, list);
      list[1] = "changed";
      list.push("X-Late", "1");
      res.end();
    });
    assert.deepStrictEqual(headers, ["X-D: 1", "X-A: q", "Transfer-Encoding: chunked"]);
  });

  test("a change to the object after writeHead() is not sent", async () => {
    const { headers } = await respond(res => {
      const headers: Record<string, string> = { "X-D": "1", "X-A": "q" };
      res.writeHead(200, headers);
      headers["X-D"] = "changed";
      headers["X-Late"] = "1";
      res.end();
    });
    assert.deepStrictEqual(headers, ["X-D: 1", "X-A: q", "Transfer-Encoding: chunked"]);
  });

  test("a value is made a string inside writeHead()", async () => {
    const { headers } = await respond(res => {
      let text = "early";
      res.writeHead(200, { "X-A": { toString: () => text } as any });
      text = "late";
      res.end();
    });
    assert.deepStrictEqual(headers, ["X-A: early", "Transfer-Encoding: chunked"]);
  });

  for (const [name, form] of forms) {
    test(`a change to an array value after writeHead() is not sent: ${name}`, async () => {
      const { headers } = await respond(res => {
        const value = ["a=1"];
        res.writeHead(200, form("Set-Cookie", value));
        value.push("b=2");
        value[0] = "changed";
        res.end();
      });
      assert.deepStrictEqual(headers, ["Set-Cookie: a=1", "Transfer-Encoding: chunked"]);
    });
  }

  for (const [name, list] of [
    ["a flat list", (kept: readonly string[], own: string) => ["Set-Cookie", kept, "Set-Cookie", own]],
    ["a list of pairs", (kept: readonly string[], own: string) => pairs("Set-Cookie", kept, "Set-Cookie", own)],
  ] as const) {
    test(`an array value that the caller keeps is not written to: ${name}`, async () => {
      // An array that is shared between responses, and one that cannot be written to.
      const kept = ["theme=dark"];
      const frozen = Object.freeze(["theme=dark"]);
      const sent: string[][] = [];
      for (const [value, own] of [
        [kept, "sid=alice"],
        [kept, "sid=bob"],
        [frozen, "sid=carol"],
      ] as const) {
        const { headers } = await respond(res => res.writeHead(200, list(value, own)).end());
        sent.push(headers.filter(line => line.startsWith("Set-Cookie:")));
      }
      assert.deepStrictEqual(
        { sent, kept },
        {
          sent: [
            ["Set-Cookie: theme=dark", "Set-Cookie: sid=alice"],
            ["Set-Cookie: theme=dark", "Set-Cookie: sid=bob"],
            ["Set-Cookie: theme=dark", "Set-Cookie: sid=carol"],
          ],
          kept: ["theme=dark"],
        },
      );
    });
  }

  // Each value below is made a string two times, as in Node.js: once for the check, once for the line.
  test("a list that grows during writeHead() is read to its new end", async () => {
    const sent: string[][] = [];
    for (const grow of [
      (value: object) => {
        const list: unknown[] = ["X-A", value];
        return [list, () => list.push("X-B", "2")] as const;
      },
      (value: object) => {
        const list: unknown[] = [["X-A", value]];
        return [list, () => list.push(["X-B", "2"])] as const;
      },
      (value: object) => {
        const values: unknown[] = [value];
        return [["X-A", values], () => values.push("2")] as const;
      },
    ]) {
      const { headers } = await respond(res => {
        let grown = false;
        const [list, push] = grow({
          toString() {
            if (!grown) push();
            grown = true;
            return "1";
          },
        });
        res.writeHead(200, list as any).end();
      });
      sent.push(headers);
    }
    assert.deepStrictEqual(sent, [
      ["X-A: 1", "X-B: 2", "Transfer-Encoding: chunked"],
      ["X-A: 1", "X-B: 2", "Transfer-Encoding: chunked"],
      ["X-A: 1", "X-A: 2", "Transfer-Encoding: chunked"],
    ]);
  });

  test("a list that shrinks during writeHead() is read to its new end", async () => {
    const { headers } = await respond(res => {
      const list: unknown[] = [
        "X-A",
        {
          toString() {
            list.length = 2;
            return "1";
          },
        },
        "X-B",
        "2",
      ];
      res.writeHead(200, list as any).end();
    });
    assert.deepStrictEqual(headers, ["X-A: 1", "Transfer-Encoding: chunked"]);
  });

  test("a flat list is checked for an odd count once, before its first entry", async () => {
    const { result } = await respond(res => {
      let grown = false;
      const list: unknown[] = [
        "X-A",
        {
          toString() {
            if (!grown) list.push("X-B");
            grown = true;
            return "1";
          },
        },
      ];
      // The name without a value fails as a value that is undefined, not as an odd count.
      const thrown = code(() => res.writeHead(200, list as any));
      res.end();
      return thrown;
    });
    assert.strictEqual(result, "ERR_HTTP_INVALID_HEADER_VALUE");
  });

  test("an object: a property that the walk deletes is not sent, one that it adds is not sent, one that it changes or hides is sent", async () => {
    const { headers } = await respond(res => {
      const object: Record<string, unknown> = {
        "X-A": {
          toString() {
            delete object["X-B"];
            object["X-C"] = "changed";
            object["X-New"] = "new";
            Object.defineProperty(object, "X-D", { enumerable: false });
            return "1";
          },
        },
        "X-B": "2",
        "X-C": "3",
        "X-D": "4",
      };
      res.writeHead(200, object as any).end();
    });
    assert.deepStrictEqual(headers, ["X-A: 1", "X-C: changed", "X-D: 4", "Transfer-Encoding: chunked"]);
  });

  test("an object for a value is asked for a string, then for the value that is sent, and a Content-Length for a number too", async () => {
    const { headers, body, result } = await respond(res => {
      const hints: string[] = [];
      const value = (name: string) => ({
        [Symbol.toPrimitive](hint: string) {
          hints.push(`${name} ${hint}`);
          return hint === "number" ? 7 : "5";
        },
      });
      res.writeHead(200, { "X-A": value("X-A"), "Content-Length": value("Content-Length") } as any);
      const contentLength = (res as any)._contentLength;
      res.end("12345");
      return { hints, contentLength };
    });
    assert.deepStrictEqual(
      { headers, body, result },
      {
        headers: ["X-A: 5", "Content-Length: 5"],
        body: "12345",
        result: {
          hints: [
            "X-A string",
            "X-A default",
            "Content-Length string",
            "Content-Length default",
            "Content-Length number",
          ],
          contentLength: 7,
        },
      },
    );
  });

  test("an object for Connection or Transfer-Encoding is asked for a string once more, and that string says what the response does", async () => {
    const { result } = await respond(res => {
      const hints: string[] = [];
      const value = (name: string, string: string, sent: string) => ({
        [Symbol.toPrimitive](hint: string) {
          hints.push(`${name} ${hint}`);
          return hint === "string" ? string : sent;
        },
      });
      res.writeHead(200, {
        "Connection": value("Connection", "keep-alive", "close"),
        "Transfer-Encoding": value("Transfer-Encoding", "chunked", "gzip"),
      } as any);
      const after = { hints, last: (res as any)._last, chunkedEncoding: res.chunkedEncoding };
      // Not end(): the head says `gzip`, and the body would be in chunks.
      res.destroy();
      return after;
    });
    assert.deepStrictEqual(result, {
      hints: [
        "Connection string",
        "Connection default",
        "Connection string",
        "Transfer-Encoding string",
        "Transfer-Encoding default",
        "Transfer-Encoding string",
      ],
      last: false,
      chunkedEncoding: true,
    });
  });

  test("a value whose toString() calls writeHead() does not make the outer call throw, and the outer call gives the status", async () => {
    const { status, headers, result } = await respond(res => {
      let nested = false;
      const value = {
        toString() {
          if (!nested) {
            nested = true;
            res.writeHead(201, "Inner", { "X-N": "1" });
          }
          return "a";
        },
      };
      const thrown = code(() => res.writeHead(200, "Outer", { "X-A": value as any, "X-B": "b" }));
      res.end();
      return thrown;
    });
    assert.deepStrictEqual(
      { status, headers, result },
      { status: "HTTP/1.1 200 Outer", headers: ["X-A: a", "X-B: b", "Transfer-Encoding: chunked"], result: undefined },
    );
  });

  for (const [when, outer, thrown] of [
    ["in the walk", ["X-A", undefined, "bad name", "1"], "ERR_INVALID_HTTP_TOKEN"],
    ["after the walk", ["X-A", undefined, "Trailer", "X-T", "Content-Length", "3"], "ERR_HTTP_TRAILER_INVALID"],
  ] as const) {
    test(`a value whose toString() calls writeHead(), and then the outer call throws ${when}: the head of the inner call stays`, async () => {
      const { status, headers, body, result } = await respond(res => {
        res.strictContentLength = true;
        let nested = false;
        const value = {
          toString() {
            if (!nested) {
              nested = true;
              res.writeHead(201, "Inner", { "Content-Length": 3, "Connection": "close" });
            }
            return "a";
          },
        };
        const list = outer.map(entry => entry ?? value);
        const first = code(() => res.writeHead(200, list as any));
        const contentLength = (res as any)._contentLength;
        const tooLong = code(() => res.end("too long"));
        res.end("abc");
        return { first, contentLength, tooLong };
      });
      assert.deepStrictEqual(
        { status, headers, body, result },
        {
          status: "HTTP/1.1 201 Inner",
          headers: ["Content-Length: 3"],
          body: "abc",
          result: { first: thrown, contentLength: 3, tooLong: "ERR_HTTP_CONTENT_LENGTH_MISMATCH" },
        },
      );
    });
  }

  test("a value whose toString() calls writeHead() on another response: each one keeps what its own headers name", async () => {
    const { headers, body, result } = await respond(res => {
      const other = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 } as any);
      const value = {
        toString() {
          if (!other.headersSent) other.writeHead(200, { "Connection": "close", "Content-Length": "7" });
          return "a";
        },
      };
      res.writeHead(200, { "Content-Length": "2", "X-A": value as any });
      res.end("ok");
      return { own: (res as any)._contentLength, other: [(other as any)._contentLength, (other as any)._last] };
    });
    assert.deepStrictEqual(
      { headers, body, result },
      { headers: ["Content-Length: 2", "X-A: a"], body: "ok", result: { own: 2, other: [7, true] } },
    );
  });

  test("a value whose toString() ends the response: writeHead() returns", async () => {
    const { headers, body, result } = await respond(res => {
      let ended = false;
      const value = {
        toString() {
          if (!ended) {
            ended = true;
            res.end("e");
          }
          return "a";
        },
      };
      return code(() => res.writeHead(200, { "X-A": value as any }));
    });
    assert.deepStrictEqual({ headers, body, result }, { headers: ["Content-Length: 1"], body: "e", result: undefined });
  });

  // Node.js notes `close` in res._last when it reads the line, and ends the connection when the response has finished.
  for (const [name, write, sent] of [
    [
      "a value whose toString() ends the response",
      (res: http.ServerResponse) => {
        const value = { toString: () => (res.writableEnded || res.end("e"), "a") };
        res.writeHead(200, { "Connection": "close", "X-A": value as any });
      },
      "e",
    ],
    [
      "a value whose toString() calls writeHead() with `close`",
      (res: http.ServerResponse) => {
        const value = { toString: () => (res.headersSent || res.writeHead(200, { Connection: "close" }), "a") };
        res.writeHead(200, { "X-A": value as any });
        res.end("e");
      },
      "1\r\ne\r\n0\r\n\r\n",
    ],
  ] as const) {
    test(`${name}: a Connection line with \`close\` still closes the connection`, async () => {
      // The request asks for keep-alive. The second request gets no answer.
      const { body, requests } = await respond(write, { request: KEEP_ALIVE, then: GET });
      assert.deepStrictEqual({ body, requests }, { body: sent, requests: 1 });
    });
  }

  test("a response that waits behind another one on its connection", async () => {
    // The second response has no socket until the first one ends.
    let first: http.ServerResponse;
    const { body } = await respond(
      (res, req) => {
        if (req.url === "/first") {
          first = res;
          return;
        }
        const value = ["a=1"];
        res.writeHead(200, ["Set-Cookie", value, "Content-Length", "3"]);
        res.end("two");
        value.push("b=2");
        first.end("one");
      },
      { request: "GET /first HTTP/1.1\r\nHost: x\r\n\r\nGET /second HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n" },
    );
    const second = body.slice(body.indexOf("HTTP/1.1"));
    assert.deepStrictEqual(
      second.split("\r\n").filter(line => line !== "" && !ADDED.test(line)),
      ["HTTP/1.1 200 OK", "Set-Cookie: a=1", "Content-Length: 3", "two"],
    );
  });
});

for (const [name, form] of forms) {
  describe(`writeHead(status, headers) with no header set before frames the body by the headers of ${name}`, () => {
    test("Content-Length, body through end()", async () => {
      const { headers, body } = await respond(res => res.writeHead(200, form("Content-Length", "2")).end("ok"));
      assert.deepStrictEqual({ headers, body }, { headers: ["Content-Length: 2"], body: "ok" });
    });

    test("Content-Length, body through write()", async () => {
      const { headers, body } = await respond(res => {
        res.writeHead(200, form("Content-Length", "2"));
        res.write("o");
        res.write("k");
        res.end();
      });
      assert.deepStrictEqual({ headers, body }, { headers: ["Content-Length: 2"], body: "ok" });
    });

    test("Transfer-Encoding: chunked", async () => {
      const { headers, body } = await respond(res =>
        res.writeHead(200, form("Transfer-Encoding", "chunked")).end("ok"),
      );
      assert.deepStrictEqual(
        { headers, body },
        { headers: ["Transfer-Encoding: chunked"], body: "2\r\nok\r\n0\r\n\r\n" },
      );
    });

    test("no framing header: writeHead() settles on chunked", async () => {
      const { headers, body } = await respond(res => res.writeHead(200, form("X-A", "1")).end("ok"));
      assert.deepStrictEqual(
        { headers, body },
        { headers: ["X-A: 1", "Transfer-Encoding: chunked"], body: "2\r\nok\r\n0\r\n\r\n" },
      );
    });

    for (const [statusCode, statusLine] of [
      [204, "HTTP/1.1 204 No Content"],
      [304, "HTTP/1.1 304 Not Modified"],
    ] as const) {
      test(`${statusCode} with Transfer-Encoding: chunked has no body and closes the connection`, async () => {
        // The request asks for keep-alive. The second request gets no answer: the connection is closed.
        const { status, all, body, requests, result } = await respond(
          res => {
            res.writeHead(statusCode, form("Transfer-Encoding", "chunked"));
            const after = { chunkedEncoding: res.chunkedEncoding, shouldKeepAlive: res.shouldKeepAlive };
            res.end();
            return after;
          },
          { request: KEEP_ALIVE, then: GET },
        );
        assert.deepStrictEqual(
          { status, headers: all.filter(line => !/^date:/i.test(line)), body, requests, result },
          {
            status: statusLine,
            headers: ["Transfer-Encoding: chunked", "Connection: close"],
            body: "",
            requests: 1,
            result: { chunkedEncoding: false, shouldKeepAlive: false },
          },
        );
      });
    }

    test("204 with Transfer-Encoding: chunked and Trailer: writeHead() throws, and the connection closes", async () => {
      const { result, requests } = await respond(
        res => {
          const thrown = [
            code(() => res.writeHead(204, form("Transfer-Encoding", "chunked", "Trailer", "X-T"))),
            // The failed call left no chunked encoding behind, so a Trailer with a Content-Length fails too.
            code(() => res.writeHead(200, form("Content-Length", "0", "Trailer", "X-T"))),
          ];
          res.end();
          return thrown;
        },
        { request: KEEP_ALIVE, then: GET },
      );
      assert.deepStrictEqual(
        { result, requests },
        { result: ["ERR_HTTP_TRAILER_INVALID", "ERR_HTTP_TRAILER_INVALID"], requests: 1 },
      );
    });

    test("HEAD keeps Content-Length and sends no body", async () => {
      const { headers, body } = await respond(res => res.writeHead(200, form("Content-Length", "2")).end("ok"), {
        request: HEAD,
      });
      assert.deepStrictEqual({ headers, body }, { headers: ["Content-Length: 2"], body: "" });
    });

    test("Connection: close closes the connection", async () => {
      const { all, requests } = await respond(
        res => res.writeHead(200, form("Connection", "close", "Content-Length", "2")).end("ok"),
        { request: KEEP_ALIVE, then: GET },
      );
      assert.deepStrictEqual(
        { headers: all.filter(line => !/^date:/i.test(line)), requests },
        { headers: ["Connection: close", "Content-Length: 2"], requests: 1 },
      );
    });

    test("Connection: keep-alive leaves the connection open", async () => {
      const { all, requests } = await respond(
        res => res.writeHead(200, form("Connection", "keep-alive", "Content-Length", "2")).end("ok"),
        { request: KEEP_ALIVE, then: GET },
      );
      assert.deepStrictEqual(
        { headers: all.filter(line => !/^date:/i.test(line)), requests },
        { headers: ["Connection: keep-alive", "Content-Length: 2"], requests: 2 },
      );
    });

    test("Connection: keep-alive after res.shouldKeepAlive = false leaves the connection open", async () => {
      const { all, requests, result } = await respond(
        res => {
          res.shouldKeepAlive = false;
          res.writeHead(200, form("Connection", "keep-alive", "Content-Length", "2"));
          const shouldKeepAlive = res.shouldKeepAlive;
          res.end("ok");
          return shouldKeepAlive;
        },
        { request: KEEP_ALIVE, then: GET },
      );
      assert.deepStrictEqual(
        { headers: all.filter(line => !/^date:/i.test(line)), requests, shouldKeepAlive: result },
        { headers: ["Connection: keep-alive", "Content-Length: 2"], requests: 2, shouldKeepAlive: true },
      );
    });

    test('Connection: keep-alive answers an HTTP/1.0 keep-alive request on emit("connection")', async () => {
      const { all, body, requests } = await respond(
        res => res.writeHead(200, form("Connection", "keep-alive", "Content-Length", "2")).end("ok"),
        { request: HTTP_1_0_KEEP_ALIVE, then: GET, transport: transports[3] },
      );
      assert.deepStrictEqual(
        {
          headers: all.filter(line => !/^date:/i.test(line)),
          second: body.startsWith("okHTTP/1.1 200 OK\r\n"),
          requests,
        },
        { headers: ["Connection: keep-alive", "Content-Length: 2"], second: true, requests: 2 },
      );
    });

    test("two spellings of Connection: `close` in one of them closes the connection", async () => {
      const { all, requests } = await respond(
        res =>
          res.writeHead(200, form("Connection", "close", "connection", "keep-alive", "Content-Length", "2")).end("ok"),
        { request: KEEP_ALIVE, then: GET },
      );
      assert.deepStrictEqual(
        { headers: all.filter(line => !/^date:/i.test(line)), requests },
        { headers: ["Connection: close", "connection: keep-alive", "Content-Length: 2"], requests: 1 },
      );
    });

    test("two spellings of Content-Length are two lines, and the last one is res._contentLength", async () => {
      const { headers, body, result } = await respond(res => {
        res.writeHead(200, form("Content-Length", "2", "content-length", "5"));
        const contentLength = (res as any)._contentLength;
        res.end("ok");
        return contentLength;
      });
      assert.deepStrictEqual(
        { headers, body, result },
        { headers: ["Content-Length: 2", "content-length: 5"], body: "ok", result: 5 },
      );
    });

    test("Keep-Alive replaces the Keep-Alive of the server", async () => {
      const { all, requests, result } = await respond(
        res => {
          res.writeHead(200, form("Keep-Alive", "timeout=7", "Content-Length", "2"));
          const defaultKeepAlive = (res as any)._defaultKeepAlive;
          res.end("ok");
          return defaultKeepAlive;
        },
        { request: KEEP_ALIVE, then: GET },
      );
      assert.deepStrictEqual(
        { headers: all.filter(line => !/^date:/i.test(line)), requests, result },
        {
          headers: ["Keep-Alive: timeout=7", "Content-Length: 2", "Connection: keep-alive"],
          requests: 2,
          result: false,
        },
      );
    });

    test("Content-Length with res.useChunkedEncodingByDefault off leaves the connection open", async () => {
      const { all, requests } = await respond(
        res => {
          res.useChunkedEncodingByDefault = false;
          res.writeHead(200, form("Content-Length", "2")).end("ok");
        },
        { request: KEEP_ALIVE, then: GET },
      );
      assert.deepStrictEqual(
        { headers: all.filter(line => !/^date:/i.test(line)), requests },
        { headers: ["Content-Length: 2", "Connection: keep-alive", "Keep-Alive: timeout=5"], requests: 2 },
      );
    });

    test("Transfer-Encoding: chunked with res.useChunkedEncodingByDefault off frames the body", async () => {
      const { all, body, requests } = await respond(
        res => {
          res.useChunkedEncodingByDefault = false;
          res.writeHead(200, form("Transfer-Encoding", "chunked")).end("ok");
        },
        { request: KEEP_ALIVE, then: GET },
      );
      assert.deepStrictEqual(
        { headers: all.filter(line => !/^date:/i.test(line)), body, requests },
        {
          headers: ["Transfer-Encoding: chunked", "Connection: close"],
          body: "2\r\nok\r\n0\r\n\r\n",
          requests: 1,
        },
      );
    });

    test("Transfer-Encoding: chunked with Trailer sends the trailers", async () => {
      const { headers, body } = await respond(res => {
        res.writeHead(200, form("Transfer-Encoding", "chunked", "Trailer", "X-T"));
        res.addTrailers({ "X-T": "t" });
        res.end("ok");
      });
      assert.deepStrictEqual(
        { headers, body },
        { headers: ["Transfer-Encoding: chunked", "Trailer: X-T"], body: "2\r\nok\r\n0\r\nX-T: t\r\n\r\n" },
      );
    });

    test("Trailer alone sends the trailers", async () => {
      const { headers, body } = await respond(res => {
        res.writeHead(200, form("Trailer", "X-T"));
        res.addTrailers({ "X-T": "t" });
        res.end("ok");
      });
      assert.deepStrictEqual(
        { headers, body },
        { headers: ["Trailer: X-T", "Transfer-Encoding: chunked"], body: "2\r\nok\r\n0\r\nX-T: t\r\n\r\n" },
      );
    });

    test("Content-Length drops the trailers of addTrailers(), before or after writeHead()", async () => {
      const replies: unknown[] = [];
      for (const before of [true, false]) {
        const { headers, body, result } = await respond(res => {
          if (before) res.addTrailers({ "X-T": "t" });
          const thrown = code(() => res.writeHead(200, form("Content-Length", "2")));
          if (!before) res.addTrailers({ "X-T": "t" });
          res.end("ok");
          return thrown;
        });
        replies.push({ headers, body, result });
      }
      const dropped = { headers: ["Content-Length: 2"], body: "ok", result: undefined };
      assert.deepStrictEqual(replies, [dropped, dropped]);
    });

    const trailerCases: [when: string, status: number, list: string[], request: string, throws: boolean][] = [
      ["with Content-Length", 200, ["Content-Length", "2", "Trailer", "X-T"], GET, true],
      ["with a Transfer-Encoding that is not chunked", 200, ["Transfer-Encoding", "gzip", "Trailer", "X-T"], GET, true],
      ["with Transfer-Encoding: chunked on a 204", 204, ["Transfer-Encoding", "chunked", "Trailer", "X-T"], GET, true],
      ["alone on a 204", 204, ["Trailer", "X-T"], GET, true],
      ["alone on a HEAD request", 200, ["Trailer", "X-T"], HEAD, true],
      ["alone on an HTTP/1.0 request", 200, ["Trailer", "X-T"], HTTP_1_0, true],
      [
        "with Transfer-Encoding: chunked on a HEAD request",
        200,
        ["Transfer-Encoding", "chunked", "Trailer", "X-T"],
        HEAD,
        false,
      ],
    ];
    for (const [when, status, list, request, throws] of trailerCases) {
      test(`Trailer ${when}: writeHead() ${throws ? "throws" : "does not throw"}`, async () => {
        const { result } = await respond(
          res => {
            const thrown = code(() => res.writeHead(status, form(...list)));
            res.end();
            return thrown;
          },
          { request },
        );
        assert.strictEqual(result, throws ? "ERR_HTTP_TRAILER_INVALID" : undefined);
      });
    }

    test("Trailer alone after removeHeader('Transfer-Encoding'): writeHead() throws", async () => {
      const { result } = await respond(res => {
        res.removeHeader("Transfer-Encoding");
        const thrown = code(() => res.writeHead(200, form("Trailer", "X-T")));
        res.end();
        return thrown;
      });
      assert.strictEqual(result, "ERR_HTTP_TRAILER_INVALID");
    });

    test("strictContentLength checks end() against Content-Length", async () => {
      const { result } = await respond(res => {
        res.strictContentLength = true;
        res.writeHead(200, form("Content-Length", "2"));
        const thrown = code(() => res.end("too long"));
        res.destroy();
        return thrown;
      });
      assert.strictEqual(result, "ERR_HTTP_CONTENT_LENGTH_MISMATCH");
    });

    test("strictContentLength checks write() against Content-Length", async () => {
      const { result } = await respond(res => {
        res.strictContentLength = true;
        res.writeHead(200, form("Content-Length", "2"));
        const thrown = [code(() => res.write("ok")), code(() => res.write("!"))];
        res.destroy();
        return thrown;
      });
      assert.deepStrictEqual(result, [undefined, "ERR_HTTP_CONTENT_LENGTH_MISMATCH"]);
    });

    test("strictContentLength does not check a chunked body", async () => {
      const { result } = await respond(res => {
        res.strictContentLength = true;
        res.writeHead(200, form("Content-Length", "2", "Transfer-Encoding", "chunked"));
        const thrown = code(() => res.end("longer"));
        res.destroy();
        return thrown;
      });
      assert.strictEqual(result, undefined);
    });

    test("strictContentLength checks a body with a Transfer-Encoding that is not chunked", async () => {
      const { result } = await respond(res => {
        res.strictContentLength = true;
        res.writeHead(200, form("Content-Length", "2", "Transfer-Encoding", "gzip"));
        const thrown = code(() => res.end("too long"));
        res.destroy();
        return thrown;
      });
      assert.strictEqual(result, "ERR_HTTP_CONTENT_LENGTH_MISMATCH");
    });

    for (const length of ["abc", NaN]) {
      // No write() is more than NaN, and no end() is equal to it.
      test(`strictContentLength: a Content-Length of ${JSON.stringify(String(length))} does not fail write() and fails end()`, async () => {
        const results: unknown[] = [];
        for (const body of [
          (res: http.ServerResponse) => [code(() => res.write("ok")), code(() => res.end("x"))],
          (res: http.ServerResponse) => [code(() => res.end())],
        ]) {
          const { result } = await respond(res => {
            res.strictContentLength = true;
            res.writeHead(200, form("Content-Length", length));
            const thrown = body(res);
            res.destroy();
            return thrown;
          });
          results.push(result);
        }
        assert.deepStrictEqual(results, [
          [undefined, "ERR_HTTP_CONTENT_LENGTH_MISMATCH"],
          ["ERR_HTTP_CONTENT_LENGTH_MISMATCH"],
        ]);
      });
    }

    test("strictContentLength does not check the next head against the Content-Length of a failed call", async () => {
      const { headers, body, result } = await respond(res => {
        res.strictContentLength = true;
        const thrown = [code(() => res.writeHead(200, form("Content-Length", "100", "X-B", "a\nb")))];
        res.setHeader("Content-Length", 3);
        thrown.push(
          code(() => res.write("a")),
          code(() => res.end("bc")),
        );
        if (thrown[2]) res.destroy();
        return thrown;
      });
      assert.deepStrictEqual(
        { headers, body, result },
        { headers: ["Content-Length: 3"], body: "abc", result: ["ERR_INVALID_CHAR", undefined, undefined] },
      );
    });

    test("strictContentLength: end() ends the response after a failed call with a Content-Length that is not a number", async () => {
      const { headers, body, result } = await respond(res => {
        res.strictContentLength = true;
        const thrown = [code(() => res.writeHead(200, form("Content-Length", "abc", "X-B", "a\nb")))];
        thrown.push(code(() => res.end()));
        if (thrown[1]) res.destroy();
        return thrown;
      });
      assert.deepStrictEqual(
        { headers, body, result },
        { headers: ["Content-Length: 0"], body: "", result: ["ERR_INVALID_CHAR", undefined] },
      );
    });

    test("a response that waits behind another one does not count a header that a value's toString() sets", async () => {
      // That header is stored and not sent.
      let first: http.ServerResponse;
      const lengths: Record<string, number> = {};
      await respond(
        (res, req) => {
          if (req.url === "/first") {
            first = res;
            return;
          }
          if (req.url === "/last") {
            res.end();
            first.end();
            return;
          }
          const value = {
            toString() {
              if (req.url === "/late" && !res.hasHeader("X-Late")) res.setHeader("X-Late", "not sent");
              return "1";
            },
          };
          res.writeHead(200, form("X-A", value));
          res.write("ok");
          lengths[req.url!] = res.writableLength;
          res.end();
        },
        {
          request:
            "GET /first HTTP/1.1\r\nHost: x\r\n\r\n" +
            "GET /plain HTTP/1.1\r\nHost: x\r\n\r\n" +
            "GET /late HTTP/1.1\r\nHost: x\r\n\r\n" +
            "GET /last HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
        },
      );
      assert.deepStrictEqual(
        { same: lengths["/late"] === lengths["/plain"], counted: lengths["/plain"] > 2 },
        { same: true, counted: true },
      );
    });

    test("write() counts the same bytes as with setHeader()", async () => {
      // A body with a Content-Length has no chunk framing to count.
      const lengths: number[] = [];
      for (const inArgument of [true, false]) {
        await respond(res => {
          if (inArgument) res.writeHead(200, form("Content-Length", "4"));
          else res.setHeader("Content-Length", "4").writeHead(200);
          res.write("ab");
          lengths.push(res.writableLength);
          res.end("cd");
        });
      }
      assert.strictEqual(lengths[0], lengths[1]);
    });

    for (const [what, list] of [
      ["Content-Length", ["X-A", "1", "Content-Length", "2"]],
      ["Transfer-Encoding", ["Transfer-Encoding", "chunked"]],
      ["Date and Connection", ["Date", "Mon, 01 Jan 2024 00:00:00 GMT", "Connection", "keep-alive"]],
    ] as const) {
      test(`a response that waits behind another one counts the same bytes as with setHeader(): ${what}`, async () => {
        // It has no socket yet, so its head and its body are counted as buffered.
        let first: http.ServerResponse;
        const lengths: Record<string, number> = {};
        await respond(
          (res, req) => {
            if (req.url === "/first") {
              first = res;
              return;
            }
            if (req.url === "/last") {
              res.end();
              first.end();
              return;
            }
            if (req.url === "/argument") {
              res.writeHead(200, form(...list));
            } else {
              for (let i = 0; i < list.length; i += 2) res.setHeader(list[i], list[i + 1]);
              res.writeHead(200);
            }
            res.write("ok");
            lengths[req.url!] = res.writableLength;
            res.end();
          },
          {
            request:
              "GET /first HTTP/1.1\r\nHost: x\r\n\r\n" +
              "GET /argument HTTP/1.1\r\nHost: x\r\n\r\n" +
              "GET /setHeader HTTP/1.1\r\nHost: x\r\n\r\n" +
              "GET /last HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
          },
        );
        assert.deepStrictEqual(
          { same: lengths["/argument"] === lengths["/setHeader"], counted: lengths["/argument"] > 2 },
          { same: true, counted: true },
        );
      });
    }
  });
}

for (const transport of transports) {
  describe(`writeHead(status, headers) with no header set before frames the body on ${transport.name}`, () => {
    test("Transfer-Encoding: chunked", async () => {
      const { headers, body } = await respond(res => res.writeHead(200, { "Transfer-Encoding": "chunked" }).end("ok"), {
        transport,
      });
      assert.deepStrictEqual(
        { headers, body },
        { headers: ["Transfer-Encoding: chunked"], body: "2\r\nok\r\n0\r\n\r\n" },
      );
    });

    test("Content-Length, and no body for a HEAD request", async () => {
      const replies: unknown[] = [];
      for (const request of [GET, HEAD]) {
        const { headers, body } = await respond(res => res.writeHead(200, { "Content-Length": "2" }).end("ok"), {
          transport,
          request,
        });
        replies.push({ headers, body });
      }
      assert.deepStrictEqual(replies, [
        { headers: ["Content-Length: 2"], body: "ok" },
        { headers: ["Content-Length: 2"], body: "" },
      ]);
    });

    test("no framing header after removeHeader('Transfer-Encoding'): the body ends with the connection", async () => {
      const { headers, body, requests } = await respond(
        res => {
          res.removeHeader("Transfer-Encoding");
          res.writeHead(200, { "X-A": "1" }).end("ok");
        },
        { transport, request: KEEP_ALIVE },
      );
      assert.deepStrictEqual({ headers, body, requests }, { headers: ["X-A: 1"], body: "ok", requests: 1 });
    });

    test("no framing header for an HTTP/1.0 request: the body ends with the connection", async () => {
      const { headers, body } = await respond(res => res.writeHead(200, { "X-A": "1" }).end("ok"), {
        transport,
        request: HTTP_1_0,
      });
      assert.deepStrictEqual({ headers, body }, { headers: ["X-A: 1"], body: "ok" });
    });

    test("maxRequestsPerSocket: the Keep-Alive line of the server names the limit", async () => {
      const server = transport.server as http.Server;
      server.maxRequestsPerSocket = 5;
      try {
        const { all } = await respond(res => res.writeHead(200, { "Content-Length": "2" }).end("ok"), {
          transport,
          request: KEEP_ALIVE,
          then: GET,
        });
        assert.deepStrictEqual(
          all.filter(line => !/^date:/i.test(line)),
          ["Content-Length: 2", "Connection: keep-alive", "Keep-Alive: timeout=5, max=5"],
        );
      } finally {
        server.maxRequestsPerSocket = 0;
      }
    });
  });
}

describe("writeHead(status, headers) with no header set before sends no byte before the first write", () => {
  // Sends `request`, and gives the bytes that arrived by the time `until` settles and by the time the connection ends.
  async function exchange(request: string, until: Promise<unknown>) {
    const socket = net.connect(await port(shared.server), "127.0.0.1");
    let raw = "";
    socket.setEncoding("latin1");
    socket.on("data", chunk => (raw += chunk));
    socket.on("error", () => {});
    const closed = once(socket, "close");
    await once(socket, "connect");
    socket.write(request);
    await until;
    const early = raw;
    return { early, late: closed.then(() => raw) };
  }

  for (const queued of [false, true]) {
    test(queued ? "a response that waits behind another one" : "a response that has the connection", async () => {
      const waiting: http.ServerResponse[] = [];
      const { promise: headWritten, resolve } = Promise.withResolvers<void>();
      answer = (res, req) => {
        if (req.url === "/other") return res.end();
        waiting.push(res);
        if (queued && waiting.length === 1) return;
        res.writeHead(200, { "X-A": "1", "Content-Length": "2" });
        resolve();
      };
      const first = queued ? "GET /first HTTP/1.1\r\nHost: x\r\n\r\n" : "";
      const { early, late } = await exchange(
        first + GET,
        // A whole request on another connection is answered after writeHead(): bytes of this head would be here by then.
        headWritten.then(() =>
          respond(res => res.end(), { request: "GET /other HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n" }),
        ),
      );
      for (const res of waiting.reverse()) res.end("ok");
      const raw = await late;
      assert.deepStrictEqual(
        {
          early,
          replies: raw.split("HTTP/1.1 200 OK").length - 1,
          last: raw.slice(raw.lastIndexOf("HTTP/1.1")).includes("X-A: 1"),
        },
        { early: "", replies: queued ? 2 : 1, last: true },
      );
    });
  }
});

describe("writeHead(status, headers) with no header set before checks each name and value as Node.js does", () => {
  // The three expressions of Node.js: https://github.com/nodejs/node/blob/v26.3.0/lib/_http_common.js#L205-L227
  const tokenRegExp = /^[\^_`a-zA-Z\-0-9!#$%&'*+.|~]+$/;
  const strictHeaderCharRegex = /[^\t\x20-\x7e\x80-\xff]/;
  // eslint-disable-next-line no-control-regex
  const lenientHeaderCharRegex = /[\x00\x0a\x0d]|[^\x00-\xff]/;
  // Every byte, and three code units above a byte.
  const units = [...Array(256).keys(), 0x100, 0x2028, 0xffff].map(unit => String.fromCharCode(unit));

  // Each candidate goes in front of an entry that is always refused, so every call throws and the response stays as it was.
  // The code of the error tells which of the two entries was refused.
  async function refused(transport: Transport, candidates: [name: string, value: string][]) {
    const { result } = await respond(
      res => {
        const codes = candidates.map(([name, value]) =>
          code(() => res.writeHead(200, [name, value, "X-End", undefined] as any)),
        );
        res.end();
        return codes;
      },
      { transport },
    );
    return (result as string[]).map(thrown => thrown !== "ERR_HTTP_INVALID_HEADER_VALUE");
  }

  // A character inside a value, inside a value that is a 16-bit string, and as the whole value.
  const values = units.flatMap(unit => [`a${unit}b`, wide(`a${unit}b`), unit]);
  for (const [rule, expression, options] of [
    ["the strict rule", strictHeaderCharRegex, {}],
    ["the rule of insecureHTTPParser", lenientHeaderCharRegex, { insecureHTTPParser: true }],
  ] as const) {
    test(`a value: ${rule}`, async () => {
      const got = await refused(
        plain(options),
        values.map(value => ["X-A", value]),
      );
      const wrong = values.filter((value, i) => got[i] !== expression.test(value)).map(value => JSON.stringify(value));
      assert.deepStrictEqual(wrong, []);
    });
  }

  test("a name", async () => {
    const names = units.flatMap(unit => [`x${unit}y`, wide(`x${unit}y`), unit]);
    const got = await refused(
      shared,
      names.map(name => [name, "1"]),
    );
    const wrong = names.filter((name, i) => got[i] !== !tokenRegExp.test(name)).map(name => JSON.stringify(name));
    assert.deepStrictEqual(wrong, []);
  });
});

describe("writeHead(status, headers) with no header set before keeps nothing when it throws", () => {
  const unprintable = {
    valueOf() {
      throw new RangeError("valueOf");
    },
  };
  for (const [name, headers, expected] of [
    ["an invalid name in an object", { "X-A": "1", "bad name": "1" }, "ERR_INVALID_HTTP_TOKEN"],
    ["an invalid name in a flat list", ["X-A", "1", "bad name", "1"], "ERR_INVALID_HTTP_TOKEN"],
    ["an invalid name in a list of pairs", pairs("X-A", "1", "bad name", "1"), "ERR_INVALID_HTTP_TOKEN"],
    ["an empty name in an object", { "X-A": "1", "": "1" }, "ERR_INVALID_HTTP_TOKEN"],
    ["an empty name in a flat list", ["X-A", "1", "", "1"], "ERR_INVALID_HTTP_TOKEN"],
    ["an empty name in a list of pairs", pairs("X-A", "1", "", "1"), "ERR_INVALID_HTTP_TOKEN"],
    ["a name that is null in a flat list", ["X-A", "1", null, "1"], "ERR_INVALID_HTTP_TOKEN"],
    ["an entry that is false in a list of pairs", [["X-A", "1"], false], "ERR_INVALID_HTTP_TOKEN"],
    ["an entry that is undefined in a list of pairs", [["X-A", "1"], undefined], "TypeError"],
    ["an undefined value in an object", { "X-A": "1", "X-U": undefined }, "ERR_HTTP_INVALID_HEADER_VALUE"],
    ["an undefined value in a flat list", ["X-A", "1", "X-U", undefined], "ERR_HTTP_INVALID_HEADER_VALUE"],
    ["an invalid character in a value", ["X-A", "1", "X-B", "a\r\nb"], "ERR_INVALID_CHAR"],
    ["an invalid character after a Content-Length", { "Content-Length": 100, "X-B": "a\nb" }, "ERR_INVALID_CHAR"],
    ["an invalid character in an array value", ["X-A", "1", "X-B", ["ok", "a\nb"]], "ERR_INVALID_CHAR"],
    [
      "an invalid character in a Cookie value that is joined",
      { "X-A": "1", "Cookie": ["ok", "a\nb"] },
      "ERR_INVALID_CHAR",
    ],
    ["a value whose valueOf() throws", { "X-A": "1", "X-B": unprintable }, "RangeError"],
    ["a flat list with an odd count", ["X-A", "1", "X-B"], "ERR_INVALID_ARG_VALUE"],
    ["a Proxy of a flat list with an odd count", new Proxy(["X-A", "1", "X-B"], {}), "ERR_INVALID_ARG_VALUE"],
    ["a name that is a Symbol in a flat list", ["X-A", "1", Symbol("s"), "1"], "ERR_INVALID_HTTP_TOKEN"],
    // eslint-disable-next-line no-sparse-arrays
    ["a name that is a hole in a flat list", ["X-A", "1", , "1"], "ERR_INVALID_HTTP_TOKEN"],
    // eslint-disable-next-line no-sparse-arrays
    ["a hole in an array value", ["X-A", "1", "X-B", ["1", , "3"]], "ERR_HTTP_INVALID_HEADER_VALUE"],
    ["a value that is a Symbol", ["X-A", "1", "X-B", Symbol("s")], "TypeError"],
    ["a Content-Length that is a BigInt", { "X-A": "1", "Content-Length": 2n }, "TypeError"],
    ["a character above 0xff in a value", { "X-A": "1", "X-B": "\u0100" }, "ERR_INVALID_CHAR"],
    ["DEL in a value", { "X-A": "1", "X-B": "a\u007fb" }, "ERR_INVALID_CHAR"],
    ["NUL in a value", { "X-A": "1", "X-B": "a\u0000b" }, "ERR_INVALID_CHAR"],
    ["a character above 0x7f in a name", { "X-A": "1", "X-\u00e9": "1" }, "ERR_INVALID_HTTP_TOKEN"],
    ["Content-Length with Trailer", ["X-A", "1", "Content-Length", "2", "Trailer", "X-T"], "ERR_HTTP_TRAILER_INVALID"],
  ] as const) {
    test(name, async () => {
      const {
        headers: sent,
        body,
        result,
      } = await respond(res => {
        const thrown = code(() => res.writeHead(200, headers as any));
        const after = { thrown, headersSent: res.headersSent, stored: res.getHeaderNames() };
        res.end("ok");
        return after;
      });
      // The response that follows has none of the headers of the failed call.
      assert.deepStrictEqual(
        { sent, body, result },
        { sent: ["Content-Length: 2"], body: "ok", result: { thrown: expected, headersSent: false, stored: [] } },
      );
    });
  }

  test("the messages of the errors", async () => {
    const { result } = await respond(res => {
      const messages = [
        message(() => res.writeHead(200, [{}, "1"] as any)),
        message(() => res.writeHead(200, [Symbol("s"), "1"] as any)),
        message(() => res.writeHead(200, [Symbol(), "1"] as any)),
        message(() => res.writeHead(200, [null, "1"] as any)),
        message(() => res.writeHead(200, [-0, "1"] as any)),
        message(() => res.writeHead(200, [5n, "1"] as any)),
        message(() => res.writeHead(200, [{ toString: () => "X-T" }, "1"] as any)),
        message(() => res.writeHead(200, [new (class Name {})(), "1"] as any)),
        message(() => res.writeHead(200, [function f() {}, "1"] as any)),
        message(() => res.writeHead(200, { "bad name": "1" })),
        message(() => res.writeHead(200, ["X-U", undefined] as any)),
        message(() => res.writeHead(200, ["X-B", "a\nb"])),
        message(() => res.writeHead(200, ["X-A", "1"]).writeHead(200, ["X-B", "2"])),
      ];
      res.end();
      return messages;
    });
    assert.deepStrictEqual(result, [
      'Header name must be a valid HTTP token ["{}"]',
      'Header name must be a valid HTTP token ["Symbol(s)"]',
      'Header name must be a valid HTTP token ["Symbol()"]',
      'Header name must be a valid HTTP token ["null"]',
      'Header name must be a valid HTTP token ["-0"]',
      'Header name must be a valid HTTP token ["5n"]',
      'Header name must be a valid HTTP token ["X-T"]',
      'Header name must be a valid HTTP token ["Name {}"]',
      'Header name must be a valid HTTP token ["function f() {}"]',
      'Header name must be a valid HTTP token ["bad name"]',
      'Invalid value "undefined" for header "X-U"',
      'Invalid character in header content ["X-B"]',
      "Cannot write headers after they are sent to the client",
    ]);
  });

  for (const [name, form] of forms) {
    // What the entries before the failure said about the connection stays.
    for (const [connection, requests] of [
      ["close", 1],
      ["keep-alive", 2],
    ] as const) {
      test(`${name}: the connection ${requests === 1 ? "closes" : "stays open"} after \`${connection}\` in a Connection line before the failure`, async () => {
        const reply = await respond(
          res => {
            const thrown = code(() => res.writeHead(200, form("Connection", connection, "X-B", "a\nb")));
            res.end("ok");
            return thrown;
          },
          { request: KEEP_ALIVE, then: GET },
        );
        assert.deepStrictEqual(
          {
            headers: reply.headers,
            body: reply.body.slice(0, 2),
            result: reply.result,
            requests: reply.requests,
          },
          { headers: ["Content-Length: 2"], body: "ok", result: "ERR_INVALID_CHAR", requests },
        );
      });
    }
  }
});

describe("addTrailers() before writeHead(status, headers) is not a Trailer header", () => {
  // Node.js discards the trailers of a response that is not chunked. Only a Trailer header makes writeHead() throw.
  const cases: [name: string, head: (res: http.ServerResponse) => unknown, reply: object][] = [
    [
      "writeHead(200, { Content-Length })",
      res => res.writeHead(200, { "Content-Length": 2 }),
      { headers: ["Content-Length: 2"], body: "ok" },
    ],
    ["writeHead(304, { ETag })", res => res.writeHead(304, { ETag: "x" }), { headers: ["ETag: x"], body: "" }],
    ["writeHead(204, { X-A })", res => res.writeHead(204, { "X-A": "1" }), { headers: ["X-A: 1"], body: "" }],
  ];
  for (const [name, head, reply] of cases) {
    test(name, async () => {
      const { headers, body, result } = await respond(res => {
        res.addTrailers({ "X-T": "t" });
        const thrown = code(() => head(res));
        res.end(res.statusCode === 200 ? "ok" : undefined);
        return thrown;
      });
      assert.deepStrictEqual({ thrown: result, headers, body }, { thrown: undefined, ...reply });
    });
  }
});

describe("where Bun still differs from Node.js after writeHead(status, headers)", () => {
  // The framing of a body by the value of Transfer-Encoding: https://github.com/oven-sh/bun/pull/33871
  differs("Transfer-Encoding: identity does not frame the body", async () => {
    const { headers, body } = await respond(res => res.writeHead(200, { "Transfer-Encoding": "identity" }).end("ok"));
    assert.deepStrictEqual({ headers, body }, { headers: ["Transfer-Encoding: identity"], body: "ok" });
  });

  differs("Transfer-Encoding: chunked frames the body for an HTTP/1.0 request", async () => {
    const { headers, body } = await respond(res => res.writeHead(200, { "Transfer-Encoding": "chunked" }).end("ok"), {
      request: HTTP_1_0,
    });
    assert.deepStrictEqual(
      { headers, body },
      { headers: ["Transfer-Encoding: chunked"], body: "2\r\nok\r\n0\r\n\r\n" },
    );
  });

  differs("Transfer-Encoding: chunked with a Content-Length frames the body", async () => {
    const { headers, body } = await respond(res =>
      res.writeHead(200, { "Content-Length": "2", "Transfer-Encoding": "chunked" }).end("ok"),
    );
    assert.deepStrictEqual(
      { headers, body },
      { headers: ["Content-Length: 2", "Transfer-Encoding: chunked"], body: "2\r\nok\r\n0\r\n\r\n" },
    );
  });

  // An HTTP/1.0 keep-alive connection on a socket that the server accepted: https://github.com/oven-sh/bun/pull/44321
  differs("Connection: keep-alive answers an HTTP/1.0 keep-alive request", async () => {
    const { requests } = await respond(
      res => res.writeHead(200, { "Connection": "keep-alive", "Content-Length": "2" }).end("ok"),
      { request: HTTP_1_0_KEEP_ALIVE, then: GET },
    );
    assert.strictEqual(requests, 2);
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, bunExe, nodeExe } = await import("harness");
  const node = nodeExe();

  describe("Bun only", () => {
    // Bun gives the result of its walk through a Float64Array of the engine, not of the global that a program can replace.
    test("a program that replaced globalThis.Float64Array", async () => {
      const program = `
        globalThis.Float64Array = function () { return [0, 0]; };
        const http = require("node:http");
        const res = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 });
        res.sendDate = false;
        res.writeHead(200, { "Content-Length": 2, "X-A": "1" });
        console.log(JSON.stringify(res._header));
      `;
      await using child = Bun.spawn({ cmd: [bunExe(), "-e", program], env: bunEnv, stdout: "pipe", stderr: "inherit" });
      const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
      assert.deepStrictEqual(
        { stdout, exitCode },
        {
          stdout:
            JSON.stringify("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nX-A: 1\r\nConnection: keep-alive\r\n\r\n") + "\n",
          exitCode: 0,
        },
      );
    });

    // Node.js keeps what the lines before the failure set. Its next head has `Content-Length: 100` and no Keep-Alive line.
    for (const [when, bad, thrown] of [
      ["in the walk", ["X-Bad", "a\nb"], "ERR_INVALID_CHAR"],
      ["after the walk", ["Trailer", "X-T"], "ERR_HTTP_TRAILER_INVALID"],
    ] as const) {
      test(`after a writeHead() that throws ${when}, the next head has nothing of the failed call`, async () => {
        const { all, body, result } = await respond(
          res => {
            res.strictContentLength = true;
            const first = code(() => res.writeHead(200, ["Content-Length", "100", "Keep-Alive", "timeout=9", ...bad]));
            const contentLength = (res as any)._contentLength;
            res.write("a");
            res.end("b");
            return { first, contentLength };
          },
          { request: KEEP_ALIVE, then: GET },
        );
        assert.deepStrictEqual(
          // The reply to the second request comes behind the body.
          { headers: all.filter(line => !/^date:/i.test(line)), body: body.split("HTTP/1.1")[0], result },
          {
            headers: ["Connection: keep-alive", "Keep-Alive: timeout=5", "Transfer-Encoding: chunked"],
            body: "1\r\na\r\n1\r\nb\r\n0\r\n\r\n",
            result: { first: thrown, contentLength: null },
          },
        );
      });
    }

    // V8 says: Cannot read properties of undefined (reading '0').
    test("an entry of a list of pairs that is undefined or null: the TypeError names the entry", async () => {
      const { result } = await respond(res => {
        const messages = [
          message(() => res.writeHead(200, [["X-A", "1"], undefined] as any)),
          message(() => res.writeHead(200, [["X-A", "1"], null] as any)),
        ];
        res.end();
        return messages;
      });
      assert.deepStrictEqual(result, [
        "undefined is not an object (evaluating 'entry[0]')",
        "null is not an object (evaluating 'entry[0]')",
      ]);
    });

    // Node.js has no setter for headersSent.
    test("res.headersSent = false makes the headers of writeHead() changeable again", async () => {
      const { headers, result } = await respond(res => {
        res.writeHead(200, ["X-D", "1", "X-A", "q", "X-D", "2"]);
        (res as any).headersSent = false;
        const after = stored(res);
        res.setHeader("X-A", "changed");
        res.end();
        return after;
      });
      assert.deepStrictEqual(
        { headers, result },
        {
          headers: ["X-D: 1", "X-D: 2", "X-A: changed", "Transfer-Encoding: chunked"],
          result: {
            names: ["x-d", "x-a"],
            rawNames: ["X-D", "X-A"],
            headers: { "x-d": ["1", "2"], "x-a": "q" },
            has: true,
            get: "q",
          },
        },
      );
    });

    test("res.headersSent = false after end() leaves the headers of writeHead() alone", async () => {
      const { headers, result } = await respond(res => {
        res.writeHead(200, ["X-D", "1", "X-A", "q", "X-D", "2"]).end();
        const thrown = code(() => ((res as any).headersSent = false));
        return { thrown, stored: res.getHeaderNames() };
      });
      assert.deepStrictEqual(
        { headers, result },
        {
          headers: ["X-D: 1", "X-A: q", "X-D: 2", "Transfer-Encoding: chunked"],
          result: { thrown: undefined, stored: [] },
        },
      );
    });

    test("res.headersSent = true, then false, makes the headers of writeHead() changeable too", async () => {
      const { headers } = await respond(res => {
        res.writeHead(200, { "X-A": "1" });
        (res as any).headersSent = true;
        (res as any).headersSent = false;
        res.setHeader("X-B", "2");
        res.end();
      });
      assert.deepStrictEqual(headers, ["X-A: 1", "X-B: 2", "Transfer-Encoding: chunked"]);
    });

    // Node.js throws from end() here. A response that waits is written later, where a throw has no caller.
    for (const [name, headers] of [
      ["a Content-Length that is not a number", { "Content-Length": "abc" }],
      ["a Transfer-Encoding that is not chunked", { "Content-Length": "2", "Transfer-Encoding": "gzip" }],
    ] as const) {
      test(`strictContentLength does not check ${name} on a response that waits behind another one`, async () => {
        let first: http.ServerResponse;
        let thrown: unknown;
        const { body } = await respond(
          (res, req) => {
            if (req.url === "/first") {
              first = res;
              return;
            }
            res.strictContentLength = true;
            res.writeHead(200, headers);
            thrown = [code(() => res.write("too ")), code(() => res.end("long"))];
            first.end("one");
          },
          {
            request:
              "GET /first HTTP/1.1\r\nHost: x\r\n\r\nGET /second HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
          },
        );
        assert.deepStrictEqual(
          { thrown, second: body.includes("HTTP/1.1 200 OK\r\n") },
          { thrown: [undefined, undefined], second: true },
        );
      });
    }

    test("res.headersSent = false: strictContentLength checks a body again after Transfer-Encoding is removed", async () => {
      const { result } = await respond(res => {
        res.strictContentLength = true;
        res.writeHead(200, { "Transfer-Encoding": "chunked" });
        (res as any).headersSent = false;
        res.removeHeader("Transfer-Encoding");
        res.setHeader("Content-Length", 3);
        const thrown = code(() => res.end("too long"));
        res.destroy();
        return thrown;
      });
      assert.strictEqual(result, "ERR_HTTP_CONTENT_LENGTH_MISMATCH");
    });

    test("res.headersSent = false: strictContentLength checks the Content-Length of the header store", async () => {
      const { headers, body, result } = await respond(res => {
        res.strictContentLength = true;
        res.writeHead(200, { "Content-Length": 5 });
        (res as any).headersSent = false;
        res.setHeader("Content-Length", 2);
        const thrown = code(() => res.end("ok"));
        if (thrown) res.destroy();
        return thrown;
      });
      assert.deepStrictEqual(
        { headers, body, result },
        { headers: ["Content-Length: 2"], body: "ok", result: undefined },
      );
    });

    test("a ServerResponse with no socket: writeHead() throws after res.headersSent = false, its head is rendered", () => {
      const res = new http.ServerResponse({ method: "GET", httpVersionMajor: 1, httpVersionMinor: 1 } as any);
      res.sendDate = false;
      res.writeHead(200, { "X-A": "1" });
      (res as any).headersSent = false;
      const thrown = message(() => res.writeHead(200, { "X-B": "2" }));
      assert.deepStrictEqual(
        { thrown, head: (res as any)._header },
        {
          thrown: "Cannot write headers after they are sent to the client",
          head: "HTTP/1.1 200 OK\r\nX-A: 1\r\nConnection: keep-alive\r\nTransfer-Encoding: chunked\r\n\r\n",
        },
      );
    });

    test("write() counts the chunk framing when writeHead() names no Content-Length", async () => {
      const lengths: number[] = [];
      for (const inArgument of [true, false]) {
        await respond(res => {
          if (inArgument) res.writeHead(200, { "X-A": "1" });
          else res.setHeader("X-A", "1").writeHead(200);
          res.write("ab");
          lengths.push(res.writableLength);
          res.end("cd");
        });
      }
      // "2\r\nab\r\n"
      assert.deepStrictEqual(lengths, [7, 7]);
    });

    // The getter reads the header store.
    test("res.headers has none of the headers of writeHead()", async () => {
      const { result } = await respond(res => {
        res.writeHead(200, { "X-A": "1" });
        const headers = { ...(res as any).headers };
        res.end();
        return headers;
      });
      assert.deepStrictEqual(result, {});
    });

    // Node.js sends a second head here, inside the body. A handle sends one head, so these headers cannot go out.
    for (const [name, rest] of [
      ["with an entry behind it", { "X-B": "b" }],
      ["as the last entry", {}],
    ] as const) {
      test(`a value whose toString() sends the head, ${name}: writeHead() throws, and the response can end`, async () => {
        const { headers, body, result } = await respond(res => {
          let flushed = false;
          const value = {
            toString() {
              if (!flushed) res.flushHeaders();
              flushed = true;
              return "a";
            },
          };
          let thrown: string[] | undefined;
          try {
            res.writeHead(200, { "X-A": value as any, ...rest });
          } catch (error: any) {
            thrown = [error.code, error.message];
          }
          const ended = code(() => res.end("ok"));
          if (ended) res.destroy();
          return { thrown, ended };
        });
        assert.deepStrictEqual(
          { headers, body, result },
          {
            headers: ["Transfer-Encoding: chunked"],
            body: "2\r\nok\r\n0\r\n\r\n",
            result: {
              thrown: ["ERR_HTTP_HEADERS_SENT", "Cannot write headers after they are sent to the client"],
              ended: undefined,
            },
          },
        );
      });
    }

    // writeHead() settles on chunked only when its headers name no framing.
    for (const [header, value] of [
      ["Content-Length", "2"],
      ["Transfer-Encoding", "chunked"],
    ]) {
      test(`${header} in writeHead() leaves the framing open for end(), after the headers are taken away`, async () => {
        const { headers, body } = await respond(res => {
          res.writeHead(200, { [header]: value });
          (res as any).headersSent = false;
          (res as any).headers = {};
          res.end("ok");
        });
        assert.deepStrictEqual({ headers, body }, { headers: ["Content-Length: 2"], body: "ok" });
      });
    }

    // Node.js checks what toString() gives and sends what valueOf() gives: here, a second header line.
    test("a value whose valueOf() gives a text that the check refuses: writeHead() throws", async () => {
      const { headers, body, result } = await respond(res => {
        const value = { toString: () => "ok", valueOf: () => "a\r\nX-Injected: 1" };
        const thrown = code(() => res.writeHead(200, { "X-A": value as any }));
        res.end("ok");
        return thrown;
      });
      assert.deepStrictEqual(
        { headers, body, result },
        { headers: ["Content-Length: 2"], body: "ok", result: "ERR_INVALID_CHAR" },
      );
    });

    // Node.js throws ERR_INVALID_CHAR here. The native handle writes one byte for each character.
    test("a Content-Disposition that is not ASCII, after a Content-Length, is sent", async () => {
      const { headers, body } = await respond(res =>
        res
          .writeHead(200, pairs("Content-Length", "2", "Content-Disposition", 'attachment; filename="caf\u00e9.txt"'))
          .end("ok"),
      );
      assert.deepStrictEqual(
        { headers, body },
        { headers: ["Content-Length: 2", 'Content-Disposition: attachment; filename="caf\u00e9.txt"'], body: "ok" },
      );
    });

    // end() gives the trailers of addTrailers() to the connection. With a Content-Length it must not: the connection
    // would send them behind the next body in chunks, here the body of the response that took the connection.
    test("a Content-Length in writeHead() keeps end() from sending trailers", async () => {
      let first: http.ServerResponse;
      let thrown: string | undefined;
      const { headers, body } = await respond(
        (res, req) => {
          if (req.url === "/first") {
            first = res;
            // The connection goes to the response of the next request.
            (req.socket as any)._httpMessage = null;
            return;
          }
          // The dispatcher gives the connection to this response from a tick.
          setImmediate(() => {
            thrown = code(() => {
              first.writeHead(200, { "Content-Length": 3 });
              first.addTrailers({ "X-T": "from-first" });
              first.end("one");
            });
            res.end("two");
          });
        },
        {
          request: "GET /first HTTP/1.1\r\nHost: x\r\n\r\nGET /second HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
        },
      );
      assert.deepStrictEqual(
        { thrown, headers, body },
        { thrown: undefined, headers: ["Content-Length: 3"], body: "two" },
      );
    });

    // The response of an Upgrade request, used after a WebSocket took its connection. The connection has no place for trailers then.
    test("the same after a WebSocket took the connection: end() does not write to it", async () => {
      const wss = new WebSocketServer({ noServer: true });
      const firstTrailer = Buffer.alloc(200, "a").toString();
      const { promise: ended, resolve } = Promise.withResolvers<void>();
      const server = http.createServer((req, res) => {
        res.on("error", () => {});
        if (req.url === "/first") {
          // A response with trailers, so that the connection has had a place for trailers.
          res.write("first-body");
          res.addTrailers({ "x-first": firstTrailer });
          res.end();
          return;
        }
        wss.handleUpgrade(req, req.socket, Buffer.alloc(0), ws => {
          ws.on("error", () => {});
          // Whether end() throws for a response with no connection is not the subject here.
          code(() => {
            res.writeHead(200, { "Content-Length": 4 });
            res.addTrailers({ "x-second": Buffer.alloc(100, "b").toString() });
            res.end("late");
          });
          resolve();
        });
      });
      const client = net.connect(await port(server), "127.0.0.1");
      client.on("error", () => {});
      let received = "";
      let upgradeSent = false;
      client.setEncoding("latin1");
      client.on("data", chunk => {
        received += chunk;
        if (upgradeSent || !received.endsWith(`0\r\nx-first: ${firstTrailer}\r\n\r\n`)) return;
        upgradeSent = true;
        client.write(
          "GET /second HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" +
            "Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
        );
      });
      await once(client, "connect");
      client.write("GET /first HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await ended;
      // The 101 is the last thing that the connection got: none of "late" or its trailers.
      while (!received.includes("HTTP/1.1 101 Switching Protocols\r\n")) await once(client, "data");
      const closed = once(client, "close");
      client.destroy();
      await closed;
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      assert.deepStrictEqual(
        { late: received.includes("late"), trailer: received.includes("x-second") },
        { late: false, trailer: false },
      );
    });

    // The ws module of Bun answers a refused handshake with res.writeHead(status, headers).
    test("ws refuses a handshake through the response of the request", async () => {
      const server = http.createServer();
      const wss = new WebSocketServer({ noServer: true });
      server.on("request", req => wss.handleUpgrade(req, req.socket, Buffer.alloc(0), () => {}));
      const transport = overTcp("http", server);
      const { status, all, body } = await respond(() => {}, {
        transport,
        request:
          "GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n\r\n",
      });
      assert.deepStrictEqual(
        { status, headers: all.filter(line => !/^date:/i.test(line)), body },
        {
          status: "HTTP/1.1 400 Bad Request",
          headers: ["Connection: close", "Content-Type: text/html", "Content-Length: 43"],
          body: "Missing or invalid Sec-WebSocket-Key header",
        },
      );
    });

    // new WebSocketServer({ port }) answers a request that is no handshake with res.writeHead(426, headers).
    test("ws answers a plain request to its own server", async () => {
      const wss = new WebSocketServer({ port: 0, host: "127.0.0.1" });
      await once(wss, "listening");
      const socket = net.connect((wss.address() as AddressInfo).port, "127.0.0.1");
      let raw = "";
      socket.setEncoding("latin1");
      socket.on("data", chunk => (raw += chunk));
      socket.write(GET);
      await once(socket, "close");
      wss.close();
      const end = raw.indexOf("\r\n\r\n");
      const [status, ...all] = raw.slice(0, end).split("\r\n");
      assert.deepStrictEqual(
        { status, headers: all.filter(line => !ADDED.test(line)), body: raw.slice(end + 4) },
        {
          status: "HTTP/1.1 426 Upgrade Required",
          headers: ["Content-Length: 16", "Content-Type: text/plain"],
          body: "Upgrade Required",
        },
      );
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
