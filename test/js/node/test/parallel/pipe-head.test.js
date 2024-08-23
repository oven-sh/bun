//#FILE: test-pipe-head.js
//#SHA1: ee782565f62b8ed7172b93153108ad18c9e437cc
//-----------------
"use strict";

const { execSync } = require("child_process");
const { join } = require("path");

const script = join(__dirname, "..", "fixtures", "print-10-lines.js");

const cmd = `"${process.execPath}" "${script}" | head -2`;

test("pipe to head", () => {
  const stdout = execSync(cmd, { encoding: "utf8" });
  const lines = stdout.split("\n");
  expect(lines).toHaveLength(3);
});

//<#END_FILE: test-pipe-head.js
