import { test, afterEach, expect } from "bun:test";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);
afterEach(() => {
  cleanup();
});

test("expect extended", () => {
  // @ts-ignore
  expect(expect.toBeInTheDocument).not.toBe(undefined);
});
