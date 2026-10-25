import { describe, expect, test } from "bun:test";
import { readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// The parser turns `import.meta.main` and `require.main === module` into one node. The printer
// writes it back as `import.meta.main`, `!import.meta.main`, `require.main == module` or
// `require.main != module`. Each context puts that text next to another operator.
const contexts = [
  "MAIN",
  '"x=" + MAIN + "!"',
  "1 + MAIN",
  "MAIN + 1",
  "MAIN - 1",
  "MAIN * 2",
  "2 ** MAIN",
  "MAIN ** 2",
  "MAIN < 2",
  "MAIN == true",
  "true === MAIN",
  "MAIN instanceof Object",
  "!MAIN",
  '"x" + !MAIN',
  "-MAIN",
  "typeof MAIN",
  "MAIN.toString()",
  "MAIN?.toString()",
  'MAIN["toString"]()',
  "new Boolean(MAIN).valueOf()",
  'MAIN ? "a" : "b"',
  'MAIN && "y"',
  'MAIN || "n"',
  "MAIN | 0",
  "(MAIN, 1)",
  "[MAIN][0]",
  "`${MAIN}`",
];

// A statement that prints every context, with `form` in parentheses where MAIN is.
function printContexts(form: string) {
  return `console.log(JSON.stringify([${contexts.map(context => context.replaceAll("MAIN", `(${form})`)).join(", ")}]));\n`;
}

// What that statement prints when `form` is `value`.
function expectedContexts(value: boolean) {
  return JSON.stringify(contexts.map(context => new Function(`return ${context.replaceAll("MAIN", `(${value})`)};`)()));
}

async function run(cwd: string, args: string[], env = bunEnv) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim().split("\n"), stderr, exitCode };
}

