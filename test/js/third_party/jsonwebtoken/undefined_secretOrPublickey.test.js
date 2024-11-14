import { describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";

var TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDcSemACt8x4iTMCda8Yhe3iZaWbvV5XKSTbuAn0M";

describe("verifying without specified secret or public key", function () {
  it("should not verify null", function () {
    expect(function () {
      jwt.verify(TOKEN, null);
    }).toThrow(/secret or public key must be provided/);
  });

  it("should not verify undefined", function () {
    expect(function () {
      jwt.verify(TOKEN);
    }).toThrow(/secret or public key must be provided/);
  });
});
