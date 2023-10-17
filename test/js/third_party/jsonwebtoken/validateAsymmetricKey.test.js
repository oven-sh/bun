import { expect, describe, it } from "bun:test";
import { createPrivateKey } from "crypto";
import fs from "fs";
import path from "path";
const PS_SUPPORTED = true;
const ASYMMETRIC_KEY_DETAILS_SUPPORTED = true;
const RSA_PSS_KEY_DETAILS_SUPPORTED = true;
const allowedAlgorithmsForKeys = {
  "ec": ["ES256", "ES384", "ES512"],
  "rsa": ["RS256", "PS256", "RS384", "PS384", "RS512", "PS512"],
  "rsa-pss": ["PS256", "PS384", "PS512"],
};

const allowedCurves = {
  ES256: "prime256v1",
  ES384: "secp384r1",
  ES512: "secp521r1",
};

function validateAsymmetricKey(algorithm, key) {
  if (!algorithm || !key) return;

  const keyType = key.asymmetricKeyType;
  if (!keyType) return;

  const allowedAlgorithms = allowedAlgorithmsForKeys[keyType];

  if (!allowedAlgorithms) {
    throw new Error(`Unknown key type "${keyType}".`);
  }

  if (!allowedAlgorithms.includes(algorithm)) {
    throw new Error(`"alg" parameter for "${keyType}" key type must be one of: ${allowedAlgorithms.join(", ")}.`);
  }

  /*
   * Ignore the next block from test coverage because it gets executed
   * conditionally depending on the Node version. Not ignoring it would
   * prevent us from reaching the target % of coverage for versions of
   * Node under 15.7.0.
   */
  /* istanbul ignore next */
  if (ASYMMETRIC_KEY_DETAILS_SUPPORTED) {
    switch (keyType) {
      case "ec":
        const keyCurve = key.asymmetricKeyDetails.namedCurve;
        const allowedCurve = allowedCurves[algorithm];

        if (keyCurve !== allowedCurve) {
          throw new Error(`"alg" parameter "${algorithm}" requires curve "${allowedCurve}".`);
        }
        break;

      case "rsa-pss":
        if (RSA_PSS_KEY_DETAILS_SUPPORTED) {
          const length = parseInt(algorithm.slice(-3), 10);
          const { hashAlgorithm, mgf1HashAlgorithm, saltLength } = key.asymmetricKeyDetails;

          if (hashAlgorithm !== `sha${length}` || mgf1HashAlgorithm !== hashAlgorithm) {
            throw new Error(
              `Invalid key for this operation, its RSA-PSS parameters do not meet the requirements of "alg" ${algorithm}.`,
            );
          }

          if (saltLength !== undefined && saltLength > length >> 3) {
            throw new Error(
              `Invalid key for this operation, its RSA-PSS parameter saltLength does not meet the requirements of "alg" ${algorithm}.`,
            );
          }
        }
        break;
    }
  }
}

function loadKey(filename) {
  return createPrivateKey(fs.readFileSync(path.join(__dirname, filename)));
}

const algorithmParams = {
  RS256: {
    invalidPrivateKey: loadKey("secp384r1-private.pem"),
  },
  ES256: {
    invalidPrivateKey: loadKey("priv.pem"),
  },
};

if (PS_SUPPORTED) {
  algorithmParams.PS256 = {
    invalidPrivateKey: loadKey("secp384r1-private.pem"),
  };
}

