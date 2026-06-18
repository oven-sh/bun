// Inventory of arrow functions in built-in JavaScript/TypeScript modules (src/js).
//
// Arrow functions in these hot paths allocate a closure object per evaluation
// and force JSC to create a lexical environment for the enclosing scope.
// Named function declarations and `function` expressions avoid both costs and
// produce better stack traces, so new arrows are not allowed in src/js.
//
// If this test fails because a count went UP: rewrite the new arrow as a
// named `function`. If that is not possible (e.g. lexical `this` is required),
// update the inventory by running `bun ./test/internal/no-arrow-functions.test.ts`.
//
// If it fails because a count went DOWN: you removed arrows, update the
// inventory the same way so the ratchet stays accurate.

import { file } from "bun";
import path from "path";
import ts from "typescript";
import { globAllSources } from "../../scripts/glob-sources.ts";

const root = path.resolve(import.meta.dir, "..", "..");
const standalone = typeof describe === "undefined";

const limitsPath = import.meta.dir + "/no-arrow-functions-limits.json";
const limits: Record<string, number> = await Bun.file(limitsPath)
  .json()
  .catch(function (err) {
    // Allow a missing baseline only when regenerating it; in test mode a
    // missing or malformed limits file is a setup error, not an empty ratchet.
    if (standalone && err?.code === "ENOENT") return {};
    throw err;
  });

const jsSources = globAllSources().js.filter(function (p) {
  if (p.endsWith(".d.ts")) return false;
  const rel = path.relative(root, p).replaceAll(path.sep, "/");
  return rel.startsWith("src/js/");
});

function countArrows(source: string, content: string): [number, number[]] {
  const kind = source.endsWith(".ts") || source.endsWith(".tsx") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(source, content, ts.ScriptTarget.Latest, true, kind);
  const lines: number[] = [];
  function walk(node: ts.Node) {
    if (ts.isArrowFunction(node)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      lines.push(line + 1);
    }
    ts.forEachChild(node, walk);
  }
  walk(sf);
  return [lines.length, lines];
}

const counts: Record<string, number> = {};
const locations: Record<string, number[]> = {};
for (const abs of jsSources) {
  const source = path.relative(root, abs).replaceAll(path.sep, "/");
  const content = await file(abs).text();
  const [n, lines] = countArrows(source, content);
  if (n > 0) {
    counts[source] = n;
    locations[source] = lines;
  }
}

if (standalone) {
  // Standalone mode (`bun ./test/internal/no-arrow-functions.test.ts`):
  // regenerate the limits file from the current tree.
  const sorted = Object.fromEntries(
    Object.entries(counts).sort(function ([a], [b]) {
      return a < b ? -1 : 1;
    }),
  );
  await Bun.write(limitsPath, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(sorted).length} files to no-arrow-functions-limits.json`);
  process.exit(0);
}

describe("no arrow functions in src/js", function () {
  const files = new Set([...Object.keys(limits), ...Object.keys(counts)]);
  for (const source of [...files].sort()) {
    const limit = limits[source] ?? 0;
    const count = counts[source] ?? 0;
    test(`${source} (${limit})`, function () {
      if (count > limit) {
        const lines = locations[source] ?? [];
        const sample = lines
          .slice(0, 10)
          .map(function (l) {
            return `- ${source}:${l}`;
          })
          .join("\n");
        throw new Error(
          `${source} has ${count} arrow functions, up from ${limit}.\n` +
            `Use named function declarations or function expressions in src/js instead of arrows.\n` +
            (sample
              ? `New/existing arrows at:\n${sample}${lines.length > 10 ? `\n... and ${lines.length - 10} more` : ""}\n`
              : "") +
            `If the new arrow is justified, update the inventory with \`bun ./test/internal/no-arrow-functions.test.ts\`.`,
        );
      } else if (count < limit) {
        throw new Error(
          `${source} has ${count} arrow functions, down from ${limit}.\n` +
            `Update the inventory with \`bun ./test/internal/no-arrow-functions.test.ts\`.`,
        );
      }
    });
  }
});
