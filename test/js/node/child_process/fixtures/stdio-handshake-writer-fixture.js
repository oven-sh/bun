// usage: stdio-handshake-writer-fixture.js <dir> <count> <fd | fifo:path> [block=<bytes>] [leave] [tail=<fd>]
//
// Writes "item<i>\n", creates <dir>/wrote<i> once those bytes are in the pipe,
// then waits for the reader to create <dir>/got<i> before it writes the next one.
// The process exits after the reader acknowledged the last item.
//
// block=<bytes>: the items are blocks of bytes with no text. Block 0 has 4096
// bytes and each later block has <bytes>.
// leave: the process exits right after the last item.
// tail=<fd>: "tail\n" goes to that fd right after the last item.
const fs = require("node:fs");

const [dir, count, target, ...rest] = process.argv.slice(2);
const options = Object.fromEntries(rest.map(option => option.split("=")));
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

function item(i) {
  if (!options.block) return Buffer.from(`item${i}\n`);
  return Buffer.alloc(i === 0 ? 4096 : Number(options.block), 97 + (i % 26));
}

// The reader took every earlier byte out of the pipe before it asked for this item, so the item fits.
function writeAll(bytes) {
  for (let offset = 0; offset < bytes.length;) offset += fs.writeSync(fd, bytes, offset);
}

for (let i = 0; i < Number(count); i++) {
  const last = i + 1 === Number(count);
  writeAll(item(i));
  if (last && options.tail) fs.writeSync(Number(options.tail), "tail\n");
  fs.writeFileSync(`${dir}/wrote${i}`, "");
  if (last && "leave" in options) break;
  waitFor(() => (fs.existsSync(`${dir}/got${i}`) ? true : undefined), `the reader never acknowledged item${i}`);
}
