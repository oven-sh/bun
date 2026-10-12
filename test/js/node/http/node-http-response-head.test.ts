/**
 * The tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js. For that, the
 * file uses node:test and node:assert, and is not a part of node-http.test.ts.
 * The tests under "only in Bun" are the exception.
 *
 * Node renders the whole head of a response inside res.writeHead(), and an
 * implicit head inside the first write() or end(). Nothing that changes after
 * that call reaches the wire:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js#L496
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L974-L981
 */
import assert from "node:assert";
import events, { once } from "node:events";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net, { type AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { duplexPair, Readable } from "node:stream";
import { describe, test } from "node:test";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const cert = readFileSync(join(fixtures, "cert.pem"), "utf8");
const key = readFileSync(join(fixtures, "cert.key"), "utf8");

const GET = (path: string, close = true) =>
  `GET ${path} HTTP/1.1\r\nHost: x\r\n${close ? "Connection: close\r\n" : ""}\r\n`;

// Writes `payload` on `socket`. Resolves with every byte that arrived before the server ended the
// connection, or before `until` arrived for a connection that stays open.
function exchange(socket: net.Socket, payload: string, until?: string) {
  return new Promise<string>((resolve, reject) => {
    let received = "";
    socket.setEncoding("latin1");
    socket.on("data", chunk => {
      received += chunk;
      if (until !== undefined && received.includes(until)) socket.destroy();
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(received));
    socket.write(payload);
  });
}

const request = (port: number, payload: string, until?: string) =>
  exchange(net.connect(port, "127.0.0.1"), payload, until);

// Gives a stream to the server as a connection, writes `payload` on the other end, and resolves with
// every byte the server sent before it ended its side, or before `until` arrived for a connection that
// stays open. Bun parses such a connection in JavaScript, like the HTTP/1.1 connections of an allowHTTP1
// HTTP/2 server.
function connectionEvent(server: http.Server, payload: string, until?: string) {
  return new Promise<string>((resolve, reject) => {
    const [client, serverSide] = duplexPair();
    let received = "";
    client.setEncoding("latin1");
    client.on("data", chunk => {
      received += chunk;
      if (until !== undefined && received.includes(until)) client.destroy();
    });
    client.on("error", reject);
    client.on("end", () => resolve(received));
    client.on("close", () => resolve(received));
    server.emit("connection", serverSide);
    client.write(payload);
  });
}

async function withServer<T>(server: net.Server, run: (port: number) => Promise<T>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    return await run((server.address() as AddressInfo).port);
  } finally {
    (server as http.Server).closeAllConnections();
    server.close();
  }
}

// The values of the header lines called `name` in the head of the response.
function headerValues(raw: string, name: string) {
  const prefix = `${name}: `;
  return raw
    .slice(0, raw.indexOf("\r\n\r\n"))
    .split("\r\n")
    .filter(line => line.toLowerCase().startsWith(prefix))
    .map(line => line.slice(prefix.length));
}

const statusLine = (raw: string) => raw.slice(0, raw.indexOf("\r\n"));
const body = (raw: string) => raw.slice(raw.indexOf("\r\n\r\n") + 4);

// The code of the error that `call` throws.
function codeOf(call: () => void) {
  try {
    call();
    return "no throw";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code;
  }
}

// One way to ask, for a server that listens and for one that takes streams.
type Ask = (payload: string, until?: string) => Promise<string>;
type Connect = (server: http.Server) => Promise<Ask>;
const transports: [string, Connect][] = [
  [
    "a TCP connection",
    async server => {
      if (!server.listening) await once(server.listen(0, "127.0.0.1"), "listening");
      return (payload, until) => request((server.address() as AddressInfo).port, payload, until);
    },
  ],
  ['a stream given to emit("connection")', async server => (payload, until) => connectionEvent(server, payload, until)],
];

// Answers one request for each row, and resolves with what `read` takes from each response. A row that
// throws gives its error in place of that, so the assertion names the row.
async function respondToEach<T>(
  rows: Record<string, (res: http.ServerResponse) => void>,
  read: (raw: string) => T,
  options: http.ServerOptions = {},
) {
  const names = Object.keys(rows);
  const thrown: Record<string, unknown> = {};
  const server = http.createServer(options, (req, res) => {
    const name = names[Number(req.url!.slice(1))];
    try {
      rows[name](res);
    } catch (error) {
      thrown[name] = error;
      res.destroy();
    }
  });
  const sent: Record<string, unknown> = {};
  await withServer(server, async port => {
    for (let i = 0; i < names.length; i++) {
      const raw = await request(port, GET(`/${i}`));
      sent[names[i]] = names[i] in thrown ? thrown[names[i]] : read(raw);
    }
  });
  return sent as Record<string, T>;
}

// A header value that is not a string: the server calls its toString() to render it.
function text(current: string) {
  return {
    current,
    toString() {
      return this.current;
    },
  };
}

// A header value that is its count of toString() calls. Node calls it once to check the value and once to render it.
function renders() {
  return {
    calls: 0,
    toString() {
      return String(++this.calls);
    },
  };
}

// A response class that calls writeHead() in its constructor, and then changes what that call read.
// On a stream, Bun gives the response its handle in the options of the constructor. A class that does not pass them
// to super(), and a response that waits, get the handle when the constructor returns: Bun renders the header values
// then, so only the class that passes the options changes a value in its constructor.
const subclasses: [string, boolean][] = [
  ["that passes its options to super()", true],
  ["that calls super(req)", false],
];
function earlyHead(passesOptions: boolean) {
  return class EarlyHead extends http.ServerResponse {
    cookies = ["a=1", "b=2"];
    constructor(req: http.IncomingMessage, options?: object) {
      // @ts-expect-error The server gives the constructor a second argument.
      super(req, passesOptions ? options : undefined);
      this.writeHead(201, "Made", { "Set-Cookie": this.cookies });
      if (passesOptions) this.cookies.push("late=1");
      this.statusCode = 500;
      this.statusMessage = "Changed";
    }
  };
}

describe("two responses that are open at once and share one array", () => {
  const forms: [string, (res: http.ServerResponse, cookies: string[]) => void][] = [
    ["writeHead(200, { name: array })", (res, cookies) => void res.writeHead(200, { "Set-Cookie": cookies })],
    [
      "setHeader(name, array); writeHead(200)",
      (res, cookies) => {
        res.setHeader("Set-Cookie", cookies);
        res.writeHead(200);
      },
    ],
  ];
  for (const [name, form] of forms) {
    test(`${name}: each user receives the value of its own writeHead()`, async () => {
      // One array for every request, like a server that keeps its list of cookies in a constant.
      const cookies = ["theme=light", ""];
      const aliceWroteHead = Promise.withResolvers<void>();
      const bobWroteHead = Promise.withResolvers<void>();
      const server = http.createServer(async (req, res) => {
        const user = req.url!.slice(1);
        cookies[1] = `sid=${user}`;
        form(res, cookies);
        if (user === "alice") {
          aliceWroteHead.resolve();
          await bobWroteHead.promise;
        } else {
          bobWroteHead.resolve();
        }
        res.end();
      });
      await withServer(server, async port => {
        // Up to the end of the head: Bun 1.3.14 leaves such a connection open.
        const alice = request(port, GET("/alice"), "\r\n\r\n");
        await Promise.race([aliceWroteHead.promise, alice]);
        const bob = request(port, GET("/bob"), "\r\n\r\n");
        assert.deepStrictEqual(
          { alice: headerValues(await alice, "set-cookie"), bob: headerValues(await bob, "set-cookie") },
          { alice: ["theme=light", "sid=alice"], bob: ["theme=light", "sid=bob"] },
        );
      });
    });
  }
});

describe("an array that changes after writeHead() is sent as it was", () => {
  // Each form gives an array of two values to the response, calls writeHead(), and returns that array.
  const values = () => ["a=1", "b=2"];
  const forms: Record<string, (res: http.ServerResponse) => string[]> = {
    "writeHead(200, { name: array })": res => {
      const array = values();
      res.writeHead(200, { "Set-Cookie": array });
      return array;
    },
    "setHeader(name, array); writeHead(200)": res => {
      const array = values();
      res.setHeader("Set-Cookie", array);
      res.writeHead(200);
      return array;
    },
    "setHeader(name, array); writeHead(200, { other })": res => {
      const array = values();
      res.setHeader("Set-Cookie", array);
      res.writeHead(200, { "X-Other": "1" });
      return array;
    },
    "setHeaders(new Map([[name, array]])); writeHead(200)": res => {
      const array = values();
      res.setHeaders(new Map([["Set-Cookie", array]]));
      res.writeHead(200);
      return array;
    },
    "appendHeader(name, value) twice; writeHead(200); the array of getHeader(name)": res => {
      res.appendHeader("Set-Cookie", "a=1");
      res.appendHeader("Set-Cookie", "b=2");
      res.writeHead(200);
      return res.getHeader("Set-Cookie") as string[];
    },
    // The shape of the on-headers package, which compression, morgan and express-session use.
    "a writeHead() replacement that calls setHeader(name, array) and then the original": res => {
      const array = values();
      const writeHead = res.writeHead;
      res.writeHead = function (this: http.ServerResponse, ...args: [number]) {
        this.setHeader("Set-Cookie", array);
        return writeHead.apply(this, args);
      } as typeof res.writeHead;
      res.writeHead(200);
      return array;
    },
    // compression calls this from its res.end(), and the body goes out later.
    "setHeader(name, array); _implicitHeader()": res => {
      const array = values();
      res.setHeader("Set-Cookie", array);
      (res as unknown as { _implicitHeader(): void })._implicitHeader();
      return array;
    },
  };
  const changes: Record<string, (array: string[]) => void> = {
    "push()": array => void array.push("late=1"),
    "an index write": array => void (array[1] = "late=1"),
    "length = 0": array => void (array.length = 0),
    // setHeader() and writeHead() refuse this value. A head that reads the array late writes it as it is.
    "a value with CR LF": array => void (array[1] = "x\r\nSet-Cookie: injected=1"),
  };
  // The call that puts the head on the socket, after the change.
  const flushes: Record<string, (res: http.ServerResponse) => void> = {
    "end()": res => void res.end("ok"),
    "write()": res => {
      res.write("o");
      res.end("k");
    },
    "flushHeaders()": res => {
      res.flushHeaders();
      res.end("ok");
    },
    "pipe()": res => void Readable.from(["ok"]).pipe(res),
  };

  for (const [name, form] of Object.entries(forms)) {
    test(name, async () => {
      const rows: Record<string, (res: http.ServerResponse) => void> = {};
      const expected: Record<string, string[]> = {};
      for (const [change, apply] of Object.entries(changes)) {
        for (const [flush, send] of Object.entries(flushes)) {
          rows[`${change}, then ${flush}`] = res => {
            apply(form(res));
            send(res);
          };
          expected[`${change}, then ${flush}`] = values();
        }
      }
      assert.deepStrictEqual(await respondToEach(rows, raw => headerValues(raw, "set-cookie")), expected);
    });
  }
});

describe("a value that is not a string is rendered inside writeHead()", () => {
  test("every kind of value", async () => {
    const sent = await respondToEach(
      {
        "an object with toString()": res => {
          const value = text("early");
          res.writeHead(200, { "X-Test": value as unknown as string });
          value.current = "late";
          res.end();
        },
        "an object with toString(), from setHeader()": res => {
          const value = text("early");
          res.setHeader("X-Test", value as unknown as string);
          res.writeHead(200);
          value.current = "late";
          res.end();
        },
        "an array of such objects": res => {
          const value = text("early");
          res.writeHead(200, { "X-Test": [value, "second"] as unknown as string[] });
          value.current = "late";
          res.end();
        },
        "an array in an array": res => {
          const inner = ["a", "b"];
          res.writeHead(200, { "X-Test": [inner, "second"] as unknown as string[] });
          inner.push("late");
          res.end();
        },
        // Node sends these two as one line, joined with "; ".
        "a Cookie array": res => {
          const array = ["a=1", "b=2"];
          res.writeHead(200, { Cookie: array });
          array.push("late=1");
          res.end();
        },
        "an array of a header in uniqueHeaders": res => {
          const array = ["a", "b"];
          res.writeHead(200, { "X-Unique": array });
          array.push("late");
          res.end();
        },
      },
      raw => [...headerValues(raw, "x-test"), ...headerValues(raw, "cookie"), ...headerValues(raw, "x-unique")],
      { uniqueHeaders: ["x-unique"] },
    );
    assert.deepStrictEqual(sent, {
      "an object with toString()": ["early"],
      "an object with toString(), from setHeader()": ["early"],
      "an array of such objects": ["early", "second"],
      "an array in an array": ["a,b", "second"],
      "a Cookie array": ["a=1; b=2"],
      "an array of a header in uniqueHeaders": ["a; b"],
    });
  });

  test("toString() runs once in setHeader(), once in writeHead() and not in end()", async () => {
    const calls = { setHeader: 0, writeHead: 0, end: 0 };
    let during: keyof typeof calls = "setHeader";
    const value = { toString: () => (calls[during]++, "value") };
    const sent = await respondToEach(
      {
        row: res => {
          res.setHeader("X-Test", value as unknown as string);
          during = "writeHead";
          res.writeHead(200);
          during = "end";
          res.end();
        },
      },
      raw => headerValues(raw, "x-test"),
    );
    assert.deepStrictEqual(
      { sent, calls },
      { sent: { row: ["value"] }, calls: { setHeader: 1, writeHead: 1, end: 0 } },
    );
  });

  test("a toString() that throws inside writeHead() leaves the head open", async () => {
    const seen: Record<string, unknown> = {};
    const sent = await respondToEach(
      {
        row: res => {
          let broken = false;
          const value = {
            toString: () => {
              if (broken) throw new Error("broken toString()");
              return "value";
            },
          };
          res.setHeader("X-Test", value as unknown as string);
          broken = true;
          try {
            res.writeHead(200);
          } catch (error) {
            seen.thrown = (error as Error).message;
          }
          seen.headersSent = res.headersSent;
          broken = false;
          res.writeHead(200);
          res.end();
        },
      },
      raw => [statusLine(raw), ...headerValues(raw, "x-test")],
    );
    assert.deepStrictEqual(
      { seen, sent },
      { seen: { thrown: "broken toString()", headersSent: false }, sent: { row: ["HTTP/1.1 200 OK", "value"] } },
    );
  });
});

describe("a ServerResponse with no socket", () => {
  test("a toString() that throws inside writeHead() leaves the head open", () => {
    const res = new http.ServerResponse(new http.IncomingMessage(null as unknown as net.Socket));
    let broken = false;
    const value = {
      toString: () => {
        if (broken) throw new Error("broken toString()");
        return "value";
      },
    };
    res.setHeader("X-Test", value as unknown as string);
    broken = true;
    assert.throws(() => res.writeHead(200), { message: "broken toString()" });
    const afterThrow = res.headersSent;
    broken = false;
    res.writeHead(200);
    assert.deepStrictEqual(
      { afterThrow, afterSecondCall: res.headersSent },
      { afterThrow: false, afterSecondCall: true },
    );
  });
});

describe("what the response is after writeHead() does not change the head", () => {
  test("sendDate, useChunkedEncodingByDefault, statusCode and statusMessage", async () => {
    const sent = await respondToEach(
      {
        "sendDate = false": res => {
          res.writeHead(200);
          res.sendDate = false;
          res.end("ok");
        },
        "useChunkedEncodingByDefault = false": res => {
          res.writeHead(200);
          res.useChunkedEncodingByDefault = false;
          res.end("ok");
        },
        "statusCode = 500": res => {
          res.writeHead(200);
          res.statusCode = 500;
          res.end("ok");
        },
        "a statusMessage object that changes": res => {
          const message = text("Early");
          res.statusMessage = message as unknown as string;
          res.writeHead(200);
          message.current = "Late";
          res.end("ok");
        },
      },
      raw => ({
        status: statusLine(raw),
        date: headerValues(raw, "date").length,
        framing: [...headerValues(raw, "transfer-encoding"), ...headerValues(raw, "content-length")],
      }),
    );
    const chunkedWithDate = { date: 1, framing: ["chunked"] };
    assert.deepStrictEqual(sent, {
      "sendDate = false": { status: "HTTP/1.1 200 OK", ...chunkedWithDate },
      "useChunkedEncodingByDefault = false": { status: "HTTP/1.1 200 OK", ...chunkedWithDate },
      "statusCode = 500": { status: "HTTP/1.1 200 OK", ...chunkedWithDate },
      "a statusMessage object that changes": { status: "HTTP/1.1 200 Early", ...chunkedWithDate },
    });
  });

  test("shouldKeepAlive = false: the head says keep-alive and the connection takes a second request", async () => {
    const server = http.createServer((req, res) => {
      if (req.url === "/second") return void res.end("second");
      res.writeHead(200, { "Content-Length": 2 });
      res.shouldKeepAlive = false;
      res.end("ok");
    });
    await withServer(server, async port => {
      const raw = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        let received = "";
        let askedAgain = false;
        socket.setEncoding("latin1");
        socket.on("data", chunk => {
          received += chunk;
          // The first response is complete: ask again on the same connection.
          if (!askedAgain && received.endsWith("\r\n\r\nok")) {
            askedAgain = true;
            socket.write(GET("/second"));
          }
        });
        socket.on("error", reject);
        socket.on("close", () => resolve(received));
        socket.write(GET("/first", false));
      });
      assert.deepStrictEqual(
        { connection: headerValues(raw, "connection"), answered: raw.endsWith("second") },
        { connection: ["keep-alive"], answered: true },
      );
    });
  });

  test("res.strictContentLength checks the body against the Content-Length of writeHead()", async () => {
    // writeHead() renders Content-Length: 2. Then the value says 5.
    const rows: [name: string, option: "before" | "after", chunk: string][] = [
      ["the option set before writeHead(), a body of 2 bytes", "before", "ok"],
      ["the option set after writeHead(), a body of 2 bytes", "after", "ok"],
      ["the option set after writeHead(), a body of 5 bytes", "after", "hello"],
    ];
    const seen: Record<string, unknown> = {};
    const sent = await respondToEach(
      Object.fromEntries(
        rows.map(([name, option, chunk]) => [
          name,
          (res: http.ServerResponse) => {
            const length = text("2");
            if (option === "before") res.strictContentLength = true;
            res.writeHead(200, { "Content-Length": length as unknown as number });
            if (option === "after") res.strictContentLength = true;
            length.current = "5";
            seen[name] = codeOf(() => void res.end(chunk));
            if (!res.writableEnded) res.destroy();
          },
        ]),
      ),
      raw => [...headerValues(raw, "content-length"), body(raw)],
    );
    assert.deepStrictEqual(
      { seen, sent },
      {
        seen: { [rows[0][0]]: "no throw", [rows[1][0]]: "no throw", [rows[2][0]]: "ERR_HTTP_CONTENT_LENGTH_MISMATCH" },
        sent: { [rows[0][0]]: ["2", "ok"], [rows[1][0]]: ["2", "ok"], [rows[2][0]]: [""] },
      },
    );
  });

  // Node refuses a Trailer header there, and drops the trailers of addTrailers().
  test("addTrailers() before writeHead() of a response with no chunked body does not throw", async () => {
    const sent = await respondToEach(
      {
        "writeHead(204)": res => {
          res.addTrailers({ "X-Trailer": "1" });
          res.writeHead(204).end();
        },
        "writeHead(200, { 'Content-Length': 2 })": res => {
          res.addTrailers({ "X-Trailer": "1" });
          res.writeHead(200, { "Content-Length": 2 }).end("ok");
        },
      },
      raw => [statusLine(raw), body(raw)],
    );
    assert.deepStrictEqual(sent, {
      "writeHead(204)": ["HTTP/1.1 204 No Content", ""],
      "writeHead(200, { 'Content-Length': 2 })": ["HTTP/1.1 200 OK", "ok"],
    });
  });

  // The cookies package calls OutgoingMessage.prototype.setHeader() for a response of Express.
  test("the header methods of http.OutgoingMessage.prototype throw", async () => {
    const seen: Record<string, unknown> = {};
    const outgoing = http.OutgoingMessage.prototype;
    const sent = await respondToEach(
      {
        row: res => {
          res.writeHead(200, { "X-Early": "1" });
          seen.setHeader = codeOf(() => void outgoing.setHeader.call(res, "X-Late", "1"));
          seen.appendHeader = codeOf(() => void outgoing.appendHeader.call(res, "X-Late", "1"));
          seen.setHeaders = codeOf(() => void outgoing.setHeaders.call(res, new Map([["X-Late", "1"]])));
          seen.removeHeader = codeOf(() => void outgoing.removeHeader.call(res, "X-Early"));
          res.end();
        },
      },
      raw => ({ early: headerValues(raw, "x-early"), late: headerValues(raw, "x-late") }),
    );
    const headersSent = "ERR_HTTP_HEADERS_SENT";
    assert.deepStrictEqual(
      { seen, sent },
      {
        seen: { setHeader: headersSent, appendHeader: headersSent, setHeaders: headersSent, removeHeader: headersSent },
        sent: { row: { early: ["1"], late: [] } },
      },
    );
  });
});

