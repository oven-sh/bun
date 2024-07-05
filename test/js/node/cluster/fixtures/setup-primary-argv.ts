const assert = require("assert");
const cluster = require("cluster");
import { mustNotCall } from "../common";

setTimeout(mustNotCall("setup not emitted"), 1000).unref();

cluster.on("setup", function () {
  const clusterArgs = cluster.settings.args;
  const realArgs = process.argv;
  assert.strictEqual(clusterArgs[clusterArgs.length - 1], realArgs[realArgs.length - 1]);
});

assert.notStrictEqual(process.argv[process.argv.length - 1], "OMG,OMG");
process.argv.push("OMG,OMG");
process.argv.push("OMG,OMG");
cluster.setupPrimary();
