// A node:http2 header call that fails must leave the connection's HPACK encoder table in step
// with the peer. The peer mirrors every insertion, so a field may enter the table only when
// its block is sent.
import { describe, expect, it } from "bun:test";
import http2 from "node:http2";
import net from "node:net";

// A header call that throws on validation must leave the connection's HPACK encoder table in
// step with the peer. Before the fix, the fields before the invalid one were already inserted
// into the dynamic table (and never sent), so every later header block on the connection decoded
// against the wrong entries: the next response carried a header from an earlier stream, then the
// session died with a protocol error.
describe("http2 a header call that throws leaves the HPACK encoder in sync with the peer", () => {
  class Boom extends Error {
    code = "BOOM";
  }
  const throwingToString = {
    toString() {
      throw new Boom("boom");
    },
  };
  // Each poison has two valid fields (which used to reach the table) before the invalid one, and
  // the error the call reports for it.
  const poisons = {
    "invalid value": {
      headers: { "x-a": "AAAA", "x-b": "BBBB", "x-v": "a\r\nb" },
      error: "ERR_HTTP2_INVALID_HEADER_VALUE",
    },
    "invalid array element": {
      headers: { "x-a": "AAAA", "x-b": "BBBB", "x-v": ["ok", "a\nb"] },
      error: "ERR_HTTP2_INVALID_HEADER_VALUE",
    },
    "invalid name": { headers: { "x-a": "AAAA", "x-b": "BBBB", "bad name": "v" }, error: "ERR_INVALID_HTTP_TOKEN" },
    "undefined value": {
      headers: { "x-a": "AAAA", "x-b": "BBBB", "x-u": undefined },
      error: "ERR_HTTP2_INVALID_HEADER_VALUE",
    },
    "null value": { headers: { "x-a": "AAAA", "x-b": "BBBB", "x-n": null }, error: "ERR_HTTP2_INVALID_HEADER_VALUE" },
    "symbol value": { headers: { "x-a": "AAAA", "x-b": "BBBB", "x-s": Symbol("s") }, error: "TypeError" },
    "throwing toString": { headers: { "x-a": "AAAA", "x-b": "BBBB", "x-t": throwingToString }, error: "BOOM" },
  };
  const kinds = Object.keys(poisons);
  // respond() drops a string value with CR/LF/NUL instead of throwing, so those two kinds do not
  // apply to it. pushStream() skips an undefined or null value (node's mapToHeaders does the same).
  const respondKinds = kinds.filter(k => k !== "invalid value" && k !== "invalid array element");
  const pushKinds = kinds.filter(k => k !== "undefined value" && k !== "null value");
  const errorOf = err => err.code ?? err.constructor.name;
  const cleanResponse = { ":status": 200, "x-clean": "clean-value", "content-type": "text/plain" };

  async function withServer(onStream, run, createServer = http2.createServer) {
    const server = createServer();
    server.on("stream", onStream);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    const sessionErrors: any[] = [];
    client.on("error", (err: any) => sessionErrors.push(err.code));
    try {
      return await run(client, sessionErrors);
    } finally {
      client.destroy();
      server.close();
    }
  }

  // One request on `client`: resolves with the response headers (no date), the trailers, and the body.
  function get(
    client: any,
    path: string,
    reqHeaders: any = {},
    onRequest: (req: any) => void = () => {},
    reqOptions: any = undefined,
  ) {
    const { promise, resolve, reject } = Promise.withResolvers<any>();
    const result: any = { headers: null, trailers: null, body: "" };
    const req = client.request({ ":path": path, ...reqHeaders }, reqOptions);
    // Object.entries drops the sensitiveHeaders symbol key.
    req.on("response", headers => {
      delete headers.date;
      result.headers = Object.fromEntries(Object.entries(headers));
    });
    req.on("trailers", trailers => (result.trailers = Object.fromEntries(Object.entries(trailers))));
    req.setEncoding("utf8");
    req.on("data", chunk => (result.body += chunk));
    req.on("error", reject);
    req.on("close", () => resolve(result));
    onRequest(req);
    return promise;
  }

  const clean = { headers: cleanResponse, trailers: null, body: "c" };
  const serveClean = stream => {
    stream.respond(cleanResponse);
    stream.end("c");
  };

  it.each(kinds)("additionalHeaders() that throws on an %s", async kind => {
    const thrown: any[] = [];
    await withServer(
      (stream, headers) => {
        if (headers[":path"] !== "/poison") return serveClean(stream);
        try {
          stream.additionalHeaders({ ":status": 103, ...poisons[kind].headers });
        } catch (err: any) {
          thrown.push(errorOf(err));
        }
        stream.respond({ ":status": 200, "x-after-info": "1" });
        stream.end("p");
      },
      async (client, sessionErrors) => {
        expect(await get(client, "/clean1")).toEqual(clean);
        expect(await get(client, "/poison")).toEqual({
          headers: { ":status": 200, "x-after-info": "1" },
          trailers: null,
          body: "p",
        });
        expect(await get(client, "/clean2")).toEqual(clean);
        expect(thrown).toEqual([poisons[kind].error]);
        expect(sessionErrors).toEqual([]);
      },
    );
  });

  it.each(respondKinds)("respond() that throws on a %s", async kind => {
    const thrown: any[] = [];
    await withServer(
      (stream, headers) => {
        if (headers[":path"] !== "/poison") return serveClean(stream);
        try {
          stream.respond({ ":status": 200, ...poisons[kind].headers, "x-c": "CCCC" });
        } catch (err: any) {
          thrown.push(errorOf(err));
        }
        stream.respond({ ":status": 503, "x-fallback": "1" });
        stream.end("p");
      },
      async (client, sessionErrors) => {
        expect(await get(client, "/clean1")).toEqual(clean);
        expect(await get(client, "/poison")).toEqual({
          headers: { ":status": 503, "x-fallback": "1" },
          trailers: null,
          body: "p",
        });
        expect(await get(client, "/clean2")).toEqual(clean);
        expect(thrown).toEqual([poisons[kind].error]);
        expect(sessionErrors).toEqual([]);
      },
    );
  });

  // The compat layer's setHeader() accepts a Symbol or an object whose toString throws, and the
  // implicit respond() inside res.end() is where the value fails.
  it.each(["symbol value", "throwing toString"])(
    "compat res.end() whose implicit respond() throws on a %s",
    async kind => {
      const thrown: any[] = [];
      await withServer(
        () => {},
        async (client, sessionErrors) => {
          expect(await get(client, "/clean1")).toEqual(clean);
          expect(await get(client, "/poison")).toEqual({
            headers: { ":status": 503, "x-fallback": "1" },
            trailers: null,
            body: "p",
          });
          expect(await get(client, "/clean2")).toEqual(clean);
          expect(thrown).toEqual([poisons[kind].error]);
          expect(sessionErrors).toEqual([]);
        },
        () =>
          http2.createServer((req, res) => {
            if (req.url !== "/poison") {
              res.writeHead(200, { "x-clean": "clean-value", "content-type": "text/plain" });
              res.end("c");
              return;
            }
            for (const [name, value] of Object.entries(poisons[kind].headers)) res.setHeader(name, value);
            try {
              res.end("never sent");
            } catch (err: any) {
              thrown.push(errorOf(err));
            }
            req.stream.respond({ ":status": 503, "x-fallback": "1" });
            req.stream.end("p");
          }),
      );
    },
  );

  it.each(kinds)("server sendTrailers() that throws on an %s", async kind => {
    const thrown: any[] = [];
    await withServer(
      (stream, headers) => {
        if (headers[":path"] !== "/poison") return serveClean(stream);
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        stream.on("wantTrailers", () => {
          try {
            stream.sendTrailers(poisons[kind].headers);
          } catch (err: any) {
            thrown.push(errorOf(err));
          }
          stream.sendTrailers({ "x-t": "v2" });
        });
        stream.end("p");
      },
      async (client, sessionErrors) => {
        expect(await get(client, "/clean1")).toEqual(clean);
        expect(await get(client, "/poison")).toEqual({
          headers: { ":status": 200 },
          trailers: { "x-t": "v2" },
          body: "p",
        });
        expect(await get(client, "/clean2")).toEqual(clean);
        expect(thrown).toEqual([poisons[kind].error]);
        expect(sessionErrors).toEqual([]);
      },
    );
  });

  it.each(kinds)("client sendTrailers() that throws on an %s", async kind => {
    const thrown: any[] = [];
    const seenTrailers: any[] = [];
    await withServer(
      (stream, headers) => {
        stream.on("trailers", trailers => seenTrailers.push(Object.fromEntries(Object.entries(trailers))));
        // Echo the request's custom headers so the client can see which ones decoded on its stream.
        const echoed: any = {};
        for (const name of Object.keys(headers)) {
          if (name.startsWith("x-")) echoed[name] = headers[name];
        }
        stream.on("end", () => {
          stream.respond({ ":status": 200, "x-echo": JSON.stringify(echoed) });
          stream.end("c");
        });
        stream.resume();
      },
      async (client, sessionErrors) => {
        const echo = headers => ({
          headers: { ":status": 200, "x-echo": JSON.stringify(headers) },
          trailers: null,
          body: "c",
        });
        expect(await get(client, "/clean1", { "x-clean": "clean-value" })).toEqual(echo({ "x-clean": "clean-value" }));
        expect(
          await get(
            client,
            "/poison",
            { ":method": "POST", "x-poison": "1" },
            req => {
              req.on("wantTrailers", () => {
                try {
                  req.sendTrailers(poisons[kind].headers);
                } catch (err: any) {
                  thrown.push(errorOf(err));
                }
                req.sendTrailers({ "x-t": "v2" });
              });
              req.end("body");
            },
            { waitForTrailers: true },
          ),
        ).toEqual(echo({ "x-poison": "1" }));
        expect(await get(client, "/clean2", { "x-other": "other-value" })).toEqual(echo({ "x-other": "other-value" }));
        expect(seenTrailers).toEqual([{ "x-t": "v2" }]);
        expect(thrown).toEqual([poisons[kind].error]);
        expect(sessionErrors).toEqual([]);
      },
    );
  });

  it.each(pushKinds)("pushStream() that fails on an %s", async kind => {
    const pushErrors: any[] = [];
    await withServer(
      (stream, headers) => {
        if (headers[":path"] !== "/poison") return serveClean(stream);
        const respond = () => {
          stream.respond({ ":status": 200, "x-after-push": "1" });
          stream.end("p");
        };
        try {
          stream.pushStream({ ":path": "/pushed", ...poisons[kind].headers }, err => {
            pushErrors.push(err ? errorOf(err) : null);
            respond();
          });
        } catch (err: any) {
          pushErrors.push(errorOf(err));
          respond();
        }
      },
      async (client, sessionErrors) => {
        const pushed: any[] = [];
        client.on("stream", push => {
          pushed.push(push);
          push.resume();
        });
        expect(await get(client, "/clean1")).toEqual(clean);
        expect(await get(client, "/poison")).toEqual({
          headers: { ":status": 200, "x-after-push": "1" },
          trailers: null,
          body: "p",
        });
        expect(await get(client, "/clean2")).toEqual(clean);
        expect(pushErrors).toEqual([poisons[kind].error]);
        expect(pushed).toEqual([]);
        expect(sessionErrors).toEqual([]);
      },
    );
  });

  it.each(kinds)("client request() that throws on an %s", async kind => {
    await withServer(
      (stream, headers) => {
        // Echo the request's custom headers so the client can see which ones decoded on its stream.
        const echoed: any = {};
        for (const name of Object.keys(headers)) {
          if (name.startsWith("x-")) echoed[name] = headers[name];
        }
        stream.respond({ ":status": 200, "x-echo": JSON.stringify(echoed) });
        stream.end("c");
      },
      async (client, sessionErrors) => {
        const echo = headers => ({
          headers: { ":status": 200, "x-echo": JSON.stringify(headers) },
          trailers: null,
          body: "c",
        });
        expect(await get(client, "/clean1", { "x-clean": "clean-value" })).toEqual(echo({ "x-clean": "clean-value" }));
        let thrown: any = null;
        try {
          client.request({ ":path": "/poison", ...poisons[kind].headers });
        } catch (err: any) {
          thrown = errorOf(err);
        }
        expect(thrown).toBe(poisons[kind].error);
        expect(await get(client, "/clean2", { "x-other": "other-value" })).toEqual(echo({ "x-other": "other-value" }));
        expect(sessionErrors).toEqual([]);
      },
    );
  });

  // A request made before 'connect' is queued. The session catches the native throw itself.
  it("client request() queued before connect that fails on an invalid value", async () => {
    await withServer(
      (stream, headers) => {
        const echoed: any = {};
        for (const name of Object.keys(headers)) {
          if (name.startsWith("x-")) echoed[name] = headers[name];
        }
        stream.respond({ ":status": 200, "x-echo": JSON.stringify(echoed) });
        stream.end("c");
      },
      async (client, sessionErrors) => {
        const echo = headers => ({
          headers: { ":status": 200, "x-echo": JSON.stringify(headers) },
          trailers: null,
          body: "c",
        });
        const first = get(client, "/clean1", { "x-clean": "clean-value" });
        const poisoned = Promise.try(() => get(client, "/poison", poisons["invalid value"].headers)).then(
          () => "answered",
          errorOf,
        );
        const second = get(client, "/clean2", { "x-other": "other-value" });
        expect({
          connecting: client.connecting,
          first: await first,
          poisoned: await poisoned,
          second: await second,
          third: await get(client, "/clean3", { "x-clean": "clean-value", "x-other": "other-value" }),
          sessionErrors,
        }).toEqual({
          connecting: true,
          first: echo({ "x-clean": "clean-value" }),
          poisoned: poisons["invalid value"].error,
          second: echo({ "x-other": "other-value" }),
          third: echo({ "x-clean": "clean-value", "x-other": "other-value" }),
          sessionErrors: [],
        });
      },
    );
  });

  // close() runs inside the failed call, so nothing else ends the session: the peer is a raw
  // socket that acknowledges SETTINGS and never closes.
  it("client request() that throws after a header value closed the session", async () => {
    const goawayCodes: any[] = [];
    const peerClosed = Promise.withResolvers<any>();
    const peer = net.createServer(socket => {
      socket.on("error", () => {});
      socket.on("close", peerClosed.resolve);
      let buffered = Buffer.alloc(0);
      let preface = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n".length;
      socket.on("data", (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        if (buffered.length < preface) return;
        buffered = buffered.subarray(preface);
        preface = 0;
        while (buffered.length >= 9 && buffered.length >= 9 + buffered.readUIntBE(0, 3)) {
          const length = buffered.readUIntBE(0, 3);
          const type = buffered[3];
          const flags = buffered[4];
          const payload = buffered.subarray(9, 9 + length);
          buffered = buffered.subarray(9 + length);
          // SETTINGS without ACK: acknowledge it. GOAWAY: keep its error code.
          if (type === 4 && !(flags & 1)) socket.write(Buffer.from([0, 0, 0, 4, 1, 0, 0, 0, 0]));
          if (type === 7) goawayCodes.push(payload.readUInt32BE(4));
        }
      });
      socket.write(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]));
    });
    await new Promise<void>(resolve => peer.listen(0, "127.0.0.1", () => resolve()));
    const client = http2.connect(`http://127.0.0.1:${(peer.address() as net.AddressInfo).port}`);
    const sessionErrors: any[] = [];
    client.on("error", (err: any) => sessionErrors.push(errorOf(err)));
    try {
      // Both SETTINGS frames are acknowledged first: a frame that arrives later also ends a closed session.
      await Promise.all([
        new Promise(resolve => client.on("remoteSettings", resolve)),
        new Promise(resolve => client.on("localSettings", resolve)),
      ]);
      let thrown: any = null;
      try {
        const closing = {
          toString() {
            client.close();
            throw new Boom("boom");
          },
        };
        client.request({ ":path": "/", "x-a": closing as any });
      } catch (err: any) {
        thrown = errorOf(err);
      }
      const afterTheThrow = { thrown, closed: client.closed, destroyed: client.destroyed };
      await peerClosed.promise;
      expect({ afterTheThrow, sessionErrors, goawayErrorCodes: goawayCodes.filter(code => code !== 0) }).toEqual({
        afterTheThrow: { thrown: "BOOM", closed: true, destroyed: false },
        sessionErrors: [],
        goawayErrorCodes: [],
      });
    } finally {
      client.destroy();
      peer.close();
    }
  });
});

