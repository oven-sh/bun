import {
    describe,
    expect,
    it,
  } from "bun:test";

describe("test hint", () => {
    it("hint should be well formatted", () => {
        expect("do not use a hint").toMatchSnapshot()
        expect("some string").toMatchSnapshot("using a hint")
    })
})
