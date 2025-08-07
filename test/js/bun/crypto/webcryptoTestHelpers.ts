// Copyright wpt contributors
// Adopted from the web-platform-test/WebCryptoAPI/generateKey
// https://github.com/web-platform-tests/wpt/tree/6b7cd07ee9a3ad1ce849b36bdb882b723fa172d8/WebCryptoAPI/generateKey

// TODO: The following tests should be removed once the node-wpt
//  or wpt test runner is fully adopted.
// FYI: https://github.com/oven-sh/bun/issues/19673

// helpers.js
//
// Helper functions used by several WebCryptoAPI tests
//

export var registeredAlgorithmNames = [
  "RSASSA-PKCS1-v1_5",
  "RSA-PSS",
  "RSA-OAEP",
  "ECDSA",
  "ECDH",
  "AES-CTR",
  "AES-CBC",
  "AES-GCM",
  "AES-KW",
  "HMAC",
  "SHA-1",
  "SHA-256",
  "SHA-384",
  "SHA-512",
  "HKDF",
  "PBKDF2",
  "Ed25519",
  // "Ed448", TODO: Operation is not supported
  "X25519",
  // "X448", TODO: Operation is not supported
];

// Treats an array as a set, and generates an array of all non-empty
// subsets (which are themselves arrays).
//
// The order of members of the "subsets" is not guaranteed.
export function allNonemptySubsetsOf(arr) {
  var results: any[] = [];
  var firstElement;
  var remainingElements;

  for (var i = 0; i < arr.length; i++) {
    firstElement = arr[i];
    remainingElements = arr.slice(i + 1);
    results.push([firstElement]);

    if (remainingElements.length > 0) {
      allNonemptySubsetsOf(remainingElements).forEach(function (combination) {
        combination.push(firstElement);
        results.push(combination);
      });
    }
  }

  return results;
}

// Create a string representation of keyGeneration parameters for
// test names and labels.
export function objectToString(obj): string {
  var keyValuePairs: string[] = [];

  if (Array.isArray(obj)) {
    return (
      "[" +
      obj
        .map(function (elem) {
          return objectToString(elem);
        })
        .join(", ") +
      "]"
    );
  } else if (typeof obj === "object") {
    Object.keys(obj)
      .sort()
      .forEach(function (keyName: string) {
        keyValuePairs.push(keyName + ": " + objectToString(obj[keyName]));
      });
    return "{" + keyValuePairs.join(", ") + "}";
  } else if (typeof obj === "undefined") {
    return "undefined";
  } else {
    return obj.toString();
  }
}

export function unique(names) {
  return [...new Set(names)];
}

// Algorithm name specifiers are case-insensitive. Generate several
// case variations of a given name.
export function allNameVariants(name, slowTest) {
  var upCaseName = name.toUpperCase();
  var lowCaseName = name.toLowerCase();
  var mixedCaseName = upCaseName.substring(0, 1) + lowCaseName.substring(1);

  // for slow tests effectively cut the amount of work in third by only
  // returning one variation
  if (slowTest) return [mixedCaseName];
  return unique([upCaseName, lowCaseName, mixedCaseName]);
}

// The algorithm parameter is an object with a name and other
// properties. Given the name, generate all valid parameters.
export function allAlgorithmSpecifiersFor(algorithmName) {
  var results: any[] = [];

  // RSA key generation is slow. Test a minimal set of parameters
  var hashes = ["SHA-1", "SHA-256"];

  // EC key generation is a lot faster. Check all curves in the spec
  var curves = ["P-256", "P-384", "P-521"];

  if (algorithmName.toUpperCase().substring(0, 3) === "AES") {
    // Specifier properties are name and length
    [128, 192, 256].forEach(function (length) {
      results.push({ name: algorithmName, length: length });
    });
  } else if (algorithmName.toUpperCase() === "HMAC") {
    [
      { hash: "SHA-1", length: 160 },
      { hash: "SHA-256", length: 256 },
      { hash: "SHA-384", length: 384 },
      { hash: "SHA-512", length: 512 },
      { hash: "SHA-1" },
      { hash: "SHA-256" },
      { hash: "SHA-384" },
      { hash: "SHA-512" },
    ].forEach(function (hashAlgorithm) {
      results.push({ name: algorithmName, ...hashAlgorithm });
    });
  } else if (algorithmName.toUpperCase().substring(0, 3) === "RSA") {
    hashes.forEach(function (hashName) {
      results.push({
        name: algorithmName,
        hash: hashName,
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
      });
    });
  } else if (algorithmName.toUpperCase().substring(0, 2) === "EC") {
    curves.forEach(function (curveName) {
      results.push({ name: algorithmName, namedCurve: curveName });
    });
  } else if (
    algorithmName.toUpperCase().substring(0, 1) === "X" ||
    algorithmName.toUpperCase().substring(0, 2) === "ED"
  ) {
    results.push({ name: algorithmName });
  }

  return results;
}

// Create every possible valid usages parameter, given legal
// usages. Note that an empty usages parameter is not always valid.
//
// There is an optional parameter - mandatoryUsages. If provided,
// it should be an array containing those usages of which one must be
// included.
export function allValidUsages(validUsages, emptyIsValid, mandatoryUsages: any[]) {
  if (typeof mandatoryUsages === "undefined") {
    mandatoryUsages = [];
  }

  var okaySubsets: any[] = [];
  allNonemptySubsetsOf(validUsages).forEach(function (subset) {
    if (mandatoryUsages.length === 0) {
      okaySubsets.push(subset);
    } else {
      for (var i = 0; i < mandatoryUsages.length; i++) {
        if (subset.includes(mandatoryUsages[i])) {
          okaySubsets.push(subset);
          return;
        }
      }
    }
  });

  if (emptyIsValid && validUsages.length !== 0) {
    okaySubsets.push([]);
  }

  okaySubsets.push(validUsages.concat(mandatoryUsages).concat(validUsages)); // Repeated values are allowed
  return okaySubsets;
}
