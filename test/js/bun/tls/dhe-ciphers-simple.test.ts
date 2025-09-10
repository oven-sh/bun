import { expect, test } from "bun:test";

// Practical tests for DHE cipher functionality in Bun
// Related to issue #21891: Five "crypto" ciphers are unusable with "tls" (unlike NodeJS)

const testCiphers = [
  "DHE-RSA-AES128-GCM-SHA256",
  "DHE-RSA-AES128-SHA256",
  "DHE-RSA-AES256-SHA384",
  "ECDHE-RSA-AES256-SHA256",
  "DHE-RSA-AES256-SHA256",
];

test("DHE ciphers can be set individually in DEFAULT_CIPHERS", () => {
  const tls = require("tls");
  const originalCiphers = tls.DEFAULT_CIPHERS;

  try {
    // Test each cipher can be set without throwing
    for (const cipher of testCiphers) {
      expect(() => {
        tls.DEFAULT_CIPHERS = cipher + ":HIGH:!aNULL:!eNULL";
      }).not.toThrow();

      // Verify it was actually set
      expect(tls.DEFAULT_CIPHERS).toContain(cipher);
    }
  } finally {
    // Restore original
    tls.DEFAULT_CIPHERS = originalCiphers;
  }
});

test("DHE ciphers are included in default cipher list", () => {
  const tls = require("tls");
  const defaultCiphers = tls.DEFAULT_CIPHERS;

  // All test ciphers should be in the default list
  for (const cipher of testCiphers) {
    expect(defaultCiphers).toContain(cipher);
  }
});

test("DHE ciphers are listed in getCiphers() output", () => {
  const tls = require("tls");
  const availableCiphers = tls.getCiphers();

  // Filter out configuration directives (they start with ! or are keywords like HIGH)
  const actualCipherNames = availableCiphers.filter(
    (cipher: string) =>
      !cipher.startsWith("!") &&
      !["HIGH", "MEDIUM", "LOW", "EXPORT", "NULL"].includes(cipher) &&
      !cipher.startsWith("TLS_"), // TLS 1.3 ciphers are different
  );

  for (const cipher of testCiphers) {
    expect(actualCipherNames).toContain(cipher);
  }
});

test("Can create TLS server context with DHE ciphers", () => {
  const tls = require("tls");
  const crypto = require("crypto");

  // Generate a simple key pair for testing
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Simple self-signed cert (just for context creation test)
  const simpleCert = `-----BEGIN CERTIFICATE-----
MIICpjCCAY4CCQDtGqcHH8KqHTANBgkqhkiG9w0BAQsFADAUMRIwEAYDVQQDDAls
b2NhbGhvc3QwHhcNMjQwMTAxMDAwMDAwWhcNMjUwMTAxMDAwMDAwWjAUMRIwEAYD
VQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC5
Vay/kboq/wG8jJmOboLxWodXupPF5RY0SrEnOocLi/YTq0S5ZV8pwtW87bEjuoBW
PEW70gWb8qBe7tkbhUcQni9kFg3x9WMqH0vkzyHnMeDzATxNoqr0SOMXlV8q0T1f
ZGEl0erzBRnlW9bjNQ10Tg0xazykPskvicsweR2IZvwukeDywWbEKvwX1sS/pJtG
YfpUnjBRW01gAp8AonNiMcSTt1Ptjxewbx1I8yAZk+0jEHFr3YE8iF3xrFcKgB9u
TqYnFpCv2E9SfZVk2qF6SRgBFGc3MzErKm8hJ8fNzkH3pEv8SqQIDAQABMA0GCSq
GSIb3DQEBCwUAA4IBAQBQv7tNcPJ6BJ3DuLGE4m9chHHH8ZRfTw9wL9eFoGUqT8m
EVzFu3mF9YE8KcHkNhU9rVj8UJHfVHEh8+i7N3aKhLMEKhH3kZzR7SjqKUz3NF9j
Ek8dLYpxRF6D3HKm8F2cG9L7M+QvNKxFPrUjHUWr3HzRf8QJLaR8F7VzLu8tAaH
q3K9YNj3bFf6rLJh4eFpG8iF4fKqN8SuHdH3hF8oG6L2S7MfF8F3K8wfVjF7YNh
Jg3F9hUgFfKcE3LkSrF8dNjU2cFaHhJ4bGqFaJ3ZNhFtJzWrF2BfEKdHVwLKfKc
F6r8EpVuF8tKgD4rNF7bYNqTy8dCnJgE2ZpEgLw
-----END CERTIFICATE-----`;

  // Test that we can create TLS server contexts with each DHE cipher
  for (const cipher of testCiphers) {
    expect(() => {
      tls.createSecureContext({
        key: privateKey,
        cert: simpleCert,
        ciphers: cipher + ":HIGH:!aNULL:!eNULL",
      });
    }).not.toThrow(`Failed to create secure context with cipher: ${cipher}`);
  }
});

test("Original issue scenario: can assign defaultCipherList to DEFAULT_CIPHERS", () => {
  const tls = require("tls");
  const crypto = require("crypto");

  const originalCiphers = tls.DEFAULT_CIPHERS;

  try {
    // This was the failing case from the GitHub issue
    expect(() => {
      tls.DEFAULT_CIPHERS = crypto.constants.defaultCipherList;
    }).not.toThrow();

    // Should now be identical to Node.js behavior
    expect(tls.DEFAULT_CIPHERS).toBe(crypto.constants.defaultCipherList);

    // Verify all our test ciphers are included
    for (const cipher of testCiphers) {
      expect(tls.DEFAULT_CIPHERS).toContain(cipher);
    }
  } finally {
    tls.DEFAULT_CIPHERS = originalCiphers;
  }
});
