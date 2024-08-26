//#FILE: test-child-process-send-type-error.js
//#SHA1: 85b82f9c15ca3d5368e22ccd1e7f44672ce2fb0c
//-----------------
"use strict";

const cp = require("child_process");

function fail(proc, args) {
  expect(() => {
    proc.send.apply(proc, args);
  }).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
    }),
  );
}

let target = process;

if (process.argv[2] !== "child") {
  test("child process send type error", () => {
    target = cp.fork(__filename, ["child"]);
    target.on("exit", (code, signal) => {
      expect(code).toBe(0);
      expect(signal).toBeNull();
    });

    fail(target, ["msg", null, null]);
    fail(target, ["msg", null, ""]);
    fail(target, ["msg", null, "foo"]);
    fail(target, ["msg", null, 0]);
    fail(target, ["msg", null, NaN]);
    fail(target, ["msg", null, 1]);
    fail(target, ["msg", null, null, jest.fn()]);
  });
} else {
  test("process send type error", () => {
    fail(target, ["msg", null, null]);
    fail(target, ["msg", null, ""]);
    fail(target, ["msg", null, "foo"]);
    fail(target, ["msg", null, 0]);
    fail(target, ["msg", null, NaN]);
    fail(target, ["msg", null, 1]);
    fail(target, ["msg", null, null, jest.fn()]);
  });
}

//<#END_FILE: test-child-process-send-type-error.js
