import cluster from "node:cluster";
import assert from "node:assert";
import { tmpdirSync } from "../common";

if (cluster.isPrimary) {
  const x = tmpdirSync();

  assert.strictEqual(cluster.settings.cwd, undefined);
  cluster.fork().on("message", msg => {
    assert.strictEqual(msg, process.cwd());
  });

  cluster.setupPrimary({ cwd: x });
  assert.strictEqual(cluster.settings.cwd, x);
  cluster.fork().on("message", msg => {
    assert.strictEqual(msg, x);
  });
} else {
  process.send(process.cwd());
  process.disconnect();
}
