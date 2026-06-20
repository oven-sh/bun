// Tests for the custom oxlint rules in scripts/oxlint-plugins/bun.js.
//
// The plugin is loaded via `jsPlugins` in oxlint.json and only enabled for
// src/js/** through an override. These tests exercise the rule directly by
// pointing oxlint at fixture files with a minimal config.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

const root = path.resolve(import.meta.dir, "..", "..");
const pluginPath = path.join(root, "scripts", "oxlint-plugins", "bun.js");

async function runOxlint(files: Record<string, string>) {
  using dir = tempDir("oxlint-plugin-bun", {
    ...files,
    "oxlint.json": JSON.stringify({
      jsPlugins: [pluginPath],
      categories: {},
      rules: {
        "bun/no-duplicate-nullish-property-access": "error",
      },
    }),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "x", "oxlint", "--config=oxlint.json", "--format=github", "."],
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

describe("bun/no-duplicate-nullish-property-access", () => {
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
// void 0
if (options.z !== void 0) z = options.z;
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
      { file: "bad.js", line: 3, rule: "bun(no-duplicate-nullish-property-access)" },
      { file: "bad.js", line: 6, rule: "bun(no-duplicate-nullish-property-access)" },
      { file: "bad.js", line: 9, rule: "bun(no-duplicate-nullish-property-access)" },
      { file: "bad.js", line: 12, rule: "bun(no-duplicate-nullish-property-access)" },
      { file: "bad.js", line: 16, rule: "bun(no-duplicate-nullish-property-access)" },
      { file: "bad.js", line: 18, rule: "bun(no-duplicate-nullish-property-access)" },
      { file: "bad.js", line: 20, rule: "bun(no-duplicate-nullish-property-access)" },
      { file: "bad.js", line: 22, rule: "bun(no-duplicate-nullish-property-access)" },
      { file: "bad.js", line: 27, rule: "bun(no-duplicate-nullish-property-access)" },
    ]);
    expect(exitCode).toBe(1);
  });

  test("ignores destructured locals, different properties, nested functions, computed access, and non-nullish checks", async () => {
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
// not a null/undefined comparison
if (options.count > 0) {
  c = options.count;
}
// equality (== null) rather than inequality
if (obj.prop == null) {
  use(obj.prop);
}
// optional chaining
if (a?.b != null) {
  use(a?.b);
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
    expect(diagnostics(stdout)).toEqual([
      { file: "writes.js", line: 20, rule: "bun(no-duplicate-nullish-property-access)" },
    ]);
    expect(exitCode).toBe(1);
  });

  test("inline disable comment suppresses the diagnostic", async () => {
    const { stdout, stderr, exitCode } = await runOxlint({
      "suppressed.js": `
// oxlint-disable-next-line bun/no-duplicate-nullish-property-access
if (options.a != null) x = options.a;
if (options.b != null) y = options.b;
`,
    });

    expect(stderr).not.toContain("Failed");
    expect(diagnostics(stdout)).toEqual([
      { file: "suppressed.js", line: 4, rule: "bun(no-duplicate-nullish-property-access)" },
    ]);
    expect(exitCode).toBe(1);
  });

  test("diagnostic message suggests destructuring the base object", async () => {
    const { stdout, exitCode } = await runOxlint({
      "msg.js": `if (options.fragment != null) { x = options.fragment; }\n`,
    });
    expect(stdout).toContain("`options.fragment` is read again inside `if (options.fragment != null)`");
    expect(stdout).toContain("const { fragment } = options");
    expect(exitCode).toBe(1);
  });
});

describe("src/js lint", () => {
  // End-to-end: the repo's own oxlint config, against src/js, should be
  // clean. Existing instances of the pattern carry an inline disable
  // comment; this guards against new ones being introduced.
  test("bun run lint is clean on src/js", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "x", "oxlint", "--config=oxlint.json", "--format=github", "src/js"],
      cwd: root,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: expect.stringContaining("0 errors"), stderr: "" });
    expect(exitCode).toBe(0);
  });
});
