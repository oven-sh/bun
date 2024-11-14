//#FILE: test-fs-open-mode-mask.js
//#SHA1: d290e7c1bced1fc3a98f27e2aeb463051581376c
//-----------------
"use strict";

// This tests that the lower bits of mode > 0o777 still works in fs.open().

const fs = require("fs");
const path = require("path");
const os = require("os");

const mode = process.platform === "win32" ? 0o444 : 0o644;

const maskToIgnore = 0o10000;

const tmpdir = path.join(os.tmpdir(), "test-fs-open-mode-mask");

beforeAll(() => {
  try {
    fs.mkdirSync(tmpdir, { recursive: true });
  } catch (err) {
    // Directory might already exist
  }
});

afterAll(() => {
  try {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  } catch (err) {
    // Ignore errors during cleanup
  }
});

function test(mode, asString) {
  const suffix = asString ? "str" : "num";
  const input = asString ? (mode | maskToIgnore).toString(8) : mode | maskToIgnore;

  it(`should work with ${suffix} input`, () => {
    const file = path.join(tmpdir, `openSync-${suffix}.txt`);
    const fd = fs.openSync(file, "w+", input);
    expect(fs.fstatSync(fd).mode & 0o777).toBe(mode);
    fs.closeSync(fd);
    expect(fs.statSync(file).mode & 0o777).toBe(mode);
  });

  it(`should work with ${suffix} input using callback`, done => {
    const file = path.join(tmpdir, `open-${suffix}.txt`);
    fs.open(file, "w+", input, (err, fd) => {
      expect(err).toBeNull();
      expect(fs.fstatSync(fd).mode & 0o777).toBe(mode);
      fs.closeSync(fd);
      expect(fs.statSync(file).mode & 0o777).toBe(mode);
      done();
    });
  });
}

test(mode, true);
test(mode, false);

//<#END_FILE: test-fs-open-mode-mask.js
