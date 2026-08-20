import { describe, expect, test } from "bun:test";

describe("process.sourceMapsEnabled", () => {
  test("is a boolean accessor", () => {
    expect(typeof process.sourceMapsEnabled).toBe("boolean");
    const descriptor = Object.getOwnPropertyDescriptor(process, "sourceMapsEnabled");
    expect(typeof descriptor?.get).toBe("function");
  });

  test("reflects setSourceMapsEnabled()", () => {
    const original = process.sourceMapsEnabled;
    process.setSourceMapsEnabled(true);
    expect(process.sourceMapsEnabled).toBe(true);
    process.setSourceMapsEnabled(original);
    expect(process.sourceMapsEnabled).toBe(original);
  });
});