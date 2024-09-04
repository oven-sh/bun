import { beforeAll, expect, it } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

let dir: string;

beforeAll(() => {
  dir = tempDirWithFiles("customcondition", {
    "./node_modules/custom/index.js": "export const foo = 1;",
    "./node_modules/custom/not_allow.js": "throw new Error('should not be imported')",
    "./node_modules/custom/package.json": JSON.stringify({
      name: "custom",
      exports: {
        "./test": {
          first: "./index.js",
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
