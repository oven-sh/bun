// https://github.com/oven-sh/bun/issues/3322
// publicPath with absolute URL should not produce malformed chunk import URLs
// Bug: When entry points are in different directories, chunks would be imported with
// relative paths like "http://localhost:3000/../chunk.js" instead of "http://localhost:3000/chunk.js"
import { expect, test } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "path";

test("publicPath with absolute URL does not produce malformed chunk imports when entries are in different dirs", async () => {
  // The bug occurs when entry points are in different directories (a/ and b/),
  // causing output files to maintain that structure and chunk imports to use
  // relative paths like "../" which get concatenated with the absolute URL
  const dir = tempDirWithFiles("public-path-url-test", {
    "a/entry1.js": `
      import { shared } from '../shared.js';
      console.log('entry1', shared);
    `,
    "b/entry2.js": `
      import { shared } from '../shared.js';
      console.log('entry2', shared);
    `,
    "shared.js": `
      export const shared = 'shared value';
    `,
  });

  const build = await Bun.build({
    entrypoints: [join(dir, "a/entry1.js"), join(dir, "b/entry2.js")],
    outdir: join(dir, "dist"),
    splitting: true,
    publicPath: "http://localhost:3000/",
  });

  expect(build.success).toBe(true);
  expect(build.outputs.length).toBeGreaterThanOrEqual(2);

  // Find and read the entry files
  const entryOutputs = build.outputs.filter(o => o.path.includes("entry"));
  expect(entryOutputs.length).toBe(2);

  for (const output of entryOutputs) {
    const content = await output.text();
    // Should NOT contain relative path segments like "../" after the absolute URL
    // This was the bug: "http://localhost:3000/../chunk-xxx.js"
    expect(content).not.toMatch(/http:\/\/localhost:3000\/\.\.\//);
    // Should contain properly formatted URL imports
    if (content.includes("http://localhost:3000/chunk")) {
      expect(content).toMatch(/http:\/\/localhost:3000\/chunk-[a-z0-9]+\.js/);
    }
  }
});

test("publicPath with https URL does not produce malformed chunk imports", async () => {
  const dir = tempDirWithFiles("public-path-https-test", {
    "a/entry1.js": `
      import { shared } from '../shared.js';
      console.log('entry1', shared);
    `,
    "b/entry2.js": `
      import { shared } from '../shared.js';
      console.log('entry2', shared);
    `,
    "shared.js": `
      export const shared = 'shared value';
    `,
  });

  const build = await Bun.build({
    entrypoints: [join(dir, "a/entry1.js"), join(dir, "b/entry2.js")],
    outdir: join(dir, "dist"),
    splitting: true,
    publicPath: "https://cdn.example.com/assets/",
  });

  expect(build.success).toBe(true);

  const entryOutputs = build.outputs.filter(o => o.path.includes("entry"));
  for (const output of entryOutputs) {
    const content = await output.text();
    // Should NOT contain relative path segments after the absolute URL
    expect(content).not.toMatch(/https:\/\/cdn\.example\.com\/assets\/\.\.\//);
  }
});

test("publicPath with protocol-relative URL does not produce malformed chunk imports", async () => {
  const dir = tempDirWithFiles("public-path-protocol-relative-test", {
    "a/entry1.js": `
      import { shared } from '../shared.js';
      console.log('entry1', shared);
    `,
    "b/entry2.js": `
      import { shared } from '../shared.js';
      console.log('entry2', shared);
    `,
    "shared.js": `
      export const shared = 'shared value';
    `,
  });

  const build = await Bun.build({
    entrypoints: [join(dir, "a/entry1.js"), join(dir, "b/entry2.js")],
    outdir: join(dir, "dist"),
    splitting: true,
    publicPath: "//cdn.example.com/",
  });

  expect(build.success).toBe(true);

  const entryOutputs = build.outputs.filter(o => o.path.includes("entry"));
  for (const output of entryOutputs) {
    const content = await output.text();
    // Should NOT contain relative path segments after the URL
    expect(content).not.toMatch(/\/\/cdn\.example\.com\/\.\.\//);
  }
});
