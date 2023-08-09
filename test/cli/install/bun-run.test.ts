import { file, spawn, spawnSync } from "bun";
import { afterEach, beforeEach, expect, it, describe } from "bun:test";
import { bunEnv, bunExe, bunEnv as env } from "harness";
import { mkdtemp, realpath, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readdirSorted } from "./dummy.registry";

let run_dir: string;

beforeEach(async () => {
  run_dir = await realpath(
    await mkdtemp(join(tmpdir(), "bun-run.test." + Math.trunc(Math.random() * 9999999).toString(32))),
  );
});
afterEach(async () => {
  await rm(run_dir, { force: true, recursive: true });
});

for (let withRun of [false, true]) {
  describe(withRun ? "bun run" : "bun", () => {
    describe("should work with .", () => {
      it("respecting 'main' field", async () => {
        await writeFile(join(run_dir, "test.js"), "console.log('Hello, world!');");
        await writeFile(
          join(run_dir, "package.json"),
          JSON.stringify({
            name: "test",
            version: "0.0.0",
            main: "test.js",
          }),
        );
        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), withRun ? "run" : "", "."].filter(Boolean),
          cwd: run_dir,
          env: bunEnv,
        });

        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("Hello, world!\n");
        expect(exitCode).toBe(0);
      });

      it("falling back to index", async () => {
        await writeFile(join(run_dir, "index.ts"), "console.log('Hello, world!');");
        await writeFile(
          join(run_dir, "package.json"),
          JSON.stringify({
            name: "test",
            version: "0.0.0",
          }),
        );

        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), withRun ? "run" : "", "."].filter(Boolean),
          cwd: run_dir,
          env: bunEnv,
        });

        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("Hello, world!\n");
        expect(exitCode).toBe(0);
      });

      it("falling back to index with no package.json", async () => {
        await writeFile(join(run_dir, "index.ts"), "console.log('Hello, world!');");

        const { stdout, stderr, exitCode } = spawnSync({
          cmd: [bunExe(), withRun ? "run" : "", "."].filter(Boolean),
          cwd: run_dir,
          env: bunEnv,
        });

        expect(stderr.toString()).toBe("");
        expect(stdout.toString()).toBe("Hello, world!\n");
        expect(exitCode).toBe(0);
      });
    });
  });
}

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
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("uglify-js");
  expect(await readdirSorted(join(run_dir, ".cache", "uglify-js"))).toEqual(["3.17.4"]);
  expect(stdout1).toBeDefined();
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
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("uglify-js");
  expect(await readdirSorted(join(run_dir, ".cache", "uglify-js"))).toEqual(["3.17.4"]);
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.split(/\r?\n/)).toEqual(["print(42);", ""]);
  expect(await exited2).toBe(0);
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
  const {
    stdout: stdout1,
    stderr: stderr1,
    exited: exited1,
  } = spawn({
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
  expect(stderr1).toBeDefined();
  const err1 = await new Response(stderr1).text();
  expect(err1).toBe("");
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
  expect(stdout1).toBeDefined();
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
    stdout: null,
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...env,
      BUN_INSTALL_CACHE_DIR: join(run_dir, ".cache"),
    },
  });
  expect(stderr2).toBeDefined();
  const err2 = await new Response(stderr2).text();
  expect(err2).toBe("");
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
  expect(stdout2).toBeDefined();
  const out2 = await new Response(stdout2).text();
  expect(out2.split(/\r?\n/)).toEqual([
    "directory: package/",
    "file: package/index.js",
    "file: package/package.json",
    "",
  ]);
  expect(await exited2).toBe(0);
});
