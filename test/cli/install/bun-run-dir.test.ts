import { file, spawn } from "bun";
import { beforeEach, expect, it } from "bun:test";
import { exists, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, readdirSorted, stderrForInstall, tmpdirSync } from "harness";
import { join } from "path";

let run_dir: string;

beforeEach(() => {
  run_dir = tmpdirSync();
});

it("should download dependency to run local file", async () => {
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
  const err1 = stderrForInstall(await new Response(stderr1).text());
  expect(err1).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("uglify-js");
  expect(await readdirSorted(join(run_dir, ".cache", "uglify-js"))).toEqual(["3.17.4@@@1"]);
  expect(await exists(join(run_dir, ".cache", "uglify-js", "3.17.4@@@1", "package.json"))).toBeTrue();
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
  const err2 = stderrForInstall(await new Response(stderr2).text());
  expect(err2).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("uglify-js");
  expect(await readdirSorted(join(run_dir, ".cache", "uglify-js"))).toEqual(["3.17.4@@@1"]);
  const out2 = await new Response(stdout2).text();
  expect(out2.split(/\r?\n/)).toEqual(["print(42);", ""]);
  expect(await exited2).toBe(0);
});

it("should download dependencies to run local file", async () => {
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
  const err1 = stderrForInstall(await new Response(stderr1).text());
  expect(err1).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("decompress");
  expect(await readdirSorted(join(run_dir, ".cache", "decompress"))).toEqual(["4.2.1@@@1"]);
  expect(await exists(join(run_dir, ".cache", "decompress", "4.2.1@@@1", "package.json"))).toBeTrue();
  expect(await file(join(run_dir, ".cache", "decompress", "4.2.1@@@1", "index.js")).text()).toContain(
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
  if (err2) throw new Error(err2);
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("decompress");
  expect(await readdirSorted(join(run_dir, ".cache", "decompress"))).toEqual(["4.2.1@@@1"]);
  expect(await exists(join(run_dir, ".cache", "decompress", "4.2.1@@@1", "package.json"))).toBeTrue();
  expect(await file(join(run_dir, ".cache", "decompress", "4.2.1@@@1", "index.js")).text()).toContain(
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

it("should not crash when downloading a non-existent module, issue#4240", async () => {
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
