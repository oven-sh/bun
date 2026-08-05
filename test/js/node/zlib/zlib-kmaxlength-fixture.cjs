// buffer.kMaxLength must be patched before the first require of zlib: zlib
// captures it at module load (same as Node), which is why this runs in its own
// process instead of inside the test runner.
const buffer = require("node:buffer");
buffer.kMaxLength = 64;
const assert = require("node:assert");
const util = require("node:util");
const zlib = require("node:zlib");

const [fnName, encodedHex, mode] = process.argv.slice(2);
const encoded = Buffer.from(encodedHex, "hex");

if (mode === "sync") {
  assert.throws(() => zlib[fnName](encoded), RangeError);
  console.log("ok");
} else {
  util.promisify(zlib[fnName])(encoded).then(
    () => {
      console.error(`expected ${fnName} to reject`);
      process.exit(1);
    },
    err => {
      assert.ok(err instanceof RangeError, `expected RangeError, got ${err}`);
      console.log("ok");
    },
  );
}
