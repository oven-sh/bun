// No ordinary line of a typed program may cost more than its own property accesses. ./one-line/base.ts is a small program in which every type is
// closed: each object has a fixed layout and each property access through those types is a load. ./one-line/lines.txt holds ordinary lines of
// TypeScript, one to a row: `title | code`. Each is added alone to the end of the base program, and the types of the base must stay closed, keep
// their layouts and be read through as often as before. See ./typedness.ts for how a program is asked about.
//
// A row that ends in ` | opens` is a line that is known to break this. It is not judged. Whoever mends one takes the mark off its row.
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";
import { slot, unsupported, wanted } from "../run-programs";
import { typednessOf, type Typedness } from "./typedness";

const base = readFileSync(join(import.meta.dir, "one-line", "base.ts"), "utf8");
const rows = readFileSync(join(import.meta.dir, "one-line", "lines.txt"), "utf8")
  .split("\n")
  .filter(line => line.trim() && !line.startsWith("#"))
  .map(line => {
    const [opens, at] = [line.endsWith(" | opens"), line.indexOf(" | ")];
    return { title: line.slice(0, at), code: line.slice(at + 3, opens ? -" | opens".length : undefined).replaceAll("\\n", "\n"), opens };
  });

const tsconfig = {
  files: [],
  compilerOptions: {
    lib: ["ESNext"],
    target: "ESNext",
    module: "Preserve",
    moduleDetection: "force",
    moduleResolution: "bundler",
    verbatimModuleSyntax: true,
    typeRoots: [join(import.meta.dir, "..", "..", "..", "packages")],
    types: ["bun-types"],
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    noUncheckedIndexedAccess: true,
  },
};

const readsOf = (said: Typedness) => Number(/reads (\d+) of/.exec(said.line)?.[1] ?? -1);
const stateOf = (said: Typedness) => new Map(said.types.map(type => [type.slice(0, type.indexOf(": ")), type.slice(type.indexOf(": ") + 2)] as const));

/** What the line did to the types of the base program: "" if nothing. */
function lossOf(before: Typedness, after: Typedness): string {
  if (!/ layouts, /.test(after.line)) return after.line;
  const [then, now] = [stateOf(before), stateOf(after)];
  const lost = [...then].flatMap(([name, state]) => {
    const [, reads] = /^closed, (\d+) reads$/.exec(state)!;
    const [, kind, left] = /^(closed|open|given)(?:, (\d+) reads)?$/.exec(now.get(name) ?? "") ?? [, "gone", "0"];
    return kind === "closed" && Number(left) >= Number(reads) ? [] : [`${name} is ${kind === "closed" ? `read through ${left} times, not ${reads}` : kind}`];
  });
  if (lost.length === 0 && readsOf(after) < readsOf(before)) lost.push(`${readsOf(after)} typed reads, not ${readsOf(before)}`);
  return lost.join(", ");
}

describe.skipIf(!!unsupported)("compile/aot/typedness/one-line", () => {
  test("a line costs no more than its own accesses", async () => {
    using dir = tempDir("aot-one-line", { "tsconfig.json": JSON.stringify(tsconfig), "base.ts": base });
    const before = await typednessOf(join(String(dir), "base.ts"));
    expect(before.types).toEqual(["Row: closed, 6 reads", "Order: closed, 4 reads", "Point: closed, 4 reads", "Circle: closed, 1 reads", "Square: closed, 1 reads"]);
    const mine = rows.filter(row => !row.opens).filter((_, index) => wanted !== "quick" || index % 10 === 0);
    const found = await Promise.all(
      mine.map(({ title, code }, index) =>
        slot(async () => {
          const path = join(String(dir), `line-${index}.ts`);
          writeFileSync(path, base + code + "\n");
          const loss = lossOf(before, await typednessOf(path));
          return loss ? [`${title}: ${loss}`] : [];
        }),
      ),
    );
    expect(found.flat()).toEqual([]);
  }, 600_000);
});
