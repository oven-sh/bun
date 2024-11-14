import { describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";

describe("issue 147 - signing with a sealed payload", function () {
  it("should put the expiration claim", function () {
    var token = jwt.sign(Object.seal({ foo: 123 }), "123", { expiresIn: 1000 });
    var result = jwt.verify(token, "123");
    const expected = Math.floor(Date.now() / 1000) + 1000;
    // check that the expiration is within 1 second of the expected value
    expect(result.exp).toBeWithin(expected - 1, expected + 2);
  });
});
