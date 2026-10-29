// The ESM entry of worker-stdio-first-turn-fixture.cjs: the same cells behind a static import, and
// the two that need a top-level await.
import { workerData } from "node:worker_threads";
import fixture from "./worker-stdio-first-turn-fixture.cjs";

if (workerData.cell === "awaitsCallback") {
  const { report, write } = fixture.begin();
  await new Promise(resolve => write(resolve));
  report();
} else if (workerData.cell === "afterAwait") {
  const { writeThenReport } = fixture.begin();
  await new Promise(resolve => setImmediate(resolve));
  writeThenReport();
} else {
  fixture.workerMain();
}
