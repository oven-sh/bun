"use strict";
// usage: bun/node main.js <name of test function to run> [JSON array of arguments] [JSON `this` value] [debug]

const buildMode = process.argv[5];

const tests = require("./module")(buildMode === "debug");

const testName = process.argv[2];
const args = JSON.parse(process.argv[3] ?? "[]");
const thisValue = JSON.parse(process.argv[4] ?? "null");

function runGC() {
  if (typeof Bun !== "undefined") {
    Bun.gc(true);
  }
}

const fn = tests[testName];
if (typeof fn !== "function") {
  throw new Error("Unknown test:", testName);
}
const result = fn.apply(thisValue, [runGC, ...args]);
if (result) {
  console.log(result == global);
  throw new Error(result);
}
