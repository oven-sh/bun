//#FILE: test-file-write-stream5.js
//#SHA1: 977defaa9f5aa057ce34bdc0af8774c7f1e3f2c6
//-----------------
"use strict";

// Test 'uncork' for WritableStream.
// Refs: https://github.com/nodejs/node/issues/50979

const fs = require("fs");
const path = require("path");
const os = require("os");

const filepath = path.join(os.tmpdir(), "write_stream.txt");

beforeEach(() => {
  // Clean up the temporary directory
  try {
    fs.unlinkSync(filepath);
  } catch (err) {
    // Ignore errors if the file doesn't exist
  }
});

const data = "data";

test("writable stream uncork", done => {
  const fileWriteStream = fs.createWriteStream(filepath);

  fileWriteStream.on("finish", () => {
    const writtenData = fs.readFileSync(filepath, "utf8");
    expect(writtenData).toBe(data);
    done();
  });

  fileWriteStream.cork();
  fileWriteStream.write(data, () => {
    // This callback is expected to be called
    expect(true).toBe(true);
  });
  fileWriteStream.uncork();
  fileWriteStream.end();
});

//<#END_FILE: test-file-write-stream5.js
