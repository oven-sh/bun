// A type that holds what no data can be, such as a function, a Date or a type parameter, cannot be given to `JSON.parse<T>()` or
// `Bun.validate<T>()`: the build stops and names the member. It stops too where a type argument stands on another spelling of the call.
import { expect } from "bun:test";
import { test } from "../supported";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

test.each([
  ['interface Meeting { title: string; when: Date }\nconsole.log(JSON.parse<Meeting>("{}"));', "Meeting.when: Date"],
  ['interface Handler { name: string; steps: { run: () => void }[] }\nconsole.log(JSON.parse<Handler>("{}"));', "Handler.steps[number].run: () => void"],
  ['function generic<T>(text: string): T { return JSON.parse<T>(text); }\nconsole.log(generic<number>("1"));', "T: T"],
  ['console.log(JSON.parse<{ id: symbol }>("{}"));', "{ id: symbol; }.id: symbol"],
  ['console.log(JSON.parse<[string, number?]>("[]"));', "[string, (number | undefined)?]"],
  ["console.log(Bun.validate<{ run: () => void }>({}));", "{ run: () => void; }.run: () => void"],
])("%s", async (program, named) => {
  using dir = tempDir("types-that-cannot-be-validated", { "program.ts": program });
  await using build = Bun.spawn({ cmd: [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", join(String(dir), "program")], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [said, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(said).toContain("a type that cannot be validated: " + named);
  expect(exitCode).toBe(1);
}, 120_000);

test.each([
  'console.log(globalThis.JSON.parse<number>("1"));',
  'const { parse } = JSON;\nconsole.log(parse<number>("1"));',
  'const parse = JSON.parse;\nconsole.log(parse<number>("1"));',
  "console.log(JSON.stringify<number>(1));",
])("only JSON.parse itself takes a type argument: %s", async program => {
  using dir = tempDir("type-argument-on-another-spelling", { "program.ts": program });
  await using build = Bun.spawn({ cmd: [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", join(String(dir), "program")], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [said, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(said).toContain("TS2558");
  expect(exitCode).toBe(1);
}, 120_000);
