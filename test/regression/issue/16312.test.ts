import * as matchers from "@testing-library/jest-dom/matchers";
import testingLibraryReact from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
const { cleanup } = testingLibraryReact;

expect.extend(matchers);
afterEach(() => {
  cleanup();
});

test("expect extended", () => {
  // @ts-ignore
  expect(expect.toBeInTheDocument).not.toBe(undefined);
});
