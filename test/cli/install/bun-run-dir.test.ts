import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { exists, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, installCacheFolderName, readdirSorted, tmpdirSync } from "harness";
import { join } from "path";

// registry.npmjs.org dist.integrity of the versions these tests install
const uglifyIntegrity =
  "sha512-T9q82TJI9e/C1TAxYvfb16xO120tMVFZrGA3f9/P4424DNu6ypK103y0GPFVa17yotwSyZW5iYXgjYHkGrJW/g==";
const decompressIntegrity =
  "sha512-e48kc2IjU+2Zw8cTb6VZcJQ3lgVbS4uuB1TfCHbiZIP/haNXm+SVyhu+87jts5/3ROpd82GSVCoNs/z8l4ZOaQ==";
const uglifyCacheEntry = (run_dir: string) =>
  installCacheFolderName(join(run_dir, ".cache"), "uglify-js", "3.17.4", uglifyIntegrity).slice("uglify-js@".length);
const decompressCacheEntry = (run_dir: string) =>
  installCacheFolderName(join(run_dir, ".cache"), "decompress", "4.2.1", decompressIntegrity).slice(
    "decompress@".length,
  );

it.concurrent("should download dependency to run local file", async () => {
  const run_dir = tmpdirSync();
  await writeFile(
    join(run_dir, "test.js"),
    `
const { minify } = require("uglify-js@3.17.4");

console.log(minify("print(6 * 7)").code);
  `,
  );
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "run", "test.js"],
    cwd: run_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  const err1 = await new Response(stderr1).text();
  expect(err1).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("uglify-js");
  expect(await readdirSorted(join(run_dir, ".cache", "uglify-js"))).toEqual([uglifyCacheEntry(run_dir)]);
  expect(await exists(join(run_dir, ".cache", "uglify-js", uglifyCacheEntry(run_dir), "package.json"))).toBeTrue();
  const out1 = await new Response(stdout1).text();
  expect(out1.split(/\r?\n/)).toEqual(["print(42);", ""]);
  expect(await exited1).toBe(0);
  // Perform `bun test.js` with cached dependencies
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "test.js"],
    cwd: run_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  const err2 = await new Response(stderr2).text();
  expect(err2).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("uglify-js");
  expect(await readdirSorted(join(run_dir, ".cache", "uglify-js"))).toEqual([uglifyCacheEntry(run_dir)]);
  const out2 = await new Response(stdout2).text();
  expect(out2.split(/\r?\n/)).toEqual(["print(42);", ""]);
  expect(await exited2).toBe(0);
});

it.concurrent("should download dependencies to run local file", async () => {
  const run_dir = tmpdirSync();
  const filePath = join(import.meta.dir, "baz-0.0.3.tgz").replace(/\\/g, "\\\\");
  await writeFile(
    join(run_dir, "test.js"),
    `
import { file } from "bun";
import decompress from "decompress@4.2.1";

const buffer = await file("${filePath}").arrayBuffer();
for (const entry of await decompress(Buffer.from(buffer))) {
  console.log(\`\${entry.type}: \${entry.path}\`);
}
  `,
  );
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
    cmd: [bunExe(), "test.js"],
    cwd: run_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  const err1 = await new Response(stderr1).text();
  expect(err1).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("decompress");
  expect(await readdirSorted(join(run_dir, ".cache", "decompress"))).toEqual([decompressCacheEntry(run_dir)]);
  expect(await exists(join(run_dir, ".cache", "decompress", decompressCacheEntry(run_dir), "package.json"))).toBeTrue();
  expect(await file(join(run_dir, ".cache", "decompress", decompressCacheEntry(run_dir), "index.js")).text()).toContain(
    "\nmodule.exports = ",
  );
  const out1 = await new Response(stdout1).text();
  expect(out1.split(/\r?\n/)).toEqual([
    "directory: package/",
    "file: package/index.js",
    "file: package/package.json",
    "",
  ]);
  expect(await exited1).toBe(0);
  // Perform `bun run test.js` with cached dependencies
  const {
    stdout: stdout2,
    stderr: stderr2,
    exited: exited2,
  } = spawn({
    cmd: [bunExe(), "run", "test.js"],
    cwd: run_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  const err2 = await new Response(stderr2).text();
  expect(err2).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("decompress");
  expect(await readdirSorted(join(run_dir, ".cache", "decompress"))).toEqual([decompressCacheEntry(run_dir)]);
  expect(await exists(join(run_dir, ".cache", "decompress", decompressCacheEntry(run_dir), "package.json"))).toBeTrue();
  expect(await file(join(run_dir, ".cache", "decompress", decompressCacheEntry(run_dir), "index.js")).text()).toContain(
    "\nmodule.exports = ",
  );
  const out2 = await new Response(stdout2).text();
  expect(out2.split(/\r?\n/)).toEqual([
    "directory: package/",
    "file: package/index.js",
    "file: package/package.json",
    "",
  ]);
  expect(await exited2).toBe(0);
});

it.concurrent("should not crash when downloading a non-existent module, issue#4240", async () => {
  const run_dir = tmpdirSync();
  await writeFile(
    join(run_dir, "test.js"),
    `
import { prueba } from "pruebadfasdfasdkafasdyuif.js";
  `,
  );
  const { exited: exited } = spawn({
    cmd: [bunExe(), "test.js"],
    cwd: run_dir,
    stdin: null,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  // The exit code will not be 1 if it panics.
  expect(await exited).toBe(1);
});
