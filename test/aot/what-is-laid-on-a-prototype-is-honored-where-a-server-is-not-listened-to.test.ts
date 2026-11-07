// A server that nobody listens to answers on shorter roads of the library, which ask first whether the members that they leave out are still the library's own.
// What a program lays on a prototype is noticed once and for all, so in a program of many cases only the first finds those roads open: here every case is a process of its own.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(170_000);

const program = join(
  import.meta.dir,
  "what-is-laid-on-a-prototype-is-honored-where-a-server-is-not-listened-to",
  "one-member-a-process.mjs",
);

test("each case prints what it prints under plain Bun", async () => {
  using directory = tempDir("one-member-a-process", {});
  const executable = join(String(directory), "one-member-a-process");
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", program, "--outfile", executable],
    String(directory),
  );
  expect(build).toMatchObject({ exitCode: 0 });

  const cases = (await run([bunExe(), program], String(directory))).stdout.trim().split("\n");
  expect(cases.length).toBeGreaterThan(100);
  const seen = async (command: string[], name: string) => {
    const { stdout, exitCode } = await run(command, String(directory), { ...bunEnv, CASE: name });
    return { stdout, exitCode };
  };
  const differing: unknown[] = [];
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const name = cases[next++];
      const [plain, compiled] = await Promise.all([seen([bunExe(), program], name), seen([executable], name)]);
      if (
        plain.exitCode !== 0 ||
        !plain.stdout.startsWith(name + "\n") ||
        compiled.stdout !== plain.stdout ||
        compiled.exitCode !== 0
      )
        differing.push({ name, plain, compiled });
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  expect(differing).toEqual([]);
});
