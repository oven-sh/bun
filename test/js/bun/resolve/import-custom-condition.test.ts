import { it, expect, beforeAll } from "bun:test";
import { writeFileSync } from "fs";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";

let dir: string;

beforeAll(() => {
  dir = tempDirWithFiles("custom", {
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
  });

  writeFileSync(`${dir}/test.js`, `import {foo} from 'custom/test';\nconsole.log(foo);`);
  writeFileSync(
    `${dir}/package.json`,
    JSON.stringify(
      {
        name: "hello",
        imports: {
          custom: "custom",
        },
      },
      null,
      2,
    ),
  );
});

it("custom condition in package.json resolves", async () => {
  const { exitCode, stdout, stderr } = Bun.spawnSync({
    cmd: [bunExe(), "--conditions=customcondition", `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(stderr.toString("utf8")).toBe("");

  expect(exitCode).toBe(0);
  expect(stdout.toString("utf8")).toBe("1\n");
});

it("when not pass custom condition not resolves", async () => {
  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "--conditions=customcondition1", `${dir}/test.js`],
    env: bunEnv,
    cwd: import.meta.dir,
  });

  expect(exitCode).toBe(1);
});
