//#FILE: test-require-unicode.js
//#SHA1: 3101d8c9e69745baeed9e6f09f32ca9ab31684a8
//-----------------
"use strict";

const fs = require("fs");
const path = require("path");

const tmpdir = require("../common/tmpdir");

test("require with unicode path", () => {
  tmpdir.refresh();

  const dirname = tmpdir.resolve("\u4e2d\u6587\u76ee\u5f55");
  fs.mkdirSync(dirname);
  fs.writeFileSync(path.join(dirname, "file.js"), "module.exports = 42;");
  fs.writeFileSync(path.join(dirname, "package.json"), JSON.stringify({ name: "test", main: "file.js" }));

  expect(require(dirname)).toBe(42);
  expect(require(path.join(dirname, "file.js"))).toBe(42);
});

//<#END_FILE: test-require-unicode.js
