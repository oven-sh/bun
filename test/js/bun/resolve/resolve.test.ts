import { describe, it, beforeAll, expect, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, rmdirSync } from "fs";
import { pathToFileURL } from "bun";
import { join, sep } from "path";
import { bunExe, bunEnv, tempDirWithFiles, joinP, isWindows } from "harness";

const env = { ...bunEnv };

beforeAll(() => {
  for (const key in env) {
    if (key.startsWith("BUN_DEBUG_") && key !== "BUN_DEBUG_QUIET_LOGS") {
      delete env[key];
    }
  }
});

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
/**
 * When resolving imports, if `package.json` has `exports` fields that conflict
 * with tsconfig paths, then `imports` should take precedence.
 * notes:
 * 1. self-referrential imports hit a different code path
 * 2. resolve walks up the directory tree, finding the nearest tsconfig.json.
 * 3. I *think* different logic happens when the resolved path (i.e. following symlinks)
 *   is in node_modules instead of in the project directory.
 *
 * All of this is to say yes, this is a complicated test, but it broke
 * playwright ¯\_(ツ)_/¯
 */
describe("when both package.json imports and tsconfig.json paths are present", () => {
  let dir: string;
  beforeAll(() => {
    dir = tempDirWithFiles("package-json-imports", {
      "bunfig.toml": /* toml */ `
      tsconfig = false
      `,
      "tsconfig.json": /* json */ `
      {
        "compilerOptions": {
          "baseUrl": ".",
          "paths": {
            "foo/lib/*": ["./packages/foo/src/*"]
          }
        }
      }
      `,
      "package.json": /* json */ `
      {
        "name": "root",
        "private": true,
        "version": "0.1.0",
        "workspaces": ["packages/*"],
      }
      `,
      packages: {
        foo: {
          "package.json": /* json */ `
          {
            "name": "foo",
            "version": "0.1.0",
            "main": "lib/target.js",
            "exports": {
              "./lib/target": "./lib/target.js",
              "./lib/imported": "./lib/imported.js",
            }
          }
          `,
          lib: {
            "target.js": /* js */ `module.exports.foo = require('./imported').foo;`,
            "imported.js": /* js */ `module.exports.foo = 1;`,
          },
          src: {
            "target.ts": /* ts */ `export {foo} from './imported';`,
            // no imported
          },
        },
        bar: {
          "package.json": /* json */ `
          {
            "name": "bar",
            "version": "0.1.0",
            "dependencies": {
              "foo": "*"
            }
          }
          `,
          src: {
            "index.js": /* ts */ `const {foo} = require('foo/lib/target'); console.log(foo)`,
          },
        },
      },
    });

    Bun.spawnSync([bunExe(), "install"], { cwd: dir, env, stdout: "inherit", stderr: "inherit" });
  });

  afterAll(() => {
    rmdirSync(dir, { recursive: true });
  });

  it("when target is imported from package 'bar', imports from the actual lib directory", () => {
    const { stdout, stderr, exitCode } = Bun.spawnSync(
      [bunExe(), "--config=./bunfig.toml", "packages/bar/src/index.js"],
      {
        cwd: dir,
        env,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    if (exitCode !== 0) {
      console.error(stderr.toString("utf8"));
    }
    expect(stdout.toString("utf8").trim()).toBe("1");
    expect(exitCode).toBe(0);
  });

  it("when tsconfig-paths is not disabled in bunfig.toml, fails to find 'imported'", () => {
    const { stderr, exitCode } = Bun.spawnSync([bunExe(), "src/index.js"], {
      cwd: join(dir, "packages", "bar"),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(exitCode).not.toBe(0);
    expect(stderr.toString("utf8")).toContain("Cannot find module './imported'");
  });
});
