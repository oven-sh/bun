import { describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";

describe("decoding", function () {
  it("should not crash when decoding a null token", function () {
    var decoded = jwt.decode("null");
    expect(decoded).toEqual(null);
  });
});