describe("end() after writeHead() takes its own arguments", () => {
  test("the encoding of the chunk, and the limit of res.strictContentLength", async () => {
    const seen: Record<string, unknown> = {};
    const sent = await respondToEach(
      {
        "end(chunk, 'hex')": res => void res.writeHead(200).end("6869", "hex"),
        // The end() that throws writes nothing, and the next one ends the response.
        "end(chunk) longer than Content-Length, then end(chunk) of that length": res => {
          res.strictContentLength = true;
          res.writeHead(200, { "Content-Length": 2 });
          seen.thrown = codeOf(() => void res.end("abc"));
          res.end("ab");
        },
      },
      body,
    );
    assert.deepStrictEqual(
      { seen, sent },
      {
        seen: { thrown: "ERR_HTTP_CONTENT_LENGTH_MISMATCH" },
        sent: {
          "end(chunk, 'hex')": "2\r\nhi\r\n0\r\n\r\n",
          "end(chunk) longer than Content-Length, then end(chunk) of that length": "ab",
        },
      },
    );
  });
});

describe("what does not change", () => {
  test("an implicit head is rendered inside end(), and writeHead() keeps the caller's array in getHeader()", async () => {
    const seen: Record<string, unknown> = {};
    const sent = await respondToEach(
      {
        "setHeader(name, array); push(); end()": res => {
          const array = ["a=1", "b=2"];
          res.setHeader("Set-Cookie", array);
          array.push("late=1");
          res.end("ok");
        },
        "setHeader(name, array); writeHead(200); getHeader(name)": res => {
          const array = ["a=1", "b=2"];
          res.setHeader("Set-Cookie", array);
          res.writeHead(200);
          seen.sameArray = res.getHeader("Set-Cookie") === array;
          res.end("ok");
        },
        "writeHead(200); end(body)": res => void res.writeHead(200).end("ok"),
        "end(body)": res => void res.end("ok"),
        "a writeHead() replacement; end(body)": res => {
          const writeHead = res.writeHead;
          res.writeHead = function (this: http.ServerResponse, ...args: [number]) {
            return writeHead.apply(this, args);
          } as typeof res.writeHead;
          res.end("ok");
        },
      },
      raw => [
        ...headerValues(raw, "set-cookie"),
        ...headerValues(raw, "transfer-encoding"),
        ...headerValues(raw, "content-length").map(length => `Content-Length: ${length}`),
      ],
    );
    assert.deepStrictEqual(
      { seen, sent },
      {
        seen: { sameArray: true },
        sent: {
          "setHeader(name, array); push(); end()": ["a=1", "b=2", "late=1", "Content-Length: 2"],
          "setHeader(name, array); writeHead(200); getHeader(name)": ["a=1", "b=2", "chunked"],
          "writeHead(200); end(body)": ["chunked"],
          "end(body)": ["Content-Length: 2"],
          "a writeHead() replacement; end(body)": ["Content-Length: 2"],
        },
      },
    );
  });
});

