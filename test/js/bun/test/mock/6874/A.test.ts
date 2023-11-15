import { expect, it, mock, describe } from "bun:test";
import { a } from "./A.ts";

mock.module("/Users/jarred/Code/bun/test/node_modules/lodash/lodash.js", () => ({ trim: () => "mocked" }));

describe("A", () => {
  it("should be mocked", () => {
    expect(a()).toEqual("mocked");
  });
});
