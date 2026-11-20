// Three tools that never read their stdin close it while their parent is still in the turn that called end().
// What the parent gave is in the pipe by then only if end() sends inside the call.
// If it does, the stream finishes. If the bytes wait for a later tick, the write fails with EPIPE.
// `node stdin-send-in-call-fixture.js <go fifo> <done fifo>` prints what Node.js does.
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const [, , goFifo, doneFifo] = process.argv;

// The tool waits for a line on fd 3, closes its stdin unread, and says so on its stdout.
const tool = "read go <&3; exec 0<&-; echo closed";

const ways = {
  "end(chunk)": stdin => stdin.end("input\n"),
  "end(16 KiB)": stdin => stdin.end(Buffer.alloc(16 * 1024, "x")),
  "write(chunk); end()": stdin => {
    stdin.write("input\n");
    stdin.end();
  },
};

// Resolves with the events of each child's stdin, then the child's exit code.
function run() {
  const { promise, resolve } = Promise.withResolvers();
  const names = Object.keys(ways);
  // "r+" does not wait for the other end of a fifo, and with one end open "r" does not wait either.
  const go = fs.openSync(goFifo, "r+");
  // The end that the tools get only reads: a tool sees the end of the fifo if this process goes away first.
  const goRead = fs.openSync(goFifo, "r");
  const doneWrite = fs.openSync(doneFifo, "r+");
  const done = fs.openSync(doneFifo, "r");

  const logs = {};
  let running = names.length;
  for (const name of names) {
    const child = spawn("/bin/sh", ["-c", tool], { stdio: ["pipe", doneWrite, "inherit", goRead] });
    const log = (logs[name] = []);
    child.stdin.on("error", err => log.push(`error ${err.code}`));
    child.stdin.on("finish", () => log.push("finish"));
    child.on("close", code => {
      log.push(`close ${code}`);
      if (--running === 0) resolve(logs);
    });
    ways[name](child.stdin);
  }
  fs.closeSync(doneWrite);
  fs.closeSync(goRead);

  // Still in the turn that called end(): let the tools go, and wait until each has closed its stdin.
  fs.writeSync(go, Buffer.alloc(names.length, "\n"));
  const said = "closed\n".length * names.length;
  for (let read = 0; read < said;) {
    const bytes = fs.readSync(done, Buffer.alloc(said));
    if (bytes === 0) throw new Error("a tool went away before it closed its stdin");
    read += bytes;
  }
  fs.closeSync(done);
  fs.closeSync(go);
  return promise;
}

run().then(logs => console.log(JSON.stringify(logs)));