// Two requests in one write. The first response ends after `respond` ran for the second one, so the second
// response has no socket while `respond` runs. Resolves with the bytes of the second response.
async function secondResponse(
  connect: Connect,
  respond: (res: http.ServerResponse) => void,
  { second = GET("/second"), options = {} as http.ServerOptions, until = undefined as string | undefined } = {},
) {
  let first: http.ServerResponse;
  let thrown: unknown;
  const server = http.createServer(options, (req, res) => {
    if (req.url === "/first") {
      first = res;
      return;
    }
    try {
      respond(res);
    } catch (error) {
      thrown = error;
      res.destroy();
    }
    first.end("one");
  });
  try {
    const raw = await (await connect(server))(GET("/first", false) + second, until);
    if (thrown) throw thrown;
    const at = raw.indexOf("HTTP/1.1 ", 1);
    assert.ok(at !== -1, `no second response in ${JSON.stringify(raw)}`);
    return raw.slice(at);
  } finally {
    server.closeAllConnections();
    if (server.listening) server.close();
  }
}

for (const [transport, connect] of transports) {
  describe(`a response that waits behind another one on ${transport} (pipelining)`, () => {
    const rows: Record<string, (res: http.ServerResponse) => void> = {
      "setHeader(name, array); end(); push()": res => {
        const array = ["a=1", "b=2"];
        res.setHeader("Set-Cookie", array);
        res.end("two");
        array.push("late=1");
      },
      "setHeader(name, array); end(); a value with CR LF": res => {
        const array = ["a=1", "b=2"];
        res.setHeader("Set-Cookie", array);
        res.end("two");
        array[1] = "x\r\nSet-Cookie: injected=1";
      },
      "setHeader(name, array); write(); push(); end()": res => {
        const array = ["a=1", "b=2"];
        res.setHeader("Set-Cookie", array);
        res.write("two");
        array.push("late=1");
        res.end();
      },
      "writeHead(200, { name: array }); end(); push()": res => {
        const array = ["a=1", "b=2"];
        res.writeHead(200, { "Set-Cookie": array });
        res.end("two");
        array.push("late=1");
      },
    };
    for (const [name, respond] of Object.entries(rows)) {
      test(`${name}: the late value is not sent`, async () => {
        assert.deepStrictEqual(headerValues(await secondResponse(connect, respond), "set-cookie"), ["a=1", "b=2"]);
      });
    }

    const firstCalls: Record<string, (res: http.ServerResponse) => void> = {
      "write()": res => void res.write("two"),
      "end()": res => void res.end("two"),
    };
    for (const [name, firstCall] of Object.entries(firstCalls)) {
      test(`${name} sends the head: headersSent is true, and the calls that change the head throw`, async () => {
        const seen: Record<string, unknown> = {};
        const raw = await secondResponse(connect, res => {
          res.setHeader("X-Early", "1");
          firstCall(res);
          seen.headersSent = res.headersSent;
          seen.setHeader = codeOf(() => void res.setHeader("X-Late", "1"));
          seen.removeHeader = codeOf(() => void res.removeHeader("X-Early"));
          seen.writeHead = codeOf(() => void res.writeHead(500));
          res.end();
        });
        const headersSent = "ERR_HTTP_HEADERS_SENT";
        assert.deepStrictEqual(
          { seen, status: statusLine(raw), early: headerValues(raw, "x-early"), late: headerValues(raw, "x-late") },
          {
            seen: { headersSent: true, setHeader: headersSent, removeHeader: headersSent, writeHead: headersSent },
            status: "HTTP/1.1 200 OK",
            early: ["1"],
            late: [],
          },
        );
      });
    }

    // A 1xx block behind the head is inside the body.
    test("write() sends the head: writeContinue(), writeProcessing() and writeEarlyHints() throw", async () => {
      const seen: Record<string, unknown> = {};
      const raw = await secondResponse(connect, res => {
        res.write("two");
        seen.writeContinue = codeOf(() => void res.writeContinue());
        seen.writeProcessing = codeOf(() => void res.writeProcessing());
        seen.writeEarlyHints = codeOf(() => void res.writeEarlyHints({ link: "</a>; rel=preload" }));
        res.end();
      });
      const headersSent = "ERR_HTTP_HEADERS_SENT";
      assert.deepStrictEqual(
        { seen, body: body(raw) },
        {
          seen: { writeContinue: headersSent, writeProcessing: headersSent, writeEarlyHints: headersSent },
          body: "3\r\ntwo\r\n0\r\n\r\n",
        },
      );
    });

    test("statusCode and sendDate that change after end() are not sent", async () => {
      const raw = await secondResponse(connect, res => {
        res.end("two");
        res.statusCode = 500;
        res.sendDate = false;
      });
      // The first response has Connection: keep-alive. Each head has the lines of its own response.
      assert.deepStrictEqual(
        {
          status: statusLine(raw),
          date: headerValues(raw, "date").length,
          connection: headerValues(raw, "connection"),
          keepAlive: headerValues(raw, "keep-alive"),
        },
        { status: "HTTP/1.1 200 OK", date: 1, connection: ["close"], keepAlive: [] },
      );
    });

    for (const [name, firstCall] of Object.entries(firstCalls)) {
      test(`a status code that is not valid throws from ${name}, and the response can still be sent`, async () => {
        const seen: Record<string, unknown> = {};
        const raw = await secondResponse(connect, res => {
          res.statusCode = 99;
          seen.thrown = codeOf(() => firstCall(res));
          seen.headersSent = res.headersSent;
          res.statusCode = 500;
          res.end("b");
        });
        assert.deepStrictEqual(
          { seen, status: statusLine(raw), body: body(raw) },
          {
            seen: { thrown: "ERR_HTTP_INVALID_STATUS_CODE", headersSent: false },
            status: "HTTP/1.1 500 Internal Server Error",
            body: "b",
          },
        );
      });
    }

    test("a status message that is not valid, and a toString() that throws, throw from end()", async () => {
      const seen: Record<string, unknown> = {};
      const respond: Record<string, (res: http.ServerResponse) => void> = {
        "statusMessage = 'a\\nb'": res => {
          res.statusMessage = "a\nb";
          seen.statusMessage = codeOf(() => void res.end("a"));
          res.statusMessage = "OK";
          res.end("b");
        },
        "a header value whose toString() throws": res => {
          const value = text("early");
          res.setHeader("X-Test", value as unknown as string);
          value.toString = () => {
            throw Object.assign(new Error("broken toString()"), { code: "BROKEN" });
          };
          seen["toString()"] = codeOf(() => void res.end("a"));
          res.removeHeader("X-Test");
          res.end("b");
        },
      };
      for (const [name, row] of Object.entries(respond)) {
        seen[name] = body(await secondResponse(connect, row));
      }
      assert.deepStrictEqual(seen, {
        statusMessage: "ERR_INVALID_CHAR",
        "statusMessage = 'a\\nb'": "b",
        "toString()": "BROKEN",
        "a header value whose toString() throws": "b",
      });
    });

    // Node checks the Trailer header only, and its statusCode of a response is a property of the prototype.
    test("end() does not throw for trailers that are not sent, or for a statusCode that was deleted", async () => {
      const seen: Record<string, unknown> = {};
      const respond: Record<string, (res: http.ServerResponse) => void> = {
        "statusCode = 304; addTrailers(); end()": res => {
          res.statusCode = 304;
          res.addTrailers({ "X-Trailer": "1" });
          res.end();
        },
        "setHeader('Content-Length', 2); addTrailers(); end(body)": res => {
          res.setHeader("Content-Length", 2);
          res.addTrailers({ "X-Trailer": "1" });
          res.end("ok");
        },
        "delete res.statusCode; end(body)": res => {
          delete (res as { statusCode?: number }).statusCode;
          res.end("ok");
        },
      };
      for (const [name, row] of Object.entries(respond)) {
        seen[name] = statusLine(await secondResponse(connect, row));
      }
      assert.deepStrictEqual(seen, {
        "statusCode = 304; addTrailers(); end()": "HTTP/1.1 304 Not Modified",
        "setHeader('Content-Length', 2); addTrailers(); end(body)": "HTTP/1.1 200 OK",
        "delete res.statusCode; end(body)": "HTTP/1.1 200 OK",
      });
    });

    // Node keeps the stored head in outputData until the response has the socket, and outputSize counts it.
    // The connection stops reading requests when these bytes reach its high water mark.
    test("res.outputSize counts the head that end() stored", async () => {
      const sizes: Record<string, number> = {};
      const shapes: Record<string, (res: http.ServerResponse) => void> = {
        "end(body)": res => void res.end("x"),
        "end()": res => void res.end(),
        "writeHead(200, { 'Content-Length': 1 }); end(body)": res =>
          void res.writeHead(200, { "Content-Length": 1 }).end("x"),
        "statusCode = 204; end()": res => {
          res.statusCode = 204;
          res.end();
        },
      };
      for (const [name, respond] of Object.entries(shapes)) {
        await secondResponse(connect, res => {
          respond(res);
          sizes[name] = (res as http.ServerResponse & { outputSize: number }).outputSize;
        });
      }
      // "HTTP/1.1 200 OK", Date and "Connection: close" are 75 bytes with the empty line; "Content-Length: 1" is 19.
      assert.deepStrictEqual(sizes, {
        "end(body)": 95,
        "end()": 94,
        "writeHead(200, { 'Content-Length': 1 }); end(body)": 95,
        "statusCode = 204; end()": 83,
      });
    });

    test("writeHead() in the constructor of a ServerResponse subclass: the status that changes after it is not sent", async () => {
      const EarlyHead = earlyHead(false);
      const raw = await secondResponse(
        connect,
        res => {
          (res as InstanceType<typeof EarlyHead>).cookies.push("later=1");
          res.statusMessage = "Late";
          res.end("two");
        },
        // The head is older than the request's "Connection: close" for Node, which keeps the connection open.
        {
          options: { ServerResponse: EarlyHead as unknown as typeof http.ServerResponse },
          until: "two\r\n0\r\n\r\n",
        },
      );
      assert.deepStrictEqual(
        { status: statusLine(raw), cookies: headerValues(raw, "set-cookie") },
        { status: "HTTP/1.1 201 Made", cookies: ["a=1", "b=2"] },
      );
    });

    test("write('') sends the head, so end(body) is chunked", async () => {
      const raw = await secondResponse(connect, res => {
        res.write("");
        res.end("two");
      });
      assert.deepStrictEqual(
        {
          transferEncoding: headerValues(raw, "transfer-encoding"),
          contentLength: headerValues(raw, "content-length"),
        },
        { transferEncoding: ["chunked"], contentLength: [] },
      );
    });
  });
}

