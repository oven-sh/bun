const { writeFileSync, createReadStream } = require("fs");
const { join } = require("path");
const { tmpdir } = require("os");

// This test should fail if ot doesn't go through the "readable" event
process.exitCode = 1;

const testData = new Uint8Array(parseInt(process.env.READABLE_SIZE || (1024 * 1024).toString(10))).fill("a");
const path = join(tmpdir(), `${Date.now()}-testEmitReadableOnEnd.txt`);
writeFileSync(path, testData);

const stream = createReadStream(path);

stream.on("readable", () => {
  const chunk = stream.read();
  if (!chunk) {
    process.exitCode = 0;
  }
});
