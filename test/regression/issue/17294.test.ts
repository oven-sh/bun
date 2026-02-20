import { $ } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/17294
// Empty string arguments should be passed through, not silently dropped.

test("empty string interpolation passes empty arg", async () => {
  const result = await $`${bunExe()} -e "console.log(JSON.stringify(process.argv.slice(1)))" -- ${""}`
    .env(bunEnv)
    .text();
  expect(JSON.parse(result.trim())).toEqual([""]);
});

test("double-quoted empty string passes empty arg", async () => {
  const result = await $`${bunExe()} -e "console.log(JSON.stringify(process.argv.slice(1)))" -- ""`.env(bunEnv).text();
  expect(JSON.parse(result.trim())).toEqual([""]);
});

test("single-quoted empty string passes empty arg", async () => {
  const result = await $`${bunExe()} -e "console.log(JSON.stringify(process.argv.slice(1)))" -- ''`.env(bunEnv).text();
  expect(JSON.parse(result.trim())).toEqual([""]);
});

test("non-empty string still works (control)", async () => {
  const result = await $`${bunExe()} -e "console.log(JSON.stringify(process.argv.slice(1)))" -- ${"hello"}`
    .env(bunEnv)
    .text();
  expect(JSON.parse(result.trim())).toEqual(["hello"]);
});

test("multiple empty strings", async () => {
  const result = await $`${bunExe()} -e "console.log(JSON.stringify(process.argv.slice(1)))" -- ${""} ${""}`
    .env(bunEnv)
    .text();
  expect(JSON.parse(result.trim())).toEqual(["", ""]);
});

test("empty string between non-empty strings", async () => {
  const result = await $`${bunExe()} -e "console.log(JSON.stringify(process.argv.slice(1)))" -- ${"a"} ${""} ${"b"}`
    .env(bunEnv)
    .text();
  expect(JSON.parse(result.trim())).toEqual(["a", "", "b"]);
});
