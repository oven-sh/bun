//#FILE: test-crypto-keygen-missing-oid.js
//#SHA1: ffcbc53b115cce8795ca1a0e73a533b04789a930
//-----------------
"use strict";

const { generateKeyPair, generateKeyPairSync, getCurves } = require("crypto");

// This test creates EC key pairs on curves without associated OIDs.
// Specifying a key encoding should not crash.
test("EC key pairs on curves without associated OIDs", () => {
  if (process.versions.openssl >= "1.1.1i") {
    const curves = ["Oakley-EC2N-3", "Oakley-EC2N-4"];
    const availableCurves = getCurves();

    for (const namedCurve of curves) {
      if (!availableCurves.includes(namedCurve)) continue;

      const expectedErrorCode = process.versions.openssl.startsWith("3.")
        ? "ERR_OSSL_MISSING_OID"
        : "ERR_OSSL_EC_MISSING_OID";

      const params = {
        namedCurve,
        publicKeyEncoding: {
          format: "der",
          type: "spki",
        },
      };

      expect(() => {
        generateKeyPairSync("ec", params);
      }).toThrow(
        expect.objectContaining({
          code: expectedErrorCode,
          message: expect.any(String),
        }),
      );

      return new Promise(resolve => {
        generateKeyPair("ec", params, err => {
          expect(err).toMatchObject({
            code: expectedErrorCode,
            message: expect.any(String),
          });
          resolve();
        });
      });
    }
  } else {
    // Skip test if OpenSSL version is less than 1.1.1i
    test.skip("OpenSSL version is less than 1.1.1i");
  }
});

//<#END_FILE: test-crypto-keygen-missing-oid.js
