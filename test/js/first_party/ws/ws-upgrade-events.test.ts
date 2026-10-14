// The 'upgrade' and 'unexpected-response' events of a `ws` client, the `http.IncomingMessage` they carry, and what a
// response other than 101 does to a socket nobody gave an 'unexpected-response' listener. See ws-raw-peer.ts.
// The request that comes with 'unexpected-response' is in ws-client-compat-request.test.ts.
import { describe, expect, test } from "bun:test";
import { isWindows } from "harness";
import type { ClientRequest, IncomingMessage } from "node:http";
import {
  acceptKey,
  createPeer,
  dial,
  encodeFrame,
  event,
  implementations,
  OP,
  openClient,
  response101,
  show,
  showError,
  type PeerOptions,
  type RawSocket,
} from "./ws-raw-peer";

const opening = ["upgrade 101 rs=0", "open rs=1"];
const closedBeforeOpen = [
  'error Error "WebSocket was closed before the connection was established" rs=2',
  "close 1006 Buffer() rs=3",
];
const unexpected503 = ['error Error "Unexpected server response: 503" rs=2', "close 1006 Buffer() rs=3"];

/** A peer that answers every request with `response` and ends the connection. */
const answers = (response: string): PeerOptions => ({
  respond(conn: RawSocket) {
    conn.socket.end(response);
    return null;
  },
});
const unavailable = answers("HTTP/1.1 503 Service Unavailable\r\n\r\n");

async function readAll(response: IncomingMessage) {
  let body = "";
  for await (const chunk of response) body += chunk;
  return body;
}

const emitterMethods = ["on", "once", "addListener", "prependListener", "prependOnceListener"] as const;

