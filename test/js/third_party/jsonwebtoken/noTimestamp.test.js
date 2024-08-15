import jwt from "jsonwebtoken";
import { expect, describe, it } from "bun:test";

describe("noTimestamp", function () {
  it("should work with string", function () {
    var exp = Math.floor(Date.now() / 1000) + 5 * 60;
    var token = jwt.sign({ foo: 123 }, "123", { expiresIn: "5m", noTimestamp: true });
    var result = jwt.verify(token, "123");
    expect(result.exp).toBeGreaterThanOrEqual(exp);
  });
});
