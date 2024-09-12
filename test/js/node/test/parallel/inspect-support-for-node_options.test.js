//#FILE: test-inspect-support-for-node_options.js
//#SHA1: 622a8cb07922833373b0d88c42c2a7bbfdc7d58e
//-----------------
"use strict";

const cluster = require("cluster");

// Skip if inspector is disabled
if (process.config.variables.v8_enable_inspector === 0) {
  test.skip("Inspector is disabled", () => {});
} else {
  checkForInspectSupport("--inspect");
}

function checkForInspectSupport(flag) {
  const nodeOptions = JSON.stringify(flag);
  const numWorkers = 2;
  process.env.NODE_OPTIONS = flag;

  test(`Cluster support for NODE_OPTIONS ${nodeOptions}`, () => {
    if (cluster.isPrimary) {
      const workerExitPromises = [];

      for (let i = 0; i < numWorkers; i++) {
        const worker = cluster.fork();

        worker.on("online", () => {
          worker.disconnect();
        });

        workerExitPromises.push(
          new Promise(resolve => {
            worker.on("exit", (code, signal) => {
              expect(worker.exitedAfterDisconnect).toBe(true);
              resolve();
            });
          }),
        );
      }

      return Promise.all(workerExitPromises);
    }
  });
}

//<#END_FILE: test-inspect-support-for-node_options.js
