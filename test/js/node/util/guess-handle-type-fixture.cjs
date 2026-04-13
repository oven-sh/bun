// Prints guessHandleType(fd) for fds given on argv as JSON to stdout.
"use strict";
const { guessHandleType } = require("bun:internal-for-testing");
const fds = process.argv.slice(2).map(Number);
process.stdout.write(JSON.stringify(fds.map(fd => guessHandleType(fd))) + "\n");
