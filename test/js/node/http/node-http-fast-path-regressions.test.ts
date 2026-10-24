import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isCI, isDebug } from "harness";
import http from "node:http";
import path from "node:path";
import { Duplex, getDefaultHighWaterMark } from "node:stream";
import { RawHttpConnection, get, post } from "./raw-http-client";

const fixture = path.join(import.meta.dir, "node-http-fast-path-regressions-fixture.ts");
const timeout = (isASAN || isDebug) && !isCI ? 90_000 : undefined;

const keepAlive = "Connection: keep-alive\r\nKeep-Alive: timeout=5\r\n";
const ok = `HTTP/1.1 200 OK\r\nDate: <date>\r\n${keepAlive}Content-Length: 2\r\n\r\nok`;
const chunkedOk = `HTTP/1.1 200 OK\r\nDate: <date>\r\n${keepAlive}Transfer-Encoding: chunked\r\n\r\n2\r\nok\r\n0\r\n\r\n`;
const hello = `HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 5\r\nDate: <date>\r\n${keepAlive}\r\nhello`;
const warmUp = get("/warm-up");

type Step = string | { untilClose: string };

async function run(scenario: string, steps: Step[]) {
  await using server = Bun.spawn({
    cmd: [bunExe(), fixture, scenario],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = server.stderr.text();
  const reader = server.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  while (!stdout.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value, { stream: true });
  }
  const port = Number(stdout.slice(0, stdout.indexOf("\n")));
  stdout = stdout.slice(stdout.indexOf("\n") + 1);

  const responses: string[] = [];
  {
    using connection = await RawHttpConnection.connect(port);
    for (const step of steps) {
      if (typeof step === "string") {
        responses.push(await connection.request(step));
      } else {
        connection.send(step.untilClose);
        responses.push(await connection.readUntilClose());
      }
    }
  }

  server.stdin.end();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value, { stream: true });
  }
  const exitCode = await server.exited;
  return { responses, ...(stdout ? JSON.parse(stdout) : {}), stderr: await stderr, exitCode };
}

function threeRequests(requestPath = "/") {
  return [get(requestPath), get(requestPath), get(requestPath)];
}

const threeOk = {
  responses: [ok, ok, ok],
  log: [],
  requestsDestroyed: [true, true, true],
  responsesDestroyed: [true, true, true],
  stderr: "",
  exitCode: 0,
};
const oneAfterWarmUp = {
  log: [],
  requestsDestroyed: [true],
  responsesDestroyed: [true],
  stderr: "",
  exitCode: 0,
};

