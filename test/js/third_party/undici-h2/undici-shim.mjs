// Shim that lets vendored undici test/fetch/http2.js run against Bun's
// built-in fetch() with the experimental HTTP/2 client path. The undici
// dispatcher API is stubbed out; only the fetch() surface is exercised.

import { tls as harnessTls } from "harness";
import { test as nodeTest } from "node:test";
import * as nodeAssert from "node:assert";

// Bun's node:test shim doesn't implement t.plan(); undici uses it pervasively
// as an assertion-count hint. Wrap to make it a no-op so the actual
// t.assert.* calls are what pass/fail each sub-test.
export function test(name, fn) {
  return nodeTest(name, async function (t) {
    t.plan = () => {};
    if (!t.assert) t.assert = nodeAssert;
    return fn.call(this, t);
  });
}

class StubDispatcher {
  constructor() {}
  close(cb) {
    if (typeof cb === "function") cb();
    return Promise.resolve();
  }
  destroy(cb) {
    if (typeof cb === "function") cb();
    return Promise.resolve();
  }
}

export class Client extends StubDispatcher {}
export class Agent extends StubDispatcher {}
export class Pool extends StubDispatcher {}

let globalDispatcher = new Agent();
export function setGlobalDispatcher(d) {
  globalDispatcher = d;
}
export function getGlobalDispatcher() {
  return globalDispatcher;
}

export function fetch(input, init = {}) {
  const { dispatcher, ...rest } = init;
  void dispatcher;
  const url = String(input?.url ?? input);
  // Only force the h2 ALPN path for https; one vendored test exercises
  // plain http to assert Content-Length parity with the h1 path.
  if (url.startsWith("https:")) {
    rest.protocol = "http2";
    rest.tls = { rejectUnauthorized: false, ...(rest.tls || {}) };
  }
  return globalThis.fetch(input, rest);
}

export const Response = globalThis.Response;
export const Request = globalThis.Request;
export const Headers = globalThis.Headers;
export const FormData = globalThis.FormData;

// Stand-in for `@metcoder95/https-pem` so vendored tests don't need the
// npm package; createSecureServer just needs `{ key, cert }`.
export const pem = {
  generate: async () => ({ key: harnessTls.key, cert: harnessTls.cert }),
};

// Stand-in for undici's test/utils/node-http.js helper.
export function closeClientAndServerAsPromise(client, server) {
  return async () => {
    await client.close();
    await new Promise(resolve => server.close(resolve));
  };
}
