"use strict";
// usage: bun/node main.js <name of test function to run> [JSON array of arguments] [JSON `this` value] [debug]

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
