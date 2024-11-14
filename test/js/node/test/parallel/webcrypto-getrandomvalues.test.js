//#FILE: test-webcrypto-getRandomValues.js
//#SHA1: d5d696eb0e68968d2411efa24e6e4c9bd46a1678
//-----------------
"use strict";

if (!globalThis.crypto) {
  it("skips test when crypto is missing", () => {
    console.log("missing crypto");
    return;
  });
} else {
  describe("webcrypto getRandomValues", () => {
    const { getRandomValues } = globalThis.crypto;

    it("throws ERR_INVALID_THIS when called without proper this", () => {
      expect(() => getRandomValues(new Uint8Array())).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_THIS",
          message: expect.any(String),
        }),
      );
    });
  });
}

//<#END_FILE: test-webcrypto-getRandomValues.js
