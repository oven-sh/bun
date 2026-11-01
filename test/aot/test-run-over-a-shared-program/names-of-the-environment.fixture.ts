import { expect } from "bun:test";
import { afterEach, test } from "../harness/declare";
import { atLoad, isProduction } from "./environment";

const before = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = before;
  delete process.env.BUN_ENV;
});

test("what is stored in process.env.NODE_ENV is what the name reads, here and in a file of the shared program", () => {
  expect(atLoad).toBe(before);
  expect(isProduction()).toBe(false);
  process.env.NODE_ENV = "production";
  expect(process.env.NODE_ENV).toBe("production");
  expect(process.env["NODE_ENV"]).toBe("production");
  expect(isProduction()).toBe(true);
});

test("process.env.NODE_ENV can be deleted", () => {
  delete process.env.NODE_ENV;
  expect(process.env.NODE_ENV).toBeUndefined();
  expect("NODE_ENV" in process.env).toBe(false);
});

test("what is stored in process.env.BUN_ENV is what the name reads", () => {
  expect(process.env.BUN_ENV).toBeUndefined();
  process.env.BUN_ENV = "staging";
  expect(process.env.BUN_ENV).toBe("staging");
});
