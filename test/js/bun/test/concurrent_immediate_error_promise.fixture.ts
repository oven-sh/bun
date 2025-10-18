beforeEach(async () => {
  console.log("beforeEach");
});
afterEach(async () => {
  console.log("afterEach");
});
test.concurrent("test 1", async () => {
  console.log("start test 1");
});
test.concurrent("test 2", async () => {
  throw new Error("test 2 error");
});
test.concurrent("test 3", async () => {
  console.log("start test 3");
});
