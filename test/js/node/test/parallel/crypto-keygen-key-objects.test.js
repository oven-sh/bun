//#FILE: test-crypto-keygen-key-objects.js
//#SHA1: 7a2dce611ba70e533ebb73d9f281896bdf75051f
//-----------------
"use strict";

if (!process.versions.bun) {
  const common = require("../common");
  if (!common.hasCrypto) common.skip("missing crypto");
}

const { generateKeyPairSync } = require("crypto");

// Test sync key generation with key objects.
test("generateKeyPairSync with RSA", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 512,
  });

  expect(typeof publicKey).toBe("object");
  expect(publicKey.type).toBe("public");
  expect(publicKey.asymmetricKeyType).toBe("rsa");
  expect(publicKey.asymmetricKeyDetails).toEqual({
    modulusLength: 512,
    publicExponent: 65537n,
  });

  expect(typeof privateKey).toBe("object");
  expect(privateKey.type).toBe("private");
  expect(privateKey.asymmetricKeyType).toBe("rsa");
  expect(privateKey.asymmetricKeyDetails).toEqual({
    modulusLength: 512,
    publicExponent: 65537n,
  });
});

//<#END_FILE: test-crypto-keygen-key-objects.js
