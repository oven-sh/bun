// --disallow-code-generation-from-strings in a command that does not run a program. The level is the process's,
// whichever command the process runs. Such a command does not have the flag among its own: for it the flag is one of
// `bun`, which BUN_OPTIONS adds or which stands before the command.
// What each level refuses in a program is in test/js/node/disallow-code-generation-from-strings.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const flag = "--disallow-code-generation-from-strings";
const strict = flag + "=strict";
const mistyped = flag + "=strcit";
const invalidValue = `error: Invalid value for ${flag}: "strcit". Must be "strict", or no value\n`;
// A build of Bun configured with codeGenerationFromStrings off (scripts/build/config.ts) has =strict as a constant.
const builtStrict =
  Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `try { new (require("node:vm").Script)("1"); console.log(false); } catch { console.log(true); }`,
    ],
    env: bunEnv,
  })
    .stdout.toString()
    .trim() === "true";

// The package manager looks up its registry when it starts. No row has a package to download.
let registry: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  registry = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) });
});
afterAll(() => registry.stop(true));

async function run(files: Record<string, string>, cmd: readonly string[], env: Record<string, string> = {}) {
  using dir = tempDir("disallow-code-generation-cli", files);
  const cwd = String(dir);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: registry.url.href,
      // What a command keeps for the user stays in the directory of the row.
      HOME: cwd,
      USERPROFILE: cwd,
      BUN_INSTALL: join(cwd, ".bun"),
      ...env,
    },
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const marker = join(cwd, "MACRO_RAN");
  return {
    stdout,
    stderr,
    exitCode,
    // What eval() did in the macro, if the macro ran.
    macro: existsSync(marker) ? readFileSync(marker, "utf8") : null,
    // One of the files that `bun create <component>` writes.
    created: existsSync(join(cwd, "App.html")),
  };
}

