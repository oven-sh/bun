const tests = require("./build/Release/napitests.node");
const fn = tests[process.argv[2]];
if (typeof fn !== "function") {
  throw new Error("Unknown test:", process.argv[2]);
}
const result = fn.apply(null, JSON.parse(process.argv[3] ?? "[]"));
if (result) {
  throw new Error(result);
}
