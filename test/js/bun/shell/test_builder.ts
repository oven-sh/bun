import { describe, test, afterAll, beforeAll, expect } from "bun:test";
import { ShellError, ShellOutput } from "bun";
import { ShellPromise } from "bun";
// import { tempDirWithFiles } from "harness";
import { join } from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

export class TestBuilder {
  private promise: { type: "ok"; val: ShellPromise } | { type: "err"; val: Error };
  private _testName: string | undefined = undefined;

  private expected_stdout: string | ((stdout: string, tempdir: string) => void) = "";
  private expected_stderr: string | ((stderr: string, tempdir: string) => void) = "";
  private expected_exit_code: number = 0;
  private expected_error: ShellError | string | boolean | undefined = undefined;
  private file_equals: { [filename: string]: string } = {};
  private _doesNotExist: string[] = [];

  private tempdir: string | undefined = undefined;
  private _env: { [key: string]: string } | undefined = undefined;

  static UNEXPECTED_SUBSHELL_ERROR_OPEN =
    "Unexpected `(`, subshells are currently not supported right now. Escape the `(` or open a GitHub issue.";

  static UNEXPECTED_SUBSHELL_ERROR_CLOSE =
    "Unexpected `)`, subshells are currently not supported right now. Escape the `)` or open a GitHub issue.";

  constructor(promise: TestBuilder["promise"]) {
    this.promise = promise;
  }

  /**
   * Start the test builder with a command:
   *
   * @example
   * ```ts
   * await TestBuilder.command`echo hi!`.stdout('hi!\n').run()

   * TestBuilder.command`echo hi!`.stdout('hi!\n').runAsTest('echo works')
   * ```
   */
  static command(strings: TemplateStringsArray, ...expressions: any[]): TestBuilder {
    try {
      if (process.env.BUN_DEBUG_SHELL_LOG_CMD === "1") console.info("[ShellTestBuilder] Cmd", strings.join(""));
      const promise = Bun.$(strings, ...expressions);
      const This = new this({ type: "ok", val: promise });
      This._testName = strings.join("");
      return This;
    } catch (err) {
      return new this({ type: "err", val: err as Error });
    }
  }

  directory(path: string): this {
    const tempdir = this.getTempDir();
    fs.mkdirSync(join(tempdir, path), { recursive: true });
    return this;
  }

  doesNotExist(path: string): this {
    this._doesNotExist.push(path);
    return this;
  }

  /**
   * Create a file in a temp directory
   * @param path Path to the new file, this will be inside the TestBuilder's temp directory
   * @param contents Contents of the new file
   * @returns
   *
   * @example
   * ```ts
   * TestBuilder.command`ls .`
   *   .file('hi.txt', 'hi!')
   *   .file('hello.txt', 'hello!')
   *   .runAsTest('List files')
   * ```
   */
  file(path: string, contents: string): this {
    const tempdir = this.getTempDir();
    fs.writeFileSync(join(tempdir, path), contents);
    return this;
  }

  env(env: { [key: string]: string }): this {
    this._env = env;
    return this;
  }

  quiet(): this {
    if (this.promise.type === "ok") {
      this.promise.val.quiet();
    }
    return this;
  }

  testName(name: string): this {
    this._testName = name;
    return this;
  }

  /**
   * Expect output from stdout
   *
   * @param expected - can either be a string or a function which itself calls `expect()`
   */
  stdout(expected: string | ((stdout: string, tempDir: string) => void)): this {
    this.expected_stdout = expected;
    return this;
  }

  stderr(expected: string | ((stderr: string, tempDir: string) => void)): this {
    this.expected_stderr = expected;
    return this;
  }

  /**
   * Makes this test use a temp directory:
   * - The shell's cwd will be set to the temp directory
   * - All FS functions on the `TestBuilder` will use this temp directory.
   * @returns
   */
  ensureTempDir(): this {
    this.getTempDir();
    return this;
  }

  error(expected?: ShellError | string | boolean): this {
    if (expected === undefined || expected === true) {
      this.expected_error = true;
    } else if (expected === false) {
      this.expected_error = false;
    } else {
      this.expected_error = expected;
    }
    return this;
  }

  exitCode(expected: number): this {
    this.expected_exit_code = expected;
    return this;
  }

  fileEquals(filename: string, expected: string): this {
    this.getTempDir();
    this.file_equals[filename] = expected;
    return this;
  }

