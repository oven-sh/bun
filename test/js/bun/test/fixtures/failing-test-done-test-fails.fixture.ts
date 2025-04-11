import { test, expect } from "bun:test";

test.failing("test.failing fails when done is called without an error", done => {
  done();
});

test.failing("test.failing fails when all expectations are met and done is called without an error", done => {
  expect(1).toBe(1);
  done();
});

test.failing(
  "test.failing fails when all expectations are met and done is called from a promise without an error",
  async done => {
    await Bun.sleep(5);
    expect(1).toBe(1);
    done();
  },
);
