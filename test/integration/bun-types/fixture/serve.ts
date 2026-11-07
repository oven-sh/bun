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

// idleTimeout, http2 and http1 apply to a unix socket listener as well as to hostname+port
Bun.serve({
  unix: "/tmp/bun-types-fixture.sock",
  idleTimeout: 0,
  http2: true,
  http1: false,
  fetch: () => new Response("ok"),
});

Bun.serve({
  port: 0,
  idleTimeout: 30,
  http2: true,
  http1: false,
  fetch: () => new Response("ok"),
});

// http3 stays hostname+port only: Bun skips the HTTP/3 listener on a unix socket
// @ts-expect-error - http3 is not accepted with unix
Bun.serve({
  unix: "/tmp/bun-types-fixture.sock",
  http3: true,
  tls: { key: "key", cert: "cert" },
  fetch: () => new Response("ok"),
});

Bun.serve({
  tls: [
    { key: "key", cert: "cert", ca: "ca", requestCert: true, crl: Bun.file("crl.pem") },
    { serverName: "a.example.com", key: "key", cert: "cert", crl: "crl" },
  ],
  fetch: () => new Response(),
});