describe.concurrent("import.meta.main", () => {
  test("import.meta.main", async () => {
    using dir = tempDir("import-meta-main-esm", {
      "index1.js": `import "fs"; console.log(JSON.stringify([typeof require, import.meta.main, !import.meta.main, require.main === module, require.main !== module]));`,
    });
    const { stdout, exitCode } = await run(String(dir), ["index1.js"]);
    expect(stdout).toEqual([JSON.stringify(["function", true, false, true, false])]);
    expect(exitCode).toBe(0);
  });

  test("import.meta.main in a common.js file", async () => {
    using dir = tempDir("import-meta-main-cjs", {
      "index1.js": `module.exports = {}; console.log(JSON.stringify([typeof require, import.meta.main, !import.meta.main, require.main === module, require.main !== module]));`,
    });
    const { stdout, exitCode } = await run(String(dir), ["index1.js"]);
    expect(stdout).toEqual([JSON.stringify(["function", true, false, true, false])]);
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/45776
  test("require.main === module in a string concatenation", async () => {
    using dir = tempDir("import-meta-main-45776", {
      "issue.cjs": `
        console.log("main: " + (require.main === module));
        console.log("not main: " + !(require.main === module));
      `,
    });
    const { stdout, exitCode } = await run(String(dir), ["issue.cjs"]);
    expect(stdout).toEqual(["main: true", "not main: false"]);
    expect(exitCode).toBe(0);
  });

  test("require.main === module under an operator in bun -e", async () => {
    using dir = tempDir("import-meta-main-eval", {});
    const { stdout, exitCode } = await run(String(dir), [
      "-e",
      `console.log(typeof (require.main === module), "x=" + (require.main === module));`,
    ]);
    expect(stdout).toEqual(["boolean x=true"]);
    expect(exitCode).toBe(0);
  });

  // The runtime replaces the one use of `isMain` by its value. No operator is next to the
  // comparison in the source.
  test("require.main === module in a const with one use", async () => {
    const source = `
      function concat() { const isMain = require.main === module; return "main=" + isMain; }
      function type() { const isMain = require.main === module; return typeof isMain; }
      function negate() { const isMain = require.main === module; return { library: !isMain }; }
      console.log(JSON.stringify([concat(), type(), negate()]));
    `;
    using dir = tempDir("import-meta-main-single-use", {
      "entry.cjs": source + `require("./required.cjs");\n`,
      "required.cjs": source,
    });
    const { stdout, exitCode } = await run(String(dir), ["entry.cjs"]);
    expect(stdout).toEqual([
      JSON.stringify(["main=true", "boolean", { library: false }]),
      JSON.stringify(["main=false", "boolean", { library: true }]),
    ]);
    expect(exitCode).toBe(0);
  });

  // With the inspector the runtime does not make the `!` a part of the node. It printed
  // `!require.main == module`, and each required file took its "main" branch.
  test("!(require.main === module) in a required file with --inspect", async () => {
    using dir = tempDir("import-meta-main-inspect", {
      "entry.cjs": `require("./required.cjs");\n`,
      "required.cjs": `
        if (!(require.main === module)) console.log("required");
        else console.log("main");
      `,
    });
    const { stdout, exitCode } = await run(String(dir), ["--inspect=127.0.0.1:0", "entry.cjs"]);
    expect(stdout).toEqual(["required"]);
    expect(exitCode).toBe(0);
  });

  test("require.main === module keeps its value next to another operator (CommonJS)", async () => {
    const source =
      printContexts("require.main === module") +
      printContexts("require.main == module") +
      printContexts("require.main !== module") +
      printContexts("module != require.main");
    using dir = tempDir("import-meta-main-precedence-cjs", {
      "entry.cjs": source + `require("./required.cjs");\n`,
      "required.cjs": source,
    });
    const { stdout, exitCode } = await run(String(dir), ["entry.cjs"]);
    expect(stdout).toEqual([
      // entry.cjs
      expectedContexts(true),
      expectedContexts(true),
      expectedContexts(false),
      expectedContexts(false),
      // required.cjs
      expectedContexts(false),
      expectedContexts(false),
      expectedContexts(true),
      expectedContexts(true),
    ]);
    expect(exitCode).toBe(0);
  });

  // `(require.main !== module) ** 2` was printed as `!import.meta.main ** 2`, which is a SyntaxError.
  test("import.meta.main keeps its value next to another operator (ES module)", async () => {
    const source =
      printContexts("import.meta.main") +
      printContexts("!import.meta.main") +
      printContexts("require.main === module") +
      printContexts("require.main !== module");
    using dir = tempDir("import-meta-main-precedence-esm", {
      "entry.mjs": source + `await import("./imported.mjs");\n`,
      "imported.mjs": source,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["entry.mjs"]);
    expect(stderr).not.toContain("SyntaxError");
    expect(stdout).toEqual([
      // entry.mjs
      expectedContexts(true),
      expectedContexts(false),
      expectedContexts(true),
      expectedContexts(false),
      // imported.mjs
      expectedContexts(false),
      expectedContexts(true),
      expectedContexts(false),
      expectedContexts(true),
    ]);
    expect(exitCode).toBe(0);
  });

  // The second run takes the printed text from the transpiler cache.
  test("require.main === module keeps its value in a file from the transpiler cache", async () => {
    const source = printContexts("require.main === module") + printContexts("require.main !== module");
    using dir = tempDir("import-meta-main-precedence-cache", {
      // Files under 4 KiB are not cached.
      "entry.cjs": source + "/*" + Buffer.alloc(8 * 1024, "*").toString() + "*/\n",
    });
    const cache = join(String(dir), ".cache");
    const env = {
      ...bunEnv,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache,
      BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
    };
    const expected = [expectedContexts(true), expectedContexts(false)];

    const first = await run(String(dir), ["entry.cjs"], env);
    expect(first.stdout).toEqual(expected);
    expect(first.exitCode).toBe(0);
    expect(readdirSync(cache)).toHaveLength(1);

    const second = await run(String(dir), ["entry.cjs"], env);
    expect(second.stdout).toEqual(expected);
    expect(second.exitCode).toBe(0);
    expect(readdirSync(cache)).toHaveLength(1);
  });
});
