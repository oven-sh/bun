import jwt from "jsonwebtoken";
import { expect, describe, it } from "bun:test";

describe("non_object_values values", function () {
  it("should work with string", function () {
    var token = jwt.sign("hello", "123");
    var result = jwt.verify(token, "123");
    expect(result).toEqual("hello");
  });

  it("should work with number", function () {
    var token = jwt.sign(123, "123");
    var result = jwt.verify(token, "123");
    expect(result).toEqual("123");
  });
});
