"use strict";

import { describe, expect, it } from "bun:test";
import fs from "fs";
import jws from "jws";
import path from "path";
import testUtils from "./test-utils";

describe("complete option", function () {
  const secret = fs.readFileSync(path.join(__dirname, "priv.pem"));
  const pub = fs.readFileSync(path.join(__dirname, "pub.pem"));

  const header = { alg: "RS256" };
  const payload = { iat: Math.floor(Date.now() / 1000) };
  const signed = jws.sign({ header, payload, secret, encoding: "utf8" });
  const signature = jws.decode(signed).signature;

  [
    {
      description: "should return header, payload and signature",
      complete: true,
    },
  ].forEach(testCase => {
    it(testCase.description, function (done) {
      testUtils.verifyJWTHelper(signed, pub, { typ: "JWT", complete: testCase.complete }, (err, decoded) => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeNull();
          expect(decoded.header).toHaveProperty("alg", header.alg);
          expect(decoded.payload).toHaveProperty("iat", payload.iat);
          expect(decoded).toHaveProperty("signature", signature);
        });
      });
    });
  });
  [
    {
      description: "should return payload",
      complete: false,
    },
  ].forEach(testCase => {
    it(testCase.description, function (done) {
      testUtils.verifyJWTHelper(signed, pub, { typ: "JWT", complete: testCase.complete }, (err, decoded) => {
        testUtils.asyncCheck(done, () => {
          expect(err).toBeNull();
          expect(decoded.header).toBeUndefined();
          expect(decoded.payload).toBeUndefined();
          expect(decoded.signature).toBeUndefined();
          expect(decoded).toHaveProperty("iat", payload.iat);
        });
      });
    });
  });
});
