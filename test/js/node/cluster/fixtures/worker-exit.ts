// verifies that, when a child process exits (by calling `process.exit(code)`)
// - the primary receives the proper events in the proper order, no duplicates
// - the exitCode and signalCode are correct in the 'exit' event
// - the worker.exitedAfterDisconnect flag, and worker.state are correct
// - the worker process actually goes away

const assert = require("assert");
const cluster = require("cluster");
import { isAlive } from "../common";

const EXIT_CODE = 42;

if (cluster.isWorker) {
  const http = require("http");
  const server = http.Server(() => {});

  server.once("listening", () => {
    process.exit(EXIT_CODE);
  });
  server.listen(0, "127.0.0.1");
} else if (cluster.isPrimary) {
  const expected_results = {
    cluster_emitDisconnect: [1, "the cluster did not emit 'disconnect'"],
    cluster_emitExit: [1, "the cluster did not emit 'exit'"],
    cluster_exitCode: [EXIT_CODE, "the cluster exited w/ incorrect exitCode"],
    cluster_signalCode: [null, "the cluster exited w/ incorrect signalCode"],
    worker_emitDisconnect: [1, "the worker did not emit 'disconnect'"],
    worker_emitExit: [1, "the worker did not emit 'exit'"],
    worker_state: ["disconnected", "the worker state is incorrect"],
    worker_exitedAfterDisconnect: [false, "the .exitedAfterDisconnect flag is incorrect"],
    worker_died: [true, "the worker is still running"],
    worker_exitCode: [EXIT_CODE, "the worker exited w/ incorrect exitCode"],
    worker_signalCode: [null, "the worker exited w/ incorrect signalCode"],
  };
  const results: {
    cluster_emitDisconnect: number;
    cluster_emitExit: number;
    worker_emitDisconnect: number;
    worker_emitExit: number;

    cluster_exitCode?: number;
    cluster_signalCode?: number;
    worker_exitedAfterDisconnect?: boolean;
    worker_state?: any;
    worker_exitCode?: number;
    worker_signalCode?: number;
    worker_died?: boolean;
  } = {
    cluster_emitDisconnect: 0,
    cluster_emitExit: 0,
    worker_emitDisconnect: 0,
    worker_emitExit: 0,
  };

  // start worker
  const worker = cluster.fork();

  // Check cluster events
  cluster.on("disconnect", () => {
    results.cluster_emitDisconnect += 1;
  });
  cluster.on("exit", worker => {
    results.cluster_exitCode = worker.process.exitCode;
    results.cluster_signalCode = worker.process.signalCode;
    results.cluster_emitExit += 1;
  });

  // Check worker events and properties
  worker.on("disconnect", () => {
    results.worker_emitDisconnect += 1;
    results.worker_exitedAfterDisconnect = worker.exitedAfterDisconnect;
    results.worker_state = worker.state;
    if (results.worker_emitExit > 0) {
      process.nextTick(() => finish_test());
    }
  });

  // Check that the worker died
  worker.once("exit", (exitCode, signalCode) => {
    results.worker_exitCode = exitCode;
    results.worker_signalCode = signalCode;
    results.worker_emitExit += 1;
    results.worker_died = !isAlive(worker.process.pid);
    if (results.worker_emitDisconnect > 0) {
      process.nextTick(() => finish_test());
    }
  });

  const finish_test = () => {
    try {
      checkResults(expected_results, results);
    } catch (exc) {
      if (exc.name !== "AssertionError") {
        console.trace(exc);
      }

      process.exit(1);
      return;
    }
    process.exit(0);
  };
}

// Some helper functions ...

function checkResults(expected_results, results) {
  for (const k in expected_results) {
    const actual = results[k];
    const expected = expected_results[k];

    assert.strictEqual(
      actual,
      expected && expected.length ? expected[0] : expected,
      `${expected[1] || ""} [expected: ${expected[0]} / actual: ${actual}]`,
    );
  }
}
