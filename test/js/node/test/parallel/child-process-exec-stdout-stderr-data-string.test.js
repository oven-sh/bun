//#FILE: test-child-process-exec-stdout-stderr-data-string.js
//#SHA1: 342c40f3dbb506150172c2471ae228fd8632b900
//-----------------
"use strict";
// Refs: https://github.com/nodejs/node/issues/7342
const { exec } = require("child_process");

const command = process.platform === "win32" ? "dir" : "ls";

test("exec stdout data is called at least once", done => {
  const child = exec(command);
  const onData = jest.fn();
  child.stdout.on("data", onData);

  child.on("close", () => {
    expect(onData).toHaveBeenCalled();
    done();
  });
});

test("exec stderr data is called at least once and receives string", done => {
  const child = exec("fhqwhgads");
  const onData = jest.fn(data => {
    expect(typeof data).toBe("string");
  });
  child.stderr.on("data", onData);

  child.on("close", () => {
    expect(onData).toHaveBeenCalled();
    done();
  });
});

//<#END_FILE: test-child-process-exec-stdout-stderr-data-string.js
