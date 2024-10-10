//#FILE: test-crypto-keygen-key-object-without-encoding.js
//#SHA1: da408ed128f913dc7343ef88743b362c16420ba0
//-----------------
"use strict";

const crypto = require("crypto");

// Skip the test if crypto is not available
if (!crypto.generateKeyPair) {
  test.skip("missing crypto");
}

const { generateKeyPair } = crypto;

// Helper functions for testing encryption/decryption and signing/verifying
const testEncryptDecrypt = (publicKey, privateKey) => {
  const plaintext = "Hello, World!";
  const encrypted = crypto.publicEncrypt(publicKey, Buffer.from(plaintext));
  const decrypted = crypto.privateDecrypt(privateKey, encrypted);
  expect(decrypted.toString()).toBe(plaintext);
};

const testSignVerify = (publicKey, privateKey) => {
  const data = "Hello, World!";
  const sign = crypto.createSign("SHA256");
  sign.update(data);
  const signature = sign.sign(privateKey);
  const verify = crypto.createVerify("SHA256");
  verify.update(data);
  expect(verify.verify(publicKey, signature)).toBe(true);
};

// Tests key objects are returned when key encodings are not specified.
describe("generateKeyPair without encoding", () => {
  // If no publicKeyEncoding is specified, a key object should be returned.
  test("returns key object for public key when no encoding specified", done => {
    generateKeyPair(
      "rsa",
      {
        modulusLength: 1024,
        privateKeyEncoding: {
          type: "pkcs1",
          format: "pem",
        },
      },
      (err, publicKey, privateKey) => {
        expect(err).toBe(null);
        expect(typeof publicKey).toBe("object");
        expect(publicKey.type).toBe("public");
        expect(publicKey.asymmetricKeyType).toBe("rsa");

        // The private key should still be a string.
        expect(typeof privateKey).toBe("string");

        testEncryptDecrypt(publicKey, privateKey);
        testSignVerify(publicKey, privateKey);
        done();
      },
    );
  });

  // If no privateKeyEncoding is specified, a key object should be returned.
  test("returns key object for private key when no encoding specified", done => {
    generateKeyPair(
      "rsa",
      {
        modulusLength: 1024,
        publicKeyEncoding: {
          type: "pkcs1",
          format: "pem",
        },
      },
      (err, publicKey, privateKey) => {
        expect(err).toBe(null);
        // The public key should still be a string.
        expect(typeof publicKey).toBe("string");

        expect(typeof privateKey).toBe("object");
        expect(privateKey.type).toBe("private");
        expect(privateKey.asymmetricKeyType).toBe("rsa");

        testEncryptDecrypt(publicKey, privateKey);
        testSignVerify(publicKey, privateKey);
        done();
      },
    );
  });
});

//<#END_FILE: test-crypto-keygen-key-object-without-encoding.js