// `bun install --analyze` and `bun create <component>` bundle, a bundle calls macros, and the entry point of a macro
// is text made at run time.
describe.concurrent.skipIf(builtStrict)("a command that bundles", () => {
  const files = {
    "macro.ts": `
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      export function f() {
        let evaluated;
        try { evaluated = "made " + eval("1 + 1"); } catch { evaluated = "refused"; }
        writeFileSync(join(import.meta.dir, "MACRO_RAN"), evaluated);
        return "INLINED_RESULT";
      }
    `,
    "entry.ts": `import { f } from "./macro.ts" with { type: "macro" };\nconsole.log(f());\n`,
    "plain.ts": `console.log(1);\n`,
    "App.tsx": `import { f } from "./macro.ts" with { type: "macro" };\nexport default function App() {\n  return <div>{f()}</div>;\n}\n`,
    "package.json": JSON.stringify({ name: "bundles", version: "1.0.0" }),
  };
  const bundle = (cmd: readonly string[], env?: Record<string, string>) => run(files, cmd, env);
  const analyze = ["install", "--analyze", "./entry.ts"];

  // =strict: no macro runs.
  const refusedMacro = {
    stderr: expect.stringContaining(`error: Macros cannot be used with ${strict}`),
    macro: null,
    created: false,
    exitCode: 1,
  };
  // `--analyze` exits from inside the scan of the bundler, and LeakSanitizer reports what the scan has allocated.
  const done = isASAN ? expect.any(Number) : 0;
  // The level of Node.js's flag: the macro runs, and eval() throws in it as it does in a program.
  const asNode = { macro: "refused", exitCode: done };
  const allowed = { macro: "made 2", exitCode: done };

  test.each([
    ["bun install --analyze, =strict in BUN_OPTIONS", analyze, { BUN_OPTIONS: strict }],
    ["bun add --analyze, =strict in BUN_OPTIONS", ["add", "--analyze", "./entry.ts"], { BUN_OPTIONS: strict }],
    ["bun create <component>, =strict in BUN_OPTIONS", ["create", "./App.tsx"], { BUN_OPTIONS: strict }],
    ["bun =strict create <component>", [strict, "create", "./App.tsx"], {}],
    ["bun --cwd=<dir> =strict create <component>", ["--cwd=.", strict, "create", "./App.tsx"], {}],
    // `bun create` takes a flag wherever it stands.
    ["bun create =strict <component>", ["create", strict, "./App.tsx"], {}],
    ["bun create <component> =strict", ["create", "./App.tsx", strict], {}],
    // Before `create` it is a flag of `bun`, and after it one of `bun create`. The higher level holds.
    ["bun =strict create <component> <the flag>", [strict, "create", "./App.tsx", flag], {}],
    // A `--` before `create` ends the flags of `bun`, not those of `bun create`.
    ["bun -- create <component> =strict", ["--", "create", "./App.tsx", strict], {}],
    // Given more than once among the flags of `bun`, the last counts, as for `bun <file>`.
    ["bun install --analyze: the flag, then =strict, in BUN_OPTIONS", analyze, { BUN_OPTIONS: `${flag} ${strict}` }],
  ] as const)("%s refuses a macro", async (_, cmd, env) => {
    expect(await bundle(cmd, env)).toMatchObject(refusedMacro);
  });

  test.each([
    ["bun install --analyze", analyze, {}, allowed],
    ["bun install --analyze, the flag in BUN_OPTIONS", analyze, { BUN_OPTIONS: flag }, asNode],
    // `bun build` parses what BUN_OPTIONS adds with its own flags, which do not have this one.
    ["bun build, =strict in BUN_OPTIONS", ["build", "./entry.ts"], { BUN_OPTIONS: strict }, allowed],
    [
      "bun install --analyze: =strict, then the flag, in BUN_OPTIONS",
      analyze,
      { BUN_OPTIONS: `${strict} ${flag}` },
      asNode,
    ],
  ] as const)("%s runs a macro", async (_, cmd, env, expected) => {
    expect(await bundle(cmd, env)).toMatchObject(expected);
  });

  test("bun install --analyze of a file without a macro, =strict in BUN_OPTIONS", async () => {
    expect(await bundle(["install", "--analyze", "./plain.ts"], { BUN_OPTIONS: strict })).toMatchObject({
      stderr: expect.not.stringContaining("error:"),
      exitCode: done,
    });
  });

  // A command of the package manager does not take the flag on its command line, whatever its value.
  test.each([
    ["=strict before the command", [strict, ...analyze]],
    ["=strict after the command", ["install", "--analyze", strict, "./entry.ts"]],
    ["a value other than strict before the command", [mistyped, ...analyze]],
  ] as const)("bun install --analyze with %s is an error, and no macro runs", async (_, cmd) => {
    expect(await bundle(cmd)).toMatchObject({
      stderr: expect.stringContaining(`error: bun install has no ${flag} flag.`),
      macro: null,
      exitCode: 1,
    });
  });

  // `--` ends the flags of `bun create`. On Windows the command fails after its bundle, where it writes `App.build.ts`.
  test("bun create <component> -- =strict runs a macro", async () => {
    expect(await bundle(["create", "./App.tsx", "--", strict])).toMatchObject(
      isWindows ? { macro: "made 2" } : { macro: "made 2", created: true },
    );
  });

  // What follows the name of a template from npm goes to the template, which this registry does not have.
  test.each([
    [
      "after the name of the template",
      ["create", "some-template", "dest", mistyped],
      expect.not.stringContaining("Invalid value"),
    ],
    ["before the name of the template", ["create", mistyped, "some-template", "dest"], invalidValue],
  ] as const)("bun create <template>: a value other than strict %s", async (_, cmd, stderr) => {
    expect(await bundle(cmd)).toMatchObject({ stderr, exitCode: 1 });
  });
});

