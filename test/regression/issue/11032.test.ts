import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/11032
// Bun.build produces invalid output when CJS exports are inside control flow
// (e.g. if/else, while, for). The bundler was placing ESM export clauses
// inside if blocks (invalid syntax) and referencing __INVALID__REF__.

test("bundling CJS exports inside if/else produces valid output", async () => {
  using dir = tempDir("issue-11032", {
    "mod.js": `if (true) exports.x = "yes"; else exports.x = "no";`,
    "entry.js": `import {x} from "./mod.js"; console.log(x);`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/entry.js`],
    outdir: `${dir}/dist`,
    target: "browser",
  });

  expect(result.success).toBe(true);

  const entry = result.outputs.find(o => o.kind === "entry-point");
  expect(entry).toBeDefined();

  const content = await entry!.text();

  // Must not contain __INVALID__REF__ sentinel
  expect(content).not.toContain("__INVALID__REF__");
  // Must not contain tagSymbol (old sentinel name)
  expect(content).not.toContain("tagSymbol");
  // export {} must not appear inside an if block — only at top level
  // (a rough check: there should be no "export" keyword inside braces of an if statement)
  expect(content).not.toMatch(/if\s*\([^)]*\)\s*\{[^}]*\bexport\b/);
});

test("bundling CJS exports inside if/else runs correctly", async () => {
  using dir = tempDir("issue-11032-run", {
    "mod.js": `if (true) exports.x = "yes"; else exports.x = "no";`,
    "entry.js": `import {x} from "./mod.js"; console.log(x);`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/entry.js`],
    outdir: `${dir}/dist`,
  });

  expect(result.success).toBe(true);

  const entryOutput = result.outputs.find(o => o.kind === "entry-point");
  expect(entryOutput).toBeDefined();

  await using proc = Bun.spawn({
    cmd: [bunExe(), entryOutput!.path],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("yes");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("bundling CJS exports inside while loop produces valid output", async () => {
  using dir = tempDir("issue-11032-while", {
    "mod.js": `
      var done = false;
      while (!done) {
        exports.x = "from-loop";
        done = true;
      }
    `,
    "entry.js": `import {x} from "./mod.js"; console.log(x);`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/entry.js`],
    outdir: `${dir}/dist`,
  });

  expect(result.success).toBe(true);

  const entry = result.outputs.find(o => o.kind === "entry-point");
  expect(entry).toBeDefined();

  const content = await entry!.text();
  expect(content).not.toContain("__INVALID__REF__");

  await using proc = Bun.spawn({
    cmd: [bunExe(), entry!.path],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("from-loop");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("bundling CJS exports inside braced if block produces valid output", async () => {
  using dir = tempDir("issue-11032-braced", {
    "mod.js": `if (true) { exports.x = "braced"; } else { exports.x = "other"; }`,
    "entry.js": `import {x} from "./mod.js"; console.log(x);`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/entry.js`],
    outdir: `${dir}/dist`,
  });

  expect(result.success).toBe(true);

  const entry = result.outputs.find(o => o.kind === "entry-point");
  expect(entry).toBeDefined();

  const content = await entry!.text();
  expect(content).not.toContain("__INVALID__REF__");

  await using proc = Bun.spawn({
    cmd: [bunExe(), entry!.path],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("braced");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("top-level CJS exports still work correctly after fix", async () => {
  using dir = tempDir("issue-11032-toplevel", {
    "mod.js": `exports.x = "top-level"; exports.y = 42;`,
    "entry.js": `import {x, y} from "./mod.js"; console.log(x, y);`,
  });

  const result = await Bun.build({
    entrypoints: [`${dir}/entry.js`],
    outdir: `${dir}/dist`,
  });

  expect(result.success).toBe(true);

  const entry = result.outputs.find(o => o.kind === "entry-point");
  expect(entry).toBeDefined();

  const content = await entry!.text();
  expect(content).not.toContain("__INVALID__REF__");

  await using proc = Bun.spawn({
    cmd: [bunExe(), entry!.path],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("top-level 42");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
