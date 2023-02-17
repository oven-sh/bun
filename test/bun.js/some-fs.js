const { mkdirSync, existsSync } = require("fs");

var performance = globalThis.performance;
if (!performance) {
  try {
    performance = require("perf_hooks").performance;
  } catch (e) {}
}

const count = parseInt(process.env.ITERATIONS || "1", 10) || 1;
var tempdir = `/tmp/some-fs-test/dir/${Date.now()}/hi`;

for (let i = 0; i < count; i++) {
  tempdir += `/${i.toString(36)}`;
}

if (existsSync(tempdir)) {
  throw new Error(`existsSync reports ${tempdir} exists, but it probably does not`);
}

var origTempDir = tempdir;
var iterations = new Array(count * count).fill("");
var total = 0;
for (let i = 0; i < count; i++) {
  for (let j = 0; j < count; j++) {
    iterations[total++] = `${origTempDir}/${j.toString(36)}-${i.toString(36)}`;
  }
}
tempdir = origTempDir;
mkdirSync(origTempDir, { recursive: true });
const recurse = { recursive: false };
const start = performance.now();
for (let i = 0; i < total; i++) {
  mkdirSync(iterations[i], recurse);
}

console.log("MKDIR " + total + " depth took:", performance.now() - start, "ms");

if (!existsSync(tempdir)) {
  throw new Error("Expected directory to exist after mkdirSync, but it doesn't");
}

if (mkdirSync(tempdir, { recursive: true })) {
  throw new Error("mkdirSync shouldn't return directory name on existing directories");
}