// A plugin of `bun lint` runs in this process. A configuration file of `bun fmt` that is a program runs in another,
// which is passed the level. Node.js's level refuses `new Function()` and lets `node:vm` compile a string.
// Not concurrent, and one thread: a thread of `bun lint` starts a VM, which takes seconds in a debug build beside twenty
// other rows.
describe.skipIf(builtStrict)("bun lint and bun fmt", () => {
  const probe = `
    import vm from "node:vm";
    const tried = make => { try { make(); return "made"; } catch { return "refused"; } };
    const viaFunction = () => tried(() => new Function("return 1"));
    const viaVM = () => tried(() => new vm.Script("1"));
  `;
  const lintFiles = {
    ".oxlintrc.json": JSON.stringify({
      categories: { correctness: "off" },
      ignorePatterns: ["plugin.mjs"],
      jsPlugins: ["./plugin.mjs"],
      rules: { "own/tries": "error" },
    }),
    "plugin.mjs": `${probe}
      const tries = { create: context => ({ Identifier: node => context.report({ node, message: viaFunction() + " " + viaVM() }) }) };
      export default { meta: { name: "own" }, rules: { tries } };`,
    "a.js": "foo;\n",
  };
  // Each file is formatted for one level: with what `new Function()` makes the quotes are single, and without what
  // `node:vm` makes there is no semicolon. `bun fmt -l` lists the files that are not formatted.
  const fmtFiles = {
    "prettier.config.mjs": `${probe}
      export default { singleQuote: viaFunction() === "made", semi: viaVM() === "made" };`,
    "allowed.js": "foo('a');\n",
    "node.js": 'foo("a");\n',
    "strict.js": 'foo("a")\n',
  };
  const lint = (flags: readonly string[], env?: Record<string, string>) =>
    run(lintFiles, [...flags, "lint", "--threads", "1", "-f", "unix", "a.js"], env);
  const fmt = (flags: readonly string[], env?: Record<string, string>) =>
    run(fmtFiles, [...flags, "fmt", "-l", "allowed.js", "node.js", "strict.js"], env);
  const said = (viaFunctionAndVM: string) => ({
    stdout: expect.stringContaining(`a.js:1:1: ${viaFunctionAndVM} [Error/own(tries)]`),
    exitCode: 1,
  });
  const asNode = said("refused made");
  const asStrict = said("refused refused");

  // Given more than once, the last counts, and BUN_OPTIONS comes before the command line, as for `bun <file>`.
  test.each([
    ["=strict, then the flag", [strict, flag], {}, asNode],
    ["=strict in BUN_OPTIONS, the flag on the command line", [flag], { BUN_OPTIONS: strict }, asNode],
    // Before the command, after the value of another flag.
    ["=strict after --cwd <dir>", ["--cwd", ".", strict], {}, asStrict],
  ] as const)("bun lint: %s", async (_, flags, env, expected) => {
    expect(await lint(flags, env)).toMatchObject(expected);
  });

  test.each([
    ["=strict, then the flag", [strict, flag], "allowed.js\nstrict.js\n"],
    ["=strict after --cwd <dir>", ["--cwd", ".", strict], "allowed.js\nnode.js\n"],
  ] as const)("bun fmt: %s", async (_, flags, notFormatted) => {
    expect(await fmt(flags)).toMatchObject({ stdout: notFormatted, exitCode: 1 });
  });
});

// A value that is not a level stops a command, so that none runs below the level that its operator asked for.
describe.concurrent.skipIf(builtStrict)("a value other than strict", () => {
  const files = {
    "package.json": JSON.stringify({ name: "bundles", version: "1.0.0" }),
    "plain.js": `console.log(1);\n`,
  };
  const startupError = { stdout: "", stderr: invalidValue, exitCode: 1 };

  test.each([
    "add",
    "audit",
    "check",
    "create",
    "dedupe",
    "exec true",
    "fmt",
    "getcompletes",
    "info",
    "install",
    "link",
    "lint",
    "outdated",
    "patch",
    "patch-commit",
    "pm",
    "prune",
    "publish --dry-run",
    "remove",
    "unlink",
    "update",
    "why",
    "x",
  ])("in BUN_OPTIONS is a startup error of bun %s", async command => {
    expect(await run(files, command.split(" "), { BUN_OPTIONS: mistyped })).toMatchObject(startupError);
  });

  // Before the command: directly, after the value of another flag, and after a `-`.
  test.each([
    [[mistyped, "check"]],
    [[mistyped, "create"]],
    [[mistyped, "exec", "true"]],
    [[mistyped, "fmt"]],
    [[mistyped, "getcompletes"]],
    [[mistyped, "lint"]],
    [["--cwd", ".", mistyped, "check"]],
    [["--cwd", ".", mistyped, "fmt"]],
    [["--cwd", ".", mistyped, "lint"]],
    [["-", mistyped, "getcompletes"]],
  ])("is a startup error of bun %j", async cmd => {
    expect(await run(files, cmd)).toMatchObject(startupError);
  });

  // bunx refuses a flag that it does not have where it is typed, as the package manager does.
  test("before bun x is not read", async () => {
    expect(await run(files, [mistyped, "x", "some-package"])).toMatchObject({
      stderr: expect.stringContaining(`error: bunx has no ${mistyped} flag.`),
      exitCode: 1,
    });
  });

  // `bun test` reads the flag among its own, where the last counts. It is not read a second time as a flag of `bun`.
  test("bun =strict test <the flag> runs at the level of the flag", async () => {
    const tests = {
      "level.test.js": `
        import { expect, test } from "bun:test";
        import vm from "node:vm";
        const tried = make => { try { make(); return "made"; } catch { return "refused"; } };
        test("level", () => {
          expect([tried(() => eval("1")), tried(() => new vm.Script("1"))]).toEqual(["refused", "made"]);
        });
      `,
    };
    expect(await run(tests, [strict, "test", flag])).toMatchObject({
      stderr: expect.stringContaining(" 1 pass\n 0 fail\n"),
      exitCode: 0,
    });
  });
});