describe.each(implementations)("ws client, 'upgrade' and 'unexpected-response' ($name)", row => {
  const { ws: implementation, builtin } = row;
  const { WebSocket } = implementation;
  type WebSocket = InstanceType<typeof WebSocket>;

  /** A client with no listener at all: `dial()` adds one for 'error' and one for 'upgrade'. */
  function bare(url: string) {
    const ws = new WebSocket(url);
    return { ws, [Symbol.dispose]: () => ws.on("error", () => {}).terminate() };
  }

  describe("'upgrade'", () => {
    test("comes before 'open', with the 101 as an IncomingMessage", async () => {
      await using client = await dial(
        implementation,
        {},
        { headers: ["X-Foo: bar", "Set-Cookie: a=1", "Set-Cookie: b=2"] },
      );
      const [response, ...more] = await event(client.ws, "upgrade");
      const conn = await client.peer.connection();
      expect(more).toEqual([]);
      expect({
        class: response.constructor.name,
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        httpVersion: response.httpVersion,
        complete: response.complete,
        headers: { ...response.headers },
        socket: typeof response.socket,
      }).toEqual({
        class: "IncomingMessage",
        statusCode: 101,
        statusMessage: "Switching Protocols",
        httpVersion: "1.1",
        complete: true,
        headers: {
          upgrade: "websocket",
          connection: "Upgrade",
          "sec-websocket-accept": acceptKey(conn.header("sec-websocket-key")),
          "x-foo": "bar",
          "set-cookie": ["a=1", "b=2"],
        },
        socket: "object",
      });
      expect(response.rawHeaders.slice(-6)).toEqual(["X-Foo", "bar", "Set-Cookie", "a=1", "Set-Cookie", "b=2"]);
      await client.opened;
      expect(client.events).toEqual(opening);
    });

    test("a microtask queued in the listener runs after 'open'", async () => {
      await using client = await dial(implementation);
      const { ws } = client;
      const states = await new Promise(resolve =>
        ws.on("upgrade", () => {
          const inListener = ws.readyState;
          queueMicrotask(() => resolve({ inListener, inMicrotask: ws.readyState }));
        }),
      );
      expect(states).toEqual({ inListener: WebSocket.CONNECTING, inMicrotask: WebSocket.OPEN });
    });

    test.each(emitterMethods)("a listener added with %s() gets it", async method => {
      await using client = await dial(implementation);
      const emitter: NodeJS.EventEmitter = client.ws;
      const [response] = await new Promise<any[]>(resolve => emitter[method]("upgrade", (...args) => resolve(args)));
      expect(response.statusCode).toBe(101);
    });

    test("is not an event of addEventListener()", async () => {
      await using client = await dial(implementation);
      const { ws } = client;
      let calls = 0;
      const before = ws.listenerCount("upgrade");
      ws.addEventListener("upgrade" as any, () => calls++);
      expect(ws.listenerCount("upgrade")).toBe(before);
      await client.opened;
      expect(calls).toBe(0);
    });

    test("is not emitted for a response other than 101", async () => {
      await using client = await dial(implementation, {}, unavailable);
      await client.closed;
      expect(client.events).toEqual(unexpected503);
    });
  });

  describe("'unexpected-response'", () => {
    test("gets the request and the response while the socket is CONNECTING, and terminate() then fails it", async () => {
      await using client = await dial(
        implementation,
        {},
        { respond: () => "HTTP/1.1 401 Unauthorized\r\nContent-Length: 3\r\nX-A: 1\r\n\r\nfoo" },
      );
      const { ws, events } = client;
      const [request, response, ...more] = await event(ws, "unexpected-response");
      expect(ws.readyState).toBe(WebSocket.CONNECTING);
      expect(more).toEqual([]);
      expect({
        request: request.constructor.name,
        response: response.constructor.name,
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        httpVersion: response.httpVersion,
        headers: { ...response.headers },
        rawHeaders: response.rawHeaders,
      }).toEqual({
        request: "ClientRequest",
        response: "IncomingMessage",
        statusCode: 401,
        statusMessage: "Unauthorized",
        httpVersion: "1.1",
        headers: { "content-length": "3", "x-a": "1" },
        rawHeaders: ["Content-Length", "3", "X-A", "1"],
      });
      expect(await readAll(response)).toBe("foo");
      expect(events).toEqual([]);

      ws.terminate();
      expect(ws.readyState).toBe(WebSocket.CLOSING);
      await client.closed;
      expect(events).toEqual(closedBeforeOpen);
    });

    describe("the body of the response", () => {
      test.each([
        { how: "with a Content-Length", response: "HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\n\r\nno", body: "no" },
        { how: "with Content-Length: 0", response: "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n", body: "" },
        {
          how: "up to the end of the connection",
          response: "HTTP/1.1 503 Service Unavailable\r\nX-Reason: not-ready\r\n\r\nworkerd starting",
          body: "workerd starting",
        },
        {
          how: "in chunks",
          response: "HTTP/1.1 403 Forbidden\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nno\r\n4\r\n way\r\n0\r\n\r\n",
          body: "no way",
        },
      ])("$how", async ({ response, body }) => {
        await using client = await dial(implementation, {}, answers(response));
        const [, incoming] = await event(client.ws, "unexpected-response");
        expect(await readAll(incoming)).toBe(body);
      });

      test("that arrives after the event", async () => {
        await using client = await dial(
          implementation,
          {},
          { respond: () => "HTTP/1.1 403 Forbidden\r\nContent-Length: 6\r\n\r\n" },
        );
        const [, response] = await event(client.ws, "unexpected-response");
        const conn = await client.peer.connection();
        conn.write("no way");
        expect(await readAll(response)).toBe("no way");
      });

      const withLength = "HTTP/1.1 403 Forbidden\r\nContent-Length: 6\r\n\r\n";
      const inChunks = "HTTP/1.1 403 Forbidden\r\nTransfer-Encoding: chunked\r\n\r\n";
      const untilTheEnd = "HTTP/1.1 403 Forbidden\r\n\r\n";
      type Parties = { conn: RawSocket; ws: WebSocket; req: ClientRequest };
      type End = {
        how: string;
        head: string;
        first: string;
        then(parties: Parties): void;
        /** The `ws` socket fails too. */
        fails?: string;
        /** The response gets no 'error' listener. */
        unheard?: boolean;
      };
      const fin = ({ conn }: Parties) => conn.end();
      const rst = ({ conn }: Parties) => conn.reset();
      const reset = 'Error "read ECONNRESET" ECONNRESET';

      /**
       * The events of the response to `head`, whose body starts with `first`, of its request and of the socket. `then`
       * runs once `first` has arrived.
       */
      async function bodyEvents({ head, first, then, fails, unheard }: End) {
        await using client = await dial(implementation, {}, { respond: () => head + first });
        const { ws } = client;
        const [req, res] = (await event(ws, "unexpected-response")) as [ClientRequest, IncomingMessage];
        const response: string[] = [];
        const request: string[] = [];
        const closed = Promise.all([event(res, "close"), event(req, "close")]);
        for (const name of ["aborted", "end", "close"]) res.on(name, () => response.push(name));
        if (!unheard) res.on("error", error => response.push(`error ${showError(error)}`));
        for (const name of ["abort", "close"]) req.on(name, () => request.push(name));
        req.on("error", error => request.push(`error ${showError(error)}`));
        res.on("data", chunk => response.push(`data ${show(chunk)}`));
        await event(res, "data");
        then({ conn: await client.peer.connection(), ws, req });
        await closed;
        if (fails) await client.closed;
        // Copies: the disposal of `client` aborts the request.
        return {
          response: [...response],
          request: [...request],
          flags: { complete: res.complete, aborted: res.aborted, destroyed: [res.destroyed, req.destroyed] },
          socket: [ws.readyState, ...client.events],
        };
      }
      // What becomes of the socket is up to the listener, unless the request fails.
      const socketAfter = ({ fails }: End) =>
        fails ? [WebSocket.CLOSED, `error ${fails} rs=2`, "close 1006 Buffer() rs=3"] : [WebSocket.CONNECTING];
      const requestAfter = ({ fails }: End) => (fails ? [`error ${fails}`, "close"] : ["close"]);
      const cutOff = ['data Buffer("no")', "aborted", 'error Error "aborted" ECONNRESET', "close"];

      test.each<End>([
        {
          how: "the last byte of Content-Length",
          head: withLength,
          first: "no",
          then: ({ conn }) => conn.write(" way"),
        },
        {
          how: "the last chunk",
          head: inChunks,
          first: "2\r\nno\r\n",
          then: ({ conn }) => conn.write("4\r\n way\r\n0\r\n\r\n"),
        },
        { how: "FIN, with neither", head: untilTheEnd, first: "no", then: ({ conn }) => conn.socket.end(" way") },
      ])("is complete at $how: 'end' and 'close', and 'close' of the request", async row => {
        expect(await bodyEvents(row)).toEqual({
          response: ['data Buffer("no")', 'data Buffer(" way")', "end", "close"],
          request: ["close"],
          flags: { complete: true, aborted: false, destroyed: [true, true] },
          socket: socketAfter(row),
        });
      });

      // Nothing says how long such a body is, so any end of the connection ends it.
      test("is complete at RST, with neither", async () => {
        const row = { how: "", head: untilTheEnd, first: "no", then: rst, fails: reset };
        expect(await bodyEvents(row)).toEqual({
          response: ['data Buffer("no")', "end", "close"],
          request: requestAfter(row),
          flags: { complete: true, aborted: false, destroyed: [true, true] },
          socket: socketAfter(row),
        });
      });

      test.each<End>([
        { how: "FIN before the last byte of Content-Length", head: withLength, first: "no", then: fin },
        { how: "RST before the last byte of Content-Length", head: withLength, first: "no", then: rst, fails: reset },
        { how: "FIN before the last chunk", head: inChunks, first: "2\r\nno\r\n", then: fin },
        { how: "RST before the last chunk", head: inChunks, first: "2\r\nno\r\n", then: rst, fails: reset },
        { how: "FIN inside a chunk", head: inChunks, first: "6\r\nno", then: fin },
      ])("is cut off by $how: 'aborted', 'error', 'close', and no 'end'", async row => {
        expect(await bodyEvents(row)).toEqual({
          response: cutOff,
          request: requestAfter(row),
          flags: { complete: false, aborted: true, destroyed: [true, true] },
          socket: socketAfter(row),
        });
      });

      describe.each([
        { body: "with a Content-Length", head: withLength, first: "no" },
        { body: "in chunks", head: inChunks, first: "2\r\nno\r\n" },
        { body: "with neither", head: untilTheEnd, first: "no" },
      ])("$body, of which the server holds the rest back", ({ head, first }) => {
        const closedEarly = 'Error "WebSocket was closed before the connection was established"';

        // Bun's node:http ends a response with neither when its request is destroyed, so the package shows 'end' there.
        test
          .skipIf(!builtin && head === untilTheEnd)
          .each<Pick<End, "how" | "then" | "fails"> & { request: string[] }>([
            { how: "req.destroy()", then: ({ req }) => req.destroy(), request: ["close"] },
            { how: "req.abort()", then: ({ req }) => req.abort(), request: ["abort", "close"] },
            { how: "ws.close()", then: ({ ws }) => ws.close(), request: ["abort", "close"], fails: closedEarly },
            {
              how: "ws.terminate()",
              then: ({ ws }) => ws.terminate(),
              request: ["abort", "close"],
              fails: closedEarly,
            },
          ])("is cut off by $how", async ({ request, ...row }) => {
          const { flags, ...events } = await bodyEvents({ head, first, ...row });
          expect(events).toEqual({ response: cutOff, request, socket: socketAfter({ head, first, ...row }) });
          // Node calls a body with neither length nor chunks complete here, and aborted.
          expect(flags).toMatchObject({ aborted: true, destroyed: [true, true] });
          if (head !== untilTheEnd) expect(flags.complete).toBe(false);
        });
      });

      // Node's parser finishes the packet it holds, so the response still ends.
      test.each([
        { body: "with a Content-Length", whole: withLength + "no way" },
        { body: "in chunks", whole: inChunks + "6\r\nno way\r\n0\r\n\r\n" },
        { body: "of no bytes", whole: "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n" },
      ])("$body that came whole with the head, and req.abort() in the listener", async ({ whole }) => {
        await using client = await dial(implementation, {}, { respond: () => whole });
        const response: string[] = [];
        const [res] = await new Promise<[IncomingMessage]>(resolve =>
          client.ws.on("unexpected-response", (req: ClientRequest, res: IncomingMessage) => {
            for (const name of ["aborted", "end", "close"]) res.on(name, () => response.push(name));
            res.on("error", error => response.push(`error ${showError(error)}`));
            res.on("close", () => resolve([res]));
            req.abort();
          }),
        );
        expect({ response, complete: res.complete, aborted: res.aborted }).toEqual({
          response: ["end", "close"],
          complete: true,
          aborted: false,
        });
        expect([client.ws.readyState, ...client.events]).toEqual([WebSocket.CONNECTING]);
      });

      test("that is cut off needs no 'error' listener", async () => {
        const row = {
          how: "",
          head: withLength,
          first: "no",
          then: ({ req }: Parties) => req.destroy(),
          unheard: true,
        };
        expect((await bodyEvents(row)).response).toEqual(['data Buffer("no")', "aborted", "close"]);
      });

      // Winsock takes all of it on loopback, so nothing ever waits there.
      test.skipIf(isWindows)("that nobody reads stays with the server: its writes stall", async () => {
        await using client = await dial(implementation, {}, { respond: () => "HTTP/1.1 403 Forbidden\r\n\r\n" });
        const [, response] = (await event(client.ws, "unexpected-response")) as [unknown, IncomingMessage];
        const conn = await client.peer.connection();
        await using control = await openClient(implementation);
        const chunk = Buffer.alloc(100_000, "a");
        let sent = 0;
        // Until the kernel's buffers are full: bytes stay in the server's own queue for a whole round trip.
        do {
          conn.write(chunk);
          sent += chunk.length;
          await control.conn.roundTrip();
        } while (conn.socket.writableLength === 0 && sent < 1000 * chunk.length);
        expect(conn.socket.writableLength).toBeGreaterThan(0);

        conn.end();
        let received = 0;
        for await (const data of response) received += data.length;
        expect(received).toBe(sent);
      });
    });

    // For an HTTP parser a 101 is an upgrade only with an Upgrade header and the token "upgrade" in Connection. Any
    // other 101 is a response like a 404, and like every 1xx it has no body.
    describe("a 101 that is no upgrade", () => {
      type Answer = { replace: Record<string, string | null>; headers?: string[]; after?: string | Buffer };

      /** What the response, its request and the socket emit. `then` runs once response and request have closed. */
      async function events({ replace, headers, after = "" }: Answer, then: (conn: RawSocket) => void) {
        await using client = await dial(
          implementation,
          {},
          { respond: conn => Buffer.concat([Buffer.from(response101(conn, headers, replace)), Buffer.from(after)]) },
        );
        const { ws } = client;
        const response: string[] = [];
        const request: string[] = [];
        const [req, res] = await new Promise<[ClientRequest, IncomingMessage]>(resolve =>
          ws.on("unexpected-response", (req: ClientRequest, res: IncomingMessage) => {
            for (const name of ["aborted", "end", "close"]) res.on(name, () => response.push(name));
            res.on("error", error => response.push(`error ${showError(error)}`));
            res.on("data", chunk => response.push(`data ${show(chunk)}`));
            for (const name of ["abort", "close"]) req.on(name, () => request.push(name));
            req.on("error", error => request.push(`error ${showError(error)}`));
            resolve([req, res]);
          }),
        );
        if (!res.closed) await event(res, "close");
        if (!request.includes("close")) await event(req, "close");
        then(await client.peer.connection());
        // Whatever that does to the client has happened once another connection has gone there and back.
        await using control = await openClient(implementation);
        await control.conn.roundTrip();
        // Copies: the disposal of `client` aborts the request.
        return {
          statusCode: res.statusCode,
          response: [...response],
          request: [...request],
          flags: { complete: res.complete, aborted: res.aborted, destroyed: [res.destroyed, req.destroyed] },
          socket: [ws.readyState, ...client.events],
        };
      }
      // It does not wait for the peer, and what becomes of the socket is up to the listener.
      const emptyResponse = {
        statusCode: 101,
        response: ["end", "close"],
        request: ["close"],
        flags: { complete: true, aborted: false, destroyed: [true, true] },
        socket: [WebSocket.CONNECTING],
      };
      const frame = encodeFrame(OP.text, "hi");

      describe.each<Pick<Answer, "replace"> & { wrong: string }>([
        { wrong: "no Upgrade", replace: { Upgrade: null } },
        { wrong: "Connection: keep-alive", replace: { Connection: "keep-alive" } },
        { wrong: "no Connection", replace: { Connection: null } },
        { wrong: "neither Upgrade nor Connection", replace: { Upgrade: null, Connection: null } },
      ])("$wrong", ({ replace }) => {
        describe.each([
          { what: "nothing", after: "" },
          { what: "a frame", after: frame },
        ])("$what after the head", ({ after }) => {
          test.each([
            { then: "ends the connection", act: (conn: RawSocket) => conn.end() },
            { then: "keeps it open", act: () => {} },
          ])("the response ends at once and the socket stays CONNECTING; then the peer $then", async ({ act }) => {
            expect(await events({ replace, after }, act)).toEqual(emptyResponse);
          });
        });
      });

      test.each<Omit<Answer, "replace"> & { what: string }>([
        { what: "a Content-Length and that many bytes", headers: ["Content-Length: 3"], after: "abc" },
        { what: "a Content-Length and no byte", headers: ["Content-Length: 3"], after: "" },
        { what: "chunks", headers: ["Transfer-Encoding: chunked"], after: "3\r\nabc\r\n0\r\n\r\n" },
        { what: "another response behind it", after: "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi" },
      ])("has no body, with $what", async answer => {
        expect(await events({ replace: { Upgrade: null }, ...answer }, () => {})).toEqual(emptyResponse);
      });

      test("a frame in a later packet reaches nobody", async () => {
        expect(await events({ replace: { Upgrade: null } }, conn => conn.write(frame))).toEqual(emptyResponse);
      });
    });

    test("repeated headers are joined as node:http joins them", async () => {
      await using client = await dial(
        implementation,
        {},
        answers(
          [
            "HTTP/1.1 401 Unauthorized",
            "Content-Type: text/plain",
            "Content-Type: text/html",
            "Cookie: a=1",
            "Cookie: b=2",
            "X-Multi: one",
            "X-Multi: two",
            "Set-Cookie: s1=1",
            "Set-Cookie: s2=2",
            "",
            "",
          ].join("\r\n"),
        ),
      );
      const [, response] = await event(client.ws, "unexpected-response");
      expect({ ...response.headers }).toEqual({
        "content-type": "text/plain",
        cookie: "a=1; b=2",
        "x-multi": "one, two",
        "set-cookie": ["s1=1", "s2=2"],
      });
      // prettier-ignore
      expect(response.rawHeaders).toEqual([
        "Content-Type", "text/plain", "Content-Type", "text/html", "Cookie", "a=1", "Cookie", "b=2",
        "X-Multi", "one", "X-Multi", "two", "Set-Cookie", "s1=1", "Set-Cookie", "s2=2",
      ]);
    });

    test.each(emitterMethods)("a listener added with %s() gets it", async method => {
      await using client = await dial(implementation, {}, unavailable);
      const emitter: NodeJS.EventEmitter = client.ws;
      const [, response] = await new Promise<any[]>(resolve =>
        emitter[method]("unexpected-response", (...args) => resolve(args)),
      );
      expect(response.statusCode).toBe(503);
    });

    test("is not an event of addEventListener(): the socket fails as it does without a listener", async () => {
      await using client = await dial(implementation, {}, unavailable);
      const { ws } = client;
      let calls = 0;
      ws.addEventListener("unexpected-response" as any, () => calls++);
      expect(ws.listenerCount("unexpected-response")).toBe(0);
      await client.closed;
      expect(client.events).toEqual(unexpected503);
      expect(calls).toBe(0);
    });

    // The listener owns the outcome. Until it closes the socket, the socket is CONNECTING.
    test.each([
      { listener: "on('error')", add: (ws, mark) => ws.on("error", mark) },
      { listener: "addEventListener('error')", add: (ws, mark) => ws.addEventListener("error", mark) },
      { listener: "onerror", add: (ws, mark) => (ws.onerror = mark) },
    ] as { listener: string; add(ws: WebSocket, mark: () => void): void }[])(
      "nothing follows it: $listener is not called, and there is no 'close'",
      async ({ add }) => {
        await using peer = await createPeer(unavailable);
        using first = bare(peer.url);
        using control = bare(peer.url);
        const { ws } = first;
        const seen: string[] = [];
        add(ws, () => seen.push("error"));
        ws.on("close", () => seen.push("close"));
        const later = event(control.ws, "unexpected-response");
        const [, response] = await event(ws, "unexpected-response");
        expect(await readAll(response)).toBe("");
        // A client that dialed later has had its answer, and both connections are gone.
        await later;
        for (let i = 0; i < 2; i++) {
          const conn = await peer.connection();
          await conn.closed;
        }
        expect(seen).toEqual([]);
        expect(ws.readyState).toBe(WebSocket.CONNECTING);
      },
    );

    test.each([
      { call: "close()", act: ws => ws.close() },
      { call: "terminate()", act: ws => ws.terminate() },
    ] as { call: string; act(ws: WebSocket): void }[])(
      "$call in the listener: CLOSING at once, then 'error' and 'close' 1006",
      async ({ act }) => {
        await using client = await dial(implementation, {}, unavailable);
        const { ws, events } = client;
        const states: number[] = [];
        ws.on("unexpected-response", () => {
          states.push(ws.readyState);
          act(ws);
          states.push(ws.readyState);
        });
        await client.closed;
        expect(states).toEqual([WebSocket.CONNECTING, WebSocket.CLOSING]);
        expect(events).toEqual(closedBeforeOpen);
      },
    );
  });

  describe("a response other than 101 without an 'unexpected-response' listener", () => {
    const describeEvent = (event: any, ws: WebSocket) =>
      `${event.constructor.name} ${event.type} ${JSON.stringify(event.message)} error=${showError(event.error)} target=${event.target === ws}`;
    const errorEvent =
      'ErrorEvent error "Unexpected server response: 503" error=Error "Unexpected server response: 503" target=true';

    const kinds: Record<string, { add(ws: WebSocket, seen: string[]): void; line?: string }> = {
      "on('error')": {
        add: (ws, seen) => ws.on("error", error => seen.push(`on ${showError(error)} rs=${ws.readyState}`)),
        line: 'on Error "Unexpected server response: 503" rs=2',
      },
      "once('error')": {
        add: (ws, seen) => ws.once("error", error => seen.push(`once ${showError(error)} rs=${ws.readyState}`)),
        line: 'once Error "Unexpected server response: 503" rs=2',
      },
      "addEventListener('error')": {
        add: (ws, seen) => ws.addEventListener("error", event => seen.push("listener " + describeEvent(event, ws))),
        line: "listener " + errorEvent,
      },
      onerror: {
        add: (ws, seen) => (ws.onerror = event => seen.push("onerror " + describeEvent(event, ws))),
        line: "onerror " + errorEvent,
      },
      "on('upgrade')": { add: (ws, seen) => ws.on("upgrade", () => seen.push("upgrade")) },
    };

    // Each listener runs once, in the order they were added, whatever else listens.
    test.each(
      [
        ["on('error')"],
        ["once('error')"],
        ["addEventListener('error')"],
        ["onerror"],
        ["on('upgrade')", "on('error')"],
        ["on('upgrade')", "addEventListener('error')"],
        ["on('upgrade')", "onerror"],
        ["on('error')", "addEventListener('error')"],
        ["onerror", "on('error')"],
        ["addEventListener('error')", "once('error')", "onerror", "on('error')"],
      ].map(listeners => ({ listeners, label: listeners.join(", ") })),
    )("$label: one 'error' with the status code, then 'close' 1006", async ({ listeners }) => {
      await using peer = await createPeer(unavailable);
      using client = bare(peer.url);
      const { ws } = client;
      const seen: string[] = [];
      for (const kind of listeners) kinds[kind].add(ws, seen);
      await new Promise<void>(resolve =>
        ws.on("close", (...args) => {
          seen.push(["close", ...args.map(show), `rs=${ws.readyState}`].join(" "));
          resolve();
        }),
      );
      expect(seen).toEqual([...listeners.flatMap(kind => kinds[kind].line ?? []), "close 1006 Buffer() rs=3"]);
      expect(await (await peer.connection()).rest()).toEqual([]);
    });

    test("addEventListener('error') takes the same listener once, and removeEventListener() takes it off", async () => {
      await using peer = await createPeer(unavailable);
      using client = bare(peer.url);
      const { ws } = client;
      const seen: string[] = [];
      const kept = () => seen.push("kept");
      const removed = () => seen.push("removed");
      ws.addEventListener("error", kept);
      ws.addEventListener("error", removed);
      ws.addEventListener("error", kept);
      ws.removeEventListener("error", removed);
      expect(ws.listenerCount("error")).toBe(1);
      await event(ws, "close");
      expect(seen).toEqual(["kept"]);
    });
  });
});
