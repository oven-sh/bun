import {
    describe,
    expect,
    it,
  } from "bun:test";

describe("test generic snapshot tests", () => {
    describe("inner",() => {
        it("test single snapshot test", () => {
            expect("hello").toMatchSnapshot()
        })
    })
    it("test two snapshot tests", () => {
        expect("hello").toMatchSnapshot()
        expect("hi there").toMatchSnapshot()
    })
})
