import { describe, test, afterAll, beforeAll, expect } from "bun:test";
import { ShellOutput } from "bun";
import { ShellPromise } from "bun";
import { tempDirWithFiles } from "harness";
import { join } from "node:path";
import * as fs from "node:fs";
import { TestBuilder } from "./test_builder";

export { TestBuilder };

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
};

export const redirect = (opts?: Partial<typeof defaultRedirect>): typeof defaultRedirect =>
  opts === undefined
    ? defaultRedirect
    : {
        ...defaultRedirect,
        ...opts,
      };

export const sortedShellOutput = (output: string): string[] =>
  output
    .split("\n")
    .filter(s => s.length > 0)
    .sort();