// A header value's toString() can make another header call on the same session while the first
// call still reads its fields. The first call used to have its earlier fields in the HPACK table
// by then, so the block of the second call went out ahead of fields the peer did not have yet.
describe("http2 a header call made from a header value's toString() during another header call", () => {
  const listen = (server: net.Server) => new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const plain = headers => {
    const { date, ...rest } = Object.fromEntries(Object.entries(headers));
    return rest;
  };
  function get(
    session: any,
    path: string,
    headers: any = {},
    options: any = undefined,
    onRequest: (req: any) => void = () => {},
  ) {
    const { promise, resolve } = Promise.withResolvers<any>();
    const result: any = {};
    const req = session.request({ ":path": path, ...headers }, options);
    req.on("headers", received => (result.info = plain(received)));
    req.on("response", received => (result.response = plain(received)));
    req.on("trailers", received => (result.trailers = plain(received)));
    req.on("error", (err: any) => (result.error = err.code));
    req.on("close", () => resolve(result));
    req.resume();
    onRequest(req);
    return promise;
  }
  // The fields of the outer call, with a hook on the second one that runs `nested` once.
  const hooked = nested => {
    let calls = 0;
    return {
      "x-outer-a": "outer-a",
      "x-hook": {
        toString() {
          if (++calls === 1) nested();
          return "hook-value";
        },
      },
      "x-outer-b": "outer-b",
    };
  };
  const outerWire = { "x-outer-a": "outer-a", "x-hook": "hook-value", "x-outer-b": "outer-b" };
  const nestedWire = { ":status": 200, "x-nested": "nested-value", "x-app": "shop" };
  const page = { response: { ":status": 200, "x-app": "shop", "x-page": "page-value" } };

  const outers = {
    "respond()": {
      call(stream, fields) {
        stream.respond({ ":status": 200, ...fields });
        stream.end("a");
      },
      act: { response: { ":status": 200, ...outerWire } },
    },
    "additionalHeaders()": {
      call(stream, fields) {
        stream.additionalHeaders({ ":status": 103, ...fields });
        stream.respond({ ":status": 200, "x-final": "1" });
        stream.end("a");
      },
      act: { info: { ":status": 103, ...outerWire }, response: { ":status": 200, "x-final": "1" } },
    },
    "sendTrailers()": {
      call(stream, fields) {
        stream.respond({ ":status": 200, "x-act": "1" }, { waitForTrailers: true });
        stream.on("wantTrailers", () => stream.sendTrailers({ ...fields }));
        stream.end("a");
      },
      act: { response: { ":status": 200, "x-act": "1" }, trailers: outerWire },
    },
    "pushStream()": {
      call(stream, fields) {
        stream.pushStream({ ":path": "/pushed", ...fields }, (err, pushed) => {
          pushed.respond({ ":status": 200 });
          pushed.end("p");
        });
        stream.respond({ ":status": 200, "x-final": "1" });
        stream.end("a");
      },
      act: { response: { ":status": 200, "x-final": "1" } },
      pushed: [{ path: "/pushed", ...outerWire }],
    },
  };

  it.each(Object.keys(outers))("server %s: a respond() on another stream", async outer => {
    const errors: any[] = [];
    let held;
    const heldReady = Promise.withResolvers<any>();
    const server = http2.createServer();
    server.on("sessionError", (err: any) => errors.push("server " + err.code));
    server.on("stream", (stream: any, headers: any) => {
      stream.on("error", (err: any) => errors.push("server stream " + err.code));
      const path = headers[":path"];
      if (path === "/warm") {
        stream.respond({ ":status": 200, "x-app": "shop", "x-secret": "alice-cookie" });
        return stream.end("w");
      }
      if (path === "/page") {
        stream.respond({ ...page.response });
        return stream.end("p");
      }
      if (path === "/hold") {
        held = stream;
        return heldReady.resolve();
      }
      outers[outer].call(
        stream,
        hooked(() => {
          held.respond({ ...nestedWire });
          held.end("n");
        }),
      );
    });
    await listen(server);
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    client.on("error", (err: any) => errors.push("client " + err.code));
    const pushed: any[] = [];
    client.on("stream", (push, requestHeaders) => {
      const { ":path": path, "x-outer-a": a, "x-hook": hook, "x-outer-b": b } = requestHeaders;
      pushed.push({ path, "x-outer-a": a, "x-hook": hook, "x-outer-b": b });
      push.resume();
    });
    try {
      const warm = await get(client, "/warm");
      const hold = get(client, "/hold");
      await heldReady.promise;
      expect({
        warm,
        act: await get(client, "/act"),
        hold: await hold,
        page: await get(client, "/page"),
        pageAgain: await get(client, "/page"),
        pushed,
        errors,
      }).toEqual({
        warm: { response: { ":status": 200, "x-app": "shop", "x-secret": "alice-cookie" } },
        act: outers[outer].act,
        hold: { response: nestedWire },
        page,
        pageAgain: page,
        pushed: outers[outer].pushed ?? [],
        errors: [],
      });
    } finally {
      client.destroy();
      server.close();
    }
  });

  // No stream is opened from inside request() here, so the stream ids stay in wire order.
  it.each(["request() -> sendTrailers()", "sendTrailers() -> request()", "sendTrailers() -> sendTrailers()"])(
    "client %s",
    async kind => {
      const errors: any[] = [];
      const server = http2.createServer();
      server.on("sessionError", (err: any) => errors.push("server " + err.code));
      server.on("stream", (stream: any, headers: any) => {
        stream.on("error", (err: any) => errors.push("server stream " + err.code));
        const pick = all => Object.fromEntries(Object.entries(all).filter(([name]) => name.startsWith("x-")));
        let trailers: any = null;
        stream.on("trailers", received => (trailers = pick(received)));
        stream.on("end", () => {
          stream.respond({ ":status": 200, "x-echo": JSON.stringify({ headers: pick(headers), trailers }) });
          stream.end("ok");
        });
        stream.resume();
      });
      await listen(server);
      const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
      client.on("error", (err: any) => errors.push("client " + err.code));
      const echoed = result => (result.response ? JSON.parse(result.response["x-echo"]) : result);
      // A POST that waits with its trailers.
      const withTrailers = path => {
        const ready = Promise.withResolvers<any>();
        let request;
        const done = get(client, path, { ":method": "POST" }, { waitForTrailers: true }, req => {
          request = req;
          req.on("wantTrailers", ready.resolve);
          req.end("body");
        });
        return { request, ready: ready.promise, done };
      };
      const nestedFields = { "x-nested": "nested-value", "x-app": "shop" };
      try {
        const warm = echoed(await get(client, "/warm", { "x-app": "shop" }));
        let outer;
        let nested;
        if (kind === "request() -> sendTrailers()") {
          const other = withTrailers("/other");
          await other.ready;
          outer = get(
            client,
            "/outer",
            hooked(() => other.request.sendTrailers({ ...nestedFields })),
          );
          nested = other.done;
        } else if (kind === "sendTrailers() -> request()") {
          const own = withTrailers("/own");
          await own.ready;
          own.request.sendTrailers(hooked(() => (nested = get(client, "/nested", { ...nestedFields }))));
          outer = own.done;
        } else {
          const own = withTrailers("/own");
          const other = withTrailers("/other");
          await Promise.all([own.ready, other.ready]);
          own.request.sendTrailers(hooked(() => other.request.sendTrailers({ ...nestedFields })));
          outer = own.done;
          nested = other.done;
        }
        const after = { headers: { "x-app": "shop", "x-after": "1" }, trailers: null };
        expect({
          warm,
          outer: echoed(await outer),
          nested: echoed(await nested),
          after: echoed(await get(client, "/after", { "x-app": "shop", "x-after": "1" })),
          afterAgain: echoed(await get(client, "/after", { "x-app": "shop", "x-after": "1" })),
          errors,
        }).toEqual({
          warm: { headers: { "x-app": "shop" }, trailers: null },
          outer: kind.startsWith("request()")
            ? { headers: outerWire, trailers: null }
            : { headers: {}, trailers: outerWire },
          nested: kind.endsWith("request()")
            ? { headers: nestedFields, trailers: null }
            : { headers: {}, trailers: nestedFields },
          after,
          afterAgain: after,
          errors: [],
        });
      } finally {
        client.destroy();
        server.close();
      }
    },
  );
});

