//#FILE: test-fs-readdir-recursive.js
//#SHA1: daa6ac8e46cd3d530e4546354a11f87f1b1c092d
//-----------------
"use strict";

const fs = require("fs");
const net = require("net");
const path = require("path");
const os = require("os");

const tmpdir = path.join(os.tmpdir(), "node-test-fs-readdir-recursive");

beforeAll(() => {
  // Refresh tmpdir
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
});

afterAll(() => {
  // Clean up tmpdir
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test("fs.readdirSync with recursive option should not crash", done => {
  const server = net.createServer().listen(path.join(tmpdir, "test.sock"), () => {
    // The process should not crash
    // See https://github.com/nodejs/node/issues/52159
    expect(() => {
      fs.readdirSync(tmpdir, { recursive: true });
    }).not.toThrow();

    server.close();
    done();
  });
});

//<#END_FILE: test-fs-readdir-recursive.js
