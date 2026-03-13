import { test, describe, beforeEach } from "bun:test";

let activeGroup: (() => void)[] = [];
function tick() {
  const { resolve, reject, promise } = Promise.withResolvers();
  activeGroup.push(() => resolve());
  setTimeout(() => {
    activeGroup.shift()?.();
  }, 0);
  return promise;
}

test("test default-1", async () => {
  console.log("[0] start test default-1");
  await tick();
  console.log("[1] end test default-1");
});
test("test default-2", async () => {
  console.log("[0] start test default-2");
  await tick();
  console.log("[1] end test default-2");
});
test.concurrent("test concurrent-1", async () => {
  console.log("[0] start test concurrent-1");
  await tick();
  console.log("[1] end test concurrent-1");
});
test.concurrent("test concurrent-2", async () => {
  console.log("[0] start test concurrent-2");
  await tick();
  console.log("[1] end test concurrent-2");
});
test.serial("test serial-1", async () => {
  console.log("[0] start test serial-1");
  await tick();
  console.log("[1] end test serial-1");
});
test.serial("test serial-2", async () => {
  console.log("[0] start test serial-2");
  await tick();
  console.log("[1] end test serial-2");
});
