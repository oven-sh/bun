import { expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { dirname, join } from "path";
import { test } from "./supported";

// Where the declared type is an array, reading an element runs no getter and no trap of a Proxy under --aot. `bun run --aot` prints what is recorded of the executable.
const programs = join(import.meta.dir, "programs");

test.concurrent.each([
  "arrays/reading-an-element-that-is-a-getter",
  "arrays/reading-an-element-that-is-a-getter-says-why",
  "arrays/reading-an-element-that-is-a-getter-where-undefined-is-allowed",
  "type-rules/out-of-bounds-array-reads",
])("%s", async name => {
  const file = existsSync(join(programs, name + ".ts")) ? join(programs, name + ".ts") : join(programs, name, "main.ts");
  await using proc = Bun.spawn({ cmd: [bunExe(), "run", "--aot", file], cwd: dirname(file), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: readFileSync(join(programs, name + ".expected.txt"), "utf8"), exitCode: 0 });
});
