import { file, spawn } from "bun";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { bunExe, bunEnv as env } from "harness";
import { mkdtemp, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readdirSorted } from "./dummy.registry";

let run_dir: string;

beforeEach(async () => {
  run_dir = await realpath(await mkdtemp(join(tmpdir(), "bun-run.test")));
});
afterEach(async () => {
  await rm(run_dir, { force: true, recursive: true });
});

it("should download dependency to run local file", async () => {
  await writeFile(
    join(run_dir, "test.js"),
    `
const { minify } = require("uglify-js@3.17.4");

console.log(minify("print(6 * 7)").code);
  `,
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "test.js"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toBe("");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.split(/\r?\n/)).toEqual(["print(42);", ""]);
  expect(await exited).toBe(0);
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
});

it("should download dependencies to run local file", async () => {
  await writeFile(
    join(run_dir, "test.js"),
    `
import { file } from "bun";
import decompress from "decompress@4.2.1";

const buffer = await file("${join(import.meta.dir, "baz-0.0.3.tgz")}").arrayBuffer();
for (const entry of await decompress(Buffer.from(buffer))) {
  console.log(\`\${entry.type}: \${entry.path}\`);
}
  `,
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "test.js"],
    cwd: run_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("decompress");
  expect(await readdirSorted(join(run_dir, ".cache", "decompress"))).toEqual(["4.2.1"]);
  expect(await readdirSorted(join(run_dir, ".cache", "decompress", "4.2.1"))).toEqual([
    "index.js",
    "license",
    "package.json",
    "readme.md",
  ]);
  expect(await file(join(run_dir, ".cache", "decompress", "4.2.1", "index.js")).text()).toContain(
    "\nmodule.exports = ",
  );
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.split(/\r?\n/)).toEqual([
    "directory: package/",
    "file: package/index.js",
    "file: package/package.json",
    "",
  ]);
  expect(await exited).toBe(0);
});