// For a stream, Bun's handle does not apply this option.
describe("res.strictContentLength of a response that waits behind another one on a TCP connection", () => {
  const connect = transports[0][1];

  // Node checks a write() before it stores the head, so the write that stores it is counted and not checked.
  // Packages like on-headers replace res.writeHead: the server calls that function inside the write().
  for (const replaced of [false, true]) {
    const name = `the write() that sends the head is not checked${replaced ? ", also with a replaced res.writeHead" : ""}`;
    test(name, async () => {
      const seen: Record<string, unknown> = {};
      const raw = await secondResponse(connect, res => {
        if (replaced) {
          const writeHead = res.writeHead;
          res.writeHead = function (this: http.ServerResponse, ...args: Parameters<typeof writeHead>) {
            seen.writeHead = true;
            return writeHead.apply(this, args);
          } as typeof writeHead;
        }
        res.strictContentLength = true;
        res.setHeader("Content-Length", 2);
        // The option stays on until this write left the queue. end() would check the three bytes against the two.
        seen.write = res.write("abc", () => {
          res.strictContentLength = false;
          res.end();
        });
      });
      const expected = replaced ? { writeHead: true, write: true } : { write: true };
      assert.deepStrictEqual({ seen, body: body(raw) }, { seen: expected, body: "abc" });
    });
  }

  test("a write() that comes after the queued one is checked", async () => {
    const seen: Record<string, unknown> = {};
    const raw = await secondResponse(connect, res => {
      res.setHeader("Content-Length", 1);
      // The callback runs when this write left the queue: the response has the socket by then.
      res.write("a", () => {
        res.strictContentLength = true;
        seen.thrown = codeOf(() => void res.write("bc"));
        // Node counts only the bytes written while the option is on, so end() goes without it.
        res.strictContentLength = false;
        res.end();
      });
    });
    assert.deepStrictEqual(
      { seen, body: body(raw) },
      { seen: { thrown: "ERR_HTTP_CONTENT_LENGTH_MISMATCH" }, body: "a" },
    );
  });
});