describe("Asymmetric key validation", function () {
  Object.keys(algorithmParams).forEach(function (algorithm) {
    describe(algorithm, function () {
      const keys = algorithmParams[algorithm];

      describe("when validating a key with an invalid private key type", function () {
        it("should throw an error", function () {
          const expectedErrorMessage = /"alg" parameter for "[\w\d-]+" key type must be one of:/;

          expect(function () {
            validateAsymmetricKey(algorithm, keys.invalidPrivateKey);
          }).toThrow(expectedErrorMessage);
        });
      });
    });
  });

  describe("when the function has missing parameters", function () {
    it("should pass the validation if no key has been provided", function () {
      const algorithm = "ES256";
      validateAsymmetricKey(algorithm);
    });

    it.todo("should pass the validation if no algorithm has been provided", function () {
      const key = loadKey("dsa-private.pem");
      validateAsymmetricKey(null, key);
    });
  });

  describe("when validating a key with an unsupported type", function () {
    it.todo("should throw an error", function () {
      const algorithm = "RS256";
      const key = loadKey("dsa-private.pem");
      const expectedErrorMessage = 'Unknown key type "dsa".';

      expect(function () {
        validateAsymmetricKey(algorithm, key);
      }).toThrow(expectedErrorMessage);
    });
  });

  describe("Elliptic curve algorithms", function () {
    const curvesAlgorithms = [
      { algorithm: "ES256", curve: "prime256v1" },
      { algorithm: "ES384", curve: "secp384r1" },
      { algorithm: "ES512", curve: "secp521r1" },
    ];

    const curvesKeys = [
      { curve: "prime256v1", key: loadKey("prime256v1-private.pem") },
      { curve: "secp384r1", key: loadKey("secp384r1-private.pem") },
      { curve: "secp521r1", key: loadKey("secp521r1-private.pem") },
    ];

    describe("when validating keys generated using Elliptic Curves", function () {
      curvesAlgorithms.forEach(function (curveAlgorithm) {
        curvesKeys.forEach(curveKeys => {
          if (curveKeys.curve !== curveAlgorithm.curve) {
            if (ASYMMETRIC_KEY_DETAILS_SUPPORTED) {
              it(`should throw an error when validating an ${curveAlgorithm.algorithm} token for key with curve ${curveKeys.curve}`, function () {
                expect(() => {
                  validateAsymmetricKey(curveAlgorithm.algorithm, curveKeys.key);
                }).toThrow(`"alg" parameter "${curveAlgorithm.algorithm}" requires curve "${curveAlgorithm.curve}".`);
              });
            } else {
              it(`should pass the validation for incorrect keys if the Node version does not support checking the key's curve name`, function () {
                expect(() => {
                  validateAsymmetricKey(curveAlgorithm.algorithm, curveKeys.key);
                }).not.toThrow();
              });
            }
          } else {
            it(`should accept an ${curveAlgorithm.algorithm} token for key with curve ${curveKeys.curve}`, function () {
              expect(() => {
                validateAsymmetricKey(curveAlgorithm.algorithm, curveKeys.key);
              }).not.toThrow();
            });
          }
        });
      });
    });
  });

  if (RSA_PSS_KEY_DETAILS_SUPPORTED) {
    describe.todo("RSA-PSS algorithms", function () {
      // const key = loadKey('rsa-pss-private.pem');

      it(`it should throw an error when validating a key with wrong RSA-RSS parameters`, function () {
        const algorithm = "PS512";
        expect(function () {
          validateAsymmetricKey(algorithm, key);
        }).toThrow(
          'Invalid key for this operation, its RSA-PSS parameters do not meet the requirements of "alg" PS512',
        );
      });

      it(`it should throw an error when validating a key with invalid salt length`, function () {
        const algorithm = "PS256";
        const shortSaltKey = loadKey("rsa-pss-invalid-salt-length-private.pem");
        expect(function () {
          validateAsymmetricKey(algorithm, shortSaltKey);
        }).toThrow(
          'Invalid key for this operation, its RSA-PSS parameter saltLength does not meet the requirements of "alg" PS256.',
        );
      });

      it(`it should pass the validation when the key matches all the requirements for the algorithm`, function () {
        expect(function () {
          const algorithm = "PS256";
          validateAsymmetricKey(algorithm, key);
        }).not.toThrow();
      });
    });
  }
});