  static tmpdir(): string {
    const tmp = os.tmpdir();
    return fs.mkdtempSync(join(tmp, "test_builder"));
  }

  setTempdir(tempdir: string): this {
    this.tempdir = tempdir;
    if (this.promise.type === "ok") {
      this.promise.val.cwd(this.tempdir!);
    }
    return this;
  }

  getTempDir(): string {
    if (this.tempdir === undefined) {
      this.tempdir = TestBuilder.tmpdir();
      if (this.promise.type === "ok") {
        this.promise.val.cwd(this.tempdir!);
      }
      return this.tempdir!;
    }
    return this.tempdir;
  }

  async run(): Promise<undefined> {
    if (this.promise.type === "err") {
      const err = this.promise.val;
      if (this.expected_error === undefined) throw err;
      if (this.expected_error === true) return undefined;
      if (this.expected_error === false) expect(err).toBeUndefined();
      if (typeof this.expected_error === "string") {
        expect(err.message).toEqual(this.expected_error);
      } else if (this.expected_error instanceof ShellError) {
        expect(err).toBeInstanceOf(ShellError);
        const e = err as ShellError;
        expect(e.exitCode).toEqual(this.expected_error.exitCode);
        expect(e.stdout.toString()).toEqual(this.expected_error.stdout.toString());
        expect(e.stderr.toString()).toEqual(this.expected_error.stderr.toString());
      }
      return undefined;
    }

    const output = await (this._env !== undefined ? this.promise.val.env(this._env) : this.promise.val);

    const { stdout, stderr, exitCode } = output!;
    const tempdir = this.tempdir || "NO_TEMP_DIR";
    if (this.expected_stdout !== undefined) {
      if (typeof this.expected_stdout === "string") {
        expect(stdout.toString()).toEqual(this.expected_stdout.replaceAll("$TEMP_DIR", tempdir));
      } else {
        this.expected_stdout(stdout.toString(), tempdir);
      }
    }
    if (this.expected_stderr !== undefined) {
      if (typeof this.expected_stderr === "string") {
        expect(stderr.toString()).toEqual(this.expected_stderr.replaceAll("$TEMP_DIR", tempdir));
      } else {
        this.expected_stderr(stderr.toString(), tempdir);
      }
    }
    if (this.expected_exit_code !== undefined) expect(exitCode).toEqual(this.expected_exit_code);

    for (const [filename, expected] of Object.entries(this.file_equals)) {
      const actual = await Bun.file(join(this.tempdir!, filename)).text();
      expect(actual).toEqual(expected);
    }

    for (const fsname of this._doesNotExist) {
      expect(fs.existsSync(join(this.tempdir!, fsname))).toBeFalsy();
    }

    // return output;
  }

  runAsTest(name: string) {
    // biome-ignore lint/complexity/noUselessThisAlias: <explanation>
    const tb = this;
    test(name, async () => {
      await tb.run();
    });
  }

  // async run(): Promise<undefined> {
  //   async function doTest(tb: TestBuilder) {
  //     if (tb.promise.type === "err") {
  //       const err = tb.promise.val;
  //       if (tb.expected_error === undefined) throw err;
  //       if (tb.expected_error === true) return undefined;
  //       if (tb.expected_error === false) expect(err).toBeUndefined();
  //       if (typeof tb.expected_error === "string") {
  //         expect(err.message).toEqual(tb.expected_error);
  //       }
  //       return undefined;
  //     }

  //     const output = await tb.promise.val;

  //     const { stdout, stderr, exitCode } = output!;
  //     if (tb.expected_stdout !== undefined) expect(stdout.toString()).toEqual(tb.expected_stdout);
  //     if (tb.expected_stderr !== undefined) expect(stderr.toString()).toEqual(tb.expected_stderr);
  //     if (tb.expected_exit_code !== undefined) expect(exitCode).toEqual(tb.expected_exit_code);

  //     for (const [filename, expected] of Object.entries(tb.file_equals)) {
  //       const actual = await Bun.file(filename).text();
  //       expect(actual).toEqual(expected);
  //     }
  //     return output;
  //   }

  //   if (this._testName !== undefined) {
  //     test(this._testName, async () => {
  //       await doTest(this);
  //     });
  //   }
  //   await doTest(this);
  // }
}
function generateRandomString(length: number): string {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const charactersLength = characters.length;

  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
}
