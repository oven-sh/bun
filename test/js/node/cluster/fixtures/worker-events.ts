const assert = require("assert");
const cluster = require("cluster");

const OK = 2;

if (cluster.isPrimary) {
  const worker = cluster.fork();

  worker.on("exit", code => {
    assert.strictEqual(code, OK);
    process.exit(0);
  });

  const result = worker.send("SOME MESSAGE");
  assert.strictEqual(result, true);

  return;
}

// Messages sent to a worker will be emitted on both the process object and the
// process.worker object.

assert(cluster.isWorker);

let sawProcess;
let sawWorker;

const messages = [];

const check = m => {
  messages.push(m);

  if (messages.length < 2) return;

  assert.deepStrictEqual(messages[0], messages[1]);

  cluster.worker.once("error", e => {
    assert.strictEqual(e, "HI");
    process.exit(OK);
  });

  process.emit("error", "HI");
};

process.on("message", m => {
  assert(!sawProcess);
  sawProcess = true;
  check(m);
});

cluster.worker.on("message", m => {
  assert(!sawWorker);
  sawWorker = true;
  check(m);
});
