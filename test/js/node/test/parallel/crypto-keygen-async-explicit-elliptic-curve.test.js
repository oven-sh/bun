//#FILE: test-crypto-keygen-async-explicit-elliptic-curve.js
//#SHA1: be1eabf816f52e5f53cb2535d47050b2552d21cd
//-----------------
"use strict";

const crypto = require("crypto");

// Skip the test if crypto support is not available
if (!crypto.generateKeyPair) {
  test.skip("missing crypto support", () => {});
} else {
  const { generateKeyPair } = crypto;

  const { testSignVerify, spkiExp, sec1Exp } = require("../common/crypto");

  // Test async explicit elliptic curve key generation, e.g. for ECDSA,
  // with a SEC1 private key with paramEncoding explicit.
  test("async explicit elliptic curve key generation", async () => {
    await new Promise((resolve, reject) => {
      generateKeyPair(
        "ec",
        {
          namedCurve: "prime256v1",
          paramEncoding: "explicit",
          publicKeyEncoding: {
            type: "spki",
            format: "pem",
          },
          privateKeyEncoding: {
            type: "sec1",
            format: "pem",
          },
        },
        (err, publicKey, privateKey) => {
          if (err) reject(err);
          else resolve({ publicKey, privateKey });
        },
      );
    }).then(({ publicKey, privateKey }) => {
      expect(typeof publicKey).toBe("string");
      expect(publicKey).toMatch(spkiExp);
      expect(typeof privateKey).toBe("string");
      expect(privateKey).toMatch(sec1Exp);

      return testSignVerify(publicKey, privateKey);
    });
  });
}

//<#END_FILE: test-crypto-keygen-async-explicit-elliptic-curve.js
