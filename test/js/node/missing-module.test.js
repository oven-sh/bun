import { expect, test } from "bun:test";

test("not implemented yet module masquerades as undefined and throws an error", () => {
  const missingModule = "node:missing" + "";
  expect(() => require(missingModule)).toThrow(/^Cannot find package "node:missing" from "/);
  expect(() => import(missingModule)).toThrow(/^Cannot find package "node:missing" from "/);
});
