import { pathToFileURL } from "bun";
import { describe, expect, it } from "bun:test";
import { chmodSync, chownSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isLinux, isWindows, joinP, tempDir, tempDirWithFiles } from "harness";
import { join, resolve, sep } from "path";

const fixture = (...segs: string[]) => resolve(import.meta.dir, "fixtures", ...segs);

it("spawn test file", () => {
  writePackageJSONImportsFixture();
  writePackageJSONExportsFixture();

  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "test", "./resolve-test.js"],
    env: bunEnv,
    cwd: import.meta.dir,
    stdio: ["inherit", "inherit", "inherit"],
  });

  expect(exitCode).toBe(0);
});

function writePackageJSONExportsFixture() {
  try {
    mkdirSync(join(import.meta.dir, "./node_modules/package-json-exports/foo"), {
      recursive: true,
    });
  } catch (exception) {}
  writeFileSync(join(import.meta.dir, "./node_modules/package-json-exports/foo/bar.js"), "export const bar = 1;");
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-exports/foo/references-baz.js"),
    "export {bar} from 'package-json-exports/baz';",
  );
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-exports/package.json"),
    JSON.stringify(
      {
        name: "package-json-exports",
        exports: {
          "./baz": "./foo/bar.js",
          "./references-baz": "./foo/references-baz.js",
        },
      },
      null,
      2,
    ),
  );
}

function writePackageJSONImportsFixture() {
  try {
    mkdirSync(join(import.meta.dir, "./node_modules/package-json-imports/foo"), {
      recursive: true,
    });
  } catch (exception) {}
  writeFileSync(join(import.meta.dir, "./node_modules/package-json-imports/foo/bar.js"), "export const bar = 1;");
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-imports/foo/wildcard.js"),
    "export const wildcard = 1;",
  );
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-imports/foo/private-foo.js"),
    "export {bar} from 'package-json-imports/#foo';",
  );
  writeFileSync(
    join(import.meta.dir, "./node_modules/package-json-imports/package.json"),
    JSON.stringify(
      {
        name: "package-json-imports",
        exports: {
          "./baz": "./foo/bar.js",
        },
        imports: {
          "#foo/bar": "./foo/private-foo.js",
          "#foo/*.js": "./foo/*.js",
          "#foo/extensionless/*": "./foo/*.js",
          "#foo": "./foo/private-foo.js",

          "#internal-react": "react",

          "#to_node_module": "async_hooks",
        },
      },
      null,
      2,
    ),
  );
}

it("file url in import resolves", async () => {
  const dir = tempDirWithFiles("fileurl", {
    "index.js": "export const foo = 1;",
  });
  writeFileSync(`${dir}/test.js`, `import {foo} from '${pathToFileURL(dir)}/index.js';\nconsole.log(foo);`);

  console.log(dir);
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });
  try {
    expect(exitCode).toBe(0);
  } catch (e) {
    console.log(stdout.toString("utf8"));
    throw e;
  }
  expect(stdout.toString("utf8")).toBe("1\n");
});

it("invalid file url in import throws error", async () => {
  const dir = tempDirWithFiles("fileurl", {});
  writeFileSync(`${dir}/test.js`, `import {foo} from 'file://\0invalid url';\nconsole.log(foo);`);

  const { exitCode, stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });
  expect(exitCode).not.toBe(0);
  expect(stderr.toString("utf8")).toContain("file://\0invalid url");
});

it("file url in await import resolves", async () => {
  const dir = tempDirWithFiles("fileurl", {
    "index.js": "export const foo = 1;",
  });
  writeFileSync(`${dir}/test.js`, `const {foo} = await import('${pathToFileURL(dir)}/index.js');\nconsole.log(foo);`);

  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("1\n");
});

it("file url with special characters in await import resolves", async () => {
  const filename = "🅱️ndex.js";
  const dir = tempDirWithFiles("file url", {
    [filename]: "export const foo = 1;",
  });
  console.log(dir);
  writeFileSync(
    `${dir}/test.js`,
    `const {foo} = await import('${pathToFileURL(dir)}/${encodeURIComponent(filename)}');\nconsole.log(foo);`,
  );

  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("1\n");
});

it("file url with special characters not encoded in await import resolves", async () => {
  const filename = "🅱️ndex.js";
  const dir = tempDirWithFiles("file url", {
    [filename]: "export const foo = 1;",
  });
  writeFileSync(
    `${dir}/test.js`,
    `const {foo} = await import('${pathToFileURL(dir)}/${filename}');\nconsole.log(foo);`,
  );

  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("1\n");
});

it("file url with special characters in import statement resolves", async () => {
  const filename = "🅱️ndex.js";
  const dir = tempDirWithFiles("file url", {
    [filename]: "export const foo = 1;",
  });
  writeFileSync(
    `${dir}/test.js`,
    `import {foo} from '${pathToFileURL(dir)}/${encodeURIComponent(filename)}';\nconsole.log(foo);`,
  );

  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("1\n");
});

it("file url with special characters not encoded in import statement resolves", async () => {
  const filename = "🅱️ndex.js";
  const dir = tempDirWithFiles("file url", {
    [filename]: "export const foo = 1;",
  });
  writeFileSync(`${dir}/test.js`, `import {foo} from '${pathToFileURL(dir)}/${filename}';\nconsole.log(foo);`);

  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("1\n");
});

