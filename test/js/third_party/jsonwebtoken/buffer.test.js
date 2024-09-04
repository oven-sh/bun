import { describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";

describe("buffer payload", function () {
  it("should work", function () {
    var payload = new Buffer("TkJyotZe8NFpgdfnmgINqg==", "base64");
    var token = jwt.sign(payload, "signing key");
    expect(jwt.decode(token)).toBe(payload.toString());
  });
});
