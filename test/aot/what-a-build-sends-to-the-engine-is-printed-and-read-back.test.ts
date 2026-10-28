// `--aot-out` writes the program that a build sends to the engine, `testaot print` prints it, and the commands of testaot that take a program as it is read take that text.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, whySkipped } from "./engine-test-commands";
import { built, spawned, unsupported } from "./run-programs";

if (whySkipped)
  console.error(`SKIPPED: test/aot/what-a-build-sends-to-the-engine-is-printed-and-read-back.test.ts: ${whySkipped}`);

// The build removes the text under the test of NODE_ENV, which `bun run` keeps: behind the `await`, `loader` reads `local` in its place.
const program = `
const make = () => ({ n: 1 });
const loader = async () => {
  const local = make();
  await null;
  if (process.env.NODE_ENV !== "production") console.log(local.n);
  return 1;
};
console.log(await loader());
`;

function functionNamed(lines: string[], name: string): string[] {
  const first = lines.findIndex(line => line.startsWith("function ") && line.includes(` name="${name}"`));
  return first < 0 ? [] : lines.slice(first, lines.indexOf("}", first) + 1);
}

/** The program as `testaot print` prints it, and as a command that reads that text prints it again. */
async function printAndReadBack() {
  using folder = tempDir("aot-printed-and-read-back", { "program.mjs": program });
  const cwd = String(folder);
  built(
    await spawned(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--aot-out=program.wire",
        "--define",
        'process.env.NODE_ENV="production"',
        "./program.mjs",
        "--outfile",
        isWindows ? "program.exe" : "program",
      ],
      cwd,
      bunEnv,
    ),
  );
  const printed = await run("print", join(cwd, "program.wire"));
  expect({ stderr: printed.stderr, exitCode: printed.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  writeFileSync(join(cwd, "printed.ir"), ["# RUN: round-trip", ...printed.lines, ""].join("\n"));
  const readBack = await run("run", join(cwd, "printed.ir"), "--show-output");
  expect({ stderr: readBack.stderr, exitCode: readBack.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return { printed: printed.lines, readBack: readBack.lines };
}

test.skipIf(!!whySkipped || !!unsupported)(
  "a function that reads a local behind an await reads back as it was printed",
  async () => {
    const { printed, readBack } = await printAndReadBack();
    const loader = functionNamed(printed, "loader");
    const operations = loader.map(line => /^ +(?:v\d+ = )?(\w+)/.exec(line)?.[1]);
    expect(operations.indexOf("Await")).toBeGreaterThan(0);
    expect(operations.indexOf("ReadScope")).toBeGreaterThan(operations.indexOf("Await"));
    expect(functionNamed(readBack, "loader")).toEqual(loader);
  },
  240_000,
);

// TODO: a type that lists functions beside `function` is read back without them.
test.todo(
  "every line reads back as it was printed",
  async () => {
    const { printed, readBack } = await printAndReadBack();
    const first = readBack.indexOf(printed[0]);
    expect(readBack.slice(first, first + printed.length)).toEqual(printed);
  },
  240_000,
);
