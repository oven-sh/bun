"use strict";

import { describe, expect, it } from "bun:test";
import util from "util";
import testUtils from "./test-utils";

function signWithPayload(payload, callback) {
  testUtils.signJWTHelper(payload, "secret", { algorithm: "HS256" }, callback);
}

describe("with a private claim", function () {
  [true, false, null, -1, 0, 1, -1.1, 1.1, "", "private claim", "UTF8 - José", [], ["foo"], {}, { foo: "bar" }].forEach(
    privateClaim => {
      it(`should sign and verify with claim of ${util.inspect(privateClaim)}`, function (done) {
        signWithPayload({ privateClaim }, (e1, token) => {
          testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
            testUtils.asyncCheck(done, () => {
              expect(e1).toBeNull();
              expect(e2).toBeNull();
              expect(decoded).toHaveProperty("privateClaim", privateClaim);
            });
          });
        });
      });
    },
  );

  // these values JSON.stringify to null
  [-Infinity, Infinity, NaN].forEach(privateClaim => {
    it(`should sign and verify with claim of ${util.inspect(privateClaim)}`, function (done) {
      signWithPayload({ privateClaim }, (e1, token) => {
        testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
          testUtils.asyncCheck(done, () => {
            expect(e1).toBeNull();
            expect(e2).toBeNull();
            expect(decoded).toHaveProperty("privateClaim", null);
          });
        });
      });
    });
  });

  // private claims with value undefined are not added to the payload
  it(`should sign and verify with claim of undefined`, function (done) {
    signWithPayload({ privateClaim: undefined }, (e1, token) => {
      testUtils.verifyJWTHelper(token, "secret", {}, (e2, decoded) => {
        testUtils.asyncCheck(done, () => {
          expect(e1).toBeNull();
          expect(e2).toBeNull();
          expect(decoded).not.toHaveProperty("privateClaim");
        });
      });
    });
  });
});
