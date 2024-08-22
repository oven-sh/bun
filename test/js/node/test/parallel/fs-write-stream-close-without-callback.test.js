//#FILE: test-fs-write-stream-close-without-callback.js
//#SHA1: 63e0c345b440c8cfb157aa84340f387cf314e20f
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const tmpdir = path.join(os.tmpdir(), "test-fs-write-stream-close-without-callback");

beforeEach(() => {
  // Create a fresh temporary directory before each test
  if (!fs.existsSync(tmpdir)) {
    fs.mkdirSync(tmpdir, { recursive: true });
  }
});

afterEach(() => {
  // Clean up the temporary directory after each test
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("fs.WriteStream can be closed without a callback", () => {
  const filePath = path.join(tmpdir, "nocallback");
  const s = fs.createWriteStream(filePath);

  s.end("hello world");
  s.close();

  // We don't need to assert anything here as the test is checking
  // that the above operations don't throw an error
  expect(true).toBe(true);
});

//<#END_FILE: test-fs-write-stream-close-without-callback.js
