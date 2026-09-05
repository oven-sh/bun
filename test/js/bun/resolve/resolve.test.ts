import { pathToFileURL } from "bun";
import { describe, expect, it, test } from "bun:test";
import { chmodSync, chownSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, bunRun, isLinux, isMacOS, isWindows, joinP, tempDir, tempDirWithFiles } from "harness";
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

// On POSIX, `\` is a valid filename character, not a path separator. Node
// refuses every bare specifier containing `\` on POSIX (it looks for a
// literal file named e.g. `pk\secret.js` in node_modules, which does not
// exist). Bun's Platform::Loose path normalization rewrites `\` to `/`
// before hitting the filesystem, which let `pk\secret.js` bypass the
// `exports` map and `pk\..\..` escape the package root entirely.
describe.skipIf(isWindows)("backslash in bare package specifier (POSIX)", () => {
  const fixture = `
    const { createRequire } = require("node:module");
    const req = createRequire(process.cwd() + "/app/x.cjs");
    const probe = s => {
      try { return JSON.stringify(req(s)); }
      catch (e) { return "ERR:" + (e.code || e.name); }
    };
    const rprobe = s => {
      try { return req.resolve(s); }
      catch (e) { return "ERR:" + (e.code || e.name); }
    };
    const out = {
      // control: forward-slash forms are correctly refused today
      fwd_secret: probe("pk/secret.js"),
      fwd_escape: probe("pk/../../appfile.js"),
      // backslash forms: must be refused on POSIX (Node parity)
      bs_secret: probe("pk\\\\secret.js"),
      bs_escape_app: probe("pk\\\\..\\\\..\\\\appfile.js"),
      bs_escape_outside: probe("pk\\\\..\\\\..\\\\..\\\\outside.js"),
      bs_resolve_outside: rprobe("pk\\\\..\\\\..\\\\..\\\\outside.js"),
      bs_no_pkg: probe("nosuch\\\\..\\\\..\\\\appfile.js"),
      // mixed: forward-slash after name, backslash in subpath (no exports map)
      bs_mixed_noexports: probe("noexp/..\\\\..\\\\appfile.js"),
    };
    console.log(JSON.stringify(out));
  `;

  function makeDir() {
    return tempDir("bs-bare-specifier", {
      "app/package.json": JSON.stringify({ name: "app" }),
      "app/node_modules/pk/package.json": JSON.stringify({
        name: "pk",
        exports: { ".": "./main.js", "./pub": "./pub.js" },
      }),
      "app/node_modules/pk/main.js": `module.exports = "MAIN";`,
      "app/node_modules/pk/pub.js": `module.exports = "PUB";`,
      "app/node_modules/pk/secret.js": `module.exports = "SECRET-UNEXPORTED";`,
      "app/node_modules/noexp/package.json": JSON.stringify({ name: "noexp" }),
      "app/node_modules/noexp/index.js": `module.exports = "NOEXP";`,
      "app/appfile.js": `module.exports = "APP-ROOT-FILE";`,
      "outside.js": `module.exports = "OUTSIDE-APP-ROOT";`,
      "app/entry.js": fixture,
    });
  }

  const expected = {
    fwd_secret: "ERR:MODULE_NOT_FOUND",
    fwd_escape: "ERR:MODULE_NOT_FOUND",
    bs_secret: "ERR:MODULE_NOT_FOUND",
    bs_escape_app: "ERR:MODULE_NOT_FOUND",
    bs_escape_outside: "ERR:MODULE_NOT_FOUND",
    bs_resolve_outside: "ERR:MODULE_NOT_FOUND",
    bs_no_pkg: "ERR:MODULE_NOT_FOUND",
    bs_mixed_noexports: "ERR:MODULE_NOT_FOUND",
  };

  it.concurrent("require / require.resolve refuse backslash specifiers", async () => {
    using dir = makeDir();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "app/entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  it.concurrent("bun build refuses backslash specifiers", async () => {
    using dir = tempDir("bs-bare-specifier-build", {
      "package.json": JSON.stringify({ name: "app" }),
      "node_modules/pk/package.json": JSON.stringify({
        name: "pk",
        exports: { ".": "./main.js" },
      }),
      "node_modules/pk/main.js": `module.exports = "MAIN";`,
      "node_modules/pk/secret.js": `module.exports = "SECRET-UNEXPORTED";`,
      "entry.js": `console.log(require("pk\\\\secret.js"));`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).not.toContain("SECRET-UNEXPORTED");
    expect(stderr.toLowerCase()).toContain("could not resolve");
    expect(exitCode).not.toBe(0);
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
});
