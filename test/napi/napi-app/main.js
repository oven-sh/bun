const assert = require("node:assert/strict");
const assertEmbedded = process.argv[3] === "--assert-embedded";
const originalDlopen = process.dlopen;
let embeddedAddonLoads = 0;
if (assertEmbedded) {
  process.dlopen = function (...args) {
    const prefix = process.platform === "win32" ? "B:/~BUN/" : "/$bunfs/";
    assert.ok(args[1].startsWith(prefix), args[1]);
    embeddedAddonLoads++;
    return Reflect.apply(originalDlopen, this, args);
  };
}
const tests = require("./module");
if (assertEmbedded) {
  process.dlopen = originalDlopen;
  assert.equal(embeddedAddonLoads, 5);
  const filename = require("node:url").fileURLToPath(tests.test_napi_module_filename());
  assert.equal(require("node:path").dirname(filename), process.env.BUN_TMPDIR);
}
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
  } else if (process.argv[2] == "eval_wrapper") {
    // eval_wrapper just returns the result of the expression so it shouldn't be an error
    console.log(result);
  } else if (result) {
    throw new Error(result);
  }
} catch (e) {
  console.log(`synchronously threw ${e.name}: message ${JSON.stringify(e.message)}, code ${JSON.stringify(e.code)}`);
}
