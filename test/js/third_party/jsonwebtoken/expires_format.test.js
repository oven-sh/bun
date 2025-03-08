import { describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";

describe("expires option", function () {
  it("should throw on deprecated expiresInSeconds option", function () {
    expect(function () {
      jwt.sign({ foo: 123 }, "123", { expiresInSeconds: 5 });
    }).toThrow('"expiresInSeconds" is not allowed');
  });
});
