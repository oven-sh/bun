import { describe, it, expect } from "bun:test";
import { pathToFileURL } from "bun";
import { mkdirSync, writeFileSync } from "fs";
import { join, sep } from "path";
import { bunExe, bunEnv, tempDirWithFiles, joinP, isWindows } from "harness";

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

it.todo("import override to bun:test", async () => {
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
