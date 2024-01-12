import { describe, test, afterAll, beforeAll, expect } from "bun:test";
import { ShellOutput } from "bun";
import { ShellPromise } from "bun";

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

export class TestBuilder {
  private promise: ShellPromise;
  private expected_stdout: string | undefined;
  private expected_stderr: string | undefined;
  private expected_exit_code: number | undefined;

  constructor(promise: ShellPromise) {
    this.promise = promise;
  }

  static command(strings: TemplateStringsArray, ...expressions: any[]): TestBuilder {
    const promise = Bun.$(strings, ...expressions);
    const This = new this(promise);
    return This;
  }

  stdout(expected: string): this {
    this.expected_stdout = expected;
    return this;
  }

  stderr(expected: string): this {
    this.expected_stderr = expected;
    return this;
  }

  exitCode(expected: number): this {
    this.expected_exit_code = expected;
    return this;
  }

  async run(): Promise<ShellOutput> {
    const output = await this.promise;
    const { stdout, stderr, exitCode } = output;
    if (this.expected_stdout !== undefined) expect(stdout.toString()).toEqual(this.expected_stdout);
    if (this.expected_stderr !== undefined) expect(stderr.toString()).toEqual(this.expected_stderr);
    if (this.expected_exit_code !== undefined) expect(exitCode).toEqual(this.expected_exit_code);
    return output;
  }
}
