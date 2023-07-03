import fs from "fs";
import { expect, it } from "bun:test";

it("does not throw for a file that does not exist if throwIfNoEntry is false", async () => {
    expect(() => fs.statSync("file_that_does_not_exist", { throwIfNoEntry: false })).not.toThrow();
});

it("throws for a file that does not exist if throwIfNoEntry is true", async () => {
    expect(() => fs.statSync("file_that_does_not_exist", { throwIfNoEntry: true })).toThrow();
});

it("throws for a file that does not exist with default settings", async () => {
    expect(() => fs.statSync("file_that_does_not_exist")).toThrow();
});
