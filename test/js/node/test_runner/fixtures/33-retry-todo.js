// Run as a run() child with `--retry 1`. A stray error fails the first attempt of each test after its body
// returned, so bun:test runs the test again. The second attempt has to report the todo of the declaration.
const { test } = require("node:test");

const attempts = {};
function strayErrorOnce(t) {
  if ((attempts[t.name] = (attempts[t.name] ?? 0) + 1) === 1) {
    queueMicrotask(() => {
      throw new Error("a stray error fails the first attempt");
    });
  }
}

test.todo("todo spelling", strayErrorOnce);
test("todo option with a message", { todo: "not yet" }, strayErrorOnce);
