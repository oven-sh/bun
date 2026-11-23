// Tests a `ws` client's 'upgrade' and 'unexpected-response' events, the `http.IncomingMessage` they carry, and how a
// non-101 response fails a socket that has no 'unexpected-response' listener. See ws-raw-peer.ts.
// The request passed to 'unexpected-response' is covered in ws-client-compat-request.test.ts.
import { describe, expect, test } from "bun:test";
import type { ClientRequest, IncomingMessage } from "node:http";
import {
  acceptKey,
  closedBeforeOpen,
  connectClient,
  createPeer,
  encodeFrame,
  implementations,
  nextEvent,
  OP,
  openClient,
  openEvents,
  response101,
  show,
  showError,
  type PeerOptions,
  type RawSocket,
} from "./ws-raw-peer";

const unexpected503 = ['error Error "Unexpected server response: 503" rs=2', "close 1006 Buffer() rs=3"];

/** A peer that sends `response` to every request and then closes the connection. */
const respondsWith = (response: string): PeerOptions => ({
  respond(conn: RawSocket) {
    conn.socket.end(response);
    return null;
  },
});
const respondsWith503 = respondsWith("HTTP/1.1 503 Service Unavailable\r\n\r\n");

async function readAll(response: IncomingMessage) {
  let body = "";
  for await (const chunk of response) body += chunk;
  return body;
}

const emitterMethods = ["on", "once", "addListener", "prependListener", "prependOnceListener"] as const;

