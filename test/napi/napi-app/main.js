const tests = require("./module");
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

// pass GC runner as first argument
const result = fn.apply(null, [
  () => {
    if (process.isBun) {
      Bun.gc(true);
    } else if (global.gc) {
      global.gc();
    }
    console.log("GC did run");
  },
  ...eval(process.argv[3] ?? "[]"),
]);
if (result instanceof Promise) {
  result.then(x => console.log("resolved to", x));
} else if (result) {
  throw new Error(result);
}
