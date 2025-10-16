import { expect, test } from "bun:test";

const Self = await import("./esModule.test.ts");

test("__esModule defaults to undefined", () => {
  expect(Self.__esModule).toBeUndefined();
});

test("__esModule is settable", () => {
  Self.__esModule = true;
  expect(Self.__esModule).toBe(true);
  Self.__esModule = false;
  expect(Self.__esModule).toBe(undefined);
  Self.__esModule = true;
  expect(Self.__esModule).toBe(true);
  Self.__esModule = undefined;
});

test("require of self does NOT automatically set __esModule", () => {
  expect(Self.__esModule).toBeUndefined();
  {
    const Self = require("./esModule.test.ts");
    // With new behavior, __esModule is not automatically added
    expect(Self.__esModule).toBeUndefined();
  }
  // __esModule remains undefined since it's not automatically added
  expect(Self.__esModule).toBeUndefined();
  expect(Object.getOwnPropertyNames(Self)).toBeEmpty();
});
