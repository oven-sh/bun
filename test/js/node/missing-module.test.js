import assert from "assert";
import { expect, test } from "bun:test";
import { readdirSync, statSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("not implemented yet module throws an error", () => {
  var missingModule = "node:missing";
  var missingBun = "bun:missing";
  var missingFile = "./filethatdoesntexist";
  var missingPackage = "package-that-doesnt-exist";

  assert.throws(() => require(missingModule), {
    message: "No such built-in module: node:missing",
    code: "ERR_UNKNOWN_BUILTIN_MODULE",
  });
  assert.throws(() => require.resolve(missingModule), {
    message: /^Cannot find module 'node:missing'\nRequire stack:\n- /,
    code: "MODULE_NOT_FOUND",
  });
  assert.rejects(() => import(missingModule), {
    message: "No such built-in module: node:missing",
    code: "ERR_UNKNOWN_BUILTIN_MODULE",
  });

  assert.throws(() => require(missingBun), {
    message: /^Cannot find module 'bun:missing'\nRequire stack:\n- /,
    code: "MODULE_NOT_FOUND",
  });
  assert.throws(() => require.resolve(missingBun), {
    message: /^Cannot find module 'bun:missing'\nRequire stack:\n- /,
    code: "MODULE_NOT_FOUND",
  });
  assert.rejects(() => import(missingBun), {
    message: /^Cannot find package 'bun:missing' imported from /,
    code: "ERR_MODULE_NOT_FOUND",
  });

  assert.throws(() => require(missingFile), {
    message: /^Cannot find module '\.\/filethatdoesntexist'/,
    code: "MODULE_NOT_FOUND",
  });
  assert.throws(() => require.resolve(missingFile), {
    message: /^Cannot find module '\.\/filethatdoesntexist'/,
    code: "MODULE_NOT_FOUND",
  });
  assert.rejects(() => import(missingFile), {
    message: /^Cannot find module '\.\/filethatdoesntexist'/,
    code: "ERR_MODULE_NOT_FOUND",
  });

  assert.throws(() => require(missingPackage), {
    message: /^Cannot find module 'package-that-doesnt-exist'\nRequire stack:\n- /,
    code: "MODULE_NOT_FOUND",
  });
  assert.throws(() => require.resolve(missingPackage), {
    message: /^Cannot find module 'package-that-doesnt-exist'\nRequire stack:\n- /,
    code: "MODULE_NOT_FOUND",
  });
  assert.rejects(() => import(missingPackage), {
    message: /^Cannot find package 'package-that-doesnt-exist' imported from /,
    code: "ERR_MODULE_NOT_FOUND",
  });
});

test("a literal bun: specifier that names no builtin fails like a computed one", async () => {
  assert.throws(() => require("bun:missing"), {
    message: /^Cannot find module 'bun:missing'\nRequire stack:\n- /,
    code: "MODULE_NOT_FOUND",
  });
  assert.throws(() => require.resolve("bun:missing"), {
    message: /^Cannot find module 'bun:missing'\nRequire stack:\n- /,
    code: "MODULE_NOT_FOUND",
  });
  await assert.rejects(() => import("bun:missing"), {
    message: /^Cannot find package 'bun:missing' imported from /,
    code: "ERR_MODULE_NOT_FOUND",
  });
});

// Source for a fixture. It gives "loaded", or the code of the error.
const outcome = `
  async function outcome(load) {
    try {
      await load();
      return "loaded";
    } catch (error) {
      return error.code;
    }
  }
`;
const packageNamed = name => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, main: "index.js" }),
  [`node_modules/${name}/index.js`]: `module.exports = "the package named like the suffix";`,
});
const literalSpecifiers = {
  "entry.mjs": `
    ${outcome}
    console.log(JSON.stringify({
      // The entry point is transpiled on the main thread, a module it imports on the transpiler thread.
      "require()": await outcome(() => require("bun:missing")),
      "require.resolve()": await outcome(() => require.resolve("bun:missing")),
      "import()": await outcome(() => import("bun:missing")),
      "import statement": await outcome(() => import("./dependency.mjs")),
      // "bun:bundle" exists at build time only, as a static import.
      "bun:bundle": await outcome(() => import("bun:bundle")),
      // "ws" is a builtin, but not a Node.js one.
      "bun:ws": await outcome(() => import("bun:ws")),
      // "stream/iter" is a Node.js builtin only with --experimental-stream-iter.
      "bun:stream/iter": await outcome(() => import("bun:stream/iter")),
    }));
  `,
  "dependency.mjs": `import "bun:missing";`,
};
const notFound = {
  "require()": "MODULE_NOT_FOUND",
  "require.resolve()": "MODULE_NOT_FOUND",
  "import()": "ERR_MODULE_NOT_FOUND",
  "import statement": "ERR_MODULE_NOT_FOUND",
  "bun:bundle": "ERR_MODULE_NOT_FOUND",
  "bun:ws": "ERR_MODULE_NOT_FOUND",
  "bun:stream/iter": "ERR_MODULE_NOT_FOUND",
};

