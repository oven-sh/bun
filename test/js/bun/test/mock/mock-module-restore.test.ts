import { describe, expect, mock, spyOn, test } from "bun:test";
import { fn, variable } from "./mock-module-fixture";
import * as spyFixture from "./spymodule-fixture";

describe("mock.module restore", () => {
  test("mock.restore() restores ESM module exports to original values", () => {
    expect(fn()).toBe(42);
    expect(variable).toBe(7);

    mock.module("./mock-module-fixture", () => ({
      fn: () => 999,
      variable: 100,
    }));

    expect(fn()).toBe(999);
    expect(variable).toBe(100);

    mock.restore();

    expect(fn()).toBe(42);
    expect(variable).toBe(7);
  });

  test("re-mocking after restore works", () => {
    expect(fn()).toBe(42);
    expect(variable).toBe(7);

    mock.module("./mock-module-fixture", () => ({
      fn: () => 555,
      variable: 55,
    }));

    expect(fn()).toBe(555);
    expect(variable).toBe(55);

    mock.restore();

    expect(fn()).toBe(42);
    expect(variable).toBe(7);
  });

  test("multiple re-mocks then restore goes back to true originals", () => {
    expect(fn()).toBe(42);
    expect(variable).toBe(7);

    mock.module("./mock-module-fixture", () => ({
      fn: () => 1,
      variable: 1,
    }));
    expect(fn()).toBe(1);

    mock.module("./mock-module-fixture", () => ({
      fn: () => 2,
      variable: 2,
    }));
    expect(fn()).toBe(2);

    mock.module("./mock-module-fixture", () => ({
      fn: () => 3,
      variable: 3,
    }));
    expect(fn()).toBe(3);

    mock.restore();

    expect(fn()).toBe(42);
    expect(variable).toBe(7);
  });

  test("mock.restore() also restores spyOn alongside mock.module", () => {
    const originalSpy = spyFixture.iSpy;

    spyOn(spyFixture, "iSpy");
    expect(spyFixture.iSpy).not.toBe(originalSpy);

    mock.module("./mock-module-fixture", () => ({
      fn: () => 777,
    }));
    expect(fn()).toBe(777);

    mock.restore();

    expect(spyFixture.iSpy).toBe(originalSpy);
    expect(fn()).toBe(42);
  });

  test("mock.restore() restores builtin modules", async () => {
    const origReadFile = (await import("node:fs/promises")).readFile;

    mock.module("fs/promises", () => ({
      readFile: () => Promise.resolve("mocked-content"),
    }));

    const { readFile } = await import("node:fs/promises");
    expect(await readFile("anything")).toBe("mocked-content");

    mock.restore();

    const { readFile: restored } = await import("node:fs/promises");
    expect(restored).toBe(origReadFile);
  });
});
