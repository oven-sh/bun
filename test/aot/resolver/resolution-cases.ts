import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir, type DirectoryTree } from "harness";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "../harness/run";
import type { Answer, Site } from "./answers";

/**
 * `from` imports `specifier`. Two elements: the compiler finds what a program finds that runs under `bun run --aot`.
 * Three: that is this answer, for `import` and `require`. Four: for `import`, then for `require`.
 */
export type Pin = [from: string, specifier: string, onImport?: Answer, onRequire?: Answer];

export interface ResolutionCase {
  name: string;
  /** Without the importers: `testResolution` writes each `from` of `pins`. */
  files: DirectoryTree;
  /** Link path to target path, both relative to the root. Created after `files` and the importers. */
  links?: Record<string, string>;
  pins: Pin[];
  options?: { conditions?: string[]; preserveSymlinks?: boolean };
  /** Flags and environment variables of the Bun that resolves. */
  child?: (root: string) => { args?: string[]; env?: Record<string, string> };
  skip?: boolean;
}

export function packageFiles(
  name: string,
  manifest: object | string,
  files: string[],
  directory = `node_modules/${name}`,
): DirectoryTree {
  const tree: DirectoryTree = {
    [`${directory}/package.json`]: typeof manifest === "string" ? manifest : JSON.stringify({ name, ...manifest }),
  };
  for (const file of files) tree[`${directory}/${file}`] = "";
  return tree;
}

function writeImporters(root: string, pins: Pin[]): string[] {
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
    const lines = Array.from(specifiers, JSON.stringify).map(quoted => `import ${quoted};\nrequire(${quoted});\n`);
    writeFileSync(path, lines.join(""));
  }
  return [...importers.keys()];
}

// In a Bun of its own: its resolver remembers each directory for the life of the process, and takes its conditions from flags.
async function resolveInChild(root: string, importers: string[], args: string[], env?: Record<string, string>) {
  const script = `import { resolveSites } from ${JSON.stringify(join(import.meta.dir, "answers.ts"))};
console.log(JSON.stringify(resolveSites(${JSON.stringify(root)}, ${JSON.stringify(importers)})));`;
  const command = [bunExe(), "--no-install", ...args, "-e", script];
  const { stdout, stderr, exitCode } = await run(command, root, { ...bunEnv, ...env });
  expect({ exitCode, stderr: exitCode === 0 ? "" : stderr }).toEqual({ exitCode: 0, stderr: "" });
  return JSON.parse(stdout) as Site[];
}

export function testResolution(cases: ResolutionCase[]): void {
  for (const { name, files, links = {}, pins, options = {}, child, skip = false } of cases) {
    test.skipIf(skip)(name, async () => {
      using tree = tempDir("aot-resolver", files);
      const root = String(tree);
      const importers = writeImporters(root, pins);
      for (const [link, target] of Object.entries(links)) {
        mkdirSync(dirname(join(root, link)), { recursive: true });
        symlinkSync(join(root, target), join(root, link), "junction");
      }

      const { args = [], env } = child?.(root) ?? {};
      for (const condition of ["aot", ...(options.conditions ?? [])]) args.push("--conditions", condition);
      if (options.preserveSymlinks) args.push("--preserve-symlinks");
      const sites = await resolveInChild(root, importers, args, env);

      expect(sites).toHaveLength(2 * pins.length);
      expect(sites.filter(site => site.compiled !== site.atRunTime)).toEqual([]);
      const compiled = (from: string, specifier: string, kind: Site["kind"]) =>
        sites.find(site => site.from === from && site.specifier === specifier && site.kind === kind)!.compiled;
      const pinned = pins.filter(([, , onImport]) => onImport !== undefined);
      const answers = pinned.map(([from, specifier]) => [
        from,
        specifier,
        compiled(from, specifier, "import"),
        compiled(from, specifier, "require"),
      ]);
      expect(answers).toEqual(pinned.map(([from, specifier, onImport, onRequire = onImport]) => [from, specifier, onImport, onRequire]));
    });
  }
}
