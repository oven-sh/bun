"use strict";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";
import jws from "jws";
import sinon from "sinon";
import util from "util";
import testUtils from "./test-utils";

function signWithNotBefore(notBefore, payload, callback) {
  const options = { algorithm: "HS256" };
  if (notBefore !== undefined) {
    options.notBefore = notBefore;
  }
  testUtils.signJWTHelper(payload, "secret", options, callback);
}

describe("not before", function () {
  describe('`jwt.sign` "notBefore" option validation', function () {
    [
      true,
      false,
      null,
      -1.1,
      1.1,
      -Infinity,
      Infinity,
      NaN,
      "",
      " ",
      "invalid",
      [],
      ["foo"],
      {},
      { foo: "bar" },
    ].forEach(notBefore => {
      it(`should error with with value ${util.inspect(notBefore)}`, function (done) {
        signWithNotBefore(notBefore, {}, err => {
          testUtils.asyncCheck(done, () => {
            expect(err).toBeInstanceOf(Error);
            expect(err).toHaveProperty("message");
          });
        });
      });
    });

    // undefined needs special treatment because {} is not the same as {notBefore: undefined}
    it("should error with with value undefined", function (done) {
      testUtils.signJWTHelper({}, "secret", { notBefore: undefined, algorithm: "HS256" }, err => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeInstanceOf(Error);
          expect(err).toHaveProperty(
            "message",
            '"notBefore" should be a number of seconds or string representing a timespan',
          );
        });
      });
    });

    it('should error when "nbf" is in payload', function (done) {
      signWithNotBefore(100, { nbf: 100 }, err => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeInstanceOf(Error);
          expect(err).toHaveProperty(
            "message",
            'Bad "options.notBefore" option the payload already has an "nbf" property.',
          );
        });
      });
    });

    it("should error with a string payload", function (done) {
      signWithNotBefore(100, "a string payload", err => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeInstanceOf(Error);
          expect(err).toHaveProperty("message", "invalid notBefore option for string payload");
        });
      });
    });

    it("should error with a Buffer payload", function (done) {
      signWithNotBefore(100, new Buffer("a Buffer payload"), err => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeInstanceOf(Error);
          expect(err).toHaveProperty("message", "invalid notBefore option for object payload");
        });
      });
    });
  });

  describe('`jwt.sign` "nbf" claim validation', function () {
    [true, false, null, undefined, "", " ", "invalid", [], ["foo"], {}, { foo: "bar" }].forEach(nbf => {
      it(`should error with with value ${util.inspect(nbf)}`, function (done) {
        signWithNotBefore(undefined, { nbf }, err => {
          testUtils.asyncCheck(done, () => {
            expect(err).toBeInstanceOf(Error);
            expect(err).toHaveProperty("message", '"nbf" should be a number of seconds');
          });
        });
      });
    });
  });

  describe('"nbf" in payload validation', function () {
    [true, false, null, -Infinity, Infinity, NaN, "", " ", "invalid", [], ["foo"], {}, { foo: "bar" }].forEach(nbf => {
      it(`should error with with value ${util.inspect(nbf)}`, function (done) {
        const header = { alg: "HS256" };
        const payload = { nbf };
        const token = jws.sign({ header, payload, secret: "secret", encoding: "utf8" });
        testUtils.verifyJWTHelper(token, "secret", { nbf }, err => {
          testUtils.asyncCheck(done, () => {
            expect(err).toBeInstanceOf(jwt.JsonWebTokenError);
            expect(err).toHaveProperty("message", "invalid nbf value");
          });
        });
      });
    });
  });

  describe('when signing and verifying a token with "notBefore" option', function () {
    let fakeClock;
    beforeEach(function () {
      fakeClock = sinon.useFakeTimers({ now: 60000 });
    });

    afterEach(function () {
      fakeClock.uninstall();
    });

    it('should set correct "nbf" with negative number of seconds', function (done) {
      signWithNotBefore(-10, {}, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("nbf", 50);
          });
        });
      });
    });

    it('should set correct "nbf" with positive number of seconds', function (done) {
      signWithNotBefore(10, {}, (e1, token) => {
        fakeClock.tick(10000);
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("nbf", 70);
          });
        });
      });
    });

    it('should set correct "nbf" with zero seconds', function (done) {
      signWithNotBefore(0, {}, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("nbf", 60);
          });
        });
      });
    });

    it('should set correct "nbf" with negative string timespan', function (done) {
      signWithNotBefore("-10 s", {}, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("nbf", 50);
          });
        });
      });
    });

    it('should set correct "nbf" with positive string timespan', function (done) {
      signWithNotBefore("10 s", {}, (e1, token) => {
        fakeClock.tick(10000);
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("nbf", 70);
          });
        });
      });
    });

    it('should set correct "nbf" with zero string timespan', function (done) {
      signWithNotBefore("0 s", {}, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("nbf", 60);
          });
        });
      });
    });

    // TODO an nbf of -Infinity should fail validation
    it('should set null "nbf" when given -Infinity', function (done) {
      signWithNotBefore(undefined, { nbf: -Infinity }, (err, token) => {
        const decoded = jwt.decode(token);
        testUtils.asyncCheck(done, () => {
          expect(err).toBeNull();
          expect(decoded).toHaveProperty("nbf", null);
        });
      });
    });

    // TODO an nbf of Infinity should fail validation
    it('should set null "nbf" when given value Infinity', function (done) {
      signWithNotBefore(undefined, { nbf: Infinity }, (err, token) => {
        const decoded = jwt.decode(token);
        testUtils.asyncCheck(done, () => {
          expect(err).toBeNull();
          expect(decoded).toHaveProperty("nbf", null);
        });
      });
    });

    // TODO an nbf of NaN should fail validation
    it('should set null "nbf" when given value NaN', function (done) {
      signWithNotBefore(undefined, { nbf: NaN }, (err, token) => {
        const decoded = jwt.decode(token);
        testUtils.asyncCheck(done, () => {
          expect(err).toBeNull();
          expect(decoded).toHaveProperty("nbf", null);
        });
      });
    });

    it('should set correct "nbf" when "iat" is passed', function (done) {
      signWithNotBefore(-10, { iat: 40 }, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("nbf", 30);
          });
        });
      });
    });

    it('should verify "nbf" using "clockTimestamp"', function (done) {
      signWithNotBefore(10, {}, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", { clockTimestamp: 70 }, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("iat", 60);
            expect(decoded).toHaveProperty("nbf", 70);
          });
        });
      });
    });

    it('should verify "nbf" using "clockTolerance"', function (done) {
      signWithNotBefore(5, {}, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", { clockTolerance: 6 }, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("iat", 60);
            expect(decoded).toHaveProperty("nbf", 65);
          });
        });
      });
    });

    it('should ignore a not active token when "ignoreNotBefore" is true', function (done) {
      signWithNotBefore("10 s", {}, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", { ignoreNotBefore: true }, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("iat", 60);
            expect(decoded).toHaveProperty("nbf", 70);
          });
        });
      });
    });

    it('should error on verify if "nbf" is after current time', function (done) {
      signWithNotBefore(undefined, { nbf: 61 }, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", {}, e2 => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeInstanceOf(jwt.NotBeforeError);
            expect(e2).toHaveProperty("message", "jwt not active");
          });
        });
      });
    });

    it('should error on verify if "nbf" is after current time using clockTolerance', function (done) {
      signWithNotBefore(5, {}, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", { clockTolerance: 4 }, e2 => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeInstanceOf(jwt.NotBeforeError);
            expect(e2).toHaveProperty("message", "jwt not active");
          });
        });
      });
    });
  });
});