it("file url in require resolves", async () => {
  const dir = tempDirWithFiles("fileurl", {
    "index.js": "export const foo = 1;",
  });
  writeFileSync(`${dir}/test.js`, `const {foo} = require('${pathToFileURL(dir)}/index.js');\nconsole.log(foo);`);

  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("1\n");
});

it("file url with special characters in require resolves", async () => {
  const filename = "🅱️ndex.js";
  const dir = tempDirWithFiles("file url", {
    [filename]: "export const foo = 1;",
  });
  writeFileSync(
    `${dir}/test.js`,
    `const {foo} = require('${pathToFileURL(dir)}/${encodeURIComponent(filename)}');\nconsole.log(foo);`,
  );

  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("1\n");
});

it("file url in require.resolve resolves", async () => {
  const dir = tempDirWithFiles("fileurl", {
    "index.js": "export const foo = 1;",
  });
  writeFileSync(`${dir}/test.js`, `const to = require.resolve('${pathToFileURL(dir)}/index.js');\nconsole.log(to);`);

  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe(`${dir}${sep}index.js\n`);
});

it("file url with special characters in require resolves", async () => {
  const filename = "🅱️ndex.js";
  const dir = tempDirWithFiles("file url", {
    [filename]: "export const foo = 1;",
  });
  writeFileSync(
    `${dir}/test.js`,
    `const to = require.resolve('${pathToFileURL(dir)}/${encodeURIComponent(filename)}');\nconsole.log(to);`,
  );

  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });
  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe(`${dir}${sep}${filename}\n`);
});

it("import long string should not segfault", async () => {
  try {
    await import("a".repeat(10000));
  } catch {}
});
it("import long string should not segfault", async () => {
  try {
    import.meta.require("a".repeat(10000));
  } catch {}
});
it("import long string should not segfault", async () => {
  try {
    await import.meta.resolve!("a".repeat(10000));
  } catch {}
});
it("import long string should not segfault", async () => {
  try {
    await import.meta.require.resolve("a".repeat(10000));
  } catch {}
});

it("import override to node builtin", async () => {
  // @ts-expect-error
  expect(await import("#async_hooks")).toBeDefined();
});

it("import override to bun", async () => {
  // @ts-expect-error
  expect(await import("#bun")).toBeDefined();
});

it("import override to bun:test", async () => {
  // @ts-expect-error
  expect(await import("#bun_test")).toBeDefined();
});

it.if(isWindows)("directory cache key computation", () => {
  expect(import(`${process.cwd()}\\\\doesnotexist.ts`)).rejects.toThrow();
  expect(import(`${process.cwd()}\\\\\\doesnotexist.ts`)).rejects.toThrow();
  expect(import(`\\\\Test\\\\doesnotexist.ts\\` as any)).rejects.toThrow();
  expect(import(`\\\\Test\\\\doesnotexist.ts\\\\` as any)).rejects.toThrow();
  expect(import(`\\\\Test\\\\doesnotexist.ts\\\\\\` as any)).rejects.toThrow();
  expect(import(`\\\\Test\\\\\\doesnotexist.ts` as any)).rejects.toThrow();
  expect(import(`\\\\Test\\\\\\\\doesnotexist.ts` as any)).rejects.toThrow();
  expect(import(`\\\\Test\\doesnotexist.ts` as any)).rejects.toThrow();
  expect(import(`\\\\\\Test\\doesnotexist.ts` as any)).rejects.toThrow();
  expect(import(`\\\\Test\\\\\\doesnotexist.ts\\` as any)).rejects.toThrow();
  expect(import(`\\\\Test\\\\\\\\doesnotexist.ts\\` as any)).rejects.toThrow();
  expect(import(`\\\\Test\\doesnotexist.ts\\` as any)).rejects.toThrow();
  expect(import(`\\\\\\Test\\doesnotexist.ts\\` as any)).rejects.toThrow();
  expect(import(`\\\\Test\\\\\\doesnotexist.ts\\\\` as any)).rejects.toThrow();
  expect(import(`\\\\Test\\\\\\\\doesnotexist.ts\\\\` as any)).rejects.toThrow();
  expect(import(`\\\\Test\\doesnotexist.ts\\\\` as any)).rejects.toThrow();
  expect(import(`\\\\\\Test\\doesnotexist.ts\\\\` as any)).rejects.toThrow();
});

