//#FILE: test-crypto-keygen-promisify.js
//#SHA1: 70eb7089a04950a2ce28a3af9949105eefd420fa
//-----------------
"use strict";

const crypto = require("crypto");
const util = require("util");

const {
  assertApproximateSize,
  testEncryptDecrypt,
  testSignVerify,
  pkcs1PubExp,
  pkcs1PrivExp,
} = require("../common/crypto");

// Skip the test if crypto support is not available
if (!crypto.generateKeyPair) {
  test.skip("missing crypto support", () => {});
} else {
  // Test the util.promisified API with async RSA key generation.
  test("util.promisified generateKeyPair with RSA", async () => {
    const generateKeyPairPromise = util.promisify(crypto.generateKeyPair);
    const keys = await generateKeyPairPromise("rsa", {
      publicExponent: 0x10001,
      modulusLength: 512,
      publicKeyEncoding: {
        type: "pkcs1",
        format: "pem",
      },
      privateKeyEncoding: {
        type: "pkcs1",
        format: "pem",
      },
    });

    const { publicKey, privateKey } = keys;
    expect(typeof publicKey).toBe("string");
    expect(publicKey).toMatch(pkcs1PubExp);
    assertApproximateSize(publicKey, 180);

    expect(typeof privateKey).toBe("string");
    expect(privateKey).toMatch(pkcs1PrivExp);
    assertApproximateSize(privateKey, 512);

    testEncryptDecrypt(publicKey, privateKey);
    testSignVerify(publicKey, privateKey);
  });
}

//<#END_FILE: test-crypto-keygen-promisify.js
