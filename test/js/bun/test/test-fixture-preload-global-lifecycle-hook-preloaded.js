import { beforeAll, afterAll, afterEach, beforeEach } from "bun:test";

for (let suffix of ["#1", "#2"]) {
  for (let fn of [
    ["beforeAll", beforeAll],
    ["afterAll", afterAll],
    ["afterEach", afterEach],
    ["beforeEach", beforeEach],
  ]) {
    fn[1](() => console.log(fn[0] + ":", suffix));
  }
}
