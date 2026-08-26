// https://github.com/oven-sh/bun/issues/3039
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

async function buildFrom(cwd: string, entry: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", entry],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return stdout;
}

function commentLines(bundle: string) {
  return bundle
    .split("\n")
    .filter(l => l.startsWith("// "))
    .sort();
}

test.concurrent("bundler filename comments are independent of cwd", async () => {
  using dir = tempDir("bun-build-3039", {
    "proj/src/entry.js": `import { util } from "./util.js";\nimport { other } from "./nested/other.js";\nconsole.log(util(), other());\n`,
    "proj/src/util.js": `export function util() { return "util"; }\n`,
    "proj/src/nested/other.js": `export function other() { return "other"; }\n`,
  });
  const root = String(dir);

  const fromTop = await buildFrom(root, join("proj", "src", "entry.js"));
  const fromProj = await buildFrom(join(root, "proj"), join("src", "entry.js"));
  const fromSrc = await buildFrom(join(root, "proj", "src"), "entry.js");

  expect(fromProj).toBe(fromTop);
  expect(fromSrc).toBe(fromTop);

  expect(commentLines(fromTop)).toEqual(["// entry.js", "// nested/other.js", "// util.js"]);
});

test.concurrent("bundler filename comments honor --root regardless of cwd", async () => {
  using dir = tempDir("bun-build-3039-root", {
    "proj/src/entry.js": `import { util } from "./util.js";\nconsole.log(util());\n`,
    "proj/src/util.js": `export function util() { return "util"; }\n`,
  });
  const root = String(dir);
  const projRoot = join(root, "proj");

  async function buildWithRoot(cwd: string, entry: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--root", projRoot, entry],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return stdout;
  }

  const fromTop = await buildWithRoot(root, join("proj", "src", "entry.js"));
  const fromSrc = await buildWithRoot(join(root, "proj", "src"), "entry.js");

  expect(fromSrc).toBe(fromTop);
  expect(commentLines(fromTop)).toEqual(["// src/entry.js", "// src/util.js"]);
});
