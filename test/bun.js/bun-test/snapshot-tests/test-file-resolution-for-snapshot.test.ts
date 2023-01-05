import {
    describe,
    expect,
    it,
  } from "bun:test";

describe("test snapshot resolution", () => {
    it("snap file should match", () => {
        expect("should match").toMatchSnapshot()
    })
})