describe("NODE_PATH test", () => {
  const prepareTest = () => {
    const tempDir = tempDirWithFiles("node_path", {
      "modules/node_modules/node-path-test/index.js": "exports.testValue = 'NODE_PATH works';",
      "modules/node_modules/node-path-test/package.json": JSON.stringify({
        name: "node-path-test",
        version: "1.0.0",
        description: "A node_path test module",
        main: "index.js",
      }),
      "lib/node_modules/node-path-test/index.js": "exports.testValue = 'NODE_PATH from lib works';",
      "lib/node_modules/node-path-test/package.json": JSON.stringify({
        name: "node-path-test",
        version: "1.0.0",
        description: "A node_path test module from lib",
        main: "index.js",
      }),
      "test/index.js": "const { testValue } = require('node-path-test');\nconsole.log(testValue);",
    });

    const nodePath = joinP(tempDir, "modules/node_modules");
    const nodePathLib = joinP(tempDir, "lib/node_modules");
    const testDir = joinP(tempDir, "test");

    const delimiter = isWindows ? ";" : ":";

    return {
      tempDir,
      nodePath,
      nodePathLib,
      testDir,
      delimiter,
    };
  };

  it("should resolve modules from NODE_PATH", () => {
    const { nodePath, testDir } = prepareTest();

    const { exitCode, stdout } = Bun.spawnSync({
      cmd: [bunExe(), "--no-install", "index.js"],
      env: { ...bunEnv, NODE_PATH: nodePath },
      cwd: testDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString().trim()).toBe("NODE_PATH works");
  });

  it("should resolve modules from NODE_PATH entries", () => {
    const { nodePath, testDir, delimiter } = prepareTest();

    const { exitCode, stdout } = Bun.spawnSync({
      cmd: [bunExe(), "--no-install", "index.js"],
      env: { ...bunEnv, NODE_PATH: [nodePath].join(delimiter) },
      cwd: testDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString().trim()).toBe("NODE_PATH works");
  });

  it("should resolve first matched module from NODE_PATH entries", () => {
    const { nodePath, nodePathLib, testDir, delimiter } = prepareTest();

    const { exitCode, stdout } = Bun.spawnSync({
      cmd: [bunExe(), "--no-install", "index.js"],
      env: { ...bunEnv, NODE_PATH: ["/a/path/not/exist", nodePathLib, nodePath].join(delimiter) },
      cwd: testDir,
    });

    expect(exitCode).toBe(0);
    expect(stdout.toString().trim()).toBe("NODE_PATH from lib works");
  });
});

// https://nodejs.org/api/modules.html#loading-from-the-global-folders
describe("global folders resolution", () => {
  const homeVar = isWindows ? "USERPROFILE" : "HOME";

  const fixture = {
    "home/.node_modules/gp-from-nm/index.js": "module.exports = 'FROM_HOME_NODE_MODULES';",
    "home/.node_libraries/gp-from-lib/index.js": "module.exports = 'FROM_HOME_NODE_LIBRARIES';",
    "home/.node_modules/gp-both/index.js": "module.exports = 'NM_WINS';",
    "home/.node_libraries/gp-both/index.js": "module.exports = 'LIB_LOSES';",
    "np/gp-from-np/index.js": "module.exports = 'FROM_NODE_PATH';",
    "np/gp-from-nm/index.js": "module.exports = 'NODE_PATH_WINS';",
    "proj/package.json": JSON.stringify({ name: "proj", type: "commonjs" }),
    "proj/node_modules/gp-local/index.js": "module.exports = 'LOCAL_WINS';",
    "home/.node_modules/gp-local/index.js": "module.exports = 'GLOBAL_LOSES';",
    "proj/app.js": `
      const M = require("node:module");
      let result = {};
      for (const name of ["gp-from-nm", "gp-from-lib", "gp-both", "gp-from-np", "gp-local"]) {
        try { result[name] = require(name); } catch (e) { result[name] = "THREW:" + e.code; }
      }
      result.globalPaths = M.globalPaths;
      result.resolvePaths = require.resolve.paths("gp-from-nm");
      result.lookupPaths = M._resolveLookupPaths("gp-from-nm", module);
      console.log(JSON.stringify(result));
    `,
  };

  it("resolves bare specifiers from $HOME/.node_modules and $HOME/.node_libraries", () => {
    using dir = tempDir("global-folders", fixture);
    const home = joinP(String(dir), "home");
    const proj = joinP(String(dir), "proj");
    const np = joinP(String(dir), "np");
    const { exitCode, stdout, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "--no-install", "app.js"],
      env: { ...bunEnv, [homeVar]: home, NODE_PATH: np },
      cwd: proj,
    });
    const out = stdout.toString().trim();
    expect(stderr.toString()).toBe("");
    const result = JSON.parse(out);

    // require() resolution
    expect(result["gp-from-nm"]).toBe("NODE_PATH_WINS"); // NODE_PATH before $HOME/.node_modules
    expect(result["gp-from-lib"]).toBe("FROM_HOME_NODE_LIBRARIES");
    expect(result["gp-both"]).toBe("NM_WINS"); // .node_modules before .node_libraries
    expect(result["gp-from-np"]).toBe("FROM_NODE_PATH");
    expect(result["gp-local"]).toBe("LOCAL_WINS"); // local node_modules before global folders

    // Module.globalPaths is populated
    expect(result.globalPaths).toContain(np);
    expect(result.globalPaths).toContain(joinP(home, ".node_modules"));
    expect(result.globalPaths).toContain(joinP(home, ".node_libraries"));
    // Node orders globalPaths as [...NODE_PATH, .node_modules, .node_libraries, $PREFIX/lib/node]
    expect(result.globalPaths.indexOf(np)).toBeLessThan(result.globalPaths.indexOf(joinP(home, ".node_modules")));
    expect(result.globalPaths.indexOf(joinP(home, ".node_modules"))).toBeLessThan(
      result.globalPaths.indexOf(joinP(home, ".node_libraries")),
    );
    // $PREFIX/lib/node is the last entry
    expect(result.globalPaths[result.globalPaths.length - 1]).toEndWith(joinP("lib", "node"));

    // require.resolve.paths() and Module._resolveLookupPaths() append the global folders
    // after the per-directory node_modules entries.
    for (const paths of [result.resolvePaths, result.lookupPaths]) {
      expect(paths).toContain(joinP(proj, "node_modules"));
      expect(paths).toContain(joinP(home, ".node_modules"));
      expect(paths).toContain(joinP(home, ".node_libraries"));
      expect(paths.indexOf(joinP(proj, "node_modules"))).toBeLessThan(paths.indexOf(joinP(home, ".node_modules")));
    }
    expect(exitCode).toBe(0);
  });

  it("resolves from $HOME/.node_modules when NODE_PATH is unset", () => {
    using dir = tempDir("global-folders", fixture);
    const home = joinP(String(dir), "home");
    const proj = joinP(String(dir), "proj");
    const { exitCode, stdout, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "--no-install", "app.js"],
      env: { ...bunEnv, [homeVar]: home, NODE_PATH: "" },
      cwd: proj,
    });
    expect(stderr.toString()).toBe("");
    const result = JSON.parse(stdout.toString().trim());
    expect(result["gp-from-nm"]).toBe("FROM_HOME_NODE_MODULES");
    expect(result["gp-from-lib"]).toBe("FROM_HOME_NODE_LIBRARIES");
    expect(result["gp-from-np"]).toBe("THREW:MODULE_NOT_FOUND");
    expect(result.globalPaths).toContain(joinP(home, ".node_modules"));
    expect(exitCode).toBe(0);
  });

  it("returns MODULE_NOT_FOUND when HOME is unset and no global folder matches", () => {
    using dir = tempDir("global-folders", fixture);
    const proj = joinP(String(dir), "proj");
    const env = { ...bunEnv, NODE_PATH: "" };
    delete env[homeVar];
    const { exitCode, stdout } = Bun.spawnSync({
      cmd: [bunExe(), "--no-install", "app.js"],
      env,
      cwd: proj,
    });
    const result = JSON.parse(stdout.toString().trim());
    expect(result["gp-from-nm"]).toBe("THREW:MODULE_NOT_FOUND");
    expect(result["gp-from-lib"]).toBe("THREW:MODULE_NOT_FOUND");
    expect(result["gp-local"]).toBe("LOCAL_WINS");
    // globalPaths still has $PREFIX/lib/node even without HOME
    expect(result.globalPaths.length).toBeGreaterThanOrEqual(1);
    expect(result.globalPaths[result.globalPaths.length - 1]).toEndWith(joinP("lib", "node"));
    expect(exitCode).toBe(0);
  });
});

