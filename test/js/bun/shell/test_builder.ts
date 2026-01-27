import { ShellError, ShellExpression } from "bun";
// import { tempDirWithFiles } from "harness";
import * as fs from "node:fs";
import * as os from "node:os";
import { join } from "node:path";
// import { bunExe } from "harness";

export function createTestBuilder(path: string) {
  var { describe, test, afterAll, beforeAll, expect, beforeEach, afterEach } = Bun.jest(path);

  class TestBuilder {
    _testName: string | undefined = undefined;

    expected_stdout: string | ((stdout: string, tempdir: string) => void) = "";
    expected_stderr: string | ((stderr: string, tempdir: string) => void) | { contains: string } = "";
    expected_exit_code: number | ((code: number) => void) = 0;
    expected_error: ShellError | string | boolean | undefined = undefined;
    file_equals: { [filename: string]: string | (() => string | Promise<string>) } = {};
    _doesNotExist: string[] = [];
    _timeout: number | undefined = undefined;

    tempdir: string | undefined = undefined;
    _env: { [key: string]: string } | undefined = undefined;
    _cwd: string | undefined = undefined;

    _miniCwd: string | undefined = undefined;
    _quiet: boolean = false;

    _testMini: boolean = false;
    _onlyMini: boolean = false;
    __insideExec: boolean = false;
    _scriptStr: TemplateStringsArray;
    _expresssions: ShellExpression[];

    _skipExecOnUnknownType: boolean = false;

    __todo: boolean | string = false;

    constructor(_scriptStr: TemplateStringsArray, _expressions: any[]) {
      this._scriptStr = _scriptStr;
      this._expresssions = _expressions;
    }

    UNEXPECTED_SUBSHELL_ERROR_CLOSE =
      "Unexpected `)`, subshells are currently not supported right now. Escape the `)` or open a GitHub issue.";

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
      return new TestBuilder(strings, expressions);
    }

    cwd(path: string): this {
      this._cwd = path;
      return this;
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
     * @param opts
     * @returns
     */
    testMini(opts?: { errorOnSupportedTemplate?: boolean; onlyMini?: boolean; cwd?: string }): this {
      this._testMini = true;
      this._skipExecOnUnknownType = opts?.errorOnSupportedTemplate ?? false;
      this._onlyMini = opts?.onlyMini ?? false;
      this._miniCwd = opts?.cwd;
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
      this._quiet = true;
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

    stderr_contains(expected: string): this {
      this.expected_stderr = { contains: expected };
      return this;
    }

    /**
     * Makes this test use a temp directory:
     * - The shell's cwd will be set to the temp directory
     * - All FS functions on the `TestBuilder` will use this temp directory.
     * @returns
     */
    ensureTempDir(str?: string): this {
      if (str !== undefined) {
        this.setTempdir(str);
      } else this.getTempDir();

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

    exitCode(expected: number | ((code: number) => void)): this {
      this.expected_exit_code = expected;
      return this;
    }

    fileEquals(filename: string, expected: string | (() => string | Promise<string>)): this {
      this.getTempDir();
      this.file_equals[filename] = expected;
      return this;
    }

    static tmpdir(): string {
      const tmp = os.tmpdir();
      return fs.realpathSync(fs.mkdtempSync(join(tmp, "test_builder")));
    }

    setTempdir(tempdir: string): this {
      this.tempdir = tempdir;
      return this;
    }

    newTempdir(): string {
      this.tempdir = undefined;
      return this.getTempDir();
    }

    getTempDir(): string {
      if (this.tempdir === undefined) {
        this.tempdir = TestBuilder.tmpdir();
        return this.tempdir!;
      }
      return this.tempdir;
    }

    timeout(ms: number): this {
      this._timeout = ms;
      return this;
    }

    async doChecks(stdout: Buffer, stderr: Buffer, exitCode: number): Promise<void> {
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
        } else if (typeof this.expected_stderr === "function") {
          this.expected_stderr(stderr.toString(), tempdir);
        } else {
          expect(stderr.toString()).toContain(this.expected_stderr.contains);
        }
      }
      if (typeof this.expected_exit_code === "number") {
        expect(exitCode).toEqual(this.expected_exit_code);
      } else if (typeof this.expected_exit_code === "function") this.expected_exit_code(exitCode);

      for (const [filename, expected_raw] of Object.entries(this.file_equals)) {
        const expected = typeof expected_raw === "string" ? expected_raw : await expected_raw();
        const actual = await Bun.file(join(this.tempdir!, filename)).text();
        expect(actual).toEqual(expected);
      }

      for (const fsname of this._doesNotExist) {
        expect(fs.existsSync(join(this.tempdir!, fsname))).toBeFalsy();
      }
    }

    async run(): Promise<undefined> {
      try {
        let finalPromise = Bun.$(this._scriptStr, ...this._expresssions);
        if (this.tempdir) finalPromise = finalPromise.cwd(this.tempdir);
        if (this._cwd) finalPromise = finalPromise.cwd(this._cwd);
        if (this._env) finalPromise = finalPromise.env(this._env);
        if (this._quiet) finalPromise = finalPromise.quiet();
        const output = await finalPromise;

        const { stdout, stderr, exitCode } = output;
        await this.doChecks(stdout, stderr, exitCode);
      } catch (err_) {
        const err: ShellError = err_ as any;
        const { stdout, stderr, exitCode } = err;
        if (this.expected_error === undefined) {
          if (stdout === undefined || stderr === undefined || exitCode === undefined) {
            throw err_;
          }
          this.doChecks(stdout, stderr, exitCode);
          return;
        }
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

      // return output;
    }

    todo(reason?: string): this {
      this.__todo = typeof reason === "string" ? reason : true;
      return this;
    }

    runAsTest(name: string) {
      // biome-ignore lint/complexity/noUselessThisAlias: <explanation>
      const tb = this;
      if (this.__todo) {
        test.todo(typeof this.__todo === "string" ? `${name} skipped: ${this.__todo}` : name, async () => {
          await tb.run();
        });
        return;
      } else {
        if (!this._onlyMini) {
          test(
            name,
            async () => {
              await tb.run();
            },
            this._timeout,
          );
        }

        if (this._testMini) {
          test(
            name + " (exec)",
            async () => {
              let cwd: string = "";
              if (tb._miniCwd === undefined) {
                cwd = tb.newTempdir();
              } else {
                tb.tempdir = tb._miniCwd;
                tb._cwd = tb._miniCwd;
                cwd = tb._cwd;
              }
              const joinedstr = tb.joinTemplate();
              await Bun.$`echo ${joinedstr} > script.bun.sh`.cwd(cwd);
              ((script: TemplateStringsArray, ...exprs: any[]) => {
                tb._scriptStr = script;
                tb._expresssions = exprs;
              })`${bunExe()} run script.bun.sh`;
              await tb.run();
            },
            this._timeout,
          );
        }
      }
    }

    generateRandomString(length: number): string {
      const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
      let result = "";
      const charactersLength = characters.length;

      for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
      }

      return result;
    }

    joinTemplate(): string {
      let buf = [];
      for (let i = 0; i < this._scriptStr.length; i++) {
        buf.push(this._scriptStr[i]);
        if (this._expresssions[i] !== undefined) {
          const expr = this._expresssions[i];
          this.processShellExpr(buf, expr);
        }
      }

      return buf.join("");
    }

    processShellExpr(buf: string[], expr: ShellExpression) {
      if (typeof expr === "string") {
        buf.push(Bun.$.escape(expr));
      } else if (typeof expr === "number") {
        buf.push(expr.toString());
      } else if (typeof expr?.raw === "string") {
        buf.push(Bun.$.escape(expr.raw));
      } else if (Array.isArray(expr)) {
        expr.forEach(e => this.processShellExpr(buf, e));
      } else {
        if (this._skipExecOnUnknownType) {
          console.warn(`Unexpected expression type: ${expr}\nSkipping.`);
          return;
        }
        throw new Error(`Unexpected expression type ${expr}`);
      }
    }
  }

  return TestBuilder;
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

export function bunExe() {
  if (process.platform === "win32") return process.execPath.replaceAll("\\", "/");
  return process.execPath;
}
