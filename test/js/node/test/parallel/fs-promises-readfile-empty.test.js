//#FILE: test-fs-promises-readfile-empty.js
//#SHA1: 6fcec9b5d3c9617426d46c79fb79244bc236574b
//-----------------
"use strict";

const fs = require("fs").promises;
const path = require("path");

const fixturesPath = path.resolve(__dirname, "..", "fixtures");
const fn = path.join(fixturesPath, "empty.txt");

test("fs.readFile on empty file", async () => {
  const content = await fs.readFile(fn);
  expect(content).toBeTruthy();
});

test("fs.readFile on empty file with utf8 encoding", async () => {
  const content = await fs.readFile(fn, "utf8");
  expect(content).toBe("");
});

test("fs.readFile on empty file with options object", async () => {
  const content = await fs.readFile(fn, { encoding: "utf8" });
  expect(content).toBe("");
});

//<#END_FILE: test-fs-promises-readfile-empty.js
