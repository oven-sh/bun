// A type that holds what no data can be, such as a function, a Date or a type parameter, cannot be given to `JSON.parse<T>()` or
// `validate<T>()`: the build stops and names the member. It stops too where a type argument stands on a function that takes none.
// Another spelling of `JSON.parse` is the same function, so it validates as well.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../harness/run";
import { test } from "../supported";

test.each([
  [
    'interface Meeting { title: string; when: Date }\nconsole.log(JSON.parse<Meeting>("{}"));',
    "JSON.parse<Meeting>() cannot validate 'when: Date'. Only types that JSON can represent can be validated.",
  ],
  [
    'interface Handler { name: string; steps: { run: () => void }[] }\nconsole.log(JSON.parse<Handler>("{}"));',
    "JSON.parse<Handler>() cannot validate 'steps[number].run: () => void'.",
  ],
  [
    'function generic<T>(text: string): T { return JSON.parse<T>(text); }\nconsole.log(generic<number>("1"));',
    "'T' is a type parameter here, so there is no type to validate against.",
  ],
  ['console.log(JSON.parse<{ id: symbol }>("{}"));', "JSON.parse<{ id: symbol; }>() cannot validate 'id: symbol'."],
  [
    'console.log(JSON.parse<[string, number?]>("[]"));',
    "JSON.parse<[string, (number | undefined)?]>() cannot validate '[string, (number | undefined)?]'.",
  ],
  [
    'import { validate } from "bun:bundle";\nconsole.log(validate<{ run: () => void }>({}));',
    "validate<{ run: () => void; }>() cannot validate 'run: () => void'.",
  ],
])(
  "%s",
  async (program, message) => {
    using dir = tempDir("types-that-cannot-be-validated", { "program.ts": program });
    const { stderr: said, exitCode } = await run(
      [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", join(String(dir), "program")],
      String(dir),
    );
    expect(said).toContain(message);
    expect(exitCode).toBe(1);
  },
  120_000,
);

test("no other function of JSON takes a type argument", async () => {
  using dir = tempDir("type-argument-on-another-function", { "program.ts": "console.log(JSON.stringify<number>(1));" });
  const { stderr: said, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", join(String(dir), "program")],
    String(dir),
  );
  expect(said).toContain("TS2558");
  expect(exitCode).toBe(1);
}, 120_000);

test.each([
  ["", "globalThis.JSON.parse"],
  ["const { parse } = JSON;", "parse"],
  ["const parse = JSON.parse;", "parse"],
])(
  "another spelling of JSON.parse validates too: %s %s",
  async (declaration, parse) => {
    const program = `declare const console: { log(...values: unknown[]): void };
${declaration}
console.log(${parse}<number>("1"));
try {
  console.log(${parse}<number>('"text"'));
} catch (error) {
  console.log(String(error));
}
`;
    using dir = tempDir("type-argument-on-another-spelling", { "program.ts": program });
    const executable = join(String(dir), isWindows ? "program.exe" : "program");
    const { stderr: said, exitCode: buildExitCode } = await run(
      [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", executable],
      String(dir),
    );
    expect({ said: buildExitCode ? said : "", buildExitCode }).toEqual({ said: "", buildExitCode: 0 });
    const { stdout, exitCode } = await run([executable], String(dir));
    expect({ stdout, exitCode }).toEqual({ stdout: "1\nTypeError: expected number, received string\n", exitCode: 0 });
  },
  120_000,
);
