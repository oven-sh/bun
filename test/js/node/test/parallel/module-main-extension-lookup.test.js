//#FILE: test-module-main-extension-lookup.js
//#SHA1: d50be34ba21e1e14de5225ac5d93b6fe20505014
//-----------------
"use strict";

const path = require("path");
const { execFileSync } = require("child_process");

const node = process.argv[0];

test("ES modules extension lookup", () => {
  const fixturesPath = path.resolve(__dirname, "..", "fixtures");

  expect(() => {
    execFileSync(node, [path.join(fixturesPath, "es-modules", "test-esm-ok.mjs")]);
  }).not.toThrow();

  expect(() => {
    execFileSync(node, [path.join(fixturesPath, "es-modules", "noext")]);
  }).not.toThrow();
});

//<#END_FILE: test-module-main-extension-lookup.js
