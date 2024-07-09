const tests = require("./build/Release/napitests.node");
if (process.argv[2] === "self") {
  console.log(
    tests(function (str) {
      return str + "!";
    }),
  );
  process.exit(0);
}
const fn = tests[process.argv[2]];
if (typeof fn !== "function") {
  throw new Error("Unknown test:", process.argv[2]);
}
const result = fn.apply(null, JSON.parse(process.argv[3] ?? "[]"));
if (result) {
  throw new Error(result);
}
