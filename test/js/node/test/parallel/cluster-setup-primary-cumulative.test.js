//#FILE: test-cluster-setup-primary-cumulative.js
//#SHA1: 8a64228ac6d42c930b2426bbc53009f5d8b96a17
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
const assert = require("assert");
const cluster = require("cluster");

test("cluster setup primary cumulative", () => {
  expect(cluster.isPrimary).toBe(true);

  // cluster.settings should not be initialized until needed
  expect(cluster.settings).toEqual({});

  cluster.setupPrimary();
  expect(cluster.settings).toEqual({
    args: process.argv.slice(2),
    exec: process.argv[1],
    execArgv: process.execArgv,
    silent: false,
  });

  cluster.setupPrimary({ exec: "overridden" });
  expect(cluster.settings.exec).toBe("overridden");

  cluster.setupPrimary({ args: ["foo", "bar"] });
  expect(cluster.settings.exec).toBe("overridden");
  expect(cluster.settings.args).toEqual(["foo", "bar"]);

  cluster.setupPrimary({ execArgv: ["baz", "bang"] });
  expect(cluster.settings.exec).toBe("overridden");
  expect(cluster.settings.args).toEqual(["foo", "bar"]);
  expect(cluster.settings.execArgv).toEqual(["baz", "bang"]);

  cluster.setupPrimary();
  expect(cluster.settings).toEqual({
    args: ["foo", "bar"],
    exec: "overridden",
    execArgv: ["baz", "bang"],
    silent: false,
  });
});

//<#END_FILE: test-cluster-setup-primary-cumulative.js
