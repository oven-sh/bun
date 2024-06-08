import { test, expect } from "bun:test";

test("toContainKeys empty", () => {
  expect({ "": 1 }).toContainKeys([""]);
});

test("NOT toContainKeys empty", () => {
  expect({}).not.toContainKeys([""]);
});

test("NOT toContainAnyKeys string empty", () => {
  expect({}).not.toContainAnyKeys([""]);
});

test("toContainAnyKeys true string empty", () => {
  expect({ "": 1 }).toContainAnyKeys([""]);
});

test("toContainAnyKeys holey", () => {
  expect([,]).not.toContainAnyKeys([,]);
});

test("NOT toContainAnyKeysEmpty", () => {
  expect({}).not.toContainAnyKeys([]);
});