// Node refuses a Trailer header on a response with no chunked body. Bun does that only in writeHead().
describe("a Trailer header on a response with no chunked body", () => {
  test("end() of a response that waits throws when end() of a response that has the socket throws", async () => {
    const rows: Record<string, (res: http.ServerResponse) => void> = {
      "setHeader('Content-Length', 2); end(body)": res => {
        res.setHeader("Content-Length", 2);
        res.end("ok");
      },
      "statusCode = 204; end()": res => {
        res.statusCode = 204;
        res.end();
      },
    };
    const seen: Record<string, unknown> = {};
    for (const [name, row] of Object.entries(rows)) {
      const thrown: Record<string, unknown> = {};
      const respond = (arm: string) => (res: http.ServerResponse) => {
        res.setHeader("Trailer", "X-Trailer");
        thrown[arm] = codeOf(() => row(res));
        if (!res.writableEnded) {
          res.removeHeader("Trailer");
          res.end();
        }
      };
      const server = http.createServer((req, res) => respond("has the socket")(res));
      await withServer(server, port => request(port, GET("/")));
      await secondResponse(transports[0][1], respond("waits"));
      seen[name] = thrown["waits"] === thrown["has the socket"] ? "the same" : thrown;
    }
    assert.deepStrictEqual(seen, {
      "setHeader('Content-Length', 2); end(body)": "the same",
      "statusCode = 204; end()": "the same",
    });
  });
});

