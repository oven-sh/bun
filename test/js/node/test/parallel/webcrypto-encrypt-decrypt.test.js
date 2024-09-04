//#FILE: test-webcrypto-encrypt-decrypt.js
//#SHA1: 791cad35ebee437d2a982e6101d47daa2f775a4b
//-----------------
"use strict";

const { subtle } = globalThis.crypto;

// This is only a partial test. The WebCrypto Web Platform Tests
// will provide much greater coverage.

// Test Encrypt/Decrypt RSA-OAEP
test("Encrypt/Decrypt RSA-OAEP", async () => {
  const buf = globalThis.crypto.getRandomValues(new Uint8Array(50));
  const ec = new TextEncoder();
  const { publicKey, privateKey } = await subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-384",
    },
    true,
    ["encrypt", "decrypt"],
  );

  const ciphertext = await subtle.encrypt(
    {
      name: "RSA-OAEP",
      label: ec.encode("a label"),
    },
    publicKey,
    buf,
  );

  const plaintext = await subtle.decrypt(
    {
      name: "RSA-OAEP",
      label: ec.encode("a label"),
    },
    privateKey,
    ciphertext,
  );

  expect(Buffer.from(plaintext).toString("hex")).toBe(Buffer.from(buf).toString("hex"));
});

// Test Encrypt/Decrypt AES-CTR
test("Encrypt/Decrypt AES-CTR", async () => {
  const buf = globalThis.crypto.getRandomValues(new Uint8Array(50));
  const counter = globalThis.crypto.getRandomValues(new Uint8Array(16));

  const key = await subtle.generateKey(
    {
      name: "AES-CTR",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );

  const ciphertext = await subtle.encrypt({ name: "AES-CTR", counter, length: 64 }, key, buf);

  const plaintext = await subtle.decrypt({ name: "AES-CTR", counter, length: 64 }, key, ciphertext);

  expect(Buffer.from(plaintext).toString("hex")).toBe(Buffer.from(buf).toString("hex"));
});

// Test Encrypt/Decrypt AES-CBC
test("Encrypt/Decrypt AES-CBC", async () => {
  const buf = globalThis.crypto.getRandomValues(new Uint8Array(50));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(16));

  const key = await subtle.generateKey(
    {
      name: "AES-CBC",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );

  const ciphertext = await subtle.encrypt({ name: "AES-CBC", iv }, key, buf);

  const plaintext = await subtle.decrypt({ name: "AES-CBC", iv }, key, ciphertext);

  expect(Buffer.from(plaintext).toString("hex")).toBe(Buffer.from(buf).toString("hex"));
});

// Test Encrypt/Decrypt AES-GCM
test("Encrypt/Decrypt AES-GCM", async () => {
  const buf = globalThis.crypto.getRandomValues(new Uint8Array(50));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

  const key = await subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );

  const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, buf);

  const plaintext = await subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);

  expect(Buffer.from(plaintext).toString("hex")).toBe(Buffer.from(buf).toString("hex"));
});

//<#END_FILE: test-webcrypto-encrypt-decrypt.js
