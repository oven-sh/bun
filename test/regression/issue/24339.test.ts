// https://github.com/oven-sh/bun/issues/24339
//
// tls.getCACertificates('system') must return the OS trust store regardless
// of --use-system-ca / NODE_USE_SYSTEM_CA. The flag only controls whether
// system certs are merged into the 'default' set used for connections.
//
// Uses node:test + node:assert and no bun-specific imports so this file can
// be run under Node.js (`node --test`) to verify parity.
import assert from "node:assert";
import { test } from "node:test";
import tls from "node:tls";

// TODO: the macOS system-cert loader (root_certs_darwin.cpp) returns 0 certs
// on CI machines even with --use-system-ca; see BuildKite build #35340. Skip
// only on CI macOS so developer Macs still get coverage.
const skip = process.platform === "darwin" && !!process.env.CI ? "macOS system cert loader returns 0 on CI" : false;

test("tls.getCACertificates('system') returns system certs without --use-system-ca", { skip }, () => {
  assert.notStrictEqual(process.env.NODE_USE_SYSTEM_CA, "1");
  assert.ok(!(process.execArgv ?? []).includes("--use-system-ca"));

  const certs = tls.getCACertificates("system");
  assert.ok(Array.isArray(certs));
  assert.ok(certs.length > 0, `expected >0 system certs, got ${certs.length}`);
  for (const cert of certs) {
    assert.ok(cert.startsWith("-----BEGIN CERTIFICATE-----"), `not PEM: ${cert.slice(0, 40)}`);
  }
});

test("tls.getCACertificates('system') is stable across calls", { skip }, () => {
  const a = tls.getCACertificates("system");
  const b = tls.getCACertificates("system");
  assert.strictEqual(a.length, b.length);
});
