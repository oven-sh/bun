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

process.on("uncaughtException", (error, _origin) => {
  console.log("uncaught exception:", error.toString());
  // 0 because one of the tests intentionally does this, and we don't want it to fail due to crashing
  process.exit(0);
});

// pass GC runner as first argument
try {
  // napi.test.ts:147 tries to read this variable and shouldn't be able to
  let shouldNotExist = 5;
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
    result
      .then(x => console.log("resolved to", x))
      .catch(e => {
        console.error("rejected:", e);
      });
    result.then(x => console.log("resolved to", x));
  } else if (process.argv[2] == "eval_wrapper") {
    // eval_wrapper just returns the result of the expression so it shouldn't be an error
    console.log(result);
  } else if (result) {
    throw new Error(result);
  }
} catch (e) {
  console.log(`synchronously threw ${e.name}: message ${JSON.stringify(e.message)}, code ${JSON.stringify(e.code)}`);
}
