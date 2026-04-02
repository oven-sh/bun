// https://github.com/oven-sh/bun/issues/11124
import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, tempDir } from "harness";

test("subshell stdout redirect to file", async () => {
  using dir = tempDir("issue-11124", {});

  await $`(echo hello) > test.txt`.env(bunEnv).cwd(String(dir));
  const content = await Bun.file(`${dir}/test.txt`).text();
  expect(content).toBe("hello\n");
});

test("subshell with multiple commands redirect to file", async () => {
  using dir = tempDir("issue-11124", {});

  await $`(echo 1; echo 2; echo 3) > out.txt`.env(bunEnv).cwd(String(dir));
  const content = await Bun.file(`${dir}/out.txt`).text();
  expect(content).toBe("1\n2\n3\n");
});

test("subshell append redirect to file", async () => {
  using dir = tempDir("issue-11124", {});

  await $`(echo first) > out.txt`.env(bunEnv).cwd(String(dir));
  await $`(echo second) >> out.txt`.env(bunEnv).cwd(String(dir));
  const content = await Bun.file(`${dir}/out.txt`).text();
  expect(content).toBe("first\nsecond\n");
});

test("subshell redirect with variable expansion in path", async () => {
  using dir = tempDir("issue-11124", {});

  await $`(echo works) > $OUTFILE`.env({ ...bunEnv, OUTFILE: "expanded.txt" }).cwd(String(dir));
  const content = await Bun.file(`${dir}/expanded.txt`).text();
  expect(content).toBe("works\n");
});
