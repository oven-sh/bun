// Spawned by fs.test.ts, which creates the FIFO at argv[2] and feeds it more
// than the 256 KB readFileSync reads before it calls fstat. fstat reports a
// 0-byte size for a pipe, so the rest arrives through the "stat size is wrong"
// grow path, which used to reallocate (and RawVec-double) on every read: the
// process grew by gigabytes or never returned, which is why the read happens in
// a child the test can kill. Prints one JSON line with what was read and by how
// much the read raised this process's peak RSS.
const fs = require("fs");

// This process's own high-water mark. getrusage() cannot be used for this on
// Linux: ru_maxrss survives exec, so a child starts out with the high-water
// mark of the test runner that spawned it.
function peakRss() {
  if (process.platform === "linux") {
    return Number(/^VmHWM:\s+(\d+) kB/m.exec(fs.readFileSync("/proc/self/status", "utf8"))[1]) * 1024;
  }
  return process.resourceUsage().maxRSS * 1024;
}

const before = peakRss();
const data = fs.readFileSync(process.argv[2]);
const peakGrowth = peakRss() - before;

console.log(JSON.stringify({ len: data.length, allA: data.equals(Buffer.alloc(data.length, "a")), peakGrowth }));
