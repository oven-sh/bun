import { afterAll, afterEach, beforeAll, beforeEach, describe, test } from "bun:test";

for (let suffix of ["TEST-FILE"]) {
  for (let fn of [
    ["beforeAll", beforeAll],
    ["afterAll", afterAll],
    ["afterEach", afterEach],
    ["beforeEach", beforeEach],
  ]) {
    fn[1](() => console.log(fn[0] + ":", suffix));
  }
}

describe("one describe scope", () => {
  beforeAll(() => console.log("beforeAll: one describe scope"));
  afterAll(() => console.log("afterAll: one describe scope"));
  beforeEach(() => console.log("beforeEach: one describe scope"));
  afterEach(() => console.log("afterEach: one describe scope"));

  test("inside one describe scope", () => {
    console.log("-- inside one describe scope --");
  });
});

test("the top-level test", () => {
  console.log("-- the top-level test --");
});
