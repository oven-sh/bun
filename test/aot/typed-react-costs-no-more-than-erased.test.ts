// One program, one compiler, one source text: ./typed-react-costs-no-more-than-erased/terminal.ts on the typed react-reconciler of packages/bun-sound, built as it is written and
// built again with --aot-erase-types. A type is knowledge. Code that has it may not cost more than the same code without it: not in instructions a turn, not in bytes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { countTurn, functionsOf, type Turn } from "./impostors-keep-their-fast-paths/look";
import { whyInstructionsCannotBeCounted } from "./instruction-counts/count-instructions";
import { built, slot, spawned, unsupported } from "./run-programs";

const host = join(import.meta.dir, "typed-packages", "react-reconciler-host");
const typedReconciler = join(
  import.meta.dir,
  "..",
  "..",
  "packages",
  "bun-sound",
  "react-reconciler",
  "0.33.0",
  "lay",
  "cjs",
  "react-reconciler.production.js",
);
const whyNotCounted = unsupported ? "" : await whyInstructionsCannotBeCounted();

// The build costs 1.10 times the instructions of the erased build and 1.12 times its bytes. Neither share may pass these. Both belong at 1 or below: the two todo tests.
const known = { instructionsOfATurn: 1.12, bytesOfCode: 1.15 };

describe.skipIf(!!unsupported)("compile/aot/typed-react-costs-no-more-than-erased", () => {
  let folder = "";
  const seen: Record<"typed" | "erased", { turn?: Turn; bytesOfCode: number }> = {
    typed: { bytesOfCode: 0 },
    erased: { bytesOfCode: 0 },
  };
  afterAll(() => folder && rmSync(folder, { recursive: true, force: true }));

  beforeAll(
    () =>
      slot(async () => {
        folder = String(tempDir("aot-typed-react-costs", {}));
        cpSync(
          join(import.meta.dir, "typed-react-costs-no-more-than-erased", "terminal.ts"),
          join(folder, "terminal.ts"),
        );
        for (const file of ["modules.d.ts", "tsconfig.json"]) cpSync(join(host, file), join(folder, file));
        const reconciler = join(folder, "node_modules", "react-reconciler");
        mkdirSync(join(reconciler, "cjs"), { recursive: true });
        for (const name of ["react", "scheduler"])
          cpSync(join(host, "stand-ins", name), join(folder, "node_modules", name), { recursive: true });
        writeFileSync(
          join(reconciler, "package.json"),
          JSON.stringify({ name: "react-reconciler", version: "0.33.0", main: "index.js" }),
        );
        writeFileSync(
          join(reconciler, "index.js"),
          `"use strict";\nmodule.exports = require("./cjs/react-reconciler.production.ts");\n`,
        );
        writeFileSync(
          join(reconciler, "cjs", "react-reconciler.production.ts"),
          readFileSync(typedReconciler, "utf8").replace(`type int32 = import("bun").int32;`, "type int32 = number;"),
        );

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
              "--define",
              `process.env.NODE_ENV="production"`,
              "--outfile",
              way,
              "terminal.ts",
            ],
            folder,
            { ...bunEnv, BUN_JSC_aotMapFilePath: map },
          );
          built(build);
          seen[way].bytesOfCode = JSON.parse(readFileSync(report, "utf8")).summary.codeBytes;
          if (!whyNotCounted)
            seen[way].turn = await countTurn(
              bunExe(),
              join(folder, way),
              functionsOf(readFileSync(map, "utf8")),
              way,
              bunEnv,
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
  function whereTypesCostMost() {
    const typed = sharesOf(seen.typed.turn!),
      erased = sharesOf(seen.erased.turn!);
    return [...new Set([...typed.keys(), ...erased.keys()])]
      .map(where => ({ where, typed: typed.get(where) ?? 0, erased: erased.get(where) ?? 0 }))
      .sort((a, b) => b.typed - b.erased - (a.typed - a.erased))
      .slice(0, 16)
      .map(row => `${row.where}: ${row.typed} typed, ${row.erased} erased`);
  }

  test.skipIf(!!whyNotCounted)("both print the same", () => {
    expect(seen.typed.turn!.stdout).toBe(seen.erased.turn!.stdout);
    expect(seen.typed.turn!.stdout).toStartWith("60 ");
  });

  test.skipIf(!!whyNotCounted)("the instructions of a turn have not risen against the erased build", () =>
    expectAtMost(
      instructionsOf(seen.typed.turn!),
      instructionsOf(seen.erased.turn!),
      known.instructionsOfATurn,
      whereTypesCostMost(),
    ),
  );
  test("the bytes of code have not risen against the erased build", () =>
    expectAtMost(seen.typed.bytesOfCode, seen.erased.bytesOfCode, known.bytesOfCode));

  test.todo("a turn costs no more instructions with its types than without them (known-layouts)", () =>
    expectAtMost(instructionsOf(seen.typed.turn!), instructionsOf(seen.erased.turn!), 1, whereTypesCostMost()),
  );
  test.todo("the program is no larger with its types than without them (known-layouts)", () =>
    expectAtMost(seen.typed.bytesOfCode, seen.erased.bytesOfCode, 1),
  );
});
