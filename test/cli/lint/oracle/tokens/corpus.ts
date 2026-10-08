// The source texts that the oracles of this directory run on.
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Case = {
  /** Where it is from, for a person. */
  id: string;
  /** The extension decides how `bun lint` parses it. */
  path: string;
  code: string;
  parser: "espree" | "typescript";
  /** A year, or 3 or 5. */
  ecmaVersion: number;
  sourceType: "module" | "script" | "commonjs";
  jsx: boolean;
};

const LATEST = 2026;

/** The `code` of every case of the conformance fixtures. */
export function fixtureCases(fixtures: string): Case[] {
  const cases: Case[] = [];
  for (const plugin of ["eslint", "typescript-eslint"]) {
    for (const file of new Glob("*.json").scanSync(join(fixtures, plugin))) {
      const fixture = JSON.parse(readFileSync(join(fixtures, plugin, file), "utf8"));
      fixture.cases.forEach((it: any, index: number) => {
        const language = it.languageOptions ?? {};
        if (it.skip || (language.parser !== "espree" && language.parser !== "typescript")) return;
        const options = language.parserOptions ?? {};
        const ecmaVersion = options.ecmaVersion ?? language.ecmaVersion;
        cases.push({
          id: `${plugin}/${fixture.rule}#${index}`,
          path: it.filename.replace(/^.*\//, ""),
          code: it.code,
          parser: language.parser,
          ecmaVersion: ecmaVersion === "latest" || ecmaVersion == null ? LATEST : ecmaVersion,
          sourceType: options.sourceType ?? language.sourceType ?? "module",
          jsx: options.ecmaFeatures?.jsx === true,
        });
      });
    }
  }
  return cases;
}

/** The JavaScript and TypeScript files under `root`. */
export function fileCases(root: string): Case[] {
  const cases: Case[] = [];
  for (const file of new Glob("**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}").scanSync(root)) {
    if (file.includes("node_modules/")) continue;
    const code = readFileSync(join(root, file), "utf8");
    if (code.length > 2_000_000) continue;
    const isJs = /\.[cm]?jsx?$/.test(file);
    cases.push({
      id: join(root, file),
      path: file.replace(/^.*\//, ""),
      code,
      parser: isJs ? "espree" : "typescript",
      ecmaVersion: LATEST,
      sourceType: file.endsWith(".cjs") ? "commonjs" : "module",
      jsx: isJs || file.endsWith("x"),
    });
  }
  return cases;
}

/** Without the cases that only repeat the input of another. ESLint removes a BOM before it parses. */
export function prepare(cases: Case[]): Case[] {
  const seen = new Set<string>();
  return cases.filter(it => {
    if (it.code.startsWith("﻿")) it.code = it.code.slice(1);
    const key = [it.path.replace(/^.*\./, ""), it.parser, it.ecmaVersion, it.sourceType, it.jsx, it.code].join("\0");
    return !seen.has(key) && !!seen.add(key);
  });
}

/** `--fixtures <dir>` and `--files <dir>`, each any number of times. */
export function casesFromArguments(args: string[]): Case[] {
  const cases: Case[] = [];
  args.forEach((arg, i) => {
    if (arg === "--fixtures") cases.push(...fixtureCases(args[i + 1]));
    if (arg === "--files") cases.push(...fileCases(args[i + 1]));
  });
  return prepare(cases);
}

export function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
}

export type Parsers = { espree: any; typescriptEstree: any };

/** `--eslint <checkout>` and `--typescript-eslint <checkout>`, or `$ESLINT_DIR` and `$TYPESCRIPT_ESLINT_DIR`. */
export function loadParsers(args: string[]): Parsers {
  const eslint = option(args, "--eslint") ?? process.env.ESLINT_DIR;
  const typescriptEslint = option(args, "--typescript-eslint") ?? process.env.TYPESCRIPT_ESLINT_DIR;
  if (!eslint || !typescriptEslint) throw new Error("--eslint <checkout> --typescript-eslint <checkout>");
  return {
    espree: require(join(eslint, "node_modules/espree")),
    typescriptEstree: require(join(typescriptEslint, "packages/typescript-estree/dist/index.js")),
  };
}

/** The AST with `tokens` and `comments`, as ESLint gets it. Throws what the parser throws. */
export function parse(parsers: Parsers, it: Case, parser = it.parser): any {
  // As `lib/languages/js/index.js` does.
  const text = it.code.replace(/^#!([^\r\n]+)/u, (_, captured) => `//${captured}`);
  const ast =
    parser === "espree"
      ? parsers.espree.parse(text, {
          tokens: true,
          comment: true,
          range: true,
          loc: true,
          ecmaVersion: it.ecmaVersion === LATEST ? "latest" : it.ecmaVersion,
          sourceType: it.sourceType,
          ecmaFeatures: { jsx: it.jsx, globalReturn: it.sourceType === "commonjs" },
        })
      : parsers.typescriptEstree.parse(text, {
          tokens: true,
          comment: true,
          range: true,
          loc: true,
          jsx: it.jsx,
          filePath: it.path,
          sourceType: it.sourceType === "commonjs" ? "script" : it.sourceType,
        });
  // As the constructor of `SourceCode` does.
  if (text !== it.code && ast.comments.length > 0) ast.comments[0].type = "Shebang";
  return ast;
}
