import { it, expect, beforeAll } from "bun:test";
import { writeFileSync } from "fs";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";

let dir: string;

beforeAll(() => {
  dir = tempDirWithFiles("customcondition", {
    "./node_modules/custom/index.js": "export const foo = 1;",
    "./node_modules/custom/not_allow.js": "throw new Error('should not be imported')",
    "./node_modules/custom/package.json": JSON.stringify({
      name: "custom",
      exports: {
        "./test": {
          customcondition: "./index.js",
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
          customcondition: {
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

it("custom condition in package.json resolves", async () => {
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "--conditions=customcondition", `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("1\n");
});

it("custom condition require in package.json resolves", async () => {
  const { exitCode, stdout } = Bun.spawnSync({
    cmd: [bunExe(), "-c=customcondition", `${dir}/test.cjs`],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("5\n");
});

it("when not pass custom condition not resolves", async () => {
  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "--conditions=customcondition1", `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(exitCode).toBe(1);
});
