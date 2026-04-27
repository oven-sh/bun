// Shim that lets vendored undici test/fetch/http2.js run against Bun's
// built-in fetch() with the experimental HTTP/2 client path. Test bodies are
// byte-identical to upstream; this file supplies the handful of imports the
// upstream require() block expects.

import { test as bunTest, expect } from "bun:test";
import * as nodeAssert from "node:assert";
import { tls as harnessTls } from "harness";

// Map undici's node:test surface (t.plan / t.assert / t.after) onto bun:test.
// t.plan(n) is enforced: every t.assert.* call is counted and the test fails
// if the final tally doesn't match, so a callback that never fires can't
// silently pass.
export function test(name, fn) {
  return bunTest(name, async () => {
    let planned = -1;
    let seen = 0;
    const cleanups = [];
    const assert = new Proxy(nodeAssert, {
      get(target, prop) {
        const real = target[prop];
        if (typeof real !== "function") return real;
        return (...args) => {
          seen++;
          return real(...args);
        };
      },
    });
    const t = {
      plan: n => void (planned = n),
      after: cb => void cleanups.push(cb),
      assert,
    };
    let err;
    try {
      await fn(t);
    } catch (e) {
      err = e;
    }
    for (let i = cleanups.length - 1; i >= 0; i--) await cleanups[i]();
    if (err) throw err;
    if (planned >= 0 && seen !== planned) {
      throw new Error(`plan mismatch: expected ${planned} assertions, saw ${seen}`);
    }
  });
}

// undici's fetch() takes a `dispatcher` (its own connection pool); Bun's
// fetch() manages h2 sessions internally. Stub the dispatcher classes so
// `new Client(...)` / `client.close()` in test setup/teardown are inert.
class StubDispatcher {
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

// CI sees a deterministic 90s hang on the first test that doesn't reproduce
// off-CI; until that's root-caused, log each fetch boundary so the BuildKite
// log shows whether the hang is connect, headers, body, or cleanup.
const trace = process.env.CI ? (m, ...a) => console.error(`[undici-h2 ${m}]`, ...a) : () => {};

export function fetch(input, init = {}) {
  const { dispatcher, ...rest } = init;
  void dispatcher;
  const url = String(input?.url ?? input);
  // One vendored test exercises plain http to assert Content-Length parity
  // with the h1 path; only force the h2 ALPN offer for https.
  if (url.startsWith("https:")) {
    rest.protocol = "http2";
    rest.tls = { rejectUnauthorized: false, ...(rest.tls || {}) };
  }
  trace("fetch start", rest.method ?? "GET", url);
  return globalThis.fetch(input, rest).then(
    r => {
      trace("fetch resolved", r.status, url);
      return r;
    },
    e => {
      trace("fetch rejected", e?.code ?? e?.name, url);
      throw e;
    },
  );
}

export const Response = globalThis.Response;
export const Request = globalThis.Request;
export const Headers = globalThis.Headers;
export const FormData = globalThis.FormData;

// Stand-in for `@metcoder95/https-pem` so the vendored file doesn't need the
// npm package; createSecureServer just wants `{ key, cert }`.
export const pem = {
  generate: async () => ({ key: harnessTls.key, cert: harnessTls.cert }),
};

// Stand-in for undici's test/utils/node-http.js helper.
export function closeClientAndServerAsPromise(client, server) {
  return async () => {
    trace("server close start");
    await client.close();
    await new Promise(resolve => server.close(resolve));
    trace("server close done");
  };
}
