//#FILE: test-crypto-keygen-async-elliptic-curve-jwk-rsa.js
//#SHA1: 4337f1e36680f21ed3439d7ab546ea855a0a842e
//-----------------
"use strict";

const { generateKeyPair } = require("crypto");

// Test async elliptic curve key generation with 'jwk' encoding and RSA.
test("async elliptic curve key generation with jwk encoding and RSA", async () => {
  const { publicKey, privateKey } = await new Promise((resolve, reject) => {
    generateKeyPair(
      "rsa",
      {
        modulusLength: 1024,
        publicKeyEncoding: {
          format: "jwk",
        },
        privateKeyEncoding: {
          format: "jwk",
        },
      },
      (err, publicKey, privateKey) => {
        if (err) reject(err);
        else resolve({ publicKey, privateKey });
      },
    );
  });

  expect(typeof publicKey).toBe("object");
  expect(typeof privateKey).toBe("object");
  expect(publicKey.kty).toBe("RSA");
  expect(publicKey.kty).toBe(privateKey.kty);
  expect(typeof publicKey.n).toBe("string");
  expect(publicKey.n).toBe(privateKey.n);
  expect(typeof publicKey.e).toBe("string");
  expect(publicKey.e).toBe(privateKey.e);
  expect(typeof privateKey.d).toBe("string");
  expect(typeof privateKey.p).toBe("string");
  expect(typeof privateKey.q).toBe("string");
  expect(typeof privateKey.dp).toBe("string");
  expect(typeof privateKey.dq).toBe("string");
  expect(typeof privateKey.qi).toBe("string");
});

//<#END_FILE: test-crypto-keygen-async-elliptic-curve-jwk-rsa.js
