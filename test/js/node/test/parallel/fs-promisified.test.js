//#FILE: test-fs-promisified.js
//#SHA1: 5366497c2a750295d2c5cf65c2938e27f573e8bb
//-----------------
"use strict";

const fs = require("fs");
const { promisify } = require("util");

const read = promisify(fs.read);
const write = promisify(fs.write);
const exists = promisify(fs.exists);

test("promisified fs.read", async () => {
  const fd = fs.openSync(__filename, "r");
  const obj = await read(fd, Buffer.alloc(1024), 0, 1024, null);
  expect(typeof obj.bytesRead).toBe("number");
  expect(obj.buffer).toBeInstanceOf(Buffer);
  fs.closeSync(fd);
});

test("promisified fs.write", async () => {
  const tmpdir = require("../common/tmpdir");
  tmpdir.refresh();
  const filename = tmpdir.resolve("write-promise.txt");
  const fd = fs.openSync(filename, "w");
  const obj = await write(fd, Buffer.from("foobar"));
  expect(typeof obj.bytesWritten).toBe("number");
  expect(obj.buffer.toString()).toBe("foobar");
  fs.closeSync(fd);
});

test("promisified fs.exists", async () => {
  const result = await exists(__filename);
  expect(result).toBe(true);
});

//<#END_FILE: test-fs-promisified.js
