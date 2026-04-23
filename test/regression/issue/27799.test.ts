import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("onLoad plugin returning CJS contents works with require()", async () => {
  using dir = tempDir("issue-27799", {
    "plugin.js": `
Bun.plugin({
  name: "cjs-patch",
  setup(build) {
    build.onLoad({ filter: /tiny-module\\.js$/ }, () => {
      return {
        loader: "js",
        contents: \`
module.exports.greet = function greet(name) { return "patched hello " + name; }
module.exports.add = function add(a, b) { return a + b + a; }
\`,
      };
    });
  },
});
`,
    "tiny-module.js": `
module.exports.greet = function greet(name) {
    return "hello " + name;
}
module.exports.add = function add(a, b) {
    return a + b;
}
`,
    "run-demo.js": `
const { greet, add } = require('./tiny-module');
console.log(greet('world'));
console.log(add(1, 2));
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload=./plugin.js", "run-demo.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("patched hello world\n4\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
