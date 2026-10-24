import { setImmediate } from "node:timers";
import { isMainThread, Worker, workerData } from "node:worker_threads";

if (isMainThread && process.argv[3] === "worker") {
  const worker = new Worker(import.meta.filename, { workerData: process.argv[2] });
  worker.on("error", error => {
    console.error(error);
    process.exitCode = 1;
  });
  worker.on("exit", code => {
    if (code) process.exitCode = code;
  });
} else {
  const kind = workerData || process.argv[2] || "bun";
  const collect =
    kind === "bun" ? () => Bun.gc(true) : kind === "global" ? () => gc() : (await import("bun:jsc"))[kind];
  const collectOutsideJob = () =>
    new Promise(resolve =>
      setImmediate(() => {
        collect();
        resolve();
      }),
    );
  class DetailPayload {}
  const functions = [];
  function make(iteration) {
    const owner = { value: { points: [new DetailPayload()] } };
    const weak = new WeakRef(owner.value.points[0]);
    // Keep the executable alive while its OSR plan holds the former owner's value.
    const hot = new Function(
      "value",
      `let n = 0; for (let j = 0; j < 10000; j++) n += value.points.length + j; return n; // ${iteration}`,
    );
    functions.push(hot);
    hot(owner.value);
    owner.value = null;
    return weak;
  }
  const failures = [];
  for (let iteration = 0; iteration < 300; iteration++) {
    const weak = make(iteration);
    await collectOutsideJob();
    if (weak.deref() !== undefined) failures.push(iteration);
  }
  console.log(JSON.stringify({ iterations: 300, failures: failures.length, failureIterations: failures }));
  if (failures.length) process.exitCode = 1;
}
