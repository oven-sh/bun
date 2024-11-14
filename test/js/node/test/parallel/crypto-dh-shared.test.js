//#FILE: test-crypto-dh-shared.js
//#SHA1: 8d5e31de4aa93f435c4c6d05d7b394156a38fb8e
//-----------------
"use strict";

const crypto = require("crypto");

test("Diffie-Hellman shared secret computation", () => {
  const alice = crypto.createDiffieHellmanGroup("modp5");
  const bob = crypto.createDiffieHellmanGroup("modp5");

  alice.generateKeys();
  bob.generateKeys();

  const aSecret = alice.computeSecret(bob.getPublicKey()).toString("hex");
  const bSecret = bob.computeSecret(alice.getPublicKey()).toString("hex");

  expect(aSecret).toBe(bSecret);
});

//<#END_FILE: test-crypto-dh-shared.js
