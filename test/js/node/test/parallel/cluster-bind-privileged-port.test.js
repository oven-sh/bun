//#FILE: test-cluster-bind-privileged-port.js
//#SHA1: f3a12e75717db9c1a1edd4f51fb2985787a50706
//-----------------
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

"use strict";
const cluster = require("cluster");
const net = require("net");
const { readFileSync } = require("fs");

const isLinux = process.platform === "linux";
const isOSX = process.platform === "darwin";
const isIBMi = process.platform === "os400";
const isWindows = process.platform === "win32";

const skipTest = () => {
  test.skip("Skipping test", () => {});
  process.exit(0);
};

if (isLinux) {
  try {
    const unprivilegedPortStart = parseInt(readFileSync("/proc/sys/net/ipv4/ip_unprivileged_port_start"));
    if (unprivilegedPortStart <= 42) {
      skipTest();
    }
  } catch {
    // Do nothing, feature doesn't exist, minimum is 1024 so 42 is usable.
    // Continue...
  }
}

// Skip on OS X Mojave. https://github.com/nodejs/node/issues/21679
if (isOSX) skipTest();

if (isIBMi) skipTest();

if (isWindows) skipTest();

if (process.getuid() === 0) skipTest();

if (cluster.isPrimary) {
  test("primary cluster process", () => {
    const worker = cluster.fork();
    worker.on("exit", exitCode => {
      expect(exitCode).toBe(0);
    });
  });
} else {
  test("worker cluster process", () => {
    const s = net.createServer(jest.fn());
    s.listen(42, jest.fn());
    s.on("error", err => {
      expect(err.code).toBe("EACCES");
      process.disconnect();
    });
  });
}

//<#END_FILE: test-cluster-bind-privileged-port.js
