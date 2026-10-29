// One program, one compiler, one source text: ./typed-packages/small-renderer/terminal.ts on the package small-renderer, which names its TypeScript under the "aot" condition.
// It is built as it is written and built again with --aot-erase-types. A type is knowledge. Code that has it may not cost more than the same code without it: not in instructions a turn, not in bytes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isArm64, isASAN, isDebug, isLinux, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { countTurn, functionsOf, manyTurns, type Turn } from "./impostors-keep-their-fast-paths/look";
import { whyInstructionsCannotBeCounted } from "./instruction-counts/count-instructions";
import { installSmallRenderer } from "./typed-packages/small-renderer/install";

const whyNotCounted = unsupported
  ? ""
  : isASAN || isDebug
    ? "the counts are those of a release build"
    : await whyInstructionsCannotBeCounted();

// A turn of the build costs 0.96 times the instructions of the erased build. The build has 1.10 times its bytes. The code of the package has 1.11 times its bytes on x64 and
// 1.18 times on ARM64, where a type test takes more bytes. No share may pass these. The bytes belong at 1 or below: the two todo tests.
const known = { instructionsOfATurn: 1, bytesOfCode: 1.12, bytesOfPackage: isArm64 ? 1.2 : 1.12 };
// The bytes of code are whole pages of the image and the constants behind them.
const pageOfImage = (isLinux && isArm64 ? 64 : 16) * 1024;

/** The bytes of each function that is compiled from the package's file, by the map file. Every version of a function counts under its name. */
function bytesOfPackage(map: string) {
  const bytes = new Map<string, number>();
  for (const line of map.split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === "F" && /small-renderer.+index\.aot\.ts$/.test(fields[10]))
      bytes.set(fields[7], (bytes.get(fields[7]) ?? 0) + Number(fields[3]));
  }
  return bytes;
}

describe.skipIf(!!unsupported)("compile/aot/typed-package-costs-no-more-than-erased", () => {
  let folder = "";
  const seen: Record<"typed" | "erased", { turn?: Turn; bytesOfCode: number; bytesOfPackage: Map<string, number> }> = {
    typed: { bytesOfCode: 0, bytesOfPackage: new Map() },
    erased: { bytesOfCode: 0, bytesOfPackage: new Map() },
  };
  afterAll(() => folder && rmSync(folder, { recursive: true, force: true }));

  beforeAll(
    () =>
      slot(async () => {
        folder = String(tempDir("aot-typed-package-costs", {}));
        // An `int32` says more than any type that TypeScript has. ./int32-lanes-cost-less-than-numbers.test.ts asks what it buys.
        installSmallRenderer(folder, typed => {
          expect(typed).toContain(`import type { int32 } from "bun";`);
          return typed.replace(`import type { int32 } from "bun";`, "type int32 = number;");
        });

        for (const [way, flags] of [
          ["typed", []],
          ["erased", ["--aot-erase-types"]],
        ] as const) {
          const map = join(folder, way + ".map"),
            report = join(folder, way + ".json");
          const build = await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              ...flags,
              `--aot-report=${report}`,
              "--outfile",
              way,
              "terminal.ts",
            ],
            folder,
            { ...bunEnv, BUN_JSC_aotMapFilePath: map },
          );
          built(build);
          expect(build.stdout + build.stderr).not.toMatch(/compiled (untyped|without (its |their )?types)/);
          const { summary, statistics } = JSON.parse(readFileSync(report, "utf8"));
          expect(statistics.AotFilesUsed).toBe(1);
          seen[way].bytesOfCode = summary.codeBytes;
          seen[way].bytesOfPackage = bytesOfPackage(readFileSync(map, "utf8"));
          if (!whyNotCounted)
            seen[way].turn = await countTurn(
              bunExe(),
              join(folder, way),
              functionsOf(readFileSync(map, "utf8")),
              way,
              bunEnv,
              manyTurns,
            );
        }
      }),
    600_000,
  );

  const instructionsOf = (turn: Turn) => turn.compiled + turn.outside;
  function expectAtMost(typed: number, erased: number, share: number, where: string[] = []) {
    expect({ typed, erased, where, isKept: typed <= erased * share }).toEqual({ typed, erased, where, isKept: true });
  }
  function sharesOf(turn: Turn) {
    return new Map(
      turn.shares.map(share => [
        share.slice(0, share.lastIndexOf(" ")),
        Number(share.slice(share.lastIndexOf(" ") + 1)),
      ]),
    );
  }
  const sumOf = (numbers: Map<string, number>) => numbers.values().reduce((sum, number) => sum + number, 0);
  function whereTypesCostMost(typed: Map<string, number>, erased: Map<string, number>) {
    return [...new Set([...typed.keys(), ...erased.keys()])]
      .map(where => ({ where, typed: typed.get(where) ?? 0, erased: erased.get(where) ?? 0 }))
      .sort((a, b) => b.typed - b.erased - (a.typed - a.erased))
      .slice(0, 16)
      .map(row => `${row.where}: ${row.typed} typed, ${row.erased} erased`);
  }

  test.skipIf(!!whyNotCounted)("both print what plain Bun prints", async () => {
    const { before, fewer, more } = manyTurns;
    const plain = await spawned(
      [bunExe(), "run", "terminal.ts", "plain", ...[...before, fewer, more].map(String)],
      folder,
      bunEnv,
    );
    expect(plain.stdout).toStartWith("110 111 <root><screen><transcript><message plain><gutter>22</gutter>");
    expect(seen.typed.turn!.stdout).toBe(plain.stdout);
    expect(seen.erased.turn!.stdout).toBe(plain.stdout);
  });

  test.skipIf(!!whyNotCounted)("the instructions of a turn have not risen against the erased build", () =>
    expectAtMost(
      instructionsOf(seen.typed.turn!),
      instructionsOf(seen.erased.turn!),
      known.instructionsOfATurn,
      whereTypesCostMost(sharesOf(seen.typed.turn!), sharesOf(seen.erased.turn!)),
    ),
  );
  test("the bytes of code have not risen against the erased build", () =>
    expectAtMost(seen.typed.bytesOfCode - pageOfImage, seen.erased.bytesOfCode, known.bytesOfCode));
  test("the bytes of the package's code have not risen against the erased build", () =>
    expectAtMost(
      sumOf(seen.typed.bytesOfPackage),
      sumOf(seen.erased.bytesOfPackage),
      known.bytesOfPackage,
      whereTypesCostMost(seen.typed.bytesOfPackage, seen.erased.bytesOfPackage),
    ));

  test.todo("the program is no larger with its types than without them", () =>
    expectAtMost(seen.typed.bytesOfCode, seen.erased.bytesOfCode, 1),
  );
  test.todo("the package's code is no larger with its types than without them", () =>
    expectAtMost(sumOf(seen.typed.bytesOfPackage), sumOf(seen.erased.bytesOfPackage), 1),
  );
});
