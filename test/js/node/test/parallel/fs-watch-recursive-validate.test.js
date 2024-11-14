//#FILE: test-fs-watch-recursive-validate.js
//#SHA1: eb5d9ff1caac7f9d4acf694c43e4f634f538befb
//-----------------
"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");

const isIBMi = process.platform === "os400";
const isAIX = process.platform === "aix";
const isWindows = process.platform === "win32";
const isOSX = process.platform === "darwin";

if (isIBMi) {
  test.skip("IBMi does not support `fs.watch()`", () => {});
} else if (isAIX) {
  test.skip("folder watch capability is limited in AIX.", () => {});
} else {
  const tmpdir = {
    path: path.join(os.tmpdir(), "jest-fs-watch-recursive-validate"),
    refresh: () => {
      if (fs.existsSync(tmpdir.path)) {
        fs.rmSync(tmpdir.path, { recursive: true, force: true });
      }
      fs.mkdirSync(tmpdir.path, { recursive: true });
    },
  };

  beforeEach(() => {
    tmpdir.refresh();
  });

  test("Handle non-boolean values for options.recursive", async () => {
    if (!isWindows && !isOSX) {
      expect(() => {
        const testsubdir = fs.mkdtempSync(tmpdir.path + path.sep);
        fs.watch(testsubdir, { recursive: "1" });
      }).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
          message: expect.any(String),
        }),
      );
    }
  });
}

//<#END_FILE: test-fs-watch-recursive-validate.js
