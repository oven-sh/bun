import { expect, test } from "bun:test";

test("expect.soft continues after failure", () => {
  let counter = 0;

  expect.soft(1 + 1).toBe(3); // should fail but continue
  counter++;

  expect.soft(2 + 2).toBe(5); // should fail but continue
  counter++;

  expect(counter).toBe(2); // should pass - proves execution continued
});

test("expect.soft with all passing assertions", () => {
  expect.soft(1 + 1).toBe(2); // should pass
  expect.soft(2 + 2).toBe(4); // should pass
  expect(3 + 3).toBe(6); // should pass
});

test("expect.soft then hard expect fails", () => {
  expect.soft(1 + 1).toBe(3); // should fail but continue
  expect(2 + 2).toBe(5); // should fail and stop
  expect.soft(3 + 3).toBe(7); // should not run
});

test("expect.soft with .not", () => {
  expect.soft.not(1 + 1).toBe(3); // should pass
  expect.soft.not(2 + 2).toBe(4); // should fail but continue
  expect(true).toBe(true); // marker that we got here
});

test("multiple expect.soft failures are all reported", () => {
  expect.soft(1).toBe(2);
  expect.soft(3).toBe(4);
  expect.soft(5).toBe(6);
  // All three failures should be reported at the end
});
