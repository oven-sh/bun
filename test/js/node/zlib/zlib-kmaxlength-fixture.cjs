// buffer.kMaxLength must be patched before the first require of zlib: zlib
// captures it at module load (same as Node), which is why this runs in its own
// process instead of inside the test runner.
const buffer = require("node:buffer");
buffer.kMaxLength = 64;
const assert = require("node:assert");
const util = require("node:util");
const zlib = require("node:zlib");

const [encodedHex, asyncName, syncName] = process.argv.slice(2);
const encoded = Buffer.from(encodedHex, "hex");

assert.throws(() => zlib[syncName](encoded), RangeError, `${syncName} should throw RangeError`);

util.promisify(zlib[asyncName])(encoded).then(
  () => {
    console.error(`expected ${asyncName} to reject`);
    process.exit(1);
  },
  err => {
    assert.ok(err instanceof RangeError, `expected ${asyncName} to reject with RangeError, got ${err}`);
    console.log("ok");
  },
);
