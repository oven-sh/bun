import { test, expect } from "bun:test";

// Test for issue #21891: Five "crypto" ciphers are unusable with "tls" (unlike NodeJS)
// https://github.com/oven-sh/bun/issues/21891

test("tls.DEFAULT_CIPHERS can be set to crypto.constants.defaultCipherList", () => {
  const tls = require("tls");
  const crypto = require("crypto");

  // Store original value
  const originalCiphers = tls.DEFAULT_CIPHERS;

  try {
    // This should work without throwing (the main fix)
    expect(() => {
      tls.DEFAULT_CIPHERS = crypto.constants.defaultCipherList;
    }).not.toThrow();

    // The assignment should succeed
    expect(typeof tls.DEFAULT_CIPHERS).toBe("string");
    expect(tls.DEFAULT_CIPHERS.length).toBeGreaterThan(0);

    // Should include all the DHE ciphers that were missing before
    expect(tls.DEFAULT_CIPHERS).toContain("DHE-RSA-AES128-GCM-SHA256");
    expect(tls.DEFAULT_CIPHERS).toContain("DHE-RSA-AES128-SHA256");
    expect(tls.DEFAULT_CIPHERS).toContain("DHE-RSA-AES256-SHA256");
    expect(tls.DEFAULT_CIPHERS).toContain("DHE-RSA-AES256-SHA384");
    expect(tls.DEFAULT_CIPHERS).toContain("ECDHE-RSA-AES256-SHA256");

    // Should still include standard ciphers
    expect(tls.DEFAULT_CIPHERS).toContain("ECDHE-RSA-AES128-GCM-SHA256");
    expect(tls.DEFAULT_CIPHERS).toContain("TLS_AES_256_GCM_SHA384");

  } finally {
    // Restore original value
    tls.DEFAULT_CIPHERS = originalCiphers;
  }
});

test("crypto.constants.defaultCipherList contains expected ciphers", () => {
  const crypto = require("crypto");
  const cipherList = crypto.constants.defaultCipherList;
  
  // Should be identical to Node.js defaultCipherList
  expect(cipherList).toBe(
    "TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:" +
    "ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:" +
    "ECDHE-ECDSA-AES256-GCM-SHA384:DHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-SHA256:" +
    "DHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384:DHE-RSA-AES256-SHA384:" +
    "ECDHE-RSA-AES256-SHA256:DHE-RSA-AES256-SHA256:HIGH:!aNULL:!eNULL:!EXPORT:!DES:!RC4:" +
    "!MD5:!PSK:!SRP:!CAMELLIA"
  );
});

test("tls.DEFAULT_CIPHERS includes all previously missing ciphers by default", () => {
  const tls = require("tls");
  
  // Should include all 5 ciphers that were missing before the fix
  expect(tls.DEFAULT_CIPHERS).toContain("DHE-RSA-AES128-GCM-SHA256");
  expect(tls.DEFAULT_CIPHERS).toContain("DHE-RSA-AES128-SHA256"); 
  expect(tls.DEFAULT_CIPHERS).toContain("DHE-RSA-AES256-SHA384");
  expect(tls.DEFAULT_CIPHERS).toContain("ECDHE-RSA-AES256-SHA256");
  expect(tls.DEFAULT_CIPHERS).toContain("DHE-RSA-AES256-SHA256");
});