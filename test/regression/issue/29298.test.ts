import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/29298

const SVG_BODY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4" fill="#fbf0df"/></svg>`;

test("standalone HTML inlines file-loader assets imported from JS as data URIs", async () => {
  using dir = tempDir("issue-29298-js-import", {
    "src/index.html": `<!doctype html>
<html>
  <head><title>t</title></head>
  <body><div id="root"></div><script type="module" src="./entry.ts"></script></body>
</html>`,
    "src/entry.ts": `import logo from "./logo.svg";
const img = document.createElement("img");
img.src = logo;
document.body.appendChild(img);
console.log(logo);`,
    "src/logo.svg": SVG_BODY,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--target", "browser", "--outdir", "./dist", "./src/index.html"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const exitCode = await proc.exited;

  // Only index.html should exist in dist/ — standalone HTML is meant to be self-contained.
  const distFiles = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: join(String(dir), "dist") }));
  expect(distFiles).toEqual(["index.html"]);

  const html = await Bun.file(join(String(dir), "dist", "index.html")).text();

  // The JS-imported SVG must NOT be referenced as a sidecar path.
  expect(html).not.toMatch(/logo-[a-z0-9]+\.svg/);

  // It must be inlined as a data: URI. Check the base64 prefix of the SVG body.
  const expectedPrefix = Buffer.from(SVG_BODY).toString("base64").slice(0, 40);
  expect(html).toContain(`data:image/svg+xml;base64,${expectedPrefix}`);

  expect(exitCode).toBe(0);
});

test("standalone HTML inlines assets from both <link href> and JS imports", async () => {
  using dir = tempDir("issue-29298-link-and-import", {
    "src/index.html": `<!doctype html>
<html>
  <head><link rel="icon" href="./icon.svg"><title>t</title></head>
  <body><script type="module" src="./entry.ts"></script></body>
</html>`,
    "src/entry.ts": `import logo from "./logo.svg";
document.body.dataset.logo = logo;`,
    "src/icon.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2" fill="#ff0000"/></svg>`,
    "src/logo.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><rect width="2" height="2" fill="#00ff00"/></svg>`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--target", "browser", "--outdir", "./dist", "./src/index.html"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });
  const exitCode = await proc.exited;

  const html = await Bun.file(join(String(dir), "dist", "index.html")).text();
  expect(html).not.toMatch(/\.svg"/); // no sidecar refs anywhere

  // Both SVGs end up inlined — count base64-encoded data URIs for SVG.
  const dataUris = html.match(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+/g) ?? [];
  expect(dataUris.length).toBeGreaterThanOrEqual(2);

  expect(exitCode).toBe(0);
});
