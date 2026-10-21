// `/** @private */ this.a = v` in a class of a JavaScript file: the tag is a modifier of the assignment. typescript-go
// reads it into the tree as one, so a rule that asks for the modifiers of a declaration gets it from tsgolint.
//
// The lines are what oxlint 1.87.0 prints with tsgolint 7.0.2004 (`oxlint --type-aware -f unix a.js`).
//
// In a file of its own, with a project that loads no library: a debug build then lints it within the five seconds that
// a test has by default.
import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, GITHUB_ACTIONS: undefined };

// Instead of the library files, which a debug build takes seconds to read.
const globals = "Array<T> Boolean CallableFunction Function IArguments NewableFunction Number Object RegExp String"
  .split(" ")
  .map(name => `interface ${name} {}\n`)
  .join("");

test('typescript/dot-notation allows `this["a"]` for a property that `@private` or `@protected` declares', async () => {
  const allowed = { allowPrivateClassPropertyAccess: true, allowProtectedClassPropertyAccess: true };
  using dir = tempDir("bun-lint-jsdoc-modifier-tags", {
    ".oxlintrc.json": JSON.stringify({ rules: { "typescript/dot-notation": ["error", allowed] } }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, noLib: true, types: [], allowJs: true, checkJs: true, noEmit: true },
      include: ["*"],
    }),
    "globals.d.ts": globals,
    "a.js": `export class C {
  constructor() {
    /** @private */
    this.secret = 1;
    /** @protected */
    this.inherited = 2;
    /** @readonly */
    this.fixed = 3;
    this.open = 4;
  }
  sum() {
    return this["secret"] + this["inherited"] + this["fixed"] + this["open"];
  }
}
`,
  });
  await using proc = spawn({
    cmd: [bunExe(), "lint", "--type-aware", "-f", "unix", "a.js"],
    env,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.split("\n").filter(line => line.trim()), stderr, exitCode }).toEqual({
    stdout: [
      'a.js:12:54: ["fixed"] is better written in dot notation. [Error/typescript(dot-notation)]',
      'a.js:12:70: ["open"] is better written in dot notation. [Error/typescript(dot-notation)]',
      "2 problems",
    ],
    stderr: "",
    exitCode: 1,
  });
});
