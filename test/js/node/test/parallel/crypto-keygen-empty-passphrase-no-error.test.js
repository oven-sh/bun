//#FILE: test-crypto-keygen-empty-passphrase-no-error.js
//#SHA1: a949b38385a5dd05507975cbc44b3beba764bd95
//-----------------
"use strict";

const crypto = require("crypto");

// Skip the test if crypto is not available
if (typeof crypto.generateKeyPair !== "function") {
  test.skip("missing crypto", () => {});
} else {
  test("generateKeyPair with empty passphrase should not throw ERR_OSSL_CRYPTO_MALLOC_FAILURE", async () => {
    // Passing an empty passphrase string should not throw ERR_OSSL_CRYPTO_MALLOC_FAILURE even on OpenSSL 3.
    // Regression test for https://github.com/nodejs/node/issues/41428.
    await expect(
      new Promise((resolve, reject) => {
        crypto.generateKeyPair(
          "rsa",
          {
            modulusLength: 1024,
            publicKeyEncoding: {
              type: "spki",
              format: "pem",
            },
            privateKeyEncoding: {
              type: "pkcs8",
              format: "pem",
              cipher: "aes-256-cbc",
              passphrase: "",
            },
          },
          (err, publicKey, privateKey) => {
            if (err) reject(err);
            else resolve({ publicKey, privateKey });
          },
        );
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        publicKey: expect.any(String),
        privateKey: expect.any(String),
      }),
    );
  });
}

//<#END_FILE: test-crypto-keygen-empty-passphrase-no-error.js
