var PS_SUPPORTED = true;
import { describe, expect, it } from "bun:test";
import fs from "fs";
import jwt from "jsonwebtoken";

describe("schema", function () {
  describe("sign options", function () {
    var cert_rsa_priv = fs.readFileSync(__dirname + "/rsa-private.pem");
    var cert_ecdsa_priv = fs.readFileSync(__dirname + "/ecdsa-private.pem");
    var cert_secp384r1_priv = fs.readFileSync(__dirname + "/secp384r1-private.pem");
    var cert_secp521r1_priv = fs.readFileSync(__dirname + "/secp521r1-private.pem");

    function sign(options, secretOrPrivateKey) {
      jwt.sign({ foo: 123 }, secretOrPrivateKey, options);
    }

    it("should validate algorithm", function () {
      expect(function () {
        sign({ algorithm: "foo" }, cert_rsa_priv);
      }).toThrow(/"algorithm" must be a valid string enum value/);
      sign({ algorithm: "none" }, null);
      sign({ algorithm: "RS256" }, cert_rsa_priv);
      sign({ algorithm: "RS384" }, cert_rsa_priv);
      sign({ algorithm: "RS512" }, cert_rsa_priv);
      if (PS_SUPPORTED) {
        sign({ algorithm: "PS256" }, cert_rsa_priv);
        sign({ algorithm: "PS384" }, cert_rsa_priv);
        sign({ algorithm: "PS512" }, cert_rsa_priv);
      }
      sign({ algorithm: "ES256" }, cert_ecdsa_priv);
      sign({ algorithm: "ES384" }, cert_secp384r1_priv);
      sign({ algorithm: "ES512" }, cert_secp521r1_priv);
      sign({ algorithm: "HS256" }, "superSecret");
      sign({ algorithm: "HS384" }, "superSecret");
      sign({ algorithm: "HS512" }, "superSecret");
    });

    it("should validate header", function () {
      expect(function () {
        sign({ header: "foo" }, "superSecret");
      }).toThrow(/"header" must be an object/);
      sign({ header: {} }, "superSecret");
    });

    it("should validate encoding", function () {
      expect(function () {
        sign({ encoding: 10 }, "superSecret");
      }).toThrow(/"encoding" must be a string/);
      sign({ encoding: "utf8" }, "superSecret");
    });

    it("should validate noTimestamp", function () {
      expect(function () {
        sign({ noTimestamp: 10 }, "superSecret");
      }).toThrow(/"noTimestamp" must be a boolean/);
      sign({ noTimestamp: true }, "superSecret");
    });
  });

  describe("sign payload registered claims", function () {
    function sign(payload) {
      jwt.sign(payload, "foo123");
    }

    it("should validate exp", function () {
      expect(function () {
        sign({ exp: "1 monkey" });
      }).toThrow(/"exp" should be a number of seconds/);
      sign({ exp: 10.1 });
    });
  });
});
