const { test } = require("node:test");

// Run with --retry: the first attempt fails for an error thrown outside its
// promise while a subtest is pending. The retry must start from a clean test,
// not from what the first attempt left behind (finished, one failed subtest).
let attempt = 0;

test("flaky parent", async t => {
  attempt++;
  await t.test("child", async () => {
    const { promise, resolve } = Promise.withResolvers();
    setTimeout(() => {
      setTimeout(resolve, 1);
      if (attempt === 1) throw new Error("thrown in the first attempt");
    }, 1);
    await promise;
  });
});
