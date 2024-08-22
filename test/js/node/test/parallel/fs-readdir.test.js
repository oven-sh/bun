//#FILE: test-fs-readdir.js
//#SHA1: ce2c5a12cb271c5023f965afe712e78b1a484ad5
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const readdirDir = path.join(os.tmpdir(), "test-fs-readdir");
const files = ["empty", "files", "for", "just", "testing"];

beforeAll(() => {
  // Make sure tmp directory is clean
  if (fs.existsSync(readdirDir)) {
    fs.rmSync(readdirDir, { recursive: true, force: true });
  }
  fs.mkdirSync(readdirDir, { recursive: true });

  // Create the necessary files
  files.forEach(currentFile => {
    fs.closeSync(fs.openSync(path.join(readdirDir, currentFile), "w"));
  });
});

afterAll(() => {
  // Clean up
  fs.rmSync(readdirDir, { recursive: true, force: true });
});

test("fs.readdirSync returns correct files", () => {
  expect(fs.readdirSync(readdirDir).sort()).toEqual(files);
});

test("fs.readdir returns correct files", async () => {
  await new Promise(resolve => {
    fs.readdir(readdirDir, (err, f) => {
      expect(err).toBeNull();
      expect(f.sort()).toEqual(files);
      resolve();
    });
  });
});

test("fs.readdirSync throws ENOTDIR on file", () => {
  expect(() => {
    fs.readdirSync(__filename);
  }).toThrow(
    expect.objectContaining({
      code: "ENOTDIR",
      message: expect.any(String),
    }),
  );
});

test("fs.readdir throws ENOTDIR on file", async () => {
  await new Promise(resolve => {
    fs.readdir(__filename, e => {
      expect(e).toEqual(
        expect.objectContaining({
          code: "ENOTDIR",
          message: expect.any(String),
        }),
      );
      resolve();
    });
  });
});

test("fs.readdir and fs.readdirSync throw on invalid input", () => {
  [false, 1, [], {}, null, undefined].forEach(i => {
    expect(() => fs.readdir(i, () => {})).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );

    expect(() => fs.readdirSync(i)).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
        message: expect.any(String),
      }),
    );
  });
});

//<#END_FILE: test-fs-readdir.js
