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

test("require of self sets __esModule", () => {
  expect(Self.__esModule).toBeUndefined();
  {
    const Self = require("./esModule.test.ts");
    expect(Self.__esModule).toBe(true);
  }
  expect(Self.__esModule).toBe(true);
  expect(Object.getOwnPropertyNames(Self)).toBeEmpty();
});
