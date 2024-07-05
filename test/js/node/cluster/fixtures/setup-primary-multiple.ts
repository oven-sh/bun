const assert = require("assert");
const cluster = require("cluster");
const debug = console.log;

assert(cluster.isPrimary);

// The cluster.settings object is cloned even though the current implementation
// makes that unnecessary. This is to make the test less fragile if the
// implementation ever changes such that cluster.settings is mutated instead of
// replaced.
const cheapClone = obj => JSON.parse(JSON.stringify(obj));

const configs = [];

// Capture changes
cluster.on("setup", () => {
  debug(`"setup" emitted ${JSON.stringify(cluster.settings)}`);
  configs.push(cheapClone(cluster.settings));
});

const execs = ["node-next", "node-next-2", "node-next-3"];

process.on("exit", () => {
  // Tests that "setup" is emitted for every call to setupPrimary
  assert.strictEqual(configs.length, execs.length);

  assert.strictEqual(configs[0].exec, execs[0]);
  assert.strictEqual(configs[1].exec, execs[1]);
  assert.strictEqual(configs[2].exec, execs[2]);
});

// Make changes to cluster settings
execs.forEach((v, i) => {
  setTimeout(() => {
    cluster.setupPrimary({ exec: v });
  }, i * 100);
});

// Cluster emits 'setup' asynchronously, so we must stay alive long
// enough for that to happen
setTimeout(
  () => {
    debug("cluster setup complete");
  },
  (execs.length + 1) * 100,
);
