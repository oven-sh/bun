// https://github.com/oven-sh/bun/issues/29558
//
// createPublicKey rejected a DER SubjectPublicKeyInfo for an RSA public key
// when the modulus had the high bit set without a leading 0x00 sign byte.
// BoringSSL strictly refuses that encoding (BN_R_NEGATIVE_NUMBER); Node
// (linked to OpenSSL) accepts it. The sample SPKI is a 256-bit RSA key whose
// modulus starts with 0xDF — intentionally tiny, which is why such minimal
// DER encodings show up in test fixtures.

import { expect, test } from "bun:test";
import { createPublicKey } from "node:crypto";

// Minimal DER RSA SubjectPublicKeyInfo whose modulus omits the leading
// 0x00 sign byte (first modulus byte is 0xDF).
const SPKI_DER_BASE64 = "MDswDQYJKoZIhvcNAQEBBQADKgAwJwIg3wUvyMOfq7G6dT5bIM6keoShd9YGwP7PIc2Tfa8Q99ECAwEAAQ==";

test("createPublicKey accepts RSA SPKI DER whose modulus lacks the 0x00 sign byte", () => {
  const der = Buffer.from(SPKI_DER_BASE64, "base64");

  const key = createPublicKey({ key: der, format: "der", type: "spki" });

  expect(key.type).toBe("public");
  expect(key.asymmetricKeyType).toBe("rsa");
  expect(key.asymmetricKeyDetails).toEqual({
    modulusLength: 256,
    publicExponent: 65537n,
  });
});

test("createPublicKey accepts the same SPKI wrapped in a PEM block", () => {
  const der = Buffer.from(SPKI_DER_BASE64, "base64");
  const pem = `-----BEGIN PUBLIC KEY-----\n${der.toString("base64")}\n-----END PUBLIC KEY-----\n`;

  const key = createPublicKey(pem);

  expect(key.type).toBe("public");
  expect(key.asymmetricKeyType).toBe("rsa");
  expect(key.asymmetricKeyDetails).toEqual({
    modulusLength: 256,
    publicExponent: 65537n,
  });
});

test("re-exported SPKI is the canonical form with a leading 0x00 sign byte", () => {
  const der = Buffer.from(SPKI_DER_BASE64, "base64");
  const key = createPublicKey({ key: der, format: "der", type: "spki" });

  // Re-exporting via BoringSSL's marshal code inserts the leading zero, so
  // the canonical DER is one byte longer than the non-conforming input.
  const reexported = key.export({ type: "spki", format: "der" });
  expect(reexported.toString("base64")).toBe(
    "MDwwDQYJKoZIhvcNAQEBBQADKwAwKAIhAN8FL8jDn6uxunU+WyDOpHqEoXfWBsD+zyHNk32vEPfRAgMBAAE=",
  );
  expect(reexported.length).toBe(der.length + 1);
});
