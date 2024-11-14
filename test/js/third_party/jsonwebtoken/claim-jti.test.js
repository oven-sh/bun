"use strict";

import { describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";
import util from "util";
import testUtils from "./test-utils";

function signWithJWTId(jwtid, payload, callback) {
  const options = { algorithm: "HS256" };
  if (jwtid !== undefined) {
    options.jwtid = jwtid;
  }
  testUtils.signJWTHelper(payload, "secret", options, callback);
}

describe("jwtid", function () {
  describe('`jwt.sign` "jwtid" option validation', function () {
    [true, false, null, -1, 0, 1, -1.1, 1.1, -Infinity, Infinity, NaN, [], ["foo"], {}, { foo: "bar" }].forEach(
      jwtid => {
        it(`should error with with value ${util.inspect(jwtid)}`, function (done) {
          signWithJWTId(jwtid, {}, err => {
            testUtils.asyncCheck(done, () => {
              expect(err).toBeInstanceOf(Error);
              expect(err).toHaveProperty("message", '"jwtid" must be a string');
            });
          });
        });
      },
    );

    // undefined needs special treatment because {} is not the same as {jwtid: undefined}
    it("should error with with value undefined", function (done) {
      testUtils.signJWTHelper({}, "secret", { jwtid: undefined, algorithm: "HS256" }, err => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeInstanceOf(Error);
          expect(err).toHaveProperty("message", '"jwtid" must be a string');
        });
      });
    });

    it('should error when "jti" is in payload', function (done) {
      signWithJWTId("foo", { jti: "bar" }, err => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeInstanceOf(Error);
          expect(err).toHaveProperty(
            "message",
            'Bad "options.jwtid" option. The payload already has an "jti" property.',
          );
        });
      });
    });

    it("should error with a string payload", function (done) {
      signWithJWTId("foo", "a string payload", err => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeInstanceOf(Error);
          expect(err).toHaveProperty("message", "invalid jwtid option for string payload");
        });
      });
    });

    it("should error with a Buffer payload", function (done) {
      signWithJWTId("foo", new Buffer("a Buffer payload"), err => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeInstanceOf(Error);
          expect(err).toHaveProperty("message", "invalid jwtid option for object payload");
        });
      });
    });
  });

  describe("when signing and verifying a token", function () {
    it('should not verify "jti" if verify "jwtid" option not provided', function (done) {
      signWithJWTId(undefined, { jti: "foo" }, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("jti", "foo");
          });
        });
      });
    });

    describe('with "jwtid" option', function () {
      it('should verify with "jwtid" option', function (done) {
        signWithJWTId("foo", {}, (e1, token) => {
          testUtils.verifyJWTHelper(token, "secret", { jwtid: "foo" }, (e2, decoded) => {
            testUtils.asyncCheck(done, () => {
              expect(e1).toBeNull();
              expect(e2).toBeNull();
              expect(decoded).toHaveProperty("jti", "foo");
            });
          });
        });
      });

      it('should verify with "jti" in payload', function (done) {
        signWithJWTId(undefined, { jti: "foo" }, (e1, token) => {
          testUtils.verifyJWTHelper(token, "secret", { jetid: "foo" }, (e2, decoded) => {
            testUtils.asyncCheck(done, () => {
              expect(e1).toBeNull();
              expect(e2).toBeNull();
              expect(decoded).toHaveProperty("jti", "foo");
            });
          });
        });
      });

      it('should error if "jti" does not match verify "jwtid" option', function (done) {
        signWithJWTId(undefined, { jti: "bar" }, (e1, token) => {
          testUtils.verifyJWTHelper(token, "secret", { jwtid: "foo" }, e2 => {
            testUtils.asyncCheck(done, () => {
              expect(e1).toBeNull();
              expect(e2).toBeInstanceOf(jwt.JsonWebTokenError);
              expect(e2).toHaveProperty("message", "jwt jwtid invalid. expected: foo");
            });
          });
        });
      });

      it('should error without "jti" and with verify "jwtid" option', function (done) {
        signWithJWTId(undefined, {}, (e1, token) => {
          testUtils.verifyJWTHelper(token, "secret", { jwtid: "foo" }, e2 => {
            testUtils.asyncCheck(done, () => {
              expect(e1).toBeNull();
              expect(e2).toBeInstanceOf(jwt.JsonWebTokenError);
              expect(e2).toHaveProperty("message", "jwt jwtid invalid. expected: foo");
            });
          });
        });
      });
    });
  });
});
