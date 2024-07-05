// Installing a custom uncaughtException handler should override the default
// one that the cluster module installs.
// https://github.com/joyent/node/issues/2556

const assert = require("assert");
const cluster = require("cluster");
const fork = require("child_process").fork;

const MAGIC_EXIT_CODE = 42;

const isTestRunner = process.argv[2] !== "child";

if (isTestRunner) {
  const primary = fork(__filename, ["child"]);
  primary.on("exit", code => {
    assert.strictEqual(code, MAGIC_EXIT_CODE);
  });
} else if (cluster.isPrimary) {
  process.on("uncaughtException", () => {
    process.nextTick(() => process.exit(MAGIC_EXIT_CODE));
  });
  cluster.fork();
  throw new Error("kill primary");
} else {
  // worker
  process.exit();
}
