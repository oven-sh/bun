import assert from "assert";
import util, { inspect } from "util";

test("no assertion failures", () => {
  assert.strictEqual(typeof util.inspect, "function");
  assert.strictEqual(util.inspect, inspect);
  assert.strictEqual(util.inspect(null), "null");
  assert.strictEqual(util.inspect({ a: 1 }, { compact: false }), "{\n  a: 1\n}");
});
