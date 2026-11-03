// Runs in a child of the test: it imports nothing of the test runner.
import { describeCodeGraph } from "bun:internal-for-testing";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

export type ImportKind = "import" | "require";

/** A path relative to the root with `/`, `null` when nothing is found, or `builtin:node:fs`. */
export type Answer = string | null;

export type Site = { from: string; specifier: string; kind: ImportKind; compiled: Answer; atRunTime: Answer };

function findAtRunTime(importer: string, specifier: string, kind: ImportKind): string | null {
  try {
    const found =
      kind === "import" ? Bun.resolveSync(specifier, dirname(importer)) : createRequire(importer).resolve(specifier);
    return isAbsolute(found) ? found : `builtin:${found}`;
  } catch {
    return null;
  }
}

/** What the compiler finds for every import of `importers`, and what Bun finds for the same import in a running program. */
export function resolveSites(root: string, importers: string[]): Site[] {
  const toAnswer = (text: string | null): Answer => {
    if (text === null || text.startsWith("not found")) return null;
    return isAbsolute(text) ? relative(root, text).replaceAll(sep, "/") : text;
  };
  const paths = importers.map(from => join(root, from));
  const graph = describeCodeGraph(paths, { workingDirectory: root });
  return importers.flatMap((from, index) => {
    const file = graph.files.find(file => file.path === paths[index]);
    if (!file) throw new Error(`${from} is not in the program`);
    return file.sites.map(({ specifier, kind, answer }) => ({
      from,
      specifier: specifier!,
      kind,
      compiled: toAnswer(answer),
      atRunTime: toAnswer(findAtRunTime(paths[index], specifier!, kind)),
    }));
  });
}
