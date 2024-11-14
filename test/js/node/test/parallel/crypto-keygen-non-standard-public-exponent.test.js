//#FILE: test-crypto-keygen-non-standard-public-exponent.js
//#SHA1: 955e956a08102b75fcf0571213a1dd939d1f51ac
//-----------------
"use strict";

const crypto = require("crypto");

if (!crypto.generateKeyPairSync) {
  test.skip("missing crypto.generateKeyPairSync");
}

// Test sync key generation with key objects with a non-standard
// publicExponent
test("generateKeyPairSync with non-standard publicExponent", () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    publicExponent: 3,
    modulusLength: 512,
  });

  expect(typeof publicKey).toBe("object");
  expect(publicKey.type).toBe("public");
  expect(publicKey.asymmetricKeyType).toBe("rsa");
  expect(publicKey.asymmetricKeyDetails).toEqual({
    modulusLength: 512,
    publicExponent: 3n,
  });

  expect(typeof privateKey).toBe("object");
  expect(privateKey.type).toBe("private");
  expect(privateKey.asymmetricKeyType).toBe("rsa");
  expect(privateKey.asymmetricKeyDetails).toEqual({
    modulusLength: 512,
    publicExponent: 3n,
  });
});

//<#END_FILE: test-crypto-keygen-non-standard-public-exponent.js
