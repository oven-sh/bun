import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/3179
// Legal comments (/*!...*/) should not prevent the module.exports = require() redirect optimization

test("legal comments do not break module.exports = require() redirect", async () => {
  using dir = tempDir("issue-3179", {
    // Wrapper module WITH legal comment
    "with-comment.js": `/*!
 * express
 * MIT Licensed
 */

'use strict';

module.exports = require('./lib/express');
`,
    // Wrapper module WITHOUT legal comment
    "without-comment.js": `'use strict';

module.exports = require('./lib/express');
`,
    // The actual module being wrapped
    "lib/express.js": `function createApp() {
  return { name: 'app' };
}
module.exports = createApp;
`,
    // Entry point using the module with legal comment
    "entry-with.js": `const express = require('./with-comment');
console.log(express());
`,
    // Entry point using the module without legal comment
    "entry-without.js": `const express = require('./without-comment');
console.log(express());
`,
  });

  // Bundle both variants
  await using procWith = Bun.spawn({
    cmd: [bunExe(), "build", "entry-with.js", "--outfile=out-with.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  await using procWithout = Bun.spawn({
    cmd: [bunExe(), "build", "entry-without.js", "--outfile=out-without.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdoutWith, stderrWith, exitCodeWith] = await Promise.all([
    procWith.stdout.text(),
    procWith.stderr.text(),
    procWith.exited,
  ]);

  const [stdoutWithout, stderrWithout, exitCodeWithout] = await Promise.all([
    procWithout.stdout.text(),
    procWithout.stderr.text(),
    procWithout.exited,
  ]);

  expect(exitCodeWith).toBe(0);
  expect(exitCodeWithout).toBe(0);

  // Read the generated bundles
  const outWith = await Bun.file(`${dir}/out-with.js`).text();
  const outWithout = await Bun.file(`${dir}/out-without.js`).text();

  // Both bundles should have the same number of "// " module comment markers
  // If the redirect optimization is working, neither should create a wrapper function
  const moduleCountWith = (outWith.match(/\/\/ /g) || []).length;
  const moduleCountWithout = (outWithout.match(/\/\/ /g) || []).length;

  // The key test: both should have the same number of modules bundled
  // Before the fix, "with-comment" would bundle 3 modules instead of 2
  expect(moduleCountWith).toBe(moduleCountWithout);

  // Both should NOT contain a require_with_comment or require_without_comment wrapper
  expect(outWith).not.toContain("require_with_comment");
  expect(outWithout).not.toContain("require_without_comment");
});

test("legal comment with only module.exports = require()", async () => {
  using dir = tempDir("issue-3179-simple", {
    "wrapper.js": `/*!
 * Legal comment
 */
module.exports = require('./target');
`,
    "target.js": `module.exports = { foo: 'bar' };
`,
    "entry.js": `const wrapper = require('./wrapper');
console.log(wrapper.foo);
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--outfile=out.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  const out = await Bun.file(`${dir}/out.js`).text();

  // Should not contain a wrapper function - the redirect optimization should work
  expect(out).not.toContain("require_wrapper");
});

test("multiple legal comments and directives do not break redirect", async () => {
  using dir = tempDir("issue-3179-multiple", {
    "wrapper.js": `/*!
 * First legal comment
 */

/*!
 * Second legal comment
 */

'use strict';

module.exports = require('./target');
`,
    "target.js": `module.exports = function() { return 42; };
`,
    "entry.js": `const fn = require('./wrapper');
console.log(fn());
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--outfile=out.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  const out = await Bun.file(`${dir}/out.js`).text();

  // Should not contain a wrapper function
  expect(out).not.toContain("require_wrapper");
});
