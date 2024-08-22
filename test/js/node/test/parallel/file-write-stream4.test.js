//#FILE: test-file-write-stream4.js
//#SHA1: f7c104987a21182baff41365cc44689e6c2b5801
//-----------------
"use strict";

// Test that 'close' emits once and not twice when `emitClose: true` is set.
// Refs: https://github.com/nodejs/node/issues/31366

const fs = require("fs");
const path = require("path");
const os = require("os");

test("close emits once when emitClose is true", done => {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"));
  const filepath = path.join(tmpdir, "write_pos.txt");

  const fileReadStream = fs.createReadStream(process.execPath);
  const fileWriteStream = fs.createWriteStream(filepath, {
    emitClose: true,
  });

  const closeHandler = jest.fn();
  fileWriteStream.on("close", closeHandler);

  fileReadStream.pipe(fileWriteStream);

  fileWriteStream.on("finish", () => {
    // Wait for a short time to ensure 'close' is not emitted twice
    setTimeout(() => {
      expect(closeHandler).toHaveBeenCalledTimes(1);
      fs.rmSync(tmpdir, { recursive: true, force: true });
      done();
    }, 100);
  });
});

//<#END_FILE: test-file-write-stream4.js
