#!/usr/bin/env node

// package.json name is bun-link-pkg-fixture-1 to ensure we don't rely on dir name
const _ = require("lodash");

if (_.isBoolean(true)) {
  console.log("Success");
  process.exit(0);
}

console.error("Fail");
process.exit(1);
