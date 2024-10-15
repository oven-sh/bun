//#FILE: test-child-process-stdio.js
//#SHA1: a121f9dd100777ada90408ac3980c35230cc119f
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
const { spawn } = require("child_process");

const pwdCommand = process.platform === "win32" ? ["cmd", "/c", "cd"] : ["pwd"];

test("stdio piping", () => {
  const child = spawn(...pwdCommand, { stdio: ["pipe"] });
  expect(child.stdout).not.toBeNull();
  expect(child.stderr).not.toBeNull();
});

test("stdio ignoring", () => {
  const child = spawn(...pwdCommand, { stdio: "ignore" });
  expect(child.stdout).toBeNull();
  expect(child.stderr).toBeNull();
});

test("Asset options invariance", () => {
  const options = { stdio: "ignore" };
  spawn(...pwdCommand, options);
  expect(options).toEqual({ stdio: "ignore" });
});

test("stdout buffering", done => {
  let output = "";
  const child = spawn(...pwdCommand);

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", function (s) {
    output += s;
  });

  child.on("exit", code => {
    expect(code).toBe(0);
  });

  child.on("close", () => {
    expect(output.length).toBeGreaterThan(1);
    expect(output[output.length - 1]).toBe("\n");
    done();
  });
});

test("Assert only one IPC pipe allowed", () => {
  expect(() => {
    spawn(...pwdCommand, { stdio: ["pipe", "pipe", "pipe", "ipc", "ipc"] });
  }).toThrow(
    expect.objectContaining({
      code: "ERR_IPC_ONE_PIPE",
      name: "Error",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-child-process-stdio.js
