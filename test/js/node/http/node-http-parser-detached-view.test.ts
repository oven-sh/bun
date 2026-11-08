/**
 * HTTPParser#execute() with a view whose ArrayBuffer was transferred.
 *
 * Node reads the chunk in C++, where such a view has length 0 and its data pointer is not null:
 * https://github.com/nodejs/node/blob/v26.12.1/src/node_http_parser.cc#L663-L673
 * https://github.com/nodejs/node/blob/v26.12.1/src/util-inl.h#L600-L611
 * So execute() gives llhttp an empty chunk: it returns 0, calls nothing, and the message goes on with the next
 * chunk. A null data pointer is what finish() passes, and finish() ends a body that has no length.
 *
 * This file uses node:test/node:assert so the identical file also runs under
 * `node --test`, which is where the expected values come from (Node.js v26.3.0
 * and v26.12.1). It cannot import from "harness" for the same reason.
 */
import assert from "node:assert";
import { once } from "node:events";
import { createServer, request, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import { Duplex } from "node:stream";
import { describe, test } from "node:test";

const { HTTPParser } = createRequire(import.meta.url)("node:_http_common");

// [name, a function that returns a new view of that kind whose ArrayBuffer was transferred]
const detachedViews: [string, () => NodeJS.ArrayBufferView][] = (
  [
    ["Uint8Array", () => new Uint8Array(8)],
    ["Buffer", () => Buffer.from(new ArrayBuffer(8))],
    ["DataView", () => new DataView(new ArrayBuffer(64), 8, 16)],
  ] as [string, () => NodeJS.ArrayBufferView][]
).map(([name, create]) => [
  name,
  () => {
    const view = create();
    (view.buffer as ArrayBuffer).transfer();
    return view;
  },
]);
const detachedBuffer = detachedViews[1][1];

// The events are the head of each message (the URL of a request or the status of a response, then the
// headers), each body chunk, and the end of each message.
function recordingParser(type: number) {
  const parser = new HTTPParser();
  parser.initialize(type, {});
  const events: unknown[] = [];
  parser[HTTPParser.kOnHeadersComplete] = (
    _major: number,
    _minor: number,
    headers: string[],
    _method: number,
    url?: string,
    statusCode?: number,
  ) => {
    events.push({ head: url ?? statusCode, headers });
  };
  parser[HTTPParser.kOnBody] = (chunk: Buffer) => {
    events.push({ body: chunk.toString() });
  };
  parser[HTTPParser.kOnMessageComplete] = () => {
    events.push("complete");
  };
  return { parser, events };
}

for (const [name, view] of detachedViews) {
  describe(`HTTPParser#execute() of a detached ${name}`, () => {
    test("a new parser returns 0, calls nothing, and then reads a message", () => {
      const { parser, events } = recordingParser(HTTPParser.REQUEST);
      assert.deepStrictEqual([parser.execute(view()), parser.execute(view())], [0, 0]);
      assert.deepStrictEqual(events, []);
      const message = Buffer.from("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
      assert.strictEqual(parser.execute(message), message.length);
      assert.deepStrictEqual(events, [{ head: "/", headers: ["Host", "a"] }, "complete"]);
    });

    test("a URL and a header value split around it arrive whole", () => {
      const { parser, events } = recordingParser(HTTPParser.REQUEST);
      const results = [
        parser.execute(Buffer.from("GET /he")),
        parser.execute(view()),
        parser.execute(Buffer.from("llo HTTP/1.1\r\nHost: exam")),
        parser.execute(view()),
        parser.execute(Buffer.from("ple.com\r\n\r\n")),
      ];
      assert.deepStrictEqual(results, [7, 0, 24, 0, 11]);
      assert.deepStrictEqual(events, [{ head: "/hello", headers: ["Host", "example.com"] }, "complete"]);
    });

    // Only finish() ends a body that has no length. A detached view is not the end of the input.
    test("a response body that runs until EOF ends at finish()", () => {
      const { parser, events } = recordingParser(HTTPParser.RESPONSE);
      const response = Buffer.from("HTTP/1.1 200 OK\r\n\r\nhello");
      assert.strictEqual(parser.execute(response), response.length);
      assert.strictEqual(parser.execute(view()), 0);
      assert.deepStrictEqual(events, [{ head: 200, headers: [] }, { body: "hello" }]);
      assert.strictEqual(parser.finish(), undefined);
      assert.deepStrictEqual(events, [{ head: 200, headers: [] }, { body: "hello" }, "complete"]);
    });

    test("a parser that stopped returns its error, as for an empty view", () => {
      const failed = recordingParser(HTTPParser.REQUEST).parser;
      assert.strictEqual(failed.execute(Buffer.from("NOT A VALID REQUEST\r\n\r\n")).code, "HPE_INVALID_METHOD");
      assert.deepStrictEqual(
        [failed.execute(view()).code, failed.execute(new Uint8Array(0)).code],
        ["HPE_INVALID_METHOD", "HPE_INVALID_METHOD"],
      );

      const paused = recordingParser(HTTPParser.REQUEST).parser;
      assert.strictEqual(paused.execute(Buffer.from("GET / HT")), 8);
      paused.pause();
      assert.strictEqual(paused.execute(view()).code, "HPE_PAUSED");
    });
  });
}

// node:http gives this parser each "data" chunk of a socket.
describe("node:http over a socket that emits a detached chunk", () => {
  test("an http.Server reads the request that follows it", async () => {
    const { promise: url, resolve } = Promise.withResolvers<string | undefined>();
    const server = createServer((req, res) => {
      resolve(req.url);
      res.end();
    });
    const socket = new Duplex({ read() {}, write: (_chunk, _encoding, callback) => callback() });
    server.emit("connection", socket);
    socket.emit("data", detachedBuffer());
    socket.emit("data", Buffer.from("GET /after HTTP/1.1\r\nHost: a\r\n\r\n"));
    assert.strictEqual(await url, "/after");
    socket.destroy();
  });

  test("an http.ClientRequest reads the response that follows it", async () => {
    const { promise: sent, resolve } = Promise.withResolvers<void>();
    const socket = new Duplex({
      read() {},
      write(_chunk, _encoding, callback) {
        callback();
        resolve();
      },
    });
    const req = request({ createConnection: () => socket, host: "example.com", path: "/" });
    const response = once(req, "response");
    req.end();
    await sent;
    socket.emit("data", detachedBuffer());
    socket.emit("data", Buffer.from("HTTP/1.1 204 No Content\r\n\r\n"));
    const [res] = (await response) as [IncomingMessage];
    assert.strictEqual(res.statusCode, 204);
    socket.destroy();
  });
});
