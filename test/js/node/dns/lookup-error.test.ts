/**
 * Runs under `bun test` and (via node:test/node:assert) under
 * `node --experimental-strip-types --test`. Green under Node proves the
 * assertions encode real Node behaviour, so a green run under Bun means Bun
 * matches Node.
 *
 * Bun's `dns.lookup` (getaddrinfo) error object diverged from Node:
 *   - `errno`    was the positive c-ares enum value (4) instead of libuv's
 *                negative `UV_EAI_NONAME` (-3008)
 *   - `hostname` was `undefined` instead of the queried name
 *   - `message`  was `"getaddrinfo ENOTFOUND"` (no hostname suffix)
 *   - `name`     was `"DNSException"` instead of `"Error"`
 * `.invalid` is reserved (RFC 6761) and always fails to resolve.
 */
import assert from "node:assert";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { test } from "node:test";

const HOST = "this-name-does-not-exist.invalid";

function lookupError(host: string, opts?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const cb = (err: any, address: unknown) =>
      err ? resolve(err) : reject(new Error(`expected lookup to fail, resolved to ${address}`));
    if (opts) dns.lookup(host, opts, cb);
    else dns.lookup(host, cb);
  });
}

function assertNodeShape(err: any, host: string) {
  assert.strictEqual(err.code, "ENOTFOUND");
  assert.strictEqual(err.syscall, "getaddrinfo");
  assert.strictEqual(err.hostname, host);
  assert.strictEqual(err.name, "Error");
  // libuv UV_EAI_NONAME (-3008); tolerate UV_EAI_NODATA (-3007) since
  // c-ares collapses both into ENOTFOUND.
  assert.ok([-3008, -3007].includes(err.errno), `expected libuv EAI errno, got ${err.errno}`);
}

test("dns.lookup failure has a Node-shaped error", async () => {
  const err = await lookupError(HOST);
  assertNodeShape(err, HOST);
  assert.strictEqual(err.message, `getaddrinfo ENOTFOUND ${HOST}`);
});

test("dns.lookup({ all: true }) failure has a Node-shaped error", async () => {
  const err = await lookupError(HOST, { all: true });
  assertNodeShape(err, HOST);
});

test("dnsPromises.lookup failure has a Node-shaped error", async () => {
  await assert.rejects(dnsPromises.lookup(HOST), (err: any) => {
    assertNodeShape(err, HOST);
    assert.strictEqual(err.message, `getaddrinfo ENOTFOUND ${HOST}`);
    return true;
  });
});
