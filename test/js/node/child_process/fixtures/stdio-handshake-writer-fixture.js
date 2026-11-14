// usage: stdio-handshake-writer-fixture.js <dir> <count> <fd | fifo:path> [tail fd]
//
// Writes "item<i>\n", creates <dir>/wrote<i> once those bytes are in the pipe,
// then waits for the reader to create <dir>/got<i> before it writes the next one.
// With [tail fd], "tail\n" goes to that fd right after the last item. The process
// exits after the last item.
const fs = require("node:fs");

const [dir, count, target, tail] = process.argv.slice(2);
const nap = new Int32Array(new SharedArrayBuffer(4));
const deadline = Date.now() + 30_000;

function waitFor(ready, failure) {
  for (;;) {
    const result = ready();
    if (result !== undefined) return result;
    if (Date.now() > deadline) {
      console.error(`writer: ${failure}`);
      process.exit(3);
    }
    Atomics.wait(nap, 0, 0, 1);
  }
}

// With O_NONBLOCK the open fails until a reader has the FIFO open. Without it
// the open waits for that reader, forever if the reader died.
function openFifo(path) {
  return waitFor(() => {
    try {
      return fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
    } catch (err) {
      if (err.code !== "ENXIO") throw err;
    }
  }, "no reader opened the fifo");
}

const fd = target.startsWith("fifo:") ? openFifo(target.slice("fifo:".length)) : Number(target);

for (let i = 0; i < Number(count); i++) {
  const last = i + 1 === Number(count);
  fs.writeSync(fd, `item${i}\n`);
  if (last && tail) fs.writeSync(Number(tail), "tail\n");
  fs.writeFileSync(`${dir}/wrote${i}`, "");
  if (last) break;
  waitFor(() => (fs.existsSync(`${dir}/got${i}`) ? true : undefined), `the reader never acknowledged item${i}`);
}
