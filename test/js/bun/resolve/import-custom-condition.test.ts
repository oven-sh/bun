import { beforeAll, describe, expect, it } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir, tempDirWithFiles } from "harness";

let dir: string;

beforeAll(() => {
  dir = tempDirWithFiles("customcondition", {
    "./node_modules/custom/index.js": "export const foo = 1;",
    "./node_modules/custom/browser.js": "export const foo = 2;",
    "./node_modules/custom/not_allow.js": "throw new Error('should not be imported')",
    "./node_modules/custom/package.json": JSON.stringify({
      name: "custom",
      exports: {
        "./test": {
          first: "./index.js",
          browser: "./browser.js",
          default: "./not_allow.js",
        },
      },
    }),

    "./node_modules/custom2/index.cjs": "module.exports.foo = 5;",
    "./node_modules/custom2/index.mjs": "export const foo = 1;",
    "./node_modules/custom2/not_allow.js": "throw new Error('should not be imported')",
    "./node_modules/custom2/package.json": JSON.stringify({
      name: "custom2",
      exports: {
        "./test": {
          first: {
            import: "./index.mjs",
            require: "./index.cjs",
            default: "./index.mjs",
          },
          default: "./not_allow.js",
        },
        "./test2": {
          second: {
            import: "./index.mjs",
            require: "./index.cjs",
            default: "./index.mjs",
          },
          default: "./not_allow.js",
        },
        "./test3": {
          third: {
            import: "./index.mjs",
            require: "./index.cjs",
            default: "./index.mjs",
          },
          default: "./not_allow.js",
        },
      },
      type: "module",
    }),
  });

  writeFileSync(`${dir}/test.js`, `import {foo} from 'custom/test';\nconsole.log(foo);`);
  writeFileSync(`${dir}/test.test.js`, `import {foo} from 'custom/test';\nconsole.log(foo);`);
  writeFileSync(`${dir}/test.cjs`, `const {foo} = require("custom2/test");\nconsole.log(foo);`);
  writeFileSync(
    `${dir}/multiple-conditions.js`,
    `const pkg1 = require("custom2/test");\nconst pkg2 = require("custom2/test2");\nconst pkg3 = require("custom2/test3");\nconsole.log(pkg1.foo, pkg2.foo, pkg3.foo);`,
  );

  writeFileSync(
    `${dir}/package.json`,
    JSON.stringify(
      {
        name: "hello",
        imports: {
          custom: "custom",
          custom2: "custom2",
        },
      },
      null,
      2,
    ),
  );
});

it("custom condition 'import' in package.json resolves", async () => {
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "--conditions=first", `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("1\n");
});

it("custom condition 'import' in package.json resolves with browser condition", async () => {
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "--conditions=browser", `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("2\n");
});

it("custom condition 'import' in package.json resolves in bun test", async () => {
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "test", "--conditions=first", `${dir}/test.test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe(`bun test ${Bun.version_with_sha}\n1\n`);
});

it("custom condition 'import' in package.json resolves in bun test with browser condition", async () => {
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "test", "--conditions=browser", `${dir}/test.test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe(`bun test ${Bun.version_with_sha}\n2\n`);
});

it("custom condition 'require' in package.json resolves", async () => {
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "--conditions=first", `${dir}/test.cjs`],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("5\n");
});

it("multiple conditions in package.json resolves", async () => {
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "--conditions=first", "--conditions=second", "--conditions=third", `${dir}/multiple-conditions.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("5 5 5\n");
});

it("multiple conditions when some not specified should resolves to fallback", async () => {
  const { exitCode, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "--conditions=first", "--conditions=second", `${dir}/multiple-conditions.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(exitCode).toBe(1);

  // not_allow.js is the fallback for third condition, so it should be in stderr
  expect(stderr.toString("utf8")).toMatch("new Error('should not be imported')");
});

