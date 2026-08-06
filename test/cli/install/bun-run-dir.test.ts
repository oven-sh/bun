import { file, spawn } from "bun";
import { expect, it, setDefaultTimeout } from "bun:test";
import { exists, mkdir, writeFile } from "fs/promises";
import { bunExe, bunEnv as env, isLinux, isMusl, readdirSorted, tmpdirSync } from "harness";
import { join } from "path";

// These tests auto-install from the npm registry, which can exceed the default
// timeout under slow networks and sanitizer builds.
setDefaultTimeout(90_000);

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
  const err2 = await new Response(stderr2).text();
  expect(err2).toBe("");
  expect(await readdirSorted(run_dir)).toEqual([".cache", "test.js"]);
  expect(await readdirSorted(join(run_dir, ".cache"))).toContain("uglify-js");
  expect(await readdirSorted(join(run_dir, ".cache", "uglify-js"))).toEqual(["3.17.4@@@1"]);
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
  expect(err2).toBe("");
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

// The "Slow filesystem detected" warning fires when populating the install
// cache takes over 100ms, which used to flake stderr assertions in this file
// on slow CI machines. Force the slow path deterministically by delaying
// renameat with an LD_PRELOAD shim, and assert the harness env knob
// (BUN_DISABLE_SLOW_FILESYSTEM_WARNING, set in bunEnv) suppresses it.
const compiler = isLinux && !isMusl ? (Bun.which("cc") ?? Bun.which("gcc") ?? Bun.which("clang")) : null;
it.skipIf(!compiler)("BUN_DISABLE_SLOW_FILESYSTEM_WARNING suppresses the slow filesystem warning", async () => {
  const run_dir = tmpdirSync();
  await writeFile(
    join(run_dir, "slow_rename.c"),
    `#define _GNU_SOURCE
#include <dlfcn.h>
#include <unistd.h>
int renameat(int olddirfd, const char *oldpath, int newdirfd, const char *newpath) {
  static int (*real)(int, const char *, int, const char *);
  if (!real) real = dlsym(RTLD_NEXT, "renameat");
  usleep(250000);
  return real(olddirfd, oldpath, newdirfd, newpath);
}
`,
  );
  await using cc = spawn({
    cmd: [compiler!, "-shared", "-fPIC", "-o", "slow_rename.so", "slow_rename.c", "-ldl"],
    cwd: run_dir,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  expect(await cc.exited).toBe(0);

  // Each run gets a fresh project and cache so the install always populates
  // the cache (a satisfied node_modules would skip the timed path).
  const install = async (name: string, flag: string | undefined) => {
    const proj = join(run_dir, name);
    await mkdir(proj);
    await writeFile(
      join(proj, "package.json"),
      JSON.stringify({
        name,
        dependencies: { baz: `file:${join(import.meta.dir, "baz-0.0.3.tgz")}` },
      }),
    );
    await using proc = spawn({
      cmd: [bunExe(), "install", "--no-save"],
      cwd: proj,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...env,
        LD_PRELOAD: join(run_dir, "slow_rename.so"),
        BUN_INSTALL_CACHE_DIR: join(proj, ".cache"),
        BUN_DISABLE_SLOW_FILESYSTEM_WARNING: flag,
      },
    });
    const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
    expect(exitCode).toBe(0);
    return stderr;
  };

  // Sanity: with the knob unset, the delayed renameat must trigger the warning.
  expect(await install("warn", undefined)).toContain("Slow filesystem detected");
  // With the knob set (as bunEnv does for every test), it must stay silent.
  expect(await install("quiet", "1")).not.toContain("Slow filesystem");
});
