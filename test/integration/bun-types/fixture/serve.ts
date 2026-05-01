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
