// Runs one scenario of node-pty.test.ts and prints its result as one line of JSON.
import { spawn } from "@lydell/node-pty";
import { createHash } from "node:crypto";

const scenario = process.argv[2];
const say = (result: object) => console.log(JSON.stringify(result));

if (scenario === "shell") {
  // https://github.com/oven-sh/bun/issues/25822: a shell that is written to, resized and left.
  const shell = spawn("sh", [], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    env: process.env as Record<string, string>,
  });
  let output = "";
  let resized = false;
  shell.onData(data => {
    output += data;
    // The typed command is echoed with its $((...)) in it. Only its output has the sum.
    if (resized || !output.includes("sum=123")) return;
    resized = true;
    shell.resize(100, 30);
    shell.write("exit\n");
  });
  shell.onExit(exit => say({ sawOutput: output.includes("sum=123"), exit, cols: shell.cols, rows: shell.rows }));
  shell.write("echo sum=$((100+23))\n");
} else if (scenario === "flow") {
  // A consumer that stops the stream around every chunk: the output and the end of the child must both arrive.
  // node-pty destroys its socket 200 ms after the child exits, read or not: the child waits until its last line is here.
  const child = spawn("sh", ["-c", "stty -onlcr -echo; seq 1 20000; read ack"], { cols: 80, rows: 24 });
  const hash = createHash("sha256");
  let bytes = 0;
  let tail = "";
  child.onData(data => {
    bytes += Buffer.byteLength(data);
    hash.update(data);
    tail = (tail + data).slice(-6);
    if (tail === "20000\n") child.write("\n");
    child.pause();
    setImmediate(() => child.resume());
  });
  child.onExit(exit => say({ bytes, sha256: hash.digest("hex"), exit }));
} else {
  throw new Error(`unknown scenario ${scenario}`);
}
