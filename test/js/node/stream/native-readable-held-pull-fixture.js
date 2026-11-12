// <mode> <hex chunk>...: a producer, or a reader that paces it through marker files in the working directory.
const fs = require("node:fs");

const [mode, ...chunks] = process.argv.slice(2);
const deadline = Date.now() + 15_000;
function waitFor(marker) {
  while (!fs.existsSync(marker)) {
    if (Date.now() > deadline) throw new Error(mode + " timed out waiting for " + marker);
    Bun.sleepSync(1);
  }
}
// Returns once chunk i is in the pipe. The producer is still alive (no EOF) until exit().
function write(i) {
  fs.writeFileSync("write-" + i, "");
  waitFor("wrote-" + i);
}
const exit = () => fs.writeFileSync("exit", "");
const producer = [__filename, "producer", ...chunks];
// Each push as [bytes, made inside _read()], and null for EOF.
function recordPushes(stream, pushed, afterPush) {
  const push = stream.push;
  stream.push = function (chunk) {
    const insideRead = this._readableState.sync;
    const more = push.call(this, chunk);
    pushed.push(chunk === null ? null : [chunk.length, insideRead]);
    afterPush?.();
    return more;
  };
}

if (mode === "producer") {
  chunks.forEach((hex, i) => {
    waitFor("write-" + i);
    fs.writeSync(1, Buffer.from(hex, "hex"));
    fs.writeFileSync("wrote-" + i, "");
  });
  waitFor("exit");
} else if (mode === "execFile") {
  const seen = { pushed: [], callback: null, close: 0 };
  const child = require("node:child_process").execFile(process.execPath, producer, (error, stdout, stderr) => {
    seen.callback = { error: error ? error.message : null, stdout, stderr };
  });
  // 'resume' follows the stream's first read(), which found the pipe empty: chunk 0 settles it.
  child.stdout.once("resume", () => write(0));
  recordPushes(child.stdout, seen.pushed, () => {
    // The pull that follows the push of a chunk finds the next one. After the last one: EOF.
    if (seen.pushed.length < chunks.length) write(seen.pushed.length);
    else if (seen.pushed.length === chunks.length) setImmediate(exit);
  });
  child.on("close", () => seen.close++);
  process.on("exit", () => console.log(JSON.stringify(seen)));
} else if (mode === "fromWeb") {
  const child = Bun.spawn({ cmd: [process.execPath, ...producer], stdio: ["ignore", "pipe", "inherit"] });
  const stream = require("node:stream").Readable.fromWeb(child.stdout, { highWaterMark: 0 });
  stream.setEncoding("utf8");
  const seen = { pushed: [], text: "", end: 0 };
  recordPushes(stream, seen.pushed);
  stream.on("readable", () => {
    let text;
    while ((text = stream.read()) !== null) {
      if (seen.text === "") {
        // The read() that follows pulls chunk 1. After that pull: the rest, then EOF.
        write(1);
        setImmediate(() => {
          for (let i = 2; i < chunks.length; i++) write(i);
          exit();
        });
      }
      seen.text += text;
    }
  });
  stream.on("end", () => seen.end++);
  // The stream's first read() was made a tick ago and found the pipe empty, so chunk 0 settles it.
  setImmediate(() => write(0));
  process.on("exit", () => console.log(JSON.stringify(seen)));
}
