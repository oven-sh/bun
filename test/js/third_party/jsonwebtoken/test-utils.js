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
  let error;
  let syncVerified;
  try {
    syncVerified = jwt.verify(jwtString, secretOrPrivateKey, options);
  } catch (err) {
    error = err;
  }
  jwt.verify(jwtString, secretOrPrivateKey, options, (err, asyncVerifiedToken) => {
    if (error) {
      callback(err);
    } else {
      expect(syncVerified).toStrictEqual(asyncVerifiedToken);
      callback(null, syncVerified);
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
  let error;
  let syncSigned;
  try {
    syncSigned = jwt.sign(payload, secretOrPrivateKey, options);
  } catch (err) {
    error = err;
  }
  jwt.sign(payload, secretOrPrivateKey, options, (err, asyncSigned) => {
    if (error) {
      callback(err);
    } else {
      expect(syncSigned).toEqual(asyncSigned);
      callback(null, syncSigned);
    }
  });
}

export { asyncCheck, base64UrlEncode, signJWTHelper, verifyJWTHelper };

export default {
  asyncCheck,
  base64UrlEncode,
  signJWTHelper,
  verifyJWTHelper,
};
