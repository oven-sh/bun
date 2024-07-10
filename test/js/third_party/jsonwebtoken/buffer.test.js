import jwt from "jsonwebtoken";
import { expect, describe, it } from "bun:test";

describe("buffer payload", function () {
  it("should work", function () {
    var payload = new Buffer("TkJyotZe8NFpgdfnmgINqg==", "base64");
    var token = jwt.sign(payload, "signing key");
    expect(jwt.decode(token)).toBe(payload.toString());
  });
});
