const { parentPort } = require("node:worker_threads");
let i = 0;
while (true) {
  parentPort.postMessage({ i: i++ });
}
