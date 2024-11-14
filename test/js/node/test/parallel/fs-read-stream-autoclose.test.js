//#FILE: test-fs-read-stream-autoClose.js
//#SHA1: 0fbd57ecd5ae02143036c03cdca120bc7c3deea1
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const writeFile = path.join(os.tmpdir(), "write-autoClose.txt");

beforeEach(() => {
  // Clean up the temporary directory
  try {
    fs.unlinkSync(writeFile);
  } catch (err) {
    // Ignore errors if file doesn't exist
  }
});

test("fs.createWriteStream with autoClose option", done => {
  const file = fs.createWriteStream(writeFile, { autoClose: true });

  file.on("finish", () => {
    expect(file.destroyed).toBe(false);
    done();
  });

  file.end("asd");
});

//<#END_FILE: test-fs-read-stream-autoClose.js
