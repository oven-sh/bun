//#FILE: test-crypto-update-encoding.js
//#SHA1: dfe3c7e71e22a772cf6b2e6a6540be161fda3418
//-----------------
"use strict";

const crypto = require("crypto");

const zeros = Buffer.alloc;
const key = zeros(16);
const iv = zeros(16);

const cipher = () => crypto.createCipheriv("aes-128-cbc", key, iv);
const decipher = () => crypto.createDecipheriv("aes-128-cbc", key, iv);
const hash = () => crypto.createSign("sha256");
const hmac = () => crypto.createHmac("sha256", key);
const sign = () => crypto.createSign("sha256");
const verify = () => crypto.createVerify("sha256");

test("crypto update ignores inputEncoding for Buffer input", () => {
  const functions = [cipher, decipher, hash, hmac, sign, verify];
  const sizes = [15, 16];

  functions.forEach(f => {
    sizes.forEach(n => {
      const instance = f();
      expect(() => {
        instance.update(zeros(n), "hex");
      }).not.toThrow();
    });
  });
});

//<#END_FILE: test-crypto-update-encoding.js
