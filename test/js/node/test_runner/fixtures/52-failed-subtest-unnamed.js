// A name that is not a string cannot be joined into a name path. The parent
// must still fail, with the error that counts its failed subtests.
const { test } = require("node:test");

test("parent", async t => {
  const unnamed = () => {
    throw new Error("kid" + " error");
  };
  Object.defineProperty(unnamed, "name", { value: Symbol("kid") });
  await t.test(unnamed);
});
