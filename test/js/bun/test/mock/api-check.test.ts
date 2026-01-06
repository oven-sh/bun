import { expect, mock, test } from "bun:test";

test("mock object has restore method", () => {
  expect(mock).toHaveProperty("restore");
  expect(typeof mock.restore).toBe("function");
});

test("mock object has restoreModule method", () => {
  expect(mock).toHaveProperty("restoreModule");
  expect(typeof mock.restoreModule).toBe("function");
});

test("mock object has module method", () => {
  expect(mock).toHaveProperty("module");
  expect(typeof mock.module).toBe("function");
});

test("can call mock.restoreModule without crashing", () => {
  expect(() => {
    mock.restoreModule();
  }).not.toThrow();
});

test("can call mock.restoreModule with path without crashing", () => {
  expect(() => {
    mock.restoreModule("./some-module");
  }).not.toThrow();
});

test("can call mock.restore without crashing", () => {
  expect(() => {
    mock.restore();
  }).not.toThrow();
});
