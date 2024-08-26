//#FILE: test-crypto-keygen-async-encrypted-private-key-der.js
//#SHA1: 30f86c68619f3f24294d5f062eed48b13c116b0c
//-----------------
"use strict";

const crypto = require("crypto");
const { assertApproximateSize, testEncryptDecrypt, testSignVerify } = require("../common/crypto");

// Test async RSA key generation with an encrypted private key, but encoded as DER.
test("RSA key generation with encrypted private key (DER)", async () => {
  const { publicKey: publicKeyDER, privateKey: privateKeyDER } = await new Promise((resolve, reject) => {
    crypto.generateKeyPair(
      "rsa",
      {
        publicExponent: 0x10001,
        modulusLength: 512,
        publicKeyEncoding: {
          type: "pkcs1",
          format: "der",
        },
        privateKeyEncoding: {
          type: "pkcs8",
          format: "der",
        },
      },
      (err, publicKey, privateKey) => {
        if (err) reject(err);
        else resolve({ publicKey, privateKey });
      },
    );
  });

  expect(Buffer.isBuffer(publicKeyDER)).toBe(true);
  assertApproximateSize(publicKeyDER, 74);

  expect(Buffer.isBuffer(privateKeyDER)).toBe(true);

  const publicKey = {
    key: publicKeyDER,
    type: "pkcs1",
    format: "der",
  };
  const privateKey = {
    key: privateKeyDER,
    format: "der",
    type: "pkcs8",
    passphrase: "secret",
  };

  await testEncryptDecrypt(publicKey, privateKey);
  await testSignVerify(publicKey, privateKey);
});

//<#END_FILE: test-crypto-keygen-async-encrypted-private-key-der.js
