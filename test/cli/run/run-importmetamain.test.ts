import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("import.meta.main", () => {
  test("import.meta.main", async () => {
    using dir = tempDir("import-meta-main-esm", {
      "index1.js": `import "fs"; console.log(JSON.stringify([typeof require, import.meta.main, !import.meta.main, require.main === module, require.main !== module]));`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index1.js"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toEqual(JSON.stringify(["function", true, false, true, false]));
    expect(exitCode).toBe(0);
  });

  test("import.meta.main in a common.js file", async () => {
    using dir = tempDir("import-meta-main-cjs", {
      "index1.js": `module.exports = {}; console.log(JSON.stringify([typeof require, import.meta.main, !import.meta.main, require.main === module, require.main !== module]));`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index1.js"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toEqual(JSON.stringify(["function", true, false, true, false]));
    expect(exitCode).toBe(0);
  });

  test("require.main === module keeps its precedence inside a larger expression", async () => {
    using dir = tempDir("import-meta-main-precedence-cjs", {
      "entry.cjs": `
        console.log(
          JSON.stringify({
            concat: "x=" + (require.main === module) + "!",
            rightAdd: 1 + (require.main === module),
            leftAdd: (require.main === module) + 1,
            neg: "x" + !(require.main !== module),
            kind: typeof (require.main === module),
            tpl: \`\${require.main === module}\`,
            member: (require.main === module).toString(),
            exponent: (require.main !== module) ** 2,
          }),
        );
        require("./dep.cjs");
      `,
      "dep.cjs": `
        console.log(
          JSON.stringify({
            concat: "x=" + (require.main === module) + "!",
            neg: "x" + !(require.main !== module),
            member: (require.main !== module).toString(),
          }),
        );
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim().split("\n")).toEqual([
      JSON.stringify({
        concat: "x=true!",
        rightAdd: 2,
        leftAdd: 2,
        neg: "xtrue",
        kind: "boolean",
        tpl: "true",
        member: "true",
        exponent: 0,
      }),
      JSON.stringify({ concat: "x=false!", neg: "xfalse", member: "true" }),
    ]);
    expect(exitCode).toBe(0);
  });

  test("require.main !== module keeps its precedence inside a larger expression (ESM)", async () => {
    using dir = tempDir("import-meta-main-precedence-esm", {
      "entry.mjs": `
        console.log(
          JSON.stringify({
            member: (require.main !== module).toString(),
            concat: "x=" + (require.main !== module) + "!",
            notMain: (!import.meta.main).toString(),
          }),
        );
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe(JSON.stringify({ member: "false", concat: "x=false!", notMain: "false" }));
    expect(exitCode).toBe(0);
  });

  // `!import.meta.main ** 2` is a SyntaxError: the left operand of `**` cannot be an
  // unparenthesized unary expression.
  test("require.main !== module as the left operand of ** is parenthesized (ESM)", async () => {
    using dir = tempDir("import-meta-main-exponent-esm", {
      "entry.mjs": `console.log(JSON.stringify({ exponent: (require.main !== module) ** 2 }));`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: stdout.trim(), syntaxError: stderr.includes("SyntaxError") }).toEqual({
      stdout: JSON.stringify({ exponent: 0 }),
      syntaxError: false,
    });
    expect(exitCode).toBe(0);
  });
});
