// Gets fresh clones of eslint and typescript-eslint into the state the
// extractors need. Safe to run again.
//
//   ESLINT_DIR=<checkout> TYPESCRIPT_ESLINT_DIR=<checkout> bun prepare-checkouts.ts

import { execFileSync } from "node:child_process";
import { globSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { requiredEnv } from "./shared.ts";

const eslintDir = resolve(requiredEnv("ESLINT_DIR"));
const tsDir = resolve(requiredEnv("TYPESCRIPT_ESLINT_DIR"));

function run(cwd: string, command: string, ...args: string[]) {
  console.log(`$ ${command} ${args.join(" ")}  (in ${cwd})`);
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

run(eslintDir, "bun", "install", "--ignore-scripts");
// Converts pnpm-workspace.yaml/pnpm-lock.yaml, so the locked versions
// (TypeScript in particular) are the ones upstream tests with.
run(tsDir, "bun", "install", "--ignore-scripts");

// What `nx run-many -t build` does for the packages the rule tests load,
// without nx and pnpm: @typescript-eslint/types is generated from ast-spec...
const astSpec = join(tsDir, "packages/ast-spec");
run(astSpec, "bun", "x", "tsc6", "-b", "tsconfig.build.json");
run(astSpec, "bun", "x", "api-extractor", "run", "--local", "--config=api-extractor.json");
mkdirSync(join(tsDir, "packages/types/src/generated"), { recursive: true });
writeFileSync(
  join(tsDir, "packages/types/src/generated/ast-spec.ts"),
  readFileSync(join(astSpec, "dist/ast-spec.ts"), "utf8").replaceAll("export declare enum", "export enum"),
);
// ...and the rest is `tsc -b`, which follows the project references.
run(
  tsDir,
  "bun",
  "x",
  "tsc",
  "-b",
  "packages/eslint-plugin/tsconfig.build.json",
  "packages/rule-tester/tsconfig.build.json",
  "packages/parser/tsconfig.build.json",
);

// Both sets of fixtures should describe the same ESLint: the rules that extend
// a core rule run that rule's code. Point the workspace's copy at the checkout.
for (const installed of globSync("node_modules/.bun/eslint@*/node_modules/eslint", { cwd: tsDir })) {
  rmSync(join(tsDir, installed), { recursive: true, force: true });
  symlinkSync(eslintDir, join(tsDir, installed));
  console.log(`${installed} -> ${eslintDir}`);
}
