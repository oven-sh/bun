import { expect, it, mock, describe } from "bun:test";
import { b } from "./B.ts";

mock.module(require.resolve("lodash"), () => ({ trim: () => "mocked" }));

describe("B", () => {
  it("should be mocked", () => {
    expect(b()).toEqual("mocked");
  });
});
