const { parentPort } = require("worker_threads");
let i = 0;
while (true) {
  parentPort.postMessage({ i: i++ });
}
