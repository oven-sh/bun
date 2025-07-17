// Copyright wpt contributors

// Adopted from the web-platform-test/WebCryptoAPI/generateKey
// https://github.com/web-platform-tests/wpt/tree/6b7cd07ee9a3ad1ce849b36bdb882b723fa172d8/WebCryptoAPI/generateKey

// TODO: The following tests should be removed once the node-wpt
//  or wpt test runner is fully adopted.
// FYI: https://github.com/oven-sh/bun/issues/19673

import {
  allAlgorithmSpecifiersFor,
  allNameVariants,
  allValidUsages,
  objectToString,
  registeredAlgorithmNames,
} from "./webcryptoTestHelpers";

registeredAlgorithmNames.forEach(name => {
  run_test_success([name]);
  run_test_failure([name]);
});

function run_test_failure(algorithmNames) {
  var subtle = crypto.subtle; // Change to test prefixed implementations

  // These tests check that generateKey throws an error, and that
  // the error is of the right type, for a wide set of incorrect parameters.
  //
  // Error testing occurs by setting the parameter that should trigger the
  // error to an invalid value, then combining that with all valid
  // parameters that should be checked earlier by generateKey, and all
  // valid and invalid parameters that should be checked later by
  // generateKey.
  //
  // There are a lot of combinations of possible parameters for both
  // success and failure modes, resulting in a very large number of tests
  // performed.

  // Setup: define the correct behaviors that should be sought, and create
  // helper functions that generate all possible test parameters for
  // different situations.

  var allTestVectors = [
    // Parameters that should work for generateKey
    {
      name: "AES-CTR",
      resultType: CryptoKey,
      usages: ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
      mandatoryUsages: [],
    },
    {
      name: "AES-CBC",
      resultType: CryptoKey,
      usages: ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
      mandatoryUsages: [],
    },
    {
      name: "AES-GCM",
      resultType: CryptoKey,
      usages: ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
      mandatoryUsages: [],
    },
    { name: "AES-KW", resultType: CryptoKey, usages: ["wrapKey", "unwrapKey"], mandatoryUsages: [] },
    { name: "HMAC", resultType: CryptoKey, usages: ["sign", "verify"], mandatoryUsages: [] },
    { name: "RSASSA-PKCS1-v1_5", resultType: "CryptoKeyPair", usages: ["sign", "verify"], mandatoryUsages: ["sign"] },
    { name: "RSA-PSS", resultType: "CryptoKeyPair", usages: ["sign", "verify"], mandatoryUsages: ["sign"] },
    {
      name: "RSA-OAEP",
      resultType: "CryptoKeyPair",
      usages: ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
      mandatoryUsages: ["decrypt", "unwrapKey"],
    },
    { name: "ECDSA", resultType: "CryptoKeyPair", usages: ["sign", "verify"], mandatoryUsages: ["sign"] },
    {
      name: "ECDH",
      resultType: "CryptoKeyPair",
      usages: ["deriveKey", "deriveBits"],
      mandatoryUsages: ["deriveKey", "deriveBits"],
    },
    { name: "Ed25519", resultType: "CryptoKeyPair", usages: ["sign", "verify"], mandatoryUsages: ["sign"] },
    { name: "Ed448", resultType: "CryptoKeyPair", usages: ["sign", "verify"], mandatoryUsages: ["sign"] },
    {
      name: "X25519",
      resultType: "CryptoKeyPair",
      usages: ["deriveKey", "deriveBits"],
      mandatoryUsages: ["deriveKey", "deriveBits"],
    },
    {
      name: "X448",
      resultType: "CryptoKeyPair",
      usages: ["deriveKey", "deriveBits"],
      mandatoryUsages: ["deriveKey", "deriveBits"],
    },
  ];

  var testVectors: any[] = [];
  if (algorithmNames && !Array.isArray(algorithmNames)) {
    algorithmNames = [algorithmNames];
  }
  allTestVectors.forEach(function (vector) {
    if (!algorithmNames || algorithmNames.includes(vector.name)) {
      testVectors.push(vector);
    }
  });

  function parameterString(algorithm, extractable, usages) {
    if (typeof algorithm !== "object" && typeof algorithm !== "string") {
      alert(algorithm);
    }

    var result =
      "(" + objectToString(algorithm) + ", " + objectToString(extractable) + ", " + objectToString(usages) + ")";

    return result;
  }

  // Test that a given combination of parameters results in an error,
  // AND that it is the correct kind of error.
  //
  // Expected error is either a number, tested against the error code,
  // or a string, tested against the error name.
  function testError(algorithm, extractable, usages, expectedError, testTag) {
    test(testTag + ": generateKey" + parameterString(algorithm, extractable, usages), async function () {
      try {
        await crypto.subtle.generateKey(algorithm, extractable, usages);
        expect("Operation succeeded").toBe("Operation should have failed");
      } catch (err: any) {
        if (typeof expectedError === "number") {
          expect(err.code).toBe(expectedError);
        } else {
          expect(err.name).toBe(expectedError);
        }
      }
    });
  }

  // Given an algorithm name, create several invalid parameters.
  function badAlgorithmPropertySpecifiersFor(algorithmName) {
    var results: any[] = [];

    if (algorithmName.toUpperCase().substring(0, 3) === "AES") {
      // Specifier properties are name and length
      [64, 127, 129, 255, 257, 512].forEach(function (length) {
        results.push({ name: algorithmName, length: length });
      });
    } else if (algorithmName.toUpperCase().substring(0, 3) === "RSA") {
      [new Uint8Array([1]), new Uint8Array([1, 0, 0])].forEach(function (publicExponent) {
        results.push({ name: algorithmName, hash: "SHA-256", modulusLength: 1024, publicExponent: publicExponent });
      });
    } else if (algorithmName.toUpperCase().substring(0, 2) === "EC") {
      ["P-512", "Curve25519"].forEach(function (curveName) {
        results.push({ name: algorithmName, namedCurve: curveName });
      });
    }

    return results;
  }

  // Don't create an exhaustive list of all invalid usages,
  // because there would usually be nearly 2**8 of them,
  // way too many to test. Instead, create every singleton
  // of an illegal usage, and "poison" every valid usage
  // with an illegal one.
  function invalidUsages(validUsages, mandatoryUsages) {
    var results: any = [];

    var illegalUsages: any = [];
    ["encrypt", "decrypt", "sign", "verify", "wrapKey", "unwrapKey", "deriveKey", "deriveBits"].forEach(
      function (usage) {
        if (!validUsages.includes(usage)) {
          illegalUsages.push(usage);
        }
      },
    );

    var goodUsageCombinations = allValidUsages(validUsages, false, mandatoryUsages);

    illegalUsages.forEach(function (illegalUsage) {
      results.push([illegalUsage]);
      goodUsageCombinations.forEach(function (usageCombination) {
        results.push(usageCombination.concat([illegalUsage]));
      });
    });

    return results;
  }

  // Now test for properly handling errors
  // - Unsupported algorithm
  // - Bad usages for algorithm
  // - Bad key lengths

  // Algorithm normalization should fail with "Not supported"
  var badAlgorithmNames = [
    "AES",
    { name: "AES" },
    { name: "AES", length: 128 },
    { name: "AES-CMAC", length: 128 }, // Removed after CR
    { name: "AES-CFB", length: 128 }, // Removed after CR
    { name: "HMAC", hash: "MD5" },
    { name: "RSA", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    { name: "RSA-PSS", hash: "SHA", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    { name: "EC", namedCurve: "P521" },
  ];

  // Algorithm normalization failures should be found first
  // - all other parameters can be good or bad, should fail
  //   due to NotSupportedError.
  badAlgorithmNames.forEach(function (algorithm) {
    allValidUsages(["decrypt", "sign", "deriveBits"], true, []) // Small search space, shouldn't matter because should fail before used
      .forEach(function (usages) {
        [false, true, "RED", 7].forEach(function (extractable) {
          testError(algorithm, extractable, usages, "NotSupportedError", "Bad algorithm");
        });
      });
  });

  // Empty algorithm should fail with TypeError
  allValidUsages(["decrypt", "sign", "deriveBits"], true, []) // Small search space, shouldn't matter because should fail before used
    .forEach(function (usages) {
      [false, true, "RED", 7].forEach(function (extractable) {
        testError({}, extractable, usages, "TypeError", "Empty algorithm");
      });
    });

  // Algorithms normalize okay, but usages bad (though not empty).
  // It shouldn't matter what other extractable is. Should fail
  // due to SyntaxError
  testVectors.forEach(function (vector) {
    var name = vector.name;

    allAlgorithmSpecifiersFor(name).forEach(function (algorithm) {
      invalidUsages(vector.usages, vector.mandatoryUsages).forEach(function (usages) {
        [true].forEach(function (extractable) {
          testError(algorithm, extractable, usages, "SyntaxError", "Bad usages");
        });
      });
    });
  });

  // Other algorithm properties should be checked next, so try good
  // algorithm names and usages, but bad algorithm properties next.
  // - Special case: normally bad usage [] isn't checked until after properties,
  //   so it's included in this test case. It should NOT cause an error.
  testVectors.forEach(function (vector) {
    var name = vector.name;
    badAlgorithmPropertySpecifiersFor(name).forEach(function (algorithm) {
      allValidUsages(vector.usages, true, vector.mandatoryUsages).forEach(function (usages) {
        [false, true].forEach(function (extractable) {
          if (name.substring(0, 2) === "EC") {
            testError(algorithm, extractable, usages, "NotSupportedError", "Bad algorithm property");
          } else {
            testError(algorithm, extractable, usages, "OperationError", "Bad algorithm property");
          }
        });
      });
    });
  });

  // The last thing that should be checked is empty usages (disallowed for secret and private keys).
  testVectors.forEach(function (vector) {
    var name = vector.name;

    allAlgorithmSpecifiersFor(name).forEach(function (algorithm) {
      var usages = [];
      [false, true].forEach(function (extractable) {
        testError(algorithm, extractable, usages, "SyntaxError", "Empty usages");
      });
    });
  });
}

function run_test_success(algorithmNames, slowTest?) {
  var subtle = crypto.subtle; // Change to test prefixed implementations

  // These tests check that generateKey successfully creates keys
  // when provided any of a wide set of correct parameters
  // and that they can be exported afterwards.
  //
  // There are a lot of combinations of possible parameters,
  // resulting in a very large number of tests
  // performed.

  // Setup: define the correct behaviors that should be sought, and create
  // helper functions that generate all possible test parameters for
  // different situations.

  var allTestVectors = [
    // Parameters that should work for generateKey
    {
      name: "AES-CTR",
      resultType: CryptoKey,
      usages: ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
      mandatoryUsages: [],
    },
    {
      name: "AES-CBC",
      resultType: CryptoKey,
      usages: ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
      mandatoryUsages: [],
    },
    {
      name: "AES-GCM",
      resultType: CryptoKey,
      usages: ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
      mandatoryUsages: [],
    },
    { name: "AES-KW", resultType: CryptoKey, usages: ["wrapKey", "unwrapKey"], mandatoryUsages: [] },
    { name: "HMAC", resultType: CryptoKey, usages: ["sign", "verify"], mandatoryUsages: [] },
    { name: "RSASSA-PKCS1-v1_5", resultType: "CryptoKeyPair", usages: ["sign", "verify"], mandatoryUsages: ["sign"] },
    { name: "RSA-PSS", resultType: "CryptoKeyPair", usages: ["sign", "verify"], mandatoryUsages: ["sign"] },
    {
      name: "RSA-OAEP",
      resultType: "CryptoKeyPair",
      usages: ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
      mandatoryUsages: ["decrypt", "unwrapKey"],
    },
    { name: "ECDSA", resultType: "CryptoKeyPair", usages: ["sign", "verify"], mandatoryUsages: ["sign"] },
    {
      name: "ECDH",
      resultType: "CryptoKeyPair",
      usages: ["deriveKey", "deriveBits"],
      mandatoryUsages: ["deriveKey", "deriveBits"],
    },
    { name: "Ed25519", resultType: "CryptoKeyPair", usages: ["sign", "verify"], mandatoryUsages: ["sign"] },
    { name: "Ed448", resultType: "CryptoKeyPair", usages: ["sign", "verify"], mandatoryUsages: ["sign"] },
    {
      name: "X25519",
      resultType: "CryptoKeyPair",
      usages: ["deriveKey", "deriveBits"],
      mandatoryUsages: ["deriveKey", "deriveBits"],
    },
    {
      name: "X448",
      resultType: "CryptoKeyPair",
      usages: ["deriveKey", "deriveBits"],
      mandatoryUsages: ["deriveKey", "deriveBits"],
    },
  ];

  var testVectors: any = [];
  if (algorithmNames && !Array.isArray(algorithmNames)) {
    algorithmNames = [algorithmNames];
  }
  allTestVectors.forEach(function (vector) {
    if (!algorithmNames || algorithmNames.includes(vector.name)) {
      testVectors.push(vector);
    }
  });

  function parameterString(algorithm, extractable, usages) {
    var result =
      "(" + objectToString(algorithm) + ", " + objectToString(extractable) + ", " + objectToString(usages) + ")";

    return result;
  }

  // Is key a CryptoKey object with correct algorithm, extractable, and usages?
  // Is it a secret, private, or public kind of key?
  function assert_goodCryptoKey(key, algorithm, extractable, usages, kind) {
    var correctUsages: string[] = [];

    var registeredAlgorithmName;
    registeredAlgorithmNames.forEach(function (name) {
      if (name.toUpperCase() === algorithm.name.toUpperCase()) {
        registeredAlgorithmName = name;
      }
    });

    expect(key.constructor).toBe(CryptoKey);
    expect(key.type).toBe(kind);
    expect(key.extractable).toBe(extractable);

    expect(key.algorithm.name).toBe(registeredAlgorithmName);
    if (key.algorithm.name.toUpperCase() === "HMAC" && algorithm.length === undefined) {
      switch (key.algorithm.hash.name.toUpperCase()) {
        case "SHA-1":
        case "SHA-256":
          expect(key.algorithm.length).toBe(512);
          break;
        case "SHA-384":
        case "SHA-512":
          expect(key.algorithm.length).toBe(1024);
          break;
        default:
          throw new Error("Unrecognized hash");
      }
    } else {
      expect(key.algorithm.length).toBe(algorithm.length);
    }
    if (["HMAC", "RSASSA-PKCS1-v1_5", "RSA-PSS"].includes(registeredAlgorithmName)) {
      expect(key.algorithm.hash.name.toUpperCase()).toBe(algorithm.hash.toUpperCase());
    }

    if (/^(?:Ed|X)(?:25519|448)$/.test(key.algorithm.name)) {
      expect(key.algorithm).not.toHaveProperty("namedCurve");
    }

    // usages is expected to be provided for a key pair, but we are checking
    // only a single key. The publicKey and privateKey portions of a key pair
    // recognize only some of the usages appropriate for a key pair.
    if (key.type === "public") {
      ["encrypt", "verify", "wrapKey"].forEach(function (usage) {
        if (usages.includes(usage)) {
          correctUsages.push(usage);
        }
      });
    } else if (key.type === "private") {
      ["decrypt", "sign", "unwrapKey", "deriveKey", "deriveBits"].forEach(function (usage) {
        if (usages.includes(usage)) {
          correctUsages.push(usage);
        }
      });
    } else {
      correctUsages = usages;
    }

    expect(typeof key.usages).toBe("object");
    expect(key.usages).not.toBeNull();

    // The usages parameter could have repeats, but the usages
    // property of the result should not.
    var usageCount = 0;
    key.usages.forEach(function (usage) {
      usageCount += 1;
      expect(correctUsages).toContain(usage);
    });
    expect(key.usages.length).toBe(usageCount);
    expect(key[Symbol.toStringTag]).toBe("CryptoKey");
  }

  // Test that a given combination of parameters is successful
  function testSuccess(algorithm, extractable, usages, resultType, testTag) {
    // algorithm, extractable, and usages are the generateKey parameters
    // resultType is the expected result, either the CryptoKey object or "CryptoKeyPair"
    // testTag is a string to prepend to the test name.
    test(testTag + ": generateKey" + parameterString(algorithm, extractable, usages), async function () {
      try {
        const result = await subtle.generateKey(algorithm, extractable, usages);

        if (resultType === "CryptoKeyPair") {
          assert_goodCryptoKey(result.privateKey, algorithm, extractable, usages, "private");
          assert_goodCryptoKey(result.publicKey, algorithm, true, usages, "public");
        } else {
          assert_goodCryptoKey(result, algorithm, extractable, usages, "secret");
        }

        // Test exporting keys
        if (resultType === "CryptoKeyPair") {
          await Promise.all([
            subtle.exportKey("jwk", result.publicKey),
            subtle.exportKey("spki", result.publicKey),
            result.publicKey.algorithm.name.startsWith("RSA") ? undefined : subtle.exportKey("raw", result.publicKey),
            ...(extractable
              ? [subtle.exportKey("jwk", result.privateKey), subtle.exportKey("pkcs8", result.privateKey)]
              : []),
          ]);
        } else {
          if (extractable) {
            // @ts-ignore
            await Promise.all([subtle.exportKey("raw", result), subtle.exportKey("jwk", result)]);
          }
        }
      } catch (err: any) {
        throw new Error(`Test failed: ${err.toString()}`);
      }
    });
  }

  // Test all valid sets of parameters for successful
  // key generation.
  testVectors.forEach(function (vector) {
    allNameVariants(vector.name, slowTest).forEach(function (name) {
      allAlgorithmSpecifiersFor(name).forEach(function (algorithm) {
        allValidUsages(vector.usages, false, vector.mandatoryUsages).forEach(function (usages) {
          [false, true].forEach(function (extractable) {
            testSuccess(algorithm, extractable, usages, vector.resultType, "Success");
          });
        });
      });
    });
  });
}
