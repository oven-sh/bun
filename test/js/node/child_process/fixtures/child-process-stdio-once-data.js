// Prints what a consumer that takes one event at a time gets from a child's stdio stream: one JSON object, with an entry
// for each `<stream>:<form>` argument. Node prints the same object.
//
// usage: <runtime> child-process-stdio-once-data.js <empty scratch dir> <stdout|stderr>:<form>...
//
// form: a loop of `await once(stream, "data")`, and what it does between two `once()` calls
//   job       nothing: the stream has no 'data' listener for the length of one promise job
//   tick      it awaits a promise that a nextTick settles
//   pause     pause(), the same await, resume()
//   beside    as tick, beside a 'data' listener that stays, as exec() and execFile() have one
// or
//   readable  a 'readable' listener that takes all that is buffered with read(n), so read() never returns null
//
// The child writes a head when the parent's first read waits, and a tail of 96 KiB while the listeners of the head run.
// So the tail is in the pipe when the consumer continues, and it does not fit one read of 64 KiB.
//
// For a loop the head is 4 bytes, and the child closes the pipe behind the tail: the EOF is in the pipe too.
// For 'readable' the head is 64 KiB, which fills the buffer of the stream, and the child holds the pipe open until the
// listener has every byte: nothing but a 'readable' event tells it of the tail.
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
const TAIL = 96 * 1024;

const sleeper = new Int32Array(new SharedArrayBuffer(4));
// Blocks the event loop, so that nothing is read or delivered until `file` exists.
function waitFor(file) {
  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${file}`);
    Atomics.wait(sleeper, 0, 0, 1);
  }
}

function consume(which, form, dir) {
  const fd = which === "stdout" ? 1 : 2;
  const HEAD = form === "readable" ? 64 * 1024 : 4;
  fs.writeFileSync(path.join(dir, "head.bin"), Buffer.alloc(HEAD, "h"));
  fs.writeFileSync(path.join(dir, "tail.bin"), Buffer.alloc(TAIL, "t"));
  // A shell script, so that the child starts in a few milliseconds. `$0` is the scratch directory and fd 3 the pipe.
  // dd makes one write() of each part: a socket holds fewer bytes when they come in small writes.
  // wait_for gives up when the parent is gone, so that a run that fails leaves no process behind.
  const producer = `
    cd "$0"
    exec 3>&${fd} ${fd}>/dev/null
    wait_for() { until [ -e "$1" ]; do kill -0 $PPID 2>/dev/null || exit 1; sleep 0.01; done; }
    wait_for head.go
    dd if=head.bin bs=${HEAD} count=1 2>/dev/null >&3
    : > head.done
    wait_for tail.go
    dd if=tail.bin bs=${TAIL} count=1 2>/dev/null >&3
    ${form === "readable" ? `: > tail.done; wait_for close.go` : `exec 3>&-; : > tail.done`}
  `;
  const stdio = ["ignore", "ignore", "ignore"];
  stdio[fd] = "pipe";
  const child = spawn("sh", ["-c", producer, dir], { stdio });
  const stream = child.stdio[fd];

  function writeHead() {
    fs.writeFileSync(path.join(dir, "head.go"), "");
    waitFor(path.join(dir, "head.done"));
  }
  function writeTail() {
    fs.writeFileSync(path.join(dir, "tail.go"), "");
    waitFor(path.join(dir, "tail.done"));
  }

  const chunks = [];
  let sawEnd = false;
  if (form === "readable") {
    // The stream's first read was issued in a nextTick: it has found the pipe empty and waits.
    setImmediate(writeHead);
    let length = 0;
    stream.on("readable", () => {
      if (chunks.length === 0) writeTail();
      if (stream.readableLength === 0) return;
      const chunk = stream.read(stream.readableLength);
      chunks.push(chunk);
      length += chunk.length;
      if (length === HEAD + TAIL) fs.writeFileSync(path.join(dir, "close.go"), "");
    });
    stream.on("end", () => {
      sawEnd = true;
    });
  } else {
    if (form === "beside") stream.on("data", () => {});
    // 'resume' comes when the first read has found the pipe empty and waits.
    stream.once("resume", writeHead);
    // Runs with the first chunk, before the loop below continues.
    stream.once("data", writeTail);
    const ended = once(stream, "end").then(() => {
      sawEnd = true;
      return null;
    });
    (async () => {
      for (;;) {
        const next = await Promise.race([once(stream, "data"), ended]);
        if (next === null) break;
        chunks.push(next[0]);
        if (form === "pause") stream.pause();
        if (form !== "job") await new Promise(resolve => process.nextTick(resolve));
        if (form === "pause") stream.resume();
      }
    })();
  }

  return once(child, "close").then(([exitCode]) => {
    const out = Buffer.concat(chunks);
    return {
      exitCode,
      sawEnd,
      length: out.length,
      head: out.subarray(0, HEAD).equals(Buffer.alloc(HEAD, "h")),
      tail: out.subarray(HEAD).equals(Buffer.alloc(TAIL, "t")),
    };
  });
}

(async () => {
  const results = {};
  for (const consumer of process.argv.slice(3)) {
    const [which, form] = consumer.split(":");
    const dir = path.join(root, `${which}-${form}`);
    fs.mkdirSync(dir);
    results[consumer] = await consume(which, form, dir);
  }
  console.log(JSON.stringify(results));
})();
