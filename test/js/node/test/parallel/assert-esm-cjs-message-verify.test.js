//#FILE: test-assert-esm-cjs-message-verify.js
//#SHA1: 3d120c4813c4051523045df80fc501e9921b878f
//-----------------
"use strict";

const { spawnPromisified } = require("../common");
const tmpdir = require("../common/tmpdir");
const assert = require("assert");
const { writeFileSync, unlink } = require("fs");
const { join } = require("path");

tmpdir.refresh();

const fileImports = {
  cjs: 'const assert = require("assert");',
  mjs: 'import assert from "assert";',
};

const fileNames = [];

for (const [ext, header] of Object.entries(fileImports)) {
  const fileName = `test-file.${ext}`;
  // Store the generated filesnames in an array
  fileNames.push(join(tmpdir.path, fileName));

  writeFileSync(tmpdir.resolve(fileName), `${header}\nassert.ok(0 === 2);`);
}

describe("ensure the assert.ok throwing similar error messages for esm and cjs files", () => {
  const nodejsPath = process.execPath;
  const errorsMessages = [];

  test("should return code 1 for each command", async () => {
    for (const fileName of fileNames) {
      const { stderr, code } = await spawnPromisified(nodejsPath, [fileName]);
      expect(code).toBe(1);
      // For each error message, filter the lines which will starts with AssertionError
      errorsMessages.push(stderr.split("\n").find(s => s.startsWith("AssertionError")));
    }
  });

  afterAll(() => {
    expect(errorsMessages).toHaveLength(2);
    expect(errorsMessages[0]).toEqual(errorsMessages[1]);

    for (const fileName of fileNames) {
      unlink(fileName, () => {});
    }

    tmpdir.refresh();
  });
});

//<#END_FILE: test-assert-esm-cjs-message-verify.js
