import { ShellOutput, ShellPromise } from "bun";
import type { DirectoryTree } from "harness";
import { createTestBuilder } from "./test_builder";

export { createTestBuilder };

declare module "bun" {
  // Define the additional methods
  interface Shell {
    parse: (strings: TemplateStringsArray, ...expressions: any[]) => string; // Define the return type for parse
    lex: (strings: TemplateStringsArray, ...expressions: any[]) => string; // Define the return type for lex
  }
}

const defaultRedirect = {
  __unused: 0,
  append: false,
  stderr: false,
  stdin: false,
  stdout: false,
  duplicate_out: false,
};

export const redirect = (opts?: Partial<typeof defaultRedirect>): typeof defaultRedirect =>
  opts === undefined
    ? defaultRedirect
    : {
        ...defaultRedirect,
        ...opts,
      };

export const sortedShellOutput = (output: string | string[]): string[] =>
  (Array.isArray(output) ? output : output.split("\n").filter(s => s.length > 0)).sort();

/**
 * A `node_modules`-shaped tree for the recursive `ls` and `rm` tests: 4 top-level
 * packages, each nesting its own `node_modules` two levels deep, with scoped
 * packages, dotfiles and empty directories (28 packages, ~280 files). Built
 * locally so those tests do not depend on `bun install` or a registry.
 *
 * Keys are `/`-separated paths relative to the tree root in the shape `tempDir()`
 * accepts; a `{}` value is an empty directory.
 */
export function nodeModulesTree(): DirectoryTree {
  const tree: DirectoryTree = { "node_modules/.package-lock.json": "{}" };
  const addPackage = (dir: string, name: string, depth: number) => {
    tree[`${dir}/package.json`] = JSON.stringify({ name });
    tree[`${dir}/.npmignore`] = "";
    tree[`${dir}/empty`] = {};
    for (let i = 0; i < 4; i++) {
      tree[`${dir}/lib/mod${i}.js`] = "";
      tree[`${dir}/dist/types/mod${i}.d.ts`] = "";
    }
    if (depth > 0) {
      addPackage(`${dir}/node_modules/dep`, "dep", depth - 1);
      addPackage(`${dir}/node_modules/@scope/dep`, "@scope/dep", depth - 1);
    }
  };
  for (let i = 0; i < 4; i++) {
    addPackage(`node_modules/pkg-${i}`, `pkg-${i}`, 2);
    tree[`node_modules/.bin/pkg-${i}`] = "";
  }
  return tree;
}
