"use strict";

import jwt from "jsonwebtoken";
function expect(value) {
  return {
    toEqual: expected => {
      if (typeof value === "object") {
        if (typeof expected === "object") {
          for (const propertyName in expected) {
            expect(value[propertyName]).toEqual(expected[propertyName]);
          }
          return;
        }
        throw new Error(`Expected ${value} to strictly equal ${expected}`);
      }
      if (value !== expected) {
        throw new Error(`Expected ${value} to equal ${expected}`);
      }
    },
    toStrictEqual: expected => {
      if (typeof value === "object") {
        if (typeof expected === "object") {
          for (const propertyName in expected) {
            expect(value[propertyName]).toStrictEqual(expected[propertyName]);
          }
          return;
        }
        throw new Error(`Expected ${value} to strictly equal ${expected}`);
      }
      if (value !== expected) {
        throw new Error(`Expected ${value} to strictly equal ${expected}`);
      }
    },
  };
}

function expectError(actual, expected) {
  if (!actual && !expected) {
    return;
  }
  if (actual && !expected) {
    throw new Error(`Expected no error, but got ${actual}`);
  }
  if (!actual && expected) {
    throw new Error(`Expected error ${expected}, but got no error`);
  }
  if (actual.message !== expected.message) {
    throw new Error(`Expected ${actual.message} to equal ${expected.message}`);
  }
  if (actual.name !== expected.name) {
    throw new Error(`Expected ${actual.name} to equal ${expected.name}`);
  }
  if (actual.code !== expected.code) {
    throw new Error(`Expected ${actual.code} to equal ${expected.code}`);
  }
}

/**
 * Correctly report errors that occur in an asynchronous callback
 * @param {function(err): void} done The mocha callback
 * @param {function(): void} testFunction The assertions function
 */
function asyncCheck(done, testFunction) {
  try {
    testFunction();
    done();
  } catch (err) {
    done(err);
  }
}

/**
 * Base64-url encode a string
 * @param str {string} The string to encode
 * @returns {string} The encoded string
 */
function base64UrlEncode(str) {
  return Buffer.from(str).toString("base64").replace(/[=]/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * Verify a JWT, ensuring that the asynchronous and synchronous calls to `verify` have the same result
 * @param {string} jwtString The JWT as a string
 * @param {string} secretOrPrivateKey The shared secret or private key
 * @param {object} options Verify options
 * @param {function(err, token):void} callback
 */
function verifyJWTHelper(jwtString, secretOrPrivateKey, options, callback) {
  jwt.verify(jwtString, secretOrPrivateKey, options, (err, asyncVerifiedToken) => {
    let error;
    let syncVerified;
    try {
      syncVerified = jwt.verify(jwtString, secretOrPrivateKey, options);
    } catch (err) {
      error = err;
    }
    try {
      expectError(error, err);
      if (error) {
        callback(err);
      } else {
        expect(syncVerified).toStrictEqual(asyncVerifiedToken);
        callback(null, syncVerified);
      }
    } catch (err) {
      callback(err);
    }
  });
}

/**
 * Sign a payload to create a JWT, ensuring that the asynchronous and synchronous calls to `sign` have the same result
 * @param {object} payload The JWT payload
 * @param {string} secretOrPrivateKey The shared secret or private key
 * @param {object} options Sign options
 * @param {function(err, token):void} callback
 */
function signJWTHelper(payload, secretOrPrivateKey, options, callback) {
  // make sure they are created with the same timestamp
  // https://github.com/auth0/node-jsonwebtoken/blob/bc28861f1fa981ed9c009e29c044a19760a0b128/sign.js#L185
  const timestamp = Math.floor(Date.now() / 1000);
  if (typeof payload === "object" && !Buffer.isBuffer(payload) && !payload.iat) {
    payload = { ...payload, iat: timestamp };
  }
  jwt.sign(payload, secretOrPrivateKey, options, (err, asyncSigned) => {
    let error;
    let syncSigned;
    try {
      syncSigned = jwt.sign(payload, secretOrPrivateKey, options);
    } catch (err) {
      error = err;
    }
    try {
      expectError(error, err);
      if (error) {
        callback(err);
      } else {
        expect(syncSigned).toEqual(asyncSigned);
        callback(null, syncSigned);
      }
    } catch (err) {
      callback(err);
    }
  });
}

// Same as above but won't automatically set the iat field. When we implement fake timers,
// we can delete this function and use the one above with a fake timer.
function signJWTHelperWithoutAddingTimestamp(payload, secretOrPrivateKey, options, callback) {
  jwt.sign(payload, secretOrPrivateKey, options, (err, asyncSigned) => {
    let error;
    let syncSigned;
    try {
      syncSigned = jwt.sign(payload, secretOrPrivateKey, options);
    } catch (err) {
      error = err;
    }
    try {
      expectError(error, err);
      if (error) {
        callback(err);
      } else {
        expect(syncSigned).toEqual(asyncSigned);
        callback(null, syncSigned);
      }
    } catch (err) {
      callback(err);
    }
  });
}

export { asyncCheck, base64UrlEncode, signJWTHelper, verifyJWTHelper };

export default {
  asyncCheck,
  base64UrlEncode,
  signJWTHelper,
  signJWTHelperWithoutAddingTimestamp,
  verifyJWTHelper,
};
