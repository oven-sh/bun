"use strict";

import jwt from "jsonwebtoken";
import { expect, describe, it, beforeEach, afterEach } from "bun:test";
import util from "util";
import sinon from "sinon";

describe("maxAge option", function () {
  let token;

  let fakeClock;
  beforeEach(function () {
    fakeClock = sinon.useFakeTimers({ now: 60000 });
    token = jwt.sign({ iat: 70 }, "secret", { algorithm: "HS256" });
  });

  afterEach(function () {
    fakeClock.uninstall();
  });

  [
    {
      description: "should work with a positive string value",
      maxAge: "3s",
    },
    {
      description: "should work with a negative string value",
      maxAge: "-3s",
    },
    {
      description: "should work with a positive numeric value",
      maxAge: 3,
    },
    {
      description: "should work with a negative numeric value",
      maxAge: -3,
    },
  ].forEach(testCase => {
    it(testCase.description, function (done) {
      expect(() => jwt.verify(token, "secret", { maxAge: "3s", algorithm: "HS256" })).not.toThrow();
      jwt.verify(token, "secret", { maxAge: testCase.maxAge, algorithm: "HS256" }, err => {
        expect(err).toBeNull();
        done();
      });
    });
  });

  [true, "invalid", [], ["foo"], {}, { foo: "bar" }].forEach(maxAge => {
    it(`should error with value ${util.inspect(maxAge)}`, function (done) {
      expect(() => jwt.verify(token, "secret", { maxAge, algorithm: "HS256" })).toThrow(
        '"maxAge" should be a number of seconds or string representing a timespan eg: "1d", "20h", 60',
      );
      jwt.verify(token, "secret", { maxAge, algorithm: "HS256" }, err => {
        expect(err).toBeInstanceOf(jwt.JsonWebTokenError);
        expect(err.message).toEqual(
          '"maxAge" should be a number of seconds or string representing a timespan eg: "1d", "20h", 60',
        );
        done();
      });
    });
  });
});