// The server reads events.captureRejections when it is made. Node destroys a response whose head is stored.
describe("a handler that rejects, for a response that waits behind another one", () => {
  test("after write(), the response is destroyed", async () => {
    const seen: Record<string, unknown> = {};
    const handled = Promise.withResolvers<void>();
    events.captureRejections = true;
    const server = http.createServer(async (req, res) => {
      if (req.url === "/first") return;
      res.write("partial");
      seen.headersSent = res.headersSent;
      // The server handles the rejection in a tick, before this.
      setImmediate(() => {
        seen.destroyed = res.destroyed;
        handled.resolve();
      });
      throw new Error("the handler rejects");
    });
    events.captureRejections = false;
    await withServer(server, async port => {
      const socket = net.connect(port, "127.0.0.1");
      socket.on("error", () => {});
      socket.write(GET("/first", false) + GET("/second", false));
      await handled.promise;
      socket.destroy();
    });
    assert.deepStrictEqual(seen, { headersSent: true, destroyed: true });
  });
});

describe("a body that the response does not allow", () => {
  const HEAD = "HEAD /second HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n";
  const options = { rejectNonStandardBodyWrites: true };
  // The response of the HEAD request has the socket, or it waits behind another response.
  const arms: Record<string, (respond: (res: http.ServerResponse) => void) => Promise<string>> = {
    "a HEAD request": async respond => {
      const server = http.createServer(options, (req, res) => respond(res));
      return await withServer(server, port => request(port, HEAD));
    },
    "a HEAD request that waits": respond => secondResponse(transports[0][1], respond, { second: HEAD, options }),
  };
  for (const [arm, ask] of Object.entries(arms)) {
    const bodyCalls: Record<string, (res: http.ServerResponse) => void> = {
      "write(body)": res => void res.write("body"),
      "end(body)": res => void res.end("body"),
    };
    for (const [name, bodyCall] of Object.entries(bodyCalls)) {
      test(`${name} for ${arm} sends the head before it throws`, async () => {
        const seen: Record<string, unknown> = {};
        const raw = await ask(res => {
          seen.thrown = codeOf(() => bodyCall(res));
          seen.headersSent = res.headersSent;
          seen.setHeader = codeOf(() => void res.setHeader("X-Late", "1"));
          res.end();
        });
        assert.deepStrictEqual(
          { seen, status: statusLine(raw), late: headerValues(raw, "x-late") },
          {
            seen: { thrown: "ERR_HTTP_BODY_NOT_ALLOWED", headersSent: true, setHeader: "ERR_HTTP_HEADERS_SENT" },
            status: "HTTP/1.1 200 OK",
            late: [],
          },
        );
      });
    }

    // Node checks the type of the chunk first. The handler can still answer with an error.
    test(`a chunk of the wrong type for ${arm} throws, and the head is open`, async () => {
      const wrongChunks: Record<string, (res: http.ServerResponse) => void> = {
        "write(123)": res => void res.write(123 as unknown as string),
        "end({})": res => void res.end({} as unknown as string),
      };
      const sent: Record<string, unknown> = {};
      for (const [name, wrongChunk] of Object.entries(wrongChunks)) {
        const seen: Record<string, unknown> = {};
        const raw = await ask(res => {
          seen.thrown = codeOf(() => wrongChunk(res));
          seen.headersSent = res.headersSent;
          res.statusCode = 500;
          res.end();
        });
        sent[name] = { ...seen, status: statusLine(raw) };
      }
      const answer = {
        thrown: "ERR_INVALID_ARG_TYPE",
        headersSent: false,
        status: "HTTP/1.1 500 Internal Server Error",
      };
      assert.deepStrictEqual(sent, { "write(123)": answer, "end({})": answer });
    });
  }
});

