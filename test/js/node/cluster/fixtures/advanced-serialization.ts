"use strict";
const assert = require("node:assert");
const cluster = require("node:cluster");

if (cluster.isPrimary) {
  cluster.settings.serialization = "advanced";
  const worker = cluster.fork();
  const circular = {};
  circular.circular = circular;

  worker.on("online", () => {
    worker.send(circular);

    worker.on("message", msg => {
      assert.deepStrictEqual(msg, circular);
      worker.kill();
    });
  });
} else {
  process.on("message", msg => process.send(msg));
}
