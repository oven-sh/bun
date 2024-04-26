"use strict";

import jwt from "jsonwebtoken";
import { expect, describe, it, beforeEach, afterEach } from "bun:test";
import util from "util";
import testUtils from "./test-utils";
import jws from "jws";
import sinon from "sinon";

function signWithIssueAt(issueAt, options, callback) {
  const payload = {};
  if (issueAt !== undefined) {
    payload.iat = issueAt;
  }
  const opts = Object.assign({ algorithm: "HS256" }, options);
  // async calls require a truthy secret
  // see: https://github.com/brianloveswords/node-jws/issues/62
  testUtils.signJWTHelperWithoutAddingTimestamp(payload, "secret", opts, callback);
}

function verifyWithIssueAt(token, maxAge, options, secret, callback) {
  const opts = Object.assign({ maxAge }, options);
  testUtils.verifyJWTHelper(token, secret, opts, callback);
}

describe("issue at", function () {
  describe('`jwt.sign` "iat" claim validation', function () {
    [true, false, null, "", "invalid", [], ["foo"], {}, { foo: "bar" }].forEach(iat => {
      it(`should error with iat of ${util.inspect(iat)}`, function (done) {
        signWithIssueAt(iat, {}, err => {
          testUtils.asyncCheck(done, () => {
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toEqual('"iat" should be a number of seconds');
          });
        });
      });
    });

    // undefined needs special treatment because {} is not the same as {iat: undefined}
    it("should error with iat of undefined", function (done) {
      testUtils.signJWTHelperWithoutAddingTimestamp({ iat: undefined }, "secret", { algorithm: "HS256" }, err => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeInstanceOf(Error);
          expect(err.message).toEqual('"iat" should be a number of seconds');
        });
      });
    });
  });

  describe('"iat" in payload with "maxAge" option validation', function () {
    [true, false, null, undefined, -Infinity, Infinity, NaN, "", "invalid", [], ["foo"], {}, { foo: "bar" }].forEach(
      iat => {
        it(`should error with iat of ${util.inspect(iat)}`, function (done) {
          const header = { alg: "HS256" };
          const payload = { iat };
          const token = jws.sign({ header, payload, secret: "secret", encoding: "utf8" });
          verifyWithIssueAt(token, "1 min", {}, "secret", err => {
            testUtils.asyncCheck(done, () => {
              expect(err).toBeInstanceOf(jwt.JsonWebTokenError);
              expect(err.message).toEqual("iat required when maxAge is specified");
            });
          });
        });
      },
    );
  });

  describe("when signing a token", function () {
    let fakeClock;
    beforeEach(function () {
      fakeClock = sinon.useFakeTimers({ now: 60000 });
    });

    afterEach(function () {
      fakeClock.uninstall();
    });

    [
      {
        description: 'should default to current time for "iat"',
        iat: undefined,
        expectedIssueAt: 60,
        options: {},
      },
      {
        description: 'should sign with provided time for "iat"',
        iat: 100,
        expectedIssueAt: 100,
        options: {},
      },
      // TODO an iat of -Infinity should fail validation
      {
        description: 'should set null "iat" when given -Infinity',
        iat: -Infinity,
        expectedIssueAt: null,
        options: {},
      },
      // TODO an iat of Infinity should fail validation
      {
        description: 'should set null "iat" when given Infinity',
        iat: Infinity,
        expectedIssueAt: null,
        options: {},
      },
      // TODO an iat of NaN should fail validation
      {
        description: 'should set to current time for "iat" when given value NaN',
        iat: NaN,
        expectedIssueAt: 60,
        options: {},
      },
      {
        description: 'should remove default "iat" with "noTimestamp" option',
        iat: undefined,
        expectedIssueAt: undefined,
        options: { noTimestamp: true },
      },
      {
        description: 'should remove provided "iat" with "noTimestamp" option',
        iat: 10,
        expectedIssueAt: undefined,
        options: { noTimestamp: true },
      },
    ].forEach(testCase => {
      it(testCase.description, function (done) {
        signWithIssueAt(testCase.iat, testCase.options, (err, token) => {
          testUtils.asyncCheck(done, () => {
            expect(err).toBeNull();
            expect(jwt.decode(token).iat).toEqual(testCase.expectedIssueAt);
          });
        });
      });
    });
  });

  describe("when verifying a token", function () {
    let fakeClock;

    beforeEach(function () {
      fakeClock = sinon.useFakeTimers({ now: 60000 });
    });

    afterEach(function () {
      fakeClock.uninstall();
    });

    [
      {
        description: 'should verify using "iat" before the "maxAge"',
        clockAdvance: 10000,
        maxAge: 11,
        options: {},
      },
      {
        description: 'should verify using "iat" before the "maxAge" with a provided "clockTimestamp',
        clockAdvance: 60000,
        maxAge: 11,
        options: { clockTimestamp: 70 },
      },
      {
        description: 'should verify using "iat" after the "maxAge" but within "clockTolerance"',
        clockAdvance: 10000,
        maxAge: 9,
        options: { clockTimestamp: 2 },
      },
    ].forEach(testCase => {
      it(testCase.description, function (done) {
        const token = jwt.sign({}, "secret", { algorithm: "HS256" });
        fakeClock.tick(testCase.clockAdvance);
        verifyWithIssueAt(token, testCase.maxAge, testCase.options, "secret", (err, token) => {
          testUtils.asyncCheck(done, () => {
            expect(err).toBeNull();
            expect(typeof token).toBe("object");
          });
        });
      });
    });

    [
      {
        description: 'should throw using "iat" equal to the "maxAge"',
        clockAdvance: 10000,
        maxAge: 10,
        options: {},
        expectedError: "maxAge exceeded",
        expectedExpiresAt: 70000,
      },
      {
        description: 'should throw using "iat" after the "maxAge"',
        clockAdvance: 10000,
        maxAge: 9,
        options: {},
        expectedError: "maxAge exceeded",
        expectedExpiresAt: 69000,
      },
      {
        description: 'should throw using "iat" after the "maxAge" with a provided "clockTimestamp',
        clockAdvance: 60000,
        maxAge: 10,
        options: { clockTimestamp: 70 },
        expectedError: "maxAge exceeded",
        expectedExpiresAt: 70000,
      },
      {
        description: 'should throw using "iat" after the "maxAge" and "clockTolerance',
        clockAdvance: 10000,
        maxAge: 8,
        options: { clockTolerance: 2 },
        expectedError: "maxAge exceeded",
        expectedExpiresAt: 68000,
      },
    ].forEach(testCase => {
      it(testCase.description, function (done) {
        const expectedExpiresAtDate = new Date(testCase.expectedExpiresAt);
        const token = jwt.sign({}, "secret", { algorithm: "HS256" });
        fakeClock.tick(testCase.clockAdvance);

        verifyWithIssueAt(token, testCase.maxAge, testCase.options, "secret", err => {
          testUtils.asyncCheck(done, () => {
            expect(err).toBeInstanceOf(jwt.JsonWebTokenError);
            expect(err.message).toEqual(testCase.expectedError);
            expect(err.expiredAt).toStrictEqual(expectedExpiresAtDate);
          });
        });
      });
    });
  });

  describe("with string payload", function () {
    it("should not add iat to string", function (done) {
      const payload = "string payload";
      const options = { algorithm: "HS256" };
      testUtils.signJWTHelper(payload, "secret", options, (err, token) => {
        const decoded = jwt.decode(token);
        testUtils.asyncCheck(done, () => {
          expect(err).toBeNull();
          expect(decoded).toEqual(payload);
        });
      });
    });

    it("should not add iat to stringified object", function (done) {
      const payload = "{}";
      const options = { algorithm: "HS256", header: { typ: "JWT" } };
      testUtils.signJWTHelper(payload, "secret", options, (err, token) => {
        const decoded = jwt.decode(token);
        testUtils.asyncCheck(done, () => {
          expect(err).toEqual(null);
          expect(JSON.stringify(decoded)).toEqual(payload);
        });
      });
    });
  });
});
