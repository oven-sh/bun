// A type that holds what no data can be, such as a function, a Date or a type parameter, cannot be validated: the build stops and
// names the member.
import { expect } from "bun:test";
import { test } from "../supported";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

test.each([
  ["interface Meeting { title: string; when: Date }\nconsole.log(Bun.validate<Meeting>({}));", "Meeting.when: Date"],
  ["interface Handler { name: string; steps: { run: () => void }[] }\nconsole.log(Bun.safeValidate<Handler>({}));", "Handler.steps[number].run: () => void"],
  ["function generic<T>(value: unknown): T { return Bun.validate<T>(value); }\nconsole.log(generic<number>(1));", "T: T"],
  ['console.log(Bun.parse<{ id: symbol }>("{}"));', "{ id: symbol; }.id: symbol"],
  ["console.log(Bun.schema<[string, number?]>());", "[string, (number | undefined)?]"],
])("%s", async (program, named) => {
  using dir = tempDir("types-that-cannot-be-validated", { "program.ts": program });
  await using build = Bun.spawn({ cmd: [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", join(String(dir), "program")], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [said, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(said).toContain("a type that cannot be validated: " + named);
  expect(exitCode).toBe(1);
}, 120_000);