describe("every kind of connection", () => {
  const respond = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const array = ["a=1", "b=2"];
    res.writeHead(200, { "Set-Cookie": array });
    array.push("late=1", "x\r\nSet-Cookie: injected=1");
    res.end("ok");
  };

  test("https", async () => {
    await withServer(https.createServer({ key, cert }, respond), async port => {
      const raw = await exchange(tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }), GET("/"));
      assert.deepStrictEqual(headerValues(raw, "set-cookie"), ["a=1", "b=2"]);
    });
  });

  test('a stream given to emit("connection")', async () => {
    const raw = await connectionEvent(http.createServer(respond), GET("/"));
    assert.deepStrictEqual(headerValues(raw, "set-cookie"), ["a=1", "b=2"]);
  });

  for (const [transport, connect] of transports) {
    // The head of a response belongs to that response, also when one of its writes threw before the head went out.
    const others: [string, (res: http.ServerResponse, endFirst: () => void) => void][] = [
      [
        "calls writeHead() and is still open",
        (res, endFirst) => {
          res.writeHead(200, { "X-Id": "second" });
          endFirst();
          res.end();
        },
      ],
      [
        "has ended",
        (res, endFirst) => {
          res.setHeader("X-Id", "second");
          res.end();
          endFirst();
        },
      ],
    ];
    for (const [name, other] of others) {
      test(`${transport}: a write() that throws, then end() when another response ${name}`, async () => {
        const seen: Record<string, unknown> = {};
        const firstIsOpen = Promise.withResolvers<void>();
        let first: http.ServerResponse;
        const server = http.createServer((req, res) => {
          if (req.url === "/first") {
            first = res;
            res.writeHead(200, { "X-Id": "first" });
            try {
              res.write("x", "not-an-encoding" as BufferEncoding);
            } catch (error) {
              seen.write = (error as NodeJS.ErrnoException).code;
            }
            return firstIsOpen.resolve();
          }
          other(res, () => {
            try {
              first.end();
            } catch (error) {
              seen.end = String(error);
              first.destroy();
            }
          });
        });
        try {
          const ask = await connect(server);
          const firstResponse = ask(GET("/first"));
          await Promise.race([firstIsOpen.promise, firstResponse]);
          const secondResponse = await ask(GET("/second"));
          assert.deepStrictEqual(
            { seen, first: headerValues(await firstResponse, "x-id"), second: headerValues(secondResponse, "x-id") },
            { seen: { write: "ERR_UNKNOWN_ENCODING" }, first: ["first"], second: ["second"] },
          );
        } finally {
          server.closeAllConnections();
          if (server.listening) server.close();
        }
      });
    }

    // An end() that throws before the body leaves the head of writeHead() for the next end().
    test(`${transport}: end(chunk, unknown encoding) throws, the array and the status change, then end()`, async () => {
      const seen: Record<string, unknown> = {};
      const server = http.createServer((req, res) => {
        const array = ["a=1", "b=2"];
        res.writeHead(200, { "Set-Cookie": array });
        seen.thrown = codeOf(() => void res.end("x", "not-an-encoding" as BufferEncoding));
        array.push("late=1");
        res.statusCode = 500;
        res.end("ok");
      });
      try {
        const raw = await (await connect(server))(GET("/"));
        assert.deepStrictEqual(
          { seen, status: statusLine(raw), cookies: headerValues(raw, "set-cookie") },
          { seen: { thrown: "ERR_UNKNOWN_ENCODING" }, status: "HTTP/1.1 200 OK", cookies: ["a=1", "b=2"] },
        );
      } finally {
        server.closeAllConnections();
        if (server.listening) server.close();
      }
    });

    for (const [how, passesOptions] of subclasses) {
      test(`${transport}: writeHead() in the constructor of a ServerResponse subclass ${how}`, async () => {
        const EarlyHead = earlyHead(passesOptions);
        const server = http.createServer({ ServerResponse: EarlyHead }, (req, res) => {
          (res as InstanceType<typeof EarlyHead>).cookies.push("later=1");
          res.statusMessage = "Late";
          res.end("ok");
        });
        try {
          // The head is older than the options that the server gives the response, so Node keeps this
          // connection open: read up to the end of the body.
          const raw = await (await connect(server))(GET("/"), "0\r\n\r\n");
          assert.deepStrictEqual(
            {
              status: statusLine(raw),
              cookies: headerValues(raw, "set-cookie"),
              framing: headerValues(raw, "transfer-encoding"),
            },
            { status: "HTTP/1.1 201 Made", cookies: ["a=1", "b=2"], framing: ["chunked"] },
          );
        } finally {
          server.closeAllConnections();
          if (server.listening) server.close();
        }
      });
    }
  }

  test('a stream given to emit("connection"): a queued HTTP/1.0 response that takes chunked is chunked', async () => {
    let first: http.ServerResponse;
    const server = http.createServer((req, res) => {
      if (req.url === "/first") return void (first = res);
      res.write("t");
      res.end("wo");
      first.end("one");
    });
    const raw = await connectionEvent(server, GET("/first", false) + "GET /second HTTP/1.0\r\nTE: chunked\r\n\r\n");
    const second = raw.slice(raw.indexOf("HTTP/1.1 ", 1));
    assert.deepStrictEqual(
      { framing: headerValues(second, "transfer-encoding"), body: second.slice(second.indexOf("\r\n\r\n") + 4) },
      { framing: ["chunked"], body: "1\r\nt\r\n2\r\nwo\r\n0\r\n\r\n" },
    );
  });
});

