"use strict";
// usage: bun/node main.js <name of test function to run> [JSON array of arguments] [JSON `this` value] [debug]

// Node makes a piped stdout non-blocking on POSIX, and the addon writes to fd 1 directly: a native
// write that gets EAGAIN is lost. Keep it blocking. Not under Bun, where reading process.stdout is
// what makes fd 1 non-blocking.
if (!process.isBun) process.stdout._handle?.setBlocking?.(true);

const buildMode = process.argv[5];

const tests = require("./module")(buildMode === "debug");

const testName = process.argv[2];
const args = eval(process.argv[3] ?? "[]");
const thisValue = JSON.parse(process.argv[4] ?? "null");

const fn = tests[testName];
if (typeof fn !== "function") {
  throw new Error("Unknown test:", testName);
}
const result = fn.apply(thisValue, [...args]);
if (result) {
  console.log(result == global);
  throw new Error(result);
}
