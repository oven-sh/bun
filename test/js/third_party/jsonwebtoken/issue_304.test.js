import { describe, expect, it } from "bun:test";
import jwt from "jsonwebtoken";

describe("issue 304 - verifying values other than strings", function () {
  it("should fail with numbers", function (done) {
    jwt.verify(123, "foo", function (err) {
      expect(err.name).toEqual("JsonWebTokenError");
      done();
    });
  });

  it("should fail with objects", function (done) {
    jwt.verify({ foo: "bar" }, "biz", function (err) {
      expect(err.name).toEqual("JsonWebTokenError");
      done();
    });
  });

  it("should fail with arrays", function (done) {
    jwt.verify(["foo"], "bar", function (err) {
      expect(err.name).toEqual("JsonWebTokenError");
      done();
    });
  });

  it("should fail with functions", function (done) {
    jwt.verify(
      function () {},
      "foo",
      function (err) {
        expect(err.name).toEqual("JsonWebTokenError");
        done();
      },
    );
  });

  it("should fail with booleans", function (done) {
    jwt.verify(true, "foo", function (err) {
      expect(err.name).toEqual("JsonWebTokenError");
      done();
    });
  });
});
