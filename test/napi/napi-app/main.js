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
  process.exit(0);
});

// pass GC runner as first argument
try {
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
  } else if (result) {
    throw new Error(result);
  }
} catch (e) {
  console.error("synchronously threw:", e);
}
