import { expect, test } from "bun:test";
import process from "process";

test("the constructor of process can be called", () => {
  // As in node: a call returns the object that it was called on, and `new` creates an object that has the
  // prototype of process.
  const receiver = { ...process };
  expect(process.constructor.call(receiver)).toBe(receiver);
  expect(Object.getPrototypeOf(new process.constructor())).toBe(Object.getPrototypeOf(process));
  expect(process.constructor.name).toBe("process");
});

test("#14346", () => {
  process.__proto__.constructor.call({});
});
