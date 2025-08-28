import { test, describe, beforeAll } from "bun:test";

function sleep(n: number) {
  return new Promise(r => setTimeout(r, 100 * n));
}

test("test 1", async () => {
  console.log("start test 1");
  await sleep(1);
  console.log("end test 1");
});
test.concurrent("test 2", async () => {
  console.log("start test 2");
  await sleep(1);
  console.log("end test 2");
});
test.concurrent("test 3", async () => {
  console.log("start test 3");
  await sleep(2);
  console.log("end test 3");
});
test("test 4", () => {
  console.log("--- concurrent boundary ---");
});
test.concurrent("test 5", async () => {
  console.log("start test 5");
  await sleep(1);
  console.log("end test 5");
});
test.concurrent("test 6", async () => {
  console.log("start test 6");
  await sleep(2);
  console.log("end test 6");
});

describe.concurrent("describe group 7", () => {
  beforeAll(async () => {
    console.log("start before test 7");
    await sleep(3);
    console.log("end before test 7");
  });

  test("test 7", async () => {
    console.log("start test 7");
    await sleep(1);
    console.log("end test 7");
  });
});
describe("describe group 8", () => {
  test.concurrent("test 8", async () => {
    console.log("start test 8");
    await sleep(5);
    console.log("end test 8");
  });
});

/*
Vitest order is:

[1] [2,3] [4] [5,6,7] [8]

Our order is:

[1] [2,3] [4] [5,6,7,8]
*/
