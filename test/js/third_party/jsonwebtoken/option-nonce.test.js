"use strict";

import { beforeEach, describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";
import util from "util";
import testUtils from "./test-utils";

describe("nonce option", function () {
  let token;

  beforeEach(function () {
    token = jwt.sign({ nonce: "abcde" }, "secret", { algorithm: "HS256" });
  });
  [
    {
      description: "should work with a string",
      nonce: "abcde",
    },
  ].forEach(testCase => {
    it(testCase.description, function (done) {
      testUtils.verifyJWTHelper(token, "secret", { nonce: testCase.nonce }, (err, decoded) => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeNull();
          expect(decoded).toHaveProperty("nonce", "abcde");
        });
      });
    });
  });
  [true, false, null, -1, 0, 1, -1.1, 1.1, -Infinity, Infinity, NaN, "", " ", [], ["foo"], {}, { foo: "bar" }].forEach(
    nonce => {
      it(`should error with value ${util.inspect(nonce)}`, function (done) {
        testUtils.verifyJWTHelper(token, "secret", { nonce }, err => {
          testUtils.asyncCheck(done, () => {
            expect(err).toBeInstanceOf(jwt.JsonWebTokenError);
            expect(err).toHaveProperty("message", "nonce must be a non-empty string");
          });
        });
      });
    },
  );
});
