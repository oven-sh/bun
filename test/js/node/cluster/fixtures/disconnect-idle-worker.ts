const assert = require("assert");
const cluster = require("cluster");
const fork = cluster.fork;

if (cluster.isPrimary) {
  fork(); // It is intentionally called `fork` instead of
  fork(); // `cluster.fork` to test that `this` is not used
  cluster.disconnect(() => {
    assert.deepStrictEqual(Object.keys(cluster.workers), []);
  });
}
