beforeEach(() => {
  console.log("beforeEach");
});
afterEach(() => {
  console.log("afterEach");
});
test.concurrent("test 1", () => {
  console.log("start test 1");
});
test.concurrent("test 2", () => {
  throw new Error("test 2 error");
});
test.concurrent("test 3", () => {
  console.log("start test 3");
});
