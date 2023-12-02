import { expect, it, mock, describe } from "bun:test";
import { a } from "./A.ts";

mock.module(require.resolve("lodash"), () => ({ trim: () => "mocked" }));

describe("A", () => {
  it("should be mocked", () => {
    expect(a()).toEqual("mocked");
  });
});
