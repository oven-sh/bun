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

// `fd`: a socket that another process bound.
Bun.serve({
  fd: 3,
  fetch: () => new Response("hello"),
});

Bun.serve({
  fd: 3,
  tls: { cert: "cert", key: "key" },
  http2: true,
  idleTimeout: 30,
  routes: {
    "/:id": req => new Response(req.params.id),
  },
  websocket: {
    message(ws) {
      expectType(ws.data).is<undefined>();
    },
  },
});

// `fd` wins over a port, and a bind flag has no effect.
Bun.serve({
  port: 3000,
  reusePort: true,
  ipv6Only: true,
  fd: 3,
  fetch: () => new Response("hello"),
});

// @ts-expect-error - a bound socket has its address already
Bun.serve({
  hostname: "127.0.0.1",
  fd: 3,
  fetch: () => new Response("hello"),
});

// @ts-expect-error - a bound socket has its address already
Bun.serve({
  unix: "/tmp/bun.sock",
  fd: 3,
  fetch: () => new Response("hello"),
});

// @ts-expect-error - HTTP/3 needs a UDP socket
Bun.serve({
  http3: true,
  fd: 3,
  tls: { cert: "cert", key: "key" },
  fetch: () => new Response("hello"),
});

Bun.serve({
  // @ts-expect-error - the descriptor is a number
  fd: "3",
  fetch: () => new Response("hello"),
});

declare const maybeFd: number | undefined;
Bun.serve({
  fd: maybeFd,
  fetch: () => new Response("hello"),
});
