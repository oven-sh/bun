// This file is merely types only, you (probably) want to put the tests in ./serve-types.test.ts instead

import { expectType } from "./utilities";

Bun.serve({
  routes: {
    "/:id/:test": req => {
      expectType(req.params).is<{ id: string; test: string }>();
    },
  },
  fetch: () => new Response("hello"),
  websocket: {
    message(ws, message) {
      expectType(ws.data).is<undefined>();
      expectType(message).is<string | Buffer<ArrayBuffer>>();
    },
  },
});

const s1 = Bun.serve({
  routes: {
    "/ws/:name": req => {
      expectType(req.params.name).is<string>();

      s1.upgrade(req, {
        data: { name: req.params.name },
      });
    },
  },
  websocket: {
    data: {} as { name: string },

    message(ws) {
      ws.send(JSON.stringify(ws.data));
    },
  },
});

const s2 = Bun.serve({
  routes: {
    "/ws/:name": req => {
      expectType(req.params.name).is<string>();

      // @ts-expect-error - Should error because data was not passed
      s2.upgrade(req, {});
    },
  },
  websocket: {
    data: {} as { name: string },
    message(ws) {
      expectType(ws.data).is<{ name: string }>();
    },
  },
});

const s3 = Bun.serve({
  routes: {
    "/ws/:name": req => {
      expectType(req.params.name).is<string>();

      // @ts-expect-error - Should error because data and object was not passed
      s3.upgrade(req);
    },
  },
  websocket: {
    data: {} as { name: string },
    message(ws) {
      expectType(ws.data).is<{ name: string }>();
    },
  },
});

const s4 = Bun.serve({
  routes: {
    "/ws/:name": req => {
      expectType(req.params.name).is<string>();

      s4.upgrade(req);
    },
  },
  websocket: {
    message(ws) {
      expectType(ws.data).is<undefined>();
    },
  },
});

// WebTransport. `data` is `unknown` on an inline handler because the server
// option has no type parameter for it -- a session is not an upgraded request
// and shares nothing with `websocket`. Declaring the handler separately is how
// a session's `data` gets a type, and method bivariance is what lets the typed
// handler still satisfy the option.
Bun.serve({
  port: 0,
  tls: { cert: "", key: "" },
  http3: true,
  fetch: () => new Response("hello"),
  webtransport: {
    upgrade(req) {
      expectType(req).is<Request>();
      expectType(req.url).is<string>();
      if (req.url.endsWith("/nope")) return new Response(null, { status: 404 });
      return { seen: 0 };
    },
    open(session) {
      session.startDraining();
      expectType(session.data).is<unknown>();
      expectType(session.closed).is<boolean>();
      expectType(session.maxDatagramSize).is<number>();
      expectType(session.sendDatagram(new Uint8Array([1]))).is<number>();
      session.close(1, "done");
      session.close();
    },
    datagram(session, data) {
      expectType(data).is<Uint8Array>();
      session.sendDatagram("text");
    },
    drain(session) {
      expectType(session.sendDatagram(new Uint8Array([1]))).is<number>();
    },
    close(_session, code, reason) {
      expectType(code).is<number>();
      expectType(reason).is<string>();
    },
  },
});

const typedWebTransport: Bun.WebTransportHandler<{ seen: number }> = {
  // Refuse with a Response, or return the session's `data`; the two are told
  // apart by type, so both forms typecheck against the one return.
  upgrade(req) {
    if (!req.headers.get("authorization")) return new Response(null, { status: 401 });
    return { seen: 0 };
  },
  open(session) {
    session.data = { seen: 0 };
  },
  datagram(session, data) {
    expectType(session.data).is<{ seen: number }>();
    session.data.seen += data.length;
  },
};

Bun.serve({
  port: 0,
  tls: { cert: "", key: "" },
  http3: true,
  fetch: () => new Response("hello"),
  webtransport: typedWebTransport,
});
