//#FILE: test-crypto-keygen-async-named-elliptic-curve.js
//#SHA1: 77822175b9b2c2206ec4ab8a3e1182e3576b23bd
//-----------------
"use strict";

const crypto = require("crypto");
const { testSignVerify } = require("../common/crypto");

if (!crypto.generateKeyPair) {
  test.skip("missing crypto.generateKeyPair");
}

const spkiExp =
  /^-----BEGIN PUBLIC KEY-----\n(?:[A-Za-z0-9+/=]{64}\n)*[A-Za-z0-9+/=]{1,64}\n-----END PUBLIC KEY-----\n$/;
const sec1Exp =
  /^-----BEGIN EC PRIVATE KEY-----\n(?:[A-Za-z0-9+/=]{64}\n)*[A-Za-z0-9+/=]{1,64}\n-----END EC PRIVATE KEY-----\n$/;

// Test async named elliptic curve key generation, e.g. for ECDSA,
// with a SEC1 private key.
test("async named elliptic curve key generation with SEC1 private key", async () => {
  const { publicKey, privateKey } = await new Promise((resolve, reject) => {
    crypto.generateKeyPair(
      "ec",
      {
        namedCurve: "prime256v1",
        paramEncoding: "named",
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
  });

  expect(typeof publicKey).toBe("string");
  expect(publicKey).toMatch(spkiExp);
  expect(typeof privateKey).toBe("string");
  expect(privateKey).toMatch(sec1Exp);

  await testSignVerify(publicKey, privateKey);
});

//<#END_FILE: test-crypto-keygen-async-named-elliptic-curve.js
