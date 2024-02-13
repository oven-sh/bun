"use strict";

const path = require("node:path");

const fixturesDir = path.join(__dirname, "..", "fixtures");

function fixturesPath(...args) {
  return path.join(fixturesDir, ...args);
}

module.exports = {
  fixturesDir,
  path: fixturesPath,
};
