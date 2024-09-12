//#FILE: test-require-extensions-main.js
//#SHA1: c3dd50393bbc3eb542e40c67611fc48707ad3cba
//-----------------
"use strict";

const path = require("path");

test("require extensions main", () => {
  const fixturesPath = path.join(__dirname, "..", "fixtures");
  const fixturesRequire = require(path.join(fixturesPath, "require-bin", "bin", "req.js"));

  expect(fixturesRequire).toBe("");
});

//<#END_FILE: test-require-extensions-main.js
