import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun build preserves data-* attributes on script tags", async () => {
  using dir = tempDir("issue-26216", {
    "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script type="module" src="./app.js" data-inline data-custom="value"></script>
</head>
<body>
  <div id="app"></div>
</body>
</html>`,
    "app.js": `console.log("hello");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.html", "--outdir=out"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  const outputHtml = await Bun.file(`${dir}/out/index.html`).text();

  // Check that data-* attributes are preserved on the bundled script tag
  expect(outputHtml).toContain('data-inline=""');
  expect(outputHtml).toContain('data-custom="value"');
});

test("bun build preserves data-* attributes on link tags", async () => {
  using dir = tempDir("issue-26216-link", {
    "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link href="./style.css" rel="stylesheet" data-theme="dark" data-priority="high">
</head>
<body>
  <div id="app"></div>
</body>
</html>`,
    "style.css": `body { color: red; }`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.html", "--outdir=out"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  const outputHtml = await Bun.file(`${dir}/out/index.html`).text();

  // Check that data-* attributes are preserved on the bundled link tag
  expect(outputHtml).toContain('data-theme="dark"');
  expect(outputHtml).toContain('data-priority="high"');
});

test("bun build preserves data-* attributes with special characters", async () => {
  using dir = tempDir("issue-26216-special", {
    "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script type="module" src="./app.js" data-config='{"key":"value"}'></script>
</head>
<body>
  <div id="app"></div>
</body>
</html>`,
    "app.js": `console.log("hello");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.html", "--outdir=out"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  const outputHtml = await Bun.file(`${dir}/out/index.html`).text();

  // Check that data-* attributes with special characters are preserved (quotes get escaped)
  expect(outputHtml).toContain("data-config=");
});

test("bun build uses data-* attributes from first bundled element when merging multiple scripts", async () => {
  using dir = tempDir("issue-26216-merge", {
    "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <script type="module" src="./app1.js" data-first="true"></script>
  <script type="module" src="./app2.js" data-second="true"></script>
</head>
<body>
  <div id="app"></div>
</body>
</html>`,
    "app1.js": `console.log("app1");`,
    "app2.js": `console.log("app2");`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.html", "--outdir=out"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  const outputHtml = await Bun.file(`${dir}/out/index.html`).text();

  // The first bundled script's data-* attributes should be used
  expect(outputHtml).toContain('data-first="true"');
});
