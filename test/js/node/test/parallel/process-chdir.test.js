//#FILE: test-process-chdir.js
//#SHA1: af98467edcecd1605cd517f45d87e02ba840420b
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");

// Skip test for workers
if (typeof process.chdir !== "function") {
  test.skip("process.chdir is not available in Workers", () => {});
} else {
  const originalCwd = process.cwd();

  afterAll(() => {
    // Ensure we return to the original directory after all tests
    process.chdir(originalCwd);
  });

  test("process.chdir changes current working directory", () => {
    process.chdir("..");
    expect(process.cwd()).not.toBe(__dirname);
    process.chdir(__dirname);
    expect(process.cwd()).toBe(__dirname);
  });

  test("process.chdir works with non-ASCII characters", () => {
    let dirName;
    if (process.versions.icu) {
      // ICU is available, use characters that could possibly be decomposed
      dirName = "weird \uc3a4\uc3ab\uc3af characters \u00e1\u00e2\u00e3";
    } else {
      // ICU is unavailable, use characters that can't be decomposed
      dirName = "weird \ud83d\udc04 characters \ud83d\udc05";
    }
    const tmpdir = path.resolve(__dirname, "../tmp");
    const dir = path.resolve(tmpdir, dirName);

    // Make sure that the tmp directory is clean
    if (fs.existsSync(tmpdir)) {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpdir, { recursive: true });

    fs.mkdirSync(dir);
    process.chdir(dir);
    expect(process.cwd().normalize()).toBe(dir.normalize());

    process.chdir("..");
    expect(process.cwd().normalize()).toBe(path.resolve(tmpdir).normalize());
  });

  test("process.chdir throws for invalid arguments", () => {
    expect(() => process.chdir({})).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringMatching(/The "directory" argument must be of type string/),
      }),
    );

    expect(() => process.chdir()).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringMatching(/The "directory" argument must be of type string/),
      }),
    );
  });
}

//<#END_FILE: test-process-chdir.js
