import { spawn } from "bun";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { bunExe } from "bunExe";
import { bunEnv as env } from "bunEnv";
import { realpathSync } from "fs";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readdirSorted } from "./dummy.registry";

let x_dir;

beforeEach(async () => {
  x_dir = realpathSync(await mkdtemp(join(tmpdir(), "bun-install.test")));
});
afterEach(async () => {
  await rm(x_dir, { force: true, recursive: true });
});

it("should install and run default (latest) version", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x", "uglify-js", "--compress"],
    cwd: x_dir,
    stdout: null,
    stdin: new TextEncoder().encode("console.log(6 * 7);"),
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.split(/\r?\n/)).toEqual(["console.log(42);", ""]);
  expect(await exited).toBe(0);
});

it("should install and run specified version", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "x", "uglify-js@3.14.1", "-v"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env,
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).not.toContain("error");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.split(/\r?\n/)).toEqual(["uglify-js 3.14.1", ""]);
  expect(await exited).toBe(0);
});

it("should download dependency to run local file", async () => {
  await writeFile(
    join(x_dir, "test.js"),
    `
const { minify } = require("uglify-js@3.17.4");

console.log(minify("print(6 * 7)").code);
`,
  );
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), "test.js"],
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(x_dir, ".cache"),
    },
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toBe("");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.split(/\r?\n/)).toEqual(["print(42);", ""]);
  expect(await exited).toBe(0);
  expect(await readdirSorted(x_dir)).toEqual([".cache", "test.js"]);
});

it("should download dependencies to run local file", async () => {
  await writeFile(
    join(x_dir, "test.js"),
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
    cwd: x_dir,
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(x_dir, ".cache"),
    },
  });
  expect(stderr).toBeDefined();
  const err = await new Response(stderr).text();
  expect(err).toBe("");
  expect(stdout).toBeDefined();
  const out = await new Response(stdout).text();
  expect(out.split(/\r?\n/)).toEqual([
    "directory: package/",
    "file: package/index.js",
    "file: package/package.json",
    "",
  ]);
  expect(await exited).toBe(0);
  expect(await readdirSorted(x_dir)).toEqual([".cache", "test.js"]);
});
