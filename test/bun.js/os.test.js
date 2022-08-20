import { describe, it, expect } from "bun:test";
import * as os from "node:os";

it("arch", () => {
    expect(["x64", "x86", "arm64"].some(arch => os.arch() === arch)).toBe(true);
});

it("homedir", () => {
    expect(os.homedir() !== "unknown").toBe(true);
});

it("hostname", () => {
    expect(os.hostname() !== "unknown").toBe(true);
});

it("platform", () => {
    expect(["win32", "darwin", "linux", "wasm"].some(platform => os.platform() === platform)).toBe(true);
});

it("type", () => {
    expect(["Windows_NT", "Darwin", "Linux"].some(type => os.type() === type)).toBe(true);
});