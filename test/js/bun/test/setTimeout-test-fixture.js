import { setTimeout, test, expect, beforeAll } from "bun:test";

beforeAll(() => {
  setTimeout(100);
});

test("test 1", async () => {
  await Bun.sleep(200);
  expect().pass();
}, 2000);

test("test 2", async () => {
  await Bun.sleep(10);
  expect().pass();
});
