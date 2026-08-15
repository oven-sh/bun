// Spawned by fs.test.ts, which creates the FIFO at argv[2] and feeds it well
// over the 256 KB readFileSync reads before calling fstat. fstat reports a
// 0-byte size for a pipe, so everything after that arrives through the "stat
// size is wrong" grow path. That path used to reallocate (and RawVec-double) on
// every read because the buffer length was left at capacity, ballooning RSS to
// multiple GB and never returning, which is why the read runs in a child the
// test can kill. Prints a single parseable line for the parent to assert on.
const fs = require("fs");

const data = fs.readFileSync(process.argv[2]);
process.stdout.write(`len=${data.length} allA=${data.equals(Buffer.alloc(data.length, "a"))}`);
