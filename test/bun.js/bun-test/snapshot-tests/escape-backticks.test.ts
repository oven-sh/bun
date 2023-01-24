import {
    describe,
    expect,
    it,
  } from "bun:test";
import { readFileSync } from "fs";

describe("test bun-test escapes backticks correctly", () => {
    it("`escape backticks`", () => {
        expect("escape the ` backtick!").toMatchSnapshot()
    })
})

describe("test format of snapshot", () => {
    it("snapshot file should be properly fomatted", () => {
        const data = readFileSync(import.meta.dir + "/__snapshots__/escape-backticks.test.ts.snap");
        
        const expected = [
            "// Jest Snapshot v1, https://goo.gl/fbAQLP",
            "exports[`test bun-test escapes backticks correctly \`escape backticks\` 1`] = `escape the \` backtick!`;",
            ""
        ]
        expected.forEach((v, i) => {
            expect(v).toBe(expected[i])
        })
    })
})
