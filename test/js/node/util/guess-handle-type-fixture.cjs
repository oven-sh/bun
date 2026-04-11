// Prints guessHandleType(fd) for fds given on argv as JSON to stdout.
// Runs under both:
//   - bun (uses bun:internal-for-testing)
//   - node --expose-internals (uses internal/util)
"use strict";
let guessHandleType;
if (typeof Bun !== "undefined") {
  guessHandleType = require("bun:internal-for-testing").guessHandleType;
} else {
  guessHandleType = require("internal/util").guessHandleType;
}
const fds = process.argv.slice(2).map(Number);
process.stdout.write(JSON.stringify(fds.map(fd => guessHandleType(fd))) + "\n");
