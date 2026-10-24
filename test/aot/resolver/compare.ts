import { compareCodeResolution, type CodeResolutionSite } from "bun:internal-for-testing";
import { expect } from "bun:test";
import type { DirectoryTree } from "harness";
import { relative } from "node:path";

export type CompareOptions = { conditions?: string[]; preserveSymlinks?: boolean };

export function formatDifferences(root: string, differences: CodeResolutionSite[]): string[] {
  return differences.map(({ importer, specifier, kind, bunRun, compile }) => {
    const quoted = JSON.stringify(specifier);
    const site = kind === "import" ? `import ${quoted}` : `require(${quoted})`;
    return `${relative(root, importer)}: ${site}\n  bun run:     ${bunRun}\n  bun compile: ${compile}`;
  });
}

export function expectNoDifferences(root: string, options?: CompareOptions): number {
  const { sites, differences } = compareCodeResolution(root, options);
  expect(formatDifferences(root, differences)).toEqual([]);
  return sites;
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
