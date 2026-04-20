// https://github.com/oven-sh/bun/issues/24339
//
// tls.getCACertificates('system') must return the OS trust store regardless
// of --use-system-ca / NODE_USE_SYSTEM_CA. The flag only controls whether
// system certs are merged into the 'default' set used for connections.
//
// Uses node:test + node:assert and no Bun-specific imports so this file can
// also be run under Node.js (`node --test`) to verify parity.
import assert from "node:assert";
import { test } from "node:test";
import tls from "node:tls";

// On macOS, Bun's loader queries the default keychain search list, which does
// not include SystemRootCertificates.keychain — so the result depends on what
// is explicitly trusted in login/System.keychain (often nothing on clean/CI
// Macs). Node v25's loader has the same property on this platform, and Node's
// own test-tls-get-ca-certificates-system.js only asserts non-empty on
// Windows. The issue this regresses was reported on Linux.
const skip = process.platform === "darwin" ? "system cert count is environment-dependent on macOS" : false;

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
