// A small, fixed part of what test/aot/fuzz/texts-for-generated-types.ts does for as long as it is left running. Each test draws
// 30 types, builds the program that parses under them with `bun build --compile --aot`, and lets it make and ask a fixed number of
// texts. The program prints a line that starts with "DIFFERS" for each answer that is not what its own slow parser and `JSON.parse(text)` say.
//
//   bun test/aot/fuzz/texts-for-generated-types.ts --print <seed> --types 30      the program of one seed
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { program } from "./fuzz/texts-for-generated-types";
import { run } from "./harness/run";
import { test } from "./supported";

const driver = readFileSync(join(import.meta.dir, "fuzz", "texts-for-generated-types-driver.ts"), "utf8");
const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, target: "esnext", module: "esnext", moduleResolution: "bundler" },
});

test.concurrent.each([1, 2, 3, 4, 5, 6])(
  "30 generated types, seed %d",
  async seed => {
    using dir = tempDir("texts-for-generated-types", {
      "program.ts": program(seed, 30),
      "texts-for-generated-types-driver.ts": driver,
      "tsconfig.json": tsconfig,
    });
    const outfile = join(String(dir), "program" + (isWindows ? ".exe" : ""));
    const { stderr: said, exitCode: built } = await run(
      [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", outfile],
      String(dir),
    );
    expect({ said: built ? said : "", built }).toEqual({ said: "", built: 0 });
    const { stdout, stderr, exitCode } = await run(
      [outfile, "--seed", String(seed), "--rounds", "2", "--texts", "120", "--levels", "100000"],
      String(dir),
    );
    const lines = stdout.trim().split("\n");
    expect(lines.filter(line => line.startsWith("DIFFERS")).map(line => line.slice(0, 2000))).toEqual([]);
    expect(lines.at(-1)).toMatch(/^texts \d+ .* differences 0$/);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  },
  600_000,
);
