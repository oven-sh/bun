// Copyright wpt contributors

// Adopted from the web-platform-test/WebCryptoAPI/generateKey
// https://github.com/web-platform-tests/wpt/tree/6b7cd07ee9a3ad1ce849b36bdb882b723fa172d8/WebCryptoAPI/generateKey

// These tests can be removed once the node-wpt or wpt test runner is fully
// adopted. FYI: https://github.com/oven-sh/bun/issues/19673

import { afterAll, expect, test } from "bun:test";
import {
  allAlgorithmSpecifiersFor,
  allNameVariants,
  allValidUsages,
  objectToString,
  registeredAlgorithmNames,
} from "./webcryptoTestHelpers";

const subtle = crypto.subtle;

// Parameters that should work for generateKey. Shared by the success and the
// failure tests.
const allTestVectors = [
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

function testVectorsFor(algorithmNames: string[]) {
  return allTestVectors.filter(vector => algorithmNames.includes(vector.name));
}

// Create a string representation of keyGeneration parameters for
// test names and labels.
function parameterString(algorithm, extractable, usages) {
  return "(" + objectToString(algorithm) + ", " + objectToString(extractable) + ", " + objectToString(usages) + ")";
}

// A structured-clone friendly snapshot of every CryptoKey property the
// assertions below look at, captured in the realm that called generateKey.
// It must not reference anything from module scope because its source is also
// injected into the RSA keygen worker.
function cryptoKeyToView(key: any) {
  return {
    isCryptoKey: key.constructor === CryptoKey,
    toStringTag: key[Symbol.toStringTag],
    type: key.type,
    extractable: key.extractable,
    typeofUsages: typeof key.usages,
    usages: key.usages === null || key.usages === undefined ? key.usages : Array.from(key.usages),
    algorithm: {
      name: key.algorithm.name,
      length: key.algorithm.length,
      hash: key.algorithm.hash === undefined ? undefined : { name: key.algorithm.hash.name },
      modulusLength: key.algorithm.modulusLength,
      publicExponent: key.algorithm.publicExponent === undefined ? undefined : Array.from(key.algorithm.publicExponent),
      namedCurve: key.algorithm.namedCurve,
      hasNamedCurve: "namedCurve" in key.algorithm,
    },
  };
}

type CryptoKeyView = ReturnType<typeof cryptoKeyToView>;

// ---------------------------------------------------------------------------
// RSA keygen worker pool
//
// generateKey runs the key generation synchronously on the calling JS thread,
// and 2048-bit RSA keygen dominates this file's runtime (~16s of ~22s in a
// release build when run serially). The RSA success vectors therefore issue
// their generateKey calls from a small pool of workers so the keygens run on
// several OS threads, while every assertion still happens in this file:
// workers send back a property snapshot taken in the generating realm plus the
// structured-cloned keys for the export checks. Every vector still performs
// its own generateKey call with its exact parameters; nothing is shared or
// cached between vectors.
//
// Vectors are handed to workers a couple at a time from a shared queue, and a
// test that is about to await a still-queued vector moves it to the front of
// the queue. That bounds any single test's wait at a few keygens no matter
// the execution order (-t filters, --randomize), while a full in-order run
// keeps every worker saturated.
// ---------------------------------------------------------------------------

function rsaKeygenWorkerMain() {
  globalThis.onmessage = async (event: MessageEvent) => {
    const { index, algorithm, extractable, usages } = event.data;
    try {
      const pair = (await crypto.subtle.generateKey(algorithm, extractable, usages)) as CryptoKeyPair;
      postMessage({
        index,
        privateKey: pair.privateKey,
        publicKey: pair.publicKey,
        privateSnapshot: cryptoKeyToView(pair.privateKey),
        publicSnapshot: cryptoKeyToView(pair.publicKey),
      });
    } catch (error) {
      postMessage({ index, error: String(error) });
    }
  };
}

interface RsaKeygenResult {
  index: number;
  error?: string;
  privateKey?: CryptoKey;
  publicKey?: CryptoKey;
  privateSnapshot?: CryptoKeyView;
  publicSnapshot?: CryptoKeyView;
}

const rsaVectors: { algorithm: any; extractable: boolean; usages: string[] }[] = [];
const rsaResults: PromiseWithResolvers<RsaKeygenResult>[] = [];
const rsaWorkers: Worker[] = [];
// Indices of vectors not yet handed to a worker, in dispatch order.
const rsaPendingQueue: number[] = [];
let rsaLiveWorkers = 0;
let rsaWorkerUrl: string | undefined;

function enqueueRsaVector(algorithm, extractable, usages): number {
  rsaVectors.push({ algorithm, extractable, usages });
  rsaResults.push(Promise.withResolvers());
  return rsaVectors.length - 1;
}

// Started lazily by the first RSA test that actually runs, so runs whose
// filter matches no RSA success test never spawn workers.
function ensureRsaWorkersStarted() {
  if (rsaWorkers.length > 0 || rsaVectors.length === 0) return;

  for (let i = 0; i < rsaVectors.length; i++) rsaPendingQueue.push(i);

  const workerCount = Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1), rsaVectors.length);
  rsaLiveWorkers = workerCount;
  const source = `const cryptoKeyToView = ${cryptoKeyToView};\n(${rsaKeygenWorkerMain})();`;
  rsaWorkerUrl = URL.createObjectURL(new Blob([source], { type: "application/javascript" }));

  for (let w = 0; w < workerCount; w++) {
    const worker = new Worker(rsaWorkerUrl);
    const inFlight = new Set<number>();
    const dispatchNext = () => {
      const index = rsaPendingQueue.shift();
      if (index !== undefined) {
        inFlight.add(index);
        worker.postMessage({ index, ...rsaVectors[index] });
      }
    };
    worker.onmessage = event => {
      inFlight.delete(event.data.index);
      rsaResults[event.data.index].resolve(event.data);
      dispatchNext();
    };
    // A crashed worker fails its in-flight vectors loudly; once no worker is
    // left, the still-queued vectors fail too instead of letting their tests
    // hang until the timeout.
    worker.onerror = event => {
      worker.terminate();
      rsaLiveWorkers -= 1;
      for (const index of inFlight) {
        rsaResults[index].resolve({ index, error: `keygen worker error: ${event.message}` });
      }
      inFlight.clear();
      if (rsaLiveWorkers === 0) {
        for (const index of rsaPendingQueue) {
          rsaResults[index].resolve({ index, error: `keygen worker error: ${event.message}` });
        }
        rsaPendingQueue.length = 0;
      }
    };
    // Two vectors in flight per worker: the worker can start the next keygen
    // from its own message queue without waiting for this thread to process
    // the previous result.
    dispatchNext();
    dispatchNext();
    rsaWorkers.push(worker);
  }
}