describe.each(implementations)("ws client 'upgrade' and 'unexpected-response' events ($name)", row => {
  const { ws: implementation, builtin } = row;
  const { WebSocket } = implementation;
  type WebSocket = InstanceType<typeof WebSocket>;

  /** A client with no listeners at all. `connectClient()` would add 'error' and 'upgrade' listeners. */
  function connectWithoutListeners(url: string) {
    const ws = new WebSocket(url);
    return { ws, [Symbol.dispose]: () => ws.on("error", () => {}).terminate() };
  }

  describe("'upgrade'", () => {
    test("fires before 'open' with the 101 response as an IncomingMessage", async () => {
      await using client = await connectClient(
        implementation,
        {},
        { headers: ["X-Foo: bar", "Set-Cookie: a=1", "Set-Cookie: b=2"] },
      );
      const [response, ...more] = await nextEvent(client.ws, "upgrade");
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
      expect(client.events).toEqual(openEvents);
    });

    test("a microtask queued in the listener runs after 'open'", async () => {
      await using client = await connectClient(implementation);
      const { ws } = client;
      const states = await new Promise(resolve =>
        ws.on("upgrade", () => {
          const inListener = ws.readyState;
          queueMicrotask(() => resolve({ inListener, inMicrotask: ws.readyState }));
        }),
      );
      expect(states).toEqual({ inListener: WebSocket.CONNECTING, inMicrotask: WebSocket.OPEN });
    });

    test.each(emitterMethods)("fires for a listener added with %s()", async method => {
      await using client = await connectClient(implementation);
      const emitter: NodeJS.EventEmitter = client.ws;
      const [response] = await new Promise<any[]>(resolve => emitter[method]("upgrade", (...args) => resolve(args)));
      expect(response.statusCode).toBe(101);
    });

    test("addEventListener() ignores it", async () => {
      await using client = await connectClient(implementation);
      const { ws } = client;
      let calls = 0;
      const before = ws.listenerCount("upgrade");
      ws.addEventListener("upgrade" as any, () => calls++);
      expect(ws.listenerCount("upgrade")).toBe(before);
      await client.opened;
      expect(calls).toBe(0);
    });

    test("isn't emitted for a non-101 response", async () => {
      await using client = await connectClient(implementation, {}, respondsWith503);
      await client.closed;
      expect(client.events).toEqual(unexpected503);
    });
  });

  describe("'unexpected-response'", () => {
    test("passes the request and response while CONNECTING, and terminate() then fails the socket", async () => {
      await using client = await connectClient(
        implementation,
        {},
        { respond: () => "HTTP/1.1 401 Unauthorized\r\nContent-Length: 3\r\nX-A: 1\r\n\r\nfoo" },
      );
      const { ws, events } = client;
      const [request, response, ...more] = await nextEvent(ws, "unexpected-response");
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

    describe("response body", () => {
      test.each([
        { how: "with a Content-Length", response: "HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\n\r\nno", body: "no" },
        { how: "with Content-Length: 0", response: "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n", body: "" },
        {
          how: "that ends when the connection closes",
          response: "HTTP/1.1 503 Service Unavailable\r\nX-Reason: not-ready\r\n\r\nworkerd starting",
          body: "workerd starting",
        },
        {
          how: "with chunked encoding",
          response: "HTTP/1.1 403 Forbidden\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nno\r\n4\r\n way\r\n0\r\n\r\n",
          body: "no way",
        },
      ])("reads a body $how", async ({ response, body }) => {
        await using client = await connectClient(implementation, {}, respondsWith(response));
        const [, incoming] = await nextEvent(client.ws, "unexpected-response");
        expect(await readAll(incoming)).toBe(body);
      });

      const contentLengthHead = "HTTP/1.1 403 Forbidden\r\nContent-Length: 6\r\n\r\n";
      const chunkedHead = "HTTP/1.1 403 Forbidden\r\nTransfer-Encoding: chunked\r\n\r\n";
      const closeDelimitedHead = "HTTP/1.1 403 Forbidden\r\n\r\n";
      type Context = { conn: RawSocket; ws: WebSocket; req: ClientRequest };
      type BodyCase = {
        how: string;
        head: string;
        bodyStart: string;
        act(context: Context): void;
        /** The error the `ws` socket fails with, if it fails too. */
        socketError?: string;
        /** Don't add an 'error' listener to the response. */
        noErrorListener?: boolean;
      };
      const sendFin = ({ conn }: Context) => conn.end();
      const sendRst = ({ conn }: Context) => conn.reset();
      const econnreset = 'Error "read ECONNRESET" ECONNRESET';

      /**
       * Collects the events of the response, its request and the socket. The server sends `head` and `bodyStart`, the
       * start of the body. `act` runs once `bodyStart` has arrived.
       */
      async function bodyEvents({ head, bodyStart, act, socketError, noErrorListener }: BodyCase) {
        await using client = await connectClient(implementation, {}, { respond: () => head + bodyStart });
        const { ws } = client;
        const [req, res] = (await nextEvent(ws, "unexpected-response")) as [ClientRequest, IncomingMessage];
        const response: string[] = [];
        const request: string[] = [];
        const closed = Promise.all([nextEvent(res, "close"), nextEvent(req, "close")]);
        for (const name of ["aborted", "end", "close"]) res.on(name, () => response.push(name));
        if (!noErrorListener) res.on("error", error => response.push(`error ${showError(error)}`));
        for (const name of ["abort", "close"]) req.on(name, () => request.push(name));
        req.on("error", error => request.push(`error ${showError(error)}`));
        res.on("data", chunk => response.push(`data ${show(chunk)}`));
        await nextEvent(res, "data");
        act({ conn: await client.peer.connection(), ws, req });
        await closed;
        if (socketError) await client.closed;
        // Copy the arrays, because disposing `client` aborts the request and would add more events.
        return {
          response: [...response],
          request: [...request],
          flags: { complete: res.complete, aborted: res.aborted, destroyed: [res.destroyed, req.destroyed] },
          socket: [ws.readyState, ...client.events],
        };
      }
      // The listener decides what happens to the socket, unless the request fails.
      const expectedSocket = ({ socketError }: BodyCase) =>
        socketError
          ? [WebSocket.CLOSED, `error ${socketError} rs=2`, "close 1006 Buffer() rs=3"]
          : [WebSocket.CONNECTING];
      const expectedRequest = ({ socketError }: BodyCase) =>
        socketError ? [`error ${socketError}`, "close"] : ["close"];
      const truncatedBodyEvents = ['data Buffer("no")', "aborted", 'error Error "aborted" ECONNRESET', "close"];

      test.each<BodyCase>([
        {
          how: "the last Content-Length byte",
          head: contentLengthHead,
          bodyStart: "no",
          act: ({ conn }) => conn.write(" way"),
        },
        {
          how: "the last chunk",
          head: chunkedHead,
          bodyStart: "2\r\nno\r\n",
          act: ({ conn }) => conn.write("4\r\n way\r\n0\r\n\r\n"),
        },
        {
          how: "FIN with no Content-Length or chunked encoding",
          head: closeDelimitedHead,
          bodyStart: "no",
          act: ({ conn }) => conn.socket.end(" way"),
        },
      ])("completes at $how, emitting 'end' and 'close' on the response and 'close' on the request", async row => {
        expect(await bodyEvents(row)).toEqual({
          response: ['data Buffer("no")', 'data Buffer(" way")', "end", "close"],
          request: ["close"],
          flags: { complete: true, aborted: false, destroyed: [true, true] },
          socket: expectedSocket(row),
        });
      });

      // A body with no declared length ends whenever the connection ends, even on RST.
      test("completes at RST with no Content-Length or chunked encoding", async () => {
        const row = { how: "", head: closeDelimitedHead, bodyStart: "no", act: sendRst, socketError: econnreset };
        expect(await bodyEvents(row)).toEqual({
          response: ['data Buffer("no")', "end", "close"],
          request: expectedRequest(row),
          flags: { complete: true, aborted: false, destroyed: [true, true] },
          socket: expectedSocket(row),
        });
      });

      test.each<BodyCase>([
        { how: "FIN before the last Content-Length byte", head: contentLengthHead, bodyStart: "no", act: sendFin },
        {
          how: "RST before the last Content-Length byte",
          head: contentLengthHead,
          bodyStart: "no",
          act: sendRst,
          socketError: econnreset,
        },
        { how: "FIN before the last chunk", head: chunkedHead, bodyStart: "2\r\nno\r\n", act: sendFin },
        {
          how: "RST before the last chunk",
          head: chunkedHead,
          bodyStart: "2\r\nno\r\n",
          act: sendRst,
          socketError: econnreset,
        },
        { how: "FIN inside a chunk", head: chunkedHead, bodyStart: "6\r\nno", act: sendFin },
      ])("is truncated by $how, emitting 'aborted', 'error' and 'close' but not 'end'", async row => {
        expect(await bodyEvents(row)).toEqual({
          response: truncatedBodyEvents,
          request: expectedRequest(row),
          flags: { complete: false, aborted: true, destroyed: [true, true] },
          socket: expectedSocket(row),
        });
      });

      describe.each([
        { body: "with a Content-Length", head: contentLengthHead, bodyStart: "no" },
        { body: "with chunked encoding", head: chunkedHead, bodyStart: "2\r\nno\r\n" },
        { body: "with neither", head: closeDelimitedHead, bodyStart: "no" },
      ])("$body, when the server never sends the rest", ({ head, bodyStart }) => {
        const closedEarly = 'Error "WebSocket was closed before the connection was established"';

        // Bun's node:http emits 'end' on a close-delimited response when its request is destroyed, so npm ws running on
        // Bun sees 'end' here.
        test
          .skipIf(!builtin && head === closeDelimitedHead)
          .each<Pick<BodyCase, "how" | "act" | "socketError"> & { request: string[] }>([
            { how: "req.destroy()", act: ({ req }) => req.destroy(), request: ["close"] },
            { how: "req.abort()", act: ({ req }) => req.abort(), request: ["abort", "close"] },
            { how: "ws.close()", act: ({ ws }) => ws.close(), request: ["abort", "close"], socketError: closedEarly },
            {
              how: "ws.terminate()",
              act: ({ ws }) => ws.terminate(),
              request: ["abort", "close"],
              socketError: closedEarly,
            },
          ])("is truncated by $how", async ({ request, ...row }) => {
          const { flags, ...events } = await bodyEvents({ head, bodyStart, ...row });
          expect(events).toEqual({
            response: truncatedBodyEvents,
            request,
            socket: expectedSocket({ head, bodyStart, ...row }),
          });
          // For a close-delimited body, Node sets both `complete` and `aborted` here.
          expect(flags).toMatchObject({ aborted: true, destroyed: [true, true] });
          if (head !== closeDelimitedHead) expect(flags.complete).toBe(false);
        });
      });

      // Node's parser finishes the packet it already has, so the response still ends normally.
      test.each([
        { body: "with a Content-Length", fullResponse: contentLengthHead + "no way" },
        { body: "with chunked encoding", fullResponse: chunkedHead + "6\r\nno way\r\n0\r\n\r\n" },
        { body: "with Content-Length: 0", fullResponse: "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n" },
      ])(
        "a body $body that arrived in full with the head still ends after req.abort() in the listener",
        async ({ fullResponse }) => {
          await using client = await connectClient(implementation, {}, { respond: () => fullResponse });
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
        },
      );

      test("a truncated body doesn't throw without an 'error' listener", async () => {
        const row = {
          how: "",
          head: contentLengthHead,
          bodyStart: "no",
          act: ({ req }: Context) => req.destroy(),
          noErrorListener: true,
        };
        expect((await bodyEvents(row)).response).toEqual(['data Buffer("no")', "aborted", "close"]);
      });
    });

    // An HTTP parser only treats a 101 as an upgrade if it has an Upgrade header and Connection contains "upgrade". Any
    // other 101 is an ordinary response like a 404, and like every 1xx it has no body.
    describe("a 101 that isn't a valid upgrade", () => {
      type Response101 = { replace: Record<string, string | null>; headers?: string[]; after?: string | Buffer };

      /**
       * Collects the events of the response, its request and the socket. `afterClose` runs once the response and the
       * request have closed.
       */
      async function collectEvents(
        { replace, headers, after = "" }: Response101,
        afterClose: (conn: RawSocket) => void,
      ) {
        await using client = await connectClient(
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
        if (!res.closed) await nextEvent(res, "close");
        if (!request.includes("close")) await nextEvent(req, "close");
        afterClose(await client.peer.connection());
        // A round trip on a second connection gives the client time to react.
        await using control = await openClient(implementation);
        await control.conn.roundTrip();
        // Copy the arrays, because disposing `client` aborts the request and would add more events.
        return {
          statusCode: res.statusCode,
          response: [...response],
          request: [...request],
          flags: { complete: res.complete, aborted: res.aborted, destroyed: [res.destroyed, req.destroyed] },
          socket: [ws.readyState, ...client.events],
        };
      }
      // The response ends without waiting for the peer, and the listener decides what happens to the socket.
      const emptyResponse = {
        statusCode: 101,
        response: ["end", "close"],
        request: ["close"],
        flags: { complete: true, aborted: false, destroyed: [true, true] },
        socket: [WebSocket.CONNECTING],
      };
      const frame = encodeFrame(OP.text, "hi");

      describe.each<Pick<Response101, "replace"> & { problem: string }>([
        { problem: "no Upgrade header", replace: { Upgrade: null } },
        { problem: "Connection: keep-alive", replace: { Connection: "keep-alive" } },
        { problem: "no Connection header", replace: { Connection: null } },
        { problem: "no Upgrade or Connection header", replace: { Upgrade: null, Connection: null } },
      ])("$problem", ({ replace }) => {
        describe.each([
          { what: "nothing", after: "" },
          { what: "a frame", after: frame },
        ])("$what after the head", ({ after }) => {
          test.each([
            { then: "closes the connection", act: (conn: RawSocket) => conn.end() },
            { then: "keeps it open", act: () => {} },
          ])(
            "the response ends immediately and the socket stays CONNECTING when the peer then $then",
            async ({ act }) => {
              expect(await collectEvents({ replace, after }, act)).toEqual(emptyResponse);
            },
          );
        });
      });

      test.each<Omit<Response101, "replace"> & { what: string }>([
        { what: "a Content-Length and that many bytes", headers: ["Content-Length: 3"], after: "abc" },
        { what: "a Content-Length and no bytes", headers: ["Content-Length: 3"], after: "" },
        { what: "chunked encoding", headers: ["Transfer-Encoding: chunked"], after: "3\r\nabc\r\n0\r\n\r\n" },
        { what: "another response after it", after: "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi" },
      ])("has no body even with $what", async row => {
        expect(await collectEvents({ replace: { Upgrade: null }, ...row }, () => {})).toEqual(emptyResponse);
      });

      test("ignores a frame sent in a later packet", async () => {
        expect(await collectEvents({ replace: { Upgrade: null } }, conn => conn.write(frame))).toEqual(emptyResponse);
      });
    });

    test("joins repeated headers the way node:http does", async () => {
      await using client = await connectClient(
        implementation,
        {},
        respondsWith(
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
      const [, response] = await nextEvent(client.ws, "unexpected-response");
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

    test.each(emitterMethods)("fires for a listener added with %s()", async method => {
      await using client = await connectClient(implementation, {}, respondsWith503);
      const emitter: NodeJS.EventEmitter = client.ws;
      const [, response] = await new Promise<any[]>(resolve =>
        emitter[method]("unexpected-response", (...args) => resolve(args)),
      );
      expect(response.statusCode).toBe(503);
    });

    test("addEventListener() ignores it, so the socket fails as if there were no listener", async () => {
      await using client = await connectClient(implementation, {}, respondsWith503);
      const { ws } = client;
      let calls = 0;
      ws.addEventListener("unexpected-response" as any, () => calls++);
      expect(ws.listenerCount("unexpected-response")).toBe(0);
      await client.closed;
      expect(client.events).toEqual(unexpected503);
      expect(calls).toBe(0);
    });

    // The listener is responsible for closing the socket. Until it does, the socket stays CONNECTING.
    test.each([
      { listener: "on('error')", add: (ws, onError) => ws.on("error", onError) },
      { listener: "addEventListener('error')", add: (ws, onError) => ws.addEventListener("error", onError) },
      { listener: "onerror", add: (ws, onError) => (ws.onerror = onError) },
    ] as { listener: string; add(ws: WebSocket, onError: () => void): void }[])(
      "doesn't call $listener or emit 'close' afterwards",
      async ({ add }) => {
        await using peer = await createPeer(respondsWith503);
        using first = connectWithoutListeners(peer.url);
        using control = connectWithoutListeners(peer.url);
        const { ws } = first;
        const seen: string[] = [];
        add(ws, () => seen.push("error"));
        ws.on("close", () => seen.push("close"));
        const controlResponse = nextEvent(control.ws, "unexpected-response");
        const [, response] = await nextEvent(ws, "unexpected-response");
        expect(await readAll(response)).toBe("");
        // A client that connected later has received its response, and both connections have closed.
        await controlResponse;
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
      "$call in the listener sets CLOSING synchronously, then emits 'error' and 'close' 1006",
      async ({ act }) => {
        await using client = await connectClient(implementation, {}, respondsWith503);
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

  describe("a non-101 response without an 'unexpected-response' listener", () => {
    const describeEvent = (event: any, ws: WebSocket) =>
      `${event.constructor.name} ${event.type} ${JSON.stringify(event.message)} error=${showError(event.error)} target=${event.target === ws}`;
    const errorEvent =
      'ErrorEvent error "Unexpected server response: 503" error=Error "Unexpected server response: 503" target=true';

    const listenerKinds: Record<string, { add(ws: WebSocket, seen: string[]): void; line?: string }> = {
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

    // Each listener runs once, in the order added, regardless of the other listeners.
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
    )("$label: emits one 'error' with the status code, then 'close' 1006", async ({ listeners }) => {
      await using peer = await createPeer(respondsWith503);
      using client = connectWithoutListeners(peer.url);
      const { ws } = client;
      const seen: string[] = [];
      for (const kind of listeners) listenerKinds[kind].add(ws, seen);
      await new Promise<void>(resolve =>
        ws.on("close", (...args) => {
          seen.push(["close", ...args.map(show), `rs=${ws.readyState}`].join(" "));
          resolve();
        }),
      );
      expect(seen).toEqual([...listeners.flatMap(kind => listenerKinds[kind].line ?? []), "close 1006 Buffer() rs=3"]);
      expect(await (await peer.connection()).remainingFrames()).toEqual([]);
    });

    test("addEventListener('error') dedupes the same listener, and removeEventListener() removes it", async () => {
      await using peer = await createPeer(respondsWith503);
      using client = connectWithoutListeners(peer.url);
      const { ws } = client;
      const seen: string[] = [];
      const kept = () => seen.push("kept");
      const removed = () => seen.push("removed");
      ws.addEventListener("error", kept);
      ws.addEventListener("error", removed);
      ws.addEventListener("error", kept);
      ws.removeEventListener("error", removed);
      expect(ws.listenerCount("error")).toBe(1);
      await nextEvent(ws, "close");
      expect(seen).toEqual(["kept"]);
    });
  });
});