it("can resolve with source directories that do not exist", () => {
  // In Nuxt/Vite, the following call happens:
  // `require("module").createRequire("file:///Users/clo/my-nuxt-app/@vue/server-renderer")("vue")`
  // This seems to be a bug in their code, not using a concrete file path for
  // this virtual module, such as 'node_modules/@vue/server-renderer/index.js',
  // but the same exact resolution happens and succeeds in Node.js
  const dir = tempDirWithFiles("resolve", {
    "node_modules/vue/index.js": "export default 123;",
    "test.js": `
      const { createRequire } = require('module');
      const assert = require('assert');
      const req = createRequire(import.meta.url + '/@vue/server-renderer');
      assert.strictEqual(req('vue').default, 123);
    `,
  });

  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "test.js"],
    env: bunEnv,
    cwd: dir,
    stdio: ["ignore", "inherit", "inherit"],
  });

  expect(exitCode).toBe(0);
});

describe("When CJS and ESM are mixed", () => {
  const fixturePath = fixture("tsyringe.ts");

  // https://github.com/oven-sh/bun/issues/4677
  it("loads reflect-metadata before tsyringe", async () => {
    const { stderr } = bunRun(fixturePath);
    expect(stderr).toBeEmpty();
  });
});

// The "browser" map resolver copied the normalized input path into a 512-byte
// threadlocal buffer without a bounds check. Paths inside deep directory trees
// can easily exceed 512 bytes while still being well under MAX_PATH_BYTES.
it.skipIf(isWindows)("browser map resolution handles relative paths longer than 512 bytes", async () => {
  // Build a nested relative path longer than 512 bytes. Each component stays
  // well under NAME_MAX and the absolute path stays well under MAX_PATH_BYTES.
  const segments: string[] = [];
  let len = 0;
  while (len <= 520) {
    const seg = "nested-directory-" + segments.length;
    segments.push(seg);
    len += seg.length + 1;
  }
  const deep = segments.join("/");
  expect(deep.length).toBeGreaterThan(512);

  using dir = tempDir("resolver-browser-long-path", {
    "package.json": JSON.stringify({
      name: "pkg",
      browser: { "./unused.js": "./unused.js" },
    }),
    "entry.js": `import {x} from "./${deep}/target.js"; console.log(x);`,
    [`${deep}/target.js`]: `export const x = 42;`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--target=browser", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("42");
  expect(exitCode).toBe(0);
});

// ESModule.Package.parse scanned the entire specifier for an `@` to split off a
// version. For wildcard `exports` maps the matched substring can contain `@`
// (e.g. `ember-source/@ember/renderer/...`, `pkg/@scope/sub`) — those `@`s
// aren't version delimiters, they're subpath content. The version split must
// be bounded to the package-name portion of the specifier.
// https://github.com/oven-sh/bun/issues/30187
describe("wildcard exports with @ in matched subpath", () => {
  it.concurrent("resolves a subpath whose wildcard match starts with @", () => {
    using dir = tempDir("resolver-wildcard-at-scoped", {
      "package.json": JSON.stringify({ name: "host" }),
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
        exports: { "./*": "./dist/packages/*" },
      }),
      "node_modules/test-pkg/dist/packages/plain/index.js": "export default 'plain';",
      "node_modules/test-pkg/dist/packages/@scope/sub/index.js": "export default 'scoped';",
    });
    const root = String(dir);

    expect(Bun.resolveSync("test-pkg/plain/index.js", root)).toBe(
      join(root, "node_modules/test-pkg/dist/packages/plain/index.js"),
    );
    expect(Bun.resolveSync("test-pkg/@scope/sub/index.js", root)).toBe(
      join(root, "node_modules/test-pkg/dist/packages/@scope/sub/index.js"),
    );
  });

  it.concurrent("resolves a subpath that contains `@` mid-segment", () => {
    using dir = tempDir("resolver-wildcard-at-mid", {
      "package.json": JSON.stringify({ name: "host" }),
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
        exports: { "./*": "./dist/packages/*" },
      }),
      "node_modules/test-pkg/dist/packages/with@sign/sub/index.js": "export default 'sign';",
    });
    const root = String(dir);

    expect(Bun.resolveSync("test-pkg/with@sign/sub/index.js", root)).toBe(
      join(root, "node_modules/test-pkg/dist/packages/with@sign/sub/index.js"),
    );
  });

  it.concurrent("resolves an @-prefixed subpath under a scoped package", () => {
    using dir = tempDir("resolver-wildcard-at-scoped-pkg", {
      "package.json": JSON.stringify({ name: "host" }),
      "node_modules/@my/pkg/package.json": JSON.stringify({
        name: "@my/pkg",
        version: "1.0.0",
        exports: { "./*": "./dist/*" },
      }),
      "node_modules/@my/pkg/dist/@inner/bar/index.js": "export default 'inner';",
    });
    const root = String(dir);

    expect(Bun.resolveSync("@my/pkg/@inner/bar/index.js", root)).toBe(
      join(root, "node_modules/@my/pkg/dist/@inner/bar/index.js"),
    );
  });

  // Regression guard: `@version` specifiers immediately following the package
  // name must still be stripped. We don't install alternative versions; we just
  // verify `pkg@1.0.0/subpath` still resolves to the same file as `pkg/subpath`.
  it.concurrent("still strips a trailing @version after the package name", () => {
    using dir = tempDir("resolver-wildcard-versioned", {
      "package.json": JSON.stringify({ name: "host" }),
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
        exports: { "./*": "./dist/packages/*" },
      }),
      "node_modules/test-pkg/dist/packages/plain/index.js": "export default 'plain';",
    });
    const root = String(dir);

    expect(Bun.resolveSync("test-pkg@1.0.0/plain/index.js", root)).toBe(
      join(root, "node_modules/test-pkg/dist/packages/plain/index.js"),
    );
  });

  // Regression guard for the scoped-package version split: the `@version`
  // delimiter still falls inside the name span `parseName` returns (between
  // the leading `@` and the second `/`), so the version branch must still
  // fire for `@scope/pkg@ver/sub`.
  it.concurrent("still strips @version after a scoped package name", () => {
    using dir = tempDir("resolver-wildcard-scoped-versioned", {
      "package.json": JSON.stringify({ name: "host" }),
      "node_modules/@my/pkg/package.json": JSON.stringify({
        name: "@my/pkg",
        version: "1.0.0",
        exports: { "./*": "./dist/*" },
      }),
      "node_modules/@my/pkg/dist/sub/index.js": "export default 'sub';",
    });
    const root = String(dir);

    expect(Bun.resolveSync("@my/pkg@1.0.0/sub/index.js", root)).toBe(
      join(root, "node_modules/@my/pkg/dist/sub/index.js"),
    );
  });
});

