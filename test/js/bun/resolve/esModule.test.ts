import { expect, test } from "bun:test";

// Top-level `await import(self)` is a spec-level deadlock under the new
// pure-C++ module loader (Node prints an "unsettled top-level await" warning
// and exits). A static self-import yields the same namespace object without
// blocking evaluation on itself.
import * as Self from "./esModule.test.ts";

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
