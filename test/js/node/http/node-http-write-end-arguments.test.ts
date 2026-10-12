/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * ServerResponse#write() and #end() check the status code and the chunk before
 * they start the response, so a call that throws leaves the response as it was:
 * https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L933-L992
 * The expected values were recorded from Node v26.3.0. Node.js skips a test
 * that says "Bun only".
 */
import assert from "node:assert";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, request as httpRequest, IncomingMessage, ServerResponse, type Server } from "node:http";
import { createServer as createHttpsServer, request as httpsRequest } from "node:https";
import { connect, createServer as createNetServer, type AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const bunOnly = process.versions.bun ? test : test.skip;

// "own": the server accepts the connection, and Bun writes the response through its native handle.
// "emitted": the 'connection' event gets the socket of another listener, and Bun writes the response through the JS handle of internal/http1_server_fallback.
const connections = ["own", "emitted"] as const;
type Connection = (typeof connections)[number];

async function serve(server: Server, connection: Connection = "own") {
  // A call that was refused too late can leave the response ended. The error of the next call then stays in its own test.
  server.prependListener("request", (req, res) => res.on("error", () => {}));
  const listener = connection === "emitted" ? createNetServer(socket => server.emit("connection", socket)) : server;
  await once(listener.listen(0, "127.0.0.1"), "listening");
  return { port: (listener.address() as AddressInfo).port, close: () => listener.close() };
}

function thrownBy(call: () => unknown) {
  try {
    call();
  } catch (e: any) {
    return { name: e.name, code: e.code, message: e.message };
  }
  return "no throw";
}

// The status, the named headers and the body of the answer. Each request has its own connection.
function get(port: number, path: string, { method = "GET", headers = [] as string[], secure = false } = {}) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = (secure ? httpsRequest : httpRequest)(
      { host: "127.0.0.1", port, path, method, agent: false, rejectUnauthorized: false },
      response => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", chunk => (body += chunk));
        response.on("error", reject);
        response.on("end", () => {
          const named = Object.fromEntries(headers.map(name => [name, response.headers[name]]));
          resolve({ status: response.statusCode, ...named, body });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

// Everything the server sent on one connection, when the connection closes.
function rawRequest(port: number, request: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let data = "";
    socket.on("data", chunk => (data += chunk));
    socket.on("error", reject);
    socket.on("close", () => resolve(data));
    socket.write(request);
  });
}

// Requests for one connection. The last one closes it.
const pipelined = (...paths: string[]) =>
  paths
    .map(
      (path, index) =>
        `GET ${path} HTTP/1.1\r\nHost: x\r\n${index === paths.length - 1 ? "Connection: close\r\n" : ""}\r\n`,
    )
    .join("");

// The status and the body of each response in what a server sent on one connection.
function answersOf(wire: string) {
  const answers: { status: number; body: string }[] = [];
  while (wire.length) {
    const headEnd = wire.indexOf("\r\n\r\n");
    if (headEnd < 0) {
      answers.push({ status: NaN, body: wire });
      break;
    }
    const head = wire.slice(0, headEnd);
    wire = wire.slice(headEnd + 4);
    let body = "";
    const length = /^content-length: (\d+)$/im.exec(head);
    if (length) {
      body = wire.slice(0, Number(length[1]));
      wire = wire.slice(body.length);
    } else if (/^transfer-encoding: chunked$/im.test(head)) {
      for (let size = -1; size !== 0; ) {
        const sizeEnd = wire.indexOf("\r\n");
        size = parseInt(wire.slice(0, sizeEnd), 16);
        body += wire.slice(sizeEnd + 2, sizeEnd + 2 + size);
        wire = wire.slice(sizeEnd + 2 + size + 2);
      }
    }
    answers.push({ status: Number(head.slice("HTTP/1.1 ".length, "HTTP/1.1 200".length)), body });
  }
  return answers;
}

describe("res.statusCode when write() or end() starts the response", () => {
  // Without a writeHead() call, Node's write() and end() call writeHead(this.statusCode):
  // https://github.com/nodejs/node/blob/v26.3.0/lib/_http_server.js#L403-L430
  const invalidStatusCode = (text: string) => ({
    name: "RangeError",
    code: "ERR_HTTP_INVALID_STATUS_CODE",
    message: `Invalid status code: ${text}`,
  });

  test("end() and write() throw ERR_HTTP_INVALID_STATUS_CODE for statusCode = 99", async () => {
    const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
    const server = createServer((req, res) => {
      res.statusCode = 99;
      resolve({
        "end('x')": thrownBy(() => res.end("x")),
        "end()": thrownBy(() => res.end()),
        "write('x')": thrownBy(() => res.write("x")),
        "write('')": thrownBy(() => res.write("")),
        headersSent: res.headersSent,
      });
      // The refused calls sent nothing, so the response can still be answered.
      res.statusCode = 200;
      res.end("ok");
    });
    const { port, close } = await serve(server);
    try {
      const answer = await get(port, "/");
      const refused = invalidStatusCode("99");
      assert.deepStrictEqual(await promise, {
        "end('x')": refused,
        "end()": refused,
        "write('x')": refused,
        "write('')": refused,
        headersSent: false,
      });
      assert.deepStrictEqual(answer, { status: 200, body: "ok" });
    } finally {
      close();
    }
  });

  test("end() and write() refuse every status code that writeHead() refuses", async () => {
    // [res.statusCode, its text in the error message]
    const refused: [unknown, string][] = [
      [1000, "1000"],
      [0, "0"],
      [-0, "-0"],
      [-1, "-1"],
      [99.9, "99.9"],
      [1e10, "10000000000"],
      [Infinity, "Infinity"],
      [NaN, "NaN"],
      [undefined, "undefined"],
      [null, "null"],
      [true, "true"],
      ["abc", "abc"],
      ["1000", "1000"],
      [{}, "{}"],
      [[], "[]"],
    ];
    const seen: unknown[] = [];
    const server = createServer((req, res) => {
      const index = Number(req.url!.slice(1));
      res.statusCode = refused[index][0] as number;
      seen[index] = {
        "write('x')": thrownBy(() => res.write("x")),
        "end('x')": thrownBy(() => res.end("x")),
        headersSent: res.headersSent,
      };
      res.statusCode = 200;
      res.end();
    });
    const { port, close } = await serve(server);
    try {
      const answers = await Promise.all(refused.map((_, index) => get(port, `/${index}`)));
      assert.deepStrictEqual(
        seen,
        refused.map(([, text]) => ({
          "write('x')": invalidStatusCode(text),
          "end('x')": invalidStatusCode(text),
          headersSent: false,
        })),
      );
      assert.deepStrictEqual(
        answers,
        refused.map(() => ({ status: 200, body: "" })),
      );
    } finally {
      close();
    }
  });

  test("end() and write() send a status code that writeHead() coerces to an integer", async () => {
    // [res.statusCode, the integer that writeHead() makes of it, the message of that integer, what is sent of the body "x"]
    const coerced: [unknown, number, string, string][] = [
      ["404", 404, "Not Found", "x"],
      ["204", 204, "No Content", ""],
      [[204], 204, "No Content", ""],
      [200.5, 200, "OK", "x"],
      [2 ** 32 + 200, 200, "OK", "x"],
    ];
    const paths = coerced.flatMap((_, index) => [`/${index}/end`, `/${index}/write`]);
    const after: Record<string, object> = {};
    const server = createServer((req, res) => {
      const [, index, call] = req.url!.split("/");
      res.statusCode = coerced[Number(index)][0] as number;
      const thrown = thrownBy(() => {
        if (call === "end") return res.end("x");
        res.write("x");
        res.end();
      });
      after[req.url!] = { thrown, statusCode: res.statusCode, statusMessage: res.statusMessage };
      // Only a call that threw leaves the response open. Answer it, so that a failure is a wrong status and not a timeout.
      if (!res.writableEnded) {
        res.statusCode = 500;
        res.end();
      }
    });
    const { port, close } = await serve(server);
    try {
      const answers = await Promise.all(paths.map(path => get(port, path)));
      assert.deepStrictEqual(
        paths.map((path, index) => ({ ...after[path], ...answers[index] })),
        coerced.flatMap(([, statusCode, statusMessage, body]) => {
          // The response has the integer and its message after the call, and the client receives that status.
          const result = { thrown: "no throw", statusCode, statusMessage, status: statusCode, body };
          return [result, result];
        }),
      );
    } finally {
      close();
    }
  });

  test("a deleted res.statusCode is 200", async () => {
    const { promise, resolve } = Promise.withResolvers<unknown>();
    const server = createServer((req, res) => {
      delete (res as { statusCode?: number }).statusCode;
      resolve(res.statusCode);
      res.end("x");
    });
    const { port, close } = await serve(server);
    try {
      assert.deepStrictEqual(await get(port, "/"), { status: 200, body: "x" });
      assert.strictEqual(await promise, 200);
    } finally {
      close();
    }
  });

  test("a response that waits behind a pipelined one throws in the call of the handler", async () => {
    const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
    let first: ServerResponse;
    const server = createServer((req, res) => {
      if (req.url === "/first") {
        first = res;
        return;
      }
      res.statusCode = 99;
      resolve({ "write('x')": thrownBy(() => res.write("x")), "end('x')": thrownBy(() => res.end("x")) });
      res.statusCode = 200;
      res.end();
      first.end("first");
    });
    const { port, close } = await serve(server);
    try {
      const wire = await rawRequest(port, pipelined("/first", "/second"));
      assert.deepStrictEqual(await promise, {
        "write('x')": invalidStatusCode("99"),
        "end('x')": invalidStatusCode("99"),
      });
      assert.deepStrictEqual(answersOf(wire), [
        { status: 200, body: "first" },
        { status: 200, body: "" },
      ]);
    } finally {
      close();
    }
  });

  // Guard: the status code is checked by the call that starts the head, and not again when the response gets the socket.
  test("a queued response is not checked again for a status code that changes after its first call", async () => {
    // [the path, the calls of the handler]
    const cases: [string, (res: ServerResponse) => void][] = [
      ["/end-undefined", res => (res.end("x"), (res.statusCode = undefined as any))],
      ["/end-NaN", res => (res.end("x"), (res.statusCode = NaN))],
      ["/write-undefined", res => (res.write("x"), (res.statusCode = undefined as any), res.end())],
      ["/write-NaN", res => (res.write("x"), (res.statusCode = NaN), res.end())],
    ];
    const thrown: Record<string, unknown> = {};
    let first: ServerResponse;
    const server = createServer((req, res) => {
      if (req.url === "/first") {
        first = res;
        return;
      }
      thrown[req.url!] = thrownBy(() => cases.find(([path]) => path === req.url)![1](res));
      first.end("first");
    });
    const { port, close } = await serve(server);
    try {
      const wires = await Promise.all(cases.map(([path]) => rawRequest(port, pipelined("/first", path))));
      assert.deepStrictEqual(thrown, Object.fromEntries(cases.map(([path]) => [path, "no throw"])));
      assert.deepStrictEqual(
        wires.map(answersOf),
        cases.map(() => [
          { status: 200, body: "first" },
          { status: 200, body: "x" },
        ]),
      );
    } finally {
      close();
    }
  });

  test("write() checks the status code before it rejects the body of a HEAD response", async () => {
    const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
    const server = createServer({ rejectNonStandardBodyWrites: true }, (req, res) => {
      res.statusCode = 99;
      const refused = thrownBy(() => res.write("x"));
      res.statusCode = 200;
      resolve({ refused, valid: thrownBy(() => res.write("x")) });
      res.end();
    });
    const { port, close } = await serve(server);
    try {
      assert.deepStrictEqual(await get(port, "/", { method: "HEAD" }), { status: 200, body: "" });
      assert.deepStrictEqual(await promise, {
        refused: invalidStatusCode("99"),
        valid: {
          name: "Error",
          code: "ERR_HTTP_BODY_NOT_ALLOWED",
          message: "Adding content for this request method or response status is not allowed.",
        },
      });
    } finally {
      close();
    }
  });

  // Guard: Node's end() stores no head for the chunk of a destroyed response, so nothing checks the status code there.
  test("end(chunk) on a destroyed response does not check the status code", async () => {
    const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
    const server = createServer((req, res) => {
      res.destroy();
      res.statusCode = 99;
      resolve({
        "write('x')": thrownBy(() => res.write("x")),
        "end('x')": thrownBy(() => res.end("x")),
        finished: res.finished,
      });
    });
    const { port, close } = await serve(server);
    try {
      // The server destroys the connection, so the request fails or gets no bytes.
      await rawRequest(port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n").catch(() => {});
      assert.deepStrictEqual(await promise, { "write('x')": "no throw", "end('x')": "no throw", finished: true });
    } finally {
      close();
    }
  });
});

describe("the chunk of write() and end() when they start the response", () => {
  // Node's write_() checks the chunk before anything else, so a call that throws for its chunk changes nothing:
  // https://github.com/nodejs/node/blob/v26.3.0/lib/_http_outgoing.js#L937-L942
  const wrongType = (received: string) => ({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: `The "chunk" argument must be of type string or an instance of Buffer or Uint8Array. Received ${received}`,
  });
  const wrongNumber = wrongType("type number (123)");

  // A value for each kind of chunk, made again for each call.
  const detached = () => {
    const view = new Uint8Array(4);
    structuredClone(view.buffer, { transfer: [view.buffer] });
    return view;
  };
  const throwing = (key: PropertyKey) => {
    const string = new String("x");
    (string as any)[key] = () => {
      throw new RangeError("user");
    };
    return string;
  };
  const texts: Record<string, () => unknown> = {
    "string": () => "s",
    "empty string": () => "",
    "String": () => new String("s"),
    "String subclass": () => new (class extends String {})("s"),
    "String with a toString() that throws": () => throwing("toString"),
    "String with a Symbol.toPrimitive that throws": () => throwing(Symbol.toPrimitive),
  };
  const values: Record<string, () => unknown> = {
    ...texts,
    "123": () => 123,
    "0": () => 0,
    "false": () => false,
    "true": () => true,
    "NaN": () => NaN,
    "1n": () => 1n,
    "symbol": () => Symbol("s"),
    "null": () => null,
    "undefined": () => undefined,
    "function": () => function callback() {},
    "array": () => [1, 2],
    "object": () => ({ a: 1 }),
    "Date": () => new Date(0),
    "Buffer": () => Buffer.from("b"),
    "Uint8Array": () => new Uint8Array([65]),
    "Uint8ClampedArray": () => new Uint8ClampedArray([65]),
    "Int8Array": () => new Int8Array([65]),
    "Uint16Array": () => new Uint16Array([65]),
    "Int32Array": () => new Int32Array([65]),
    "Float64Array": () => new Float64Array([1]),
    "BigUint64Array": () => new BigUint64Array([1n]),
    "DataView": () => new DataView(new ArrayBuffer(2)),
    "ArrayBuffer": () => new ArrayBuffer(2),
    "SharedArrayBuffer": () => new SharedArrayBuffer(2),
    "object with the prototype of Uint8Array": () => Object.create(Uint8Array.prototype),
    "Proxy of a Buffer": () => new Proxy(Buffer.from("p"), {}),
    "detached Uint8Array": detached,
    "detached ArrayBuffer": () => detached().buffer,
  };
  // An encoding changes only what a handle does with text.
  const rows = [
    ...Object.keys(values).map(name => ({ name, encoding: undefined })),
    ...Object.keys(texts).map(name => ({ name, encoding: "latin1" })),
  ];

  for (const connection of connections) {
    describe(`on a connection that is ${connection}`, () => {
      test("end() and write() refuse a chunk of the wrong type before the response starts", async () => {
        // [the chunk, its text in the message of Node.js]
        const chunks: [unknown, string][] = [
          [123, "type number (123)"],
          [{}, "an instance of Object"],
          [[1, 2], "an instance of Array"],
          [true, "type boolean (true)"],
          [new Date(0), "an instance of Date"],
          [Symbol("s"), "type symbol (Symbol(s))"],
          [1n, "type bigint (1n)"],
        ];
        const paths = chunks.flatMap((_, index) => [`/${index}/end`, `/${index}/write`]);
        const seen: Record<string, Record<string, unknown>> = {};
        let open = paths.length;
        const { promise: allClosed, resolve: onAllClosed } = Promise.withResolvers<void>();
        const server = createServer((req, res) => {
          const [, index, call] = req.url!.split("/");
          const state: Record<string, unknown> = (seen[req.url!] = { callbackRan: false });
          state.thrown = thrownBy(() => (res as any)[call](chunks[Number(index)][0], () => (state.callbackRan = true)));
          state.headersSent = res.headersSent;
          res.on("close", () => --open === 0 && onAllClosed());
          // The refused call sent nothing, so the handler still chooses the status and the headers.
          state.setHeader = thrownBy(() => res.setHeader("x-recovered", "yes"));
          res.statusCode = 500;
          res.end("oops");
        });
        const { port, close } = await serve(server, connection);
        try {
          const answers = await Promise.all(paths.map(path => get(port, path, { headers: ["x-recovered"] })));
          await allClosed;
          assert.deepStrictEqual(
            paths.map((path, index) => ({ ...seen[path], ...answers[index] })),
            chunks.flatMap(([, received]) => {
              const row = {
                callbackRan: false,
                thrown: wrongType(received),
                headersSent: false,
                setHeader: "no throw",
                status: 500,
                "x-recovered": "yes",
                body: "oops",
              };
              return [row, row];
            }),
          );
        } finally {
          close();
        }
      });

      test("write() refuses a falsy chunk that is no string", async () => {
        const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
        const server = createServer((req, res) => {
          const write = res.write.bind(res) as (chunk: unknown) => unknown;
          resolve({
            "write(0)": thrownBy(() => write(0)),
            "write(false)": thrownBy(() => write(false)),
            "write(NaN)": thrownBy(() => write(NaN)),
            "write(0n)": thrownBy(() => write(0n)),
            headersSent: res.headersSent,
          });
          res.statusCode = 500;
          res.end("oops");
        });
        const { port, close } = await serve(server, connection);
        try {
          assert.deepStrictEqual(await get(port, "/"), { status: 500, body: "oops" });
          assert.deepStrictEqual(await promise, {
            "write(0)": wrongType("type number (0)"),
            "write(false)": wrongType("type boolean (false)"),
            "write(NaN)": wrongType("type number (NaN)"),
            "write(0n)": wrongType("type bigint (0n)"),
            headersSent: false,
          });
        } finally {
          close();
        }
      });

      test("end() takes a falsy chunk for no chunk", async () => {
        const chunks = [0, false, NaN, 0n, "", null, undefined];
        const thrown: unknown[] = [];
        const server = createServer((req, res) => {
          const index = Number(req.url!.slice(1));
          thrown[index] = thrownBy(() => res.end(chunks[index] as any));
          if (!res.writableEnded) res.end();
        });
        const { port, close } = await serve(server, connection);
        try {
          const answers = await Promise.all(
            chunks.map((_, index) => get(port, `/${index}`, { headers: ["content-length"] })),
          );
          assert.deepStrictEqual(
            thrown,
            chunks.map(() => "no throw"),
          );
          assert.deepStrictEqual(
            answers,
            chunks.map(() => ({ status: 200, "content-length": "0", body: "" })),
          );
        } finally {
          close();
        }
      });

      for (const rejectNonStandardBodyWrites of [false, true]) {
        test(`a response that cannot have a body still checks the type of the chunk (rejectNonStandardBodyWrites: ${rejectNonStandardBodyWrites})`, async () => {
          // [the method of the request, res.statusCode, the call]
          const cases = [
            ["GET", 204, "end"],
            ["GET", 204, "write"],
            ["GET", 304, "end"],
            ["GET", 304, "write"],
            ["HEAD", 200, "end"],
            ["HEAD", 200, "write"],
          ] as const;
          const seen: unknown[] = [];
          const server = createServer({ rejectNonStandardBodyWrites }, (req, res) => {
            const index = Number(req.url!.slice(1));
            const [, statusCode, call] = cases[index];
            res.statusCode = statusCode;
            const thrown = thrownBy(() => (res as any)[call](123));
            const headersSent = res.headersSent;
            // The refused call did not make the response one without a body: a GET gets the body of the 500.
            const recovery = thrownBy(() => {
              res.statusCode = 500;
              res.end(req.method === "HEAD" ? undefined : "oops");
            });
            seen[index] = { thrown, headersSent, recovery };
            if (!res.writableEnded) res.destroy();
          });
          const { port, close } = await serve(server, connection);
          try {
            const answers = await Promise.all(cases.map(([method], index) => get(port, `/${index}`, { method })));
            assert.deepStrictEqual(
              seen,
              cases.map(() => ({ thrown: wrongNumber, headersSent: false, recovery: "no throw" })),
            );
            assert.deepStrictEqual(
              answers,
              cases.map(([method]) => ({ status: 500, body: method === "HEAD" ? "" : "oops" })),
            );
          } finally {
            close();
          }
        });
      }

      test("the error of the chunk comes before the error of the status code", async () => {
        const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
        const server = createServer((req, res) => {
          res.statusCode = 99;
          const invalid = thrownBy(() => res.end(123 as any));
          res.statusCode = "404" as any;
          const coercible = thrownBy(() => res.write(123 as any));
          // No head was stored, so no writeHead() call made a number of the "404".
          resolve({ invalid, coercible, statusCode: res.statusCode, headersSent: res.headersSent });
          res.statusCode = 500;
          res.end("oops");
        });
        const { port, close } = await serve(server, connection);
        try {
          assert.deepStrictEqual(await get(port, "/"), { status: 500, body: "oops" });
          assert.deepStrictEqual(await promise, {
            invalid: wrongNumber,
            coercible: wrongNumber,
            statusCode: "404",
            headersSent: false,
          });
        } finally {
          close();
        }
      });

      test("a replaced writeHead() does not run for a refused chunk", async () => {
        const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
        const server = createServer((req, res) => {
          let calls = 0;
          const writeHead = res.writeHead;
          res.writeHead = function (this: ServerResponse, ...args: any[]) {
            calls++;
            return writeHead.apply(this, args as any);
          } as typeof res.writeHead;
          const refused = [thrownBy(() => res.end(123 as any)), thrownBy(() => res.write(123 as any))];
          const callsAfterRefused = calls;
          res.statusCode = 500;
          res.end("oops");
          resolve({ refused, callsAfterRefused, callsAfterRecovery: calls });
        });
        const { port, close } = await serve(server, connection);
        try {
          assert.deepStrictEqual(await get(port, "/"), { status: 500, body: "oops" });
          assert.deepStrictEqual(await promise, {
            refused: [wrongNumber, wrongNumber],
            callsAfterRefused: 0,
            callsAfterRecovery: 1,
          });
        } finally {
          close();
        }
      });

      test("a destroyed response still refuses the chunk", async () => {
        const { promise, resolve } = Promise.withResolvers<unknown[]>();
        const server = createServer((req, res) => {
          res.destroy();
          resolve([thrownBy(() => res.write(123 as any)), thrownBy(() => res.end(123 as any))]);
        });
        const { port, close } = await serve(server, connection);
        try {
          // The server destroys the connection, so the request fails or gets no bytes.
          await rawRequest(port, pipelined("/")).catch(() => {});
          assert.deepStrictEqual(await promise, [wrongNumber, wrongNumber]);
        } finally {
          close();
        }
      });

      test("after end(), write() still refuses the chunk and end() reports a write after the end", async () => {
        const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
        const server = createServer((req, res) => {
          res.end("a");
          const write = thrownBy(() => res.write(123 as any));
          // Node's end() reads `finished` before it gives the chunk to write_(), so it does not throw.
          res.on("error", error => resolve({ write, end, error: (error as NodeJS.ErrnoException).code }));
          const end = thrownBy(() => res.end(123 as any));
        });
        const { port, close } = await serve(server, connection);
        try {
          assert.deepStrictEqual(await get(port, "/"), { status: 200, body: "a" });
          assert.deepStrictEqual(await promise, {
            write: wrongNumber,
            end: "no throw",
            error: "ERR_STREAM_WRITE_AFTER_END",
          });
        } finally {
          close();
        }
      });

      test("a response that waits behind a pipelined one refuses the chunk in the call of the handler", async () => {
        const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
        const { promise: firstFinished, resolve: onFirstFinished } = Promise.withResolvers<string[]>();
        let first: ServerResponse;
        const server = createServer((req, res) => {
          if (req.url === "/first") {
            first = res;
          } else if (req.url === "/second") {
            resolve({
              "write(123)": thrownBy(() => res.write(123 as any)),
              "end(123)": thrownBy(() => res.end(123 as any)),
              headersSent: res.headersSent,
              outputSize: (res as any).outputSize,
            });
            if (res.writableEnded) return;
            res.statusCode = 500;
            res.end("oops");
          } else {
            res.end("third");
            // The response in front ends last: the two responses behind it get the socket in their order.
            const events: string[] = [];
            const record = (event: string) => events.push(event) === 2 && onFirstFinished(events.sort());
            first.on("finish", () => record("finish"));
            first.end("first", () => record("end() callback"));
          }
        });
        const { port, close } = await serve(server, connection);
        try {
          const wire = await rawRequest(port, pipelined("/first", "/second", "/third"));
          assert.deepStrictEqual(await promise, {
            "write(123)": wrongNumber,
            "end(123)": wrongNumber,
            headersSent: false,
            outputSize: 0,
          });
          assert.deepStrictEqual(answersOf(wire), [
            { status: 200, body: "first" },
            { status: 500, body: "oops" },
            { status: 200, body: "third" },
          ]);
          assert.deepStrictEqual(await firstFinished, ["end() callback", "finish"]);
        } finally {
          close();
        }
      });

      // Guard: a 204 discards the chunk when write() is buffered, and the replay then makes a write that has no chunk.
      test("the replay of a queued response sends the writes it took and skips the write it discarded", async () => {
        let first: ServerResponse;
        const server = createServer((req, res) => {
          if (req.url === "/first") {
            first = res;
          } else if (req.url === "/no-body") {
            res.statusCode = 204;
            res.write("discarded");
            res.end();
          } else {
            res.write("a");
            res.write(Buffer.from("b"));
            res.end(new Uint8Array([99]));
            first.end("first");
          }
        });
        const { port, close } = await serve(server, connection);
        try {
          const wire = await rawRequest(port, pipelined("/first", "/no-body", "/body"));
          assert.deepStrictEqual(answersOf(wire), [
            { status: 200, body: "first" },
            { status: 204, body: "" },
            { status: 200, body: "abc" },
          ]);
        } finally {
          close();
        }
      });

      // Node.js throws ERR_INVALID_ARG_TYPE or ERR_STREAM_NULL_VALUES for these calls. Bun keeps what it did before it checked the chunk: programs give write() an optional string.
      bunOnly("Bun only: write() with no chunk writes nothing", async () => {
        const thrown: Record<string, unknown> = {};
        const server = createServer((req, res) => {
          const write = res.write.bind(res) as (chunk?: unknown) => unknown;
          if (req.url === "/after-a-write") res.write("a");
          thrown[req.url!] = [thrownBy(() => write()), thrownBy(() => write(undefined)), thrownBy(() => write(null))];
          res.end("b");
        });
        const { port, close } = await serve(server, connection);
        try {
          assert.deepStrictEqual(await get(port, "/after-a-write"), { status: 200, body: "ab" });
          assert.deepStrictEqual(await get(port, "/first-call"), { status: 200, body: "b" });
          const silent = ["no throw", "no throw", "no throw"];
          assert.deepStrictEqual(thrown, { "/after-a-write": silent, "/first-call": silent });
        } finally {
          close();
        }
      });

      for (const call of ["end", "write"]) {
        // Node.js has the same order, but it refuses more kinds of chunk, and each of its refusals comes before the head.
        bunOnly(`Bun only: no value makes ${call}() throw after the head`, async () => {
          const thrownAfterHead: string[] = [];
          const server = createServer((req, res) => {
            const { name, encoding } = rows[Number(req.url!.slice(1))];
            try {
              if (encoding) (res as any)[call](values[name](), encoding);
              else (res as any)[call](values[name]());
            } catch (e: any) {
              if (res.headersSent) {
                thrownAfterHead.push(`${name}${encoding ? ", " + encoding : ""}: ${e.code ?? e.name}`);
              }
            }
            try {
              if (!res.writableEnded) res.end();
            } catch {
              res.destroy();
            }
          });
          const { port, close } = await serve(server, connection);
          try {
            await Promise.all(rows.map((_, index) => get(port, `/${index}`).catch(() => {})));
            assert.deepStrictEqual(thrownAfterHead, []);
          } finally {
            close();
          }
        });
      }
    });
  }

  test("over TLS a refused chunk leaves the head unsent too", async () => {
    const seen: Record<string, unknown> = {};
    const server = createHttpsServer(
      { key: readFileSync(join(fixtures, "cert.key")), cert: readFileSync(join(fixtures, "cert.pem")) },
      (req, res) => {
        const thrown = thrownBy(() => (req.url === "/end" ? res.end(123 as any) : res.write(123 as any)));
        seen[req.url!] = { thrown, headersSent: res.headersSent };
        res.statusCode = 500;
        res.end("oops");
      },
    );
    const { port, close } = await serve(server);
    try {
      assert.deepStrictEqual(
        await Promise.all([get(port, "/end", { secure: true }), get(port, "/write", { secure: true })]),
        [
          { status: 500, body: "oops" },
          { status: 500, body: "oops" },
        ],
      );
      assert.deepStrictEqual(seen, {
        "/end": { thrown: wrongNumber, headersSent: false },
        "/write": { thrown: wrongNumber, headersSent: false },
      });
    } finally {
      close();
    }
  });

  test("a head that was stored before the refused chunk is sent as it is", async () => {
    const thrown: Record<string, unknown> = {};
    const server = createServer((req, res) => {
      if (req.url === "/writeHead") res.writeHead(201);
      else if (req.url === "/flushHeaders") res.flushHeaders();
      else res.write("a");
      thrown[req.url!] = thrownBy(() => res.end(123 as any));
      // Too late for the status: the head has it.
      res.statusCode = 500;
      res.end("b");
    });
    const { port, close } = await serve(server);
    try {
      const paths = ["/writeHead", "/flushHeaders", "/write"];
      assert.deepStrictEqual(await Promise.all(paths.map(path => get(port, path))), [
        { status: 201, body: "b" },
        { status: 200, body: "b" },
        { status: 200, body: "ab" },
      ]);
      assert.deepStrictEqual(thrown, {
        "/writeHead": wrongNumber,
        "/flushHeaders": wrongNumber,
        "/write": wrongNumber,
      });
    } finally {
      close();
    }
  });

  // Guard: Node.js judges the encoding where it converts the chunk, after it stored the head. Only the type of the chunk is checked before the head.
  test("an encoding that is not known is still refused after the head", async () => {
    const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
    const server = createServer((req, res) => {
      resolve({ thrown: thrownBy(() => res.end("x", "bogus" as BufferEncoding)), headersSent: res.headersSent });
      res.destroy();
    });
    const { port, close } = await serve(server);
    try {
      await rawRequest(port, pipelined("/")).catch(() => {});
      assert.deepStrictEqual(await promise, {
        thrown: { name: "TypeError", code: "ERR_UNKNOWN_ENCODING", message: "Unknown encoding: bogus" },
        headersSent: true,
      });
    } finally {
      close();
    }
  });

  test("write() on a response with no handle checks the chunk before the status code and before writeHead()", () => {
    const res = new ServerResponse(new IncomingMessage(null as any));
    let calls = 0;
    const writeHead = res.writeHead;
    res.writeHead = function (this: ServerResponse, ...args: any[]) {
      calls++;
      return writeHead.apply(this, args as any);
    } as typeof res.writeHead;
    res.statusCode = 99;
    assert.deepStrictEqual(
      {
        "write(Uint16Array)": thrownBy(() => res.write(new Uint16Array(2) as any)),
        "write(123)": thrownBy(() => res.write(123 as any)),
        calls,
        headersSent: res.headersSent,
      },
      {
        "write(Uint16Array)": wrongType("an instance of Uint16Array"),
        "write(123)": wrongNumber,
        calls: 0,
        headersSent: false,
      },
    );
  });

  describe("a chunk that Node.js refuses and a handle of Bun sends", () => {
    const ok = () => new Uint8Array([111, 107]); // "ok"
    const kinds: [string, () => unknown][] = [
      ["ArrayBuffer", () => ok().buffer],
      [
        "SharedArrayBuffer",
        () => {
          const shared = new SharedArrayBuffer(2);
          new Uint8Array(shared).set(ok());
          return shared;
        },
      ],
      ["String", () => new String("ok")],
      ["DataView", () => new DataView(ok().buffer)],
      ["Uint16Array", () => new Uint16Array(ok().buffer)],
    ];
    const paths = kinds.flatMap((_, index) => [`/${index}/end`, `/${index}/write`]);
    function sendKind(path: string, res: ServerResponse) {
      const [, index, call] = path.split("/");
      const chunk = kinds[Number(index)][1]() as any;
      if (call === "end") return res.end(chunk);
      res.write(chunk);
      res.end();
    }

    // Pin: programs for Bun give these to a response, for example res.end(await blob.arrayBuffer()). The chunk check must not refuse what the native handle sends.
    bunOnly("Bun only: the native handle sends each of them", async () => {
      const { port, close } = await serve(createServer((req, res) => sendKind(req.url!, res)));
      try {
        assert.deepStrictEqual(
          await Promise.all(paths.map(path => get(port, path))),
          paths.map(() => ({ status: 200, body: "ok" })),
        );
      } finally {
        close();
      }
    });

    bunOnly("Bun only: a response that waits behind a pipelined one sends each of them", async () => {
      let first: ServerResponse;
      const server = createServer((req, res) => {
        if (req.url === "/first") {
          first = res;
          return;
        }
        sendKind(req.url!, res);
        if (req.url === paths.at(-1)) first.end("first");
      });
      const { port, close } = await serve(server);
      try {
        const wire = await rawRequest(port, pipelined("/first", ...paths));
        assert.deepStrictEqual(answersOf(wire), [
          { status: 200, body: "first" },
          ...paths.map(() => ({ status: 200, body: "ok" })),
        ]);
      } finally {
        close();
      }
    });

    // The JS handle writes the chunk to a stream, which takes a typed array and a DataView. It refused the other three after the head.
    bunOnly(
      "Bun only: the handle of an emitted connection sends a DataView and a typed array, and refuses the other three before the head",
      async () => {
        const seen: Record<string, unknown> = {};
        const server = createServer((req, res) => {
          seen[req.url!] = { thrown: thrownBy(() => sendKind(req.url!, res)), headersSent: res.headersSent };
          if (res.writableEnded) return;
          res.statusCode = 500;
          res.end("oops");
        });
        const { port, close } = await serve(server, "emitted");
        try {
          const answers = await Promise.all(paths.map(path => get(port, path)));
          assert.deepStrictEqual(
            paths.map((path, index) => ({ ...(seen[path] as object), ...answers[index] })),
            kinds.flatMap(([name]) => {
              const row =
                name === "DataView" || name === "Uint16Array"
                  ? { thrown: "no throw", headersSent: true, status: 200, body: "ok" }
                  : { thrown: wrongType(`an instance of ${name}`), headersSent: false, status: 500, body: "oops" };
              return [row, row];
            }),
          );
        } finally {
          close();
        }
      },
    );

    // Guard: a response with no handle writes through OutgoingMessage, which has the check of Node.js.
    test("a response with no handle refuses each of them, like Node.js", () => {
      const res = new ServerResponse(new IncomingMessage(null as any));
      assert.deepStrictEqual(
        kinds.map(([, chunk]) => thrownBy(() => res.write(chunk() as any))),
        kinds.map(([name]) => wrongType(`an instance of ${name}`)),
      );
    });
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
