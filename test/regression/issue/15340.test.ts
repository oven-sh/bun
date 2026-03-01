import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/15340
// Bun shell should preserve empty string arguments specified with '' or ""

const printArgs = `process.argv.slice(2).forEach((a, i) => console.log("arg" + i + "=" + JSON.stringify(a)));`;

test("single-quoted empty string arguments are preserved", async () => {
  using dir = tempDir("issue-15340", {
    "print_args.ts": printArgs,
  });

  const { stdout, exitCode } = await $`${bunExe()} run ${dir}/print_args.ts -N '' -C ''`.env(bunEnv);
  const output = stdout.toString().trim();
  expect(output).toBe('arg0="-N"\narg1=""\narg2="-C"\narg3=""');
  expect(exitCode).toBe(0);
});

test("double-quoted empty string arguments are preserved", async () => {
  using dir = tempDir("issue-15340", {
    "print_args.ts": printArgs,
  });

  const { stdout, exitCode } = await $`${bunExe()} run ${dir}/print_args.ts -N "" -C ""`.env(bunEnv);
  const output = stdout.toString().trim();
  expect(output).toBe('arg0="-N"\narg1=""\narg2="-C"\narg3=""');
  expect(exitCode).toBe(0);
});

test("empty string as sole argument is preserved", async () => {
  using dir = tempDir("issue-15340", {
    "count_args.ts": `console.log(process.argv.length - 2);`,
  });

  const { stdout, exitCode } = await $`${bunExe()} run ${dir}/count_args.ts ''`.env(bunEnv);
  expect(stdout.toString().trim()).toBe("1");
  expect(exitCode).toBe(0);
});

test("multiple consecutive empty strings are preserved", async () => {
  using dir = tempDir("issue-15340", {
    "count_args.ts": `console.log(process.argv.length - 2);`,
  });

  const { stdout, exitCode } = await $`${bunExe()} run ${dir}/count_args.ts '' '' ''`.env(bunEnv);
  expect(stdout.toString().trim()).toBe("3");
  expect(exitCode).toBe(0);
});

test("mixed empty and non-empty arguments", async () => {
  using dir = tempDir("issue-15340", {
    "print_args.ts": printArgs,
  });

  const { stdout, exitCode } = await $`${bunExe()} run ${dir}/print_args.ts hello '' world "" end`.env(bunEnv);
  const output = stdout.toString().trim();
  expect(output).toBe('arg0="hello"\narg1=""\narg2="world"\narg3=""\narg4="end"');
  expect(exitCode).toBe(0);
});
