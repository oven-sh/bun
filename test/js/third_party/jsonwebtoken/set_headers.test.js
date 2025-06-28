import { describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";

describe("set header", function () {
  it("should add the header", function () {
    var token = jwt.sign({ foo: 123 }, "123", { header: { foo: "bar" } });
    var decoded = jwt.decode(token, { complete: true });
    expect(decoded.header.foo).toEqual("bar");
  });

  it("should allow overriding header", function () {
    var token = jwt.sign({ foo: 123 }, "123", { header: { alg: "HS512" } });
    var decoded = jwt.decode(token, { complete: true });
    expect(decoded.header.alg).toEqual("HS512");
  });
});