describe.concurrent("node:http server keeps its behavior on keep-alive connections", () => {
  test(
    "server.keepAliveTimeout set to a numeric string",
    async () => {
      expect(await run("string-keep-alive-timeout", threeRequests())).toEqual(threeOk);
    },
    timeout,
  );

  test(
    "writeHead() reads the status message from http.STATUS_CODES",
    async () => {
      const withoutHeaders = chunkedOk.replace("200 OK", "200 Alright");
      const withHeaders = `HTTP/1.1 200 Alright\r\ncontent-length: 2\r\nDate: <date>\r\n${keepAlive}\r\nok`;
      expect(
        await run("replaced-status-message", [get("/"), get("/with-headers"), get("/"), get("/with-headers")]),
      ).toMatchObject({
        responses: [withoutHeaders, withHeaders, withoutHeaders, withHeaders],
        log: [
          ["/", "Alright"],
          ["/with-headers", "Alright"],
          ["/", "Alright"],
          ["/with-headers", "Alright"],
        ],
        stderr: "",
        exitCode: 0,
      });
    },
    timeout,
  );

  test.each([
    ["res.req = null before end()", "null-request-before-end"],
    ["delete res.req before end()", "deleted-request-before-end"],
    ["res.req = null after end()", "null-request-after-end"],
  ])(
    "%s",
    async (title, scenario) => {
      expect(await run(scenario, threeRequests())).toMatchObject({
        responses: [ok, ok, ok],
        responsesDestroyed: [true, true, true],
        stderr: "",
        exitCode: 0,
      });
    },
    timeout,
  );

  test(
    "res.req = null between write() and end()",
    async () => {
      const chunked = chunkedOk.replace("2\r\nok\r\n", "1\r\no\r\n1\r\nk\r\n");
      expect(await run("null-request-between-write-and-end", threeRequests())).toMatchObject({
        responses: [chunked, chunked, chunked],
        responsesDestroyed: [true, true, true],
        stderr: "",
        exitCode: 0,
      });
    },
    timeout,
  );

  test.each([
    ["req.socket.parser = null", "null-socket-parser"],
    ["req.socket.server = null", "null-socket-server"],
  ])(
    "%s",
    async (title, scenario) => {
      expect(await run(scenario, threeRequests())).toEqual(threeOk);
    },
    timeout,
  );

  test(
    "res._events = undefined after an earlier request on the connection",
    async () => {
      expect(await run("undefined-response-events", [warmUp, ...threeRequests()])).toMatchObject({
        responses: [ok, ok, ok, ok],
        responsesDestroyed: [true, true, true],
        stderr: "",
        exitCode: 0,
      });
    },
    timeout,
  );

  test(
    "writeHead() throws ERR_HTTP_HEADERS_SENT once res._header is assigned",
    async () => {
      expect(await run("assigned-header-text", [warmUp, get("/")])).toEqual({
        ...oneAfterWarmUp,
        responses: [ok, "closed"],
        log: [["ERR_HTTP_HEADERS_SENT"]],
      });
    },
    timeout,
  );

  test(
    "res._closed = true before end() leaves the response undestroyed",
    async () => {
      expect(await run("closed-flag-before-end", threeRequests())).toEqual({
        ...threeOk,
        responsesDestroyed: [false, false, false],
      });
    },
    timeout,
  );

  test(
    "writableLength counts only the body when Content-Length is set",
    async () => {
      const shapes = [
        "plain",
        "seven-headers",
        "forty-headers",
        "array-value",
        "removed-header",
        "appended-header",
        "headers-read-first",
      ];
      const paths = shapes.flatMap(shape => [`/${shape}/5`, `/${shape}/40000`]);
      const { log, stderr, exitCode } = await run(
        "writable-length-with-content-length",
        paths.map(requestPath => get(requestPath)),
      );
      expect({ log, stderr, exitCode }).toEqual({
        // The default is 16 KiB on Windows and 64 KiB elsewhere.
        log: paths.map(requestPath => {
          const size = Number(requestPath.split("/")[2]);
          const waits = size > getDefaultHighWaterMark(false);
          return [requestPath, !waits, size, waits];
        }),
        stderr: "",
        exitCode: 0,
      });
    },
    timeout,
  );

  test(
    "the first write() counts toward writableLength and reaches the socket",
    async () => {
      expect(await run("writable-length-after-first-write", threeRequests())).toEqual({
        ...threeOk,
        responses: [hello, hello, hello],
        log: [
          [5, true],
          [5, true],
          [5, true],
        ],
      });
    },
    timeout,
  );

  test(
    "res._headerNames is an empty object after every header is removed",
    async () => {
      expect(await run("header-names-after-removing-every-header", threeRequests())).toEqual({
        ...threeOk,
        log: [[{}], [{}], [{}]],
      });
    },
    timeout,
  );

  test(
    "an empty array as Content-Length sends a chunked body",
    async () => {
      expect(await run("empty-array-content-length", threeRequests())).toEqual({
        ...threeOk,
        responses: [chunkedOk, chunkedOk, chunkedOk],
      });
    },
    timeout,
  );

  test(
    "eventNames() and listenerCount() work before any listener is added",
    async () => {
      const names = [[], ["finish"], 0, 1];
      expect(await run("event-names-without-listeners", threeRequests())).toEqual({
        ...threeOk,
        log: [names, names, names],
      });
    },
    timeout,
  );

  test(
    "the deprecated _headers, _headerNames and _renderHeaders() reflect setHeader()",
    async () => {
      const entries = [
        [
          { "content-type": "Content-Type", "x-a": "X-A" },
          { "content-type": "text/plain", "x-a": "1" },
          { "Content-Type": "text/plain", "X-A": "1" },
        ],
        [{ "x-b": "2" }],
      ];
      const response = `HTTP/1.1 200 OK\r\nx-b: 2\r\nDate: <date>\r\n${keepAlive}Content-Length: 2\r\n\r\nok`;
      expect(await run("deprecated-header-accessors", threeRequests())).toEqual({
        ...threeOk,
        responses: [response, response, response],
        log: [...entries, ...entries, ...entries],
      });
    },
    timeout,
  );

  test(
    "res._contentLength stays null when writeHead() sets Content-Length",
    async () => {
      const response = `HTTP/1.1 200 OK\r\ncontent-length: 2\r\nDate: <date>\r\n${keepAlive}\r\nok`;
      expect(await run("content-length-field", threeRequests())).toEqual({
        ...threeOk,
        responses: [response, response, response],
        log: [[null], [null], [null]],
      });
    },
    timeout,
  );

  test(
    "end(), write() and flushHeaders() call a writeHead() replaced on the response",
    async () => {
      const marked = `HTTP/1.1 200 OK\r\nX-On-Headers: yes\r\nDate: <date>\r\n${keepAlive}`;
      const requests = ["/end", "/write", "/flush-headers"];
      expect(
        await run(
          "replaced-write-head",
          [...requests, ...requests].map(requestPath => get(requestPath)),
        ),
      ).toMatchObject({
        responses: [
          `${marked}Content-Length: 2\r\n\r\nok`,
          `${marked}Transfer-Encoding: chunked\r\n\r\n1\r\no\r\n1\r\nk\r\n0\r\n\r\n`,
          `${marked}Transfer-Encoding: chunked\r\n\r\n2\r\nok\r\n0\r\n\r\n`,
          `${marked}Content-Length: 2\r\n\r\nok`,
          `${marked}Transfer-Encoding: chunked\r\n\r\n1\r\no\r\n1\r\nk\r\n0\r\n\r\n`,
          `${marked}Transfer-Encoding: chunked\r\n\r\n2\r\nok\r\n0\r\n\r\n`,
        ],
        stderr: "",
        exitCode: 0,
      });
    },
    timeout,
  );

  test(
    "writeHead(status, headers) calls a setHeader() replaced on the response",
    async () => {
      const response = `HTTP/1.1 200 OK\r\nx-a: 1\r\ncontent-length: 2\r\nDate: <date>\r\n${keepAlive}\r\nok`;
      expect(await run("replaced-set-header", threeRequests())).toEqual({
        ...threeOk,
        responses: [response, response, response],
        log: [["x-a"], ["content-length"], ["x-a"], ["content-length"], ["x-a"], ["content-length"]],
      });
    },
    timeout,
  );

  test.each(["/", "/immediate"])(
    "an emit() replaced on req and res sees every event of %s",
    async requestPath => {
      const events = [
        ["res prefinish"],
        ["res finish"],
        ["res close"],
        ["req resume"],
        ["req readable"],
        ["req end"],
        ["req close"],
      ];
      expect(await run("replaced-emit", threeRequests(requestPath))).toEqual({
        ...threeOk,
        log: [...events, ...events, ...events],
      });
    },
    timeout,
  );

  test(
    "an emit() replaced on ServerResponse.prototype sees 'socket', 'prefinish', 'finish' and 'close'",
    async () => {
      const events = [["res socket"], ["res prefinish"], ["res finish"], ["res close"]];
      expect(await run("replaced-prototype-emit", threeRequests())).toEqual({
        ...threeOk,
        log: [...events, ...events, ...events],
      });
    },
    timeout,
  );

  test(
    "a detachSocket() replaced after end() is called",
    async () => {
      expect(await run("replaced-detach-socket-after-end", threeRequests())).toEqual({
        ...threeOk,
        log: [["detachSocket"], ["detachSocket"], ["detachSocket"]],
      });
    },
    timeout,
  );

  test(
    "a listener that throws after write() still sends its own response",
    async () => {
      expect(await run("throw-after-write", [warmUp, get("/")])).toEqual({
        ...oneAfterWarmUp,
        responses: [ok, hello],
        log: [["uncaught", "thrown by the request listener"]],
      });
    },
    timeout,
  );

  test(
    "req.socket.end() after write() sends the head and the body first",
    async () => {
      expect(await run("socket-end-after-write", [warmUp, { untilClose: get("/") }])).toEqual({
        ...oneAfterWarmUp,
        responses: [ok, hello],
      });
    },
    timeout,
  );

  test(
    "req.socket.write() after write() does not overtake the head",
    async () => {
      expect(await run("socket-write-after-write", [warmUp, { untilClose: get("/") }])).toEqual({
        ...oneAfterWarmUp,
        responses: [ok, hello + "RAW"],
      });
    },
    timeout,
  );

  test(
    "setHeader() rejects an empty name",
    async () => {
      expect(await run("empty-header-name", threeRequests())).toEqual({
        ...threeOk,
        log: [["ERR_INVALID_HTTP_TOKEN"], ["ERR_INVALID_HTTP_TOKEN"], ["ERR_INVALID_HTTP_TOKEN"]],
      });
    },
    timeout,
  );

  test(
    "end() after req.socket.destroy() neither finishes the response nor calls its callback",
    async () => {
      expect(await run("end-after-socket-destroy", [warmUp, get("/")])).toEqual({
        ...oneAfterWarmUp,
        responses: [ok, "closed"],
        log: [["req aborted"], ["res close"], ["req error ECONNRESET"], ["req close"]],
      });
    },
    timeout,
  );

  test(
    "arrays and objects of one request are not shared with the next",
    async () => {
      const fresh = [2, 0, ["host"], []];
      expect(await run("mutated-request-arrays", threeRequests())).toEqual({
        ...threeOk,
        log: [fresh, fresh, fresh],
      });
    },
    timeout,
  );

  test(
    "res.removeAllListeners() after the body was read keeps the connection usable",
    async () => {
      expect(
        await run("remove-all-listeners-after-body", [post("/", "hello"), post("/", "hello"), post("/", "hello")]),
      ).toEqual(threeOk);
    },
    timeout,
  );
});