// request() refuses a block in more places than the field walk: an option, the session memory
// limit, the send limit. Those checks used to run after the fields were in the HPACK table.
describe("http2 a block refused after its fields are read does not reach the HPACK table", () => {
  const listen = (server: net.Server) => new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  const fresh = { "x-fresh": "fresh-value", "x-user": "alice-cookie" };

  // One request: "status N" once it has a response, or how it failed.
  function settle(make) {
    const { promise, resolve } = Promise.withResolvers<any>();
    let result;
    let req;
    try {
      req = make();
    } catch (err: any) {
      return Promise.resolve("threw " + (err.code ?? err.name));
    }
    req.on("response", headers => (result = "status " + headers[":status"]));
    req.on("error", (err: any) => (result ??= "error " + err.code));
    req.on("close", () => resolve(result ?? "closed without a response"));
    req.resume();
    return promise;
  }

  // `act` makes the refused call and then calls `followUps()`: three requests that reuse the
  // fields of the primed table and of the refused block.
  async function run(connectOptions: any, act: (tools: any) => Promise<any>, serverAct?: (stream: any) => void) {
    const seen: any[] = [];
    const errors: any[] = [];
    const sink = Promise.withResolvers<any>();
    const server = http2.createServer();
    server.on("sessionError", (err: any) => errors.push("server " + err.code));
    server.on("stream", (stream: any, headers: any) => {
      stream.on("error", () => {});
      const path = headers[":path"];
      if (path === "/sink") {
        // Not read yet: the request body stays queued behind the flow-control window.
        stream.respond({ ":status": 200 });
        return sink.resolve(stream);
      }
      if (path === "/act") return serverAct ? serverAct(stream) : stream.close();
      seen.push({ path, clean: headers["x-clean"], fresh: headers["x-fresh"] });
      stream.respond({ ":status": 200, "x-app": "shop" });
      stream.end("ok");
    });
    await listen(server);
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`, connectOptions);
    client.on("error", (err: any) => errors.push("client " + err.code));
    const get = (path: string, headers: any = {}, options?: any) =>
      settle(() => client.request({ ":path": path, ...headers }, options));
    const followUps = () => [
      get("/after1", { "x-clean": "clean-value" }),
      get("/after2", { "x-fresh": "fresh-value" }),
      get("/after3", { "x-clean": "clean-value", "x-fresh": "fresh-value" }),
    ];
    try {
      const primed = await get("/prime", { "x-clean": "clean-value" });
      const { refused, after } = await act({ client, get, followUps, sink: sink.promise });
      return { primed, refused: await refused, after: await Promise.all(after), seen, errors };
    } finally {
      client.destroy();
      server.close();
    }
  }

  const inSync = {
    primed: "status 200",
    after: ["status 200", "status 200", "status 200"],
    seen: [
      { path: "/prime", clean: "clean-value", fresh: undefined },
      { path: "/after1", clean: "clean-value", fresh: undefined },
      { path: "/after2", clean: undefined, fresh: "fresh-value" },
      { path: "/after3", clean: "clean-value", fresh: "fresh-value" },
    ],
    errors: [],
  };

  // The follow-up requests are made in the same tick: node closes the session after a frame error.
  it("client request() refused by maxSendHeaderBlockLength", async () => {
    const { refused, ...rest } = await run({ maxSendHeaderBlockLength: 300 }, async ({ get, followUps }) => ({
      refused: get("/act", { ...fresh, "x-big": Buffer.alloc(400, "x").toString() }),
      after: followUps(),
    }));
    expect(rest).toEqual(inSync);
    expect(refused).toBe("error ERR_HTTP2_STREAM_ERROR");
  });

  it("client request() refused by maxSessionMemory", async () => {
    const { refused, ...rest } = await run({ maxSessionMemory: 1 }, async ({ client, get, followUps, sink }) => {
      // 2 MiB that the server does not read yet: all but the first window stays queued.
      const upload = client.request({ ":path": "/sink", ":method": "POST" });
      const uploaded = new Promise(resolve => upload.on("close", resolve));
      upload.on("error", () => {});
      upload.resume();
      upload.end(Buffer.alloc(2 * 1024 * 1024, "b"));
      const stream = await sink;
      const refused = await get("/act", fresh);
      stream.on("end", () => stream.end());
      stream.resume();
      await uploaded;
      return { refused, after: followUps() };
    });
    expect(rest).toEqual(inSync);
    expect(refused).toBe("error ERR_HTTP2_STREAM_ERROR");
  });

  it("client request() refused by an option", async () => {
    const { refused, ...rest } = await run({}, async ({ get, followUps }) => ({
      refused: await get("/act", fresh, { parent: -1 }),
      after: followUps(),
    }));
    expect(rest).toEqual(inSync);
    // node throws ERR_OUT_OF_RANGE here. The call must only leave no field behind.
    expect(refused).not.toBe("status 200");
  });

  it("respond() whose options getter throws", async () => {
    const thrown: any[] = [];
    const { refused, ...rest } = await run(
      {},
      async ({ get, followUps }) => ({ refused: await get("/act"), after: followUps() }),
      stream => {
        try {
          stream.respond(
            { ":status": 200, "x-fresh": "fresh-value", "set-cookie": "sid=ACT" },
            {
              get waitForTrailers() {
                throw new Error("boom");
              },
            },
          );
        } catch (err: any) {
          thrown.push(err.message);
        }
        stream.respond({ ":status": 503 });
        stream.end("p");
      },
    );
    expect(rest).toEqual(inSync);
    expect({ refused, thrown }).toEqual({ refused: "status 503", thrown: ["boom"] });
  });
});

// The encoder takes a field whose name plus value is at most 65536 bytes. A header call with a
// longer field does not throw: the session error (code 9) arrives from the event loop. The
// fields of that block that came before the long one used to stay in the HPACK table, so every
// header block written in the same tick reached the peer with its indices shifted.
describe("http2 a header block the encoder refuses does not reach the HPACK table", () => {
  const oversized = name => Buffer.alloc(65537 - name.length, "x").toString();
  // grpc-js raises the limit like this. A block over node's default limit then reaches the encoder.
  const RAISED = { maxSendHeaderBlockLength: Number.MAX_SAFE_INTEGER };
  const PAGE = { ":status": 200, "x-app": "shop", "x-build": "7", "cache-control": "public, max-age=60" };
  const listen = (server: net.Server) => new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
  // One GET: the response headers without date, or the error code.
  function get(session, path, headers = {}) {
    const { promise, resolve } = Promise.withResolvers<any>();
    let result;
    let req;
    try {
      req = session.request({ ":path": path, ...headers });
    } catch (err: any) {
      return Promise.resolve({ error: err.code });
    }
    req.on("response", received => {
      delete received.date;
      result = Object.fromEntries(Object.entries(received));
    });
    req.on("error", (err: any) => (result ??= { error: err.code }));
    req.on("close", () => resolve(result ?? { error: "closed without a response" }));
    req.resume();
    return promise;
  }

  // Each act makes one header call whose block has a fresh field and then the long one.
  const serverActs = {
    "additionalHeaders()": stream => {
      stream.additionalHeaders({ ":status": 103, "x-fresh": "fresh-value", link: oversized("link") });
    },
    "respond()": stream => {
      stream.respond({ ":status": 200, "x-fresh": "fresh-value", "x-big": oversized("x-big") });
    },
    "respond() with a raw header array": stream => {
      stream.respond([":status", "200", "x-fresh", "fresh-value", "x-big", oversized("x-big")]);
    },
    "pushStream()": stream => {
      // The pushed stream exists until the session error ends it.
      stream.pushStream({ ":path": "/pushed", "x-fresh": "fresh-value", "x-big": oversized("x-big") }, (err, pushed) =>
        pushed?.on("error", () => {}),
      );
    },
    "compat writeHead()": (stream, res) => {
      res.writeHead(200, { "x-fresh": "fresh-value", "x-big": oversized("x-big") });
      res.end();
    },
    "compat writeEarlyHints()": (stream, res) => {
      // "</" + path + ">; rel=preload" is 65533 bytes: with the name "link" that is 65537.
      const link = `</${Buffer.alloc(65533 - 16, "x").toString()}>; rel=preload`;
      res.writeEarlyHints({ "x-fresh": "fresh-value", link });
    },
  };

  // One connection for several users. Three streams are held. The act runs on a fourth stream,
  // and the held streams are answered in the same tick.
  it.each(Object.keys(serverActs))("%s: streams answered in the same tick decode right", async name => {
    const held: any[] = [];
    const allHeld = Promise.withResolvers<any>();
    const sessionError = Promise.withResolvers<any>();
    const route = (stream: any, headers: any, res?: any) => {
      stream.on("error", () => {});
      const path = headers[":path"];
      if (path === "/health") {
        stream.respond({ ":status": 200, "x-health": "ok", "x-region": "eu-1", server: "shop/1" });
        return stream.end("ok");
      }
      if (path === "/login") {
        stream.respond({ ":status": 200, "x-app": "shop", "set-cookie": "sid=ALICE-SESSION; HttpOnly" });
        return stream.end("in");
      }
      if (path === "/page") {
        stream.respond({ ...PAGE });
        return stream.end("page");
      }
      if (path === "/hold") {
        held.push(stream);
        if (held.length === 3) allHeld.resolve();
        return;
      }
      serverActs[name](stream, res);
      for (const waiting of held.splice(0)) {
        waiting.respond({ ...PAGE });
        waiting.end("page");
      }
    };
    const server = http2.createServer(RAISED);
    if (name.startsWith("compat")) server.on("request", (req, res) => route(req.stream, req.headers, res));
    else server.on("stream", (stream: any, headers: any) => route(stream, headers));
    server.on("sessionError", (err: any) => sessionError.resolve({ code: err.code, message: err.message }));
    await listen(server);
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    client.on("error", () => {});
    try {
      const primed = [await get(client, "/health"), await get(client, "/login"), await get(client, "/page")];
      const holds = [get(client, "/hold"), get(client, "/hold"), get(client, "/hold")];
      await allHeld.promise;
      get(client, "/act");
      expect({ primed, held: await Promise.all(holds) }).toEqual({
        primed: [
          { ":status": 200, "x-health": "ok", "x-region": "eu-1", server: "shop/1" },
          { ":status": 200, "x-app": "shop", "set-cookie": ["sid=ALICE-SESSION; HttpOnly"] },
          PAGE,
        ],
        held: [PAGE, PAGE, PAGE],
      });
      // The refused block still ends the session, from the event loop, as before.
      expect(await sessionError.promise).toEqual({
        code: "ERR_HTTP2_SESSION_ERROR",
        message: "Session closed with error code 9",
      });
    } finally {
      client.destroy();
      server.close();
    }
  });

  // The refused block ends the client session from the event loop, so requests made in the same
  // tick fail on the client. Some of them are on the wire by then. The peer must decode those
  // right, and not see a malformed block.
  it("client request(): requests made in the same tick decode right at the peer", async () => {
    const seen: any = {};
    const sessionErrors: any[] = [];
    const sessionClosed = Promise.withResolvers<any>();
    const server = http2.createServer();
    server.on("session", session => session.on("close", sessionClosed.resolve));
    server.on("sessionError", (err: any) => sessionErrors.push(err.code));
    server.on("stream", (stream: any, headers: any) => {
      stream.on("error", () => {});
      seen[headers[":path"]] = { app: headers["x-app"], build: headers["x-build"], user: headers["x-user"] };
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    await listen(server);
    const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`, RAISED);
    client.on("error", () => {});
    try {
      await get(client, "/prime", { "x-app": "shop", "x-build": "7", "x-user": "alice-cookie" });
      const act = get(client, "/act", { "x-fresh": "fresh-value", "x-big": oversized("x-big") });
      get(client, "/next1", { "x-app": "shop", "x-build": "7" });
      get(client, "/next2", { "x-app": "shop", "x-build": "7" });
      expect(await act).toEqual({ error: "ERR_HTTP2_SESSION_ERROR" });
      await sessionClosed.promise;
      const { "/prime": prime, ...sameTick } = seen;
      expect({
        prime,
        sameTick: Object.values(sameTick),
        malformed: sessionErrors.includes("ERR_HTTP2_ERROR"),
      }).toEqual({
        prime: { app: "shop", build: "7", user: "alice-cookie" },
        sameTick: Object.values(sameTick).map(() => ({ app: "shop", build: "7", user: undefined })),
        malformed: false,
      });
      expect(Object.keys(sameTick)).toContain("/next1");
    } finally {
      client.destroy();
      server.close();
    }
  });

  // bun's own decoder stops at a smaller field, so the peer here reads raw frames. The first
  // response has a field of exactly 65536 bytes, then a fresh field. The long field empties the
  // dynamic table when it goes in, so the fresh field is the only entry: index 62.
  it("a field of exactly 65536 bytes is sent, and the next block is indexed against it", async () => {
    let streams = 0;
    const server = http2.createServer(RAISED);
    server.on("stream", (stream: any) => {
      stream.on("error", () => {});
      if (++streams === 1) {
        const longest = Buffer.alloc(65536 - "x-max".length, "x").toString();
        stream.respond({ ":status": 200, "x-max": longest, "x-fresh": "fresh-value" }, { sendDate: false });
      } else {
        stream.respond({ ":status": 200, "x-fresh": "fresh-value" }, { sendDate: false });
      }
      stream.end();
    });
    await listen(server);
    const frame = (type, flags, streamId, payload = Buffer.alloc(0)) => {
      const header = Buffer.alloc(9);
      header.writeUIntBE(payload.length, 0, 3);
      header[3] = type;
      header[4] = flags;
      header.writeUInt32BE(streamId, 5);
      return Buffer.concat([header, payload]);
    };
    const HEADERS = 1;
    const SETTINGS = 4;
    const CONTINUATION = 9;
    const END_STREAM = 0x1;
    const END_HEADERS = 0x4;
    // :method GET, :scheme http, :path /, :authority localhost
    const request = Buffer.from([0x82, 0x86, 0x84, 0x41, 0x09, ...Buffer.from("localhost")]);
    const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
    const blocks = { 1: [], 3: [] };
    const bothBlocks = Promise.withResolvers<any>();
    let buffered = Buffer.alloc(0);
    socket.on("error", bothBlocks.reject);
    socket.on("close", () => bothBlocks.reject(new Error("the server closed the connection")));
    socket.on("data", (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 9 && buffered.length >= 9 + buffered.readUIntBE(0, 3)) {
        const length = buffered.readUIntBE(0, 3);
        const type = buffered[3];
        const flags = buffered[4];
        const streamId = buffered.readUInt32BE(5) & 0x7fffffff;
        const payload = buffered.subarray(9, 9 + length);
        buffered = buffered.subarray(9 + length);
        if (type !== HEADERS && type !== CONTINUATION) continue;
        blocks[streamId].push(payload);
        if (!(flags & END_HEADERS)) continue;
        if (streamId === 1) socket.write(frame(HEADERS, END_HEADERS | END_STREAM, 3, request));
        else bothBlocks.resolve();
      }
    });
    try {
      socket.write(
        Buffer.concat([
          Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"),
          frame(SETTINGS, 0, 0),
          frame(HEADERS, END_HEADERS | END_STREAM, 1, request),
        ]),
      );
      await bothBlocks.promise;
      const first = Buffer.concat(blocks[1]);
      // 0x88 is ":status: 200". The 65531 'x' of the long value are Huffman-coded at 7 bits each.
      expect({ status: first[0], frames: blocks[1].length, longEnough: first.length > 57000 }).toEqual({
        status: 0x88,
        frames: 4,
        longEnough: true,
      });
      // ":status: 200", then dynamic index 62.
      expect(Buffer.concat(blocks[3]).toString("hex")).toBe("88be");
    } finally {
      socket.destroy();
      server.close();
    }
  });
});

