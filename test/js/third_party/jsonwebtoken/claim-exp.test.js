"use strict";

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";
import jws from "jws";
import sinon from "sinon";
import util from "util";
import testUtils from "./test-utils";

function signWithExpiresIn(expiresIn, payload, callback) {
  const options = { algorithm: "HS256" };
  if (expiresIn !== undefined) {
    options.expiresIn = expiresIn;
  }
  testUtils.signJWTHelper(payload, "secret", options, callback);
}

describe("expires", function () {
  describe('`jwt.sign` "expiresIn" option validation', function () {
    [
      true,
      false,
      null,
      -1.1,
      1.1,
      -Infinity,
      Infinity,
      NaN,
      " ",
      "",
      "invalid",
      [],
      ["foo"],
      {},
      { foo: "bar" },
    ].forEach(expiresIn => {
      it(`should error with with value ${util.inspect(expiresIn)}`, function (done) {
        signWithExpiresIn(expiresIn, {}, err => {
          testUtils.asyncCheck(done, () => {
            expect(err).toBeInstanceOf(Error);
            expect(err).toHaveProperty("message");
          });
        });
      });
    });

    // undefined needs special treatment because {} is not the same as {expiresIn: undefined}
    it("should error with with value undefined", function (done) {
      testUtils.signJWTHelper({}, "secret", { expiresIn: undefined, algorithm: "HS256" }, err => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeInstanceOf(Error);
          expect(err).toHaveProperty(
            "message",
            '"expiresIn" should be a number of seconds or string representing a timespan',
          );
        });
      });
    });

    it('should error when "exp" is in payload', function (done) {
      signWithExpiresIn(100, { exp: 100 }, err => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeInstanceOf(Error);
          expect(err).toHaveProperty(
            "message",
            'Bad "options.expiresIn" option the payload already has an "exp" property.',
          );
        });
      });
    });

    it("should error with a string payload", function (done) {
      signWithExpiresIn(100, "a string payload", err => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeInstanceOf(Error);
          expect(err).toHaveProperty("message", "invalid expiresIn option for string payload");
        });
      });
    });

    it("should error with a Buffer payload", function (done) {
      signWithExpiresIn(100, Buffer.from("a Buffer payload"), err => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeInstanceOf(Error);
          expect(err).toHaveProperty("message", "invalid expiresIn option for object payload");
        });
      });
    });
  });

  describe('`jwt.sign` "exp" claim validation', function () {
    [true, false, null, undefined, "", " ", "invalid", [], ["foo"], {}, { foo: "bar" }].forEach(exp => {
      it(`should error with with value ${util.inspect(exp)}`, function (done) {
        signWithExpiresIn(undefined, { exp }, err => {
          testUtils.asyncCheck(done, () => {
            expect(err).toBeInstanceOf(Error);
            expect(err).toHaveProperty("message", '"exp" should be a number of seconds');
          });
        });
      });
    });
  });

  describe('"exp" in payload validation', function () {
    [true, false, null, -Infinity, Infinity, NaN, "", " ", "invalid", [], ["foo"], {}, { foo: "bar" }].forEach(exp => {
      it(`should error with with value ${util.inspect(exp)}`, function (done) {
        const header = { alg: "HS256" };
        const payload = { exp };
        const token = jws.sign({ header, payload, secret: "secret", encoding: "utf8" });
        testUtils.verifyJWTHelper(token, "secret", { exp }, err => {
          testUtils.asyncCheck(done, () => {
            expect(err).toBeInstanceOf(jwt.JsonWebTokenError);
            expect(err).toHaveProperty("message", "invalid exp value");
          });
        });
      });
    });
  });

  describe("when signing and verifying a token with expires option", function () {
    let fakeClock;
    beforeEach(function () {
      fakeClock = sinon.useFakeTimers({ now: 60000 });
    });

    afterEach(function () {
      fakeClock.uninstall();
    });

    it('should set correct "exp" with negative number of seconds', function (done) {
      signWithExpiresIn(-10, {}, (e1, token) => {
        fakeClock.tick(-10001);
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("exp", 50);
          });
        });
      });
    });

    it('should set correct "exp" with positive number of seconds', function (done) {
      signWithExpiresIn(10, {}, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("exp", 70);
          });
        });
      });
    });

    it('should set correct "exp" with zero seconds', function (done) {
      signWithExpiresIn(0, {}, (e1, token) => {
        fakeClock.tick(-1);
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("exp", 60);
          });
        });
      });
    });

    it('should set correct "exp" with negative string timespan', function (done) {
      signWithExpiresIn("-10 s", {}, (e1, token) => {
        fakeClock.tick(-10001);
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("exp", 50);
          });
        });
      });
    });

    it('should set correct "exp" with positive string timespan', function (done) {
      signWithExpiresIn("10 s", {}, (e1, token) => {
        fakeClock.tick(-10001);
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("exp", 70);
          });
        });
      });
    });

    it('should set correct "exp" with zero string timespan', function (done) {
      signWithExpiresIn("0 s", {}, (e1, token) => {
        fakeClock.tick(-1);
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("exp", 60);
          });
        });
      });
    });

    // TODO an exp of -Infinity should fail validation
    it('should set null "exp" when given -Infinity', function (done) {
      signWithExpiresIn(undefined, { exp: -Infinity }, (err, token) => {
        const decoded = jwt.decode(token);
        testUtils.asyncCheck(done, () => {
          expect(err).toBeNull();
          expect(decoded).toHaveProperty("exp", null);
        });
      });
    });

    // TODO an exp of Infinity should fail validation
    it('should set null "exp" when given value Infinity', function (done) {
      signWithExpiresIn(undefined, { exp: Infinity }, (err, token) => {
        const decoded = jwt.decode(token);
        testUtils.asyncCheck(done, () => {
          expect(err).toBeNull();
          expect(decoded).toHaveProperty("exp", null);
        });
      });
    });

    // TODO an exp of NaN should fail validation
    it('should set null "exp" when given value NaN', function (done) {
      signWithExpiresIn(undefined, { exp: NaN }, (err, token) => {
        const decoded = jwt.decode(token);
        testUtils.asyncCheck(done, () => {
          expect(err).toBeNull();
          expect(decoded).toHaveProperty("exp", null);
        });
      });
    });

    it('should set correct "exp" when "iat" is passed', function (done) {
      signWithExpiresIn(-10, { iat: 80 }, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("exp", 70);
          });
        });
      });
    });

    it('should verify "exp" using "clockTimestamp"', function (done) {
      signWithExpiresIn(10, {}, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", { clockTimestamp: 69 }, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("iat", 60);
            expect(decoded).toHaveProperty("exp", 70);
          });
        });
      });
    });

    it('should verify "exp" using "clockTolerance"', function (done) {
      signWithExpiresIn(5, {}, (e1, token) => {
        fakeClock.tick(10000);
        testUtils.verifyJWTHelper(token, "secret", { clockTimestamp: 6 }, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("iat", 60);
            expect(decoded).toHaveProperty("exp", 65);
          });
        });
      });
    });

    it('should ignore a expired token when "ignoreExpiration" is true', function (done) {
      signWithExpiresIn("-10 s", {}, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", { ignoreExpiration: true }, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("iat", 60);
            expect(decoded).toHaveProperty("exp", 50);
          });
        });
      });
    });

    it('should error on verify if "exp" is at current time', function (done) {
      signWithExpiresIn(undefined, { exp: 60 }, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", {}, e2 => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeInstanceOf(jwt.TokenExpiredError);
            expect(e2).toHaveProperty("message", "jwt expired");
          });
        });
      });
    });

    it('should error on verify if "exp" is before current time using clockTolerance', function (done) {
      signWithExpiresIn(-5, {}, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", { clockTolerance: 5 }, e2 => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeInstanceOf(jwt.TokenExpiredError);
            expect(e2).toHaveProperty("message", "jwt expired");
          });
        });
      });
    });
  });
});
