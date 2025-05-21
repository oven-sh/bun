import { describe, expect, it } from "bun:test";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import jws from "jws";
var PS_SUPPORTED = true;

describe("signing a token asynchronously", function () {
  describe("when signing a token", function () {
    var secret = "shhhhhh";

    it("should return the same result as singing synchronously", function (done) {
      jwt.sign({ foo: "bar" }, secret, { algorithm: "HS256" }, function (err, asyncToken) {
        if (err) return done(err);
        var syncToken = jwt.sign({ foo: "bar" }, secret, { algorithm: "HS256" });
        expect(typeof asyncToken).toBe("string");
        expect(asyncToken.split(".")).toHaveLength(3);
        expect(asyncToken).toEqual(syncToken);
        done();
      });
    });

    it("should work with empty options", function (done) {
      jwt.sign({ abc: 1 }, "secret", {}, function (err) {
        expect(err).toBeNull();
        done();
      });
    });

    it("should work without options object at all", function (done) {
      jwt.sign({ abc: 1 }, "secret", function (err) {
        expect(err).toBeNull();
        done();
      });
    });

    it("should work with none algorithm where secret is set", function (done) {
      jwt.sign({ foo: "bar" }, "secret", { algorithm: "none" }, function (err, token) {
        expect(typeof token).toBe("string");
        expect(token.split(".")).toHaveLength(3);
        done();
      });
    });

    //Known bug: https://github.com/brianloveswords/node-jws/issues/62
    //If you need this use case, you need to go for the non-callback-ish code style.
    it.skip("should work with none algorithm where secret is falsy", function (done) {
      jwt.sign({ foo: "bar" }, undefined, { algorithm: "none" }, function (err, token) {
        expect(typeof token).toBe("string");
        expect(token.split(".")).toHaveLength(3);
        done();
      });
    });

    it("should return error when secret is not a cert for RS256", function (done) {
      //this throw an error because the secret is not a cert and RS256 requires a cert.
      jwt.sign({ foo: "bar" }, secret, { algorithm: "RS256" }, function (err) {
        expect(err).toBeTruthy();
        done();
      });
    });

    it("should not work for RS algorithms when modulus length is less than 2048 when allowInsecureKeySizes is false or not set", function (done) {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });

      jwt.sign({ foo: "bar" }, privateKey, { algorithm: "RS256" }, function (err) {
        expect(err).toBeTruthy();
        done();
      });
    });

    it("should work for RS algorithms when modulus length is less than 2048 when allowInsecureKeySizes is true", function (done) {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });

      jwt.sign({ foo: "bar" }, privateKey, { algorithm: "RS256", allowInsecureKeySizes: true }, done);
    });

    if (PS_SUPPORTED) {
      it("should return error when secret is not a cert for PS256", function (done) {
        //this throw an error because the secret is not a cert and PS256 requires a cert.
        jwt.sign({ foo: "bar" }, secret, { algorithm: "PS256" }, function (err) {
          expect(err).toBeTruthy();
          done();
        });
      });
    }

    it("should return error on wrong arguments", function (done) {
      //this throw an error because the secret is not a cert and RS256 requires a cert.
      jwt.sign({ foo: "bar" }, secret, { notBefore: {} }, function (err) {
        expect(err).toBeTruthy();
        done();
      });
    });

    it("should return error on wrong arguments (2)", function (done) {
      jwt.sign("string", "secret", { noTimestamp: true }, function (err) {
        expect(err).toBeTruthy();
        expect(err).toBeInstanceOf(Error);
        done();
      });
    });

    it("should not stringify the payload", function (done) {
      jwt.sign("string", "secret", {}, function (err, token) {
        if (err) {
          return done(err);
        }
        expect(jws.decode(token).payload).toEqual("string");
        done();
      });
    });

    describe("when mutatePayload is not set", function () {
      it("should not apply claims to the original payload object (mutatePayload defaults to false)", function (done) {
        var originalPayload = { foo: "bar" };
        jwt.sign(originalPayload, "secret", { notBefore: 60, expiresIn: 600 }, function (err) {
          if (err) {
            return done(err);
          }
          expect(originalPayload).not.toHaveProperty("nbf");
          expect(originalPayload).not.toHaveProperty("exp");
          done();
        });
      });
    });

    describe("when mutatePayload is set to true", function () {
      it("should apply claims directly to the original payload object", function (done) {
        var originalPayload = { foo: "bar" };
        jwt.sign(originalPayload, "secret", { notBefore: 60, expiresIn: 600, mutatePayload: true }, function (err) {
          if (err) {
            return done(err);
          }
          expect(originalPayload).toHaveProperty("nbf");
          expect(originalPayload).toHaveProperty("exp");
          done();
        });
      });
    });

    describe("secret must have a value", function () {
      [undefined, "", 0].forEach(function (secret) {
        it(
          "should return an error if the secret is falsy and algorithm is not set to none: " +
            (typeof secret === "string" ? "(empty string)" : secret),
          function (done) {
            // This is needed since jws will not answer for falsy secrets
            jwt.sign("string", secret, {}, function (err, token) {
              expect(err).toBeTruthy();
              expect(err.message).toEqual("secretOrPrivateKey must have a value");
              expect(token).toBeFalsy();
              done();
            });
          },
        );
      });
    });
  });
});
