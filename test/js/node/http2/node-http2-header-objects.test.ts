/**
 * node copies the caller's headers onto a null-prototype object in request(), respond(),
 * respondWithFile(), respondWithFD(), additionalHeaders(), pushStream() and sendTrailers(). No
 * header name can then come from Object.prototype, and that copy is what the stream hands back.
 *
 * Works with both:
 *   bun bd test test/js/node/http2/node-http2-header-objects.test.ts
 *   node --test test/js/node/http2/node-http2-header-objects.test.ts
 */
import assert from "node:assert";
import dc from "node:diagnostics_channel";
import { once } from "node:events";
import fs from "node:fs";
import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { after, describe, test } from "node:test";

type Headers = Record<string | symbol, any>;
type ServerStream = http2.ServerHttp2Stream & {
  sentHeaders: Headers;
  sentInfoHeaders: Headers[];
  sentTrailers: Headers;
};
type Fail = (reason: unknown) => void;

const { sensitiveHeaders } = http2;
const thisFile = import.meta.filename;
const hasNullPrototype = (value: unknown) => value != null && Object.getPrototypeOf(value) === null;
const isDate = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value));

// One server and one client of it. A fault on the server side rejects every wait of the test.
async function pair(
  onStream: ((stream: ServerStream, headers: Headers, fail: Fail) => void) | null,
  onRequest?: (req: http2.Http2ServerRequest, res: http2.Http2ServerResponse, fail: Fail) => void,
) {
  const { promise: failed, reject: fail } = Promise.withResolvers<never>();
  failed.catch(() => {});
  const closed: Promise<unknown>[] = [];
  const sessions: unknown[] = [];
  const server = http2.createServer();
  server.on("session", session => sessions.push(session));
  server.on("sessionError", fail);
  server.on("stream", (stream, headers) => {
    closed.push(new Promise(resolve => stream.on("close", resolve)));
    stream.on("error", fail);
    try {
      onStream?.(stream as ServerStream, headers, fail);
    } catch (e) {
      fail(e);
    }
  });
  if (onRequest) {
    server.on("request", (req, res) => {
      try {
        onRequest(req, res, fail);
      } catch (e) {
        fail(e);
      }
    });
  }
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const client = http2.connect(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  client.on("error", fail);
  await Promise.race([once(client, "connect"), failed]);
  sessions.push(client);
  return {
    client,
    sessions,
    // Resolves when the stream closes, with what the client received.
    received(req: http2.ClientHttp2Stream) {
      const { promise, resolve, reject } = Promise.withResolvers<{
        info: Headers[];
        headers: Headers;
        trailers: Headers | undefined;
        body: string;
      }>();
      const result = {
        info: [] as Headers[],
        headers: {} as Headers,
        trailers: undefined as Headers | undefined,
        body: "",
      };
      req.setEncoding("utf8");
      req.on("headers", headers => result.info.push(headers));
      req.on("response", headers => (result.headers = headers));
      req.on("trailers", headers => (result.trailers = headers));
      req.on("data", chunk => (result.body += chunk));
      req.on("error", reject);
      req.on("close", () => resolve(result));
      req.end();
      return Promise.race([promise, failed]);
    },
    // Resolves when each server stream is closed.
    settled: () => Promise.race([Promise.all(closed), failed]),
    close() {
      client.destroy();
      server.close();
    },
  };
}

const pollutionExpected = `
request({ ":path": "/x" }) | ":method" enumerable: GET http peer /x
request({ ":path": "/x" }) | ":authority" enumerable: GET http peer /x
request({ ":path": "/x" }) | ":scheme" enumerable: GET http peer /x
request({ ":path": "/x" }) | "host" enumerable: GET http peer /x
request() | ":path" enumerable: GET http peer /
request() | ":path" read-only: GET http peer /
request() | ":method" accessor: GET http peer /
request({ authorization }) | "authorization" read-only: GET http peer /, never indexed: authorization
request({ authorization }) | "authorization" accessor: GET http peer /, never indexed: authorization
request({ cookie }) | "cookie" read-only: GET http peer /, never indexed: cookie
request({ cookie }) | "cookie" accessor: GET http peer /, never indexed: cookie
request({ "x-secret", [http2.sensitiveHeaders]: ["x-secret"] }) | "x-secret" read-only: GET http peer /, never indexed: x-secret
request({ "x-secret", [http2.sensitiveHeaders]: ["x-secret"] }) | "x-secret" accessor: GET http peer /, never indexed: x-secret
respond() | ":status" enumerable: status 200
respond() | ":status" read-only: status 200
respond() | ":status" accessor: status 200
respond() | ":status" out of range: status 200
end("body") | ":status" enumerable: status 200
respondWithFile(path, { a: "1" }) | ":status" enumerable: status 200
respondWithFile(path) | ":status" enumerable: status 200
respondWithFD(fd, { a: "1" }) | ":status" enumerable: status 200
respondWithFD(fd) | ":status" enumerable: status 200
respond({ ":status": 200 }) | "date" enumerable: status 200, with a date
respond({ ":status": 200 }) | "date" read-only: status 200, with a date
additionalHeaders({ ":status": 103 }) | ":pol" enumerable: info 103, status 200
pushStream({ ":path": "/p" }) | "te" enumerable: status 200, push /p
pushStream({ ":path": "/p" }) | "connection" enumerable: status 200, push /p
respond({ ":status": 200 }) | [http2.sensitiveHeaders] enumerable: throws ERR_INVALID_ARG_VALUE, status 200
sendTrailers({ "x-t": "1" }) | [http2.sensitiveHeaders] enumerable: status 200, trailers x-t
`
  .trim()
  .split("\n");

describe("http2 outbound header blocks are null-prototype copies", () => {
  test("reads the caller's object once and does not write to it", async () => {
    const results: Record<string, unknown> = {};
    const counted = (name: string, target: Headers = {}) => {
      let reads = 0;
      Object.defineProperty(target, "x-once", {
        enumerable: true,
        get() {
          reads++;
          return "1";
        },
      });
      return {
        headers: target,
        done: (threw?: string) => void (results[name] = { reads, keys: Reflect.ownKeys(target), threw }),
      };
    };
    const fd = fs.openSync(thisFile, "r");
    const { client, received, settled, close } = await pair((stream, headers, fail) => {
      switch (headers[":path"]) {
        case "/respond": {
          const info = counted("additionalHeaders", { ":status": 103 });
          stream.additionalHeaders(info.headers);
          info.done();
          const response = counted("respond");
          stream.respond(response.headers, { waitForTrailers: true });
          response.done();
          // The stream state is checked before the headers are read.
          const late = counted("respond after the headers are sent");
          try {
            stream.respond(late.headers);
            late.done();
          } catch (e: any) {
            late.done(e.code);
          }
          stream.on("wantTrailers", () => {
            const trailers = counted("sendTrailers");
            stream.sendTrailers(trailers.headers);
            trailers.done();
          });
          stream.end("body");
          break;
        }
        case "/push": {
          const pushHeaders = counted("pushStream");
          stream.pushStream(pushHeaders.headers, (err, pushed) => {
            if (err) return fail(err);
            pushed.respond({ ":status": 200 });
            pushed.end();
          });
          pushHeaders.done();
          stream.respond({ ":status": 200 });
          stream.end();
          break;
        }
        case "/file": {
          const file = counted("respondWithFile");
          stream.on("close", () => file.done());
          stream.respondWithFile(thisFile, file.headers, { length: 4 });
          break;
        }
        case "/fd": {
          const file = counted("respondWithFD");
          stream.on("close", () => file.done());
          stream.respondWithFD(fd, file.headers, { length: 4 });
          break;
        }
        default:
          stream.respond({ ":status": 200 });
          stream.end();
      }
    });
    client.on("stream", pushed => pushed.resume());
    try {
      for (const route of ["/respond", "/push", "/file", "/fd"]) {
        await received(client.request({ ":path": route }));
      }
      const plain = counted("request");
      await received(client.request(plain.headers));
      plain.done();
      const bare = counted("request(null-prototype object)", Object.create(null));
      await received(client.request(bare.headers));
      bare.done();
      // node makes this copy with Object.assign: it does not ask a Proxy for its prototype.
      const traps: string[] = [];
      const proxy = new Proxy<Headers>(
        { "x-proxy": "1" },
        {
          ownKeys: target => (traps.push("ownKeys"), Reflect.ownKeys(target)),
          getOwnPropertyDescriptor: (target, key) => (
            traps.push(`getOwnPropertyDescriptor ${String(key)}`),
            Reflect.getOwnPropertyDescriptor(target, key)
          ),
          get: (target, key) => (traps.push(`get ${String(key)}`), target[key]),
          getPrototypeOf: target => (traps.push("getPrototypeOf"), Reflect.getPrototypeOf(target)),
          has: (target, key) => (traps.push(`has ${String(key)}`), key in target),
        },
      );
      await received(client.request(proxy));
      await settled();

      const once = { reads: 1, keys: ["x-once"], threw: undefined };
      assert.deepStrictEqual(
        { results, traps },
        {
          results: {
            "additionalHeaders": { reads: 1, keys: [":status", "x-once"], threw: undefined },
            "respond": once,
            "respond after the headers are sent": { reads: 0, keys: ["x-once"], threw: "ERR_HTTP2_HEADERS_SENT" },
            "sendTrailers": once,
            "pushStream": once,
            "respondWithFile": once,
            "respondWithFD": once,
            "request": once,
            "request(null-prototype object)": once,
          },
          traps: ["ownKeys", "getOwnPropertyDescriptor x-proxy", "get x-proxy"],
        },
      );
    } finally {
      close();
      fs.closeSync(fd);
    }
  });

  test("every header object that a stream hands back has a null prototype", async () => {
    const seen: Record<string, boolean> = {};
    const note = (name: string, headers: unknown) => void (seen[name] = hasNullPrototype(headers));
    // Other sessions of this process publish on the same channels. A closed stream has no session.
    let sessions: unknown[] = [];
    const published: Record<string, unknown[]> = {};
    const onMessage = (message: any, name: string | symbol) => {
      if (sessions.includes(message.stream.session)) (published[String(name)] ??= []).push(message.headers);
    };
    const channels = [
      "http2.client.stream.created",
      "http2.client.stream.start",
      "http2.server.stream.created",
      "http2.server.stream.start",
      "http2.server.stream.finish",
    ];
    const fd = fs.openSync(thisFile, "r");
    const core = await pair((stream, headers, fail) => {
      const file = (name: string) => ({
        length: 4,
        statCheck: (stat: fs.Stats, statHeaders: Headers) => note(`statCheck headers of ${name}`, statHeaders),
      });
      switch (headers[":path"]) {
        case "/respond":
          stream.additionalHeaders({ ":status": 103 });
          note("sentInfoHeaders[0]", stream.sentInfoHeaders[0]);
          stream.respond({ ":status": 200 }, { waitForTrailers: true });
          note("sentHeaders after respond(headers)", stream.sentHeaders);
          stream.on("wantTrailers", () => {
            stream.sendTrailers({ "x-t": "1" });
            note("sentTrailers after sendTrailers(headers)", stream.sentTrailers);
          });
          stream.end("body");
          break;
        case "/bare":
          stream.respond(undefined, { waitForTrailers: true });
          note("sentHeaders after respond()", stream.sentHeaders);
          stream.on("wantTrailers", () => {
            // @ts-expect-error The types ask for the headers.
            stream.sendTrailers();
            note("sentTrailers after sendTrailers()", stream.sentTrailers);
          });
          stream.end("body");
          break;
        case "/end":
          stream.on("close", () => note("sentHeaders after end() alone", stream.sentHeaders));
          stream.end("body");
          break;
        case "/trailers-nobody-sends":
          stream.on("close", () => note("sentTrailers with no 'wantTrailers' listener", stream.sentTrailers));
          stream.respond({ ":status": 200 }, { waitForTrailers: true });
          stream.end("body");
          break;
        case "/file":
          stream.on("close", () => note("sentHeaders after respondWithFile(path, headers)", stream.sentHeaders));
          stream.respondWithFile(thisFile, { a: "1" }, file("respondWithFile(path, headers)"));
          break;
        case "/file-bare":
          stream.on("close", () => note("sentHeaders after respondWithFile(path)", stream.sentHeaders));
          stream.respondWithFile(thisFile, undefined, file("respondWithFile(path)"));
          break;
        case "/fd":
          stream.on("close", () => note("sentHeaders after respondWithFD(fd, headers)", stream.sentHeaders));
          stream.respondWithFD(fd, { a: "1" }, file("respondWithFD(fd, headers)"));
          break;
        case "/fd-bare":
          stream.on("close", () => note("sentHeaders after respondWithFD(fd)", stream.sentHeaders));
          stream.respondWithFD(fd, undefined, file("respondWithFD(fd)"));
          break;
        case "/push":
        case "/push-bare": {
          const name = headers[":path"] === "/push" ? "pushStream(headers)" : "pushStream(undefined)";
          stream.pushStream(headers[":path"] === "/push" ? { ":path": "/pushed" } : undefined!, (err, pushed, sent) => {
            if (err) return fail(err);
            note(`callback headers of ${name}`, sent);
            note(`sentHeaders of the stream of ${name}`, (pushed as ServerStream).sentHeaders);
            pushed.respond({ ":status": 200 });
            pushed.end();
          });
          stream.respond({ ":status": 200 });
          stream.end();
          break;
        }
        case "/info-bare":
          // A 1xx block with no headers is not valid, and the peer resets the stream.
          stream.off("error", fail).on("error", () => {});
          // @ts-expect-error The types ask for the headers.
          stream.additionalHeaders();
          note("sentInfoHeaders[0] after additionalHeaders()", stream.sentInfoHeaders[0]);
          stream.close();
          break;
        default:
          stream.respond({ ":status": 200 });
          stream.end();
      }
    });
    // The compat API keeps its headers and trailers on null-prototype objects of its own.
    const compat = await pair(null, (req, res, fail) => {
      const stream = res.stream as ServerStream;
      res.setHeader("x-a", "1");
      if (req.url === "/trailers") {
        res.addTrailers({ "x-t": "1" });
        stream.on("close", () => note("compat: sentTrailers after res.addTrailers()", stream.sentTrailers));
      } else if (req.url === "/push") {
        res.createPushResponse({ ":path": "/pushed" }, (err, pushResponse) => {
          if (err) return fail(err);
          note(
            "compat: sentHeaders of the stream of res.createPushResponse()",
            (pushResponse.stream as ServerStream).sentHeaders,
          );
          pushResponse.end();
        });
      } else {
        stream.on("close", () => note("compat: sentHeaders after res.end()", stream.sentHeaders));
      }
      res.end("body");
    });
    sessions = core.sessions;
    for (const { client } of [core, compat]) client.on("stream", pushed => pushed.resume());
    for (const name of channels) dc.subscribe(name, onMessage);
    try {
      const req = core.client.request({ ":path": "/respond" });
      note("sentHeaders after request(headers)", req.sentHeaders);
      await core.received(req);
      const bare = core.client.request();
      note("sentHeaders after request()", bare.sentHeaders);
      await core.received(bare);
      const fromNullPrototype = core.client.request(Object.assign(Object.create(null), { ":path": "/x" }));
      note("sentHeaders after request(null-prototype object)", fromNullPrototype.sentHeaders);
      await core.received(fromNullPrototype);
      for (const route of [
        "/bare",
        "/end",
        "/trailers-nobody-sends",
        "/file",
        "/file-bare",
        "/fd",
        "/fd-bare",
        "/push",
        "/push-bare",
      ]) {
        await core.received(core.client.request({ ":path": route }));
      }
      for (const route of ["/end", "/trailers", "/push"]) {
        await compat.received(compat.client.request({ ":path": route }));
      }
      const reset = core.client.request({ ":path": "/info-bare" });
      reset.on("error", () => {});
      reset.end();
      await new Promise(resolve => reset.on("close", resolve));
      await core.settled();
      await compat.settled();
      for (const name of channels) {
        seen[`every ${name} message`] = published[name]?.every(hasNullPrototype) ?? false;
      }

      core.client.destroy();
      const callerHeaders = { ":path": "/never-sent" };
      const dead = core.client.request(callerHeaders);
      dead.on("error", () => {});
      note("sentHeaders after request(headers) on a destroyed session", dead.sentHeaders);

      assert.deepStrictEqual(seen, {
        "sentInfoHeaders[0]": true,
        "sentHeaders after respond(headers)": true,
        "sentHeaders after request(headers)": true,
        "sentTrailers after sendTrailers(headers)": true,
        "sentHeaders after request()": true,
        "sentHeaders after request(null-prototype object)": true,
        "sentHeaders after respond()": true,
        "sentTrailers after sendTrailers()": true,
        "sentHeaders after end() alone": true,
        "sentTrailers with no 'wantTrailers' listener": true,
        "statCheck headers of respondWithFile(path, headers)": true,
        "sentHeaders after respondWithFile(path, headers)": true,
        "statCheck headers of respondWithFile(path)": true,
        "sentHeaders after respondWithFile(path)": true,
        "statCheck headers of respondWithFD(fd, headers)": true,
        "sentHeaders after respondWithFD(fd, headers)": true,
        "statCheck headers of respondWithFD(fd)": true,
        "sentHeaders after respondWithFD(fd)": true,
        "callback headers of pushStream(headers)": true,
        "sentHeaders of the stream of pushStream(headers)": true,
        "callback headers of pushStream(undefined)": true,
        "sentHeaders of the stream of pushStream(undefined)": true,
        "compat: sentHeaders after res.end()": true,
        "compat: sentTrailers after res.addTrailers()": true,
        "compat: sentHeaders of the stream of res.createPushResponse()": true,
        "sentInfoHeaders[0] after additionalHeaders()": true,
        "every http2.client.stream.created message": true,
        "every http2.client.stream.start message": true,
        "every http2.server.stream.created message": true,
        "every http2.server.stream.start message": true,
        "every http2.server.stream.finish message": true,
        "sentHeaders after request(headers) on a destroyed session": true,
      });
      assert.notStrictEqual(dead.sentHeaders, callerHeaders);
      assert.strictEqual(dead.sentHeaders[":path"], "/never-sent");
    } finally {
      for (const name of channels) dc.unsubscribe(name, onMessage);
      core.close();
      compat.close();
      fs.closeSync(fd);
    }
  });

  // node prepares the block before it looks at the session. Bun returns early for a destroyed
  // session and copies only the object form there.
  test(
    "request() on a destroyed session hands back a null-prototype object for each form",
    { todo: process.versions.bun ? "the raw-list form hands back the caller's array, the bare form undefined" : false },
    async () => {
      const { client, close } = await pair(null);
      try {
        client.destroy();
        const raw = client.request([":path", "/x"] as any).on("error", () => {});
        const bare = client.request().on("error", () => {});
        assert.deepStrictEqual(
          { raw: hasNullPrototype(raw.sentHeaders), bare: hasNullPrototype(bare.sentHeaders) },
          { raw: true, bare: true },
        );
      } finally {
        close();
      }
    },
  );

  // The never-index list is `headers[http2.sensitiveHeaders]`: names that HPACK must not put in
  // its table. The peer gets them back under the same symbol. Each block has a value of its own:
  // HPACK sends a value that is in its table as a reference, with no never-index flag.
  test("the never-index names of each block reach the peer", async () => {
    const fd = fs.openSync(thisFile, "r");
    let unique = 0;
    const inherits = (own: Headers) => Object.assign(Object.create({ [sensitiveHeaders]: ["x-secret"] }), own);
    const pushed: Record<string, unknown> = {};
    const requests: Record<string, unknown> = {};
    // A name that Object.prototype has too, in a block that lists it.
    const named = (name: string, first: Headers = {}) => ({
      ...first,
      [name]: `v${unique++}`,
      [sensitiveHeaders]: [name],
    });
    const { client, received, close } = await pair((stream, headers, fail) => {
      const route = headers[":path"] as string;
      requests[route] = headers[sensitiveHeaders];
      switch (route) {
        case "/listed":
          stream.additionalHeaders({ ":status": 103, "x-info": "i", [sensitiveHeaders]: ["X-Info"] });
          stream.respond(
            { ":status": 200, "x-response": "r", [sensitiveHeaders]: ["X-Response"] },
            { waitForTrailers: true },
          );
          stream.on("wantTrailers", () => stream.sendTrailers({ "x-trailer": "t", [sensitiveHeaders]: ["X-Trailer"] }));
          stream.end("body");
          break;
        // nghttp2 never indexes these two, with or without a list.
        case "/implicit":
          stream.additionalHeaders({ ":status": 103, authorization: "a", cookie: "short" });
          stream.respond({ ":status": 200 }, { waitForTrailers: true });
          stream.on("wantTrailers", () => stream.sendTrailers({ authorization: "b", cookie: "brief" }));
          stream.end("body");
          break;
        case "/__proto__":
        case "/constructor": {
          const name = route.slice(1);
          stream.pushStream(named(name, { ":path": `/pushed${route}` }), (err, pushStream) => {
            if (err) return fail(err);
            pushStream.respond({ ":status": 200 });
            pushStream.end();
          });
          stream.additionalHeaders(named(name, { ":status": 103 }));
          stream.respond(named(name), { waitForTrailers: true });
          stream.on("wantTrailers", () => stream.sendTrailers(named(name)));
          stream.end("body");
          break;
        }
        case "/file":
          stream.respondWithFile(thisFile, named("__proto__"), { length: 4 });
          break;
        case "/fd":
          stream.respondWithFD(fd, named("__proto__"), { length: 4 });
          break;
        // node reads the list of a response through the caller's object, so an inherited list counts.
        case "/inherited":
          stream.respond(inherits({ "x-secret": "g1" }));
          stream.end("body");
          break;
        case "/inherited-file":
          stream.respondWithFile(thisFile, inherits({ "x-secret": "g2" }), { length: 4 });
          break;
        case "/inherited-fd":
          stream.respondWithFD(fd, inherits({ "x-secret": "g3" }), { length: 4 });
          break;
      }
    });
    client.on("stream", (pushStream, headers) => {
      pushed[headers[":path"] as string] = headers[sensitiveHeaders];
      pushStream.resume();
    });
    try {
      const seen: Record<string, unknown> = {};
      for (const route of [
        "/listed",
        "/implicit",
        "/__proto__",
        "/constructor",
        "/file",
        "/fd",
        "/inherited",
        "/inherited-file",
        "/inherited-fd",
      ]) {
        const isNamed = route === "/__proto__" || route === "/constructor";
        const request = isNamed ? named(route.slice(1), { ":path": route }) : { ":path": route };
        const { info, headers, trailers } = await received(client.request(request));
        seen[route] = {
          request: requests[route],
          info: info[0]?.[sensitiveHeaders],
          response: headers[sensitiveHeaders],
          trailers: trailers?.[sensitiveHeaders],
        };
      }
      assert.deepStrictEqual(
        { seen, pushed },
        {
          seen: {
            "/listed": { request: [], info: ["x-info"], response: ["x-response"], trailers: ["x-trailer"] },
            "/implicit": {
              request: [],
              info: ["authorization", "cookie"],
              response: [],
              trailers: ["authorization", "cookie"],
            },
            "/__proto__": {
              request: ["__proto__"],
              info: ["__proto__"],
              response: ["__proto__"],
              trailers: ["__proto__"],
            },
            "/constructor": {
              request: ["constructor"],
              info: ["constructor"],
              response: ["constructor"],
              trailers: ["constructor"],
            },
            "/file": { request: [], info: undefined, response: ["__proto__"], trailers: undefined },
            "/fd": { request: [], info: undefined, response: ["__proto__"], trailers: undefined },
            "/inherited": { request: [], info: undefined, response: ["x-secret"], trailers: undefined },
            "/inherited-file": { request: [], info: undefined, response: ["x-secret"], trailers: undefined },
            "/inherited-fd": { request: [], info: undefined, response: ["x-secret"], trailers: undefined },
          },
          pushed: { "/pushed/__proto__": ["__proto__"], "/pushed/constructor": ["constructor"] },
        },
      );
    } finally {
      close();
      fs.closeSync(fd);
    }
  });

  describe("with a name on Object.prototype", () => {
    // The names that the test has on Object.prototype at this moment.
    const inherited = new Set<string | symbol>();
    let over = false;
    const removeAll = () => {
      for (const key of inherited) delete (Object.prototype as Headers)[key];
      inherited.clear();
    };
    // A test that timed out did not reach its `finally`, and its rows can still run later.
    after(() => {
      over = true;
      removeAll();
    });

    // Each row puts one header name on Object.prototype for the time of one call that builds a header
    // block, and notes what the other end of the session receives. `how` is the property:
    // "enumerable" is a data property, "read-only" is one that is not writable, "accessor" has a
    // getter and a setter. The expected text is what node v26.3.0 notes.
    test("a header name on Object.prototype does not reach a header block", async () => {
      type Case = {
        call: string;
        key: string | symbol;
        value: unknown;
        how?: string[];
        request?: (client: http2.ClientHttp2Session) => http2.ClientHttp2Stream;
        // Answers the request. When it throws, the stream still answers with a 200.
        serve?: (stream: ServerStream, failed: Fail, polluted: (call: () => void) => void) => void;
        // A file response sends its headers after it has opened the file: the name stays until the stream closes.
        untilClose?: true;
        // The row makes its call in a later turn, inside `polluted()`.
        late?: true;
      };
      type Row = Omit<Case, "how"> & { how: string };
      const ownBefore = Reflect.ownKeys(Object.prototype);
      const fd = fs.openSync(thisFile, "r");
      let setterCalls = 0;
      // Each value is new: HPACK sends a value that is in its table as a reference, with no never-index flag.
      let unique = 0;
      const put = ({ key, value, how }: Row) => {
        if (over) throw new Error("the test is over");
        inherited.add(key);
        Object.defineProperty(
          Object.prototype,
          key,
          how === "accessor"
            ? { configurable: true, get: () => value, set: () => void setterCalls++ }
            : { configurable: true, value, enumerable: true, writable: how !== "read-only" },
        );
      };
      const remove = ({ key }: Row) => {
        inherited.delete(key);
        delete (Object.prototype as Headers)[key];
      };
      const respondThenEnd = (stream: ServerStream) => {
        stream.respond({ ":status": 200 });
        stream.end("body");
      };
      const push = (stream: ServerStream, failed: Fail) => {
        stream.pushStream({ ":path": "/p" }, (err, pushed) => {
          if (err) return failed(err);
          pushed.respond({ ":status": 200 });
          pushed.end("pushed");
        });
        respondThenEnd(stream);
      };
      const cases: Case[] = [
        {
          call: 'request({ ":path": "/x" })',
          key: ":method",
          value: "DELETE",
          request: c => c.request({ ":path": "/x" }),
        },
        {
          call: 'request({ ":path": "/x" })',
          key: ":authority",
          value: "evil.example",
          request: c => c.request({ ":path": "/x" }),
        },
        {
          call: 'request({ ":path": "/x" })',
          key: ":scheme",
          value: "https",
          request: c => c.request({ ":path": "/x" }),
        },
        {
          call: 'request({ ":path": "/x" })',
          key: "host",
          value: "evil.example",
          request: c => c.request({ ":path": "/x" }),
        },
        { call: "request()", key: ":path", value: "/pol", how: ["enumerable", "read-only"], request: c => c.request() },
        { call: "request()", key: ":method", value: "DELETE", how: ["accessor"], request: c => c.request() },
        // The names that HPACK must never index are kept by name too.
        {
          call: "request({ authorization })",
          key: "authorization",
          value: "polluted",
          how: ["read-only", "accessor"],
          request: c => c.request({ authorization: `a${unique++}` }),
        },
        {
          call: "request({ cookie })",
          key: "cookie",
          value: "polluted",
          how: ["read-only", "accessor"],
          request: c => c.request({ cookie: `c=${unique++}` }),
        },
        {
          call: 'request({ "x-secret", [http2.sensitiveHeaders]: ["x-secret"] })',
          key: "x-secret",
          value: "polluted",
          how: ["read-only", "accessor"],
          request: c => c.request({ "x-secret": `s${unique++}`, [sensitiveHeaders]: ["x-secret"] }),
        },
        {
          call: "respond()",
          key: ":status",
          value: 302,
          how: ["enumerable", "read-only", "accessor"],
          serve: stream => {
            stream.respond();
            stream.end("body");
          },
        },
        // A status that is out of range makes respond() throw.
        {
          call: "respond()",
          key: ":status",
          value: 700,
          how: ["out of range"],
          serve: stream => {
            stream.respond();
            stream.end("body");
          },
        },
        { call: 'end("body")', key: ":status", value: 302, serve: stream => stream.end("body") },
        {
          call: 'respondWithFile(path, { a: "1" })',
          key: ":status",
          value: 302,
          untilClose: true,
          serve: stream => stream.respondWithFile(thisFile, { a: "1" }, { length: 4 }),
        },
        {
          call: "respondWithFile(path)",
          key: ":status",
          value: 302,
          untilClose: true,
          serve: stream => stream.respondWithFile(thisFile, undefined, { length: 4 }),
        },
        {
          call: 'respondWithFD(fd, { a: "1" })',
          key: ":status",
          value: 302,
          untilClose: true,
          serve: stream => stream.respondWithFD(fd, { a: "1" }, { length: 4 }),
        },
        {
          call: "respondWithFD(fd)",
          key: ":status",
          value: 302,
          untilClose: true,
          serve: stream => stream.respondWithFD(fd, undefined, { length: 4 }),
        },
        {
          call: 'respond({ ":status": 200 })',
          key: "date",
          value: "polluted",
          how: ["enumerable", "read-only"],
          serve: respondThenEnd,
        },
        {
          call: 'additionalHeaders({ ":status": 103 })',
          key: ":pol",
          value: "1",
          serve: stream => {
            stream.additionalHeaders({ ":status": 103 });
            respondThenEnd(stream);
          },
        },
        { call: 'pushStream({ ":path": "/p" })', key: "te", value: "gzip", serve: push },
        { call: 'pushStream({ ":path": "/p" })', key: "connection", value: "close", serve: push },
        // node reads the never-index list of a response through the caller's object, and that of
        // every other block from the copy. The list must be an array.
        { call: 'respond({ ":status": 200 })', key: sensitiveHeaders, value: "not an array", serve: respondThenEnd },
        {
          call: 'sendTrailers({ "x-t": "1" })',
          key: sensitiveHeaders,
          value: "not an array",
          late: true,
          serve: (stream, failed, polluted) => {
            stream.respond({ ":status": 200 }, { waitForTrailers: true });
            stream.on("wantTrailers", () => {
              try {
                polluted(() => stream.sendTrailers({ "x-t": "1" }));
              } catch (e) {
                failed(e);
                stream.close();
              }
            });
            stream.end("body");
          },
        },
      ];
      const rows = cases.flatMap(c => (c.how ?? ["enumerable"]).map((how): Row => ({ ...c, how })));
      // The name is on Object.prototype while `call` runs, and not after that.
      const during = <T>(row: Row, call: () => T): T => {
        put(row);
        try {
          return call();
        } finally {
          remove(row);
        }
      };

      // `serving` is the server row in progress. With none, the server answers with what it received.
      let serving: ((stream: ServerStream) => void) | undefined;
      const { client, received, settled, close } = await pair((stream, headers) => {
        if (serving) return serving(stream);
        const list = headers[sensitiveHeaders] ?? [];
        stream.respond({ ":status": 200 });
        stream.end(
          [headers[":method"], headers[":scheme"], headers[":authority"], headers[":path"]].join(" ") +
            (list.length ? `, never indexed: ${list}` : ""),
        );
      });
      const pushes: string[] = [];
      client.on("stream", (pushed, headers) => {
        pushed.resume();
        pushes.push(`push ${headers[":path"]}`);
      });
      try {
        const lines: string[] = [];
        for (const row of rows) {
          let text: string;
          if (row.request) {
            setterCalls = 0;
            try {
              const req = during(row, () => row.request!(client));
              text = await received(req).then(
                ({ body }) => body.replace(/ 127\.0\.0\.1:\d+ /, " peer "),
                e => `error ${e.code}`,
              );
            } catch (e: any) {
              text = `throws ${e.code ?? e.name}`;
            }
            if (setterCalls) text += `, setter calls: ${setterCalls}`;
          } else {
            pushes.length = 0;
            let threw: string | undefined;
            const failed: Fail = (e: any) => void (threw = `throws ${e.code ?? e}`);
            const polluted = (call: () => void) => during(row, call);
            serving = stream => {
              try {
                if (row.late) return row.serve!(stream, failed, polluted);
                if (!row.untilClose) return polluted(() => row.serve!(stream, failed, polluted));
                put(row);
                stream.on("close", () => remove(row));
                row.serve!(stream, failed, polluted);
              } catch (e) {
                failed(e);
                remove(row);
                respondThenEnd(stream);
              }
            };
            // The request is made before the name is on Object.prototype.
            const seen = await received(client.request({ ":path": "/" })).then(
              ({ info, headers, trailers }) => [
                ...info.map(informational => `info ${informational[":status"]}`),
                `status ${headers[":status"]}`,
                ...(row.key !== "date" ? [] : [isDate(headers.date) ? "with a date" : `date ${headers.date}`]),
                ...(trailers ? [`trailers ${Object.keys(trailers)}`] : []),
              ],
              e => [`error ${e.code}`],
            );
            await settled();
            serving = undefined;
            text = [...(threw ? [threw] : []), ...seen, ...pushes].join(", ");
          }
          const name = typeof row.key === "symbol" ? "[http2.sensitiveHeaders]" : JSON.stringify(row.key);
          lines.push(`${row.call} | ${name} ${row.how}: ${text}`);
        }
        assert.deepStrictEqual(
          { lines, left: Reflect.ownKeys(Object.prototype).filter(key => !ownBefore.includes(key)) },
          { lines: pollutionExpected, left: [] },
        );
      } finally {
        removeAll();
        close();
        fs.closeSync(fd);
      }
    });
  });
});
