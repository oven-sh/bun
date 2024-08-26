//#FILE: test-crypto-keygen-sync.js
//#SHA1: 57749dc903b0d5f9b64a3d61f313be6e5549323f
//-----------------
"use strict";

const crypto = require("crypto");
const {
  assertApproximateSize,
  testEncryptDecrypt,
  testSignVerify,
  pkcs1PubExp,
  pkcs8Exp,
} = require("../common/crypto");

// Skip the test if crypto support is not available
if (typeof crypto.generateKeyPairSync !== "function") {
  test.skip("missing crypto support", () => {});
} else {
  // To make the test faster, we will only test sync key generation once and
  // with a relatively small key.
  test("generateKeyPairSync", () => {
    const ret = crypto.generateKeyPairSync("rsa", {
      publicExponent: 3,
      modulusLength: 512,
      publicKeyEncoding: {
        type: "pkcs1",
        format: "pem",
      },
      privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
      },
    });

    expect(Object.keys(ret)).toHaveLength(2);
    const { publicKey, privateKey } = ret;

    expect(typeof publicKey).toBe("string");
    expect(publicKey).toMatch(pkcs1PubExp);
    assertApproximateSize(publicKey, 162);
    expect(typeof privateKey).toBe("string");
    expect(privateKey).toMatch(pkcs8Exp);
    assertApproximateSize(privateKey, 512);

    testEncryptDecrypt(publicKey, privateKey);
    testSignVerify(publicKey, privateKey);
  });
}

//<#END_FILE: test-crypto-keygen-sync.js
