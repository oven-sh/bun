import assert from "node:assert";
import { Worker } from "node:worker_threads";

// parent thread needs to have nonempty execArgv, otherwise the test is faulty
assert(process.execArgv.length > 0);

const execArgvToPass = JSON.parse(process.argv[2]);
new Worker("console.log(JSON.stringify(process.execArgv));", { eval: true, execArgv: execArgvToPass }).on(
  "error",
  e => {
    throw e;
  },
);
