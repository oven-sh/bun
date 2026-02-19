import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("use strict in function body is preserved in CJS transpilation", async () => {
  using dir = tempDir("issue-19490", {
    "strict_module.js": `
;(function(root, factory) {
  if (typeof exports === "object") {
    module.exports = factory();
  }
}(this, function() {
  "use strict";
  var fn = function() { return typeof this; };
  return { fn: fn };
}));
`,
    "test.js": `
var mod = require("./strict_module.js");
var result = mod.fn.apply("hello");
console.log(result);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // In strict mode, `this` is not boxed, so typeof this === "string"
  // In sloppy mode, `this` is boxed to String object, so typeof this === "object"
  expect(stdout.trim()).toBe("string");
  expect(exitCode).toBe(0);
});

test("json-logic-js style UMD with use strict works correctly", async () => {
  using dir = tempDir("issue-19490-umd", {
    "logic.js": `
;(function(root, factory) {
  if (typeof exports === "object") {
    module.exports = factory();
  }
}(this, function() {
  "use strict";

  var arrayUnique = function(array) {
    var a = [];
    for (var i = 0, l = array.length; i < l; i++) {
      if (a.indexOf(array[i]) === -1) {
        a.push(array[i]);
      }
    }
    return a;
  };

  var operations = {
    "some": function(data, values) {
      var dominated = values[0];
      var rule = values[1];

      for (var i = 0; i < dominated.length; i++) {
        // In strict mode, apply with a string keeps this as a string
        // In sloppy mode, it gets boxed to a String object
        if (applyRule.apply(dominated[i], [rule])) {
          return true;
        }
      }
      return false;
    }
  };

  function applyRule(rule) {
    if (typeof rule === "object" && rule !== null && "===" in rule) {
      var args = rule["==="];
      var left = args[0];
      var right = args[1];
      // When left is { var: "" }, resolve to \`this\`
      if (typeof left === "object" && "var" in left && left["var"] === "") {
        left = this;
      }
      return left === right;
    }
    return false;
  }

  return {
    apply: function(rules) {
      if (typeof rules === "object" && rules !== null && "some" in rules) {
        return operations["some"](null, rules["some"]);
      }
      return null;
    }
  };
}));
`,
    "test.js": `
var logic = require("./logic.js");
var result = logic.apply({
  some: [
    ["hello", "world"],
    { "===": [{ var: "" }, "hello"] }
  ]
});
console.log(result);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("true");
  expect(exitCode).toBe(0);
});
