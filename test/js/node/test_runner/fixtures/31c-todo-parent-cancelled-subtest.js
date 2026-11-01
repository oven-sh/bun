// node-test.test.ts runs this with `--todo`. Below a todo test every test is
// todo in Node, and a todo test is not counted as cancelled: node v26.3.0
// prints "todo 4", "cancelled 0" and exits 0. Both parents pass, which
// `bun test --todo` reports as a failure of a todo test.
const { test } = require("node:test");

const never = () => new Promise(() => {});

test.todo("test.todo()", async t => {
  await t.test("subtest", { timeout: 50, expectFailure: true }, never);
});

test("todo option", { todo: true }, async t => {
  await t.test("subtest", { timeout: 50, expectFailure: true }, never);
});
