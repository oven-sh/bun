//#FILE: test-global-webcrypto.js
//#SHA1: 3ae34178f201f6dfeb3ca5ec6e0914e6de63d64b
//-----------------
"use strict";

const crypto = require("crypto");

// Skip the test if crypto is not available
if (!crypto) {
  test.skip("missing crypto", () => {});
} else {
  describe("Global WebCrypto", () => {
    test("globalThis.crypto is crypto.webcrypto", () => {
      expect(globalThis.crypto).toBe(crypto.webcrypto);
    });

    test("Crypto is the constructor of crypto.webcrypto", () => {
      expect(Crypto).toBe(crypto.webcrypto.constructor);
    });

    test("SubtleCrypto is the constructor of crypto.webcrypto.subtle", () => {
      expect(SubtleCrypto).toBe(crypto.webcrypto.subtle.constructor);
    });
  });
}

//<#END_FILE: test-global-webcrypto.js
