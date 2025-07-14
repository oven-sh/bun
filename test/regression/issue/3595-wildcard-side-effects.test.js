import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("wildcard sideEffects support - issue #3595", async () => {
  const dir = tempDirWithFiles("wildcard-side-effects-test", {
    "package.json": JSON.stringify({
      "name": "wildcard-side-effects-test",
      "sideEffects": ["src/lib/side-effects/*.js"]
    }),
    "src/index.js": `
import { used } from "./lib/used.js";
import { unused } from "./lib/unused.js";
import { sideEffect } from "./lib/side-effects/side-effect.js";
console.log("used:", used);
    `.trim(),
    "src/lib/used.js": `
export const used = "used";
    `.trim(),
    "src/lib/unused.js": `
export const unused = "unused";
console.log("This should be tree-shaken out");
    `.trim(),
    "src/lib/side-effects/side-effect.js": `
console.log("This is a side effect and should be preserved");
export const sideEffect = "side-effect";
    `.trim(),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "src/index.js", "--outdir", "dist", "--format", "esm"],
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
  expect(stdout).toContain("Bundled");

  // Check that the bundle was created
  const bundleExists = await Bun.file(`${dir}/dist/index.js`).exists();
  expect(bundleExists).toBe(true);

  // Check bundle content
  const bundleContent = await Bun.file(`${dir}/dist/index.js`).text();
  
  // Side effect should be preserved
  expect(bundleContent).toContain("This is a side effect and should be preserved");
  
  // Unused code should be tree-shaken
  expect(bundleContent).not.toContain("This should be tree-shaken out");
  
  // Used code should be included
  expect(bundleContent).toContain("used");
});

test("wildcard sideEffects with question mark pattern", async () => {
  const dir = tempDirWithFiles("wildcard-side-effects-question-mark", {
    "package.json": JSON.stringify({
      "name": "wildcard-side-effects-test",
      "sideEffects": ["src/lib/file?.js"]
    }),
    "src/index.js": `
import { used } from "./lib/used.js";
import { file1 } from "./lib/file1.js";
import { file2 } from "./lib/file2.js";
import { fileAB } from "./lib/fileAB.js";
console.log("used:", used);
    `.trim(),
    "src/lib/used.js": `
export const used = "used";
    `.trim(),
    "src/lib/file1.js": `
console.log("file1 side effect");
export const file1 = "file1";
    `.trim(),
    "src/lib/file2.js": `
console.log("file2 side effect");
export const file2 = "file2";
    `.trim(),
    "src/lib/fileAB.js": `
console.log("fileAB side effect");
export const fileAB = "fileAB";
    `.trim(),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "src/index.js", "--outdir", "dist", "--format", "esm"],
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
  expect(bundleContent).toContain("file1 side effect");
  expect(bundleContent).toContain("file2 side effect");
  
  // Multi-character filename should not match single ? pattern  
  expect(bundleContent).not.toContain("fileAB side effect");
});

test("wildcard sideEffects with brace expansion", async () => {
  const dir = tempDirWithFiles("wildcard-side-effects-brace", {
    "package.json": JSON.stringify({
      "name": "wildcard-side-effects-test",
      "sideEffects": ["src/lib/{components,utils}/*.js"]
    }),
    "src/index.js": `
import { used } from "./lib/used.js";
import { comp1 } from "./lib/components/comp1.js";
import { comp2 } from "./lib/components/comp2.js";
import { util1 } from "./lib/utils/util1.js";
import { other } from "./lib/other/other.js";
console.log("used:", used);
    `.trim(),
    "src/lib/used.js": `
export const used = "used";
    `.trim(),
    "src/lib/components/comp1.js": `
console.log("comp1 side effect");
export const comp1 = "comp1";
    `.trim(),
    "src/lib/components/comp2.js": `
console.log("comp2 side effect");
export const comp2 = "comp2";
    `.trim(),
    "src/lib/utils/util1.js": `
console.log("util1 side effect");
export const util1 = "util1";
    `.trim(),
    "src/lib/other/other.js": `
console.log("other side effect");
export const other = "other";
    `.trim(),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "src/index.js", "--outdir", "dist", "--format", "esm"],
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
  
  // Components and utils should have side effects
  expect(bundleContent).toContain("comp1 side effect");
  expect(bundleContent).toContain("comp2 side effect");
  expect(bundleContent).toContain("util1 side effect");
  
  // Other directory should not match
  expect(bundleContent).not.toContain("other side effect");
});

test("mixed sideEffects with exact and glob patterns", async () => {
  const dir = tempDirWithFiles("mixed-side-effects", {
    "package.json": JSON.stringify({
      "name": "mixed-side-effects-test",
      "sideEffects": [
        "src/lib/specific.js",
        "src/lib/glob/*.js"
      ]
    }),
    "src/index.js": `
import { used } from "./lib/used.js";
import { specific } from "./lib/specific.js";
import { glob1 } from "./lib/glob/glob1.js";
import { glob2 } from "./lib/glob/glob2.js";
import { other } from "./lib/other.js";
console.log("used:", used);
    `.trim(),
    "src/lib/used.js": `
export const used = "used";
    `.trim(),
    "src/lib/specific.js": `
console.log("specific side effect");
export const specific = "specific";
    `.trim(),
    "src/lib/glob/glob1.js": `
console.log("glob1 side effect");
export const glob1 = "glob1";
    `.trim(),
    "src/lib/glob/glob2.js": `
console.log("glob2 side effect");
export const glob2 = "glob2";
    `.trim(),
    "src/lib/other.js": `
console.log("other side effect");
export const other = "other";
    `.trim(),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "src/index.js", "--outdir", "dist", "--format", "esm"],
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
  
  // Specific file and glob matches should have side effects
  expect(bundleContent).toContain("specific side effect");
  expect(bundleContent).toContain("glob1 side effect");
  expect(bundleContent).toContain("glob2 side effect");
  
  // Other file should not have side effects
  expect(bundleContent).not.toContain("other side effect");
});

test("no warning for wildcard sideEffects (regression test)", async () => {
  const dir = tempDirWithFiles("no-warning-test", {
    "package.json": JSON.stringify({
      "name": "no-warning-test",
      "sideEffects": ["src/lib/side-effects/*.js"]
    }),
    "src/index.js": `
import { used } from "./lib/used.js";
console.log("used:", used);
    `.trim(),
    "src/lib/used.js": `
export const used = "used";
    `.trim(),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "src/index.js", "--outdir", "dist", "--format", "esm"],
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
  
  // Should not contain the old warning about wildcard sideEffects not being supported
  expect(stderr).not.toContain("wildcard sideEffects are not supported yet");
  expect(stdout).not.toContain("wildcard sideEffects are not supported yet");
});