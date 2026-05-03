import { pathToFileURL } from "bun";
import { describe, expect, it } from "bun:test";
import { chmodSync, chownSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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

  it.skipIf(!canTriggerEACCES)(
    "resolving a directory whose entries cache holds .err does not crash",
    async () => {
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
    },
  );
}