it("custom condition when don't match condition should resolves to default", async () => {
  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "--conditions=first1", `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(exitCode).toBe(1);
});

// https://github.com/oven-sh/bun/issues/7142
// When a package defines a "bun" export condition but the target file is absent
// (e.g. a Node-targeted file tracer such as Nitro/@vercel/nft only copied the
// "node" variant into .output/server/node_modules), Bun should fall through to
// the next matching condition instead of failing with "Cannot find package".
describe("'bun' export condition falls through when its target file is missing", () => {
  it.concurrent("falls through to 'node' condition (sibling package in node_modules)", async () => {
    using cwd = tempDir("bun-cond-fallback-node", {
      // Mirrors Nitro's traced .output layout: importer lives inside node_modules and
      // the dependency is a sibling whose "bun" target was pruned.
      "server/index.mjs": `import "ipx";`,
      "server/node_modules/ipx/package.json": JSON.stringify({
        name: "ipx",
        type: "module",
        exports: { ".": "./dist/index.mjs" },
      }),
      "server/node_modules/ipx/dist/index.mjs": `import { tag } from "ofetch"; console.log(tag);`,
      "server/node_modules/ofetch/package.json": JSON.stringify({
        name: "ofetch",
        type: "module",
        exports: {
          ".": {
            bun: "./dist/index.mjs",
            node: { import: "./dist/node.mjs", require: "./dist/node.cjs" },
            default: "./dist/index.mjs",
          },
        },
      }),
      // Only the "node" variant exists on disk; "./dist/index.mjs" was not traced.
      "server/node_modules/ofetch/dist/node.mjs": `export const tag = "node-variant";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "server/index.mjs"],
      env: bunEnv,
      cwd: String(cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("node-variant\n");
    expect(exitCode).toBe(0);
  });

  it.concurrent("falls through for wildcard subpath patterns", async () => {
    // Mirrors `openai`'s `./_shims/auto/*` subpath which has bun/node/default variants.
    using cwd = tempDir("bun-cond-fallback-wildcard", {
      "index.mjs": `import { tag } from "pkg/shims/auto/runtime"; console.log(tag);`,
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: {
          "./shims/auto/*": {
            bun: { default: "./shims/auto/*-bun.mjs" },
            node: { default: "./shims/auto/*-node.mjs" },
            default: "./shims/auto/*.mjs",
          },
        },
      }),
      // Only the "node" variant was traced; "*-bun.mjs" does not exist.
      "node_modules/pkg/shims/auto/runtime-node.mjs": `export const tag = "node-variant";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("node-variant\n");
    expect(exitCode).toBe(0);
  });

  it.concurrent("falls through when the subpath only resolves after stripping '.js'", async () => {
    // Exercises the retry around the existing "./foo.js" -> "./foo" exports fallback.
    using cwd = tempDir("bun-cond-fallback-strip-js", {
      "index.mjs": `import { tag } from "pkg/foo.js"; console.log(tag);`,
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: {
          "./foo": {
            bun: "./dist/foo-bun.mjs",
            node: "./dist/foo-node.mjs",
          },
        },
      }),
      "node_modules/pkg/dist/foo-node.mjs": `export const tag = "node-variant";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("node-variant\n");
    expect(exitCode).toBe(0);
  });

  it.concurrent("falls through for subpath '#imports' entries", async () => {
    using cwd = tempDir("bun-cond-fallback-imports", {
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: { ".": "./index.mjs" },
        imports: {
          "#fetch": {
            bun: "./src/fetch-bun.mjs",
            node: "./src/fetch-node.mjs",
          },
        },
      }),
      "node_modules/pkg/index.mjs": `import { tag } from "#fetch"; console.log(tag);`,
      "node_modules/pkg/src/fetch-node.mjs": `export const tag = "node-variant";`,
      "index.mjs": `import "pkg";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("node-variant\n");
    expect(exitCode).toBe(0);
  });

  it.concurrent("falls through when the 'bun' '#imports' target is a missing bare package", async () => {
    using cwd = tempDir("bun-cond-fallback-imports-bare-first", {
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: { ".": "./index.mjs" },
        imports: {
          "#helper": {
            bun: "bun-only-helper",
            node: "./src/helper-node.mjs",
          },
        },
      }),
      "node_modules/pkg/index.mjs": `import { tag } from "#helper"; console.log(tag);`,
      "node_modules/pkg/src/helper-node.mjs": `export const tag = "node-variant";`,
      "index.mjs": `import "pkg";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("node-variant\n");
    expect(exitCode).toBe(0);
  });

  it.concurrent("falls through for '#imports' targeting a bare package specifier", async () => {
    using cwd = tempDir("bun-cond-fallback-imports-bare", {
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: { ".": "./index.mjs" },
        imports: {
          "#fetch": {
            bun: "./src/fetch-bun.mjs",
            node: "polyfill-pkg",
          },
        },
      }),
      "node_modules/pkg/index.mjs": `import { tag } from "#fetch"; console.log(tag);`,
      "node_modules/polyfill-pkg/package.json": JSON.stringify({
        name: "polyfill-pkg",
        type: "module",
        exports: { ".": "./index.mjs" },
      }),
      "node_modules/polyfill-pkg/index.mjs": `export const tag = "polyfill";`,
      "index.mjs": `import "pkg";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("polyfill\n");
    expect(exitCode).toBe(0);
  });

  it.concurrent("falls through to 'node' condition for require()", async () => {
    using cwd = tempDir("bun-cond-fallback-require", {
      "index.cjs": `console.log(require("pkg").tag);`,
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        exports: {
          ".": {
            bun: "./dist/bun.cjs",
            node: "./dist/node.cjs",
          },
        },
      }),
      "node_modules/pkg/dist/node.cjs": `module.exports.tag = "node-variant";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("node-variant\n");
    expect(exitCode).toBe(0);
  });

  it.concurrent("prefers the 'bun' condition when its target file exists", async () => {
    using cwd = tempDir("bun-cond-prefer-bun", {
      "index.mjs": `import { tag } from "pkg"; console.log(tag);`,
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: {
          ".": {
            bun: "./dist/bun.mjs",
            node: "./dist/node.mjs",
            default: "./dist/node.mjs",
          },
        },
      }),
      "node_modules/pkg/dist/bun.mjs": `export const tag = "bun-variant";`,
      "node_modules/pkg/dist/node.mjs": `export const tag = "node-variant";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("bun-variant\n");
    expect(exitCode).toBe(0);
  });

  it.concurrent("does not fall through for an explicit 'bun': null disable", async () => {
    using cwd = tempDir("bun-cond-null-disable", {
      "index.mjs": `import "pkg"; console.log("loaded");`,
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: {
          ".": {
            bun: null,
            default: "./dist/node.mjs",
          },
        },
      }),
      "node_modules/pkg/dist/node.mjs": `export {};`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Cannot find package 'pkg'");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  it.concurrent("retry armed by one entry does not bypass 'bun': null in another", async () => {
    // "./foo.js" arms the retry (bun target missing); the ".js"-stripped "./foo" entry
    // has an explicit bun: null, which must still block on the second pass.
    using cwd = tempDir("bun-cond-null-other-entry", {
      "index.mjs": `import "pkg/foo.js"; console.log("loaded");`,
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: {
          "./foo.js": { bun: "./dist/missing.mjs" },
          "./foo": { bun: null, default: "./dist/default.mjs" },
        },
      }),
      "node_modules/pkg/dist/default.mjs": `export {};`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Cannot find module 'pkg/foo.js'");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  it.concurrent("still fails when no other condition resolves to an existing file", async () => {
    using cwd = tempDir("bun-cond-no-fallback", {
      "index.mjs": `import "pkg";`,
      "node_modules/pkg/package.json": JSON.stringify({
        name: "pkg",
        type: "module",
        exports: {
          ".": {
            bun: "./dist/missing.mjs",
            default: "./dist/missing.mjs",
          },
        },
      }),
      "node_modules/pkg/dist/.keep": "",
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(cwd),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("Cannot find package 'pkg'");
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });
});