test.each([
  [
    "setHeader()",
    (res: http.ServerResponse) => void res.setHeader("X-A", "1"),
    "X-A: 1\r\nConnection: keep-alive\r\nContent-Length: 4\r\n",
  ],
  [
    "writeHead()",
    (res: http.ServerResponse) => void res.writeHead(200, { "content-length": "4" }),
    "content-length: 4\r\nConnection: keep-alive\r\n",
  ],
  [
    "an array and appendHeader()",
    (res: http.ServerResponse) => void res.setHeader("X-A", ["1", "2"]).appendHeader("X-A", "3"),
    "X-A: 1\r\nX-A: 2\r\nX-A: 3\r\nConnection: keep-alive\r\nContent-Length: 4\r\n",
  ],
])("a ServerResponse constructed by the program writes each header once: %s", async (title, setHeaders, headers) => {
  let written = "";
  const socket = new Duplex({
    read() {},
    write(chunk, encoding, callback) {
      written += chunk;
      callback();
    },
  });
  const req = new http.IncomingMessage(socket as any);
  req.method = "GET";
  req.httpVersionMajor = req.httpVersionMinor = 1;
  const res = new http.ServerResponse(req);
  res.assignSocket(socket as any);
  res.sendDate = false;
  setHeaders(res);
  const finished = Promise.withResolvers<void>();
  res.on("finish", finished.resolve);
  res.end("body");
  await finished.promise;
  expect(written).toBe(`HTTP/1.1 200 OK\r\n${headers}\r\nbody`);
});

test("ServerResponse inherits its header getters from OutgoingMessage", () => {
  const names = ["getHeader", "hasHeader", "getHeaderNames", "getRawHeaderNames", "getHeaders"] as const;
  expect(names.filter(name => http.ServerResponse.prototype[name] !== http.OutgoingMessage.prototype[name])).toEqual(
    [],
  );
});

test("IncomingMessage and ServerResponse keep their declared parameter counts", () => {
  expect([http.IncomingMessage.length, http.ServerResponse.length]).toEqual([1, 2]);
});
