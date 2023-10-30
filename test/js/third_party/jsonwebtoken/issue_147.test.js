import jwt from "jsonwebtoken";
import { describe, it, expect } from "bun:test";

describe("issue 147 - signing with a sealed payload", function () {
  it("should put the expiration claim", function () {
    var token = jwt.sign(Object.seal({ foo: 123 }), "123", { expiresIn: 10 });
    var result = jwt.verify(token, "123");
    expect(result.exp).toBeCloseTo(Math.floor(Date.now() / 1000) + 10, 2);
  });
});
