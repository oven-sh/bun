import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const suite = join(import.meta.dir, "typed-packages", "measure");
const environment = { ...bunEnv, NO_COLOR: "1" };

function lay(root: string, typed: boolean) {
  const folder = join(root, typed ? "typed" : "as-installed");
  cpSync(join(suite, "programs", "orders.ts"), join(folder, "programs", "orders.ts"));
  cpSync(join(suite, "turns.ts"), join(folder, "turns.ts"));
  cpSync(join(suite, "packages", "orders"), join(folder, "node_modules", "orders"), { recursive: true });
  writeFileSync(
    join(folder, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "preserve",
        moduleResolution: "bundler",
        target: "esnext",
        skipLibCheck: true,
      },
    }),
  );
  if (!typed) {
    const described = join(folder, "node_modules", "orders", "package.json");
    writeFileSync(
      described,
      JSON.stringify(JSON.parse(readFileSync(described, "utf8"), (key, value) => (key === "aot" ? undefined : value))),
    );
    rmSync(join(folder, "node_modules", "orders", "index.aot.ts"));
  }
  return folder;
}

async function answerOf(folder: string) {
  const report = join(folder, "report.json");
  const built = await spawned(
    [bunExe(), "compile", "./programs/orders.ts", "--outfile", join(folder, "orders"), "--aot-report=" + report],
    folder,
    environment,
  );
  const said = (built.stdout + built.stderr).split(/\r?\n/).filter(line => /without (its |their )?types/.test(line));
  const ran = await spawned(
    [join(folder, isWindows ? "orders.exe" : "orders"), "1000", "0", "3", "2", "0"],
    folder,
    environment,
  );
  const [, result] = ran.stdout
    .trim()
    .split("\n")
    .map(line => JSON.parse(line));
  return {
    said,
    aotFiles: readBuildReport(report).statistics.TypedVersionsUsed,
    exitCode: [built.exitCode, ran.exitCode],
    answer: result.answer,
    lastAnswer: result.lastAnswer,
    turns: result.turns,
  };
}

describe("the programs of typed-packages/measure", () => {
  test(
    "answer alike with a package as installed and with its .aot.ts file",
    () =>
      slot(async () => {
        using dir = tempDir("aot-typed-packages", {});
        const asInstalled = await answerOf(lay(String(dir), false));
        const typed = await answerOf(lay(String(dir), true));
        expect(asInstalled).toEqual({
          said: [],
          aotFiles: 0,
          exitCode: [0, 0],
          answer: asInstalled.answer,
          lastAnswer: asInstalled.answer,
          turns: 2,
        });
        expect(typed).toEqual({ ...asInstalled, aotFiles: 1 });
      }),
    600_000,
  );
});
