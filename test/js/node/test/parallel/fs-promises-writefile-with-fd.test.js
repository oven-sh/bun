//#FILE: test-fs-promises-writefile-with-fd.js
//#SHA1: 55be58e0edcbdc914795c46280459a85071f28eb
//-----------------
"use strict";

// This test makes sure that `writeFile()` always writes from the current
// position of the file, instead of truncating the file.

const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const os = require("os");

let tmpdir;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "test-"));
});

afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test("writeFile() writes from current position", async () => {
  const fn = path.join(tmpdir, "test.txt");

  const handle = await fsPromises.open(fn, "w");

  /* Write only five bytes, so that the position moves to five. */
  const buf = Buffer.from("Hello");
  const { bytesWritten } = await handle.write(buf, 0, 5, null);
  expect(bytesWritten).toBe(5);

  /* Write some more with writeFile(). */
  await handle.writeFile("World");

  /* New content should be written at position five, instead of zero. */
  expect(fs.readFileSync(fn, "utf8")).toBe("HelloWorld");

  await handle.close();
});

//<#END_FILE: test-fs-promises-writefile-with-fd.js
