// A build asks the type checker questions that no check asks, such as the type of a member that the program never reads. Where
// such a question ends at a limit of the checker (here: 100 instantiations inside one another), the answer depends on what that
// checker has computed before. The program that the front end emits must not: same bytes, whatever the number of threads and
// whichever thread gets where first.
//
// Each of twelve files always meets the limit (`Reversed` of 400 elements), so its task is thrown away and it waits for the last
// round. Each also asks for four types that are within the limit only for a checker that knows what the file in front of it has
// asked for: ten elements more of the same tuple.
import { expect, setDefaultTimeout } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(240_000);

const fileCount = 12;
const step = 10;
const families = ["A", "B", "C", "D"];

const tupleOf = (element: number, length: number) => `[${Array(length).fill(element).join(", ")}]`;
const lengthOf = (file: number, family: number) => step * (file + family);

function typesModule(): string {
  const lines = [
    `export type Reversed<T extends unknown[]> = T extends [infer First, ...infer Rest] ? [...Reversed<Rest>, First] : [];`,
    `export type TooLong = ${tupleOf(9, 400)};`,
  ];
  for (let file = 1; file <= fileCount; file++) {
    families.forEach((name, family) =>
      lines.push(`export type ${name}${lengthOf(file, family)} = ${tupleOf(family, lengthOf(file, family))};`),
    );
  }
  return lines.join("\n") + "\n";
}

// `first` is asked about while the body of the module is lowered, `second` behind it.
function codeModule(file: number, limitComesFirst: boolean): string {
  const names = families.map((name, family) => `${name}${lengthOf(file, family)}`);
  const withinLimit = `Within${file}<${names.join(", ")}>`;
  const overLimit = `Over${file}<TooLong>`;
  const [first, second] = limitComesFirst ? [overLimit, withinLimit] : [withinLimit, overLimit];
  const interfaces = [
    `interface Over${file}<T extends unknown[]> { over${file}: Reversed<T> }\n`,
    `interface Within${file}<A extends unknown[], B extends unknown[], C extends unknown[], D extends unknown[]> ` +
      `{ a${file}: Reversed<A>; b${file}: Reversed<B>; c${file}: Reversed<C>; d${file}: Reversed<D> }\n`,
  ];
  return (
    `import type { Reversed, TooLong, ${names.join(", ")} } from "./types.ts";\n` +
    (limitComesFirst ? interfaces : interfaces.reverse()).join("") +
    `const first: ${first} = JSON.parse("{}");\n` +
    `export function read${file}(text: string): number {\n  const second: ${second} = JSON.parse(text);\n  return second === null ? 0 : 1;\n}\n` +
    `export const kept${file}: number = first === null ? 0 : 1;\n`
  );
}

function program(limitComesFirst: boolean): Record<string, string> {
  const indices = Array.from({ length: fileCount }, (_, index) => index + 1);
  const files: Record<string, string> = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "esnext",
        module: "esnext",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        noEmit: true,
        types: [],
      },
    }),
    "types.ts": typesModule(),
    "main.ts":
      indices.map(file => `import { read${file}, kept${file} } from "./file${file}.ts";\n`).join("") +
      `declare const console: { log(...values: unknown[]): void };\n` +
      `console.log(${indices.map(file => `read${file}("{}") + kept${file}`).join(" + ")});\n`,
  };
  for (const file of indices) files[`file${file}.ts`] = codeModule(file, limitComesFirst);
  return files;
}

async function build(directory: string, threads: number, round: number) {
  const name = `threads-${threads}-${round}`;
  const { stderr, exitCode } = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `--aot-threads=${threads}`,
      `--aot-out=${name}.program`,
      "main.ts",
      "--outfile",
      "app",
    ],
    directory,
  );
  expect({ errors: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    errors: [],
    exitCode: 0,
  });
  return {
    program: Bun.hash(await Bun.file(join(directory, `${name}.program`)).bytes()),
    executable: Bun.hash(await Bun.file(join(directory, isWindows ? "app.exe" : "app")).bytes()),
  };
}

// Which files shared a checker behind the last round was a matter of the number of threads.
test("files that meet a limit at once: the number of threads changes neither the emitted program nor the executable", async () => {
  using dir = tempDir("aot-same-program-at-a-limit", program(true));
  const first = await build(String(dir), 1, 0);
  for (const [round, threads] of [2, 8, 8, 16].entries()) {
    expect({ threads, ...(await build(String(dir), threads, round)) }).toEqual({ threads, ...first });
  }
});

// What a task has found out before it meets the limit is published at once and stays when the task is thrown away. Which of the
// other tasks found it in time was a matter of timing: two builds with eight threads differed.
test("files that meet a limit late: the number of threads changes neither the emitted program nor the executable", async () => {
  using dir = tempDir("aot-same-program-behind-a-limit", program(false));
  const first = await build(String(dir), 1, 0);
  for (const [round, threads] of [2, 8, 8, 8, 16].entries()) {
    expect({ threads, ...(await build(String(dir), threads, round)) }).toEqual({ threads, ...first });
  }
});
