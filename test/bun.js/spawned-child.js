if (globalThis.Bun) {
  const nodeStream = require("node:stream");
  const nodeFs = require("node:fs");

  // TODO: Remove this polyfill once we have integrated polyfill into runtime init
  const {
    stdin: _stdinInit,
    stdout: _stdoutInit,
    stderr: _stderrInit,
  } = require("../../src/bun.js/process-stdio-polyfill.js");

  function _require(mod) {
    if (mod === "node:stream") return nodeStream;
    if (mod === "node:fs") return nodeFs;
    throw new Error(`Unknown module: ${mod}`);
  }

  process.stdin = _stdinInit({ require: _require });
  process.stdout = _stdoutInit({ require: _require });
  process.stderr = _stderrInit({ require: _require });
}

const TARGET = process.argv[2];
const MODE = process.argv[3];

async function main() {
  if (TARGET === "STDIN") {
    let data = "";
    process.stdin.setEncoding("utf8");
    if (MODE === "READABLE") {
      process.stdin.on("readable", () => {
        let chunk;
        while ((chunk = process.stdin.read()) !== null) {
          data += chunk;
        }
      });
    } else {
      process.stdin.on("data", (chunk) => {
        data += chunk;
      });
    }
    process.stdin.on("end", () => {
      console.log("data:", data);
      process.exit(0);
    });
  } else if (TARGET === "STDOUT") {
    process.stdout.write("stdout_test");
  } else if (TARGET === "TIMER") {
    setTimeout(() => console.log("hello"), 150);
  } else {
    console.log("unknown target! you messed up...");
  }
}

main();
