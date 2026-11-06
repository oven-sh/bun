// Tests for the custom oxlint rules in scripts/oxlint-plugins/bun.js.
//
// The plugin is loaded via `jsPlugins` in oxlint.json and only enabled for
// src/js/** through an override. These tests exercise the rule directly by
// pointing oxlint at fixture files with a minimal config.

import { describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "fs";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import path from "path";

const root = path.resolve(import.meta.dir, "..", "..");
const pluginPath = path.join(root, "scripts", "oxlint-plugins", "bun.js");
// Use the pinned oxlint from the repo's devDependencies so the test is
// hermetic (no registry fetch) and version-locked to the jsPlugins API the
// plugin is written against.
const oxlintBin = path.join(root, "node_modules", "oxlint", "bin", "oxlint");
const RULE = "bun(no-duplicate-conditional-property-access)";

// oxlint ships a prebuilt NAPI binding that aborts when loaded under the
// ASAN build. What is under test is the lint result, not the runtime that
// hosts oxlint, so under ASAN run it with the release bun on PATH (CI agents
// and dev machines have one) and skip only when there is none. Also skip if
// the repo's devDependencies haven't been installed yet.
const runtime = isASAN ? releaseBunOnPath() : bunExe();
const skip = runtime === null || !existsSync(oxlintBin);
const describeOxlint = skip ? describe.skip : describe;

function releaseBunOnPath(): string | null {
  const found = Bun.which("bun");
  if (found === null || realpathSync(found) === realpathSync(bunExe())) return null;
  return found;
}

async function runOxlint(files: Record<string, string>) {
  using dir = tempDir("oxlint-plugin-bun", {
    ...files,
    "oxlint.json": JSON.stringify({
      jsPlugins: [pluginPath],
      categories: {},
      rules: {
        "bun/no-duplicate-conditional-property-access": "error",
        "bun/no-unused-expressions": "error",
      },
    }),
  });
  await using proc = Bun.spawn({
    cmd: [runtime!, oxlintBin, "--config=oxlint.json", "--format=github", "."],
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

  test("ignores bodies that write to the same property through a non-null assertion", async () => {
    const { stdout, stderr, exitCode } = await runOxlint({
      "writes.ts": `
declare const self: { count?: number; pos?: number; size?: number };
declare function use(value: number): void;
if (self.count === 0) {
  self.count!++;
}
if (self.pos !== undefined) {
  self.pos! += 1;
}
// a read through a non-null assertion is still a read (positive control)
if (self.size !== undefined) {
  use(self.size!);
}
`,
    });

    expect(stderr).not.toContain("Failed");
    expect(diagnostics(stdout)).toEqual([{ file: "writes.ts", line: 11, rule: RULE }]);
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

describeOxlint("bun/no-unused-expressions", () => {
  const RULE = "bun(no-unused-expressions)";

  test("flags a statement that is only a value", async () => {
    const { stdout, stderr, exitCode } = await runOxlint({
      "bad.ts": `
export function bad(a: any, b: any) {
  a.b;
  a === b;
  a?.b;
  a!;
  a as any;
  a && b();
  a ? b() : 0;
  \`x\`;
  "text";
}
`,
    });

    expect(stderr).not.toContain("Failed");
    expect(diagnostics(stdout)).toEqual(
      [3, 4, 5, 6, 7, 8, 9, 10, 11].map(line => ({ file: "bad.ts", line, rule: RULE })),
    );
    expect(exitCode).toBe(1);
  });

  test("allows a statement that does something, and a directive", async () => {
    const { stdout, stderr, exitCode } = await runOxlint({
      "good.js": `
"use strict";
export function good(a, b) {
  "use strict";
  a();
  a?.();
  a = b;
  new a();
  void a;
  delete a.b;
  a++;
}
`,
    });

    expect(stderr).not.toContain("Failed");
    expect(diagnostics(stdout)).toEqual([]);
    expect(exitCode).toBe(0);
  });

  test('allows "unlikely" only as the first statement of an arm of an if', async () => {
    const { stdout, stderr, exitCode } = await runOxlint({
      "marks.js": `
export function marks(a, b) {
  ("unlikely");
  if (a) {
    ("unlikely");
    b();
  } else if (b) {
    "unlikely";
    a();
  } else {
    ("unlikely");
    b();
  }
  if (a) {
    b();
    ("unlikely");
  }
  while (a) {
    ("unlikely");
  }
  {
    ("unlikely");
  }
  if (a) {
    ("likely");
  }
}
`,
    });

    expect(stderr).not.toContain("Failed");
    expect(diagnostics(stdout)).toEqual([3, 16, 19, 22, 25].map(line => ({ file: "marks.js", line, rule: RULE })));
    expect(exitCode).toBe(1);
  });
});

describeOxlint("src/js lint", () => {
  test("a statement that is only a value is an error in every built-in module outside src/js/builtins", async () => {
    await using proc = Bun.spawn({
      cmd: [runtime!, oxlintBin, "--config=oxlint.json", "--print-config", "src/js/node/fs.ts"],
      cwd: root,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const overrides: { files: string[]; rules?: Record<string, unknown> }[] = JSON.parse(stdout).overrides;
    const levels = overrides
      .filter(({ rules }) => rules && "bun/no-unused-expressions" in rules)
      .map(({ files, rules }) => [files, rules!["bun/no-unused-expressions"]]);
    expect(levels).toEqual([
      [["src/js/**"], expect.stringMatching(/^(error|deny)$/)],
      [["src/js/builtins/**"], expect.stringMatching(/^(off|allow)$/)],
    ]);
    expect(exitCode).toBe(0);
  });

  // End-to-end: the repo's own oxlint config, against src/js, should be
  // clean. Existing instances of the pattern were refactored to read the
  // property into a local before the check; this guards against new ones.
  test("bun run lint is clean on src/js", async () => {
    await using proc = Bun.spawn({
      cmd: [runtime!, oxlintBin, "--config=oxlint.json", "--format=github", "src/js"],
      cwd: root,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).not.toContain("Failed");
    expect({ stdout, exitCode }).toEqual({ stdout: expect.stringContaining("0 errors"), exitCode: 0 });
  });
});
