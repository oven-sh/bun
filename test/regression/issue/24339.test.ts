// https://github.com/oven-sh/bun/issues/24339
import { expect, test } from "bun:test";
import tls from "node:tls";

test("tls.getCACertificates('system') should return system certificates", () => {
  const systemCerts = tls.getCACertificates("system");

  // System certificates should not be empty
  expect(systemCerts.length).toBeGreaterThan(0);

  // Each certificate should be a string in PEM format
  expect(systemCerts[0]).toBeString();
  expect(systemCerts[0]).toContain("-----BEGIN CERTIFICATE-----");
  expect(systemCerts[0]).toContain("-----END CERTIFICATE-----");
});

test("tls.getCACertificates('bundled') should return bundled certificates", () => {
  const bundledCerts = tls.getCACertificates("bundled");

  // Bundled certificates should not be empty
  expect(bundledCerts.length).toBeGreaterThan(0);

  // Each certificate should be a string in PEM format
  expect(bundledCerts[0]).toBeString();
  expect(bundledCerts[0]).toContain("-----BEGIN CERTIFICATE-----");
  expect(bundledCerts[0]).toContain("-----END CERTIFICATE-----");
});

test("tls.getCACertificates('default') should only include bundled certs by default", () => {
  const defaultCerts = tls.getCACertificates("default");
  const bundledCerts = tls.getCACertificates("bundled");

  // Without --use-system-ca, default should equal bundled
  expect(defaultCerts.length).toBe(bundledCerts.length);
});

test("tls.getCACertificates() should default to 'default' type", () => {
  const defaultCerts = tls.getCACertificates();
  const explicitDefaultCerts = tls.getCACertificates("default");

  expect(defaultCerts.length).toBe(explicitDefaultCerts.length);
});

test("system and bundled certificates should be different", () => {
  const systemCerts = tls.getCACertificates("system");
  const bundledCerts = tls.getCACertificates("bundled");

  // System and bundled should be different (system is from OS, bundled is from Node.js)
  expect(systemCerts.length).not.toBe(bundledCerts.length);
});