describe("three responses that are open at once", () => {
  // The first two call writeHead() and wait. The third one is written between the end of the first and of the second.
  // Each has its own status, Date and Connection, so a head that takes one of them from another response is seen.
  test("each one is sent its own head", async () => {
    const open: Record<string, http.ServerResponse> = {};
    const opened: Record<string, PromiseWithResolvers<void>> = {
      "/a": Promise.withResolvers<void>(),
      "/b": Promise.withResolvers<void>(),
    };
    const server = http.createServer((req, res) => {
      const path = req.url!;
      if (path === "/a") {
        res.writeHead(201, "Made", { "X-Id": path });
      } else if (path === "/b") {
        res.sendDate = false;
        res.writeHead(202, { "X-Id": path });
      }
      if (path !== "/c") {
        open[path] = res;
        return opened[path].resolve();
      }
      open["/a"].end();
      res.setHeader("X-Id", path);
      res.end();
      open["/b"].end();
    });
    server.keepAliveTimeout = 7000;
    const lines = (raw: string) => ({
      status: statusLine(raw),
      id: headerValues(raw, "x-id"),
      date: headerValues(raw, "date").length,
      connection: headerValues(raw, "connection"),
      keepAlive: headerValues(raw, "keep-alive"),
    });
    await withServer(server, async port => {
      // /a and /c keep their connections open, /b asks for a close.
      const a = request(port, GET("/a", false), "0\r\n\r\n");
      await Promise.race([opened["/a"].promise, a]);
      const b = request(port, GET("/b"));
      await Promise.race([opened["/b"].promise, b]);
      const c = request(port, GET("/c", false), "\r\n\r\n");
      assert.deepStrictEqual(
        { a: lines(await a), b: lines(await b), c: lines(await c) },
        {
          a: { status: "HTTP/1.1 201 Made", id: ["/a"], date: 1, connection: ["keep-alive"], keepAlive: ["timeout=7"] },
          b: { status: "HTTP/1.1 202 Accepted", id: ["/b"], date: 0, connection: ["close"], keepAlive: [] },
          c: { status: "HTTP/1.1 200 OK", id: ["/c"], date: 1, connection: ["keep-alive"], keepAlive: ["timeout=7"] },
        },
      );
    });
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again, and it cannot load "harness".
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExe } = await import("harness");
  const node = nodeExe();

  describe("only in Bun", () => {
    // Node sends a second head for this.
    test("a toString() that writes to its response inside writeHead(): the write() and end() after it are sent", async () => {
      const sent = await respondToEach(
        {
          row: res => {
            let wrote = false;
            const value = {
              toString() {
                if (!wrote) {
                  wrote = true;
                  res.write("x");
                }
                return "v";
              },
            };
            res.writeHead(200, { "X-Test": value as unknown as string });
            res.write("y");
            res.end();
          },
        },
        body,
      );
      assert.deepStrictEqual(sent, { row: "1\r\nx\r\n1\r\ny\r\n0\r\n\r\n" });
    });

    // Node sends this status line as it is.
    for (const [transport, connect] of transports) {
      test(`${transport}: an end() that the handle refuses leaves the head of writeHead() for the next end()`, async () => {
        const seen: unknown[] = [];
        const value = renders();
        const server = http.createServer((req, res) => {
          let calls = 0;
          // Valid when writeHead() checks it, and not valid in the head that writeHead() renders.
          res.statusMessage = { toString: () => (++calls === 1 ? "Fine" : "not\nvalid") } as unknown as string;
          res.writeHead(200, { "X-Renders": value as unknown as string });
          seen.push(codeOf(() => void res.end("a")));
          res.statusCode = 500;
          res.statusMessage = "Late";
          seen.push(codeOf(() => void res.end("b")));
          res.destroy();
        });
        try {
          const raw = await (await connect(server))(GET("/"));
          // No end() renders the head again: the two calls of toString() are the ones of writeHead().
          assert.deepStrictEqual(
            { seen, renders: value.calls, raw },
            { seen: ["ERR_INVALID_CHAR", "ERR_INVALID_CHAR"], renders: 2, raw: "" },
          );
        } finally {
          server.closeAllConnections();
          if (server.listening) server.close();
        }
      });
    }

    // Node has no setter for headersSent.
    test("res.headersSent = false after writeHead(): the next head is made from the response as it is then", async () => {
      const sent = await respondToEach(
        {
          row: res => {
            res.strictContentLength = true;
            res.writeHead(200, { "X-A": "1", "Content-Length": 3 });
            (res as { headersSent: boolean }).headersSent = false;
            res.setHeader("X-B", "2");
            res.setHeader("Content-Length", 5);
            res.end("abcde");
          },
        },
        raw => [
          ...headerValues(raw, "x-a"),
          ...headerValues(raw, "x-b"),
          ...headerValues(raw, "content-length"),
          body(raw),
        ],
      );
      assert.deepStrictEqual(sent, { row: ["1", "2", "5", "abcde"] });
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
