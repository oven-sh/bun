const { fork } = require("node:child_process");
const path = require("node:path");

const child = fork(path.join(__dirname, "child-process-ipc-node-cluster-child.js"));
const got = [];
const done = () => {
  if (got.length === 2) {
    console.log(JSON.stringify(got));
    child.kill();
    process.exit(0);
  }
};
child.on("message", m => {
  got.push(["message", m]);
  done();
});
child.on("internalMessage", m => {
  got.push(["internalMessage", m]);
  done();
});
setTimeout(() => {
  console.log("TIMEOUT:" + JSON.stringify(got));
  process.exit(1);
}, 10000);
