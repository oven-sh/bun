// No ordinary line of a typed program may cost more than its own property accesses. ./one-line/base.ts is a small program in which every type is
// closed: each object has a fixed layout and each property access through those types is a load. ./one-line/lines.txt holds ordinary lines of
// TypeScript, one to a row: `title | code`. Each is added alone to the end of the base program: the types of the base must stay closed, and no
// fewer accesses may be typed than before. See ./typedness.ts for how a program is measured.
//
// A row that ends in ` | opens` is a line that is known to break this. It is not judged. Whoever fixes one takes the mark off its row.
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";
import { inShareOfList, slot, unsupported, wanted } from "../run-programs";
import { typednessOf, type Typedness } from "./typedness";

const base = readFileSync(join(import.meta.dir, "one-line", "base.ts"), "utf8");
const rows = readFileSync(join(import.meta.dir, "one-line", "lines.txt"), "utf8")
  .split("\n")
  .filter(line => line.trim() && !line.startsWith("#"))
  .map(line => {
    const [opens, at] = [line.endsWith(" | opens"), line.indexOf(" | ")];
    return {
      title: line.slice(0, at),
      code: line.slice(at + 3, opens ? -" | opens".length : undefined).replaceAll("\\n", "\n"),
      opens,
    };
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

const baseTypes = ["Row", "Order", "Point", "Circle", "Square"];
const typedAccessCount = (typedness: Typedness) => Number(/accesses (\d+) of/.exec(typedness.line)?.[1] ?? -1);

/** What the line did to the types of the base program: "" if nothing. */
function findRegression(before: Typedness, after: Typedness): string {
  if (!/ open, /.test(after.line)) return after.line;
  const found = baseTypes.filter(name => after.types.includes(name)).map(name => `${name} is open`);
  const [typedBefore, typedAfter] = [typedAccessCount(before), typedAccessCount(after)];
  if (found.length === 0 && typedAfter < typedBefore) found.push(`${typedAfter} typed accesses, not ${typedBefore}`);
  return found.join(", ");
}

describe.skipIf(!!unsupported)("compile/aot/typedness/one-line", () => {
  test("a line costs no more than its own accesses", async () => {
    using dir = tempDir("aot-one-line", { "tsconfig.json": JSON.stringify(tsconfig), "base.ts": base });
    const before = await typednessOf(join(String(dir), "base.ts"));
    expect(before.types).toEqual([]);
    expect(before.line).toStartWith("0 open, ");
    expect(typedAccessCount(before)).toBeGreaterThan(10);
    const mine = rows
      .filter(row => !row.opens)
      .filter(({ title }, index) => wanted !== "quick" || inShareOfList(`one line ${title}`, index));
    const found = await Promise.all(
      mine.map(({ title, code }, index) =>
        slot(async () => {
          const path = join(String(dir), `line-${index}.ts`);
          writeFileSync(path, base + code + "\n");
          const regression = findRegression(before, await typednessOf(path));
          return regression ? [`${title}: ${regression}`] : [];
        }),
      ),
    );
    expect(found.flat()).toEqual([]);
  }, 600_000);

  test("reports a regression when JSON.parse data is pushed into a typed array", async () => {
    using dir = tempDir("aot-one-line-regression", {
      "tsconfig.json": JSON.stringify(tsconfig),
      "base.ts": base,
      "interface.ts": base + `rows.push(JSON.parse('{"name":"Cy","n":3}'));\nconsole.log(total(rows));\n`,
    });
    const [before, openInterface] = await Promise.all(
      ["base.ts", "interface.ts"].map(file => typednessOf(join(String(dir), file))),
    );
    expect(openInterface.line).toMatch(/^[1-9]\d* open, /);
    expect(findRegression(before, openInterface)).toContain("Row is open");
  }, 120_000);

  // `points.push(JSON.parse('{"x":1,"y":2}'))` makes `this.x` in a method of Point a tested access, and no entry of the report names Point.
  test.todo("reports a regression when JSON.parse data is pushed into an array of a class");
});
