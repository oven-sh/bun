// One line for each TypeScript program under ../programs, stored in ./programs/<topic>.txt: see ./typedness.ts for what a line says. A program that
// becomes less typed than its line fails the test; one that becomes more typed passes. AOT_PROGRAMS_UPDATE=1 rewrites the lines of the programs
// that are no less typed than before, and the diff says what the change to the compiler did. A program that has no line yet is not judged: the
// next rewrite gives it one.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { inShare, slot, unsupported, wanted } from "../run-programs";
import { typednessOf } from "./typedness";

const programs = join(import.meta.dir, "..", "programs");
const recorded = join(import.meta.dir, "programs");
const updates = !!process.env.AOT_PROGRAMS_UPDATE;

const numbersOf = (line: string) => /: (\d+) open, (\d+) checks, accesses (\d+) of (\d+)$/.exec(line)?.slice(1).map(Number);
const outcomeRank = (line: string) => (numbersOf(line) ? 2 : line.endsWith(": is not compiled") ? 1 : 0);

/**
 * No more open types, no more checks, and no smaller share of typed accesses or no more untyped ones: an optimization that removes typed
 * accesses lowers the share. A record of no accesses is all typed. Numbers are better than a failed build, which is better than a signal.
 */
export function isNoLessTyped(line: string, recorded: string): boolean {
  const [now, then] = [numbersOf(line), numbersOf(recorded)];
  if (!now || !then) return line === recorded || outcomeRank(line) > outcomeRank(recorded);
  const [[open, checks, typed, accesses], [openThen, checksThen, typedThen, accessesThen]] = [now, then];
  const isShareNoSmaller = accessesThen > 0 && typed * accessesThen >= typedThen * accesses;
  return open <= openThen && checks <= checksThen && (isShareNoSmaller || accesses - typed <= accessesThen - typedThen);
}

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

/** The programs of every topic are dealt out to `parts` test files, so that none of them runs for long. A slow build takes every tenth of them. */
export function typednessOfPrograms(part: number, parts: number) {
  describe.skipIf(!!unsupported)("compile/aot/typedness", () => {
    const topics = readdirSync(programs)
      .sort()
      .filter(topic => statSync(join(programs, topic)).isDirectory() && entryPointsOf(topic).length > 0);
    for (const topic of topics) {
      const every = wanted === "quick" && !updates ? parts * 10 : parts;
      const mine = entryPointsOf(topic).filter(([name], index) => index % every === part - 1 && inShare(`typedness ${topic}/${name}`, 10));
      if (mine.length === 0) continue;
      test(
        topic,
        async () => {
          const lines = await Promise.all(mine.map(([name, path]) => slot(async () => `${name}: ${(await typednessOf(path)).line}`)));
          const file = join(recorded, topic + ".txt");
          const nameOf = (line: string) => line.slice(0, line.indexOf(": "));
          if (updates) {
            const kept = new Map((existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n") : []).map(line => [nameOf(line), line]));
            for (const line of lines) if (isNoLessTyped(line, kept.get(nameOf(line)) ?? line)) kept.set(nameOf(line), line);
            mkdirSync(recorded, { recursive: true });
            writeFileSync(file, entryPointsOf(topic).flatMap(([name]) => kept.get(name) ?? []).join("\n") + "\n");
          }
          const before = existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n") : [];
          const [now, then] = [new Set(lines.map(nameOf)), new Map(before.map(line => [nameOf(line), line]))];
          const shown = lines.flatMap(line => {
            const record = then.get(nameOf(line));
            return record === undefined ? [] : [isNoLessTyped(line, record) ? record : line];
          });
          expect(shown).toEqual(before.filter(line => now.has(nameOf(line))));
        },
        600_000,
      );
    }
  });
}
