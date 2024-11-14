import { describe, expect, it } from "bun:test";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import jws from "jws";

describe("HS256", function () {
  describe("when signing using HS256", function () {
    it("should throw if the secret is an asymmetric key", function () {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

      expect(function () {
        jwt.sign({ foo: "bar" }, privateKey, { algorithm: "HS256" });
      }).toThrow("must be a symmetric key");
    });

    it("should throw if the payload is undefined", function () {
      expect(function () {
        jwt.sign(undefined, "secret", { algorithm: "HS256" });
      }).toThrow("payload is required");
    });

    it("should throw if options is not a plain object", function () {
      expect(function () {
        jwt.sign({ foo: "bar" }, "secret", ["HS256"]);
      }).toThrow('Expected "options" to be a plain object');
    });
  });

  describe("with a token signed using HS256", function () {
    var secret = "shhhhhh";

    var token = jwt.sign({ foo: "bar" }, secret, { algorithm: "HS256" });

    it("should be syntactically valid", function () {
      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3);
    });

    it("should be able to validate without options", function (done) {
      var callback = function (err, decoded) {
        if (err) return done(err);
        expect(decoded).toBeDefined();
        expect(decoded.foo).toBeDefined();
        expect("bar").toBe(decoded.foo);
        done();
      };
      callback.issuer = "shouldn't affect";
      jwt.verify(token, secret, callback);
    });

    it("should validate with secret", function (done) {
      jwt.verify(token, secret, function (err, decoded) {
        if (err) return done(err);
        expect(decoded).toBeDefined();
        expect(decoded.foo).toBeDefined();
        done();
      });
    });

    it("should throw with invalid secret", function (done) {
      jwt.verify(token, "invalid secret", function (err, decoded) {
        expect(decoded).toBeUndefined();
        expect(err).toBeTruthy();
        done();
      });
    });

    it("should throw with secret and token not signed", function (done) {
      const header = { alg: "none" };
      const payload = { foo: "bar" };
      const token = jws.sign({ header, payload, secret: "secret", encoding: "utf8" });
      jwt.verify(token, "secret", function (err, decoded) {
        expect(decoded).toBeUndefined();
        expect(err).toBeTruthy();
        done();
      });
    });

    it("should throw with falsy secret and token not signed", function (done) {
      const header = { alg: "none" };
      const payload = { foo: "bar" };
      const token = jws.sign({ header, payload, secret: null, encoding: "utf8" });
      jwt.verify(token, "secret", function (err, decoded) {
        expect(decoded).toBeUndefined();
        expect(err).toBeTruthy();
        done();
      });
    });

    it("should throw when verifying null", function (done) {
      jwt.verify(null, "secret", function (err, decoded) {
        expect(decoded).toBeUndefined();
        expect(err).toBeTruthy();
        done();
      });
    });

    it("should return an error when the token is expired", function (done) {
      var token = jwt.sign({ exp: 1 }, secret, { algorithm: "HS256" });
      jwt.verify(token, secret, { algorithm: "HS256" }, function (err, decoded) {
        expect(decoded).toBeUndefined();
        expect(err).toBeTruthy();
        done();
      });
    });

    it('should NOT return an error when the token is expired with "ignoreExpiration"', function (done) {
      var token = jwt.sign({ exp: 1, foo: "bar" }, secret, { algorithm: "HS256" });
      jwt.verify(token, secret, { algorithm: "HS256", ignoreExpiration: true }, function (err, decoded) {
        if (err) return done(err);
        expect(decoded).toBeDefined();
        expect("bar").toBe(decoded.foo);
        expect(decoded.foo).toBeDefined();
        done();
      });
    });

    it("should default to HS256 algorithm when no options are passed", function () {
      var token = jwt.sign({ foo: "bar" }, secret);
      var verifiedToken = jwt.verify(token, secret);
      expect(verifiedToken).toBeDefined();
      expect("bar").toBe(verifiedToken.foo);
    });
  });

  describe("should fail verification gracefully with trailing space in the jwt", function () {
    var secret = "shhhhhh";
    var token = jwt.sign({ foo: "bar" }, secret, { algorithm: "HS256" });

    it('should return the "invalid token" error', function (done) {
      var malformedToken = token + " "; // corrupt the token by adding a space
      jwt.verify(malformedToken, secret, { algorithm: "HS256", ignoreExpiration: true }, function (err) {
        expect(err).not.toBeNull();
        expect("JsonWebTokenError").toBe(err.name);
        expect("invalid token").toBe(err.message);
        done();
      });
    });
  });
});
