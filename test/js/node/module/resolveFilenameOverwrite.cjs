// This behavior is required for Next.js to work
const eql = require("assert").strictEqual;
const path = require("path");
const Module = require("module");

const original = Module._resolveFilename;
Module._resolveFilename = (specifier, parent, isMain) => {
  eql(specifier.endsWith("💔"), true);
  eql(parent.filename, path.join(__dirname, "./resolveFilenameOverwrite.cjs"));
  return path.join(__dirname, "./resolveFilenameOverwrite-fixture.cjs");
};
eql(require("overwriting _resolveFilename broke 💔"), "winner");
Module._resolveFilename = original;

console.log("--pass--");
