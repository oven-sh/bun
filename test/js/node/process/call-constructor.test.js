import { expect, test } from "bun:test";
import process from "process";

test("the constructor of process can be called", () => {
  let obj = process.constructor.call({ ...process });
  expect(Object.getPrototypeOf(obj)).toEqual(Object.getPrototypeOf(process));
});
