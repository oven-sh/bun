const PS_SUPPORTED = true;
import jwt from "jsonwebtoken";
import { expect, describe, it } from "bun:test";
import fs from "fs";
import path from "path";

function loadKey(filename) {
  return fs.readFileSync(path.join(__dirname, filename));
}

const algorithms = {
  RS256: {
    pub_key: loadKey("pub.pem"),
    priv_key: loadKey("priv.pem"),
    invalid_pub_key: loadKey("invalid_pub.pem"),
  },
  ES256: {
    // openssl ecparam -name secp256r1 -genkey -param_enc explicit -out ecdsa-private.pem
    priv_key: loadKey("ecdsa-private.pem"),
    // openssl ec -in ecdsa-private.pem -pubout -out ecdsa-public.pem
    pub_key: loadKey("ecdsa-public.pem"),
    invalid_pub_key: loadKey("ecdsa-public-invalid.pem"),
  },
};

if (PS_SUPPORTED) {
  algorithms.PS256 = {
    pub_key: loadKey("pub.pem"),
    priv_key: loadKey("priv.pem"),
    invalid_pub_key: loadKey("invalid_pub.pem"),
  };
}

describe("Asymmetric Algorithms", function () {
  Object.keys(algorithms).forEach(function (algorithm) {
    describe(algorithm, function () {
      const pub = algorithms[algorithm].pub_key;
      const priv = algorithms[algorithm].priv_key;

      // "invalid" means it is not the public key for the loaded "priv" key
      const invalid_pub = algorithms[algorithm].invalid_pub_key;

      describe("when signing a token", function () {
        const token = jwt.sign({ foo: "bar" }, priv, { algorithm: algorithm });

        it("should be syntactically valid", function () {
          expect(typeof token).toBe("string");
          expect(token.split(".")).toHaveLength(3);
        });

        describe("asynchronous", function () {
          (algorithm === "ES256" ? it.todo : it)("should validate with public key", function (done) {
            jwt.verify(token, pub, function (err, decoded) {
              if (err) return done(err);
              expect(decoded).toBeDefined();
              expect(decoded.foo).toBeTruthy();
              expect("bar").toBe(decoded.foo);
              done();
            });
          });

          it("should throw with invalid public key", function (done) {
            jwt.verify(token, invalid_pub, function (err, decoded) {
              expect(decoded).toBeUndefined();
              expect(err).toBeTruthy();
              done();
            });
          });
        });

        describe("synchronous", function () {
          (algorithm === "ES256" ? it.todo : it)("should validate with public key", function () {
            const decoded = jwt.verify(token, pub);
            expect(decoded).toBeDefined();
            expect(decoded.foo).toBeTruthy();
            expect("bar").toBe(decoded.foo);
          });

          it("should throw with invalid public key", function () {
            const jwtVerify = jwt.verify.bind(null, token, invalid_pub);
            expect(jwtVerify).toThrow();
          });
        });
      });

      describe("when signing a token with expiration", function () {
        (algorithm === "ES256" ? it.todo : it)("should be valid expiration", function (done) {
          const token = jwt.sign({ foo: "bar" }, priv, { algorithm: algorithm, expiresIn: "10m" });
          jwt.verify(token, pub, function (err, decoded) {
            if (err) return done(err);
            expect(decoded).toBeTruthy();
            expect(err).toBeNull();
            done();
          });
        });

        (algorithm === "ES256" ? it.todo : it)("should be invalid", function (done) {
          // expired token
          const token = jwt.sign({ foo: "bar" }, priv, { algorithm: algorithm, expiresIn: -1 * (10 * 60 * 1000) });
          jwt.verify(token, pub, function (err, decoded) {
            expect(decoded).toBeUndefined();
            expect(err).toBeDefined();
            expect(err.name).toBe("TokenExpiredError");
            expect(err.expiredAt).toBeInstanceOf(Date);
            expect(err).toBeInstanceOf(jwt.TokenExpiredError);
            done();
          });
        });

        (algorithm === "ES256" ? it.todo : it)("should NOT be invalid", function (done) {
          // expired token
          const token = jwt.sign({ foo: "bar" }, priv, { algorithm: algorithm, expiresIn: -1 * (10 * 60 * 1000) });

          jwt.verify(token, pub, { ignoreExpiration: true }, function (err, decoded) {
            expect(decoded).toBeDefined();
            expect(decoded.foo).toBeDefined();
            expect("bar").toBe(decoded.foo);
            done();
          });
        });
      });

      describe("when verifying a malformed token", function () {
        it("should throw", function (done) {
          jwt.verify("fruit.fruit.fruit", pub, function (err, decoded) {
            expect(decoded).toBeUndefined();
            expect(err).toBeDefined();
            expect(err.name).toBe("JsonWebTokenError");
            done();
          });
        });
      });

      describe("when decoding a jwt token with additional parts", function () {
        const token = jwt.sign({ foo: "bar" }, priv, { algorithm: algorithm });

        it("should throw", function (done) {
          jwt.verify(token + ".foo", pub, function (err, decoded) {
            expect(decoded).toBeUndefined();
            expect(err).toBeDefined();
            done();
          });
        });
      });

      describe("when decoding a invalid jwt token", function () {
        it("should return null", function (done) {
          const payload = jwt.decode("whatever.token");
          expect(payload).toBeNull();
          done();
        });
      });

      describe("when decoding a valid jwt token", function () {
        it("should return the payload", function (done) {
          const obj = { foo: "bar" };
          const token = jwt.sign(obj, priv, { algorithm: algorithm });
          const payload = jwt.decode(token);
          expect(payload.foo).toEqual(obj.foo);
          done();
        });
        it("should return the header and payload and signature if complete option is set", function (done) {
          const obj = { foo: "bar" };
          const token = jwt.sign(obj, priv, { algorithm: algorithm });
          const decoded = jwt.decode(token, { complete: true });
          expect(decoded.payload.foo).toEqual(obj.foo);
          expect(decoded.header).toStrictEqual({ typ: "JWT", alg: algorithm });
          expect(typeof decoded.signature).toBe("string");
          done();
        });
      });
    });
  });

  describe("when signing a token with an unsupported private key type", function () {
    it.todo("should throw an error", function () {
      const obj = { foo: "bar" };
      const key = loadKey("dsa-private.pem");
      const algorithm = "RS256";

      expect(function () {
        jwt.sign(obj, key, { algorithm });
      }).toThrow('Unknown key type "dsa".');
    });
  });

  describe("when signing a token with an incorrect private key type", function () {
    it("should throw a validation error if key validation is enabled", function () {
      const obj = { foo: "bar" };
      const key = loadKey("rsa-private.pem");
      const algorithm = "ES256";

      expect(function () {
        jwt.sign(obj, key, { algorithm });
      }).toThrow(/"alg" parameter for "rsa" key type must be one of:/);
    });

    it("should throw an unknown error if key validation is disabled", function () {
      const obj = { foo: "bar" };
      const key = loadKey("rsa-private.pem");
      const algorithm = "ES256";

      expect(function () {
        jwt.sign(obj, key, { algorithm, allowInvalidAsymmetricKeyTypes: true });
      }).not.toThrow(/"alg" parameter for "rsa" key type must be one of:/);
    });
  });
});
