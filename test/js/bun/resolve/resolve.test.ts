import { pathToFileURL } from "bun";
import { afterAll, beforeAll, describe, expect, it, test } from "bun:test";
import {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import {
  bunEnv,
  bunExe,
  bunRun,
  isASAN,
  isDebug,
  isLinux,
  isMacOS,
  isMusl,
  isRoot,
  isWindows,
  joinP,
  tempDir,
  tempDirWithFiles,
  withoutAsanQuarantine,
} from "harness";
import { constants } from "os";
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
  await using dir = tempDir("fileurl", {
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
  await using dir = tempDir("fileurl", {});
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
  await using dir = tempDir("fileurl", {
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
  await using dir = tempDir("file url", {
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
  await using dir = tempDir("file url", {
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
  await using dir = tempDir("file url", {
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
  await using dir = tempDir("file url", {
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
  await using dir = tempDir("fileurl", {
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
  await using dir = tempDir("file url", {
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
  await using dir = tempDir("fileurl", {
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
  await using dir = tempDir("file url", {
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

it.skipIf(isWindows)("resolves an absolute specifier that is longer than a path buffer until it is normalized", () => {
  using dir = tempDir("resolve-long-specifier", { "index.js": "" });
  expect(Bun.resolveSync(`${dir}${Buffer.alloc(5000, "/").toString()}index.js`, String(dir))).toBe(
    join(String(dir), "index.js"),
  );
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

// The failed resolution busts the directory cache for the dirname, which for `C:\\\x` is `C:\\`.
it.if(isWindows)("import() of a missing file at the drive root rejects", async () => {
  const drive = process.cwd().slice(0, 2);
  for (const separators of [2, 3, 4]) {
    await expect(import(drive + "\\".repeat(separators) + "doesnotexist.ts")).rejects.toThrow();
  }
  await expect(import(`${drive}///doesnotexist.ts`)).rejects.toThrow();
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

it("can resolve with source directories that do not exist", () => {
  // In Nuxt/Vite, the following call happens:
  // `require("module").createRequire("file:///Users/clo/my-nuxt-app/@vue/server-renderer")("vue")`
  // This seems to be a bug in their code, not using a concrete file path for
  // this virtual module, such as 'node_modules/@vue/server-renderer/index.js',
  // but the same exact resolution happens and succeeds in Node.js
  using dir = tempDir("resolve", {
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
    expect(await bunRun(fixturePath)).toSpawn();
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

// Parsing a package.json normalized every key of the "browser" map into a fixed
// 1024-byte threadlocal buffer without a bounds check, so a longer key aborted
// the process (`panic: range end index 1103 out of range for slice of length
// 1024`) as soon as the package.json was read, whatever the target.
describe.concurrent("browser map with a key longer than 1024 bytes", () => {
  const longKey = Buffer.alloc(1100, "k").toString();

  it("does not crash reading the package.json of a dependency at runtime", async () => {
    using dir = tempDir("resolver-browser-long-key-runtime", {
      "node_modules/dep/package.json": JSON.stringify({
        name: "dep",
        main: "index.js",
        browser: { [`./${longKey}.js`]: "./browser.js" },
      }),
      "node_modules/dep/index.js": "module.exports = 1;",
      "index.js": `console.log(require("dep"));`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("1\n");
    expect(exitCode).toBe(0);
  });

  it("still applies the other entries of the map to a browser build", async () => {
    using dir = tempDir("resolver-browser-long-key-build", {
      "package.json": JSON.stringify({
        name: "pkg",
        browser: {
          [`./${longKey}.js`]: "./unused.js",
          "./node-only.js": "./browser-only.js",
        },
      }),
      "entry.js": `import { x } from "./node-only.js"; console.log(x);`,
      "node-only.js": `export const x = "node-only";`,
      "browser-only.js": `export const x = "browser-only";`,
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
    expect(stdout).toContain('"browser-only"');
    expect(stdout).not.toContain('"node-only"');
    expect(exitCode).toBe(0);
  });

  // Looking a specifier up in the map goes through a PATH_MAX-sized buffer,
  // which on macOS is itself 1024 bytes, so a key this long can only ever be
  // matched on Linux and Windows.
  it.skipIf(isMacOS)("remaps a package path that long in a browser build", async () => {
    using dir = tempDir("resolver-browser-long-key-remap", {
      "package.json": JSON.stringify({
        name: "pkg",
        browser: { [longKey]: "./shim.js" },
      }),
      "entry.js": `import { x } from ${JSON.stringify(longKey)}; console.log(x);`,
      "shim.js": `export const x = "remapped";`,
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
    expect(stdout).toContain('"remapped"');
    expect(exitCode).toBe(0);
  });
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

describe("package.json sideEffects entries longer than the maximum path length", () => {
  // Parsing a package.json joins every "sideEffects" entry onto the package directory.
  const longSegment = Buffer.alloc(100_000, "s").toString();

  it.concurrent.each([
    ["exact", [`./${longSegment}.js`]],
    ["glob", [`./${longSegment}/*.js`]],
    ["mixed", ["./index.js", `./${longSegment}.js`, `./${longSegment}/*.js`]],
  ])("requires a package whose sideEffects array has an oversized %s entry", async (_kind, sideEffects) => {
    using dir = tempDir("resolver-side-effects-long-entry", {
      "node_modules/long-side-effects/package.json": JSON.stringify({
        name: "long-side-effects",
        main: "index.js",
        sideEffects,
      }),
      "node_modules/long-side-effects/index.js": "module.exports = 3;\n",
      "index.js": `console.log(require("long-side-effects"));\n`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "3\n", stderr: "", exitCode: 0 });
  });
});

// The resolver uses more stack per nesting level of an `exports` target than the JSON parser does.
describe("package.json exports targets nested too deeply", () => {
  const targets = {
    array: Buffer.alloc(40000, "[").toString() + '"./t.js"' + Buffer.alloc(40000, "]").toString(),
    conditions:
      Array.from({ length: 30000 }, (_, i) => (i % 2 ? '{"node":' : '{"default":')).join("") +
      '"./t.js"' +
      Buffer.alloc(30000, "}").toString(),
  };

  it.concurrent.each(Object.entries(targets))("nested %s doesn't overflow the stack", async (shape, target) => {
    using dir = tempDir(`resolver-exports-deep-${shape}`, {
      "package.json": JSON.stringify({ name: "host" }),
      "node_modules/test-pkg/package.json": `{"name":"test-pkg","exports":{".":${target}}}`,
      "node_modules/test-pkg/t.js": "module.exports = 1;\n",
      "index.js": `
        try {
          require.resolve("test-pkg");
          console.log("resolved");
        } catch (e) {
          console.log("caught " + e.code);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The target resolves if the stack is large enough.
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: expect.stringMatching(/^(caught MODULE_NOT_FOUND|resolved)\n$/),
      stderr: "",
      exitCode: 0,
    });
  });
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

// A symlink in node_modules whose target no longer exists (for example an
// optional dependency that was removed after its install script failed) is
// not a module. Like Node, the resolver treats it as if the entry did not
// exist and keeps looking, instead of resolving to it and failing to read it.
describe("dangling symlinks in node_modules", () => {
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
      return "resolved";
    } catch (e: any) {
      return { name: e.name, code: e.code };
    }
  };

  it.concurrent("are reported as a missing module", async () => {
    using dir = tempDir("resolver-dangling-node-modules-link", {
      "package.json": JSON.stringify({ name: "host" }),
      "node_modules/.keep": "",
      "index.js": `
        const codes = { require: null, import: null, resolve: null };
        try {
          require("dangling-pkg");
        } catch (e) {
          codes.require = e.code;
        }
        try {
          require.resolve("dangling-pkg");
        } catch (e) {
          codes.resolve = e.code;
        }
        try {
          await import("dangling-pkg");
        } catch (e) {
          codes.import = e.code;
        }
        console.log(JSON.stringify(codes));
      `,
    });
    const root = String(dir);
    symlinkSync(join("..", "does-not-exist"), join(root, "node_modules", "dangling-pkg"));

    expect(codeOf(() => Bun.resolveSync("dangling-pkg", root))).toEqual({
      name: "ResolveMessage",
      code: "ERR_MODULE_NOT_FOUND",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      require: "MODULE_NOT_FOUND",
      resolve: "MODULE_NOT_FOUND",
      import: "ERR_MODULE_NOT_FOUND",
    });
    expect(exitCode).toBe(0);
  });

  it.concurrent("are reported as a missing module when a package.json exports target points at one", async () => {
    using dir = tempDir("resolver-dangling-exports-target", {
      "package.json": JSON.stringify({ name: "host" }),
      "node_modules/exports-pkg/package.json": JSON.stringify({
        name: "exports-pkg",
        version: "1.0.0",
        exports: { ".": "./index.js", "./sub": "./sub.js" },
      }),
      "node_modules/exports-pkg/sub.js": `module.exports = "sub";`,
      "index.js": `
        try {
          require("exports-pkg");
        } catch (e) {
          console.log(e.code);
        }
        console.log(require("exports-pkg/sub"));
      `,
    });
    const root = String(dir);
    symlinkSync("removed.js", join(root, "node_modules", "exports-pkg", "index.js"));

    expect(codeOf(() => Bun.resolveSync("exports-pkg", root))).toEqual({
      name: "ResolveMessage",
      code: "ERR_MODULE_NOT_FOUND",
    });
    expect(Bun.resolveSync("exports-pkg/sub", root)).toBe(join(root, "node_modules", "exports-pkg", "sub.js"));

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("MODULE_NOT_FOUND\nsub\n");
    expect(exitCode).toBe(0);
  });

  it.concurrent("do not shadow the same package in a parent node_modules", async () => {
    using dir = tempDir("resolver-dangling-node-modules-link-shadow", {
      "package.json": JSON.stringify({ name: "host" }),
      "node_modules/shadowed-pkg/package.json": JSON.stringify({ name: "shadowed-pkg", version: "1.0.0" }),
      "node_modules/shadowed-pkg/index.js": `module.exports = "from the parent node_modules";`,
      "app/node_modules/.keep": "",
      "app/index.js": `console.log(require("shadowed-pkg"));`,
    });
    const root = String(dir);
    symlinkSync(join("..", "..", "removed-pkg"), join(root, "app", "node_modules", "shadowed-pkg"));

    expect(Bun.resolveSync("shadowed-pkg", join(root, "app"))).toBe(
      join(root, "node_modules", "shadowed-pkg", "index.js"),
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: join(root, "app"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("from the parent node_modules\n");
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

  await using dir = tempDir("dir-cache-stress", files);
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
}, 20_000);

// ASAN builds print a warning on stderr that has nothing to do with resolution.
function stripAsanWarning(stderr: string): string {
  return stderr
    .split("\n")
    .filter(l => l.length > 0 && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
}

async function runWildcardScript(dir: string, entry: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: stripAsanWarning(stderr), exitCode };
}

// https://github.com/oven-sh/bun/issues/29679
// Packages like @modelcontextprotocol/sdk ship a wildcard `exports` entry
// whose target has no extension, e.g. `"./*": { "import": "./dist/esm/*" }`.
// Node.js requires the caller to write `pkg/foo.js` (with the extension).
// Bun probes configured extensions so `pkg/foo` resolves to `./dist/esm/foo.js`.
describe("wildcard exports with extensionless target", () => {
  function makeFixture(extra: Record<string, string> = {}) {
    return tempDir("wildcard-exports", {
      "node_modules/wildcard-pkg/package.json": JSON.stringify({
        name: "wildcard-pkg",
        type: "module",
        exports: {
          ".": "./dist/esm/index.js",
          "./exact": "./dist/esm/exact/index.js",
          "./*": {
            types: "./dist/esm/*.d.ts",
            import: "./dist/esm/*",
            require: "./dist/cjs/*",
          },
        },
      }),
      "node_modules/wildcard-pkg/dist/esm/index.js": "export const root = 'root';",
      "node_modules/wildcard-pkg/dist/esm/exact/index.js": "export const exact = 'exact';",
      "node_modules/wildcard-pkg/dist/esm/server/stdio.js": "export const stdio = 'stdio';",
      "node_modules/wildcard-pkg/dist/esm/server/http.mjs": "export const http = 'http';",
      "node_modules/wildcard-pkg/dist/cjs/server/stdio.js": "module.exports = { stdio: 'cjs-stdio' };",
      ...extra,
    });
  }

  test.concurrent("resolves import without extension to `.js`", async () => {
    using dir = makeFixture({
      "index.ts": `
        import { stdio } from "wildcard-pkg/server/stdio";
        console.log(stdio);
      `,
    });

    expect(await runWildcardScript(String(dir), "index.ts")).toEqual({
      stdout: "stdio",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("resolves import without extension to `.mjs`", async () => {
    using dir = makeFixture({
      "index.ts": `
        import { http } from "wildcard-pkg/server/http";
        console.log(http);
      `,
    });

    expect(await runWildcardScript(String(dir), "index.ts")).toEqual({
      stdout: "http",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("explicit `.js` extension still works", async () => {
    using dir = makeFixture({
      "index.ts": `
        import { stdio } from "wildcard-pkg/server/stdio.js";
        console.log(stdio);
      `,
    });

    expect(await runWildcardScript(String(dir), "index.ts")).toEqual({
      stdout: "stdio",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("exact-key exports are not affected", async () => {
    using dir = makeFixture({
      "index.ts": `
        import { exact } from "wildcard-pkg/exact";
        console.log(exact);
      `,
    });

    expect(await runWildcardScript(String(dir), "index.ts")).toEqual({
      stdout: "exact",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("truly missing subpath still errors", async () => {
    using dir = makeFixture({
      "index.ts": `
        import { nope } from "wildcard-pkg/server/does-not-exist";
        console.log(nope);
      `,
    });

    const result = await runWildcardScript(String(dir), "index.ts");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Cannot find module");
  });

  test.concurrent("CJS require of extensionless wildcard target also resolves", async () => {
    using dir = makeFixture({
      "index.cjs": `
        const { stdio } = require("wildcard-pkg/server/stdio");
        console.log(stdio);
      `,
    });

    expect(await runWildcardScript(String(dir), "index.cjs")).toEqual({
      stdout: "cjs-stdio",
      stderr: "",
      exitCode: 0,
    });
  });

  // Regression guard: when the wildcard target already has an extension
  // like `"./*": "./dist/*.js"`, a missing `foo.js` must not silently
  // double-append to `foo.js.ts` / `foo.js.mjs` / etc. — the literal
  // `.js`→`.ts` TypeScript rewrite is the only fallback that should run.
  test.concurrent("explicit-extension wildcard target does not double-probe extensions", async () => {
    using dir = tempDir("wildcard-explicit-ext", {
      "node_modules/explicit-pkg/package.json": JSON.stringify({
        name: "explicit-pkg",
        type: "module",
        exports: { "./*": "./dist/*.js" },
      }),
      // A sibling that a naive extension probe would grab.
      "node_modules/explicit-pkg/dist/missing.js.mjs": "export const oops = 'nope';",
      "index.ts": `
        import { oops } from "explicit-pkg/missing";
        console.log(oops);
      `,
    });

    const result = await runWildcardScript(String(dir), "index.ts");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Cannot find module");
  });

  test.concurrent("resolves sibling `.js` when a same-named directory exists", async () => {
    using dir = tempDir("wildcard-dir-sibling", {
      "node_modules/dir-pkg/package.json": JSON.stringify({
        name: "dir-pkg",
        type: "module",
        exports: { "./*": "./dist/*" },
      }),
      "node_modules/dir-pkg/dist/utils/helper.js": "export const helper = 'helper';",
      "node_modules/dir-pkg/dist/utils.js": "export const utils = 'utils';",
      "index.ts": `
        import { utils } from "dir-pkg/utils";
        console.log(utils);
      `,
    });

    expect(await runWildcardScript(String(dir), "index.ts")).toEqual({
      stdout: "utils",
      stderr: "",
      exitCode: 0,
    });
  });

  // https://github.com/oven-sh/bun/issues/6285
  // typeorm ships `"./*.js": "./*.js"` ahead of `"./*": {"require": "./*.js",
  // "import": "./*"}`. The ESM `import` condition maps `pkg/util/Foo` to
  // `./util/Foo` with no extension, which must be probed to `.js` so
  // `import "typeorm/util/StringUtils"` works the same as the CJS `require`.
  test.concurrent("resolves typeorm-style `./*` with identity `import` target", async () => {
    using dir = tempDir("wildcard-typeorm", {
      "node_modules/typeorm-like/package.json": JSON.stringify({
        name: "typeorm-like",
        main: "./index.js",
        exports: {
          ".": "./index.js",
          "./*.js": "./*.js",
          "./*": { require: "./*.js", import: "./*" },
        },
      }),
      "node_modules/typeorm-like/index.js": "module.exports = {};",
      "node_modules/typeorm-like/util/StringUtils.js":
        "module.exports.camelCase = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());",
      "index.ts": `
        import { camelCase } from "typeorm-like/util/StringUtils";
        console.log(camelCase("correct_output"));
      `,
    });

    expect(await runWildcardScript(String(dir), "index.ts")).toEqual({
      stdout: "correctOutput",
      stderr: "",
      exitCode: 0,
    });
  });
});

// https://github.com/oven-sh/bun/issues/10001
// `imports`/`exports` that point at a `.js` target should also pick up
// `.ts`/`.tsx`/`.mts` the same way Bun already does for plain file loads
// (e.g. `import './foo.js'` finds `./foo.ts`). Wildcard and exact targets
// alike, as in esbuild. A target that exists on disk is never rewritten.
describe("wildcard imports/exports with `.js` → `.ts` rewrite", () => {
  test.concurrent("package.json `imports` wildcard with `.js` target resolves `.ts` file", async () => {
    using dir = tempDir("wildcard-imports-ts", {
      "package.json": JSON.stringify({
        name: "imports-ts",
        type: "module",
        imports: {
          "#app/*": "./app/*.js",
        },
      }),
      "app/main.ts": `export const foo = "ts file";`,
      "index.ts": `
        import { foo } from "#app/main";
        console.log(foo);
      `,
    });

    expect(await runWildcardScript(String(dir), "index.ts")).toEqual({
      stdout: "ts file",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("`.mjs` target resolves `.mts` file", async () => {
    using dir = tempDir("wildcard-mjs-mts", {
      "package.json": JSON.stringify({
        name: "mjs-pkg",
        type: "module",
        imports: {
          "#src/*": "./src/*.mjs",
        },
      }),
      "src/thing.mts": `export const thing = "mts file";`,
      "index.ts": `
        import { thing } from "#src/thing";
        console.log(thing);
      `,
    });

    expect(await runWildcardScript(String(dir), "index.ts")).toEqual({
      stdout: "mts file",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("`.jsx` target resolves `.tsx` file", async () => {
    using dir = tempDir("wildcard-jsx-tsx", {
      "package.json": JSON.stringify({
        name: "jsx-pkg",
        type: "module",
        imports: {
          "#components/*": "./components/*.jsx",
        },
      }),
      "components/Button.tsx": `export const Button = "tsx file";`,
      "index.ts": `
        import { Button } from "#components/Button";
        console.log(Button);
      `,
    });

    expect(await runWildcardScript(String(dir), "index.ts")).toEqual({
      stdout: "tsx file",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("self-referencing `exports` wildcard with `.js` target resolves `.ts` file", async () => {
    using dir = tempDir("wildcard-exports-self-ts", {
      "package.json": JSON.stringify({
        name: "self-pkg",
        type: "module",
        exports: {
          "./*": "./src/*.js",
        },
      }),
      "src/feature.ts": `export const feature = "ts feature";`,
      "index.ts": `
        import { feature } from "self-pkg/feature";
        console.log(feature);
      `,
    });

    expect(await runWildcardScript(String(dir), "index.ts")).toEqual({
      stdout: "ts feature",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("actual `.js` file takes precedence over `.ts`", async () => {
    using dir = tempDir("wildcard-js-wins", {
      "package.json": JSON.stringify({
        name: "js-wins",
        type: "module",
        imports: {
          "#app/*": "./app/*.js",
        },
      }),
      "app/main.js": `export const src = "js file";`,
      "app/main.ts": `export const src = "ts file";`,
      "index.ts": `
        import { src } from "#app/main";
        console.log(src);
      `,
    });

    expect(await runWildcardScript(String(dir), "index.ts")).toEqual({
      stdout: "js file",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("exact (non-wildcard) `.js` target is rewritten to `.ts` too", async () => {
    using dir = tempDir("exact-rewrite", {
      "package.json": JSON.stringify({
        name: "exact-pkg",
        type: "module",
        imports: { "#feature": "./src/feature.js" },
      }),
      "src/feature.ts": `export const feature = "ts feature";`,
      "index.ts": `
        import { feature } from "#feature";
        console.log(feature);
      `,
    });

    expect(await runWildcardScript(String(dir), "index.ts")).toEqual({
      stdout: "ts feature",
      stderr: "",
      exitCode: 0,
    });
  });
});

// The TypeScript extension rewrite (`import "./x.js"` finds `x.ts`) uses the
// same table as esbuild's `rewrittenFileExtensions`, plus Bun's `.js` → `.mts`.
// It applies to relative imports and to every `exports`/`imports` target,
// exact or wildcard.
const tsExtensionRewrites: [from: string, to: string][] = [
  ["js", "ts"],
  ["js", "tsx"],
  ["jsx", "ts"],
  ["jsx", "tsx"],
  ["mjs", "mts"],
  ["cjs", "cts"],
  // Bun-specific (oven-sh/bun#12580). esbuild and tsc only try `.ts`/`.tsx` here.
  ["js", "mts"],
];

describe("TypeScript extension rewrite matrix", () => {
  test.concurrent.each(tsExtensionRewrites)("`.%s` specifier resolves a `.%s` file everywhere", async (from, to) => {
    using dir = tempDir(`ts-rewrite-${from}-${to}`, {
      "package.json": JSON.stringify({
        name: "rewrite-pkg",
        type: "module",
        exports: {
          "./exact": `./src/exports-exact.${from}`,
          "./wild/*": `./src/exports-wild/*.${from}`,
        },
        imports: {
          "#exact": `./src/imports-exact.${from}`,
          "#wild/*": `./src/imports-wild/*.${from}`,
        },
      }),
      [`src/relative.${to}`]: `export const relative = "relative.${to}";`,
      [`src/exports-exact.${to}`]: `export const exportsExact = "exports-exact.${to}";`,
      [`src/exports-wild/a.${to}`]: `export const exportsWild = "exports-wild.${to}";`,
      [`src/imports-exact.${to}`]: `export const importsExact = "imports-exact.${to}";`,
      [`src/imports-wild/a.${to}`]: `export const importsWild = "imports-wild.${to}";`,
      "src/entry.ts": `
        import { relative } from "./relative.${from}";
        import { exportsExact } from "rewrite-pkg/exact";
        import { exportsWild } from "rewrite-pkg/wild/a";
        import { importsExact } from "#exact";
        import { importsWild } from "#wild/a";
        console.log(JSON.stringify({ relative, exportsExact, exportsWild, importsExact, importsWild }));
      `,
    });

    expect(await runWildcardScript(String(dir), "src/entry.ts")).toEqual({
      stdout: JSON.stringify({
        relative: `relative.${to}`,
        exportsExact: `exports-exact.${to}`,
        exportsWild: `exports-wild.${to}`,
        importsExact: `imports-exact.${to}`,
        importsWild: `imports-wild.${to}`,
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent.each([
    ["cjs", ["ts", "tsx", "mts"]],
    ["mjs", ["ts", "tsx", "cts"]],
    ["js", ["cts"]],
  ] as [from: string, present: string[]][])("`.%s` specifier does not pick up %j files", async (from, present) => {
    using dir = tempDir(`ts-rewrite-negative-${from}`, {
      ...Object.fromEntries(present.map(ext => [`lib.${ext}`, `export const lib = "${ext}";`])),
      "entry.ts": `
          import { lib } from "./lib.${from}";
          console.log(lib);
        `,
    });

    const result = await runWildcardScript(String(dir), "entry.ts");
    expect(result.stderr).toContain(`Cannot find module './lib.${from}'`);
    expect(result.exitCode).not.toBe(0);
  });

  test.concurrent("an exact target that exists on disk is never rewritten", async () => {
    using dir = tempDir("ts-rewrite-exact-js-wins", {
      "package.json": JSON.stringify({
        name: "exact-js-wins",
        type: "module",
        exports: { "./feature": "./src/feature.js" },
        imports: { "#feature": "./src/feature.js" },
      }),
      "src/feature.js": `export const feature = "js file";`,
      "src/feature.ts": `export const feature = "ts file";`,
      "index.ts": `
        import { feature } from "exact-js-wins/feature";
        import { feature as feature2 } from "#feature";
        console.log(feature, feature2);
      `,
    });

    expect(await runWildcardScript(String(dir), "index.ts")).toEqual({
      stdout: "js file js file",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("an exact target with no extension is not probed", async () => {
    using dir = tempDir("ts-rewrite-exact-extensionless", {
      "package.json": JSON.stringify({
        name: "exact-extensionless",
        type: "module",
        imports: { "#feature": "./src/feature" },
      }),
      "src/feature.ts": `export const feature = "ts file";`,
      "index.ts": `
        import { feature } from "#feature";
        console.log(feature);
      `,
    });

    const result = await runWildcardScript(String(dir), "index.ts");
    expect(result.stderr).toContain("Cannot find");
    expect(result.exitCode).not.toBe(0);
  });

  // Inside node_modules the `.mjs` → `.mts` and `.cjs` → `.cts` rewrites are
  // off (`DISABLE_AUTO_JS_TO_TS_IN_NODE_MODULES`); `.js` → `.ts` stays on.
  test.concurrent.each([
    ["dep/c", null],
    ["dep/m", null],
    ["dep/j", "ts"],
  ] as [specifier: string, resolved: string | null][])(
    "`%s` inside node_modules resolves to %j",
    async (specifier, resolved) => {
      using dir = tempDir("ts-rewrite-node-modules-gate", {
        "node_modules/dep/package.json": JSON.stringify({
          name: "dep",
          exports: { "./c": "./c.cjs", "./m": "./m.mjs", "./j": "./j.js" },
        }),
        "node_modules/dep/c.cts": `export const c = "cts";`,
        "node_modules/dep/m.mts": `export const m = "mts";`,
        "node_modules/dep/j.ts": `export const j = "ts";`,
        "index.ts": `
          import * as dep from "${specifier}";
          console.log(Object.values(dep)[0]);
        `,
      });

      const result = await runWildcardScript(String(dir), "index.ts");
      if (resolved === null) {
        expect(result.stderr).toContain(`Cannot find module '${specifier}'`);
        expect(result.exitCode).not.toBe(0);
      } else {
        expect(result).toEqual({ stdout: resolved, stderr: "", exitCode: 0 });
      }
    },
  );
});

// A tsconfig `paths` substitution that names a declaration file (`.d.ts`,
// `.d.mts`, `.d.cts`, any case) is there for type checking only. The resolver
// skips it, like esbuild does for `.d.ts`, and falls through to the next
// substitution or to node_modules.
describe("tsconfig paths skip `.d.ts` substitutions", () => {
  test.concurrent("exact, wildcard, upper-case, `.d.mts` and `.d.cts` entries fall through", async () => {
    using dir = tempDir("tsconfig-paths-dts", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: {
            "foo": ["./types/foo.d.ts"],
            "bar/*": ["./types/*.d.ts"],
            "upper": ["./types/upper.D.TS"],
            "upper-star/*": ["./types/*.D.TS"],
            "fallback": ["./types/fallback.d.ts", "./src/fallback.ts"],
            "esm-types": ["./types/esm-types.d.mts"],
            "cjs-types/*": ["./types/*.d.cts"],
          },
        },
      }),
      "types/foo.d.ts": `export declare const x: number;`,
      "types/lib.d.ts": `export declare const y: number;`,
      "types/upper.D.TS": `export declare const u: number;`,
      "types/up.D.TS": `export declare const v: number;`,
      "types/fallback.d.ts": `export declare const f: string;`,
      "types/esm-types.d.mts": `export declare const m: number;`,
      "types/lib.d.cts": `export declare const c: number;`,
      "src/fallback.ts": `export const f = "fallback.ts";`,
      "node_modules/foo/package.json": JSON.stringify({ name: "foo", type: "module", main: "index.js" }),
      "node_modules/foo/index.js": `export const x = 123;`,
      "node_modules/bar/package.json": JSON.stringify({ name: "bar", type: "module" }),
      "node_modules/bar/lib.js": `export const y = 456;`,
      "node_modules/upper/package.json": JSON.stringify({ name: "upper", type: "module", main: "index.js" }),
      "node_modules/upper/index.js": `export const u = 7;`,
      "node_modules/upper-star/package.json": JSON.stringify({ name: "upper-star", type: "module" }),
      "node_modules/upper-star/up.js": `export const v = 8;`,
      "node_modules/esm-types/package.json": JSON.stringify({ name: "esm-types", main: "index.mjs" }),
      "node_modules/esm-types/index.mjs": `export const m = 9;`,
      "node_modules/cjs-types/package.json": JSON.stringify({ name: "cjs-types" }),
      "node_modules/cjs-types/lib.js": `module.exports.c = 10;`,
      "entry.ts": `
        import { x } from "foo";
        import { y } from "bar/lib";
        import { u } from "upper";
        import { v } from "upper-star/up";
        import { f } from "fallback";
        import { m } from "esm-types";
        import { c } from "cjs-types/lib";
        console.log(x, y, u, v, f, m, c);
      `,
    });

    expect(await runWildcardScript(String(dir), "entry.ts")).toEqual({
      stdout: "123 456 7 8 fallback.ts 9 10",
      stderr: "",
      exitCode: 0,
    });
  });

  // Only the tsconfig text counts. A catch-all alias still resolves a specifier
  // that names a declaration file itself.
  test.concurrent("a `.d.ts` specifier through a catch-all alias still resolves", async () => {
    using dir = tempDir("tsconfig-paths-dts-specifier", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["./src/*"] } },
      }),
      "src/env.d.ts": `declare global { interface Env { FOO: string } }\nexport {};`,
      "entry.ts": `
        import "@/env.d.ts";
        console.log("ok");
      `,
    });

    expect(await runWildcardScript(String(dir), "entry.ts")).toEqual({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("a `.d.ts`-only alias with no real module still reports the original specifier", async () => {
    using dir = tempDir("tsconfig-paths-dts-missing", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "types-only": ["./types/types-only.d.ts"] } },
      }),
      "types/types-only.d.ts": `export declare const z: number;`,
      "entry.ts": `
        import { z } from "types-only";
        console.log(z);
      `,
    });

    const result = await runWildcardScript(String(dir), "entry.ts");
    expect(result.stderr).toContain(`Cannot find package 'types-only'`);
    expect(result.exitCode).not.toBe(0);
  });
});

it.skipIf(isWindows)("runs a script from a working directory nested 256 directories deep", async () => {
  using dir = tempDir("resolver-deep-cwd", { ".keep": "" });
  const base = realpathSync(String(dir));
  const depth = 256 - base.split("/").filter(part => part.length > 0).length;
  let leaf = base;
  for (let d = 0; d < depth; d++) leaf = join(leaf, "d");
  mkdirSync(leaf, { recursive: true });
  writeFileSync(join(leaf, "index.js"), `console.log("deep-cwd-ok");`);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: leaf,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("deep-cwd-ok\n");
  expect(exitCode).toBe(0);
});

it.skipIf(isWindows)("reports a resolution error for an absolute specifier of the maximum path length", async () => {
  using dir = tempDir("resolver-max-length-specifier", {
    "package.json": JSON.stringify({ name: "host" }),
  });
  const maxPathBytes = isMacOS ? 1024 : 4096;
  const prefix = "/no-such-directory/";
  const specifier = prefix + Buffer.alloc(maxPathBytes - prefix.length, "a").toString();
  expect(specifier.length).toBe(maxPathBytes);

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `try { Bun.resolveSync(${JSON.stringify(specifier)}, process.cwd()); console.log("resolved"); } catch (e) { console.log(e.name, e.code); }`,
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("ResolveMessage ERR_MODULE_NOT_FOUND\n");
  expect(exitCode).toBe(0);
});

it.skipIf(isWindows)("does not find a file whose folder fits a path buffer and whose own path does not", async () => {
  using dir = tempDir("resolver-deep-folder", {});
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const fs = require("fs");
      fs.mkdirSync("pages");
      process.chdir("pages");
      const root = process.cwd();
      let folder = root;
      for (let rest = ${isMacOS ? 1024 : 4096} - 4 - root.length; rest > 0; ) {
        const name = Buffer.alloc((rest > 201 ? 100 : rest) - 1, "d").toString();
        fs.mkdirSync(name);
        process.chdir(name);
        folder += "/" + name;
        rest -= name.length + 1;
      }
      fs.writeFileSync("index.js", "");
      for (const load of [
        () => require(folder + "/index.js"),
        () => require(folder),
        () => new Bun.FileSystemRouter({ dir: root, style: "nextjs" }),
      ]) {
        try { load(); console.log("loaded"); } catch (e) { console.log(e.code ?? e.message.slice(0, 27)); }
      }`,
    ],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("MODULE_NOT_FOUND\nMODULE_NOT_FOUND\nENAMETOOLONG opening route:\n");
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/36968
describe.concurrent("dot specifiers resolve to the directory index, not a sibling file", () => {
  const conflictFixture = {
    "lib.ts": `export const fromSibling = "sibling";`,
    "lib/index.ts": `export const fromIndex = "index";`,
  };

  it.each([".", "./", "./."])("import %j from lib/run.ts ignores sibling lib.ts", async (specifier: string) => {
    using dir = tempDir("resolve-dot-dir", {
      ...conflictFixture,
      "lib/run.ts": `import { fromIndex } from ${JSON.stringify(specifier)}; console.log(fromIndex);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "lib/run.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("index\n");
    expect(exitCode).toBe(0);
  });

  it('require(".") ignores sibling lib.cjs', async () => {
    using dir = tempDir("resolve-dot-dir-cjs", {
      "lib.cjs": `module.exports = { which: "sibling" };`,
      "lib/index.cjs": `module.exports = { which: "index" };`,
      "lib/run.cjs": `console.log(require(".").which);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "lib/run.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("index\n");
    expect(exitCode).toBe(0);
  });

  it.each(["..", "./.."])("import %j ignores a sibling of the parent directory", async (specifier: string) => {
    using dir = tempDir("resolve-dotdot-dir", {
      ...conflictFixture,
      "lib/sub/run.ts": `import { fromIndex } from ${JSON.stringify(specifier)}; console.log(fromIndex);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "lib/sub/run.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("index\n");
    expect(exitCode).toBe(0);
  });

  it('"." resolves via package.json main when there is no index', async () => {
    using dir = tempDir("resolve-dot-pkg-main", {
      "lib.ts": `export const fromSibling = "sibling";`,
      "lib/package.json": JSON.stringify({ name: "lib", main: "./entry.ts" }),
      "lib/entry.ts": `export const fromMain = "main";`,
      "lib/run.ts": `import { fromMain } from "."; console.log(fromMain);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "lib/run.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("main\n");
    expect(exitCode).toBe(0);
  });

  it('"../lib" (no dot segment) still prefers the sibling file over the directory', async () => {
    using dir = tempDir("resolve-trailing-dot-file", {
      ...conflictFixture,
      "lib/run.ts": `import { fromSibling } from "../lib"; console.log(fromSibling);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "lib/run.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("sibling\n");
    expect(exitCode).toBe(0);
  });

  it('"." marked external via an absolute --external path stays external', async () => {
    using dir = tempDir("resolve-dot-external", {
      ...conflictFixture,
      "lib/run.ts": `import { fromIndex } from "."; console.log(fromIndex);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "lib/run.ts", "--external", join(String(dir), "lib")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain('from "."');
    expect(exitCode).toBe(0);
  });

  it('absolute specifier containing ".." and ending in "/." resolves the directory index', async () => {
    using dir = tempDir("resolve-abs-dot-dir", conflictFixture);
    const specifier = `${String(dir)}/sub/../lib/.`;
    writeFileSync(
      join(String(dir), "lib", "run.ts"),
      `import { fromIndex } from ${JSON.stringify(specifier)}; console.log(fromIndex);`,
    );
    await using proc = Bun.spawn({
      cmd: [bunExe(), "lib/run.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("index\n");
    expect(exitCode).toBe(0);
  });

  it('".." segments that reach the filesystem root are a resolve error in a browser build', async () => {
    // More ".." segments than any temp directory is deep, so the specifier names the root on every platform.
    const specifier = Buffer.alloc(64 * 3, "../").toString() + "..";
    using dir = tempDir("resolve-dotdot-root", {
      "run.ts": `import ${JSON.stringify(specifier)};`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "run.ts", "--target=browser"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(`error: Could not resolve: ${JSON.stringify(specifier)}`);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });
});

// On Windows these are not how the resolver spells the path, and it was asked again about its own spelling.
test.concurrent.each(["import", "require"])(
  "%s() of a file written after its directory was read, by an absolute path with forward slashes",
  async load => {
    using dir = tempDir("resolve-written-later", {
      "src/entry.mjs": `
        import { writeFileSync } from "node:fs";
        import { basename, dirname, join } from "node:path";
        writeFileSync(join(import.meta.dir, "later.mjs"), "export default import.meta.path;");
        const root = dirname(import.meta.dir);
        for (const path of [root + "/src/later.mjs", (root + "/src/later.mjs").replaceAll("\\\\", "/")])
          console.log(basename((await ${load}(path)).default));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "src/entry.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "later.mjs\nlater.mjs\n", stderr: "", exitCode: 0 });
  },
);

// A read of a directory can fail after the directory opened: an I/O error, a
// network mount that went away. The resolver took that error as the end of the
// directory and cached the names it had read as the whole directory.
//
// The LD_PRELOAD shim below plays it for one directory. The first getdents64
// of a handle returns the real records without one name, and each later
// getdents64 of that handle fails. bun issues getdents64 through libc's
// syscall(), which is the symbol the shim interposes.
//
//   READDIR_FAULT_DIR    the directory, as /proc/self/fd names it. With a "*"
//                        at the end: each directory whose path starts so and
//                        has no other "/"
//   READDIR_FAULT_HIDE   the name that the first read leaves out
//   READDIR_FAULT_COUNT  how many reads fail in total (default: every one)
//   READDIR_FAULT_ERRNO  the errno of a failed read (default: EIO)
//   READDIR_FAULT_WHILE  a path: reads fail only while it exists
//   READDIR_FAULT_LOG    a file that gets one byte for each read that fails
const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
describe.concurrent.skipIf(!isLinux || !cc)("a directory read that fails", () => {
  const shimSource = /* c */ `
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

struct linux_dirent64 {
  uint64_t d_ino;
  int64_t d_off;
  unsigned short d_reclen;
  unsigned char d_type;
  char d_name[];
};

static long (*next_syscall)(long, ...);
static int reads_left = -2; /* -2: not read from the environment yet, -1: no limit */

static int fault_is_on(void) {
  if (reads_left == -2) {
    const char *count = getenv("READDIR_FAULT_COUNT");
    reads_left = count ? atoi(count) : -1;
  }
  if (reads_left == 0) return 0;
  const char *while_exists = getenv("READDIR_FAULT_WHILE");
  return !while_exists || access(while_exists, F_OK) == 0;
}

/* One byte for each read that fails, so that a test can tell that its fault fired. */
static void note_fault(void) {
  const char *log = getenv("READDIR_FAULT_LOG");
  int fd = log ? open(log, O_WRONLY | O_CREAT | O_APPEND, 0644) : -1;
  if (fd < 0) return;
  ssize_t written = write(fd, "x", 1);
  (void)written;
  close(fd);
}

static long fail_read(void) {
  if (reads_left > 0) reads_left--;
  note_fault();
  const char *err = getenv("READDIR_FAULT_ERRNO");
  errno = err ? atoi(err) : EIO;
  return -1;
}

long syscall(long nr, ...) {
  va_list ap;
  va_start(ap, nr);
  long a1 = va_arg(ap, long), a2 = va_arg(ap, long), a3 = va_arg(ap, long);
  long a4 = va_arg(ap, long), a5 = va_arg(ap, long), a6 = va_arg(ap, long);
  va_end(ap);
  if (!next_syscall) next_syscall = dlsym(RTLD_NEXT, "syscall");
  const char *dir = nr == SYS_getdents64 ? getenv("READDIR_FAULT_DIR") : NULL;
  if (dir && fault_is_on()) {
    int fd = (int)a1;
    char link[64], target[PATH_MAX];
    snprintf(link, sizeof link, "/proc/self/fd/%d", fd);
    ssize_t n = readlink(link, target, sizeof target - 1);
    size_t len = strlen(dir);
    int star = len > 0 && dir[len - 1] == '*';
    if (n > 0 && (target[n] = 0, star ? strncmp(target, dir, len - 1) == 0 && !strchr(target + len - 1, '/') : strcmp(target, dir) == 0)) {
      if (lseek(fd, 0, SEEK_CUR) != 0) return fail_read();
      long rc = next_syscall(nr, a1, a2, a3, a4, a5, a6);
      long read = rc;
      const char *hide = getenv("READDIR_FAULT_HIDE");
      char *buf = (char *)a2;
      for (long pos = 0; hide && pos < rc;) {
        struct linux_dirent64 *d = (struct linux_dirent64 *)(buf + pos);
        unsigned short len = d->d_reclen;
        if (strcmp(d->d_name, hide) == 0) {
          memmove(buf + pos, buf + pos + len, rc - pos - len);
          rc -= len;
        } else {
          pos += len;
        }
      }
      /* No record is left, and 0 is the end of the directory. */
      if (read > 0 && rc == 0) return fail_read();
      return rc;
    }
  }
  return next_syscall(nr, a1, a2, a3, a4, a5, a6);
}
`;

  let shimDir: ReturnType<typeof tempDir> | undefined;
  let shim: string;

  // A C compiler on a busy CI machine can take longer than the default hook timeout.
  beforeAll(async () => {
    shimDir = tempDir("resolver-readdir-fault-shim", { "shim.c": shimSource });
    shim = join(String(shimDir), "shim.so");
    await using compile = Bun.spawn({
      cmd: [cc!, "-shared", "-fPIC", "-o", shim, join(String(shimDir), "shim.c"), "-ldl"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      compile.stdout.text(),
      compile.stderr.text(),
      compile.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`Failed to build the readdir fault shim (exit ${exitCode}):\n${stderr || stdout}`);
    }
  }, 30_000);

  afterAll(() => {
    shimDir?.[Symbol.dispose]();
  });

  type Fault = { dir: string; hide?: string; count?: number; errno?: number; while?: string };

  let runs = 0;

  async function runWithFault(args: string[], cwd: string, fault: Fault, baseEnv = bunEnv, cmd = [bunExe(), ...args]) {
    const existing = baseEnv.LD_PRELOAD;
    const faultLog = join(String(shimDir), `faults-${runs++}`);
    const env: Record<string, string | undefined> = {
      ...baseEnv,
      LD_PRELOAD: existing ? `${shim}:${existing}` : shim,
      READDIR_FAULT_DIR: fault.dir,
      READDIR_FAULT_LOG: faultLog,
    };
    if (fault.hide !== undefined) env.READDIR_FAULT_HIDE = fault.hide;
    if (fault.count !== undefined) env.READDIR_FAULT_COUNT = String(fault.count);
    if (fault.errno !== undefined) env.READDIR_FAULT_ERRNO = String(fault.errno);
    if (fault.while !== undefined) env.READDIR_FAULT_WHILE = fault.while;
    await using proc = Bun.spawn({ cmd, env, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The shim hooks libc's syscall(). If bun stops issuing getdents64 through
    // it, no read fails, and a test that expects the healthy outcome passes
    // for the wrong reason.
    if (!existsSync(faultLog)) {
      throw new Error(
        `The shim failed no read of ${fault.dir} (exit ${exitCode}).\nstdout: ${stdout}\nstderr: ${stderr}`,
      );
    }
    return { stdout, stderr, exitCode };
  }

  // Resolves "dep" four ways. With a READDIR_FAULT_WHILE path it then removes
  // that path and resolves once more.
  const resolveDep = `
    const { unlinkSync } = require("fs");
    const failure = e => ({ error: e.message, code: e.code });
    const attempt = fn => {
      try {
        return fn();
      } catch (e) {
        return failure(e);
      }
    };
    const out = {
      import: await import("dep").then(m => m.default, failure),
      require: attempt(() => require("dep")),
      resolveSync: attempt(() => Bun.resolveSync("dep", import.meta.dir)),
      requireResolve: attempt(() => require.resolve("dep")),
    };
    if (process.env.READDIR_FAULT_WHILE) {
      unlinkSync(process.env.READDIR_FAULT_WHILE);
      out.afterwards = attempt(() => require("dep"));
    }
    console.log(JSON.stringify(out));
  `;

  const packageWithMain = (main: string) => ({
    "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main }),
    [`node_modules/dep/${main}`]: `module.exports = "the main of package.json";`,
    "node_modules/dep/index.js": `module.exports = "index.js, which is not the main";`,
  });

  const cannotRead = (dir: string, errno: string, specifier: string) =>
    `Cannot read directory "${dir}": ${errno} while resolving "${specifier}"`;

  // What resolveDep prints when each of the four fails with the same message.
  const allFail = (error: string) => ({
    import: { error, code: "ERR_MODULE_NOT_FOUND" },
    require: { error, code: "MODULE_NOT_FOUND" },
    resolveSync: { error, code: "ERR_MODULE_NOT_FOUND" },
    requireResolve: { error, code: "MODULE_NOT_FOUND" },
  });

  describe.each([
    // The directory walk reads the package directory.
    { main: "real.js", faultDir: "node_modules/dep", hide: "package.json" },
    // The lookup of the "main" file reads the directory that holds it.
    { main: "lib/real.js", faultDir: "node_modules/dep/lib", hide: "real.js" },
  ])('in a package with "main": "$main"', ({ main, faultDir, hide }) => {
    const files = { "entry.js": resolveDep, ...packageWithMain(main) };

    it("one failed read fails the resolution that needed it, and the next one reads the directory again", async () => {
      using dir = tempDir("resolver-readdir-fault-once", files);
      const root = realpathSync(String(dir));
      const result = await runWithFault(["entry.js"], root, { dir: join(root, faultDir), hide, count: 1 });
      expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
        stdout: {
          import: allFail(cannotRead(join(root, faultDir), "EIO", "dep")).import,
          require: "the main of package.json",
          resolveSync: join(root, "node_modules/dep", main),
          requireResolve: join(root, "node_modules/dep", main),
        },
        stderr: "",
        exitCode: 0,
      });
    });

    it("a read that keeps failing is an error that names the directory, and nothing is cached", async () => {
      using dir = tempDir("resolver-readdir-fault-persistent", { ...files, "fault-is-on": "" });
      const root = realpathSync(String(dir));
      const result = await runWithFault(["entry.js"], root, {
        dir: join(root, faultDir),
        hide,
        while: join(root, "fault-is-on"),
      });
      expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
        stdout: {
          ...allFail(cannotRead(join(root, faultDir), "EIO", "dep")),
          afterwards: "the main of package.json",
        },
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // The module that failed to load keeps its error. The resolver keeps nothing.
  it("a static import fails on one failed read, and a new import of the module loads the file", async () => {
    using dir = tempDir("resolver-readdir-fault-static-import", {
      "entry.mjs": `
        const failure = e => ({ error: e.message });
        console.log(
          JSON.stringify({
            first: await import("./importer.mjs").then(m => m.default, failure),
            again: await import("./importer.mjs?again").then(m => m.default, failure),
          }),
        );
      `,
      "importer.mjs": `import dep from "dep";\nexport default dep;\n`,
      ...packageWithMain("real.js"),
    });
    const root = realpathSync(String(dir));
    const result = await runWithFault(["entry.mjs"], root, {
      dir: join(root, "node_modules/dep"),
      hide: "package.json",
      count: 1,
    });
    expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
      stdout: {
        first: { error: cannotRead(join(root, "node_modules/dep"), "EIO", "dep") },
        again: "the main of package.json",
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // An open that fails with one of these says that no directory is there. A
  // read of a directory that opened, and that still opens, does not.
  it.each(["ENOENT", "ENOTDIR"] as const)("a read that fails with %s is not a directory that is gone", async errno => {
    using dir = tempDir("resolver-readdir-fault-errno", {
      "entry.js": resolveDep,
      ...packageWithMain("real.js"),
      "fault-is-on": "",
    });
    const root = realpathSync(String(dir));
    const result = await runWithFault(["entry.js"], root, {
      dir: join(root, "node_modules/dep"),
      hide: "package.json",
      errno: constants.errno[errno],
      while: join(root, "fault-is-on"),
    });
    expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
      stdout: {
        ...allFail(cannotRead(join(root, "node_modules/dep"), errno, "dep")),
        afterwards: "the main of package.json",
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // The same outcome as a package directory that may not be opened.
  it("a read that is denied does not load another file of the package", async () => {
    using dir = tempDir("resolver-readdir-fault-denied", { "entry.js": resolveDep, ...packageWithMain("real.js") });
    const root = realpathSync(String(dir));
    const result = await runWithFault(["--no-install", "entry.js"], root, {
      dir: join(root, "node_modules/dep"),
      hide: "package.json",
      errno: constants.errno.EPERM,
    });
    const notFound = (code: string) => ({ error: expect.stringContaining("Cannot find"), code });
    expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
      stdout: {
        import: notFound("ERR_MODULE_NOT_FOUND"),
        require: notFound("MODULE_NOT_FOUND"),
        resolveSync: notFound("ERR_MODULE_NOT_FOUND"),
        requireResolve: notFound("MODULE_NOT_FOUND"),
      },
      stderr: "",
      exitCode: 0,
    });
  });

  it("a read that keeps failing does not load the package of a parent directory", async () => {
    using dir = tempDir("resolver-readdir-fault-parent", {
      "outer/node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
      "outer/node_modules/dep/index.js": `module.exports = "the dep of the parent directory";`,
      "outer/project/node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main: "lib.js" }),
      "outer/project/node_modules/dep/lib.js": `module.exports = "the dep of the project";`,
      "outer/project/entry.js": resolveDep,
      "fault-is-on": "",
    });
    const root = realpathSync(String(dir));
    const faultDir = join(root, "outer/project/node_modules/dep");
    const result = await runWithFault(["--no-install", "entry.js"], join(root, "outer/project"), {
      dir: faultDir,
      hide: "package.json",
      while: join(root, "fault-is-on"),
    });
    expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
      stdout: { ...allFail(cannotRead(faultDir, "EIO", "dep")), afterwards: "the dep of the project" },
      stderr: "",
      exitCode: 0,
    });
  });

  // src/x.js is what "./src/x" resolves to when the listing of src has no x.ts.
  const staleSibling = {
    "entry.ts": `import x from "./src/x";\nconsole.log(x);\n`,
    "src/x.ts": `export default "x.ts, the current source";\n`,
    "src/x.js": `export default "x.js, a stale build output";\n`,
  };

  it.each([
    { target: "browser", reads: "every read" },
    { target: "bun", reads: "every read" },
    { target: "browser", reads: "one read", count: 1 },
  ])("bun build --target=$target fails when $reads of a directory fails", async ({ target, count }) => {
    using dir = tempDir("resolver-readdir-fault-build", staleSibling);
    const root = realpathSync(String(dir));
    const { stderr, exitCode } = await runWithFault(
      ["build", "entry.ts", `--target=${target}`, "--outfile=out.js"],
      root,
      { dir: join(root, "src"), hide: "x.ts", count },
    );
    expect(stderr).toContain(`error: ${cannotRead(join(root, "src"), "EIO", "./src/x")}`);
    expect(existsSync(join(root, "out.js"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  // The bundler leaves a require in a try block to the runtime when the
  // package is not found. A package directory that was not read is not that.
  it("bun build fails for a require in a try block", async () => {
    using dir = tempDir("resolver-readdir-fault-build-try", {
      "entry.js": `let dep;\ntry {\n  dep = require("dep");\n} catch {}\nconsole.log(dep);\n`,
      ...packageWithMain("real.js"),
    });
    const root = realpathSync(String(dir));
    const { stderr, exitCode } = await runWithFault(["build", "entry.js", "--outfile=out.js"], root, {
      dir: join(root, "node_modules/dep"),
      hide: "package.json",
    });
    expect(stderr).toContain(`error: ${cannotRead(join(root, "node_modules/dep"), "EIO", "dep")}`);
    expect(existsSync(join(root, "out.js"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  // With --packages=external, a tsconfig "paths" alias is resolved first.
  it("bun build --packages=external fails when the target of a tsconfig path was not read", async () => {
    using dir = tempDir("resolver-readdir-fault-build-paths", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
      "entry.ts": `import pkg from "@/pkg";\nconsole.log(pkg);\n`,
      "src/pkg/package.json": JSON.stringify({ name: "pkg", main: "real.js" }),
      "src/pkg/real.js": `module.exports = "the main of package.json";`,
      "src/pkg/index.js": `module.exports = "index.js, which is not the main";`,
    });
    const root = realpathSync(String(dir));
    const { stderr, exitCode } = await runWithFault(
      ["build", "entry.ts", "--packages=external", "--outfile=out.js"],
      root,
      { dir: join(root, "src/pkg"), hide: "package.json" },
    );
    expect(stderr).toContain(`error: ${cannotRead(join(root, "src/pkg"), "EIO", "@/pkg")}`);
    expect(existsSync(join(root, "out.js"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  // A CSS import that is not found is resolved again without its query.
  it("bun build fails for a CSS import with a query", async () => {
    using dir = tempDir("resolver-readdir-fault-build-css", {
      "entry.css": `@import "dep?v=1";\n`,
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main: "real.css" }),
      "node_modules/dep/real.css": `.real {\n  color: green;\n}\n`,
      "node_modules/dep/index.css": `.index {\n  color: red;\n}\n`,
    });
    const root = realpathSync(String(dir));
    const { stderr, exitCode } = await runWithFault(["build", "entry.css", "--outfile=out.css"], root, {
      dir: join(root, "node_modules/dep"),
      hide: "package.json",
    });
    expect(stderr).toContain(`error: ${cannotRead(join(root, "node_modules/dep"), "EIO", "dep")}`);
    expect(existsSync(join(root, "out.css"))).toBe(false);
    expect(exitCode).toBe(1);
  });

  // The log looks the specifier up in the message, which shows a byte that
  // is not UTF-8 as U+FFFD.
  it("bun build reports the directory for an entry point whose name is not UTF-8", async () => {
    using dir = tempDir("resolver-readdir-fault-build-bytes", staleSibling);
    const root = realpathSync(String(dir));
    const { stderr, exitCode } = await runWithFault([], root, { dir: root, hide: "entry.ts" }, bunEnv, [
      "sh",
      "-c",
      `exec "$0" build "$(printf 'caf\\351.ts')"`,
      bunExe(),
    ]);
    expect(stderr).toContain(`error: Cannot read directory "${root}": EIO while resolving "caf`);
    expect(exitCode).toBe(1);
  });

  // Builds its arguments in turn, in one process. The shim fails reads only
  // during the second build. That build resolves against what the first build
  // cached: the listings, and the directory records that point at them. The
  // tests that run it are serial: a debug build takes seconds for several
  // builds when other tests run beside it.
  //
  // The bundle thread starts a new generation when its queue is empty, and
  // that can be after the next Bun.build is queued. A build in the old
  // generation reads no directory again. So the script builds a probe (the
  // second entry point, unless one is given) until the shim has failed a read.
  const buildInTurn = `
    const { existsSync, unlinkSync, writeFileSync } = require("fs");
    const faultIsOn = process.env.READDIR_FAULT_WHILE;
    const faultLog = process.env.READDIR_FAULT_LOG;
    // The path comments of a bundle name the files in it.
    async function build(entrypoint) {
      try {
        const result = await Bun.build({ entrypoints: [entrypoint] });
        const text = await result.outputs[0].text();
        return text.split("\\n").filter(line => line.startsWith("// "));
      } catch (e) {
        return (e.errors ?? [e]).map(e => e.message);
      }
    }
    const [first, second = first, probe = second] = process.argv.slice(2);
    const out = { healthy: await build(first) };
    writeFileSync(faultIsOn, "");
    let probed = await build(probe);
    for (let attempt = 0; attempt < 10 && !existsSync(faultLog); attempt++) {
      await Bun.sleep(5);
      probed = await build(probe);
    }
    out.failing = probe === second ? probed : await build(second);
    unlinkSync(faultIsOn);
    out.healthyAgain = await build(second);
    console.log(JSON.stringify(out));
  `;

  const pkg = (name: string) => JSON.stringify({ name, version: "1.0.0" });

  describe.each([
    {
      // The lookup of a file reads the directory that holds it.
      name: "a file",
      files: staleSibling,
      faultDir: "src",
      hide: "x.ts",
      specifier: "./src/x",
      bundled: ["// src/x.ts", "// entry.ts"],
    },
    {
      // The index file is looked up in the listing that the directory record points at.
      name: "a directory",
      files: {
        "entry.ts": `import index from "./src";\nconsole.log(index);\n`,
        "src/index.ts": `export default "index.ts, the current source";\n`,
        "src/index.js": `export default "index.js, a stale build output";\n`,
      },
      faultDir: "src",
      hide: "index.ts",
      specifier: "./src",
      bundled: ["// src/index.ts", "// entry.ts"],
    },
    {
      // The target of "exports" is looked up in the listing of its directory.
      name: 'a package with "exports"',
      files: {
        "entry.ts": `import dep from "dep";\nconsole.log(dep);\n`,
        "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", exports: "./lib/index.js" }),
        "node_modules/dep/lib/index.js": `export default "dep";\n`,
      },
      faultDir: "node_modules/dep/lib",
      hide: "index.js",
      specifier: "dep",
      bundled: ["// node_modules/dep/lib/index.js", "// entry.ts"],
    },
    {
      // A package that is not found here is looked for in the parent directories.
      name: "a package that a parent directory also has",
      cwd: "outer/project",
      files: {
        "outer/node_modules/dep/package.json": pkg("dep"),
        "outer/node_modules/dep/index.js": `export default "the dep of the parent directory";\n`,
        "outer/project/node_modules/dep/package.json": pkg("dep"),
        "outer/project/node_modules/dep/index.js": `export default "the dep of the project";\n`,
        "outer/project/entry.ts": `import dep from "dep";\nconsole.log(dep);\n`,
      },
      faultDir: "outer/project/node_modules/dep",
      hide: "index.js",
      specifier: "dep",
      bundled: ["// node_modules/dep/index.js", "// entry.ts"],
    },
  ])("Bun.build of an import of $name", ({ files, cwd = "", faultDir, hide, specifier, bundled }) => {
    it.serial("keeps the listing of the last build when a later read fails", async () => {
      using dir = tempDir("resolver-readdir-fault-rebuild", { ...files, [join(cwd, "build.js")]: buildInTurn });
      const root = realpathSync(String(dir));
      const result = await runWithFault(["build.js", "./entry.ts"], join(root, cwd), {
        dir: join(root, faultDir),
        hide,
        while: join(root, "fault-is-on"),
      });
      expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
        stdout: {
          healthy: bundled,
          failing: [`Cannot read directory "${join(root, faultDir)}": EIO while resolving "${specifier}"`],
          healthyAgain: bundled,
        },
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // The listing of node_modules says whether a file with the name of the
  // package is there, and the lookup of that file is what fails. The walk to
  // node_modules/linked asks the file system whether it is a symlink.
  it.serial(
    "Bun.build does not take a symlinked package for a directory when the read of its parent fails",
    async () => {
      using dir = tempDir("resolver-readdir-fault-symlink", {
        "build.js": buildInTurn,
        "node_modules/plain/package.json": pkg("plain"),
        "node_modules/plain/index.js": `export default "plain";\n`,
        "packages/linked/package.json": pkg("linked"),
        "packages/linked/index.js": `export default "linked";\n`,
        "plain.ts": `import plain from "plain";\nconsole.log(plain);\n`,
        "linked.ts": `import linked from "linked";\nconsole.log(linked);\n`,
        // The lookup of this file reads node_modules again, and nothing below it.
        "node_modules/marker.js": `export default "marker";\n`,
        "probe.ts": `import marker from "./node_modules/marker.js";\nconsole.log(marker);\n`,
      });
      const root = realpathSync(String(dir));
      symlinkSync(join("..", "packages", "linked"), join(root, "node_modules", "linked"));
      const result = await runWithFault(["build.js", "./plain.ts", "./linked.ts", "./probe.ts"], root, {
        dir: join(root, "node_modules"),
        hide: "linked",
        while: join(root, "fault-is-on"),
      });
      expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
        stdout: {
          healthy: ["// node_modules/plain/index.js", "// plain.ts"],
          failing: [`Cannot read directory "${join(root, "node_modules")}": EIO while resolving "linked"`],
          healthyAgain: ["// packages/linked/index.js", "// linked.ts"],
        },
        stderr: "",
        exitCode: 0,
      });
    },
  );

  const workspace = (name: string) => JSON.stringify({ name, scripts: { hello: `echo hello from ${name}` } });
  const workspaces = {
    "package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"] }),
    "packages/a/package.json": workspace("a"),
    "packages/b/package.json": workspace("b"),
    "packages/c/package.json": workspace("c"),
  };

  it("bun run --filter finds every workspace after one failed read of the root", async () => {
    using dir = tempDir("resolver-readdir-fault-filter", workspaces);
    const root = realpathSync(String(dir));
    const { stdout, stderr, exitCode } = await runWithFault(["run", "--filter", "*", "hello"], root, {
      dir: root,
      hide: "packages",
      count: 1,
    });
    const ran = (stdout + stderr)
      .split("\n")
      .filter(line => line.includes("hello from"))
      .sort();
    expect(ran).toEqual(["a hello: hello from a", "b hello: hello from b", "c hello: hello from c"]);
    expect(exitCode).toBe(0);
  });

  it("bun run --filter names the root when its read keeps failing", async () => {
    using dir = tempDir("resolver-readdir-fault-filter-persistent", workspaces);
    const root = realpathSync(String(dir));
    const { stdout, stderr, exitCode } = await runWithFault(["run", "--filter", "*", "hello"], root, {
      dir: root,
      hide: "packages",
    });
    expect(stderr).toContain(`error: EIO loading directory "${root}"`);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  const belowAncestor = {
    "outer/node_modules/.bin/tool": `#!/bin/sh\necho the tool of outer\n`,
    "outer/project/package.json": JSON.stringify({
      name: "project",
      scripts: { hello: "echo hello from project", tool: "tool" },
    }),
    "outer/project/index.js": `console.log(require("./dep.js"));`,
    "outer/project/dep.js": `module.exports = "loaded";`,
  };

  // A directory on the way to the working directory. With EACCES it is an
  // empty directory, as when it may not be opened. With EIO the file system
  // is asked for the names that the walk needs there.
  describe.each(["EACCES", "EIO"] as const)("below a directory whose read fails with %s", errno => {
    it.each([
      { name: "bun runs a file", args: ["--no-install", "index.js"], stdout: "loaded\n" },
      { name: "bun run runs a script", args: ["run", "--silent", "hello"], stdout: "hello from project\n" },
      // The script finds the tool through the node_modules/.bin of the directory above.
      {
        name: "bun run runs a script that runs a tool",
        args: ["run", "--silent", "tool"],
        stdout: "the tool of outer\n",
      },
    ])("$name", async ({ args, stdout }) => {
      using dir = tempDir("resolver-readdir-fault-ancestor", belowAncestor);
      const root = realpathSync(String(dir));
      chmodSync(join(root, "outer/node_modules/.bin/tool"), 0o755);
      const result = await runWithFault(args, join(root, "outer/project"), {
        dir: join(root, "outer"),
        errno: constants.errno[errno],
      });
      expect(result).toEqual({ stdout, stderr: "", exitCode: 0 });
    });

    // A later build reads the ancestor again, for the first directory that it visits below it.
    it.serial("Bun.build goes to another directory below it in a later build", async () => {
      using dir = tempDir("resolver-readdir-fault-ancestor-rebuild", {
        "outer/project/build.js": buildInTurn,
        "outer/project/entry.ts": `console.log("project");\n`,
        "outer/other/entry.ts": `console.log("other");\n`,
        // The lookup of this file reads the ancestor again, and not the other directory.
        "outer/marker.ts": `export default "marker";\n`,
        "outer/project/probe.ts": `import marker from "../marker.ts";\nconsole.log(marker);\n`,
      });
      const root = realpathSync(String(dir));
      const result = await runWithFault(
        ["build.js", "./entry.ts", "../other/entry.ts", "./probe.ts"],
        join(root, "outer/project"),
        { dir: join(root, "outer"), errno: constants.errno[errno], while: join(root, "fault-is-on") },
      );
      expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
        stdout: {
          healthy: ["// entry.ts"],
          failing: ["// ../other/entry.ts"],
          healthyAgain: ["// ../other/entry.ts"],
        },
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // The walk to a directory needs a few names of each directory above it. It
  // asks the file system for them when the read of such a directory fails.
  // Every other name in that directory still needs the listing.
  const belowProject = (config: string) => ({
    "package.json": JSON.stringify({ name: "project", imports: { "#internal": "./src/internal.ts" } }),
    [config]: JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
    ...packageWithMain("real.js"),
    "top.ts": `export default "top";\n`,
    "src/internal.ts": `export default "internal";\n`,
    "src/util.ts": `export default "util";\n`,
    "src/entry.ts": `
      import { unlinkSync } from "fs";
      const load = specifier => import(specifier).then(m => m.default, e => ({ error: e.message }));
      const out = {
        package: await load("dep"),
        alias: await load("@/util"),
        imports: await load("#internal"),
        file: await load("../top.ts"),
      };
      if (process.env.READDIR_FAULT_WHILE) {
        unlinkSync(process.env.READDIR_FAULT_WHILE);
        out.fileAfterwards = await load("../top.ts");
      }
      console.log(JSON.stringify(out));
    `,
  });
  const fromTheAncestor = { package: "the main of package.json", alias: "util", imports: "internal" };

  describe.each([
    { hide: "node_modules", config: "tsconfig.json" },
    { hide: "package.json", config: "tsconfig.json" },
    { hide: "tsconfig.json", config: "tsconfig.json" },
    { hide: "jsconfig.json", config: "jsconfig.json" },
  ])("below a directory that has $hide", ({ hide, config }) => {
    it("finds it when the read of that directory keeps failing, and a file in that directory is an error", async () => {
      using dir = tempDir("resolver-readdir-fault-ancestor-names", { ...belowProject(config), "fault-is-on": "" });
      const root = realpathSync(String(dir));
      const result = await runWithFault(["--no-install", "entry.ts"], join(root, "src"), {
        dir: root,
        hide,
        while: join(root, "fault-is-on"),
      });
      expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
        stdout: {
          ...fromTheAncestor,
          file: { error: cannotRead(root, "EIO", "../top.ts") },
          fileAfterwards: "top",
        },
        stderr: "",
        exitCode: 0,
      });
    });

    it("finds it after one failed read of that directory", async () => {
      using dir = tempDir("resolver-readdir-fault-ancestor-names-once", belowProject(config));
      const root = realpathSync(String(dir));
      const result = await runWithFault(["--no-install", "entry.ts"], join(root, "src"), {
        dir: root,
        hide,
        count: 1,
      });
      expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
        stdout: { ...fromTheAncestor, file: "top" },
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // The listing of a directory says which of its entries are symlinks.
  it("knows a symlink in a directory whose read keeps failing", async () => {
    using dir = tempDir("resolver-readdir-fault-ancestor-symlink", {
      "real/sub/x.ts": `export default import.meta.path;\n`,
      "other/entry.ts": `console.log((await import("../link/sub/x.ts")).default);\n`,
    });
    const root = realpathSync(String(dir));
    symlinkSync("real", join(root, "link"));
    const result = await runWithFault(["--no-install", "entry.ts"], join(root, "other"), { dir: root, hide: "link" });
    expect(result).toEqual({ stdout: join(root, "real/sub/x.ts") + "\n", stderr: "", exitCode: 0 });
  });

  // The lookup of the file reads only "other/deep". The directory record of
  // "other/deep", which the result needs, goes through "other" too.
  it.each(["browser", "bun"])(
    "bun build --target=%s bundles a file below a directory whose read keeps failing",
    async target => {
      using dir = tempDir("resolver-readdir-fault-build-ancestor", {
        "project/entry.ts": `import x from "../other/deep/x.ts";\nconsole.log(x);\n`,
        "other/deep/x.ts": `export default "x";\n`,
      });
      const root = realpathSync(String(dir));
      const { stderr, exitCode } = await runWithFault(
        ["build", "entry.ts", `--target=${target}`, "--outfile=out.js"],
        join(root, "project"),
        { dir: join(root, "other"), hide: "deep" },
      );
      expect(stderr).toBe("");
      expect(await Bun.file(join(root, "project/out.js")).text()).toContain(`var x_default = "x";`);
      expect(exitCode).toBe(0);
    },
  );

  // The listing of the working directory says which .env files it has. With
  // no listing, the file system says so. An --env-file is opened by its path:
  // main loads it too, and the change before this one did not.
  describe.each(["EIO", "EACCES"] as const)("when the read of the working directory fails with %s", errno => {
    it.each([
      { name: "the .env file", args: [], value: "from .env" },
      { name: "an --env-file", args: ["--env-file=custom.env"], value: "from custom.env" },
    ])("bun loads $name", async ({ args, value }) => {
      using dir = tempDir("resolver-readdir-fault-dotenv", {
        ".env": "FROM_ENV_FILE=from .env\n",
        "custom.env": "FROM_ENV_FILE=from custom.env\n",
      });
      const root = realpathSync(String(dir));
      const result = await runWithFault([...args, "-e", "console.log(process.env.FROM_ENV_FILE)"], root, {
        dir: root,
        hide: ".env",
        errno: constants.errno[errno],
      });
      expect(result).toEqual({ stdout: value + "\n", stderr: "", exitCode: 0 });
    });
  });

  // The walk keeps the handle of a directory that it listed, and no listing
  // holds the handle of one whose read failed.
  it("leaves no descriptor open for the directories above whose read failed", async () => {
    const files = Array.from({ length: 20 }, (_, i) => [`dirs/a${i}/sub/x.js`, `module.exports = ${i};`]);
    using dir = tempDir("resolver-readdir-fault-ancestor-descriptors", {
      "entry.js": `
        const { readdirSync } = require("fs");
        const descriptors = () => readdirSync("/proc/self/fd").length;
        const before = descriptors();
        let sum = 0;
        for (let i = 0; i < 20; i++) sum += require("./dirs/a" + i + "/sub/x.js");
        console.log(JSON.stringify({ sum, opened: descriptors() - before }));
      `,
      ...Object.fromEntries(files),
    });
    const root = realpathSync(String(dir));
    const result = await runWithFault(["--no-install", "entry.js"], root, { dir: join(root, "dirs/a*") });
    expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
      stdout: { sum: 190, opened: 0 },
      stderr: "",
      exitCode: 0,
    });
  });

  // Auto-install takes the version of a package from the bun.lock of the
  // project, which it finds in the listing of the project directory.
  it("does not install a package when the read of the project directory above keeps failing", async () => {
    const versions = ["1.0.0", "1.1.0"];
    const tarballs = new Map<string, Uint8Array>();
    for (const version of versions) {
      const files = {
        "package/package.json": JSON.stringify({ name: "dep", version }),
        "package/index.js": `module.exports = ${JSON.stringify(version)};`,
      };
      tarballs.set(`/dep/-/dep-${version}.tgz`, await new Bun.Archive(files, { compress: "gzip" }).bytes());
    }
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        const tarball = tarballs.get(new URL(req.url).pathname);
        if (tarball) return new Response(tarball);
        const dist = (version: string) => ({ tarball: `${server.url}dep/-/dep-${version}.tgz` });
        return Response.json({
          name: "dep",
          "dist-tags": { latest: "1.1.0" },
          versions: Object.fromEntries(
            versions.map(version => [version, { name: "dep", version, dist: dist(version) }]),
          ),
        });
      },
    });
    const dependencies = { dep: "^1.0.0" };
    using dir = tempDir("resolver-readdir-fault-lockfile", {
      "app/package.json": JSON.stringify({ name: "app", dependencies }),
      "app/bun.lock": JSON.stringify({
        lockfileVersion: 1,
        configVersion: 1,
        workspaces: { "": { name: "app", dependencies } },
        packages: { dep: ["dep@1.0.0", "", {}, ""] },
      }),
      "app/src/bunfig.toml": Bun.TOML.stringify({ install: { registry: server.url.href } }),
      "app/src/entry.js": `
        const { unlinkSync } = require("fs");
        const attempt = () => {
          try {
            return require("dep");
          } catch (e) {
            return { error: e.message };
          }
        };
        const out = { failing: attempt() };
        unlinkSync(process.env.READDIR_FAULT_WHILE);
        out.afterwards = attempt();
        console.log(JSON.stringify(out));
      `,
      "cache": {},
      "fault-is-on": "",
    });
    const root = realpathSync(String(dir));
    const result = await runWithFault(
      ["--install=auto", "entry.js"],
      join(root, "app/src"),
      { dir: join(root, "app"), hide: "bun.lock", while: join(root, "fault-is-on") },
      { ...bunEnv, BUN_INSTALL_CACHE_DIR: join(root, "cache") },
    );
    expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
      stdout: { failing: { error: cannotRead(join(root, "app"), "EIO", "dep") }, afterwards: "1.0.0" },
      stderr: "",
      exitCode: 0,
    });
  });

  // Auto-install puts a package in the install cache and resolves it from
  // there. That directory has its own read in the resolver.
  it("a read of a package in the install cache that keeps failing is an error", async () => {
    const tarball = await new Bun.Archive(
      {
        "package/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main: "real.js" }),
        "package/real.js": `module.exports = "the main of package.json";`,
        "package/index.js": `module.exports = "index.js, which is not the main";`,
      },
      { compress: "gzip" },
    ).bytes();
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        if (new URL(req.url).pathname.endsWith(".tgz")) return new Response(tarball);
        const dist = { tarball: `${server.url}dep/-/dep-1.0.0.tgz` };
        return Response.json({
          name: "dep",
          "dist-tags": { latest: "1.0.0" },
          versions: { "1.0.0": { name: "dep", version: "1.0.0", dist } },
        });
      },
    });
    using dir = tempDir("resolver-readdir-fault-auto-install", {
      "project/bunfig.toml": Bun.TOML.stringify({ install: { registry: server.url.href } }),
      "project/entry.js": resolveDep,
      "cache": {},
      "fault-is-on": "",
    });
    const root = realpathSync(String(dir));
    const cache = join(root, "cache");
    // The first import installs the package. Its directory in the cache has
    // the version and the registry in its name.
    const result = await runWithFault(
      ["--install=auto", "entry.js"],
      join(root, "project"),
      { dir: join(cache, "dep@*"), hide: "package.json", while: join(root, "fault-is-on") },
      { ...bunEnv, BUN_INSTALL_CACHE_DIR: cache },
    );
    const [inCache] = readdirSync(cache).filter(name => name.startsWith("dep@"));
    const faultDir = join(cache, inCache);
    expect({ ...result, stdout: JSON.parse(result.stdout || "null") }).toEqual({
      stdout: { ...allFail(cannotRead(faultDir, "EIO", "dep")), afterwards: "the main of package.json" },
      stderr: "",
      exitCode: 0,
    });
  });

  // Fails the same resolution again and again, after a warm-up.
  const failInALoop = `
    const { readdirSync } = require("fs");
    const [specifier, count] = process.argv.slice(2);
    const descriptors = () => readdirSync("/proc/self/fd").length;
    const fail = times => {
      let failed = 0;
      for (let i = 0; i < times; i++) {
        try {
          Bun.resolveSync(specifier, import.meta.dir);
        } catch {
          failed++;
        }
      }
      return failed;
    };
    fail(20);
    Bun.gc(true);
    const descriptorsBefore = descriptors();
    const rssBefore = process.memoryUsage.rss();
    const failed = fail(+count);
    Bun.gc(true);
    const grownMiB = (process.memoryUsage.rss() - rssBefore) / 1024 / 1024;
    console.log(JSON.stringify({ failed, descriptorsBefore, descriptorsAfter: descriptors(), grownMiB }));
  `;

  // The stores that hold the names of a directory only grow. A read that
  // fails again uses the names that the last failed read of it stored.
  it.serial.each([
    // The directory walk reads the package directory.
    { specifier: "dep", faultDir: "node_modules/dep", hide: "package.json" },
    // The lookup of a file reads the directory that holds it.
    { specifier: "./src/x", faultDir: "src", hide: "x.ts" },
  ])(
    'a read that keeps failing for "$specifier" leaves no descriptor open and stores its names once',
    async ({ specifier, faultDir, hide }) => {
      const names = Array.from({ length: 250 }, (_, i) => [`${faultDir}/name-${String(i).padStart(3, "0")}.js`, ""]);
      using dir = tempDir("resolver-readdir-fault-leak", {
        "entry.js": failInALoop,
        ...packageWithMain("real.js"),
        ...staleSibling,
        ...Object.fromEntries(names),
      });
      const root = realpathSync(String(dir));
      const slow = isASAN || isDebug;
      const failures = slow ? 300 : 1000;
      // The quarantine of ASAN keeps every freed hash table of a failed read.
      const { stdout, stderr, exitCode } = await runWithFault(
        ["entry.js", specifier, String(failures)],
        root,
        { dir: join(root, faultDir), hide },
        withoutAsanQuarantine(bunEnv),
      );
      expect(stderr).toBe("");
      const { failed, descriptorsBefore, descriptorsAfter, grownMiB } = JSON.parse(stdout);
      expect({ failed, descriptorsAfter }).toEqual({ failed: failures, descriptorsAfter: descriptorsBefore });
      // One read of this directory stores about 250 entries of 144 bytes and
      // their names, and each resolution fails at least one read. If each read
      // stored its entries again, the process would grow by at least 11 MiB in
      // 300 resolutions and by 37 MiB in 1000. It grows by about 2 MiB.
      expect(grownMiB).toBeLessThan(slow ? 6 : 12);
      expect(exitCode).toBe(0);
    },
  );
});

describe.concurrent("a directory that does not open", () => {
  // Opens files until there is no free descriptor, then resolves a package in
  // a directory that the resolver did not open yet.
  const resolveWithoutDescriptors = `
    const { closeSync, openSync } = require("fs");
    const attempt = fn => {
      try {
        return fn();
      } catch (e) {
        return { error: e.message };
      }
    };
    const held = [];
    for (;;) {
      try {
        held.push(openSync(__filename, "r"));
      } catch (e) {
        if (e.code !== "EMFILE") throw e;
        break;
      }
    }
    const out = { noDescriptor: attempt(() => require.resolve("dep")) };
    for (const fd of held) closeSync(fd);
    out.afterwards = attempt(() => require.resolve("dep"));
    console.log(JSON.stringify(out));
  `;

  // As root on musl, bun raises the descriptor limit at startup, to more
  // descriptors than this script can open in the time of a test.
  it.skipIf(isWindows || (isMusl && isRoot))(
    "no free descriptor is an error that names the directory, and nothing is cached",
    async () => {
      using dir = tempDir("resolver-open-emfile", {
        "entry.js": resolveWithoutDescriptors,
        "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0" }),
        "node_modules/dep/index.js": `module.exports = "dep";`,
      });
      const root = realpathSync(String(dir));
      await using proc = Bun.spawn({
        cmd: ["sh", "-c", 'ulimit -n 256 && exec "$0" "$@"', bunExe(), "--no-install", "entry.js"],
        env: bunEnv,
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
        stdout: {
          noDescriptor: {
            error: `Cannot read directory "${join(root, "node_modules")}": EMFILE while resolving "dep"`,
          },
          afterwards: join(root, "node_modules/dep/index.js"),
        },
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // Builds "./entry.js" three times in one process: with the directory "sub",
  // with a file in its place, and with the directory again.
  const buildAroundAFile = `
    const { mkdirSync, rmSync, writeFileSync } = require("fs");
    async function build() {
      const result = await Bun.build({ entrypoints: ["./entry.js"], throw: false });
      return result.success ? "built" : result.logs.map(log => log.message);
    }
    const out = { directory: await build() };
    rmSync("sub", { recursive: true });
    writeFileSync("sub", "");
    // The bundle thread starts a new generation when its queue is empty, and
    // that can be after the next Bun.build is queued. A build in the old
    // generation takes the names in "sub" from the cache. So this builds
    // until the resolver opens "sub" again.
    out.file = await build();
    for (let attempt = 0; attempt < 100 && !String(out.file).includes("Could not resolve"); attempt++) {
      await Bun.sleep(5);
      out.file = await build();
    }
    if (process.argv[2] === "resolve") {
      // The runtime resolver stays in the first generation and reads nothing
      // again. It takes the answer from what the build left in the cache.
      try {
        out.runtime = Bun.resolveSync("./sub/mod.js", import.meta.dir);
      } catch (e) {
        out.runtime = { error: e.message };
      }
    } else {
      rmSync("sub");
      mkdirSync("sub");
      writeFileSync("sub/mod.js", "export default 2;\\n");
      out.directoryAgain = await build();
    }
    console.log(JSON.stringify(out));
  `;

  const aroundAFile = {
    "build.js": buildAroundAFile,
    "entry.js": `import value from "./sub/mod.js";\nconsole.log(value);\n`,
    "sub/mod.js": `export default 1;\n`,
  };

  it.serial.each([
    {
      name: "Bun.build reads a directory again after a build that found a file in its place",
      args: [],
      after: { directoryAgain: "built" },
    },
    {
      // The same on main: the build that finds the file drops the names.
      name: "the runtime does not resolve into a directory after a build found a file in its place",
      args: ["resolve"],
      after: { runtime: { error: expect.stringContaining("Cannot find module") } },
    },
  ])("$name", async ({ args, after }) => {
    using dir = tempDir("resolver-open-enotdir-rebuild", aroundAFile);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.js", ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: JSON.parse(stdout || "null"), stderr, exitCode }).toEqual({
      stdout: { directory: "built", file: ['Could not resolve: "./sub/mod.js"'], ...after },
      stderr: "",
      exitCode: 0,
    });
  });
});
