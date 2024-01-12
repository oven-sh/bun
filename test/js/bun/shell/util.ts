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
  private promise: { type: "ok"; val: ShellPromise } | { type: "err"; val: Error };

  private expected_stdout: string | undefined;
  private expected_stderr: string | undefined;
  private expected_exit_code: number | undefined;
  private expected_error: string | boolean | undefined;

  static UNEXPECTED_SUBSHELL_ERROR_OPEN =
    "Unexpected `(`, subshells are currently not supported right now. Escape the `(` or open a GitHub issue.";

  static UNEXPECTED_SUBSHELL_ERROR_CLOSE =
    "Unexpected `)`, subshells are currently not supported right now. Escape the `)` or open a GitHub issue.";

  constructor(promise: TestBuilder["promise"]) {
    this.promise = promise;
  }

  static command(strings: TemplateStringsArray, ...expressions: any[]): TestBuilder {
    try {
      const promise = Bun.$(strings, ...expressions);
      const This = new this({ type: "ok", val: promise });
      return This;
    } catch (err) {
      return new this({ type: "err", val: err as Error });
    }
  }

  stdout(expected: string): this {
    this.expected_stdout = expected;
    return this;
  }

  stderr(expected: string): this {
    this.expected_stderr = expected;
    return this;
  }

  error(expected?: string): this {
    if (expected === undefined) {
      this.expected_error = true;
    } else {
      this.expected_error = expected;
    }
    return this;
  }

  exitCode(expected: number): this {
    this.expected_exit_code = expected;
    return this;
  }

  async run(): Promise<ShellOutput | undefined> {
    if (this.promise.type === "err") {
      const err = this.promise.val;
      if (this.expected_error === undefined) throw err;
      if (this.expected_error === true) return undefined;
      if (typeof this.expected_error === "string") {
        expect(err.message).toEqual(this.expected_error);
      }
      return undefined;
    }

    const output = await this.promise.val;

    const { stdout, stderr, exitCode } = output!;
    if (this.expected_stdout !== undefined) expect(stdout.toString()).toEqual(this.expected_stdout);
    if (this.expected_stderr !== undefined) expect(stderr.toString()).toEqual(this.expected_stderr);
    if (this.expected_exit_code !== undefined) expect(exitCode).toEqual(this.expected_exit_code);
    return output;
  }
}
