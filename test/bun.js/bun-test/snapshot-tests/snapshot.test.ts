import {
    describe,
    expect,
    it,
  } from "bun:test";

describe("test snapshot", () => {
    it("single snapshot test", () => {
        expect("hello").toMatchSnapshot()
    })
})