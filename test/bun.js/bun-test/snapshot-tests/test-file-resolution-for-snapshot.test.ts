import {
    describe,
    expect,
    it,
  } from "bun:test";
import { readFileSync } from "fs";

describe("test snapshot resolution", () => {
    it("snap file should match", () => {
        expect("should match").toMatchSnapshot()
    })
    it("a", () => {
        expect("should match").toMatchSnapshot()
        expect("should match this too").toMatchSnapshot()
    })
})

describe("test format of snapshot", () => {
    it("snapshot file should be properly fomatted", () => {
        const data = readFileSync(import.meta.dir + "/__snapshots__/test-file-resolution-for-snapshot.snap");
        
        const expected = [
            "exports[`a 1`] = `should match`;",
            "exports[`a 2`] = `should match this too`;",
            "exports[`snap file should match 1`] = `should match`;",
            ""
        ]
        expected.forEach((v, i) => {
            expect(v).toBe(expected[i])
        })
    })
})