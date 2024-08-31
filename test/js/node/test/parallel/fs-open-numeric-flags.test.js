//#FILE: test-fs-open-numeric-flags.js
//#SHA1: 31a49fd78cbd63ab0b41de5f051d029bbe22fded
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

// Create a temporary directory for our tests
const tmpdir = path.join(os.tmpdir(), "test-fs-open-numeric-flags");

beforeEach(() => {
  // Ensure the temporary directory exists and is empty
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpdir, { recursive: true });
});

afterEach(() => {
  // Clean up the temporary directory after each test
  if (fs.existsSync(tmpdir)) {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
});

test("O_WRONLY without O_CREAT shall fail with ENOENT", () => {
  const pathNE = path.join(tmpdir, "file-should-not-exist");

  expect(() => {
    fs.openSync(pathNE, fs.constants.O_WRONLY);
  }).toThrow(
    expect.objectContaining({
      code: "ENOENT",
      message: expect.any(String),
    }),
  );
});

//<#END_FILE: test-fs-open-numeric-flags.js
