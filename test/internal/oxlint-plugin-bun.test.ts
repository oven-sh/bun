// Tests for the custom oxlint rules in scripts/oxlint-plugins/bun.js.
//
// The plugin is loaded via `jsPlugins` in oxlint.json; overrides there enable
// no-duplicate-conditional-property-access for src/js/** and no-unused-expect
// for test/**. These tests exercise each rule directly by pointing oxlint at
// fixture files with a minimal config, then check the repo itself is clean.

import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import path from "path";

const root = path.resolve(import.meta.dir, "..", "..");
const pluginPath = path.join(root, "scripts", "oxlint-plugins", "bun.js");
// Use the pinned oxlint from the repo's devDependencies so the test is
// hermetic (no registry fetch) and version-locked to the jsPlugins API the
// plugin is written against.
const oxlintBin = path.join(root, "node_modules", "oxlint", "bin", "oxlint");
const RULE = "bun(no-duplicate-conditional-property-access)";
const EXPECT_RULE = "bun(no-unused-expect)";

// oxlint ships a prebuilt NAPI binding that aborts when loaded under the
// ASAN build; the rule is still enforced in CI by the Lint JavaScript
// workflow (release bun), so skip here. Also skip if the repo's
// devDependencies haven't been installed yet.
const skip = isASAN || !existsSync(oxlintBin);
const describeOxlint = skip ? describe.skip : describe;