describe("package.json exports target percent-encoding", () => {
  // ESModule.finalize short-circuits when the resolved path contains no '%'.
  // These cases exercise both that branch and the decode branch to keep them in lockstep.
  const resolveError = (spec: string, root: string) => {
    try {
      return { resolved: Bun.resolveSync(spec, root) };
    } catch (e: any) {
      return { name: e.name, code: e.code };
    }
  };

  it.concurrent("resolves a plain target and rejects a directory target", () => {
    using dir = tempDir("resolver-exports-finalize-plain", {
      "package.json": JSON.stringify({ name: "host" }),
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
        exports: { "./ok": "./lib/ok.js", "./dir": "./lib/" },
      }),
      "node_modules/test-pkg/lib/ok.js": "module.exports = 1;",
      "node_modules/test-pkg/lib/index.js": "module.exports = 2;",
    });
    const root = String(dir);

    expect(Bun.resolveSync("test-pkg/ok", root)).toBe(join(root, "node_modules/test-pkg/lib/ok.js"));
    // lib/index.js exists; rejection must come from the directory-target check, not a missing file.
    expect(resolveError("test-pkg/dir", root)).toEqual({ name: "ResolveMessage", code: "ERR_MODULE_NOT_FOUND" });
  });

  it.concurrent("decodes a percent-encoded target and rejects encoded path separators", () => {
    using dir = tempDir("resolver-exports-finalize-percent", {
      "package.json": JSON.stringify({ name: "host" }),
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
        exports: {
          "./space": "./lib/with%20space.js",
          "./sep-2f": "./lib%2ffile.js",
          "./sep-2F": "./lib%2Ffile.js",
          "./sep-5c": "./lib%5cfile.js",
          "./sep-5C": "./lib%5Cfile.js",
          "./bad": "./lib/%%.js",
        },
      }),
      "node_modules/test-pkg/lib/with space.js": "module.exports = 1;",
      // lib/file.js exists; rejection must come from the encoded-separator check, not a missing file.
      "node_modules/test-pkg/lib/file.js": "module.exports = 2;",
    });
    const root = String(dir);

    expect(Bun.resolveSync("test-pkg/space", root)).toBe(join(root, "node_modules/test-pkg/lib/with space.js"));
    for (const sub of ["sep-2f", "sep-2F", "sep-5c", "sep-5C", "bad"]) {
      expect(resolveError(`test-pkg/${sub}`, root)).toEqual({ name: "ResolveMessage", code: "ERR_MODULE_NOT_FOUND" });
    }
  });
});

