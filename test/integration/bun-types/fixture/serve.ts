// This file is merely types only, you (probably) want to put the tests in ./serve-types.test.ts instead

import type { HTMLBundle } from "bun";
import { expectType } from "./utilities";

// A method key takes every static route value except `false`.
declare const appHtml: HTMLBundle;
Bun.serve({
  routes: {
    "/assets/*": { GET: { dir: "./public" } },
    "/file": { POST: Bun.file("./a.txt"), GET: new Response("ok") },
    "/app": { GET: appHtml },
    // @ts-expect-error
    "/nope": { POST: false },
  },
});

Bun.serve({
  routes: {
    "/:id/:test": req => {
      expectType(req.params).is<{ id: string; test: string }>();
    },
    "/orgs/:orgId/repos/:repoId/settings": req => {
      expectType(req.params).is<{ orgId: string; repoId: string }>();
    },
    "/files:batchGet/:id": req => {
      expectType(req.params).is<{ id: string }>();
    },
    "/static/*": req => {
      expectType(req.params).is<{}>();
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

// idleTimeout applies to a unix socket listener too
Bun.serve({
  unix: "/tmp/bun-types-fixture.sock",
  idleTimeout: 0,
  fetch: () => new Response("ok"),
});

Bun.serve({
  port: 0,
  idleTimeout: 30,
  fetch: () => new Response("ok"),
});

Bun.serve({
  tls: [
    { key: "key", cert: "cert", ca: "ca", requestCert: true, crl: Bun.file("crl.pem") },
    { serverName: "a.example.com", key: "key", cert: "cert", crl: "crl" },
  ],
  fetch: () => new Response(),
});

Bun.serve({
  routes: {
    "/on-disk.txt": Bun.file("on-disk.txt"),
    "/in-memory.txt": new Blob(["in memory"], { type: "text/plain" }),
  },
});

const embeddedRoutes: Record<string, Blob> = {};
Bun.embeddedFiles.forEach((blob, i) => {
  embeddedRoutes[`/embedded/${i}`] = blob;
});
Bun.serve({ routes: embeddedRoutes });