// A test that is about to await this vector moves it to the front of the
// pending queue, so the next free worker picks it up regardless of where the
// vector sits in registration order.
function prioritizeRsaVector(index: number) {
  const pos = rsaPendingQueue.indexOf(index);
  if (pos > 0) {
    rsaPendingQueue.splice(pos, 1);
    rsaPendingQueue.unshift(index);
  }
}

afterAll(() => {
  for (const worker of rsaWorkers) worker.terminate();
  if (rsaWorkerUrl !== undefined) URL.revokeObjectURL(rsaWorkerUrl);
});

// ---------------------------------------------------------------------------
// Success tests
// ---------------------------------------------------------------------------

// Is key a CryptoKey object with correct algorithm, extractable, and usages?
// Is it a secret, private, or public kind of key?
// Operates on a CryptoKeyView so the same assertions apply to keys generated
// on this thread and to keys generated in the RSA workers.
function assert_goodCryptoKey(key: CryptoKeyView, algorithm, extractable, usages, kind) {
  let registeredAlgorithmName: string = "";
  registeredAlgorithmNames.forEach(name => {
    if (name.toUpperCase() === algorithm.name.toUpperCase()) {
      registeredAlgorithmName = name;
    }
  });

  expect(key.isCryptoKey).toBe(true);
  expect(key.toStringTag).toBe("CryptoKey");
  expect(key.type).toBe(kind);
  expect(key.extractable).toBe(extractable);

  expect(key.algorithm.name).toBe(registeredAlgorithmName);
  if (key.algorithm.name.toUpperCase() === "HMAC" && algorithm.length === undefined) {
    switch (key.algorithm.hash!.name.toUpperCase()) {
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
  if (["HMAC", "RSASSA-PKCS1-v1_5", "RSA-PSS", "RSA-OAEP"].includes(registeredAlgorithmName)) {
    expect(key.algorithm.hash!.name.toUpperCase()).toBe(algorithm.hash.toUpperCase());
  }
  if (registeredAlgorithmName.startsWith("RSA")) {
    expect(key.algorithm.modulusLength).toBe(algorithm.modulusLength);
    expect(key.algorithm.publicExponent).toEqual(Array.from(algorithm.publicExponent));
  }
  if (registeredAlgorithmName === "ECDSA" || registeredAlgorithmName === "ECDH") {
    expect(key.algorithm.namedCurve).toBe(algorithm.namedCurve);
  }
  if (/^(?:Ed|X)(?:25519|448)$/.test(key.algorithm.name)) {
    expect(key.algorithm.hasNamedCurve).toBe(false);
  }

  // usages is expected to be provided for a key pair, but we are checking
  // only a single key. The publicKey and privateKey portions of a key pair
  // recognize only some of the usages appropriate for a key pair.
  let correctUsages: string[] = [];
  if (key.type === "public") {
    ["encrypt", "verify", "wrapKey"].forEach(usage => {
      if (usages.includes(usage)) correctUsages.push(usage);
    });
  } else if (key.type === "private") {
    ["decrypt", "sign", "unwrapKey", "deriveKey", "deriveBits"].forEach(usage => {
      if (usages.includes(usage)) correctUsages.push(usage);
    });
  } else {
    correctUsages = usages;
  }

  expect(key.typeofUsages).toBe("object");
  expect(key.usages).not.toBeNull();

  // The usages parameter could have repeats, but the usages
  // property of the result should not.
  let usageCount = 0;
  key.usages!.forEach(usage => {
    usageCount += 1;
    expect(correctUsages).toContain(usage);
  });
  expect(key.usages!.length).toBe(usageCount);
}

// Test that a given combination of parameters is successful, generating the
// key (pair) on this thread.
function testSuccess(algorithm, extractable, usages, resultType) {
  test("Success: generateKey" + parameterString(algorithm, extractable, usages), async () => {
    const result: any = await subtle.generateKey(algorithm, extractable, usages);

    if (resultType === "CryptoKeyPair") {
      assert_goodCryptoKey(cryptoKeyToView(result.privateKey), algorithm, extractable, usages, "private");
      assert_goodCryptoKey(cryptoKeyToView(result.publicKey), algorithm, true, usages, "public");

      // Test exporting keys
      await Promise.all([
        subtle.exportKey("jwk", result.publicKey),
        subtle.exportKey("spki", result.publicKey),
        subtle.exportKey("raw", result.publicKey),
        ...(extractable
          ? [subtle.exportKey("jwk", result.privateKey), subtle.exportKey("pkcs8", result.privateKey)]
          : []),
      ]);
    } else {
      assert_goodCryptoKey(cryptoKeyToView(result), algorithm, extractable, usages, "secret");

      // Test exporting keys
      if (extractable) {
        await Promise.all([subtle.exportKey("raw", result), subtle.exportKey("jwk", result)]);
      }
    }
  });
}

// Same as testSuccess, but the generateKey call happens in the worker pool
// ("raw" export does not apply to RSA keys).
function testRsaSuccess(algorithm, extractable, usages) {
  const index = enqueueRsaVector(algorithm, extractable, usages);
  test("Success: generateKey" + parameterString(algorithm, extractable, usages), async () => {
    ensureRsaWorkersStarted();
    prioritizeRsaVector(index);
    const result = await rsaResults[index].promise;
    if (result.error !== undefined) {
      throw new Error(`generateKey${parameterString(algorithm, extractable, usages)} failed: ${result.error}`);
    }

    assert_goodCryptoKey(result.privateSnapshot!, algorithm, extractable, usages, "private");
    assert_goodCryptoKey(result.publicSnapshot!, algorithm, true, usages, "public");

    // Test exporting keys (on the structured clones of the generated keys).
    await Promise.all([
      subtle.exportKey("jwk", result.publicKey!),
      subtle.exportKey("spki", result.publicKey!),
      ...(extractable
        ? [subtle.exportKey("jwk", result.privateKey!), subtle.exportKey("pkcs8", result.privateKey!)]
        : []),
    ]);
  });
}

// These tests check that generateKey successfully creates keys
// when provided any of a wide set of correct parameters
// and that they can be exported afterwards.
//
// There are a lot of combinations of possible parameters,
// resulting in a very large number of tests
// performed.
function run_test_success(algorithmNames: string[]) {
  testVectorsFor(algorithmNames).forEach(vector => {
    allNameVariants(vector.name, false).forEach(name => {
      allAlgorithmSpecifiersFor(name).forEach(algorithm => {
        allValidUsages(vector.usages, false, vector.mandatoryUsages).forEach(usages => {
          [false, true].forEach(extractable => {
            if (vector.name.startsWith("RSA")) {
              testRsaSuccess(algorithm, extractable, usages);
            } else {
              testSuccess(algorithm, extractable, usages, vector.resultType);
            }
          });
        });
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Failure tests
// ---------------------------------------------------------------------------

// These tests check that generateKey throws an error, and that
// the error is of the right type, for a wide set of incorrect parameters.
//
// Error testing occurs by setting the parameter that should trigger the
// error to an invalid value, then combining that with all valid
// parameters that should be checked earlier by generateKey, and all
// valid and invalid parameters that should be checked later by
// generateKey.

// Test that a given combination of parameters results in an error,
// AND that it is the correct kind of error.
//
// Expected error is either a number, tested against the error code,
// or a string, tested against the error name.
function testError(algorithm, extractable, usages, expectedError, testTag) {
  test(testTag + ": generateKey" + parameterString(algorithm, extractable, usages), async () => {
    try {
      await subtle.generateKey(algorithm, extractable, usages);
    } catch (err: any) {
      if (typeof expectedError === "number") {
        expect(err).toHaveProperty("code", expectedError);
      } else {
        // SyntaxError is not checked against DOMException: Bun currently
        // rejects with a plain SyntaxError where the spec (and Node.js) use a
        // DOMException named SyntaxError.
        if (expectedError === "TypeError") {
          expect(err).toBeInstanceOf(TypeError);
        } else if (expectedError === "NotSupportedError" || expectedError === "OperationError") {
          expect(err).toBeInstanceOf(DOMException);
        }
        expect(err.name).toBe(expectedError);
      }
      return;
    }
    throw new Error(`generateKey resolved but should have rejected with ${expectedError}`);
  });
}

// Given an algorithm name, create several invalid parameters.
function badAlgorithmPropertySpecifiersFor(algorithmName) {
  const results: any[] = [];

  if (algorithmName.toUpperCase().substring(0, 3) === "AES") {
    // Specifier properties are name and length
    [64, 127, 129, 255, 257, 512].forEach(length => {
      results.push({ name: algorithmName, length: length });
    });
  } else if (algorithmName.toUpperCase().substring(0, 3) === "RSA") {
    [new Uint8Array([1]), new Uint8Array([1, 0, 0])].forEach(publicExponent => {
      results.push({ name: algorithmName, hash: "SHA-256", modulusLength: 1024, publicExponent: publicExponent });
    });
  } else if (algorithmName.toUpperCase().substring(0, 2) === "EC") {
    ["P-512", "Curve25519"].forEach(curveName => {
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
  const results: any[] = [];

  const illegalUsages: string[] = [];
  ["encrypt", "decrypt", "sign", "verify", "wrapKey", "unwrapKey", "deriveKey", "deriveBits"].forEach(usage => {
    if (!validUsages.includes(usage)) {
      illegalUsages.push(usage);
    }
  });

  const goodUsageCombinations = allValidUsages(validUsages, false, mandatoryUsages);

  illegalUsages.forEach(illegalUsage => {
    results.push([illegalUsage]);
    goodUsageCombinations.forEach(usageCombination => {
      results.push(usageCombination.concat([illegalUsage]));
    });
  });

  return results;
}

// Tests for properly handling errors that depend on the algorithm:
// - Bad usages for algorithm
// - Bad key lengths
// - Empty usages
function run_test_failure(algorithmNames: string[]) {
  const testVectors = testVectorsFor(algorithmNames);

  // Algorithms normalize okay, but usages bad (though not empty).
  // It shouldn't matter what other extractable is. Should fail
  // due to SyntaxError
  testVectors.forEach(vector => {
    allAlgorithmSpecifiersFor(vector.name).forEach(algorithm => {
      invalidUsages(vector.usages, vector.mandatoryUsages).forEach(usages => {
        [true].forEach(extractable => {
          testError(algorithm, extractable, usages, "SyntaxError", "Bad usages");
        });
      });
    });
  });

  // Other algorithm properties should be checked next, so try good
  // algorithm names and usages, but bad algorithm properties next.
  // - Special case: normally bad usage [] isn't checked until after properties,
  //   so it's included in this test case. It should NOT cause an error.
  testVectors.forEach(vector => {
    badAlgorithmPropertySpecifiersFor(vector.name).forEach(algorithm => {
      allValidUsages(vector.usages, true, vector.mandatoryUsages).forEach(usages => {
        [false, true].forEach(extractable => {
          if (vector.name.substring(0, 2) === "EC") {
            testError(algorithm, extractable, usages, "NotSupportedError", "Bad algorithm property");
          } else {
            testError(algorithm, extractable, usages, "OperationError", "Bad algorithm property");
          }
        });
      });
    });
  });

  // The last thing that should be checked is empty usages (disallowed for secret and private keys).
  testVectors.forEach(vector => {
    allAlgorithmSpecifiersFor(vector.name).forEach(algorithm => {
      [false, true].forEach(extractable => {
        testError(algorithm, extractable, [], "SyntaxError", "Empty usages");
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Test registration
// ---------------------------------------------------------------------------

registeredAlgorithmNames.forEach(name => {
  run_test_success([name]);
  run_test_failure([name]);
});

// Failures that are independent of any registered algorithm. The upstream wpt
// suite repeats these in every per-algorithm file; registering them once here
// covers the same vectors without re-registering them for every registered
// algorithm name (previously 18 identical copies of each test).

// Algorithm normalization should fail with "Not supported"
const badAlgorithmNames = [
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
badAlgorithmNames.forEach(algorithm => {
  allValidUsages(["decrypt", "sign", "deriveBits"], true, []) // Small search space, shouldn't matter because should fail before used
    .forEach(usages => {
      [false, true, "RED", 7].forEach(extractable => {
        testError(algorithm, extractable, usages, "NotSupportedError", "Bad algorithm");
      });
    });
});

// Empty algorithm should fail with TypeError
allValidUsages(["decrypt", "sign", "deriveBits"], true, []) // Small search space, shouldn't matter because should fail before used
  .forEach(usages => {
    [false, true, "RED", 7].forEach(extractable => {
      testError({}, extractable, usages, "TypeError", "Empty algorithm");
    });
  });
