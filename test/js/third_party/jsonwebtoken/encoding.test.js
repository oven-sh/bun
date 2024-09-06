import { describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";

describe("encoding", function () {
  function b64_to_utf8(str) {
    return decodeURIComponent(escape(atob(str)));
  }

  it("should properly encode the token (utf8)", function () {
    var expected = "José";
    var token = jwt.sign({ name: expected }, "shhhhh");
    var decoded_name = JSON.parse(b64_to_utf8(token.split(".")[1])).name;
    expect(decoded_name).toEqual(expected);
  });

  it("should properly encode the token (binary)", function () {
    var expected = "José";
    var token = jwt.sign({ name: expected }, "shhhhh", { encoding: "binary" });
    var decoded_name = JSON.parse(atob(token.split(".")[1])).name;
    expect(decoded_name).toEqual(expected);
  });

  it("should return the same result when decoding", function () {
    var username = "測試";

    var token = jwt.sign(
      {
        username: username,
      },
      "test",
    );

    var payload = jwt.verify(token, "test");

    expect(payload.username).toEqual(username);
  });
});
