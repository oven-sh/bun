// 17-rerun-mock-reset.mjs as a CommonJS file: --rerun-each evaluates it again too.
const { test, mock } = require("node:test");
const assert = require("node:assert");

globalThis.__rerunTargetCommonJS ??= { greet: () => "real" };
const target = globalThis.__rerunTargetCommonJS;

mock.method(target, "greet", () => "mocked");

test("module-scope mock.method captured the real original across reruns of a CommonJS file", () => {
  assert.strictEqual(target.greet(), "mocked");
  mock.restoreAll();
  assert.strictEqual(target.greet(), "real");
  mock.method(target, "greet", () => "mocked");
});
