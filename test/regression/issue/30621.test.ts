// https://github.com/oven-sh/bun/issues/30621
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

async function build(dir: string, entry: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", entry, "--outdir=out"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("CSS url(data:) with no comma should not crash", async () => {
  using dir = tempDir("30621-css", {
    "style.css": `a{background:url(data:)}`,
  });
  const { stdout, stderr, exitCode } = await build(String(dir), "style.css");
  expect({ stdout, stderr }).toEqual({ stdout: expect.stringContaining("Bundled"), stderr: "" });
  expect(exitCode).toBe(0);
  const css = await Bun.file(join(String(dir), "out", "style.css")).text();
  expect(css).toContain(`url("data:")`);
});

test.concurrent("HTML favicon href=data: with no comma should not crash", async () => {
  using dir = tempDir("30621-html", {
    "index.html": `<!DOCTYPE html><html><head><link rel="icon" href="data:"></head><body><script src="./app.js"></script></body></html>`,
    "app.js": `console.log(1);`,
  });
  const { stdout, stderr, exitCode } = await build(String(dir), "index.html");
  expect({ stdout, stderr }).toEqual({ stdout: expect.stringContaining("Bundled"), stderr: "" });
  expect(exitCode).toBe(0);
  const html = await Bun.file(join(String(dir), "out", "index.html")).text();
  expect(html).toContain(`href="data:"`);
});

test.concurrent("JS importing CSS with url(data:) should not crash", async () => {
  using dir = tempDir("30621-js-css", {
    "index.js": `import "./style.css";`,
    "style.css": `a{background:url(data:)}`,
  });
  const { stdout, stderr, exitCode } = await build(String(dir), "index.js");
  expect({ stdout, stderr }).toEqual({ stdout: expect.stringContaining("Bundled"), stderr: "" });
  expect(exitCode).toBe(0);
});

test.concurrent("JS import of malformed data URL reports a resolve error", async () => {
  using dir = tempDir("30621-js", {
    "index.js": `import "data:";`,
  });
  const { stderr, exitCode } = await build(String(dir), "index.js");
  expect(stderr).toContain(`Could not resolve data URL: "data:"`);
  expect(exitCode).toBe(1);
});
