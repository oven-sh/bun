const { test, after } = require("node:test");

// Run with --retry: the first attempt fails for an error thrown outside its
// promise while a subtest is pending. The retry must start after the first
// attempt has wound down, and from a clean test, not from what the first
// attempt left behind (finished, one failed subtest, its t.after hook).
const log = [];
let attempts = 0;

test("flaky parent", async t => {
  const attempt = ++attempts;
  log.push(`attempt ${attempt} start`);
  t.after(() => log.push(`t.after of attempt ${attempt}`));
  await t.test("child", async () => {
    const { promise, resolve } = Promise.withResolvers();
    setTimeout(() => {
      setTimeout(resolve, 1);
      if (attempt === 1) throw new Error("thrown in the first attempt");
    }, 1);
    await promise;
  });
});

after(() => console.log("ORDER=" + JSON.stringify(log)));
