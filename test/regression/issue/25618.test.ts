// https://github.com/oven-sh/bun/issues/25618
// HTML bundler ignores resources inside <noscript> tags

import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("bun build bundles CSS inside noscript tags - issue #25618", async () => {
  using dir = tempDir("25618-noscript-css", {
    "index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <noscript><link rel="stylesheet" href="noscript.css"></noscript>
  </head>
  <body>
    <p>Hello, World!</p>
  </body>
</html>`,
    "noscript.css": `p {
  color: red;
}`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.html", "--outdir", "./output"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  // Check that output directory exists
  const outputDir = join(String(dir), "output");
  expect(existsSync(outputDir)).toBe(true);

  // Check that CSS file was created (with hash)
  const files = readdirSync(outputDir);
  const cssFiles = files.filter((f: string) => f.endsWith(".css"));
  expect(cssFiles.length).toBeGreaterThan(0);

  // Check that HTML references the hashed CSS, not the original
  const htmlContent = readFileSync(join(outputDir, "index.html"), "utf-8");
  expect(htmlContent).not.toContain('href="noscript.css"');
  expect(htmlContent).toMatch(/href="[^"]*\.css"/);

  // Check that the CSS file contains the expected content
  const cssContent = readFileSync(join(outputDir, cssFiles[0]), "utf-8");
  expect(cssContent).toContain("color:");
});

test("bun build bundles images inside noscript tags - issue #25618", async () => {
  using dir = tempDir("25618-noscript-img", {
    "index.html": `<!DOCTYPE html>
<html>
  <body>
    <noscript>
      <img src="fallback.png" alt="Fallback">
    </noscript>
  </body>
</html>`,
    "fallback.png": "fake png content",
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.html", "--outdir", "./output"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  // Check that output directory exists
  const outputDir = join(String(dir), "output");
  expect(existsSync(outputDir)).toBe(true);

  // Check that image file was created (with hash)
  const files = readdirSync(outputDir);
  const imgFiles = files.filter((f: string) => f.endsWith(".png"));
  expect(imgFiles.length).toBeGreaterThan(0);

  // Check that HTML references the hashed image, not the original
  const htmlContent = readFileSync(join(outputDir, "index.html"), "utf-8");
  expect(htmlContent).not.toContain('src="fallback.png"');
  expect(htmlContent).toMatch(/src="[^"]*\.png"/);
});

test("bun build bundles scripts inside noscript tags - issue #25618", async () => {
  using dir = tempDir("25618-noscript-script", {
    "index.html": `<!DOCTYPE html>
<html>
  <head>
    <noscript>
      <meta http-equiv="refresh" content="0; url=nojs.html">
    </noscript>
  </head>
  <body>
    <noscript>
      <link rel="stylesheet" href="nojs.css">
    </noscript>
  </body>
</html>`,
    "nojs.css": `body { background: yellow; }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.html", "--outdir", "./output"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  const outputDir = join(String(dir), "output");
  const files = readdirSync(outputDir);
  const cssFiles = files.filter((f: string) => f.endsWith(".css"));
  expect(cssFiles.length).toBeGreaterThan(0);

  const htmlContent = readFileSync(join(outputDir, "index.html"), "utf-8");
  expect(htmlContent).not.toContain('href="nojs.css"');
});
