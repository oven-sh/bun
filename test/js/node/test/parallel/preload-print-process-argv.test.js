//#FILE: test-preload-print-process-argv.js
//#SHA1: 071fd007af8342d4f1924da004a6dcc7d419cf9f
//-----------------
"use strict";

// This tests that process.argv is the same in the preloaded module
// and the user module.

const tmpdir = require("../common/tmpdir");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

beforeAll(() => {
  tmpdir.refresh();
});

test("process.argv is the same in preloaded and user module", () => {
  const preloadPath = path.join(tmpdir.path, "preload.js");
  const mainPath = path.join(tmpdir.path, "main.js");

  fs.writeFileSync(preloadPath, "console.log(JSON.stringify(process.argv));", "utf-8");

  fs.writeFileSync(mainPath, "console.log(JSON.stringify(process.argv));", "utf-8");

  const child = spawnSync(process.execPath, ["-r", "./preload.js", "main.js"], { cwd: tmpdir.path });

  expect(child.status).toBe(0);

  if (child.status !== 0) {
    console.log(child.stderr.toString());
  }

  const lines = child.stdout.toString().trim().split("\n");
  expect(JSON.parse(lines[0])).toEqual(JSON.parse(lines[1]));
});

//<#END_FILE: test-preload-print-process-argv.js