describe("package.json exports targets longer than the maximum path length", () => {
  it.concurrent("reports a resolution error for an oversized string exports target", async () => {
    using dir = tempDir("resolver-exports-long-target", {
      "package.json": JSON.stringify({ name: "host" }),
      "node_modules/test-pkg/package.json": JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
        exports: "./" + Buffer.alloc(8192, "a").toString(),
      }),
      "index.js": `try {\n  require.resolve("test-pkg");\n  console.log("resolved");\n} catch {\n  console.log("caught");\n}\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, exitCode }).toEqual({ stdout: "caught\n", exitCode: 0 });
  });

  it.concurrent(
    "reports a resolution error when a wildcard exports target expands past the maximum path length",
    async () => {
      using dir = tempDir("resolver-exports-long-wildcard-target", {
        "package.json": JSON.stringify({ name: "host" }),
        "node_modules/test-pkg/package.json": JSON.stringify({
          name: "test-pkg",
          version: "1.0.0",
          exports: { "./*": "./" + Buffer.alloc(8192, "a").toString() + "/*" },
        }),
        "index.js": `try {\n  require.resolve("test-pkg/sub");\n  console.log("resolved");\n} catch {\n  console.log("caught");\n}\n`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stdout, exitCode }).toEqual({ stdout: "caught\n", exitCode: 0 });
    },
  );

  // These two targets pass the coarse pre-expansion length check (the package URL,
  // target and subpath together are far below the maximum path length) and only
  // exceed it once every "*" is replaced with the matched subpath.
  it.concurrent(
    "reports a resolution error when repeated wildcard substitution expands an exports target past the maximum path length",
    async () => {
      using dir = tempDir("resolver-exports-multi-wildcard-target", {
        "package.json": JSON.stringify({ name: "host" }),
        "node_modules/test-pkg/package.json": JSON.stringify({
          name: "test-pkg",
          version: "1.0.0",
          exports: { "./*": "./" + "*/".repeat(100) + "x" },
        }),
        "index.js": `const sub = Buffer.alloc(300, "s").toString();\ntry {\n  require.resolve("test-pkg/" + sub);\n  console.log("resolved");\n} catch (e) {\n  console.log("caught", e.code);\n}\n`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stdout, exitCode }).toEqual({ stdout: "caught MODULE_NOT_FOUND\n", exitCode: 0 });
    },
  );

  it.concurrent(
    "reports a resolution error when repeated wildcard substitution expands an imports target past the maximum path length",
    async () => {
      using dir = tempDir("resolver-imports-multi-wildcard-target", {
        "package.json": JSON.stringify({ name: "host" }),
        "node_modules/imports-pkg/package.json": JSON.stringify({
          name: "imports-pkg",
          version: "1.0.0",
          imports: { "#deep/*": "./" + "*/".repeat(100) + "x" },
        }),
        "node_modules/imports-pkg/inner.js": `const sub = Buffer.alloc(300, "s").toString();\ntry {\n  require.resolve("#deep/" + sub);\n  console.log("resolved");\n} catch (e) {\n  console.log("caught", e.code);\n}\n`,
        "index.js": `require("imports-pkg/inner.js");\n`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "index.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stdout, exitCode }).toEqual({ stdout: "caught MODULE_NOT_FOUND\n", exitCode: 0 });
    },
  );
});

// A package.json `imports` entry whose value is a bare package specifier
// (e.g. `"#res": "@myproject/resolver"`) is handed back to package-resolve
// for a second pass. Per the Node.js packages spec these are URL-like
// specifiers and must always use forward slashes. On Windows, the join that
// feeds the second pass was going through `platform::Auto` which normalizes
// `/` to `\`, turning `@myproject/resolver` into `@myproject\resolver` —
// the scoped-package match fails and Bun falls back to the legacy `main`
// field instead of `exports`. Linux/macOS aren't affected because `Auto`
// is already `Posix` there; this test is therefore Windows-only.
// https://github.com/oven-sh/bun/issues/30839
describe.if(isWindows)("#30839 - imports entry pointing at a scoped package", () => {
  it("resolves via the target's exports, not its main", async () => {
    using dir = tempDir("resolver-imports-scoped-pkg", {
      "package.json": JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
      "packages/resolver/package.json": JSON.stringify({
        name: "@myproject/resolver",
        type: "module",
        main: "./index.cjs",
        exports: { ".": "./index.mjs" },
      }),
      "packages/resolver/index.mjs": "export const type = 'esm (from exports)';",
      "packages/resolver/index.cjs": "module.exports = { type: 'cjs (from main)' };",
      "packages/app/package.json": JSON.stringify({
        name: "app",
        type: "module",
        dependencies: { "@myproject/resolver": "workspace:*" },
        imports: { "#res": "@myproject/resolver" },
      }),
      "packages/app/test.mjs": `import { type } from "#res";\nconsole.log(type);`,
    });
    const root = String(dir);

    // Wire up @myproject/resolver into app/node_modules so the second pass
    // through the resolver (the one this fix repairs) can find it — without
    // invoking `bun install`. `"junction"` is the Windows-appropriate symlink
    // kind for directories.
    mkdirSync(join(root, "packages/app/node_modules/@myproject"), { recursive: true });
    symlinkSync(
      join(root, "packages/resolver"),
      join(root, "packages/app/node_modules/@myproject/resolver"),
      "junction",
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs"],
      env: bunEnv,
      cwd: join(root, "packages/app"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("esm (from exports)\n");
    expect(exitCode).toBe(0);
  });
});

// dirInfoCachedMaybeLog reads the rfs.entries cache without checking the union
// tag. If readDirectory() previously failed with a non-ENOENT error (e.g.
// EACCES), a `.err` variant is stored there; re-resolving the directory after
// the error condition clears would then reinterpret the two `anyerror` values
// as a *DirEntry pointer and dereference it.
{
  // Root bypasses DAC, so chmod 0 won't yield EACCES. When running as root on
  // Linux we drop to `nobody` via runuser (and chown the temp dir so the
  // fixture can chmod it back). Otherwise we run the fixture directly.
  const isRoot = !isWindows && process.getuid?.() === 0;
  const nobody = (() => {
    try {
      // /etc/passwd format: name:x:uid:gid:gecos:home:shell
      const line = readFileSync("/etc/passwd", "utf8")
        .split("\n")
        .find(l => l.startsWith("nobody:"));
      if (!line) return null;
      const [, , uid, gid] = line.split(":");
      if (!Number.isInteger(+uid) || !Number.isInteger(+gid)) return null;
      return { uid: +uid, gid: +gid };
    } catch {
      return null;
    }
  })();
  const canUseRunuser = isLinux && isRoot && !!Bun.which("runuser") && nobody !== null;
  const canTriggerEACCES = !isWindows && (!isRoot || canUseRunuser);

  it.skipIf(!canTriggerEACCES)("resolving a directory whose entries cache holds .err does not crash", async () => {
    const fixture = `
      const { chmodSync } = require("fs");
      const { join } = require("path");
      const root = process.argv[2];
      const bad = join(root, "bad");

      // 1) Make "bad" unreadable. loadAsFile -> readDirectory(bad) fails with
      //    EACCES, which stores EntriesOption{ .err = ... } in rfs.entries.
      chmodSync(bad, 0o000);
      let threw = false;
      try { Bun.resolveSync("./bad/index.js", root); } catch { threw = true; }

      // 2) Restore permissions so the dir is openable again.
      chmodSync(bad, 0o755);

      // 3) Resolve "bad" as a directory. dirInfoCachedMaybeLog now opens it
      //    successfully, finds the cached .err, and must not read
      //    cached_entry.entries.generation on the inactive union field.
      const resolved = Bun.resolveSync("./bad", root);

      if (!threw) throw new Error("expected EACCES resolving ./bad/index.js");
      if (!resolved.endsWith(join("bad", "index.js")))
        throw new Error("expected ./bad to resolve to bad/index.js, got: " + resolved);
      console.log("OK");
    `;

    using dir = tempDir("resolver-cached-err", {
      "fixture.js": fixture,
      "bad/index.js": "module.exports = 1;\n",
    });
    const root = String(dir);

    let cmd: string[];
    if (canUseRunuser) {
      // Give `nobody` ownership so the fixture's chmodSync calls succeed, and
      // open up perms so `nobody` can traverse/read everything it needs.
      for (const p of [root, join(root, "fixture.js"), join(root, "bad"), join(root, "bad", "index.js")]) {
        chmodSync(p, 0o777);
        chownSync(p, nobody!.uid, nobody!.gid);
      }
      cmd = ["runuser", "-u", "nobody", "--", bunExe(), join(root, "fixture.js"), root];
    } else {
      cmd = [bunExe(), join(root, "fixture.js"), root];
    }

    try {
      await using proc = Bun.spawn({
        cmd,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout).toBe("OK\n");
      expect(exitCode).toBe(0);
    } finally {
      // Ensure tempDir cleanup can remove the directory even if the fixture
      // crashed between the two chmod calls.
      try {
        chmodSync(join(root, "bad"), 0o755);
      } catch {}
    }
  });

  // The runtime auto-installer's one-time init reads the top-level directory
  // (the cwd). When that read fails — cwd on a dead network drive, permissions
  // revoked, directory deleted — the whole process used to die with
  // "panic: Failed to initialize package manager" instead of surfacing a
  // resolution error the caller can catch.
  //
  // The cwd must be unlistable from process start (the startup dir walk
  // otherwise caches its entries, and the cached listing satisfies the
  // package-manager init even if the directory disappears later), and the
  // script must live in a readable directory so the resolver reaches the
  // auto-install path at all.
  it.skipIf(!canTriggerEACCES)("auto-install init failure from an unreadable cwd is a catchable error", async () => {
    using dir = tempDir("autoinstall-unreadable-cwd", {
      // Dynamic specifier so the transpiler can't resolve it at build time;
      // the resolve must happen at runtime, through the auto-install path.
      "app/main.js": `
        console.log("start");
        const spec = ["left", "pad"].join("-");
        try {
          const r = import.meta.resolveSync(spec);
          console.log("resolved:", r);
        } catch (e) {
          console.log("caught:", String(e && e.message));
        }
        console.log("end");
      `,
      "work/.keep": "",
    });
    const root = String(dir);
    const work = join(root, "work");

    let cmd: string[];
    if (canUseRunuser) {
      // Let `nobody` traverse and read everything except the cwd.
      for (const p of [root, join(root, "app"), join(root, "app", "main.js")]) {
        chmodSync(p, 0o777);
      }
      cmd = ["runuser", "-u", "nobody", "--", bunExe(), join(root, "app", "main.js")];
    } else {
      cmd = [bunExe(), join(root, "app", "main.js")];
    }
    // Execute-only: the spawn can chdir into it, but listing it fails.
    chmodSync(work, 0o111);

    try {
      await using proc = Bun.spawn({
        cmd,
        env: bunEnv,
        cwd: work,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: expect.stringMatching(
          /^start\ncaught: Cannot read directory "[^"]+": E[A-Z]+ while resolving "left-pad"\nend\n$/,
        ),
        stderr: "",
        exitCode: 0,
      });
    } finally {
      // Ensure tempDir cleanup can delete work/.keep.
      try {
        chmodSync(work, 0o755);
      } catch {}
    }
  });
}

describe("resolving external URL specifiers with non-ASCII characters", () => {
  // The resolver returns http://, https://, and // specifiers as-is (marked external).
  // When the specifier contains non-ASCII characters, the intermediate UTF-8 buffer
  // is heap-allocated and freed before the caller reads the result, so the resolved
  // path must be cloned rather than borrowed.
  it.each([
    ["http://localhost/path?query=´5&foo=bar"],
    ["http://localhost/´path?query=a"],
    ["http://localhost/´path"],
    ["https://example/´"],
    ["//example/´?q"],
  ])("Bun.resolveSync(%j)", specifier => {
    expect(Bun.resolveSync(specifier, import.meta.dir)).toBe(specifier);
  });

  it("import.meta.resolveSync", () => {
    const specifier = "http://localhost/path?query=´5&foo=bar";
    expect(import.meta.resolveSync(specifier)).toBe(specifier);
  });

  it("require with non-ASCII http specifier does not crash", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `try { require("http://localhost/path?query=´5&foo=bar"); } catch (e) { console.log("caught", e.constructor.name); }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain("caught");
    expect(exitCode).toBe(0);
  });
});

