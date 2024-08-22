//#FILE: test-module-cache.js
//#SHA1: ff0f4c6ca37e23c009f98bba966e9daee2dcaef6
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

let tmpdir;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "test-module-cache-"));
});

afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

test("throws MODULE_NOT_FOUND when file does not exist", () => {
  const filePath = path.join(tmpdir, "test-module-cache.json");
  expect(() => require(filePath)).toThrow(
    expect.objectContaining({
      code: "MODULE_NOT_FOUND",
      message: expect.any(String),
    }),
  );
});

test("requires JSON file successfully after creation", () => {
  const filePath = path.join(tmpdir, "test-module-cache.json");
  fs.writeFileSync(filePath, "[]");

  const content = require(filePath);
  expect(Array.isArray(content)).toBe(true);
  expect(content.length).toBe(0);
});

//<#END_FILE: test-module-cache.js
