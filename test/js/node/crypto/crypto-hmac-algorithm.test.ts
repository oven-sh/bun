import { expect, test } from "bun:test";

import crypto from "node:crypto";

test("createHmac works with various algorithm names", () => {
  const key = "secret-key";
  const input = "hello world";

  const algorithms = [
    "sha1",
    "sha-256",
    "sHA-256",
    "sHa-256",
    "mD5",
    "sha256",
    "sha512",
    "md5",
    ...Bun.CryptoHasher.algorithms,
  ];

  const toRemove = [
    "blake2b256",
    "blake2b512",
    "blake2s256",
    "md4",
    "sha512-224",
    "sha512-256",
    "sha3-224",
    "sha3-256",
    "sha3-384",
    "sha3-512",
    "shake128",
    "shake256",
  ];
  for (const algo of toRemove) {
    algorithms.splice(algorithms.indexOf(algo), 1);
  }

  for (const algo of algorithms) {
    // Both ways of creating HMAC should work
    const hmac1 = crypto.createHmac(algo, key);
    const hmac2 = new crypto.Hmac(algo, key);

    hmac1.update(input);
    hmac2.update(input);

    expect(hmac1.digest("hex")).toBe(hmac2.digest("hex"));
  }
});

test("createHmac throws on invalid algorithm", () => {
  expect(() => {
    crypto.createHmac("invalid-algo", "key");
  }).toThrow();
});

test("Hmac throws on invalid algorithm", () => {
  expect(() => {
    new crypto.Hmac("invalid-algo", "key");
  }).toThrow();
});

test("Hmac can be updated multiple times", () => {
  const hmac = crypto.createHmac("sha256", "key");
  hmac.update("hello");
  hmac.update(" ");
  hmac.update("world");

  const singleUpdateHmac = crypto.createHmac("sha256", "key");
  singleUpdateHmac.update("hello world");

  expect(hmac.digest("hex")).toBe(singleUpdateHmac.digest("hex"));
});

test("Hmac digest can be called with different encodings", () => {
  const hmac = crypto.createHmac("sha256", "key");
  hmac.update("test");

  const hex = hmac.digest("hex");
  const base64 = hmac.digest("base64");

  expect(hex).toBeString();
  expect(base64).toBeString();
  expect(hex).not.toBe(base64);
});
