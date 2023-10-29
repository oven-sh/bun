import jwt from "jsonwebtoken";
import { expect, describe, it } from "bun:test";

describe("decoding", function () {
  it("should not crash when decoding a null token", function () {
    var decoded = jwt.decode("null");
    expect(decoded).toEqual(null);
  });
});
