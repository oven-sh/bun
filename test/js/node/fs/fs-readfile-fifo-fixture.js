// Spawned by fs.test.ts. Reads a FIFO whose content (>256 KB) far exceeds the
// 0-byte size `fstat` reports for a pipe. The "stat size is wrong" grow path in
// readFileSync used to reallocate (and RawVec-double) on every read because the
// buffer length was left at capacity, ballooning RSS to multiple GB and never
// returning. Prints a single parseable line so the parent can assert.
const fs = require("fs");
const cp = require("child_process");
const path = require("path");

const dir = process.argv[2];
const fifo = path.join(dir, "thefifo");
try {
  fs.unlinkSync(fifo);
} catch {}
cp.execFileSync("mkfifo", [fifo]);
if (!fs.statSync(fifo).isFIFO()) throw new Error(`not a FIFO: ${fifo}`);

const SIZE = 400 * 1024;
cp.spawn(
  process.execPath,
  [
    "-e",
    `const fs=require("fs");const fd=fs.openSync(process.argv[1],"w");` +
      `const b=Buffer.alloc(${SIZE},0x61);let o=0;` +
      `while(o<b.length){o+=fs.writeSync(fd,b,o,Math.min(16384,b.length-o))}fs.closeSync(fd);`,
    fifo,
  ],
  { stdio: "inherit" },
);

const data = fs.readFileSync(fifo);
process.stdout.write(`len=${data.length} allA=${data.every(x => x === 0x61)}`);
