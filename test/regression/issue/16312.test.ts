import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";

expect.extend(matchers);
afterEach(() => {
  cleanup();
});

test("expect extended", () => {
  // @ts-ignore
  expect(expect.toBeInTheDocument).not.toBe(undefined);
});