// Stress the resolver's directory-info cache: resolve through hundreds of
// distinct package directories (each `put` hands back a slot pointer into the
// shared dir-cache that must stay valid while the cache keeps growing) plus a
// deep directory chain (the cache-miss walk stashes a parent slot pointer
// across subsequent cache insertions). A stale/corrupted slot pointer shows up
// as wrong resolution results or a crash, not a clean error.
it("resolves through many directories without corrupting the dir cache", async () => {
  const files: Record<string, string> = {};
  const N = 200;
  let imports = "";
  for (let i = 0; i < N; i++) {
    files[`node_modules/pkg-${i}/package.json`] = JSON.stringify({
      name: `pkg-${i}`,
      main: "./lib/index.js",
    });
    files[`node_modules/pkg-${i}/lib/index.js`] = `module.exports = ${i};`;
    imports += `total += require("pkg-${i}");\n`;
  }

  // Deep chain: resolving the leaf populates one cache entry per path
  // component in a single cache-miss walk, and requiring packages *from* the
  // leaf walks every parent directory back up through the now-cached entries.
  // Depth 30 keeps the absolute path well under Windows' 260-char MAX_PATH
  // even with a long CI temp-dir prefix; the cache-miss walk is exercised the
  // same at this depth.
  let deep = "deep";
  for (let d = 0; d < 30; d++) deep += `/d${d}`;
  files[`${deep}/leaf.js`] = `module.exports = require("pkg-3") + require("pkg-77");`;
  files["index.js"] = `let total = 0;\n${imports}console.log(total);\nconsole.log(require("./${deep}/leaf.js"));`;

  const dir = tempDirWithFiles("dir-cache-stress", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(`${(N * (N - 1)) / 2}\n${3 + 77}\n`);
  expect(exitCode).toBe(0);
});
