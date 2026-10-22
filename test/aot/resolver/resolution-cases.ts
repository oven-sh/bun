import { compareCodeResolution, type CodeResolutionSite } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, type DirectoryTree } from "harness";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { formatDifferences, type CompareOptions } from "./compare";

/**
 * `from` imports `specifier`. Two elements: the resolvers are only compared. Three: what `bun run` answers for `import`
 * and `require`. Four: for `import`, then for `require`. An answer is a path relative to the root with `/`, `null` when
 * nothing is found, or any other text of `CodeResolutionSite` unchanged (`builtin:node:fs`, `external`).
 */
export type Pin = [from: string, specifier: string, onImport?: string | null, onRequire?: string | null];

export interface ResolutionCase {
  name: string;
  /** Without the importers: `testResolution` writes each `from` of `pins`. */
  files: DirectoryTree;
  /** Link path to target path, both relative to the root. Created after `files` and the importers. */
  links?: Record<string, string>;
  pins: Pin[];
  options?: CompareOptions;
  /** Compares in a new Bun, for a rule that depends on a flag or an environment variable of the process. */
  child?: (root: string) => { args?: string[]; env?: Record<string, string> };
  skip?: boolean;
  /** What happens today where the two do not agree yet: the case is listed as a todo. */
  notYet?: string;
}

type ChildSettings = ReturnType<NonNullable<ResolutionCase["child"]>>;
type Comparison = ReturnType<typeof compareCodeResolution>;
type ComparisonOptions = CompareOptions & { listsEverySite: true };
type ImportKind = CodeResolutionSite["kind"];

function writeImporters(root: string, pins: Pin[]): void {
  const importers = new Map<string, Set<string>>();
  for (const [from, specifier] of pins) {
    const specifiers = importers.get(from) ?? new Set<string>();
    if (specifiers.has(specifier)) throw new Error(`${from} imports ${JSON.stringify(specifier)} twice`);
    importers.set(from, specifiers.add(specifier));
  }
  for (const [from, specifiers] of importers) {
    const path = join(root, from);
    if (existsSync(path)) throw new Error(`${from} is an importer, so it cannot be one of the files`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Array.from(specifiers, specifier => `import ${JSON.stringify(specifier)};\n`).join(""));
  }
}

function createLinks(root: string, links: Record<string, string>): void {
  for (const [link, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, link)), { recursive: true });
    symlinkSync(join(root, target), join(root, link), "junction");
  }
}

async function compareInChild(
  root: string,
  options: ComparisonOptions,
  { args = [], env }: ChildSettings,
): Promise<Comparison> {
  const script = `import { compareCodeResolution } from "bun:internal-for-testing";
console.log(JSON.stringify(compareCodeResolution(${JSON.stringify(root)}, ${JSON.stringify(options)})));`;
  await using child = Bun.spawn({
    cmd: [bunExe(), "--no-install", ...args, "-e", script],
    cwd: root,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
  return JSON.parse(stdout);
}

function siteKey(importer: string, specifier: string, kind: ImportKind): string {
  return `${importer}\n${specifier}\n${kind}`;
}

function toAnswer(root: string, bunRun: string | undefined): string | null | undefined {
  if (bunRun === "not found") return null;
  if (bunRun !== undefined && isAbsolute(bunRun)) return relative(root, bunRun).replaceAll(sep, "/");
  return bunRun;
}

function expectPinnedAnswers(root: string, pins: Pin[], everySite: CodeResolutionSite[]): void {
  const bunRunBySite = new Map<string, string>();
  for (const { importer, specifier, kind, bunRun } of everySite) {
    bunRunBySite.set(siteKey(importer, specifier, kind), bunRun);
  }
  const getAnswer = (from: string, specifier: string, kind: ImportKind) =>
    toAnswer(root, bunRunBySite.get(siteKey(join(root, from), specifier, kind)));

  const pinned = pins.filter(([, , onImport]) => onImport !== undefined);
  const answers = pinned.map(([from, specifier]) => ({
    from,
    specifier,
    import: getAnswer(from, specifier, "import"),
    require: getAnswer(from, specifier, "require"),
  }));
  const expected = pinned.map(([from, specifier, onImport, onRequire = onImport]) => ({
    from,
    specifier,
    import: onImport,
    require: onRequire,
  }));
  expect(answers).toEqual(expected);
}

export function testResolution(cases: ResolutionCase[]): void {
  for (const { name, files, links = {}, pins, options, child, skip = false, notYet } of cases) {
    (notYet ? test.todo : test.skipIf(skip))(name, async () => {
      using tree = tempDir("aot-resolver", files);
      const root = String(tree);
      writeImporters(root, pins);
      createLinks(root, links);

      // bun_resolver caches each directory for the life of the process: a tree is complete here and is compared once.
      const comparisonOptions: ComparisonOptions = { ...options, listsEverySite: true };
      const { sites, differences, everySite = [] } =
        child === undefined
          ? compareCodeResolution(root, comparisonOptions)
          : await compareInChild(root, comparisonOptions, child(root));

      expect(formatDifferences(root, differences)).toEqual([]);
      expect(sites).toBeGreaterThanOrEqual(2 * pins.length);
      expectPinnedAnswers(root, pins, everySite);
    });
  }
}
