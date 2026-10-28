// `Box<T>` holds a `Box<[T]>`: a family of types that never ends, which the compiler follows for a few steps. One file writes
// `Box<[[[number]]]>` out, another makes the same type by instantiation, and which of the two threads comes first differs from
// run to run. How far the family is followed does not: same bytes, whatever the number of threads.
import { expect, setDefaultTimeout } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(240_000);

// Work for the checker in front of the type that is written out, so that neither thread always comes first.
const work =
  `type Repeat<N extends number, M, A extends unknown[] = []> = A["length"] extends N ? A : Repeat<N, M, [...A, M]>;\n` +
  Array.from({ length: 10 }, (_, index) => `export type Work${index} = Repeat<900, ${index}>;\n`).join("");

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "esnext",
      module: "esnext",
      moduleResolution: "bundler",
      noEmit: true,
      types: [],
    },
  }),
  "shared.ts": `export interface Box<T> { v: T; next: Box<[T]> | null }\nexport interface Crate<T> { v: T; next: Crate<[T]> | null }\n`,
  "compared.ts":
    `import type { Box, Crate } from "./shared";\n${work}` +
    `export function depth(x: Box<[[[number]]]>): unknown { return x.v; }\n` +
    `export function convert(b: Box<number>): Crate<number> { return b; }\n`,
  "instantiated.ts":
    `import type { Box } from "./shared";\ninterface Maker<T> { make(): Box<[[[T]]]> }\n` +
    `export function other(maker: Maker<number>): unknown { return maker.make().v; }\n`,
  "main.ts":
    `import { convert, depth } from "./compared";\nimport { other } from "./instantiated";\n` +
    `declare const console: { log(...values: unknown[]): void };\n` +
    `const deep = { v: [[[1]]] as [[[number]]], next: null };\n` +
    `console.log(depth(deep), other({ make: () => deep }), convert({ v: 1, next: null }).v);\n`,
};

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

test("which thread is the first to make a type changes neither the emitted program nor the executable", async () => {
  using dir = tempDir("aot-same-program", files);
  const first = await build(String(dir), 1, 0);
  for (const [round, threads] of [8, 8, 8, 8, 16, 16, 16, 16].entries()) {
    expect({ threads, ...(await build(String(dir), threads, round)) }).toEqual({ threads, ...first });
  }
});
