var PS_SUPPORTED = true;
import jwt from "jsonwebtoken";
import { expect, describe, it } from "bun:test";
import path from "path";
import fs from "fs";

var pub = fs.readFileSync(path.join(__dirname, "pub.pem"), "utf8");
// priv is never used
// var priv = fs.readFileSync(path.join(__dirname, 'priv.pem'));

var TOKEN =
  "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJmb28iOiJiYXIiLCJpYXQiOjE0MjY1NDY5MTl9.ETgkTn8BaxIX4YqvUWVFPmum3moNZ7oARZtSBXb_vP4";

describe("when setting a wrong `header.alg`", function () {
  describe("signing with pub key as symmetric", function () {
    it("should not verify", function () {
      expect(function () {
        jwt.verify(TOKEN, pub);
      }).toThrow(/invalid algorithm/);
    });
  });

  describe("signing with pub key as HS256 and whitelisting only RS256", function () {
    it("should not verify", function () {
      expect(function () {
        jwt.verify(TOKEN, pub, { algorithms: ["RS256"] });
      }).toThrow(/invalid algorithm/);
    });
  });

  if (PS_SUPPORTED) {
    describe("signing with pub key as HS256 and whitelisting only PS256", function () {
      it("should not verify", function () {
        expect(function () {
          jwt.verify(TOKEN, pub, { algorithms: ["PS256"] });
        }).toThrow(/invalid algorithm/);
      });
    });
  }

  describe("signing with HS256 and checking with HS384", function () {
    it("should not verify", function () {
      expect(function () {
        var token = jwt.sign({ foo: "bar" }, "secret", { algorithm: "HS256" });
        jwt.verify(token, "some secret", { algorithms: ["HS384"] });
      }).toThrow(/invalid algorithm/);
    });
  });
});