// node checks maxSendHeaderBlockLength on nghttp2's bound for the uncompressed block:
// 12 + 12 per field + the name and value bytes + 5. For respond({ ":status": 200, "x-a": value })
// without a date field that is 54 + value.length. The check runs before the encoder, so a
// refused block leaves the HPACK table alone.
describe("http2 maxSendHeaderBlockLength on a server response", () => {
  const PAGE = { ":status": 200, "x-app": "shop", "x-build": "7" };
  function get(session: any, path: string, informational: any[] = []) {
    const { promise, resolve } = Promise.withResolvers<any>();
    let result;
    const req = session.request({ ":path": path });
    req.on("headers", received => informational.push(received[":status"]));
    req.on("response", received => {
      delete received.date;
      result = Object.fromEntries(Object.entries(received));
    });
    req.on("error", (err: any) => (result ??= { error: err.code, message: err.message }));
    req.on("close", () => resolve(result ?? { error: "closed without a response" }));
    req.resume();
    return promise;
  }

  it("sends a block at the limit and resets the stream for a response over it", async () => {
    const held: any[] = [];
    const allHeld = Promise.withResolvers<any>();
    const events: any[] = [];
    const server = http2.createServer({ maxSendHeaderBlockLength: 300 });
    server.on("sessionError", (err: any) => events.push("sessionError " + err.code));
    server.on("stream", (stream: any, headers: any) => {
      const path = headers[":path"];
      stream.on("error", (err: any) => events.push(`${path} error ${err.message}`));
      stream.on("frameError", (type, code) => events.push(`${path} frameError type=${type} code=${code}`));
      if (path === "/page") {
        stream.respond({ ...PAGE });
        return stream.end("page");
      }
      if (path === "/hold") {
        held.push(stream);
        if (held.length === 3) allHeld.resolve();
        return;
      }
      const [, route, length] = path.split("/");
      const value = Buffer.alloc(Number(length), "a").toString();
      if (route === "hint") {
        // A refused additionalHeaders() block leaves the stream open for the response.
        stream.additionalHeaders({ ":status": 103, "x-a": value });
        stream.respond({ ...PAGE });
        return stream.end("page");
      }
      stream.respond({ ":status": 200, "x-a": value }, { sendDate: false });
      for (const waiting of held.splice(0)) {
        waiting.respond({ ...PAGE });
        waiting.end("page");
      }
      // A refused block has closed the stream by now.
      setImmediate(() => stream.closed || stream.end());
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    const connect = () => {
      const session = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
      session.on("error", (err: any) => events.push("client session error " + err.code));
      return session;
    };
    const client = connect();
    // node closes a session after a frame error, so the 1xx block has a session of its own.
    const hinted = connect();
    try {
      const primed = await get(client, "/page");
      const atTheLimit = await get(client, "/value/246");
      const holds = [get(client, "/hold"), get(client, "/hold"), get(client, "/hold")];
      await allHeld.promise;
      const overTheLimit = await get(client, "/value/247");
      const informational: any[] = [];
      expect({
        primed,
        atTheLimit: { status: atTheLimit[":status"], length: atTheLimit["x-a"]?.length },
        overTheLimit,
        held: await Promise.all(holds),
        afterRefusedHint: await get(hinted, "/hint/247", informational),
        informational,
        events,
      }).toEqual({
        primed: PAGE,
        atTheLimit: { status: 200, length: 246 },
        overTheLimit: {
          error: "ERR_HTTP2_STREAM_ERROR",
          message: "Stream closed with error code NGHTTP2_FRAME_SIZE_ERROR",
        },
        held: [PAGE, PAGE, PAGE],
        afterRefusedHint: PAGE,
        informational: [],
        events: [
          "/value/247 frameError type=1 code=6",
          "/value/247 error Stream closed with error code NGHTTP2_FRAME_SIZE_ERROR",
          "/hint/247 frameError type=1 code=6",
        ],
      });
    } finally {
      client.destroy();
      hinted.destroy();
      server.close();
    }
  });
});
