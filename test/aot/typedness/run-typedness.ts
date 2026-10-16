// One line for each TypeScript program under ../programs, kept in ./programs/<topic>.txt: see ./typedness.ts for what a line says. A program that
// becomes less typed fails the test, and so does one that becomes more typed: AOT_PROGRAMS_UPDATE=1 rewrites the files, and their diff says what
// the change to the compiler did. A program that has no line yet is not judged: the next rewrite gives it one.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { slot, unsupported } from "../run-programs";
import { typednessOf } from "./typedness";

const programs = join(import.meta.dir, "..", "programs");
const recorded = join(import.meta.dir, "programs");
const updates = !!process.env.AOT_PROGRAMS_UPDATE;

function entryPointsOf(topic: string): [string, string][] {
  return readdirSync(join(programs, topic))
    .sort()
    .flatMap((name): [string, string][] => {
      const path = join(programs, topic, name);
      if (/(?<!\.d)\.tsx?$/.test(name)) return [[name.replace(/\.tsx?$/, ""), path]];
      if (!statSync(path).isDirectory()) return [];
      return ["main.ts", "main.tsx"].filter(main => existsSync(join(path, main))).map(main => [name, join(path, main)]);
    });
}

/** The topics are dealt out to `parts` test files, so that none of them runs for long. */
export function typednessOfPrograms(part: number, parts: number) {
  describe.skipIf(!!unsupported)("compile/aot/typedness", () => {
    const topics = readdirSync(programs)
      .sort()
      .filter(topic => statSync(join(programs, topic)).isDirectory() && entryPointsOf(topic).length > 0);
    for (const topic of topics.filter((_, index) => index % parts === part - 1)) {
      test(
        topic,
        async () => {
          const lines = await Promise.all(entryPointsOf(topic).map(([name, path]) => slot(async () => `${name}: ${(await typednessOf(path)).line}`)));
          const file = join(recorded, topic + ".txt");
          if (updates) {
            mkdirSync(recorded, { recursive: true });
            writeFileSync(file, lines.join("\n") + "\n");
          }
          const nameOf = (line: string) => line.slice(0, line.indexOf(": "));
          const before = existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n") : [];
          const [now, then] = [new Set(lines.map(nameOf)), new Set(before.map(nameOf))];
          expect(lines.filter(line => then.has(nameOf(line)))).toEqual(before.filter(line => now.has(nameOf(line))));
        },
        600_000,
      );
    }
  });
}
