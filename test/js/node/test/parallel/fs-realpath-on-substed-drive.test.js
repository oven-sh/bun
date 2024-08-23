//#FILE: test-fs-realpath-on-substed-drive.js
//#SHA1: 4633ab33e7e986edbdb2311eecab3068e68ceaed
//-----------------
"use strict";

const common = require("../common");
if (!common.isWindows) common.skip("Test for Windows only");

const fixtures = require("../common/fixtures");

const assert = require("assert");
const fs = require("fs");
const spawnSync = require("child_process").spawnSync;

let result;

// Create a subst drive
const driveLetters = "ABCDEFGHIJKLMNOPQRSTUWXYZ";
let drive;
let i;
for (i = 0; i < driveLetters.length; ++i) {
  drive = `${driveLetters[i]}:`;
  result = spawnSync("subst", [drive, fixtures.fixturesDir]);
  if (result.status === 0) break;
}
if (i === driveLetters.length) common.skip("Cannot create subst drive");

// Schedule cleanup (and check if all callbacks where called)
afterAll(() => {
  spawnSync("subst", ["/d", drive]);
});

describe("fs.realpath on substed drive", () => {
  const filename = `${drive}\\empty.js`;
  const filenameBuffer = Buffer.from(filename);

  test("realpathSync with string", () => {
    result = fs.realpathSync(filename);
    expect(result).toBe(filename);
  });

  test("realpathSync with buffer", () => {
    result = fs.realpathSync(filename, "buffer");
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.equals(filenameBuffer)).toBe(true);
  });

  test("realpath with string", async () => {
    await new Promise(resolve => {
      fs.realpath(filename, (err, result) => {
        expect(err).toBe(null);
        expect(result).toBe(filename);
        resolve();
      });
    });
  });

  test("realpath with buffer", async () => {
    await new Promise(resolve => {
      fs.realpath(filename, "buffer", (err, result) => {
        expect(err).toBe(null);
        expect(Buffer.isBuffer(result)).toBe(true);
        expect(result.equals(filenameBuffer)).toBe(true);
        resolve();
      });
    });
  });
});

//<#END_FILE: test-fs-realpath-on-substed-drive.js
