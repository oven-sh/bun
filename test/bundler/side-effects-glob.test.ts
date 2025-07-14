import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("glob sideEffects basic pattern", async () => {
  const dir = tempDirWithFiles("glob-side-effects-basic", {
    "package.json": JSON.stringify({
      "name": "glob-side-effects-test",
      "sideEffects": ["src/effects/*.js"],
    }),
    "src/index.js": `
import { used } from "./lib/used.js";
import { unused } from "./lib/unused.js";
import { effect } from "./effects/effect.js";
console.log(used);
    `.trim(),
    "src/lib/used.js": `export const used = "used";`,
    "src/lib/unused.js": `
export const unused = "unused";
console.log("should be tree-shaken");
    `.trim(),
    "src/effects/effect.js": `
console.log("side effect preserved");
export const effect = "effect";
    `.trim(),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "src/index.js", "--outdir", "dist"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  const bundleContent = await Bun.file(`${dir}/dist/index.js`).text();

  expect(bundleContent).toContain("side effect preserved");
  expect(bundleContent).not.toContain("should be tree-shaken");
  expect(bundleContent).toContain("used");
});

test("glob sideEffects question mark pattern", async () => {
  const dir = tempDirWithFiles("glob-side-effects-question", {
    "package.json": JSON.stringify({
      "name": "glob-side-effects-test",
      "sideEffects": ["src/file?.js"],
    }),
    "src/index.js": `
import { file1 } from "./file1.js";
import { file2 } from "./file2.js";
import { fileAB } from "./fileAB.js";
import { other } from "./other.js";
console.log("done");
    `.trim(),
    "src/file1.js": `
console.log("file1 effect");
export const file1 = "file1";
    `.trim(),
    "src/file2.js": `
console.log("file2 effect");
export const file2 = "file2";
    `.trim(),
    "src/fileAB.js": `
console.log("fileAB effect");
export const fileAB = "fileAB";
    `.trim(),
    "src/other.js": `
console.log("other effect");
export const other = "other";
    `.trim(),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "src/index.js", "--outdir", "dist"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  const bundleContent = await Bun.file(`${dir}/dist/index.js`).text();

  // Single character matches should have side effects
  expect(bundleContent).toContain("file1 effect");
  expect(bundleContent).toContain("file2 effect");

  // Multi-character and other files should not
  expect(bundleContent).not.toContain("fileAB effect");
  expect(bundleContent).not.toContain("other effect");
});

test("glob sideEffects brace expansion", async () => {
  const dir = tempDirWithFiles("glob-side-effects-brace", {
    "package.json": JSON.stringify({
      "name": "glob-side-effects-test",
      "sideEffects": ["src/{components,utils}/*.js"],
    }),
    "src/index.js": `
import { comp } from "./components/comp.js";
import { util } from "./utils/util.js";
import { other } from "./other/file.js";
console.log("done");
    `.trim(),
    "src/components/comp.js": `
console.log("component effect");
export const comp = "comp";
    `.trim(),
    "src/utils/util.js": `
console.log("utility effect");
export const util = "util";
    `.trim(),
    "src/other/file.js": `
console.log("other effect");
export const other = "other";
    `.trim(),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "src/index.js", "--outdir", "dist"],
    env: bunEnv,
    cwd: dir,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  const bundleContent = await Bun.file(`${dir}/dist/index.js`).text();

  expect(bundleContent).toContain("component effect");
  expect(bundleContent).toContain("utility effect");
  expect(bundleContent).not.toContain("other effect");
});
