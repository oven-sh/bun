// Passes as it is under `node --test --test-only`. In Bun, runOnly() on the context of the file does not change what runs.
const assert = require("node:assert");
const { test, before, after } = require("node:test");

const seen = [];
before(t => t.runOnly(false));
after(() => assert.deepStrictEqual(seen, ["RAN a", "RAN b", "RAN c"]));

test("a", () => seen.push("RAN a"));
test("b", () => seen.push("RAN b"));
test("c", () => seen.push("RAN c"));
