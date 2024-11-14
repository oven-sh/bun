//#FILE: test-fs-operations-with-surrogate-pairs.js
//#SHA1: c59fe103e9ec4edee50c9186d341f5fdd32e0af4
//-----------------
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const tmpdir = require("../common/tmpdir");

tmpdir.refresh();

describe("File operations with filenames containing surrogate pairs", () => {
  it("should write, read, and delete a file with surrogate pairs in the filename", () => {
    // Create a temporary directory
    const tempdir = fs.mkdtempSync(tmpdir.resolve("emoji-fruit-🍇 🍈 🍉 🍊 🍋"));
    expect(fs.existsSync(tempdir)).toBe(true);

    const filename = "🚀🔥🛸.txt";
    const content = "Test content";

    // Write content to a file
    fs.writeFileSync(path.join(tempdir, filename), content);

    // Read content from the file
    const readContent = fs.readFileSync(path.join(tempdir, filename), "utf8");

    // Check if the content matches
    expect(readContent).toBe(content);
  });
});

//<#END_FILE: test-fs-operations-with-surrogate-pairs.js
