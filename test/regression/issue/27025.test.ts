import { expect, test } from "bun:test";
import { X509Certificate } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

const certPem = readFileSync(join(import.meta.dir, "../../js/node/test/fixtures/keys/agent1-cert.pem"));

test("issuerCertificate should return undefined for directly-parsed certificates without crashing", () => {
  const cert = new X509Certificate(certPem);

  // issuerCertificate is only populated for certificates obtained from TLS
  // connections with a peer certificate chain. For directly parsed certs,
  // it should be undefined (matching Node.js behavior).
  expect(cert.issuerCertificate).toBeUndefined();
});

test("X509Certificate properties should not crash on valid certificates", () => {
  const cert = new X509Certificate(certPem);

  // These should all work without segfaulting
  expect(cert.subject).toBeDefined();
  expect(cert.issuer).toBeDefined();
  expect(cert.validFrom).toBeDefined();
  expect(cert.validTo).toBeDefined();
  expect(cert.fingerprint).toBeDefined();
  expect(cert.fingerprint256).toBeDefined();
  expect(cert.fingerprint512).toBeDefined();
  expect(cert.serialNumber).toBeDefined();
  expect(cert.raw).toBeInstanceOf(Uint8Array);
  expect(cert.ca).toBe(false);
});
