import { test, describe, beforeEach } from "bun:test";

function sleep(n: number) {
  // if this test is flaky, increase the number 10
  return new Promise(r => setTimeout(r, 10 * n));
}

test("test 1", async () => {
  console.log("[0] start test 1");
  await sleep(1);
  console.log("[1] end test 1");
  console.log("--- concurrent boundary ---");
});
test.concurrent("test 2", async () => {
  console.log("[0] start test 2");
  await sleep(1);
  console.log("[1] end test 2");
});
test.concurrent("test 3", async () => {
  console.log("[0] start test 3");
  await sleep(2);
  console.log("[2] end test 3");
});
test("test 4", () => {
  console.log("--- concurrent boundary ---");
});
test.concurrent("test 5", async () => {
  console.log("[0] start test 5");
  await sleep(1);
  console.log("[1] end test 5");
});
test.concurrent("test 6", async () => {
  console.log("[0] start test 6");
  await sleep(2);
  console.log("[2] end test 6");
});

describe.concurrent("describe group 7", () => {
  beforeEach(async () => {
    console.log("[0] start before test 7");
    await sleep(3);
    console.log("[3] end before test 7");
  });

  test("test 7", async () => {
    console.log("[3] start test 7");
    await sleep(1);
    console.log("[4] end test 7");
  });
});
describe("describe group 8", () => {
  test.concurrent("test 8", async () => {
    console.log("[0] start test 8");
    await sleep(5);
    console.log("[5] end test 8");
  });
});

/*
Vitest order is:

[1] [2,3] [4] [5,6,7] [8]

Our order is:

[1] [2,3] [4] [5,6,7,8]
*/