// The tests stay serial on purpose: every oxlint process starts a thread per
// core plus a JS runtime for the plugin, and a dozen of them at once ran into
// the thread limit of a constrained container (pthread_create failed, abort).
async function runOxlint(files: Record<string, string>, rule = "bun/no-duplicate-conditional-property-access") {
  using dir = tempDir("oxlint-plugin-bun", {
    ...files,
    "oxlint.json": JSON.stringify({
      jsPlugins: [pluginPath],
      // Only the rule under test: oxlint's default rule set would otherwise
      // still run (as warnings) and muddy the output.
      categories: { correctness: "off" },
      rules: {
        [rule]: "error",
      },
    }),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), oxlintBin, "--config=oxlint.json", "--format=github", "."],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function diagnostics(stdout: string) {
  const out: { file: string; line: number; rule: string }[] = [];
  for (const m of stdout.matchAll(/::error file=([^,]+),line=(\d+),[^:]*title=([^:]+)::/g)) {
    out.push({ file: m[1], line: parseInt(m[2], 10), rule: m[3] });
  }
  return out;
}

describeOxlint("bun/no-duplicate-conditional-property-access", () => {
  test("flags re-reading the property inside the if body", async () => {
    const { stdout, stderr, exitCode } = await runOxlint({
      "bad.js": `
let fragment, unicode, search, auth;
if (options.fragment != null) {
  fragment = Boolean(options.fragment);
}
if (options.unicode != null) {
  unicode = Boolean(options.unicode);
}
if (options.search != null) {
  search = Boolean(options.search);
}
if (options.auth != null) {
  auth = Boolean(options.auth);
}
// without braces
if (options.x !== undefined) x = options.x;
// null on the left
if (null != options.y) y = options.y;
// truthy check
if (options.cert) throwIfInvalid("cert", options.cert);
// numeric comparison
if (parser.maxHeaderPairs > 0) n = Math.min(n, parser.maxHeaderPairs);
// typeof check
if (typeof options.enc === "string") use(options.enc);
// multi-statement body
if (options.port != null) {
  server.listen(options.port, options.host);
  started = true;
}
// nested property chain
if (this.a.b != null) {
  use(this.a.b);
}
`,
    });

    expect(stderr).not.toContain("Failed");
    expect(diagnostics(stdout)).toEqual([
      { file: "bad.js", line: 3, rule: RULE },
      { file: "bad.js", line: 6, rule: RULE },
      { file: "bad.js", line: 9, rule: RULE },
      { file: "bad.js", line: 12, rule: RULE },
      { file: "bad.js", line: 16, rule: RULE },
      { file: "bad.js", line: 18, rule: RULE },
      { file: "bad.js", line: 20, rule: RULE },
      { file: "bad.js", line: 22, rule: RULE },
      { file: "bad.js", line: 24, rule: RULE },
      { file: "bad.js", line: 26, rule: RULE },
      { file: "bad.js", line: 31, rule: RULE },
    ]);
    expect(exitCode).toBe(1);
  });

  test("ignores destructured locals, different properties, nested functions, computed access, and method calls", async () => {
    const { stdout, stderr, exitCode } = await runOxlint({
      "good.js": `
const { fragment: fragmentOption } = options;
if (fragmentOption != null) {
  fragment = Boolean(fragmentOption);
}
// different property inside the body
if (options.a != null) {
  b = options.c;
}
// access is inside a nested function (runs later, different scope)
if (options.cb != null) {
  register(() => options.cb());
}
// computed access cannot be destructured
if (options[key] != null) {
  v = options[key];
}
// optional chaining
if (a?.b != null) {
  use(a?.b);
}
// condition reads the property, body only calls it as a method:
// caching in a local would lose the receiver.
if (obj.handler) {
  obj.handler();
}
// condition calls the property as a method (no cacheable value read)
if (obj.check()) {
  use(obj.check);
}
// inline-assignment in the condition is the recommended fix; a
// short-circuit fallback read in the body preserves the original
// access timing and should not be flagged.
let prop;
if (other || (prop = obj.prop)) {
  use(prop ?? obj.prop);
}
`,
    });

    expect(stderr).not.toContain("Failed");
    expect(diagnostics(stdout)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test("ignores bodies that write to the same property", async () => {
    const { stdout, stderr, exitCode } = await runOxlint({
      "writes.js": `
// simple assignment to the property: caching would change semantics
if (obj.x != null) {
  use(obj.x);
  obj.x = null;
}
// compound assignment
if (self.pos !== undefined) {
  self.pos += n;
}
// update expression
if (self.count !== undefined) {
  self.count++;
}
// delete: not a [[Get]], and a cached local cannot replace the delete
if (obj.y != null) {
  delete obj.y;
}
// pure read with no write-back: still flagged (positive control)
if (map.entry != null) {
  entries.push(map.entry);
}
`,
    });

    expect(stderr).not.toContain("Failed");
    // Only the last case (a pure read with no write-back) should fire.
    expect(diagnostics(stdout)).toEqual([{ file: "writes.js", line: 20, rule: RULE }]);
    expect(exitCode).toBe(1);
  });

  test("inline disable comment suppresses the diagnostic", async () => {
    const { stdout, stderr, exitCode } = await runOxlint({
      "suppressed.js": `
// oxlint-disable-next-line bun/no-duplicate-conditional-property-access
if (options.a != null) x = options.a;
if (options.b != null) y = options.b;
`,
    });

    expect(stderr).not.toContain("Failed");
    expect(diagnostics(stdout)).toEqual([{ file: "suppressed.js", line: 4, rule: RULE }]);
    expect(exitCode).toBe(1);
  });

  test("diagnostic message suggests destructuring the base object", async () => {
    const { stdout, exitCode } = await runOxlint({
      "msg.js": `if (options.fragment != null) { x = options.fragment; }\n`,
    });
    expect(stdout).toContain("`options.fragment` is read in the `if` condition and again in the body");
    expect(stdout).toContain("const { fragment } = options");
    expect(exitCode).toBe(1);
  });
});

describeOxlint("bun/no-unused-expect", () => {
  const runExpectRule = (files: Record<string, string>) => runOxlint(files, "bun/no-unused-expect");

  test("flags an expectation that is discarded without calling a matcher", async () => {
    const { stdout, stderr, exitCode } = await runExpectRule({
      "bad.test.ts": `import { expect, test } from "bun:test";
test("x", async () => {
  expect(value);
  expect(actual, expected);
  expect(
    await longerExpression(),
  );
  await expect(promise);
  expect(value).toBe;
  expect(fn).not.toThrow;
  expect(value).not;
  await expect(promise).resolves;
  expect(value)["toBe"];
  expect(value)!;
  expect(value) as any;
  expect(value)?.toBe;
  condition && expect(value);
  condition ? expect(a) : expect(b);
  (expect(value), other());
  other(), expect(value);
});
`,
    });

    expect(stderr).not.toContain("Failed");
    const found = diagnostics(stdout);
    expect(found.map(d => d.line).sort((a, b) => a - b)).toEqual([
      3, 4, 5, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 18, 19, 20,
    ]);
    expect(new Set(found.map(d => `${d.file} ${d.rule}`))).toEqual(new Set([`bad.test.ts ${EXPECT_RULE}`]));
    expect(exitCode).toBe(1);
  });

  test("ignores expectations whose matcher is called or whose value is used", async () => {
    const { stdout, stderr, exitCode } = await runExpectRule({
      "good.test.ts": `import { expect, test } from "bun:test";
test("x", async () => {
  expect(value).toBe(1);
  // bun's second argument is a failure message; fine when a matcher follows
  expect(value, "message").toBe(1);
  expect(fn).not.toThrow();
  await expect(promise).resolves.toBe(1);
  await expect(promise).rejects.toThrow();
  expect(value)!.toBe(1);
  (expect(value) as any).toBe(1);
  expect(value)?.toBe(1);
  expect(value)["toBe"](1);
  expect().fail("unreachable");
  expect.assertions(1);
  expect.unreachable();
  condition && expect(value).toBe(1);
  // The expectation escapes; whoever receives it is responsible for it.
  const e = expect(value);
  e.toBe(1);
  helper(expect(value));
  const make = () => expect(value);
  make().toBe(1);
  if (expect(value)) return;
  return expect(value);
});
// Positive control: the only line above that should be reported.
expect(value);
`,
    });

    expect(stderr).not.toContain("Failed");
    expect(diagnostics(stdout)).toEqual([{ file: "good.test.ts", line: 27, rule: EXPECT_RULE }]);
    expect(exitCode).toBe(1);
  });

  test("recognizes every way a test file gets hold of bun:test's expect", async () => {
    const { stdout, stderr, exitCode } = await runExpectRule({
      "global.test.js": `test("x", () => { expect(value); });\n`,
      "required.test.js": `const { test, expect } = require("bun:test");\nexpect(value);\n`,
      "jest-globals.test.js": `import { expect } from "@jest/globals";\nexpect(value);\n`,
      "vitest.test.js": `import { expect } from "vitest";\nexpect(value);\n`,
      "harness.ts": `export function make(path) {\n  const { expect } = Bun.jest(path);\n  expect(value);\n}\n`,
    });

    expect(stderr).not.toContain("Failed");
    expect(diagnostics(stdout).sort((a, b) => a.file.localeCompare(b.file))).toEqual([
      { file: "global.test.js", line: 1, rule: EXPECT_RULE },
      { file: "harness.ts", line: 3, rule: EXPECT_RULE },
      { file: "jest-globals.test.js", line: 2, rule: EXPECT_RULE },
      { file: "required.test.js", line: 2, rule: EXPECT_RULE },
      { file: "vitest.test.js", line: 2, rule: EXPECT_RULE },
    ]);
    expect(exitCode).toBe(1);
  });

  test("ignores an `expect` that is not bun:test's", async () => {
    const { stdout, stderr, exitCode } = await runExpectRule({
      // Node's own tests name expected values `expect`.
      "declared.js": `function expect(value) { return value; }\nexpect(value);\n`,
      "assigned.js": `const expect = makeExpect();\nexpect(value);\n`,
      "other-module.js": `import { expect } from "chai";\nexpect(value);\nexpect(value).to.be.ok;\n`,
      "other-require.js": `const { expect } = require("chai");\nexpect(value);\n`,
      "parameter.test.js": `import { test } from "bun:test";
test("x", () => {
  const check = expect => {
    expect(value);
  };
  check(x);
});
// Positive control: outside \`check\`, \`expect\` is the injected global again.
expect(value);
`,
    });

    expect(stderr).not.toContain("Failed");
    expect(diagnostics(stdout)).toEqual([{ file: "parameter.test.js", line: 9, rule: EXPECT_RULE }]);
    expect(exitCode).toBe(1);
  });

  test("inline disable comment suppresses the diagnostic", async () => {
    const { stdout, stderr, exitCode } = await runExpectRule({
      "suppressed.test.ts": `import { expect } from "bun:test";
// oxlint-disable-next-line bun/no-unused-expect
expect(counted);
expect(uncounted);
`,
    });

    expect(stderr).not.toContain("Failed");
    expect(diagnostics(stdout)).toEqual([{ file: "suppressed.test.ts", line: 4, rule: EXPECT_RULE }]);
    expect(exitCode).toBe(1);
  });

  test("diagnostic messages name the mistake", async () => {
    const { stdout, exitCode } = await runExpectRule({
      "msg.test.ts": `import { expect } from "bun:test";
expect(value);
expect(actual, expected);
expect(fn).toThrow;
`,
    });
    expect(stdout).toContain("This `expect(...)` never calls a matcher");
    expect(stdout).toContain("The second argument of `expect()` is a failure message, not an expected value");
    expect(stdout).toContain("`.toThrow` is read but not called");
    expect(exitCode).toBe(1);
  });
});

describeOxlint("repo lint", () => {
  async function lint(args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), oxlintBin, "--config=oxlint.json", "--format=github", ...args],
      cwd: root,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("Failed");
    return { stdout, exitCode };
  }

  // End-to-end: the repo's own oxlint config, against src/js, should be
  // clean. Existing instances of the pattern were refactored to read the
  // property into a local before the check; this guards against new ones.
  test("bun run lint:src is clean on src/js", async () => {
    expect(await lint(["src/js"])).toEqual({ stdout: expect.stringContaining(" and 0 errors."), exitCode: 0 });
  });

  // Same invocation as the `lint:test` script: `-A all` turns off oxlint's
  // built-in rules (test/ is not clean under them), leaving the test/**
  // override's plugin rules.
  test("bun run lint:test is clean on test/", async () => {
    expect(await lint(["-A", "all", "test"])).toEqual({
      stdout: expect.stringContaining(" and 0 errors."),
      exitCode: 0,
    });
  });
});
