const assert = require("assert");
const cluster = require("cluster");

assert(cluster.isPrimary);

// cluster.settings should not be initialized until needed
assert.deepStrictEqual(cluster.settings, {});

cluster.setupPrimary();
assert.deepStrictEqual(cluster.settings, {
  args: process.argv.slice(2),
  exec: process.argv[1],
  execArgv: process.execArgv,
  silent: false,
});
console.log("ok sets defaults");

cluster.setupPrimary({ exec: "overridden" });
assert.strictEqual(cluster.settings.exec, "overridden");
console.log("ok overrides defaults");

cluster.setupPrimary({ args: ["foo", "bar"] });
assert.strictEqual(cluster.settings.exec, "overridden");
assert.deepStrictEqual(cluster.settings.args, ["foo", "bar"]);

cluster.setupPrimary({ execArgv: ["baz", "bang"] });
assert.strictEqual(cluster.settings.exec, "overridden");
assert.deepStrictEqual(cluster.settings.args, ["foo", "bar"]);
assert.deepStrictEqual(cluster.settings.execArgv, ["baz", "bang"]);
console.log("ok preserves unchanged settings on repeated calls");

cluster.setupPrimary();
assert.deepStrictEqual(cluster.settings, {
  args: ["foo", "bar"],
  exec: "overridden",
  execArgv: ["baz", "bang"],
  silent: false,
});
console.log("ok preserves current settings");
