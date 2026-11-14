import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// `Bun` lists a member from when it is first read, and a copy adds all that nobody has read yet behind those.
test.each([
  ["node:cluster", "isMainThread"],
  ["bun:test", "jest"],
])("require() of %s under a computed name reads Bun.%s", (name, member) => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      "require(process.argv.at(-1)); const { ...copy } = Bun; console.log(Reflect.ownKeys(Bun)[0]); process.exit(0);",
      name,
    ],
    env: bunEnv,
    stderr: "inherit",
  });
  expect(stdout.toString().trim()).toBe(member);
  expect(exitCode).toBe(0);
});
