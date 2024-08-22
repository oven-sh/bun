//#FILE: test-fs-make-callback.js
//#SHA1: 40bbb673a0865f464a2b9e40110e903b6cc9e0d6
//-----------------
"use strict";

const fs = require("fs");
const { sep } = require("path");
const tmpdir = require("../common/tmpdir");

const callbackThrowValues = [null, true, false, 0, 1, "foo", /foo/, [], {}];

beforeEach(() => {
  tmpdir.refresh();
});

function testMakeCallback(cb) {
  return function () {
    // fs.mkdtemp() calls makeCallback() on its third argument
    return fs.mkdtemp(`${tmpdir.path}${sep}`, {}, cb);
  };
}

describe("fs.makeCallback", () => {
  test("invalid callbacks throw TypeError", () => {
    callbackThrowValues.forEach(value => {
      expect(testMakeCallback(value)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          name: "TypeError",
          message: expect.any(String),
        }),
      );
    });
  });
});

//<#END_FILE: test-fs-make-callback.js
