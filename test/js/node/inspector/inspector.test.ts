import { expect, test } from "bun:test";
import inspector from "node:inspector";

test("inspector.url()", () => {
  expect(inspector.url()).toBeUndefined();
});

test("inspector.console", () => {
  expect(inspector.console).toBeObject();
});

test("inspector.open()", () => {
  expect(() => inspector.open()).toThrow(/not yet implemented/);
});

test("inspector.close()", () => {
  expect(() => inspector.close()).toThrow(/not yet implemented/);
});

test("inspector.waitForDebugger()", () => {
  expect(() => inspector.waitForDebugger()).toThrow(/not yet implemented/);
});
