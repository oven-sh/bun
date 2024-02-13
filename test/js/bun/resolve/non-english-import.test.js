// We do not make these files imports in the codebase because non-ascii file paths can cause issues with git
// Instead, we put them into a temporary directory and run them from there
import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("latin1 entry point", async () => {
  const latin1Char = String.fromCharCode(0xc7);
  const latin1Chars = latin1Char + latin1Char + latin1Char + latin1Char;
  const prefix = join(tmpdir(), "bun-test-non-english-import-latin1");

  for (let variation of [latin1Chars + "-latin1-prefix.js", "latin1-suffix-" + latin1Chars + ".js"]) {
    const inputPath = join(prefix, variation);
    try {
      mkdirSync(prefix, { recursive: true });
    } catch (e) {}
    await Bun.write(inputPath, `console.log(42);`);

    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "run", inputPath],
      stderr: "inherit",
      env: bunEnv,
      cwd: prefix,
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toBe("42\n");
  }
});

test("utf16 entry point", async () => {
  const utf16Char = "\u{1F600}";
  const utf16Chars = utf16Char + utf16Char + utf16Char + utf16Char;
  const prefix = join(tmpdir(), "bun-test-non-english-import-u16");

  for (let variation of [utf16Chars + "-utf16-prefix.js", "utf16-suffix-" + utf16Chars + ".js"]) {
    const inputPath = join(prefix, variation);
    try {
      mkdirSync(prefix, { recursive: true });
    } catch (e) {}
    await Bun.write(inputPath, `console.log(42);`);

    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "run", inputPath],
      stderr: "inherit",
      env: bunEnv,
      cwd: prefix,
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString()).toBe("42\n");
  }
});

test("latin1 & utf16 imports", async () => {
  const prefix = join(tmpdir(), "bun-test-non-english-import-imports");
  const utf16Char = "\u{1F600}";
  const utf16Chars = utf16Char + utf16Char + utf16Char + utf16Char;
  const latin1Char = String.fromCharCode(0xc7);
  const latin1Chars = latin1Char + latin1Char + latin1Char + latin1Char;

  const imports = [];
  for (let variation of [utf16Chars + "-utf16-prefix.js", "utf16-suffix-" + utf16Chars + ".js"]) {
    imports.push(join(prefix, variation));
  }

  for (let variation of [latin1Chars + "-latin1-prefix.js", "latin1-suffix-" + latin1Chars + ".js"]) {
    imports.push(join(prefix, variation));
  }

  const inputPath = join(prefix, "entry.js");
  try {
    mkdirSync(prefix, { recursive: true });
  } catch (e) {}

  let entryCode = imports.map(i => `import ${JSON.stringify(i)};`).join("\n");
  await Bun.write(inputPath, entryCode);

  for (let importPath of imports) {
    await Bun.write(importPath, "console.log(42);");
  }

  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", inputPath],
    stderr: "inherit",
    env: bunEnv,
    cwd: prefix,
  });

  expect(exitCode).toBe(0);
  expect(stdout.toString()).toBe("42\n".repeat(imports.length));
});
