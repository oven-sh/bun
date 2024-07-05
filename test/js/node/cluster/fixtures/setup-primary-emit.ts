const assert = require("assert");
const cluster = require("cluster");

assert(cluster.isPrimary);

function emitAndCatch(next) {
  cluster.once("setup", function (settings) {
    assert.strictEqual(settings.exec, "new-exec");
    setImmediate(next);
  });
  cluster.setupPrimary({ exec: "new-exec" });
}

function emitAndCatch2(next) {
  cluster.once("setup", function (settings) {
    assert("exec" in settings);
    setImmediate(next);
  });
  cluster.setupPrimary();
}

emitAndCatch(function () {
  emitAndCatch2(() => {});
});