test.concurrent(
  "a literal bun: specifier that names no builtin does not load the package named like its suffix",
  async () => {
    using dir = tempDir("bun-prefix-package", {
      ...packageNamed("missing"),
      ...packageNamed("bundle"),
      ...packageNamed("ws"),
      ...packageNamed("stream"),
      "node_modules/stream/iter.js": `module.exports = "a file of the package named like the suffix";`,
      ...literalSpecifiers,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(notFound);
    expect(exitCode).toBe(0);
  },
);

// bun test maps "vitest" and "@jest/globals" to "bun:test".
test.concurrent("a literal bun: specifier that names no builtin does not load a package in bun test", async () => {
  using dir = tempDir("bun-prefix-bun-test", {
    ...packageNamed("vitest"),
    ...packageNamed("@jest/globals"),
    "entry.test.js": `
      ${outcome}
      console.log(JSON.stringify({
        "bun:vitest": await outcome(() => import("bun:vitest")),
        "bun:@jest/globals": await outcome(() => import("bun:@jest/globals")),
      }));
      require("bun:test").test("ran", () => {});
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "./entry.test.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The first line of stdout is the version of bun test.
  expect(JSON.parse(stdout.slice(stdout.indexOf("{")))).toEqual({
    "bun:vitest": "ERR_MODULE_NOT_FOUND",
    "bun:@jest/globals": "ERR_MODULE_NOT_FOUND",
  });
  expect(stderr).toContain(" 1 pass");
  expect(exitCode).toBe(0);
});

// With no node_modules directory, the runtime installs a package that it does not find.
test.concurrent("a literal bun: specifier that names no builtin does not ask the registry for its suffix", async () => {
  const requests = [];
  await using registry = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push(new URL(request.url).pathname);
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    },
  });
  using dir = tempDir("bun-prefix-registry", literalSpecifiers);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--install=force", "entry.mjs"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      BUN_CONFIG_REGISTRY: registry.url.href,
      NPM_CONFIG_REGISTRY: registry.url.href,
      BUN_INSTALL_CACHE_DIR: join(String(dir), "install-cache"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(requests).toEqual([]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(notFound);
  expect(exitCode).toBe(0);
});

// bun test maps "vitest" to "bun:test" and bun run does not. The key of a transpiler cache entry
// does not say which of the two wrote the entry.
test.concurrent.each([
  ["bun run, then bun test", [["module.js"], ["test", "./entry.test.js"]]],
  ["bun test, then bun run", [["test", "./entry.test.js"], ["module.js"]]],
])("a literal bun: specifier that names no builtin is cached as written: %s", async (_, runs) => {
  using dir = tempDir("bun-prefix-cache", {
    "node_modules/vitest/package.json": JSON.stringify({ name: "vitest", main: "index.js" }),
    "node_modules/vitest/index.js": `console.log("loaded the package named like the suffix");`,
    // Only a module of 4 KiB or more is cached.
    "module.js": `import "bun:vitest";\n//` + Buffer.alloc(5 * 1024, "f").toString(),
    "entry.test.js": `import "./module.js";`,
  });
  const cache = join(String(dir), "cache");
  const entries = [];
  for (const args of runs) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: { ...bunEnv, BUN_RUNTIME_TRANSPILER_CACHE_PATH: cache, BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).not.toContain("loaded the package named like the suffix");
    expect(stderr).toContain("'bun:vitest'");
    expect(exitCode).toBe(1);
    const names = readdirSync(cache);
    expect(names).toHaveLength(1);
    const { ino, mtimeNs } = statSync(join(cache, names[0]), { bigint: true });
    entries.push({ name: names[0], ino, mtimeNs });
  }
  // The second run restores the entry of the first run. A run that does not restore it writes it again.
  expect(entries[1]).toEqual(entries[0]);
});

test.concurrent("a literal bun: specifier that names no builtin reaches the module a plugin registers", async () => {
  using dir = tempDir("bun-prefix-plugin", {
    "plugin.js": `
      Bun.plugin({
        name: "bun:virtual",
        setup(build) {
          build.module("bun:virtual", () => ({ exports: { default: "build.module()" }, loader: "object" }));
        },
      });
    `,
    "entry.mjs": `
      import statically from "bun:virtual";
      const required = require("bun:virtual");
      const dynamic = await import("bun:virtual");
      console.log(statically, required.default, dynamic.default);
    `,
  });
  await using proc = Bun.spawn({
    // --no-install: without "bun:", the specifier is a package name that the runtime can download.
    cmd: [bunExe(), "--no-install", "--preload", "./plugin.js", "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "build.module() build.module() build.module()\n",
    stderr: "",
    exitCode: 0,
  });
});

// "bun:fs" is not a module, but it has always loaded "fs", and programs import it.
test.concurrent("a literal bun: specifier whose suffix is a bare Node.js builtin loads that builtin", async () => {
  using dir = tempDir("bun-prefix-builtin", {
    "entry.mjs": `
      import { existsSync } from "bun:fs";
      import "./dependency.mjs";
      const { EventEmitter } = require("bun:events");
      const os = await import("bun:os");
      console.log(typeof existsSync, typeof EventEmitter, typeof os.cpus);
    `,
    "dependency.mjs": `
      import { join } from "bun:path";
      console.log(typeof join);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "function\nfunction function function\n",
    stderr: "",
    exitCode: 0,
  });
});
