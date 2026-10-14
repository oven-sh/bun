import { dlopen } from "bun:ffi";
import { afterAll, describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isASAN,
  isDebug,
  isLinux,
  isMacOS,
  isMusl,
  isWindows,
  normalizeBunSnapshot,
  tempDir,
} from "harness";
import {
  chmodSync,
  chownSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { endChildren, spawn } from "../children";
import { inputs as lineEndingInputs } from "./line-endings.cases.ts";

afterAll(endChildren);

const command = [bunExe(), "fmt"];
/** Matches the start of an error. */
const anError = /^error: /m;

const env = { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: undefined };

/**
 * How `bun fmt` says why a file can't be formatted, with any configuration. It is how Bun prints every error: the line,
 * a caret under the place, the message, and where it is. Without `at` the error is about the whole file. The white space
 * at the end of the line is not shown, and neither is a line without anything else. The caret is right if every
 * character before it is one column wide. A blank line follows, which is not in here.
 */
function problem(file: string, message: string, at?: [line: number, column: number, text: string]) {
  if (!at) return `error: ${message}\n    at ${file}`;
  const [line, column] = at;
  const text = at[2].trimEnd();
  const shown = text && `${line} | ${text}\n${Buffer.alloc(`${line} | `.length + column - 1, " ").toString()}^\n`;
  return `${shown}error: ${message}\n    at ${file}:${line}:${column}`;
}

/** Matches a syntax error in `file`, whatever it says: an error with a line and a column. */
const syntaxErrorIn = (file: string) =>
  new RegExp(`^error: .+\\n    at ${file.replaceAll(".", "\\.")}:[0-9]+:[0-9]+$`, "m");

/** What is said about an end tag in HTML that closes nothing, in the words of Prettier. */
const closingTag = (name: string) =>
  `Unexpected closing tag "${name}". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags`;

const ugly = `const a = {b:1,  c:"two"}\nfunction f(x){return [x,\n'y']}\n`;
const formatted = `const a = { b: 1, c: "two" };\nfunction f(x) {\n  return [x, "y"];\n}\n`;
const wide = `const value = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, four);\n`;

type Options = {
  cwd?: string;
  stdin?: string;
  /** Files to read when the command has run. */
  reads?: string[];
  /** Called with the directory before the command runs. */
  before?: (dir: string) => void;
  env?: Record<string, string>;
};

async function format(files: Record<string, string>, args: string[], options: Options = {}) {
  using dir = tempDir("bun-format", files);
  options.before?.(String(dir));
  await using proc = spawn({
    cmd: [...command, ...args],
    env: { ...env, ...options.env },
    cwd: join(String(dir), options.cwd ?? "."),
    stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const read = (name: string) =>
    existsSync(join(String(dir), name)) ? readFileSync(join(String(dir), name), "utf8") : null;
  return {
    raw: stdout,
    stdout: normalizeBunSnapshot(stdout, String(dir)),
    stderr: normalizeBunSnapshot(stderr, String(dir)),
    exitCode,
    /** The seconds of the processor that it took: on a busy machine the clock says little. */
    cpu: Number(proc.resourceUsage()?.cpuTime.total ?? 0) / 1e6,
    files: Object.fromEntries((options.reads ?? []).map(name => [name, read(name)])),
  };
}

/**
 * How many times the processor time of `plain` the run `odd` took. Windows counts that time in ticks of 1/64 s, so a
 * short run can report 0: anything below a tick counts as one.
 */
const slowdown = (odd: { cpu: number }, plain: { cpu: number }) =>
  odd.cpu / Math.max(plain.cpu, isWindows ? 1 / 64 : 0);

/** Whether the temporary directory is in a repository. */
const isInRepository = (function look(directory: string): boolean {
  const isRoot = [".git", ".jj"].some(name => existsSync(join(directory, name)));
  return isRoot || (dirname(directory) !== directory && look(dirname(directory)));
})(realpathSync(tmpdir()));

/** The files that are not formatted, according to `-l`. */
async function different(files: Record<string, string>, args: string[], options?: Options) {
  const { stdout } = await format(files, ["-l", ...args], options);
  return stdout.split("\n").filter(Boolean);
}

describe.concurrent("bun fmt", () => {
  test("writes the files that change, and prints their names", async () => {
    const result = await format({ "a.js": ugly, "b.ts": formatted, "src/c.tsx": ugly }, [], {
      reads: ["a.js", "b.ts", "src/c.tsx"],
    });
    expect(result.files).toEqual({ "a.js": formatted, "b.ts": formatted, "src/c.tsx": formatted });
    expect(result.stdout).toMatchInlineSnapshot(`
      "a.js
      src/c.tsx"
    `);
    expect(result.stderr).toMatchInlineSnapshot(`"Formatted 2 files, 1 unchanged"`);
    expect(result.exitCode).toBe(0);
  });

  // By runs of Prettier 3.9.9 and oxfmt 0.72.0, which start with "[error] " and "Error: ". Both say it before they look at the
  // files, the patterns or the configuration.
  describe("flags that say what the run does, and exclude each other", () => {
    const together = "error: Cannot use --check and --list-different together.";
    const twice = (flag: string) => `error: argument \`${flag}\` cannot be used multiple times in this context`;
    const second = (flag: string, first: string) =>
      `error: \`${flag}\` cannot be used at the same time as \`${first}\``;
    const [prettier, oxfmt] = [{ ".prettierrc": "{}" }, { ".oxfmtrc.json": "{}" }];
    test.each<[string, Record<string, string>, string[], string]>([
      ["Prettier", prettier, ["-l", "--check", "."], together],
      ["Prettier", prettier, ["--check", "-l", "."], together],
      ["Prettier", prettier, ["-l", "-c", "good.js"], together],
      ["Prettier", prettier, ["--list-different", "--check", "--write", "."], together],
      ["Prettier", prettier, ["--check", "--list-different"], together],
      ["Prettier", prettier, ["--check", "--list-different", "nothing.js"], together],
      ["Prettier", prettier, ["--check", "--list-different", "--config", "missing.json", "."], together],
      ["Prettier", prettier, ["--check", "--list-different", "--find-config-path", "a.js"], together],
      ["Prettier", prettier, ["-l", "--check", "--stdin-filepath", "a.js"], together],
      ["Prettier", prettier, ["-l", "--check", "--log-level", "silent", "good.js"], ""],
      ["Prettier", { ".prettierrc": "{" }, ["-l", "--check", "."], together],
      [
        "Prettier",
        prettier,
        ["-l", "--check", "--no-config", "--config", "x", "."],
        "error: Cannot use --no-config and --config together.",
      ],
      ["no configuration", {}, ["-l", "--check", "."], together],
      ["oxfmt", oxfmt, ["--list-different", "--check", "."], second("--check", "--list-different")],
      ["oxfmt", oxfmt, ["--check", "--list-different", "."], second("--list-different", "--check")],
      ["oxfmt", oxfmt, ["--list-different", "--write", "."], second("--write", "--list-different")],
      ["oxfmt", oxfmt, ["--write", "--list-different", "."], second("--list-different", "--write")],
      ["oxfmt", oxfmt, ["--check", "--write", "."], second("--write", "--check")],
      ["oxfmt", oxfmt, ["--write", "--check", "--list-different", "."], second("--check", "--write")],
      ["oxfmt", oxfmt, ["--write", "--write", "."], twice("--write")],
      ["oxfmt", oxfmt, ["--check", "--check", "--list-different", "."], twice("--check")],
      ["oxfmt", oxfmt, ["--check", "--list-different", "--check", "."], second("--list-different", "--check")],
      ["oxfmt", oxfmt, ["--check", "--list-different", "nothing.js"], second("--list-different", "--check")],
      ["oxfmt", oxfmt, ["--check", "--write", "--config", "missing.json", "."], second("--write", "--check")],
      ["oxfmt", oxfmt, ["--stdin-filepath", "a.js", "--check"], second("--check", "--stdin-filepath")],
      ["oxfmt", oxfmt, ["--check", "--stdin-filepath=a.js"], second("--stdin-filepath", "--check")],
      ["oxfmt", oxfmt, ["--init", "--check"], second("--check", "--init")],
      ["oxfmt", { ".oxfmtrc.json": "{" }, ["--list-different", "--write", "."], second("--write", "--list-different")],
    ])("%s: %j %j", async (_, configuration, args, stderr) => {
      const files = { ...configuration, "good.js": formatted, "bad.js": ugly };
      const result = await format(files, args, { reads: Object.keys(files), stdin: ugly });
      expect({ ...result, cpu: 0, raw: "" }).toEqual({ raw: "", stdout: "", stderr, exitCode: 1, cpu: 0, files });
    });

    test.each<[Record<string, string>, string[], string, number, string]>([
      // The last word on a flag counts.
      [prettier, ["--check", "--list-different", "--no-check", "bad.js"], "bad.js", 1, ugly],
      [
        prettier,
        ["--check", "--list-different", "--no-list-different", "good.js"],
        "Checking formatting...\nAll matched files use Prettier code style!",
        0,
        ugly,
      ],
      [prettier, ["-l", "--write", "bad.js"], "bad.js", 0, formatted],
      [
        prettier,
        ["--check", "--check", "good.js"],
        "Checking formatting...\nAll matched files use Prettier code style!",
        0,
        ugly,
      ],
      // `-c` with a path behind it is `--config` for oxfmt.
      [oxfmt, ["-c", ".oxfmtrc.json", "--list-different", "bad.js"], "bad.js", 1, ugly],
    ])("these do not: %j %j", async (configuration, args, stdout, exitCode, bad) => {
      const result = await format({ ...configuration, "good.js": formatted, "bad.js": ugly }, args, {
        reads: ["bad.js"],
      });
      expect(result.stdout).toBe(stdout);
      expect(result.files).toEqual({ "bad.js": bad });
      expect(result.exitCode).toBe(exitCode);
    });
  });

  // By runs of Prettier 3.9.9: what is on the command line is `Number(text)`; an integer is what is its own `Math.floor`.
  describe("printWidth and tabWidth", () => {
    const text = `f(${"a, ".repeat(40)}a);\nif (a) {\n\tb(c, { d: 1 });\n}\n`;
    test.each<[Record<string, string>, string[], string]>([
      [{}, ["--print-width", "1e3"], "73086142db5ba22c6ea91ef3a0a7b1946ed3b177"],
      [{}, ["--print-width=2.0"], "e4cc4ef9d5036279f56298dd8089b052c320ad7b"],
      [{}, ["--print-width=0x10"], "38fccfacad6f6f01cb53a41c2819b9f6e101ad5f"],
      [{}, ["--print-width=+5"], "e4cc4ef9d5036279f56298dd8089b052c320ad7b"],
      [{}, ["--print-width="], "e4cc4ef9d5036279f56298dd8089b052c320ad7b"],
      [{}, ["--print-width=-1"], "e4cc4ef9d5036279f56298dd8089b052c320ad7b"],
      [{}, ["--print-width=-0"], "e4cc4ef9d5036279f56298dd8089b052c320ad7b"],
      [{}, ["--print-width", "Infinity"], "73086142db5ba22c6ea91ef3a0a7b1946ed3b177"],
      [{}, ["--print-width=-Infinity"], "e4cc4ef9d5036279f56298dd8089b052c320ad7b"],
      [{}, ["--print-width", "1e20"], "73086142db5ba22c6ea91ef3a0a7b1946ed3b177"],
      [{ ".prettierrc": '{"printWidth": -1}' }, [], "e4cc4ef9d5036279f56298dd8089b052c320ad7b"],
      [{ ".prettierrc.yaml": "printWidth: -1\n" }, [], "e4cc4ef9d5036279f56298dd8089b052c320ad7b"],
      [{ ".prettierrc.toml": "printWidth = -1\n" }, [], "e4cc4ef9d5036279f56298dd8089b052c320ad7b"],
      [{ ".prettierrc.yaml": "printWidth: .inf\n" }, [], "73086142db5ba22c6ea91ef3a0a7b1946ed3b177"],
      [{ ".prettierrc.yaml": "printWidth: -.inf\n" }, [], "e4cc4ef9d5036279f56298dd8089b052c320ad7b"],
      [{ ".prettierrc.toml": "printWidth = inf\n" }, [], "73086142db5ba22c6ea91ef3a0a7b1946ed3b177"],
      [{ ".prettierrc.toml": "printWidth = -inf\n" }, [], "e4cc4ef9d5036279f56298dd8089b052c320ad7b"],
      [{ ".prettierrc.json5": "{ printWidth: Infinity }" }, [], "73086142db5ba22c6ea91ef3a0a7b1946ed3b177"],
      [{ ".prettierrc.json5": "{ printWidth: -Infinity }" }, [], "e4cc4ef9d5036279f56298dd8089b052c320ad7b"],
      [
        { "prettier.config.mjs": "export default { printWidth: -Infinity };" },
        [],
        "e4cc4ef9d5036279f56298dd8089b052c320ad7b",
      ],
      [
        { ".prettierrc": '{"overrides": [{"files": "*.js", "options": {"printWidth": -1}}]}' },
        [],
        "e4cc4ef9d5036279f56298dd8089b052c320ad7b",
      ],
      [{}, ["--tab-width", "256"], "98cd880581dcf1c45c95ee04ee491afe161db8d6"],
      [{}, ["--tab-width=1000"], "19b91609f52f0b51bc0e425ef945d326e6d73ed8"],
      [{}, ["--tab-width", "1e3"], "19b91609f52f0b51bc0e425ef945d326e6d73ed8"],
      [{}, ["--tab-width=0x10"], "d7e62efdd2e86b3f79b1d89c0c1b58f822445456"],
      [{}, ["--tab-width=-0"], "7d460c931c7c7b750fce254b4ed949d2942ec2fb"],
      [{ ".prettierrc": '{"tabWidth": 256}' }, [], "98cd880581dcf1c45c95ee04ee491afe161db8d6"],
      [{ ".prettierrc": '{"tabWidth": 70000}' }, [], "b76f5819101710e92181ff63e8a0e1011319cc3e"],
      [{ ".prettierrc.toml": "tabWidth = 1_000\n" }, [], "19b91609f52f0b51bc0e425ef945d326e6d73ed8"],
      [
        { ".editorconfig": "root = true\n[*]\nindent_style = space\nindent_size = 1000\n" },
        [],
        "19b91609f52f0b51bc0e425ef945d326e6d73ed8",
      ],
      [
        { ".editorconfig": "root = true\n[*]\nindent_style = space\ntab_width = 256\n" },
        [],
        "98cd880581dcf1c45c95ee04ee491afe161db8d6",
      ],
    ])("take what Prettier takes: %j %j", async (configuration, args, sha1) => {
      const result = await format(configuration, [...args, "--stdin-filepath", "a.js"], { stdin: text });
      expect(result.stderr).toBe("");
      expect(new Bun.CryptoHasher("sha1").update(result.raw).digest("hex")).toBe(sha1);
      expect(result.exitCode).toBe(0);
    });

    test.each<[Record<string, string>, string[]]>([
      [{}, ["--tab-width=4294967295"]],
      [{ ".prettierrc": '{"tabWidth": 1e20}' }, []],
    ])("a tabWidth that makes the code too long for a string is an error: %j %j", async (configuration, args) => {
      const result = await format(configuration, [...args, "--stdin-filepath", "a.js"], { stdin: text });
      expect({ stdout: result.raw, stderr: result.stderr, exitCode: result.exitCode }).toEqual({
        stdout: "",
        stderr: problem("a.js", "The formatted code is too long for a string"),
        exitCode: 2,
      });
    });

    test.each<[Record<string, string>, string[], string, number]>([
      [{}, ["--print-width", "1.5"], "error: Invalid --print-width value. Expected an integer, but received 1.5.", 1],
      [{}, ["--print-width=abc"], "error: Invalid --print-width value. Expected an integer, but received null.", 1],
      [{}, ["--print-width", "1e-1"], "error: Invalid --print-width value. Expected an integer, but received 0.1.", 1],
      [{}, ["--print-width=1_000"], "error: Invalid --print-width value. Expected an integer, but received null.", 1],
      [{}, ["--tab-width=1.5"], "error: Invalid --tab-width value. Expected an integer, but received 1.5.", 1],
      [{}, ["--tab-width", "NaN"], "error: Invalid --tab-width value. Expected an integer, but received null.", 1],
      [
        { ".prettierrc": '{"printWidth": 1.5}' },
        [],
        "error: Invalid printWidth value. Expected an integer, but received 1.5.",
        1,
      ],
      [
        { ".prettierrc": '{"printWidth": "5"}' },
        [],
        'error: Invalid printWidth value. Expected an integer, but received "5".',
        1,
      ],
      [
        { ".prettierrc": '{"printWidth": true}' },
        [],
        "error: Invalid printWidth value. Expected an integer, but received true.",
        1,
      ],
      [
        { ".prettierrc": '{"printWidth": null}' },
        [],
        "error: Invalid printWidth value. Expected an integer, but received null.",
        1,
      ],
      [
        { ".prettierrc.yaml": "tabWidth: abc\n" },
        [],
        'error: Invalid tabWidth value. Expected an integer, but received "abc".',
        1,
      ],
      [
        { "prettier.config.mjs": "export default { tabWidth: NaN };" },
        [],
        "error: Invalid tabWidth value. Expected an integer, but received null.",
        1,
      ],
      [
        { ".prettierrc": '{"overrides": [{"files": "*.js", "options": {"tabWidth": 0.5}}]}' },
        [],
        "error: Invalid tabWidth value. Expected an integer, but received 0.5.",
        1,
      ],
      [
        { ".prettierrc": '{"printWidth": 1.5}' },
        ["--print-width", "1.5"],
        "error: Invalid --print-width value. Expected an integer, but received 1.5.",
        1,
      ],
      [
        { ".prettierrc": '{"printWidth": 1.5}' },
        ["--print-width", "80"],
        "error: Invalid printWidth value. Expected an integer, but received 1.5.",
        1,
      ],
      [
        { ".prettierrc": "{}" },
        ["--print-width", "2.5", "--config-precedence", "prefer-file"],
        "error: Invalid --print-width value. Expected an integer, but received 2.5.",
        1,
      ],
    ])("are refused in the words of Prettier: %j %j", async (configuration, args, stderr, exitCode) => {
      const result = await format(configuration, [...args, "--stdin-filepath", "a.js"], { stdin: text });
      expect({ stdout: result.raw, stderr: result.stderr.split("\n")[0], exitCode }).toEqual({
        stdout: "",
        stderr,
        exitCode,
      });
      expect(result.exitCode).toBe(exitCode);
    });

    test("the run ends at the first file whose configuration has one that is no integer", async () => {
      const files = { ".prettierrc": `{ "printWidth": 1.5 }`, "a.js": ugly, "b.js": ugly };
      const result = await format(files, ["--check", "a.js", "b.js"]);
      expect(result.stdout).toBe("Checking formatting...");
      expect(result.stderr).toBe("error: Invalid printWidth value. Expected an integer, but received 1.5.");
      expect(result.exitCode).toBe(1);
    });
  });

  // Prettier's `listDifferent`: it has nothing to say about what is going to be written, and then nothing is printed either.
  test.each([
    ["--check", "--write"],
    ["--write", "--check"],
    ["-l", "--write"],
    ["--check", "--write", "--log-level", "warn"],
  ])("standard input with %s %s: nothing is said, and nothing is printed", async (...args) => {
    const result = await format({ ".prettierrc": "{}" }, [...args, "--stdin-filepath", "a.js"], { stdin: ugly });
    expect({ stdout: result.raw, stderr: result.stderr, exitCode: result.exitCode }).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
  });

  test("does not touch a file that is formatted", async () => {
    let before = 0;
    using dir = tempDir("bun-format", { "a.js": formatted });
    before = statSync(join(String(dir), "a.js")).mtimeMs;
    await using proc = spawn({ cmd: [...command, "a.js"], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(0);
    expect(statSync(join(String(dir), "a.js")).mtimeMs).toBe(before);
  });

  // Prettier and oxfmt write into the file (`fs.writeFile`, `fs::write`): all but its text stays as it is.
  describe("the file that is written", () => {
    const isRoot = process.getuid?.() === 0;
    /** `bun fmt` in `dir`, which is still there afterwards. `before`: what starts the command. */
    async function write(dir: string, args: string[], before: string[] = []) {
      await using proc = spawn({
        cmd: [...before, ...command, ...args],
        env,
        cwd: dir,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      return { stderr, exitCode };
    }
    const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");

    test("is still the file that its other names stand for", async () => {
      using dir = tempDir("bun-format", { "a.js": ugly });
      linkSync(join(String(dir), "a.js"), join(String(dir), "other-name.txt"));
      const { exitCode } = await write(String(dir), ["a.js"]);
      expect([read(String(dir), "a.js"), read(String(dir), "other-name.txt")]).toEqual([formatted, formatted]);
      expect(statSync(join(String(dir), "a.js")).nlink).toBe(2);
      expect(readdirSync(String(dir)).sort()).toEqual(["a.js", "other-name.txt"]);
      expect(exitCode).toBe(0);
    });

    // What a new file gets is less, unless the mask of the process is 0.
    test.skipIf(isWindows)("keeps its mode, whatever the mask of the process", async () => {
      using dir = tempDir("bun-format", { "a.js": ugly, "b.js": ugly });
      chmodSync(join(String(dir), "a.js"), 0o664);
      chmodSync(join(String(dir), "b.js"), 0o777);
      const { exitCode } = await write(String(dir), [], ["sh", "-c", 'umask 077; exec "$0" "$@"']);
      expect([read(String(dir), "a.js"), read(String(dir), "b.js")]).toEqual([formatted, formatted]);
      expect(["a.js", "b.js"].map(name => statSync(join(String(dir), name)).mode & 0o7777)).toEqual([0o664, 0o777]);
      expect(exitCode).toBe(0);
    });

    // Prettier and oxfmt write there. Nobody reads the links of a project that he has checked out.
    test("is not one that a link leads to out of the repository", async () => {
      const git = "ref: refs/heads/main\n";
      const link = (dir: string) => symlinkSync(join(dir, "outside", "c"), join(dir, "project", "c"), "junction");
      const options = { cwd: "project", before: link, reads: ["outside/c/d.js"] };
      const [inRepository, inNone] = await Promise.all([
        format({ "outside/c/d.js": ugly, "project/.git/HEAD": git }, ["c/d.js"], options),
        format({ "outside/c/d.js": ugly, "project/a.js": formatted }, ["c/d.js"], options),
      ]);
      for (const result of [inRepository, inNone]) {
        expect(result.files).toEqual({ "outside/c/d.js": ugly });
        expect(result.stderr).toContain(
          'error: Unable to write file "c/d.js":\nit is a symlink to a file outside the repository',
        );
        expect(result.exitCode).toBe(2);
      }
    });

    test("can be one that a link leads to in the repository", async () => {
      const result = await format(
        { ".git/HEAD": "ref: refs/heads/main\n", "shared/d.js": ugly, "packages/a/a.js": formatted },
        ["shared/d.js"],
        {
          cwd: "packages/a",
          before: dir => symlinkSync(join(dir, "shared"), join(dir, "packages", "a", "shared"), "junction"),
          reads: ["shared/d.js"],
        },
      );
      expect(result.files).toEqual({ "shared/d.js": formatted });
      expect(result.exitCode).toBe(0);
    });

    // A name has 255 bytes at most, so no other file can be called after this one. On Windows the path is too long besides.
    test.skipIf(isWindows)("can have a name that nothing can be added to", async () => {
      const name = `${Buffer.alloc(246, "a")}.tsx`;
      const result = await format({ [name]: ugly }, [], { reads: [name] });
      expect(result.files).toEqual({ [name]: formatted });
      expect(result.exitCode).toBe(0);
    });

    // In a container, say, with the project of a user mounted into it.
    test.skipIf(!isRoot)("keeps its owner if root formats it", async () => {
      using dir = tempDir("bun-format", { "a.js": ugly });
      try {
        chownSync(join(String(dir), "a.js"), 12345, 12345);
      } catch {
        // The root of a container that does not have these.
        return;
      }
      const { exitCode } = await write(String(dir), []);
      const { uid, gid } = statSync(join(String(dir), "a.js"));
      expect([read(String(dir), "a.js"), uid, gid]).toEqual([formatted, 12345, 12345]);
      expect(exitCode).toBe(0);
    });

    // Prettier needs nothing of the directory.
    test.skipIf(isWindows || isRoot)("can be in a directory that nothing can be added to", async () => {
      using dir = tempDir("bun-format", { "src/a.js": ugly });
      chmodSync(join(String(dir), "src"), 0o555);
      try {
        const { stderr, exitCode } = await write(String(dir), []);
        expect(stderr).not.toMatch(anError);
        expect(read(String(dir), "src/a.js")).toBe(formatted);
        expect(exitCode).toBe(0);
      } finally {
        chmodSync(join(String(dir), "src"), 0o755);
      }
    });

    // `fs.writeFile` fails with EACCES, on Windows with EPERM. A version control system that hands out files read-only until
    // they are checked out means it.
    test.skipIf(isRoot)("is not replaced if it is read-only, and that is an error", async () => {
      using dir = tempDir("bun-format", { "a.js": ugly, "b.js": ugly });
      chmodSync(join(String(dir), "a.js"), 0o444);
      try {
        const { stderr, exitCode } = await write(String(dir), ["a.js", "b.js"]);
        expect([read(String(dir), "a.js"), read(String(dir), "b.js")]).toEqual([ugly, formatted]);
        expect(stderr).toMatch(/^error: Unable to write file "a\.js":\r?\n(EACCES|EPERM)/);
        expect(readdirSync(String(dir)).sort()).toEqual(["a.js", "b.js"]);
        expect(exitCode).toBe(2);
      } finally {
        chmodSync(join(String(dir), "a.js"), 0o666);
      }
    });
  });

  test("a path that is longer than any system takes is not there", async () => {
    // Linux takes 4,096 bytes, macOS 1,024, Windows 32,767 characters, which is also all that its command line has.
    const long = Buffer.alloc(isWindows ? 30_000 : 40_000, "a/").toString() + "a.js";
    const result = await format({ "a.js": ugly }, [long, "a.js"], { reads: ["a.js"] });
    expect(result.stderr).toStartWith('error: No files matching the pattern were found: "a/a/');
    expect(result.files).toEqual({ "a.js": formatted });
    expect(result.exitCode).toBe(2);
  });

  test("--check writes nothing and exits with 1", async () => {
    const files = { ".prettierrc": "{}\n", "a.js": ugly, "b.js": formatted, "c.js": ugly };
    const result = await format(files, ["--check"], { reads: ["a.js"] });
    expect(result.files).toEqual({ "a.js": ugly });
    expect(result.stdout).toMatchInlineSnapshot(`"Checking formatting..."`);
    expect(result.stderr).toMatchInlineSnapshot(`
      "[warn] a.js
      [warn] c.js
      [warn] Code style issues found in 2 files. Run bun fmt to fix."
    `);
    expect(result.exitCode).toBe(1);
  });

  test("--check exits with 0 if everything is formatted", async () => {
    const result = await format({ ".prettierrc": "{}\n", "a.js": formatted }, ["--check"]);
    expect(result.stdout).toMatchInlineSnapshot(`
      "Checking formatting...
      All matched files use Prettier code style!"
    `);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  test("in a project of oxfmt, what is said about a run is what oxfmt says", async () => {
    const files = { "a.js": ugly, "b.js": formatted, "src/c.js": ugly, ".oxfmtrc.json": "{}\n" };
    const said = (text: string) => text.replace(/\d+ms/g, "0ms").replace(/\d+ threads/, "1 threads");
    const check = await format(files, ["--check"]);
    expect(said(check.raw)).toBe(
      "Checking formatting...\n\na.js (0ms)\nsrc/c.js (0ms)\n\n" +
        "Format issues found in above 2 files. Run without `--check` to fix.\n" +
        "Finished in 0ms on 4 files using 1 threads.\n",
    );
    expect(check.stderr).toBe("");
    expect(check.exitCode).toBe(1);
    const clean = await format({ "b.js": formatted, ".oxfmtrc.json": "{}\n" }, ["--check"]);
    expect(said(clean.raw)).toBe(
      "Checking formatting...\n\nAll matched files use the correct format.\n" +
        "Finished in 0ms on 2 files using 1 threads.\n",
    );
    expect(clean.exitCode).toBe(0);
    const written = await format(files, [], { reads: ["a.js"] });
    expect(said(written.raw)).toBe("Finished in 0ms on 4 files using 1 threads.\n");
    expect(written.stderr).toBe("");
    expect(written.files["a.js"]).toBe(formatted);
    expect(written.exitCode).toBe(0);
    const listed = await format(files, ["--list-different"]);
    expect(listed.raw).toBe("a.js\nsrc/c.js\n");
    expect(listed.stderr).toBe("");
    expect(listed.exitCode).toBe(1);
    const broken = await format({ ...files, "d.js": "d = (\n" }, ["--check"]);
    expect(said(broken.raw)).toBe("Checking formatting...\n\na.js (0ms)\nsrc/c.js (0ms)\n");
    expect(broken.stderr).toEndWith("Error occurred when checking code style in the above files.");
    expect(broken.exitCode).toBe(2);
    const none = await format(files, ["--check", "nothing.js"]);
    expect(none.raw).toBe("Checking formatting...\n\n");
    expect(none.exitCode).toBe(2);
  });

  test("--list-different", async () => {
    const result = await format({ "a.js": ugly, "b.js": formatted, "src/c.js": ugly }, ["-l"], { reads: ["a.js"] });
    expect(result.files).toEqual({ "a.js": ugly });
    expect(result.raw).toBe("a.js\nsrc/c.js\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });

  test("a syntax error is reported, the other files are formatted, and the exit code is 2", async () => {
    const result = await format({ "a.js": "const = 1;\n", "b.js": ugly }, [], { reads: ["a.js", "b.js"] });
    expect(result.files).toEqual({ "a.js": "const = 1;\n", "b.js": formatted });
    expect(result.stderr).toStartWith(problem("a.js", "Variable declaration expected.", [1, 7, "const = 1;"]) + "\n\n");
    expect(result.exitCode).toBe(2);
  });

  test("a syntax error says what is wrong and where, in every language", async () => {
    // One for each language and kind of refusal: the file, what is said about it, and the line and the column.
    const cases: [string, string, string, number, number][] = [
      ["string.css", 'a {\n  b: "x\n}\n', "Unclosed string", 2, 6],
      ["block.css", "a {\n  b: c;\n", "Unclosed block", 1, 1],
      ["brace.css", "a {\n}\n}\n", 'Unexpected "}"', 3, 1],
      ["comment.css", "a {\n  /* b\n}\n", "Unclosed comment", 2, 3],
      ["bracket.css", "a {\n  b: c(1;\n}\n", "Unclosed bracket", 2, 7],
      ["url.css", "a {\n  b: url(c;\n}\n", "Unclosed bracket", 2, 9],
      ["word.css", "a {\n  b c;\n}\n", "Expected a declaration or a rule", 2, 3],
      ["at.css", "@ a;\n", 'Expected a name after "@"', 1, 1],
      ["colon.css", "a {\n  b: c: d;\n}\n", 'Unexpected ":"', 2, 7],
      ["first-colon.css", "a {\n  : b;\n  c: d:\n}\n", 'Unexpected ":"', 3, 7],
      ["no-name.css", "a {\n  (): ;\n}\n", "Expected a property name", 2, 3],
      ["two-words.css", "a {\n  b c: d;\n}\n", 'Expected ":"', 2, 5],
      ["selector.css", "{\n  a: b;\n}\n", "Expected a selector", 1, 1],
      ["custom-selector.css", "@custom-selector a;\n", "Invalid at-rule parameters", 1, 1],
      ["value.css", "a {\n  b: c);\n}\n", "Invalid value", 2, 6],
      ["interpolation.scss", "a {\n  b: #{$c;\n", "Unclosed interpolation", 2, 6],
      ["string.scss", 'a {\n  b: "x;\n}\n', "Unclosed string", 2, 6],
      ["nested.scss", "a {\n  b: c: {\n    d: e;\n  }\n}\n", 'Unexpected ":"', 2, 7],
      ["mixin.less", "a {\n  .b(;\n}\n", "Unclosed bracket", 2, 5],
      ["each.less", "each(@a, {\n", "Unclosed bracket", 1, 5],
      ["word.less", "a {\n  b c;\n}\n", "Expected a declaration or a rule", 2, 3],
      ["end.graphql", "query {\n  a\n", "Unexpected end of file", 3, 1],
      ["name.graphql", "query {\n}\n", "Expected a name", 2, 1],
      ["value.graphql", "query { a(b: ) }\n", "Expected a value", 1, 14],
      ["string.graphql", 'query { a(b: "x) }\n', "Unclosed string", 1, 14],
      ["block-string.graphql", '"""\na\n', "Unclosed string", 1, 1],
      ["escape.graphql", 'query { a(b: "\\x") }\n', "Invalid escape sequence", 1, 15],
      ["definition.graphql", "foo A { b }\n", "Expected a definition", 1, 1],
      ["colon.graphql", "query ($a) { b }\n", 'Expected ":"', 1, 10],
      ["character.graphql", "query { a ? }\n", "Unexpected character", 1, 11],
      ["number.graphql", "query { a(b: 01) }\n", "Invalid number", 1, 14],
      ["digit.graphql", "query { a(b: 1.) }\n", "Expected a digit", 1, 16],
      ["extension.graphql", "extend type A\n", "This extension is empty", 1, 14],
      ["location.graphql", "directive @a on B\n", "Expected a directive location", 1, 17],
      ["brace.graphql", "fragment A on B\n@c d\n", 'Expected "{"', 2, 4],
      ["parenthesis.graphql", "query { a(b: 1 }\n", "Expected a name", 1, 16],
      ["bracket.graphql", "type A { b: [C }\n", 'Expected "]"', 1, 16],
      ["closing-brace.graphql", "schema { query: A ]\n", "Expected a name", 1, 19],
      ["block.hbs", "<div>\n  {{#if a}}\n</div>\n", "Unclosed block", 2, 3],
      ["mustache.hbs", "<div>\n  {{a\n</div>\n", "Unexpected character", 3, 1],
      ["end.hbs", "{{a", "Unexpected end of file", 1, 4],
      ["end-tag.hbs", "<div>\n<p>\n</div>\n", "This end tag does not match the open element", 3, 1],
      ["name.hbs", "{{#if a}}b{{/each}}\n", "This name does not match the open block", 1, 11],
      ["no-start.hbs", "</div>\n", "This end tag has no start tag", 1, 1],
      ["hash.hbs", "{{a b=}}\n", "Unexpected token", 1, 6],
      ["in-tag.hbs", "<div {{#if a}}b{{/if}}></div>\n", "A block can only be inside an element or another block", 1, 6],
      ["partial.hbs", "{{> a}}\n", "Partials, decorators and raw blocks are not supported", 1, 1],
      ["void.hbs", "<input></input>\n", "This element cannot have an end tag", 1, 8],
      ["element.hbs", "{{#if a}}<div>{{/if}}\n", "Unclosed element", 1, 10],
      ["comment.hbs", "{{!-- a\n", "Unclosed comment", 1, 1],
      ["short-comment.hbs", "{{! a\n", "Unclosed comment", 1, 1],
      ["string.hbs", '{{a "b}}\n', "Unclosed string", 1, 5],
      ["segment.hbs", "{{a [b}}\n", "Unclosed bracket", 1, 5],
      ["path.hbs", "{{a/../b}}\n", '"..", "." and "this" can only be at the start of a path', 1, 8],
      ["params.hbs", "{{#each a as ||}}{{/each}}\n", "Expected a name", 1, 15],
      ["tag-params.hbs", "<A as |b>\n</A>\n", "Invalid block parameters", 1, 9],
      ["attribute.hbs", '<div></div a="b">\n', "An end tag cannot have attributes", 1, 12],
      ["self-closing.hbs", "<div></div/>\n", "An end tag cannot be self-closing", 1, 6],
      [
        "unquoted.hbs",
        "<div a=b{{c}}></div>\n",
        "An attribute value that mixes text and a mustache needs quotes",
        1,
        8,
      ],
      ["tag-name.hbs", "<{{a}}></a>\n", "A mustache is not allowed here", 1, 2],
      ["equals.hbs", "<div =a></div>\n", "Unexpected character", 1, 6],
      ["sexpr.hbs", "{{a (b}}\n", 'Expected ")"', 1, 7],
      ["doctype.hbs", "<!DOCTYPE a PUBLIC b>\n", "Invalid doctype", 1, 20],
      ["close.hbs", "{{a b=c d}}\n", 'Expected "}}"', 1, 9],
      ["mustache-comment.hbs", "<div a={{! b }}></div>\n", "A comment is not allowed here", 1, 8],
      ["raw.hbs", "{{{{a}}}} b\n", "Unclosed block", 1, 10],
      ["colon.hbs", "<:></:>\n", "Invalid element name", 1, 1],
      ["mapping.yaml", "a: b: c\n", "Unexpected token", 1, 5],
      ["flow.yaml", "a: [1, 2\nb: 3\n", "Unexpected token", 2, 1],
      ["string.yaml", 'a: "x\n', "Unexpected character", 2, 1],
      ["single.yaml", "a: 'x\n", "Unexpected character", 2, 1],
      ["tab.yaml", "\ta: 1\n", "Tabs cannot be used for indentation", 1, 3],
      ["anchors.yaml", "a: &x &y 1\n", "A node can have at most one anchor and one tag", 1, 7],
      ["token.yaml", "- a\nb: 1\n", "Unexpected token", 2, 1],
      ["directive.yaml", "%YAML 1.2\na: 1\n", "Unexpected token", 2, 1],
      ["directive-end.yaml", "%YAML 1.2\n", "Unexpected token", 2, 1],
      ["bad-directive.yaml", "%YAML a b\n---\n", "Unexpected character", 1, 7],
      ["header.yaml", "a: |x\n  b\n", "Unexpected character", 1, 5],
      ["tag.yaml", "a: !b!c d\n", "This tag cannot be resolved", 1, 5],
      ["alias.yaml", "a: &b *c\n", "Unexpected token", 1, 7],
      ["anchor.yaml", "a: & b\n", "Unexpected character", 1, 5],
      ["plain.yaml", "a: @b\n", "Unexpected token", 1, 4],
      ["escape.yaml", 'a: "\\q"\n', "Unexpected character", 1, 6],
      ["comma.yaml", "a: [b c: d e]\n[a b]\n", "Unexpected token", 3, 1],
      ["missing-comma.yaml", "[a: b c: d]\n", "Unexpected token", 1, 8],
      ["comment.yaml", 'a: "b"#c\n', "Unexpected character", 1, 7],
      ["key.yaml", "[a\nb: c]\n", 'A key without "?" must be on one line', 2, 2],
      ["colon.yaml", "a: 1\nb\n", "Unexpected token", 3, 1],
      ["indent.yaml", "a:\n  - b\n - c\n", "Unexpected token", 3, 2],
      ["block-in-flow.yaml", "[a: |\n  b\n]\n", "Unexpected token", 1, 5],
      ["seq-prop.yaml", "a: &b - c\n", "Unexpected token", 1, 7],
      ["doc-start.yaml", "--- a: b\n", "Unexpected token", 1, 6],
      ["indicator.yaml", "&a ? b\n: c\n", "This cannot be formatted", 1, 1],
      ["scalar-indent.yaml", "a: |2\n b\n", "Unexpected token", 2, 2],
      ["no-comma.yaml", "[: ? 1]\n", "Unexpected token", 1, 4],
      ["comma-or-colon.yaml", '["a" "b"]\n', "Unexpected token", 1, 7],
      ["set.yaml", "{!!set}\n", "This cannot be formatted", 1, 2],
      ["token.json", '{"a": }\n', "Unexpected token", 1, 7],
      ["end.json", '{"a": 1\n', "Unexpected end of file", 2, 1],
      ["string.json", '{"a": "x\n}\n', "Unclosed string", 1, 7],
      ["escape.json", '{"a": "\\x"}\n', "Invalid escape sequence", 1, 7],
      ["comment.json", '{"a": 1} /* b\n', "Unclosed comment", 1, 10],
      ["more.json", '{"a": 1} 2\n', "Expected end of file", 1, 10],
      ["only-comments.json", "// a\n", "Unexpected end of file", 2, 1],
      ["word.json", "nul\n", "Unexpected token", 1, 1],
      ["sign-before-a-string.json", "+''\n", "Unexpected token", 1, 2],
      ["sign-before-a-word.json5", "-null\n", "Unexpected token", 1, 2],
    ];
    const result = await format(Object.fromEntries(cases.map(([name, text]) => [name, text])), []);
    // `format` makes a `/` of every backslash in what is printed.
    const expected = cases.map(([name, text, message, line, column]) =>
      problem(name, message, [line, column, text.split("\n")[line - 1].replaceAll("\\", "/")]),
    );
    expect(result.stderr.split("\n\n").sort()).toEqual([...expected, "Formatted 0 files, 0 unchanged"].sort());
    expect(result.exitCode).toBe(2);
  });

  test("a syntax error is printed as Bun prints every error: the line, a caret, the message, and where it is", async () => {
    const files = {
      // A byte order mark does not count, `\r\n` is one line break, and a column is a UTF-16 code unit.
      // The caret is as far to the right as the characters before it are wide. A tab counts as one column.
      "a.css": '\uFEFFa {\r\n  /* é😀 */ b: "x\r\n}\r\n',
      "b.css": 'a {\n  b: c;\n}\n\n\nd {\n  e: "f\n}\n\ng {\n  h: i;\n}\nj {\n}\n',
      "c.js": "const a = ;\n",
      "d.yaml": "a:\n\t- b\n",
    };
    const result = await format(files, []);
    expect(result.stderr).toMatchInlineSnapshot(`
      "2 |   /* é😀 */ b: "x
                         ^
      error: Unclosed string
          at a.css:2:16

      7 |   e: "f
               ^
      error: Unclosed string
          at b.css:7:6

      1 | const a = ;
                    ^
      error: Expression expected.
          at c.js:1:11

      2 | 	- b
           ^
      error: Tabs cannot be used for indentation
          at d.yaml:2:2

      Formatted 0 files, 0 unchanged"
    `);
    expect(result.exitCode).toBe(2);
    const stdin = await format({}, ["--stdin-filepath", "a.css"], { stdin: "a {\n" });
    expect(stdin.stderr).toMatchInlineSnapshot(`
      "1 | a {
          ^
      error: Unclosed block
          at a.css:1:1"
    `);
    expect(stdin.exitCode).toBe(2);
    // The configuration of another tool makes no difference.
    for (const configuration of [{ ".prettierrc": "{}\n" }, { ".oxfmtrc.json": "{}\n" }]) {
      const result = await format({ ...configuration, "b.css": files["b.css"] }, ["b.css"]);
      expect(result.stderr).toStartWith(problem("b.css", "Unclosed string", [7, 6, '  e: "f']) + "\n\n");
      expect(result.exitCode).toBe(2);
    }
  });

  // `bun lint` and `bun build` count the lines like this too, and don't count the mark either.
  test.each<[string, string, number, number, string]>([
    ["\\r\\n is one line break", "let b;\r\nlet c;\r\nconst a = ; let d;\r\n", 3, 11, "const a = ; let d;"],
    ["\\r is a line break", "let b;\rlet c;\rconst a = ; let d;\r", 3, 11, "const a = ; let d;"],
    ["a byte order mark does not count", "\uFEFFconst a = ; let d;\n", 1, 11, "const a = ; let d;"],
    ["nor on a later line", "\uFEFFlet b;\r\nconst a = ; let d;\r\n", 2, 11, "const a = ; let d;"],
    ["U+2028 is a line break", "let b;\u2028let c;\u2028const a = ; let d;\n", 3, 11, "const a = ; let d;"],
    ["U+2029 is a line break", "let b;\u2029const a = ; let d;\n", 2, 11, "const a = ; let d;"],
  ])("where a syntax error in JavaScript is: %s", async (_, text, line, column, shown) => {
    for (const name of ["a.js", "a.ts"]) {
      const result = await format({}, ["--stdin-filepath", name], { stdin: text });
      expect(result.stderr).toBe(problem(name, "Expression expected.", [line, column, shown]));
      expect(result.exitCode).toBe(2);
    }
  });

  test("a syntax error in TOML is in the words of Bun's parser, and a warning: oxfmt passes over such a file", async () => {
    const files = { "a.toml": 'a = 1\nb = "c\n', ".oxfmtrc.json": "{}\n" };
    const warning = [
      '2 | b = "c',
      "        ^",
      "warn: Unterminated string; newlines must be escaped in basic strings",
      "   at a.toml:2:5",
    ].join("\n");
    for (const flags of [[], ["--check"], ["-l"]]) {
      const result = await format(files, flags, { reads: ["a.toml"] });
      expect(result.stderr).toBe(warning);
      expect(result.files["a.toml"]).toBe(files["a.toml"]);
      expect(result.exitCode).toBe(0);
    }
  });

  describe("without semicolons, a statement that would go on with the line before it starts with one", () => {
    // Prettier 3.9.9 writes none before these, which makes `c(..)` of two statements, and `let c` of two others.
    test.each([
      [
        "the parentheses of --experimental-ternaries around a condition",
        ["--experimental-ternaries"],
        "a ? b : c;\n(d ? e : f) ? g : h;\n",
        "a ? b : c\n;(\n  d ? e : f\n) ?\n  g\n: h\n",
        "a ? b : c\n(\n  d ? e : f\n) ?\n  g\n: h\n",
      ],
      [
        "the same around a condition that does not fit on the line",
        ["--experimental-ternaries", "--print-width=20"],
        "a;\nbbbbbbbbbb && cccccccccc ? d : e;\nf && g ? h : i;\n",
        "a\n;(\n  bbbbbbbbbb &&\n  cccccccccc\n) ?\n  d\n: e\nf && g ? h : i\n",
        "a\n(\n  bbbbbbbbbb &&\n  cccccccccc\n) ?\n  d\n: e\nf && g ? h : i\n",
      ],
      ["a variable that is called let", [], "a;\nlet;\nc;\n", "a\n;(let)\nc\n", "a\nlet\nc\n"],
    ])("%s", async (_, flags, text, right, ofPrettier) => {
      expect(right).not.toBe(ofPrettier);
      const result = await format({ "a.js": text }, ["--no-semi", ...flags], { reads: ["a.js"] });
      expect(result.files).toEqual({ "a.js": right });
      expect(result.exitCode).toBe(0);
      const checked = await format({ "a.js": text, "b.js": right }, ["--no-semi", ...flags, "--debug-check"]);
      expect(checked.stderr).toBe("");
      expect(checked.stdout.split("\n")).toEqual(["a.js", "b.js"]);
      expect(checked.exitCode).toBe(0);
      expect((await format({ "a.js": right }, ["--no-semi", ...flags, "--check"])).exitCode).toBe(0);
    });
  });

  test("in TypeScript no line ends with what looks like type arguments", async () => {
    // Prettier 3.9.9 prints `a <\n  b >\n  c;`, which is `a<b>; c;`.
    const files = { "a.ts": "a < b > c;\n", "b.js": "a < b > c;\n" };
    const flags = ["--print-width=5"];
    const result = await format(files, flags, { reads: ["a.ts", "b.js"] });
    expect(result.files).toEqual({ "a.ts": "a <\n  b > c;\n", "b.js": "a <\n  b >\n  c;\n" });
    expect(result.exitCode).toBe(0);
    const checked = await format(files, [...flags, "--debug-check"]);
    expect(checked.stderr).toBe("");
    expect(checked.exitCode).toBe(0);
  });

  test("a vertical tab next to a comment is white space", async () => {
    const text = "function a(b\v/* c */) {}\nfunction d(/* e */\vf) {}\nconst g = /* h */\vi;\n";
    const result = await format({ "a.js": text }, [], { reads: ["a.js"] });
    expect(result.files).toEqual({ "a.js": text.replaceAll("\v", " ") });
    expect(result.exitCode).toBe(0);
  });

  test.each(["\v", "\f"])("%j between a comment and a type is white space", async space => {
    const text = `let a: /* b */${space}C;\nfunction d(e: /* f */${space}G) {}\n`;
    const result = await format({ "a.ts": text }, [], { reads: ["a.ts"] });
    expect(result.files).toEqual({ "a.ts": text.replaceAll(space, " ") });
    expect(result.exitCode).toBe(0);
  });

  test("Handlebars", async () => {
    const result = await format({ "a.hbs": '<div   class="a  b">{{foo   bar}}</div>\n', "b.handlebars": "{{a}}" }, [], {
      reads: ["a.hbs", "b.handlebars"],
    });
    expect(result.files).toEqual({ "a.hbs": '<div class="a b">{{foo bar}}</div>', "b.handlebars": "{{a}}" });
    expect(result.stdout).toBe("a.hbs");
    expect(result.exitCode).toBe(0);
  });

  describe("a template of which Prettier changes the meaning", () => {
    // The template, what Bun makes of it, and what Prettier 3.9.9 makes of it, which says something else or cannot be parsed
    // any more. Where nothing else is clearly right, the smallest part around the place stays as it is written.
    const templates: Record<string, [before: string, after: string, ofPrettier: string]> = {
      "doctype": ["<!DOCTYPE html>\n<p   ></p>\n", "<!DOCTYPE html>\n<p></p>", "<p></p>"],
      "character-behind-less-than": ["a <3 b   ></b>\n", "a <3 b   ></b>\n", "a <b></b>"],
      "start-of-a-comment": ["<!---a--><p   ></p>\n", "<!---a--><p></p>", "<!-----><p></p>"],
      "mustache-where-a-comment-starts": ["<!--{{a}}--><p   ></p>\n", "<!--{{a}}--><p></p>", "{{a}}<!----><p></p>"],
      "open-tag-at-the-end": ["<p   ></p><a", "<p   ></p><a", "<p></p>"],
      "escaped-mustache-in-a-comment": [
        "<!-- \\{{a}} --><p   ></p>\n",
        "<!-- \\{{a}} --><p></p>",
        "<!-- {{a}} --><p></p>",
      ],
      "escaped-mustache-in-a-name": ["<a   \\{{b}}></a>\n", "<a   \\{{b}}></a>", "<a {{b}}></a>"],
      "escaped-mustache-in-pre": ["<pre   >\\{{a}}</pre>\n", "<pre>\\{{a}}</pre>", "<pre>{{a}}</pre>"],
      "escaped-mustache-in-style": [
        '<style   >a{b:"\\{{c}}"}</style>\n',
        '<style>a{b:"\\{{c}}"}</style>',
        '<style>a{b:"{{c}}"}</style>',
      ],
      "white-space-next-to-a-mustache-in-style": [
        "<style   >a{margin: 0 {{b}} 0}</style>\n",
        "<style>a{margin: 0 {{b}} 0}</style>",
        "<style>a{margin: 0{{b}}0}</style>",
      ],
      "no-break-space-that-is-all-of-a-block": ["{{#a   }}\u00a0{{/a}}\n", "{{#a}}\u00a0{{/a}}", "{{#a}}{{/a}}"],
      "no-break-space-that-is-all-of-a-component": ["<A   >\u00a0</A>\n", "<A>\u00a0</A>", "<A />"],
      "no-break-space-in-a-class": ['<a   class="b\u00a0c"></a>\n', '<a class="b\u00a0c"></a>', '<a class="b c"></a>'],
      "escaped-mustache-that-is-ignored": [
        "{{! prettier-ignore }}a\\{{b}}<p   ></p>\n",
        "{{! prettier-ignore }}a\\{{b}}<p></p>",
        "{{! prettier-ignore }}a{{b}}<p></p>",
      ],
      "backslash-before-a-mustache-in-a-value": [
        '<a   b="c\\\\{{d}}"></a>\n',
        '<a b="c\\\\{{d}}"></a>',
        '<a b="c\\{{d}}"></a>',
      ],
      "backslash-before-a-comment": ["a\\\\{{!   b }}\n", "a\\\\{{!   b }}", "a\\{{!   b }}"],
      "backslash-before-the-end-of-a-block": ["{{#a   }}b\\\\{{/a}}\n", "{{#a}}b\\\\{{/a}}", "{{#a}}b\\{{/a}}"],
      "both-quotes-in-a-value": ["<a   b=c\"d'e></a>\n", '<a b="c&quot;d\'e"></a>', '<a b="c"d\'e"></a>'],
      "lines-of-a-script": [
        "<script   >\n  // a\n  b()\n</script>\n",
        "<script>\n  // a\n  b()\n</script>",
        "<script>\n  // a b()\n</script>",
      ],
      "lines-of-a-textarea": [
        "<textarea   >\n  a\n    b\n</textarea>\n",
        "<textarea>\n  a\n    b\n</textarea>",
        "<textarea>\n  a b\n</textarea>",
      ],
      "white-space-further-down-in-pre": [
        "<pre   ><b>a\n  b</b></pre>\n",
        "<pre><b>a\n  b</b></pre>",
        "<pre><b>a b</b></pre>",
      ],
      "children-of-what-counts-as-void": ["<imG   >a</imG>\n", "<imG>a</imG>", "<imG />"],
      "this-and-a-slash": ["{{this/a   }}\n", "{{this/a}}", "{{a}}"],
      "this-behind-an-at": ["{{@this.a   }}\n", "{{@this.a}}", "{{@a}}"],
      "this-in-brackets": ["{{[this]   }}\n", "{{[this]}}", "{{this.this}}"],
      "empty-brackets": ["{{[].a   }}\n", "{{[].a}}", "{{a}}"],
      "arguments-of-a-literal": ['{{"a"   b}}\n', '{{"a"   b}}', '{{"a"}}'],
      "hash-that-is-called": ["{{(a=b)   c}}\n", "{{(a=b)   c}}", "{{ c}}"],
      "raw-block": ["{{{{a}}}}   {{b}} {{{{/a}}}}\n", "{{{{a}}}}   {{b}} {{{{/a}}}}", "{{#a}} \\{{b}} {{/a}}"],
      "key-in-brackets": ["{{a   [b c]=d}}\n", "{{a [b c]=d}}", "{{a b c=d}}"],
      "literal-in-brackets": ["{{a   [true]}}\n", "{{a [true]}}", "{{a true}}"],
      "number-in-brackets": ["{{a   [-1]}}\n", "{{a [-1]}}", "{{a -1}}"],
      "else-in-brackets": ["{{[else]   }}\n", "{{[else]}}", "{{else}}"],
      "argument-in-brackets": ["{{a   [@b]}}\n", "{{a [@b]}}", "{{a @b}}"],
      "bracket-in-brackets": ["{{a   [b\\]]}}\n", "{{a [b\\]]}}", "{{a [b]]}}"],
      "line-break-in-brackets": ["{{a   [b\nc]}}\n", "{{a [b\nc]}}", "{{a [[b\nc]]}}"],
      "private-name": ["{{a.#b   }}\n", "{{a.#b}}", "{{a.[#b]}}"],
      "number-with-an-exponent": ["{{a   1000000000000000000000}}\n", "{{a 1000000000000000000000}}", "{{a 1e+21}}"],
      "tilde-in-three-braces": ["{{{a   }~}}\n", "{{{a}~}}", "{{{a~}}}"],
      "three-braces-around-a-modifier": ["<a   {{{b}}}></a>\n", "<a {{{b}}}></a>", "<a {{b}}></a>"],
      "tilde-at-the-end-of-a-comment": ["{{!--   a ~--}}\n", "{{!--   a ~--}}", "{{!   a ~}}"],
      "dashes-at-the-start-of-a-comment": ["{{!----   a --}}\n", "{{!----   a --}}", "{{!--   a }}"],
      "rest-of-the-name-behind-else": [
        "{{#a   }}{{else if.b c}}{{/a}}\n",
        "{{#a}}{{else if.b c}}{{/a}}",
        "{{#a}}{{else if c}}{{/a}}",
      ],
      "tilde-of-an-if-that-is-all-that-follows-else": [
        "{{#a   }}{{else}}{{~#if b}}c{{/if}}{{/a}}\n",
        "{{#a}}{{else}}{{~#if b}}c{{/if}}{{/a}}",
        "{{#a}}{{else if b}}c{{/a}}",
      ],
      "indented-mark-of-a-document-in-front-matter": [
        "---\n ---\na: b\n---\n<p   ></p>\n",
        "---\n ---\na: b\n---\n\n<p></p>",
        "---\n---\na: b\n---\n\n<p></p>",
      ],
      "no-break-space-that-is-all-of-the-template": ["\u00a0\n", "\u00a0", ""],
      "white-space-that-is-all-of-a-block-in-a-textarea": [
        "<textarea   >{{#a}} {{/a}}</textarea>\n",
        "<textarea>{{#a}} {{/a}}</textarea>",
        "<textarea>{{#a}}{{/a}}</textarea>",
      ],
      "white-space-that-is-all-of-a-block-in-pre": [
        "<pre   >{{#a}} {{/a}}</pre>\n",
        "<pre>{{#a}} {{/a}}</pre>",
        "<pre>{{#a}}{{/a}}</pre>",
      ],
      "tilde-of-an-else-if-in-an-if-that-is-all-that-follows-else": [
        "{{#z   }}y{{else}}{{#if a}}b{{~else if c}}d {{/if}}{{/z}}\n",
        "{{#z}}y{{else}}{{#if a}}b{{~else if c}}d {{/if}}{{/z}}",
        "{{#z}}y{{else if a}}b{{~else if c}}d {{/z}}",
      ],
      "name-in-brackets-behind-else": [
        "{{#[a b]   }}{{else [a b] c}}{{/[a b]}}\n",
        "{{#[a b]}}{{else [a b] c}}{{/[a b]}}",
        "{{#[a b]}}{{else a b c}}{{/[a b]}}",
      ],
      "empty-brackets-and-a-slash": ["{{[]/a   }}\n", "{{[]/a}}", "{{a}}"],
      "empty-brackets-behind-an-at": ["{{@[].a   }}\n", "{{@[].a}}", "{{@a}}"],
      "empty-brackets-at-the-end": ["{{a.[]   }}\n", "{{a.[]}}", "{{a.}}"],
      "empty-brackets-in-arguments": ["{{a   [].b c=[].d}}\n", "{{a [].b c=[].d}}", "{{a b c=d}}"],
      "doctype-with-identifiers": [
        '<!doctype html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n<p   ></p>\n',
        '<!doctype html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">\n<p></p>',
        "<p></p>",
      ],
      "this-twice": ["{{this.this   }}\n", "{{this.this}}", "{{this}}"],
      "dots-before-a-name": ["{{a   ...b}}\n", "{{a ...b}}", "{{a b}}"],
      "slash-in-brackets": ["{{[a/b]   }}\n", "{{[a/b]}}", "{{a/b}}"],
      "hash-that-is-called-in-parentheses": ["{{a   ((b=c) d)}}\n", "{{a   ((b=c) d)}}", "{{a ( d)}}"],
      "number-with-a-negative-exponent": ["{{a   0.0000001}}\n", "{{a 0.0000001}}", "{{a 1e-7}}"],
      "mustache-where-a-comment-may-end": [
        "<!-- a-{{b}} --><p   ></p>\n",
        "<!-- a-{{b}} --><p></p>",
        "{{b}}<!-- a- --><p></p>",
      ],
      "blank-behind-less-than": ["< a>b</a><p   ></p>\n", "< a>b</a><p   ></p>\n", "<a>b</a><p></p>"],
      "columns-behind-a-line-separator": [
        'a\n\u2028{{~! b ~}} <p {{c}} d="e" {{f}} g></p> <!-- {{h}} -->\n\u2029{{! prettier-ignore }} {{  i  }} {{!-- j --~}}\n{{k\n\u2028 l}} {{~! m }}\n',
        'a \u2028{{~! b ~}}\n<p {{c}} d="e" {{f}} g></p>\n<!-- {{h}} -->\n\u2029{{! prettier-ignore }}\n{{  i  }}\n{{! j ~}}\n{{k l}}\n{{~! m }}',
        'a \u2028{{! b }}\n<p {{c}} d="e" {{f}} g></p>\n<!--  {{h} -->\n\u2029\u2029{{! prettier-ignore }\n {{  i  }\n{{! j }}\n{{k l}}\n{{! m }}',
      ],
    };
    // These look like it, but Handlebars reads what Prettier prints as it reads the template.
    const harmless: Record<string, [before: string, after: string]> = {
      "inverted-block": ["{{^a   }}b{{else}}c{{/a}}\n", "{{#a}}c{{else}}b{{/a}}"],
      "block-parameter-in-brackets": ["{{#a   as |[b] c|}}{{/a}}\n", "{{#a as |[b] c|}}{{/a}}"],
      "backslash-at-the-end-of-a-string": ['{{a   "b\\"}}\n', '{{a "b\\"}}'],
      "line-separator-behind-a-line-break": ["a\n\u2028{{b   }}\n", "a \u2028{{b}}"],
    };
    const all = Object.entries({ ...templates, ...harmless });
    const files = Object.fromEntries(all.map(([name, it]) => [`${name}.hbs`, it[0]]));
    const written = Object.fromEntries(all.map(([name, it]) => [`${name}.hbs`, it[1]]));

    test("says the same afterwards", async () => {
      for (const [, after, ofPrettier] of Object.values(templates)) expect(after).not.toBe(ofPrettier);
      const result = await format(files, [], { reads: Object.keys(files) });
      expect(result.files).toEqual(written);
      expect(result.exitCode).toBe(0);
    });

    test.each([
      ["no config", {}],
      [".prettierrc", { ".prettierrc": "{}\n" }],
      [".oxfmtrc.json", { ".oxfmtrc.json": "{}\n" }],
    ])("with %s", async (_, config: Record<string, string>) => {
      const result = await format({ ...config, ...files }, Object.keys(files), { reads: Object.keys(files) });
      expect(result.files).toEqual(written);
      expect(result.exitCode).toBe(0);
    });

    test("--debug-check has nothing to say about it", async () => {
      const result = await format(files, ["--debug-check"], { reads: Object.keys(files) });
      expect(result.files).toEqual(files);
      expect(result.stderr).toBe("");
      expect(result.stdout.split("\n").sort()).toEqual(Object.keys(files).sort());
      expect(result.exitCode).toBe(0);
    });

    test("what is written is formatted", async () => {
      expect(await different(written, [])).toEqual([]);
    });

    test("where white space does not count, a word and an escaped mustache stay two words", async () => {
      // Prettier 3.9.9 prints `p\\{{a}} {{q}}`.
      const flags = ["--html-whitespace-sensitivity=ignore"];
      const result = await format({ "a.hbs": "p \\{{a}} {{q   }}\n" }, flags, { reads: ["a.hbs"] });
      expect(result.files).toEqual({ "a.hbs": "p \\{{a}} {{q}}" });
      expect(result.exitCode).toBe(0);
    });

    test("standard input", async () => {
      const [before, after] = templates.doctype;
      const result = await format({}, ["--stdin-filepath", "a.hbs"], { stdin: before });
      expect(result.raw).toBe(after);
      expect(result.exitCode).toBe(0);
    });

    test("in a block of code in Markdown", async () => {
      const text = "#   a\n\n```hbs\n<!DOCTYPE html>\n<p   ></p>\n```\n\n```hbs\n<p   ></p>\n```\n";
      const result = await format({ "a.md": text }, [], { reads: ["a.md"] });
      expect(result.files).toEqual({
        "a.md": "# a\n\n```hbs\n<!DOCTYPE html>\n<p></p>\n```\n\n```hbs\n<p></p>\n```\n",
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Markdown of which Prettier changes the meaning", () => {
    // The text, what Bun makes of it, and what Prettier 3.9.9 makes of it: it gives two emphases that touch the same marker,
    // which makes one of them, or none.
    test.each([
      ["x   *a*_b_\n", "x *a*_b_\n", "x _a__b_\n"],
      ["x   _a_*b*\n", "x _a_*b*\n", "x _a__b_\n"],
      ["x   **a**__b__\n", "x **a**__b__\n", "x **a****b**\n"],
      ["x   ***a******b***\n", "x ***a******b***\n", "x _**a**__**b**_\n"],
      ["-   *a*_b_*c*\n", "- *a*_b_*c*\n", "- _a__b__c_\n"],
    ])("%j", async (before, after, ofPrettier) => {
      expect(after).not.toBe(ofPrettier);
      const result = await format({ "a.md": before, "b.md": after }, [], { reads: ["a.md", "b.md"] });
      expect(result.files).toEqual({ "a.md": after, "b.md": after });
      expect(result.exitCode).toBe(0);
    });

    // Known: Bun prints what Prettier 3.9.9 prints for these, and a CommonMark parser reads that as something else. All are
    // emphasis three deep, or runs of `*` and `_` that are text in an emphasis. Telling them from `*foo_bar*`, of which
    // `_foo_bar_` is right, takes the rules for delimiter runs.
    test.each([
      ["**a****a**\n", "**a\\****a**\n"],
      ["*b **a*b*** c*\n", "*b \\**a*b*** c*\n"],
      ["*b _a_*b* c*\n", "*b *a**b* c*\n"],
      ["*b _*a*_ c*\n", "*b _*a*\\_ c*\n"],
      ["*b *_a_* c*\n", "_b **a** c_\n"],
      ["**b __**a**__ c**\n", "**b __**a**\\__ c**\n"],
      ["**__a__****__a__**\n", "****a********a****\n"],
      ["*b a__b__c c*\n", "_b a__b_\\_c c_\n"],
      ["*b __a__b c*\n", "_b \\__a_\\_b c_\n"],
      ["**b __a__b c**\n", "**b \\__a_\\_b c**\n"],
      ["*b **(a)**b c*\n", "*b **(a)*_b c_\n"],
      ["*b _\u4e2d_a c*\n", "_b _\u4e2d_a c_\n"],
      ["*b a_\u4e2d_ c*\n", "_b a_\u4e2d_ c_\n"],
    ])("known: %j", async (before, ofPrettier) => {
      const result = await format({ "a.md": before }, [], { reads: ["a.md"] });
      expect(result.files).toEqual({ "a.md": ofPrettier });
    });
  });

  test("a folded scalar of YAML that keeps its line breaks has as many with --prose-wrap=never", async () => {
    // Prettier 3.9.9 prints `k: >+\n  a\n  \n  \n\nl: m\n`, which has one more.
    const result = await format({ "a.yaml": "k: >+\n  a\n\n\nl:   m\n" }, ["--prose-wrap=never"], {
      reads: ["a.yaml"],
    });
    expect(result.files).toEqual({ "a.yaml": "k: >+\n  a\n\n\nl: m\n" });
    expect(result.exitCode).toBe(0);
  });

  describe("an escaped blank at the end of the parameters of an at-rule", () => {
    // Prettier 3.9.9 prints `@extend .a\\;`: the backslash escapes the `;`.
    const names = ["extend", "include", "media", "supports", "container", "layer", "import", "custom"];
    test.each(["a.css", "a.scss", "a.less"])("%s", async file => {
      const before = names.map(name => `x{@${name}   .a\\ ;}\n@${name} .a\\ ;\n`).join("") + "@last .a\\ ";
      const after = names.map(name => `x {\n  @${name} .a\\ ;\n}\n@${name} .a\\ ;\n`).join("") + "@last .a\\ ;\n";
      const result = await format({ [file]: before }, [], { reads: [file] });
      expect(result.files).toEqual({ [file]: after });
      expect(result.exitCode).toBe(0);
      expect(await different({ [file]: after }, [])).toEqual([]);
    });

    test("before a parenthesis, and not twice where Prettier has one", async () => {
      // Prettier 3.9.9 prints `@media (a\\) {`. What it prints for the second is right.
      const files = { "a.scss": "@media (a\\ ){b{c:d}}\n@each   .a\\ ;\n" };
      const result = await format(files, [], { reads: ["a.scss"] });
      expect(result.files).toEqual({ "a.scss": "@media (a\\ ) {\n  b {\n    c: d;\n  }\n}\n@each .a\\ ;\n" });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("a selector without a namespace", () => {
    // The selector, what Bun makes of it, and what Prettier 3.9.9 makes of it.
    test.each([
      ["x |b", "x |b", "x|b"],
      ["x,|b,y", "x,\n|b,\ny", "x,\n,|b,\ny"],
    ])("%j", async (before, after, ofPrettier) => {
      expect(after).not.toBe(ofPrettier);
      const written = `${after} {\n  c: d;\n}\n`;
      const result = await format({ "a.css": `${before}{c:d}\n`, "b.css": written }, [], { reads: ["a.css", "b.css"] });
      expect(result.files).toEqual({ "a.css": written, "b.css": written });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("a backslash in a value of a style sheet", () => {
    // The value, what Bun makes of it, and what Prettier 3.9.9 makes of it: it writes nothing behind a word with a backslash.
    test.each([
      ["Font\\ Awesome\\ 5", "Font\\ Awesome\\ 5", "Font\\Awesome\\5"],
      ["a\\b   c", "a\\b c", "a\\bc"],
      ["d\\  e", "d\\  e", "d\\e"],
      ["d\\ -5", "d\\ -5", "d\\-5"],
      ["d\\ ", "d\\ ", "d\\"],
      ["(a\\ )", "(a\\ )", "(a\\)"],
      ["f(b a\\ )", "f(b a\\ )", "f(b a\\)"],
      ["f(a\\ , b)", "f(a\\ , b)", "f(a\\, b)"],
      ["a\\ , b", "a\\ , b", "a\\, b"],
      // What the backslash escapes here is no blank, and Prettier is right.
      ["\\@a   1\\/3", "\\@a 1\\/3", null],
      ["d\\\\   e", "d\\\\ e", "d\\\\e"],
      ["x d\\e   f g", "x d\\e f g", "x d\\ef g"],
    ])("%j", async (before, after, ofPrettier) => {
      expect(after).not.toBe(ofPrettier);
      const files = Object.fromEntries(["a.css", "b.scss", "c.less"].map(name => [name, `a{b:${before}}\n`]));
      const result = await format(files, [], { reads: Object.keys(files) });
      const written = `a {\n  b: ${after};\n}\n`;
      expect(result.files).toEqual({ "a.css": written, "b.scss": written, "c.less": written });
      expect(result.exitCode).toBe(0);
      expect(await different({ "a.css": written }, [])).toEqual([]);
    });
  });

  describe("YAML of which Prettier changes a value", () => {
    // The text, what Bun makes of it, and what Prettier 3.9.9 makes of it: a key with one line break more, a scalar that has
    // become a marker, a byte order mark that was the start of a key, and a key that cannot be read.
    test.each([
      ["? |+\n  a\n\n:   m\n", "? |+\n  a\n\n: m\n", "? |+\n  a\n\n\n: m\n"],
      ["k:   l\n? >+\n  a\n\n", "k: l\n? >+\n  a\n\n", "k: l\n? >+\n  a\n\n\n"],
      ["---   ---\n", "--- ---\n", "---\n---\n"],
      ["---   ... x\n", "--- ... x\n", "---\n... x\n"],
      ["? \ufeffa\n:   m\n", "? \ufeffa\n: m\n", "\ufeffa: m\n"],
      ["? {a\n  b: c}\n:   m\n", "? { ? a\n      b\n    : c }\n: m\n", "{ ? a\n      b\n    : c }: m\n"],
    ])("%j", async (before, after, ofPrettier) => {
      expect(after).not.toBe(ofPrettier);
      expect(Bun.YAML.parse(after)).toEqual(Bun.YAML.parse(before));
      const result = await format({ "a.yaml": before, "b.yaml": after }, [], { reads: ["a.yaml", "b.yaml"] });
      expect(result.files).toEqual({ "a.yaml": after, "b.yaml": after });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("front matter that would end early", () => {
    // Prettier 3.9.9 formats the YAML, which puts the second `---` at the start of its line: there the front matter ends.
    const frontMatter = "---\n ---\na: b\n---\n";
    test.each([
      ["a.md", "\n#   c\n", "\n# c\n"],
      ["a.mdx", "\n#   c\n", "\n# c\n"],
      ["a.css", "a{b:c}\n", "\na {\n  b: c;\n}\n"],
      ["a.scss", "a{b:c}\n", "\na {\n  b: c;\n}\n"],
      ["a.html", "<p   >c</p>\n", "\n<p>c</p>\n"],
    ])("%s", async (name, before, after) => {
      const result = await format({ [name]: frontMatter + before }, [], { reads: [name] });
      expect(result.files).toEqual({ [name]: frontMatter + after });
      expect(result.exitCode).toBe(0);
      expect(await different({ [name]: frontMatter + after }, [])).toEqual([]);
    });
  });

  test("HTML, Vue, Angular templates, MJML", async () => {
    const files = {
      "a.html": '<div   class="b  a"><p>c</p><script>let d=1</script><style>e{f:g}</style></div>\n',
      "b.vue":
        '<template><a   :b="c+d" @e="f( )">{{g|h}}</a></template>\n<script setup lang="ts">\nconst i:number=1\n</script>\n',
      "c.component.html": '@if (a;as b) {<p   [c]="d|e:f" (g)="h( )">{{i|j}}</p>}\n',
      "d.mjml": "<mjml><mj-body><mj-text   >a</mj-text></mj-body></mjml>\n",
    };
    const result = await format(files, [], { reads: Object.keys(files) });
    expect(result.files).toEqual({
      "a.html":
        '<div class="b a">\n  <p>c</p>\n  <script>\n    let d = 1;\n  </script>\n  <style>\n    e {\n      f: g;\n    }\n  </style>\n</div>\n',
      "b.vue":
        '<template>\n  <a :b="c + d" @e="f()">{{ g | h }}</a>\n</template>\n<script setup lang="ts">\nconst i: number = 1;\n</script>\n',
      "c.component.html": '@if (a; as b) {\n  <p [c]="d | e: f" (g)="h()">{{ i | j }}</p>\n}\n',
      "d.mjml": "<mjml\n  ><mj-body><mj-text>a</mj-text></mj-body></mjml\n>\n",
    });
    expect(result.stdout.split("\n")).toEqual(Object.keys(files));
    expect(result.exitCode).toBe(0);
  });

  describe("the options that HTML and Vue read, from wherever they are set", () => {
    const long = Buffer.alloc(40, "j").toString();
    // The option, its value, the flag, a file that is formatted without it, and the same with it.
    const options = [
      [
        "vueIndentScriptAndStyle",
        true,
        "--vue-indent-script-and-style",
        "<script>\nlet a = 1;\n</script>\n",
        "<script>\n  let a = 1;\n</script>\n",
      ],
      [
        "htmlWhitespaceSensitivity",
        "strict",
        "--html-whitespace-sensitivity=strict",
        "<template>\n  <div>a</div>\n</template>\n",
        "<template>\n  <div> a </div>\n</template>\n",
      ],
      [
        "bracketSameLine",
        true,
        "--bracket-same-line",
        `<template>\n  <div\n    i="${long}"\n    k="${long}"\n    m="${long}"\n  >\n    o\n  </div>\n</template>\n`,
        `<template>\n  <div\n    i="${long}"\n    k="${long}"\n    m="${long}">\n    o\n  </div>\n</template>\n`,
      ],
      [
        "singleAttributePerLine",
        true,
        "--single-attribute-per-line",
        '<template>\n  <b c="d" e="f"></b>\n</template>\n',
        '<template>\n  <b\n    c="d"\n    e="f"\n  ></b>\n</template>\n',
      ],
      [
        "embeddedLanguageFormatting",
        "off",
        "--embedded-language-formatting=off",
        "<style>\np {\n  q: r;\n}\n</style>\n",
        "<style>\np{q:r}\n</style>\n",
      ],
    ] as const;
    const sources = {
      "a flag": (_name: string, _value: unknown, flag: string) => [{}, [flag]],
      ".prettierrc": (name: string, value: unknown) => [{ ".prettierrc": JSON.stringify({ [name]: value }) }, []],
      "overrides of .prettierrc": (name: string, value: unknown) => [
        { ".prettierrc": JSON.stringify({ overrides: [{ files: "a.vue", options: { [name]: value } }] }) },
        [],
      ],
      ".oxfmtrc.json": (name: string, value: unknown) => [{ ".oxfmtrc.json": JSON.stringify({ [name]: value }) }, []],
      "overrides of .oxfmtrc.json": (name: string, value: unknown) => [
        { ".oxfmtrc.json": JSON.stringify({ overrides: [{ files: ["a.vue"], options: { [name]: value } }] }) },
        [],
      ],
    } as Record<string, (name: string, value: unknown, flag: string) => [Record<string, string>, string[]]>;

    test.each(Object.keys(sources).flatMap(source => options.map(option => [source, ...option] as const)))(
      "%s: %s",
      async (source, name, value, flag, without, withIt) => {
        const [files, args] = sources[source](name, value, flag);
        // What is formatted with the option is not without it. The other way round too, except that nothing is wrong with
        // formatted code that is left alone, or with no white space where it would count.
        const result = await format({ ...files, "a.vue": withIt, "b.vue": without }, [...args, "-l", "a.vue", "b.vue"]);
        const isOneWay = name === "embeddedLanguageFormatting" || name === "htmlWhitespaceSensitivity";
        const isForBoth = !source.startsWith("overrides") && !isOneWay;
        expect(result.stdout.split("\n").filter(Boolean)).toEqual(isForBoth ? ["b.vue"] : []);
      },
    );

    // What is formatted with it is formatted without it too, so this is about what is not.
    test.each(Object.keys(sources))("%s: proseWrap", async source => {
      const [files, args] = sources[source]("proseWrap", "never", "--prose-wrap=never");
      const rename = (text: string) => text.replaceAll("a.vue", "a.md");
      const named = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, rename(text)]));
      const result = await format({ ...named, "a.md": "a\nb\n" }, [...args, "-l", "a.md"]);
      expect(result.stdout.split("\n").filter(Boolean)).toEqual(["a.md"]);
      expect((await format({ "a.md": "a\nb\n" }, ["-l", "a.md"])).stdout).toBe("");
    });

    test.each(options)("without %s", async (_name, _value, _flag, without, withIt) => {
      const result = await format({ "a.vue": withIt, "b.vue": without }, ["-l"]);
      expect(result.stdout.split("\n").filter(Boolean)).toEqual(["a.vue"]);
    });
  });

  test("HTML with a syntax error is reported", async () => {
    const result = await format({ "a.html": "<div></span>\n", "b.html": "<p   >a</p>\n" }, [], {
      reads: ["a.html", "b.html"],
    });
    expect(result.files).toEqual({ "a.html": "<div></span>\n", "b.html": "<p>a</p>\n" });
    expect(result.stderr).toStartWith(problem("a.html", closingTag("span"), [1, 6, "<div></span>"]) + "\n\n");
    expect(result.exitCode).toBe(2);
  });

  describe("a <pre> with an element in it and no end tag", () => {
    // The text, what Bun makes of it, and what Prettier 3.9.9 makes of it: all that follows the start tag is lost.
    test.each([
      ["<pre   ><b>a</b>\n", "<pre><b>a</b>\n", "<pre>>\n"],
      ["<pre   >a<b>c\n", "<pre>a<b>c\n", "<pre>>\n"],
      [
        '<p>x</p><pre   class="y"><i>a</i>\n  b\n',
        '<p>x</p>\n<pre class="y"><i>a</i>\n  b\n',
        '<p>x</p>\n<pre class="y">>\n',
      ],
      ["<listing   ><b>a\n", "<listing><b>a\n", "<listing>>\n"],
    ])("%j", async (before, after, ofPrettier) => {
      expect(after).not.toBe(ofPrettier);
      const result = await format({ "a.html": before, "b.html": after }, [], { reads: ["a.html", "b.html"] });
      expect(result.files).toEqual({ "a.html": after, "b.html": after });
      expect(result.exitCode).toBe(0);
      const checked = await format({ "a.html": before }, ["--debug-check"]);
      expect(checked.stderr).toBe("");
      expect(checked.exitCode).toBe(0);
    });
  });

  describe("a style sheet of which Prettier changes a letter", () => {
    // Prettier 3.9.9 writes a media query in lower case, which makes a `k` of the Kelvin sign: `@media (ka)`. To CSS only
    // the letters of ASCII are the same in both cases.
    const lossy = "<style>@media (\u212AA){a{b:c}}</style>\n";
    const written = "<style>\n  @media (\u212Aa) {\n    a {\n      b: c;\n    }\n  }\n</style>\n";

    test("keeps it", async () => {
      const files = { "a.html": lossy, "b.css": "@media (\u212AA){a{b:c}}\n" };
      const result = await format(files, [], { reads: ["a.html", "b.css"] });
      expect(result.files).toEqual({ "a.html": written, "b.css": "@media (\u212Aa) {\n  a {\n    b: c;\n  }\n}\n" });
      expect(result.exitCode).toBe(0);
    });

    test("--debug-check has nothing to say about it", async () => {
      const result = await format({ "a.html": lossy }, ["--debug-check"], { reads: ["a.html"] });
      expect(result.files).toEqual({ "a.html": lossy });
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("a.html");
      expect(result.exitCode).toBe(0);
    });

    test.each([["--check"], ["-l"]])("%s says that it needs formatting", async flag => {
      const result = await format({ "a.html": lossy }, [flag], { reads: ["a.html"] });
      expect(result.files).toEqual({ "a.html": lossy });
      expect(result.stdout).toBe("a.html");
      expect(result.exitCode).toBe(1);
    });

    test("standard input", async () => {
      const result = await format({}, ["--stdin-filepath", "a.html"], { stdin: lossy });
      expect(result.raw).toBe(written);
      expect(result.exitCode).toBe(0);
    });

    test("in a template and in a block of code", async () => {
      const files = {
        "a.js": "const a = html`" + lossy.trim() + "`;\nconst   b = html`<p   >c</p>`;\n",
        "b.md": "#   a\n\n```html\n" + lossy + "```\n\n```html\n<p   >c</p>\n```\n",
      };
      const result = await format(files, [], { reads: ["a.js", "b.md"] });
      expect(result.files).toEqual({
        "a.js": "const a = html`" + written.trim() + "`;\nconst b = html`<p>c</p>`;\n",
        "b.md": "# a\n\n```html\n" + written + "```\n\n```html\n<p>c</p>\n```\n",
      });
      expect(result.exitCode).toBe(0);
    });
  });

  // What Prettier 3.9.9 does with the flag. oxfmt 0.72 does not have it. The comparison is Bun's own.
  describe.each([
    ["no config", {}, "error: "],
    [".prettierrc", { ".prettierrc": "{}\n" }, "error: "],
    [".oxfmtrc.json", { ".oxfmtrc.json": "{}\n" }, "error: "],
  ])("--debug-check with %s", (_, config: Record<string, string>, prefix) => {
    const files = { "a.js": formatted, "b.js": ugly };
    const names = Object.keys(files);
    // Without the parentheses, which neither Prettier nor Bun writes, it means the same, but the tree is another. Prettier's
    // check reports it too.
    const lossy = "(a<b>)();\n";

    test("every file that passes is named, formatted or not, and nothing is written", async () => {
      const result = await format({ ...config, ...files }, ["--debug-check", ...names], { reads: names });
      expect(result.files).toEqual(files);
      expect(result.stderr).toBe("");
      expect(result.stdout.split("\n")).toEqual(["a.js", "b.js"]);
      expect(result.exitCode).toBe(0);
    });

    test("a file that would say something else is an error", async () => {
      const all = { "a.ts": lossy, "b.js": ugly };
      const result = await format({ ...config, ...all }, ["--debug-check", "a.ts", "b.js"], {
        reads: ["a.ts", "b.js"],
      });
      expect(result.files).toEqual(all);
      expect(result.stderr).toBe(problem("a.ts", "Not formatted, because formatting would change what the code does"));
      expect(result.stdout).toBe("b.js");
      expect(result.exitCode).toBe(2);
    });

    test("-l names what needs formatting as well", async () => {
      const result = await format({ ...config, ...files }, ["--debug-check", "-l", ...names], { reads: names });
      expect(result.files).toEqual(files);
      expect(result.stdout.split("\n")).toEqual(["a.js", "b.js", "b.js"]);
      expect(result.exitCode).toBe(1);
    });

    test("--check exits with 1 if a file needs formatting", async () => {
      const result = await format({ ...config, ...files }, ["--debug-check", "--check", ...names], { reads: names });
      expect(result.files).toEqual(files);
      expect(result.exitCode).toBe(1);
    });

    test("--write is refused", async () => {
      const result = await format({ ...config, ...files }, ["--debug-check", "--write", ...names], { reads: names });
      expect(result.files).toEqual(files);
      expect(result.stderr.trim()).toBe(`${prefix}Cannot use --write and --debug-check together.`);
      expect(result.exitCode).toBe(1);
    });

    test("standard input", async () => {
      const [named, unnamed, looks, lost] = await Promise.all([
        format(config, ["--debug-check", "--stdin-filepath", "x.js"], { stdin: ugly }),
        format(config, ["--debug-check", "--parser", "babel"], { stdin: ugly }),
        format(config, ["--debug-check", "--check", "--stdin-filepath", "x.js"], { stdin: ugly }),
        format(config, ["--debug-check", "--stdin-filepath", "x.ts"], { stdin: lossy }),
      ]);
      // The path, and no line break.
      expect(named.raw).toEndWith(`${sep}x.js`);
      expect(named.exitCode).toBe(0);
      expect(unnamed.raw).toBe("(stdin)\n");
      expect(unnamed.exitCode).toBe(0);
      // oxfmt refuses --check with --stdin-filepath.
      expect(looks.raw).toBe(".oxfmtrc.json" in config ? "" : "(stdin)\n");
      expect(looks.exitCode).toBe(1);
      expect(lost.raw).toBe("");
      expect(lost.stderr).toBe(problem("x.ts", "Not formatted, because formatting would change what the code does"));
      expect(lost.exitCode).toBe(2);
    });
  });

  test("HTML in templates", async () => {
    const result = await format(
      {
        "a.js":
          'const a = html`<div   class="b"><p>${c}</p>\n</div>`;\nconst d = /* HTML */ `<ul><li>${e}</li><li>f</li></ul>`;\n',
        "b.ts": '@Component({ selector: "a", template: `<b   [c]="d+e">{{f|g}}</b>` })\nclass A {}\n',
      },
      [],
      { reads: ["a.js", "b.ts"] },
    );
    expect(result.files).toEqual({
      "a.js":
        'const a = html`<div class="b"><p>${c}</p></div>`;\nconst d = /* HTML */ `<ul>\n  <li>${e}</li>\n  <li>f</li>\n</ul>`;\n',
      "b.ts": '@Component({ selector: "a", template: `<b [c]="d + e">{{ f | g }}</b>` })\nclass A {}\n',
    });
    expect(result.exitCode).toBe(0);
  });

  test("a template whose HTML cannot be parsed stays as it is, the rest of the file is formatted", async () => {
    const result = await format({ "a.js": 'const a = html`<div   class="b"></p>`;\nconst   b = 1;\n' }, [], {
      reads: ["a.js"],
    });
    expect(result.files).toEqual({ "a.js": 'const a = html`<div   class="b"></p>`;\nconst b = 1;\n' });
    expect(result.exitCode).toBe(0);
  });

  test("--embedded-language-formatting=off leaves HTML in templates and in Markdown as it is", async () => {
    const files = {
      "a.js": 'const a = html`<div   class="b"></div>`;\n',
      "b.md": '```html\n<div   class="b"></div>\n```\n',
    };
    const result = await format(files, ["--embedded-language-formatting=off"], { reads: ["a.js", "b.md"] });
    expect(result.files).toEqual(files);
    expect(result.exitCode).toBe(0);
  });

  describe("HTML in a template of which Prettier changes the substitutions", () => {
    // The code, what Bun makes of it, and what Prettier 3.9.9 makes of it: it closes the element, so `b` is evaluated twice,
    // and it does not find what stands for `${b}` again once that is in lower case. oxfmt 0.72 leaves both as they are.
    test.each([
      ["const   a = html`<${b}>c`;\n", "const a = html`<${b}>c`;\n", "const a = html`<${b}>c</${b}>`;\n"],
      [
        "const   a = html`<p>e</p><x-${b}   c><i>d</i>`;\n",
        "const a = html`<p>e</p><x-${b}   c><i>d</i>`;\n",
        "const a = html`<p>e</p>\n  <x-${b} c><i>d</i></x-${b}>`;\n",
      ],
      [
        "const a = html`<style>a { ${b}: ${c} }</style>`;\n",
        "const a = html`<style>\n  a {\n    ${b}: ${c};\n  }\n</style>`;\n",
        "const a = html`<style>\n  a {\n    prettier_html_placeholder_0_0_in_js: ${c};\n  }\n</style>`;\n",
      ],
    ])("%j", async (before, after, ofPrettier) => {
      expect(after).not.toBe(ofPrettier);
      const [written, again, checked] = await Promise.all([
        format({ "a.js": before }, [], { reads: ["a.js"] }),
        different({ "a.js": after }, []),
        format({ "a.js": before }, ["--debug-check"], { reads: ["a.js"] }),
      ]);
      expect(written.files).toEqual({ "a.js": after });
      expect(written.exitCode).toBe(0);
      expect(again).toEqual([]);
      expect(checked.stderr).toBe("");
      expect(checked.exitCode).toBe(0);
    });
  });

  test("HTML and Vue in blocks of code in Markdown", async () => {
    const result = await format(
      {
        "a.md":
          '# a\n\n```html\n<div   class="b"><p>c</p>\n</div>\n```\n\n```vue\n<template><a   :b="c+d"></a></template>\n```\n\n```html\n<div></p>\n```\n',
      },
      [],
      { reads: ["a.md"] },
    );
    expect(result.files).toEqual({
      "a.md":
        '# a\n\n```html\n<div class="b"><p>c</p></div>\n```\n\n```vue\n<template><a :b="c + d"></a></template>\n```\n\n```html\n<div></p>\n```\n',
    });
    expect(result.exitCode).toBe(0);
  });

  test("MDX is formatted as Prettier formats it, with and without an .oxfmtrc.json", async () => {
    const files = { "a.mdx": "import   A from 'a'\n\n#   b\n\n<A   c='d'/>\n" };
    const printed = 'import A from "a";\n\n# b\n\n<A c="d" />\n';
    const result = await format(files, [], { reads: ["a.mdx"] });
    expect(result.files).toEqual({ "a.mdx": printed });
    expect(result.exitCode).toBe(0);
    const forOxfmt = await format({ ...files, ".oxfmtrc.json": "{}\n" }, [], { reads: ["a.mdx"] });
    expect(forOxfmt.files["a.mdx"]).toBe(printed);
    expect(forOxfmt.exitCode).toBe(0);
  });

  test("other languages are left alone, which is an error at the end, or a warning with --allow-unsupported", async () => {
    const left = { "a.astro": "<p   >a</p>\n", "b.astro": "<p   >b</p>\n" };
    const files = { ".prettierrc": '{ "plugins": ["prettier-plugin-astro"] }\n', ...left, "c.js": ugly };
    const reads = [...Object.keys(left), "c.js"];
    const text = "2 files were not formatted because bun fmt does not support their language yet: 2 .astro";
    const result = await format(files, [], { reads });
    expect(result.files).toEqual({ ...left, "c.js": formatted });
    expect(result.stderr.trimEnd().split("\n").slice(-2)).toEqual([
      `error: ${text}`,
      "  Use --allow-unsupported to make this a warning.",
    ]);
    expect(result.exitCode).toBe(2);
    const checked = await format({ ...files, "c.js": formatted }, ["--check"], { reads });
    expect(checked.stderr).toContain(`error: ${text}`);
    expect(checked.exitCode).toBe(2);
    const allowed = await format(files, ["--allow-unsupported"], { reads });
    expect(allowed.files).toEqual({ ...left, "c.js": formatted });
    expect(allowed.stderr.split("\n")).toContain(`warn: ${text}`);
    expect(allowed.exitCode).toBe(0);
  });

  describe("a language that only a plugin of Prettier reads", () => {
    // A run starts a VM, and the search for leaks at its end takes seconds with the threads of one.
    const timeout = isDebug || isASAN ? 120_000 : 5_000;
    // Stand-ins. This Prettier takes blanks away, and writes down what it is called with.
    const packages = {
      "node_modules/prettier/package.json": '{ "name": "prettier", "version": "3.0.0", "main": "index.cjs" }',
      "node_modules/prettier/index.cjs": `const fs = require("node:fs");
exports.resolveConfig = async (file, { config }) => {
  fs.appendFileSync(__dirname + "/paths.txt", file + "\\n" + config + "\\n");
  return config ? JSON.parse(fs.readFileSync(config, "utf8")) : null;
};
exports.format = async (text, options) => {
  fs.appendFileSync(__dirname + "/calls.txt", JSON.stringify(options) + "\\n");
  if (text.includes("broken")) throw Object.assign(new SyntaxError("Unexpected token (1:2)"), { loc: {} });
  return text.replace(/ +/g, " ");
};
`,
      "node_modules/prettier-plugin-astro/package.json": '{ "name": "prettier-plugin-astro", "version": "4.0.0" }',
    };
    const config = { plugins: ["prettier-plugin-astro"], astroAllowShorthand: true, semi: false };
    const files = {
      ...packages,
      ".prettierrc": '{\n  "plugins": ["prettier-plugin-astro"],\n  "astroAllowShorthand": true,\n  "semi": false\n}\n',
      "a.astro": "<p   >a</p>\n",
      "b.js": "b  ;\n",
    };
    const reads = ["a.astro", "b.js", "node_modules/prettier/calls.txt", "node_modules/prettier/paths.txt"];

    test(
      "goes to the project's own Prettier, with its configuration file and the flags",
      async () => {
        const result = await format(files, ["--tab-width", "8"], { reads });
        expect(result.files["a.astro"]).toBe("<p >a</p>\n");
        expect(result.files["b.js"]).toBe("b\n");
        const calls = result.files[reads[2]]!.trim().split("\n");
        expect(calls.map(it => JSON.parse(it))).toEqual([
          { ...config, tabWidth: 8, filepath: expect.stringMatching(/[\\/]a\.astro$/) },
        ]);
        // A plugin sees paths as the system writes them.
        const paths = [JSON.parse(calls[0]).filepath, ...result.files[reads[3]]!.trim().split("\n")];
        expect(paths.map(it => basename(it))).toEqual(["a.astro", "a.astro", ".prettierrc"]);
        expect(paths).toEqual(paths.map(it => resolve(it)));
        expect(result.stderr).toContain("Used your installed Prettier for 1 file in a language that needs a plugin");
        expect(result.exitCode).toBe(0);
      },
      timeout,
    );

    // The order of prettier-plugin-packagejson is that of the package sort-package-json, not that of `sortPackageJson`.
    test(
      "so does a package.json with prettier-plugin-packagejson, and no other file",
      async () => {
        const plugin = "prettier-plugin-packagejson";
        const project = {
          ...packages,
          [`node_modules/${plugin}/package.json`]: `{ "name": "${plugin}", "version": "3.0.0" }`,
          ".prettierrc": `{ "plugins": ["${plugin}"], "packageSortOrder": ["version"] }\n`,
          "package.json": '{  "a":  1 }\n',
          "packages/b/package.json": '{  "b":  1 }\n',
          "my-package.json": '{  "c":  1 }\n',
          "d.js": "d  ;\n",
        };
        const names = ["package.json", "packages/b/package.json", "my-package.json", "d.js"];
        const result = await format(project, [], { reads: names });
        expect(result.files).toEqual({
          "package.json": '{ "a": 1 }\n',
          "packages/b/package.json": '{ "b": 1 }\n',
          "my-package.json": '{ "c": 1 }\n',
          "d.js": "d;\n",
        });
        expect(result.stderr).toContain("Used your installed Prettier for 2 files");
        expect(result.stderr).not.toContain("warn:");
        expect(result.exitCode).toBe(0);
        // The flag is for what cannot be done, and this can.
        const withFlag = await format(project, ["--allow-unsupported"], { reads: names });
        expect(withFlag.files).toEqual(result.files);
        expect(withFlag.stderr).toContain("Used your installed Prettier for 2 files");

        // Without Prettier only those files are left, and with the flag they are formatted without the plugin.
        const { ".prettierrc": config, "package.json": text } = project;
        const alone = { ".prettierrc": config, "package.json": text, "d.js": "d  ;\n" };
        const left = await format(alone, [], { reads: ["package.json", "d.js"] });
        expect(left.files).toEqual({ "package.json": text, "d.js": "d;\n" });
        expect(left.stderr).toContain(`Not installed: prettier, ${plugin}`);
        expect(left.stderr).toContain(
          `error: 1 file was not formatted because the Prettier config uses plugins that bun fmt does not include: ${plugin}\n  Use --allow-unsupported to format it without the plugins.\n`,
        );
        expect(left.stderr).not.toContain("language");
        expect(left.exitCode).toBe(2);
        const allowed = await format(alone, ["--allow-unsupported"], { reads: ["package.json"] });
        expect(allowed.files).toEqual({ "package.json": '{\n  "a": 1\n}\n' });
        expect(allowed.stderr).toContain(`warn: Not installed: prettier, ${plugin}`);
        expect(allowed.exitCode).toBe(0);
      },
      timeout,
    );

    test("a path reaches Prettier and its plugins as the system writes it, also on Windows", async () => {
      const worker = join(import.meta.dir, "../../../src/lint/js_plugin/worker");
      const head = { usesConfig: true, editorconfig: true, flags: {}, precedence: "cli-override" };
      // What the file takes from the rest of the worker, with the paths of another system.
      const run = (system: string, path: string, config: string | null) => `(() => {
        const nodePath = require("node:path").${system};
        const [DONE, FAILED, NOT_INSTALLED, cwd, seen] = ["0", "1", "5", "/", []];
        let loadingTime = 0;
        const prettier = {
          resolveConfig: async (file, { config }) => void seen.push(file, config ?? null),
          format: async (text, { filepath }) => (seen.push(filepath), text),
        };
        const createRequire = () => Object.assign(() => prettier, { resolve() {} });
        const json = Buffer.from(${JSON.stringify(JSON.stringify({ ...head, path, config }))});
        const message = new Uint8Array([...new Uint8Array(new Uint32Array([json.length]).buffer), ...json, 120]);
        const messageWords = count => new Uint32Array(message.buffer, 0, count);
        const messageText = (from, to = message.length) => Buffer.from(message.buffer, from, to - from).toString();
        ${readFileSync(join(worker, "paths.js"), "utf8")}
        ${readFileSync(join(worker, "prettier.js"), "utf8")}
        return formatWithPrettier().then(result => [result, ...seen]);
      })()`;
      const runs = [
        run("win32", "C:/proj/src/a.astro", "C:/proj/.prettierrc"),
        run("win32", "//server/share/a.astro", null),
        run("posix", "/proj/a\\b.astro", "/proj/.prettierrc"),
      ];
      await using proc = spawn({
        cmd: [bunExe(), "-e", `Promise.all([${runs}]).then(all => console.log(JSON.stringify(all)));`],
        env,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(JSON.parse(stdout)).toEqual([
        ["0x", String.raw`C:\proj\src\a.astro`, String.raw`C:\proj\.prettierrc`, String.raw`C:\proj\src\a.astro`],
        ["0x", String.raw`\\server\share\a.astro`, null, String.raw`\\server\share\a.astro`],
        ["0x", "/proj/a\\b.astro", "/proj/.prettierrc", "/proj/a\\b.astro"],
      ]);
      expect(exitCode).toBe(0);
    });

    test(
      "is checked, and listed",
      async () => {
        const checked = await format(files, ["--check"], { reads });
        expect(checked.files["a.astro"]).toBe(files["a.astro"]);
        expect(checked.stderr).toContain("[warn] a.astro");
        expect(checked.exitCode).toBe(1);
        expect(await different(files, [])).toEqual(["a.astro", "b.js"]);
        const fine = await format({ ...files, "a.astro": "<p>a</p>\n", "b.js": "b\n" }, ["--check"]);
        expect(fine.stdout).toContain("All matched files use Prettier code style!");
        expect(fine.exitCode).toBe(0);
      },
      timeout,
    );

    test(
      "from standard input",
      async () => {
        const result = await format(files, ["--stdin-filepath", "c.astro"], { stdin: "<p   >c</p>\n" });
        expect(result).toMatchObject({ raw: "<p >c</p>\n", stderr: "", exitCode: 0 });
        const checked = await format(files, ["--stdin-filepath", "c.astro", "--check"], { stdin: "<p   >c</p>\n" });
        expect(checked).toMatchObject({ raw: "(stdin)\n", exitCode: 1 });
      },
      timeout,
    );

    test(
      "--parser with the plugin's parser: piped code goes to Prettier without a file name",
      async () => {
        const stdin = "<p   >c</p>\n";
        const result = await format(files, ["--parser", "astro", "--tab-width", "8"], { stdin, reads });
        expect(result).toMatchObject({ raw: "<p >c</p>\n", stderr: "", exitCode: 0 });
        expect(result.files["a.astro"]).toBe(files["a.astro"]);
        // `JSON.stringify` drops `filepath: undefined`.
        expect(JSON.parse(result.files[reads[2]]!)).toEqual({ ...config, parser: "astro", tabWidth: 8 });
        expect(result.files[reads[3]]!.split("\n")[0]).toBe("undefined");
        const checked = await format(files, ["--parser", "astro", "--check"], { stdin });
        expect(checked).toMatchObject({ raw: "(stdin)\n", exitCode: 1 });
      },
      timeout,
    );

    test.each<[string[], string, number]>([
      [[], "error: stdin: SyntaxError: Unexpected token (1:2)", 2],
      [["--check"], "error: Unexpected token (1:2)", 0],
    ])(
      "--parser with the plugin's parser, and the code doesn't parse: %j",
      async (flags, stderr, exitCode) => {
        const result = await format(files, ["--parser", "astro", ...flags], { stdin: "<p>broken</p>\n" });
        expect(result).toMatchObject({ raw: "", stderr, exitCode });
      },
      timeout,
    );

    test(
      "--parser with a parser that none of the plugins has",
      async () => {
        const prettier = `exports.resolveConfig = async () => null;
class ConfigError extends Error {
  name = "ConfigError";
}
exports.format = async (text, { parser }) => {
  throw new ConfigError(\`Couldn't resolve parser "\${parser}".\`);
};
`;
        const project = { ...files, "node_modules/prettier/index.cjs": prettier };
        const result = await format(project, ["--parser", "nonsense"], { stdin: "a\n" });
        expect(result).toMatchObject({ raw: "", stderr: `error: Couldn't resolve parser "nonsense".`, exitCode: 1 });
      },
      timeout,
    );

    test("--parser with the plugin's parser, and nothing is installed", async () => {
      const result = await format({ ".prettierrc": files[".prettierrc"] }, ["--parser", "astro"], {
        stdin: "<p   >c</p>\n",
      });
      expect(result.raw).toBe("");
      expect(result.stderr.split("\n")).toEqual([
        "warn: Not installed: prettier, prettier-plugin-astro",
        "  Install prettier and every plugin in your config, and bun fmt will use them for these files.",
        "error: 1 file was not formatted because bun fmt does not support its language yet: 1 astro",
        "  Use --allow-unsupported to make this a warning.",
      ]);
      expect(result.exitCode).toBe(2);
    });

    // As Prettier 3.9.9 with a plugin that throws this.
    test.each<[string[], string, number]>([
      [[], "error: c.astro: SyntaxError: Unexpected token (1:2)", 2],
      [["--check"], "error: Unexpected token (1:2)", 0],
      [["--list-different"], "error: Unexpected token (1:2)", 0],
    ])(
      "from standard input, and it does not parse: %j",
      async (flags, stderr, exitCode) => {
        const result = await format(files, [...flags, "--stdin-filepath", "c.astro"], { stdin: "<p>broken</p>\n" });
        expect(result).toMatchObject({ raw: "", stderr, exitCode });
      },
      timeout,
    );

    // Who gets the text back with 0 takes it for formatted. Prettier 3.9.9 without the plugin: `Cannot find package`, and 2,
    // whatever the flags.
    describe.each([
      ["prettier, prettier-plugin-astro", []],
      ["prettier-plugin-astro", ["node_modules/prettier/package.json"]],
      ["prettier", ["node_modules/prettier-plugin-astro/package.json"]],
    ])("from standard input, and not installed: %s", (missing, installed) => {
      const project = {
        ".prettierrc": files[".prettierrc"],
        ...Object.fromEntries(installed.map(name => [name, "{}"])),
      };
      const stdin = "<p   >c</p>\n";
      const unsupported = "1 file was not formatted because bun fmt does not support its language yet: 1 .astro";
      test.each([[[]], [["--check"]], [["--list-different"]]])("%j", async flags => {
        const result = await format(project, [...flags, "--stdin-filepath", "c.astro"], { stdin });
        expect(result.raw).toBe("");
        expect(result.stderr.split("\n")).toEqual([
          `warn: Not installed: ${missing}`,
          "  Install prettier and every plugin in your config, and bun fmt will use them for these files.",
          `error: ${unsupported}`,
          "  Use --allow-unsupported to make this a warning.",
        ]);
        expect(result.exitCode).toBe(2);
      });
      test.each([
        [[], stdin],
        [["--check"], ""],
        [["--list-different"], ""],
      ])("--allow-unsupported %j", async (flags, raw) => {
        const args = ["--allow-unsupported", ...flags, "--stdin-filepath", "c.astro"];
        const result = await format(project, args, { stdin });
        expect(result.raw).toBe(raw);
        expect(result.stderr.split("\n").at(-1)).toBe(`warn: ${unsupported}`);
        expect(result.exitCode).toBe(0);
      });
    });

    // Each thread that hands a file over waits for the answer, and Prettier reads files on threads too.
    test(
      "more files than there are threads",
      async () => {
        const names = Array.from({ length: availableParallelism() + 1 }, (_, index) => `many/${index}.astro`);
        const reading = packages["node_modules/prettier/index.cjs"].replace(
          "exports.format = async (text, options) => {",
          "exports.format = async (text, options) => {\n  await fs.promises.readFile(__filename);",
        );
        const result = await format(
          {
            ...files,
            "node_modules/prettier/index.cjs": reading,
            ...Object.fromEntries(names.map(name => [name, "<p   >a</p>\n"])),
          },
          ["many"],
          { reads: names },
        );
        expect(Object.values(result.files)).toEqual(names.map(() => "<p >a</p>\n"));
        expect(result.exitCode).toBe(0);
      },
      timeout,
    );

    // The first pattern that is compiled starts JavaScriptCore too, on the thread that formats the file.
    test(
      "beside files for which a pattern of the configuration is compiled",
      async () => {
        const sorter = "@ianvs/prettier-plugin-sort-imports";
        const result = await format(
          {
            ...files,
            [`node_modules/${sorter}/package.json`]: `{ "name": "${sorter}", "version": "4.0.0" }`,
            ".prettierrc": `{\n  "plugins": ["prettier-plugin-astro", "${sorter}"],\n  "importOrder": ["^b", "^a"]\n}\n`,
            "c.ts": 'import a from "a";\nimport b from "b";\n',
            "d.ts": 'import a from "a";\nimport b from "b";\n',
          },
          [],
          { reads: ["a.astro", "c.ts", "d.ts"] },
        );
        const sorted = 'import b from "b";\nimport a from "a";\n';
        expect(result.files).toEqual({ "a.astro": "<p >a</p>\n", "c.ts": sorted, "d.ts": sorted });
        expect(result.exitCode).toBe(0);
      },
      timeout,
    );

    // It runs in this process.
    test(
      "a Prettier that ends the process ends the run, and every file is whole",
      async () => {
        const names = Array.from({ length: 8 }, (_, index) => `${index}.astro`);
        const exits = packages["node_modules/prettier/index.cjs"].replace(
          "exports.format = async (text, options) => {",
          'exports.format = async (text, options) => {\n  if (text.includes("ends")) process.exit(7);',
        );
        using dir = tempDir("bun-format-exit", {
          ...files,
          "node_modules/prettier/index.cjs": exits,
          "many/ends.astro": "<p   >ends</p>\n",
          ...Object.fromEntries(names.map(name => [`many/${name}`, "<p   >a</p>\n"])),
        });
        await using proc = spawn({ cmd: [...command, "many"], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 7 });
        // Another thread may be between writing a file under another name and giving it its name.
        const left = readdirSync(join(String(dir), "many")).filter(name => !name.endsWith(".tmp"));
        expect(left.sort()).toEqual([...names, "ends.astro"]);
        expect(readFileSync(join(String(dir), "many/ends.astro"), "utf8")).toBe("<p   >ends</p>\n");
        for (const name of names) {
          expect(["<p   >a</p>\n", "<p >a</p>\n"]).toContain(readFileSync(join(String(dir), "many", name), "utf8"));
        }
      },
      timeout,
    );

    test(
      "a promise that nothing can settle any more is an error for the file",
      async () => {
        const waits = packages["node_modules/prettier/index.cjs"].replace(
          "exports.format = async (text, options) => {",
          'exports.format = async (text, options) => {\n  if (text.includes("waits")) await new Promise(() => {});',
        );
        const result = await format(
          { ...files, "node_modules/prettier/index.cjs": waits, "c.astro": "<p   >waits</p>\n" },
          [],
          { reads: ["a.astro", "c.astro"] },
        );
        expect(result.files).toEqual({ "a.astro": "<p >a</p>\n", "c.astro": "<p   >waits</p>\n" });
        expect(result.stderr).toContain("error: c.astro: A promise never settled, and nothing is left to wait for.");
        expect(result.exitCode).toBe(2);
      },
      timeout,
    );

    test(
      "what Prettier leaves running does not keep the run from ending",
      async () => {
        const leaves = `setInterval(() => {}, 1000);
require("node:net").createServer(() => {}).listen(0, "127.0.0.1");
${packages["node_modules/prettier/index.cjs"]}`;
        const result = await format({ ...files, "node_modules/prettier/index.cjs": leaves }, [], { reads });
        expect(result.files["a.astro"]).toBe("<p >a</p>\n");
        expect(result.exitCode).toBe(0);
      },
      timeout,
    );

    test(
      "what Prettier throws is shown as it shows it",
      async () => {
        const result = await format({ ...files, "a.astro": "broken\n" }, [], { reads });
        expect(result.files["a.astro"]).toBe("broken\n");
        expect(result.stderr).toContain("error: a.astro: SyntaxError: Unexpected token (1:2)");
        expect(result.exitCode).toBe(2);
      },
      timeout,
    );

    test(
      "is left as it is if the plugin is not installed, and what would help is said",
      async () => {
        const { "node_modules/prettier-plugin-astro/package.json": plugin, ...others } = files;
        const result = await format(others, [], { reads: ["a.astro"] });
        expect(result.files["a.astro"]).toBe(files["a.astro"]);
        expect(result.stderr).toContain(
          "warn: Not installed: prettier-plugin-astro\n  Install prettier and every plugin in your config, and bun fmt will use them for these files.",
        );
        expect(result.stderr).toContain("does not support its language yet: 1 .astro\n");
        expect(result.exitCode).toBe(2);
      },
      timeout,
    );
  });

  test("with an .oxfmtrc.json TOML is formatted, and Svelte if the configuration has svelte", async () => {
    const files = {
      "a.svelte": "<p   >a</p>\n",
      "b.toml": "a   = 1\n",
      "Pipfile": "[a]\nb=[ 1,2 ]\n",
      "Cargo.lock": "a   = 1\n",
      "c.js": ugly,
    };
    const after = { ...files, "b.toml": "a = 1\n", "Pipfile": "[a]\nb = [1, 2]\n", "c.js": formatted };
    const reads = Object.keys(files);
    const result = await format({ ...files, ".oxfmtrc.json": '{ "svelte": {} }\n' }, [], { reads });
    expect(result.files).toEqual({ ...after, "a.svelte": "<p>a</p>\n" });
    expect(result.stderr).not.toContain("does not support");
    expect(result.exitCode).toBe(0);
    const without = await format({ ...files, ".oxfmtrc.json": "{}\n" }, [], { reads });
    expect(without.files).toEqual(after);
    expect(without.stderr).not.toContain("does not support");
    expect(without.exitCode).toBe(0);
    // oxfmt 0.72 formats the one, and gives the other back.
    const piped = (config: string) =>
      format({ ".oxfmtrc.json": config }, ["--stdin-filepath", "a.svelte"], { stdin: files["a.svelte"] });
    expect(await piped('{ "svelte": {} }\n')).toMatchObject({ raw: "<p>a</p>\n", stderr: "", exitCode: 0 });
    expect(await piped("{}\n")).toMatchObject({ raw: files["a.svelte"], stderr: "", exitCode: 0 });
    // Prettier doesn't format TOML, or Svelte without the plugin. Without a Prettier or oxfmt config, Bun formats them like
    // any other language.
    expect(await different({ ...files, ".prettierrc": "{}\n" }, [])).toEqual(["c.js"]);
    expect(await different(files, [])).toEqual(["a.svelte", "b.toml", "c.js", "Pipfile"]);
    const broken = await format({ "b.toml": "a = = 1\n", ".oxfmtrc.json": "{}\n" }, [], { reads: ["b.toml"] });
    expect(broken.files["b.toml"]).toBe("a = = 1\n");
    expect(broken.stderr).toBe("1 | a = = 1\n        ^\nwarn: Expected a value but found '='\n   at b.toml:1:5");
    expect(broken.exitCode).toBe(0);
  });

  // Notepad and `Out-File -Encoding utf8` of Windows PowerShell write the mark. Git, Prettier 3.9.9 and oxfmt 0.72.0 pass over it.
  test.each([
    ["\\r\\n", (text: string) => text.replaceAll("\n", "\r\n")],
    ["a byte order mark", (text: string) => "\uFEFF" + text],
    ["both", (text: string) => "\uFEFF" + text.replaceAll("\n", "\r\n")],
  ])("%s in a file with patterns to ignore", async (_, written) => {
    const files = { "dist/a.js": ugly, "b.gen.js": ugly, "keep.gen.js": ugly, "sub/c.js": ugly, "d.js": ugly };
    const patterns = written("dist\n# a comment\n\n*.gen.js\n!keep.gen.js\nsub/\n");
    const results = await Promise.all([
      different({ ...files, ".prettierignore": patterns }, []),
      different({ ...files, ".gitignore": patterns }, []),
      different({ ...files, "mine": patterns }, ["--ignore-path", "mine"]),
      different({ ...files, ".oxfmtrc.json": "{}\n", ".prettierignore": patterns }, []),
      different(
        { ...files, ".oxfmtrc.json": "{}\n", ".git/HEAD": "ref: refs/heads/main\n", ".gitignore": patterns },
        [],
      ),
    ]);
    expect(results.map(it => it.sort())).toEqual(results.map(() => ["d.js", "keep.gen.js"]));
  });

  test(".prettierignore and .gitignore make no difference between upper and lower case, as for Prettier", async () => {
    const files = {
      ".prettierignore": "readme.md\nSUB/\n",
      ".gitignore": "*.JS\n",
      "README.md": "#   a\n",
      "sub/b.md": "#   b\n",
      "c.js": ugly,
      "other.md": "#   c\n",
    };
    expect(await different(files, [])).toEqual(["other.md"]);
    // oxfmt does.
    expect(await different({ ...files, ".oxfmtrc.json": "{}\n" }, [])).toEqual([
      "README.md",
      "c.js",
      "other.md",
      "sub/b.md",
    ]);
  });

  test("(a|b) in a pattern is a or b, as for Prettier", async () => {
    const files = { "src/a.ts": ugly, "test/x/b.ts": ugly, "lib/c.ts": ugly };
    expect(await different(files, ["(src|test)/**/*.ts"])).toEqual(["src/a.ts", "test/x/b.ts"]);
  });

  test("ignorePatterns that ignore *.* do not ignore the directory that is searched", async () => {
    const files = {
      ".oxfmtrc.json": '{ "ignorePatterns": ["*.*", "!*.css", "!*.ts"] }\n',
      "a.ts": ugly,
      "app/b.ts": ugly,
      "app/c.js": ugly,
      "app/d.css": "a{}\n",
      "e.md": "#   e\n",
    };
    for (const args of [[], ["."], ["app", "a.ts"]]) {
      expect(await different(files, args)).toEqual(["a.ts", "app/b.ts", "app/d.css"]);
    }
  });

  test.each([
    ['{ "semi": null }', "Invalid semi value: null."],
    ['{ "semi": "true" }', 'Invalid semi value: "true".'],
    ['{ "endOfLine": null }', "Invalid endOfLine value: null."],
    ['{ "plugins": "x" }', '"plugins" must be an array'],
    ['{ "overrides": 1 }', '"overrides" must be an array of objects, each with "files"'],
    ['{ "overrides": [{ "options": {} }] }', '"overrides" must be an array of objects, each with "files"'],
    ['{ "overrides": [{ "files": 1 }] }', '"overrides" must be an array of objects, each with "files"'],
  ])("a .prettierrc that Prettier cannot use is an error: %s", async (config, message) => {
    const result = await format({ ".prettierrc": config, "a.js": ugly }, ["a.js"], { reads: ["a.js"] });
    expect(result.files["a.js"]).toBe(ugly);
    expect(result.stderr).toContain(message);
    expect(result.exitCode).toBe(2);
  });

  // It has holes for all its bytes. Node: "Cannot create a string longer than 0x1fffffe8 characters".
  test("a file that JavaScript could not hold as a string is not read, and the others are", async () => {
    const result = await format({ "a.json": "", "b.js": ugly }, ["--check", "."], {
      before: dir => truncateSync(join(dir, "a.json"), 2 ** 29),
    });
    expect(result.stderr).toContain(`error: Unable to read file "a.json":\nEFBIG: `);
    expect(result.stdout).toBe("b.js");
    expect(result.exitCode).toBe(2);
  });

  test.skipIf(isWindows)(
    "/dev/null is a file without patterns to ignore, and a configuration without options",
    async () => {
      const files = { ".prettierignore": "a.js\n", ".prettierrc": `{ "semi": false }\n`, "a.js": formatted };
      expect(await different(files, ["."])).toEqual([]);
      expect(await different(files, ["--ignore-path", "/dev/null", "."])).toEqual(["a.js"]);
      expect(await different(files, ["--ignore-path", "/dev/null", "--config", "/dev/null", "."])).toEqual([]);
    },
  );

  // "Never break a line." Prettier takes every whole number from 0 on, and Infinity.
  test.each([
    [{ ".prettierrc": `{ "printWidth": 100000 }` }, []],
    [{ ".prettierrc.mjs": `export default { printWidth: Infinity };` }, []],
    [{ "prettier.config.cjs": `module.exports = { printWidth: Infinity };` }, []],
    [
      { ".prettierrc.mjs": `export default { overrides: [{ files: "*.js", options: { printWidth: Infinity } }] };` },
      [],
    ],
    [{ ".prettierrc.mjs": `export default { printWidth: Infinity, rangeStart: 0, rangeEnd: Infinity };` }, []],
    [{ "bunfig.toml": `[fmt]\nprintWidth = 100000\n` }, []],
    [{}, ["--print-width", "65536"]],
    [{}, ["--print-width=100000"]],
    [{}, ["--print-width=9007199254740991"]],
  ])("a printWidth wider than any line: %j %j", async (config, flags) => {
    const line = `const value = someFunction(${Array.from({ length: 40 }, (_, i) => `argumentNumber${i}`).join(", ")});\n`;
    const result = await format({ ...config, "a.js": line.replaceAll(", ", ",   ") }, [...flags, "a.js"], {
      reads: ["a.js"],
    });
    expect(result.stderr).not.toContain("Invalid");
    expect(result.files["a.js"]).toBe(line);
    expect(result.exitCode).toBe(0);
  });

  // oxfmt 0.72: "Failed to load configuration file.", 1.
  test("an infinite printWidth is none that oxfmt takes", async () => {
    const result = await format(
      { "oxfmt.config.ts": `export default { printWidth: Infinity };`, "a.js": ugly },
      ["a.js"],
      {
        reads: ["a.js"],
      },
    );
    expect(result.files["a.js"]).toBe(ugly);
    expect(result.stderr).toContain("Invalid printWidth: The line width should be between 1 and 320");
    expect(result.exitCode).toBe(1);
  });

  test("an option that Prettier does not know is ignored with its warning, unless a plugin may know it", async () => {
    const unknown = '"nonsense": 1, "other": [1, "a"], "tailwindConfig": "x", "$schema": "y"';
    const result = await format({ ".prettierrc": `{ ${unknown} }`, "a.js": ugly }, ["a.js"], { reads: ["a.js"] });
    expect(result.files["a.js"]).toBe(formatted);
    expect(result.stderr).toContain("warn: Ignored unknown option { nonsense: 1 }.");
    expect(result.stderr).toContain('warn: Ignored unknown option { other: [1, "a"] }.');
    expect(result.stderr).toContain('warn: Ignored unknown option { tailwindConfig: "x" }.');
    expect(result.stderr).not.toContain("$schema");
    expect(result.exitCode).toBe(0);
    const withPlugin = await format(
      { ".prettierrc": `{ "plugins": ["prettier-plugin-brace-style"], ${unknown} }`, "a.js": ugly },
      ["--allow-unsupported", "a.js"],
      { reads: ["a.js"] },
    );
    expect(withPlugin.files["a.js"]).toBe(formatted);
    expect(withPlugin.stderr).not.toContain("Ignored unknown option");
    // oxfmt says nothing about keys that it does not know, and null is as good as nothing.
    const oxfmt = await format({ ".oxfmtrc.json": '{ "semi": null, "nonsense": 1 }\n', "a.js": ugly }, ["a.js"], {
      reads: ["a.js"],
    });
    expect(oxfmt.files["a.js"]).toBe(formatted);
    expect(oxfmt.stderr).not.toContain("nonsense");
    expect(oxfmt.exitCode).toBe(0);
  });

  test("a plugin that may print files in another way: they are left as they are, which is an error, unless --allow-unsupported", async () => {
    const files = {
      ".prettierrc": '{ "plugins": ["prettier-plugin-brace-style", "prettier-plugin-astro", "./own.js"] }\n',
      "a.js": ugly,
      "b.astro": "<p   >b</p>\n",
      "other/.prettierrc": "{}\n",
      "other/c.js": ugly,
    };
    const reads = ["a.js", "b.astro", "other/c.js"];
    // The other file is the .prettierrc itself.
    const result = await format(files, [], { reads });
    expect(result.files).toEqual({ "a.js": ugly, "b.astro": files["b.astro"], "other/c.js": formatted });
    expect(result.stderr).toContain(
      "error: 2 files were not formatted because the Prettier config uses plugins that bun fmt does not include: prettier-plugin-brace-style, ./own.js\n  Use --allow-unsupported to format them without the plugins.",
    );
    expect(result.stderr).toContain(
      "error: 1 file was not formatted because bun fmt does not support its language yet",
    );
    expect(result.exitCode).toBe(2);
    const allowed = await format(files, ["--allow-unsupported"], { reads });
    expect(allowed.files).toEqual({ "a.js": formatted, "b.astro": files["b.astro"], "other/c.js": formatted });
    expect(allowed.stderr).toMatch(
      /warn: prettier-plugin-brace-style, \.\/own\.js in \S+\.prettierrc have no effect because bun fmt does not include those plugins\n/,
    );
    expect(allowed.exitCode).toBe(0);
    const flag = await format({ "a.js": ugly }, ["--plugin", "prettier-plugin-brace-style"], { reads: ["a.js"] });
    expect(flag.files["a.js"]).toBe(ugly);
    expect(flag.stderr).toContain("bun fmt does not include the plugin prettier-plugin-brace-style\n");
    expect(flag.exitCode).toBe(2);
    for (const flags of [[], ["--check"], ["--list-different"]]) {
      const piped = await format(files, [...flags, "--stdin-filepath", "d.js"], { stdin: ugly });
      expect(piped.raw).toBe("");
      expect(piped.stderr).toBe(
        "error: 1 file was not formatted because the Prettier config uses plugins that bun fmt does not include: prettier-plugin-brace-style, ./own.js\n  Use --allow-unsupported to format it without the plugins.",
      );
      expect(piped.exitCode).toBe(2);
    }
    const args = ["--allow-unsupported", "--stdin-filepath", "d.js"];
    expect(await format(files, args, { stdin: ugly })).toMatchObject({ raw: formatted, exitCode: 0 });
  });

  test("such a plugin in an override: the files that the override is for are left as they are", async () => {
    const overrides = [{ files: "legacy/**", options: { plugins: ["prettier-plugin-brace-style"] } }];
    const files = { ".prettierrc": JSON.stringify({ overrides }), "a.js": ugly, "legacy/b.js": ugly };
    const result = await format(files, [], { reads: ["a.js", "legacy/b.js"] });
    expect(result.files).toEqual({ "a.js": formatted, "legacy/b.js": ugly });
    expect(result.stderr).toContain(
      "error: 1 file was not formatted because the Prettier config uses plugins that bun fmt does not include: prettier-plugin-brace-style\n",
    );
    expect(result.exitCode).toBe(2);
    // An override that empties the list takes its files out.
    const emptied = {
      plugins: ["prettier-plugin-brace-style"],
      overrides: [{ files: "legacy/**", options: { plugins: [] } }],
    };
    const other = await format({ ...files, ".prettierrc": JSON.stringify(emptied) }, ["a.js", "legacy"], {
      reads: ["a.js", "legacy/b.js"],
    });
    expect(other.files).toEqual({ "a.js": ugly, "legacy/b.js": formatted });
    expect(other.exitCode).toBe(2);
  });

  // Prettier 3.9.9 prints 3,939 files of JavaScript and TypeScript the same with and without @prettier/plugin-oxc 0.2.3.
  test.each<[string, Record<string, string>, string[]?]>([
    ["its name", { ".prettierrc": '{ "plugins": ["@prettier/plugin-oxc"] }' }],
    [
      "the module",
      {
        "prettier.config.mjs": 'import * as oxc from "@prettier/plugin-oxc";\nexport default { plugins: [oxc] };',
        "node_modules/@prettier/plugin-oxc/package.json":
          '{ "name": "@prettier/plugin-oxc", "exports": "./index.mjs" }',
        "node_modules/@prettier/plugin-oxc/index.mjs":
          'export const parsers = { oxc: { astFormat: "estree" }, "oxc-ts": { astFormat: "estree" } };\n',
      },
    ],
    [
      "overrides with its parsers",
      {
        ".prettierrc": JSON.stringify({
          overrides: [
            { files: "*.js", options: { parser: "oxc", plugins: ["@prettier/plugin-oxc"] } },
            { files: "*.ts", options: { parser: "oxc-ts", plugins: ["@prettier/plugin-oxc"] } },
          ],
        }),
      },
    ],
    ["--plugin", {}, ["--plugin", "@prettier/plugin-oxc"]],
  ])("the plugin that only reads with another parser, named by %s, changes nothing", async (_, files, flags = []) => {
    const result = await format({ ...files, "a.js": ugly, "a.ts": "let  a: 1\n" }, ["--log-level=warn", ...flags], {
      reads: ["a.js", "a.ts"],
    });
    expect(result.stderr).toBe("");
    expect(result.files).toEqual({ "a.js": formatted, "a.ts": "let a: 1;\n" });
    expect(result.exitCode).toBe(0);
  });

  test("a plugin that only adds a language: the rest is formatted, and the files of that language are counted", async () => {
    const files = {
      ".prettierrc": '{ "plugins": ["prettier-plugin-astro"] }\n',
      "a.js": ugly,
      "b.astro": "<p   >b</p>\n",
      "c.svelte": "<p   >c</p>\n",
    };
    const result = await format(files, [], { reads: ["a.js", "b.astro", "c.svelte"] });
    expect(result.files).toEqual({ "a.js": formatted, "b.astro": files["b.astro"], "c.svelte": files["c.svelte"] });
    expect(result.stderr).toContain("does not support its language yet: 1 .astro\n");
    expect(result.exitCode).toBe(2);
  });

  test("which names are read: Prettier's, or oxfmt's with an .oxfmtrc.json, which tells upper case from lower case", async () => {
    const script = "a  ;\n";
    const json = '{"a":   1}\n';
    const files = {
      "a.es6": script,
      "b.jsm": script,
      "Jakefile": script,
      "c.start.frag": script,
      "d.wxs": script,
      "e.js.flow": script,
      "f.4DForm": json,
      "g.JSON": json,
      "h.MD": "#   h\n",
      "i.yaml.sed": "a:   1\n",
      "j.frag": script,
    };
    expect(await different(files, [])).toEqual([
      "a.es6",
      "b.jsm",
      "c.start.frag",
      "d.wxs",
      "e.js.flow",
      "g.JSON",
      "h.MD",
      "i.yaml.sed",
      "Jakefile",
    ]);
    expect(await different({ ...files, ".oxfmtrc.json": "{}\n" }, [])).toEqual([
      "Jakefile",
      "a.es6",
      "b.jsm",
      "c.start.frag",
      "f.4DForm",
    ]);
  });

  test("below an .oxfmtrc.json files are printed as oxfmt prints them, also if the run starts above it", async () => {
    const files = {
      "a.ts": "let a = // comment\n{\n  b: 1\n}\n",
      "packages/c/.oxfmtrc.json": "{}\n",
      "packages/c/a.ts": "let a = // comment\n{\n  b: 1\n}\n",
    };
    const result = await format(files, [], { reads: ["a.ts", "packages/c/a.ts"] });
    expect(result.files).toEqual({
      "a.ts": "let a =\n  // comment\n  {\n    b: 1,\n  };\n",
      "packages/c/a.ts": "let a = // comment\n  {\n    b: 1,\n  };\n",
    });
    expect(result.exitCode).toBe(0);
  });

  describe("without a configuration file", () => {
    // 90 columns: one line for oxfmt, whose lines are 100 wide.
    const asOxfmt = `const value = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree);\n`;
    const asPrettier = `const value = someFunction(\n  argumentNumberOne,\n  argumentNumberTwo,\n  argumentNumberThree,\n);\n`;
    const after = async (files: Record<string, string>, args: string[] = []) =>
      (await format({ "a.ts": asOxfmt, ...files }, args, { reads: ["a.ts"] })).files["a.ts"];

    test("a project that depends on oxfmt or Vite+ gets oxfmt's style", async () => {
      expect(await after({})).toBe(asPrettier);
      expect(await after({ "package.json": '{ "devDependencies": { "oxfmt": "0.72.0" } }\n' })).toBe(asOxfmt);
      expect(await after({ "package.json": '{ "dependencies": { "vite-plus": "1.0.0" } }\n' })).toBe(asOxfmt);
      const both = await format(
        { "a.ts": asOxfmt, "package.json": '{ "devDependencies": { "oxfmt": "0.72.0", "prettier": "3.9.9" } }\n' },
        ["a.ts"],
        { reads: ["a.ts"] },
      );
      // Depending on both suggests a migration to oxfmt, so oxfmt wins.
      expect(both.files["a.ts"]).toBe(asOxfmt);
      expect(both.stderr).toContain(
        "note: No config file found, and package.json depends on both oxfmt and prettier\n  Formatting like oxfmt. Add a config file to change that.",
      );
      // A configuration file says more than that.
      expect(
        await after({ "package.json": '{ "devDependencies": { "oxfmt": "0.72.0" } }\n', ".prettierrc": "{}\n" }),
      ).toBe(asPrettier);
    });

    test("no registry is asked for what a configuration file imports", async () => {
      let requests = 0;
      using registry = Bun.serve({
        port: 0,
        fetch() {
          requests++;
          return new Response("{}", { status: 404 });
        },
      });
      const result = await format(
        {
          "package.json": '{ "devDependencies": { "vite-plus": "1.0.0" } }\n',
          "vite.config.ts":
            'import { defineConfig } from "vite-plus";\nexport default defineConfig({ fmt: { semi: false } });\n',
          "a.js": "a;\n",
        },
        ["a.js"],
        { reads: ["a.js"], env: { BUN_CONFIG_REGISTRY: registry.url.href, NPM_CONFIG_REGISTRY: registry.url.href } },
      );
      expect(result.files["a.js"]).toBe("a\n");
      expect(requests).toBe(0);
    });

    test("a project that depends on Vite+ has its options in the fmt of the nearest vite.config.ts that has one", async () => {
      const files = {
        "package.json": '{ "devDependencies": { "vite-plus": "1.0.0" } }\n',
        "vite.config.ts":
          'import { defineConfig } from "vite-plus";\nexport default defineConfig(() => ({ fmt: { semi: false, ignorePatterns: ["c.js"] } }));\n',
        "a.js": "a;\n",
        "c.js": "c  ;\n",
        // One configuration for the whole project.
        "nested/vite.config.ts": "export default { fmt: { semi: true } };\n",
        "nested/b.js": "b;\n",
        "other/vite.config.mjs": "export default { plugins: [] };\n",
        "other/d.js": "d;\n",
      };
      const reads = ["a.js", "c.js", "nested/b.js", "other/d.js"];
      const result = await format(files, ["a.js", "c.js", "nested", "other/d.js"], { reads });
      expect(result.files).toEqual({ "a.js": "a\n", "c.js": "c  ;\n", "nested/b.js": "b\n", "other/d.js": "d\n" });
      expect(result.exitCode).toBe(0);
      // From a directory whose own has no fmt, the one above counts.
      const below = await format(files, ["d.js"], { reads, cwd: "other" });
      expect(below.files["other/d.js"]).toBe("d\n");
      const named = await format(files, ["--config", "other/vite.config.mjs", "a.js"], { reads });
      expect(named.stderr).toContain("Expected a `fmt` field in the default export of");
      expect(named.files["a.js"]).toBe("a;\n");
      expect(named.exitCode).toBe(1);
      // Without the dependency the file is Vite's alone.
      const without = await format({ ...files, "package.json": "{}\n" }, ["a.js"], { reads });
      expect(without.files["a.js"]).toBe("a;\n");
    });

    test("--flavor says which", async () => {
      expect(await after({}, ["--flavor", "oxfmt"])).toBe(asOxfmt);
      expect(
        await after({ "package.json": '{ "devDependencies": { "oxfmt": "0.72.0" } }\n' }, ["--flavor=prettier"]),
      ).toBe(asPrettier);
      const result = await format({ "a.ts": asOxfmt }, ["--flavor", "biome"]);
      expect(result.stderr).toContain('Invalid --flavor value. Expected "oxfmt" or "prettier", but received "biome".');
      expect(result.exitCode).toBe(2);
    });

    test("--config with a name that has oxfmt in it is a configuration file of oxfmt", async () => {
      const files = { "config/oxfmtrc.json": "{}\n", "a.ts": asOxfmt, "pnpm-lock.yaml": "a:   1\n" };
      const result = await format(files, ["--config", "config/oxfmtrc.json"], { reads: ["a.ts", "pnpm-lock.yaml"] });
      expect(result.files).toEqual({ "a.ts": asOxfmt, "pnpm-lock.yaml": "a:   1\n" });
      expect(result.exitCode).toBe(0);
    });
  });

  // As Prettier 3.9.9 and oxfmt 0.72.
  test.each(["prettier.config.mjs", "oxfmt.config.ts"])(
    "`process.cwd()` in %s is where the command runs, not where the file is",
    async name => {
      const files = {
        [name]: `import { basename } from "node:path";\nexport default { semi: basename(process.cwd()) !== "sub" };\n`,
        "sub/a.js": "a\n",
      };
      const [below, beside] = await Promise.all([
        format(files, ["a.js"], { cwd: "sub", reads: ["sub/a.js"] }),
        format(files, ["sub/a.js"], { reads: ["sub/a.js"] }),
      ]);
      expect([below.files["sub/a.js"], beside.files["sub/a.js"]]).toEqual(["a\n", "a;\n"]);
    },
  );

  // As Prettier 3.9.9 and oxfmt 0.72, which read a configuration in Node.
  test.each(["prettier.config.mjs", "oxfmt.config.ts"])(
    "the .env of the project is not in `process.env` of %s, and what is inherited is",
    async name => {
      const files = {
        ".env": "FROM_FILE=1\n",
        [name]: "export default { semi: !process.env.FROM_FILE, singleQuote: !!process.env.INHERITED };\n",
        "a.js": 'a\nb("c")\n',
      };
      const result = await format(files, ["a.js"], { reads: ["a.js"], env: { INHERITED: "1" } });
      expect(result.files["a.js"]).toBe("a;\nb('c');\n");
    },
  );

  // As Prettier 3.9.9 and oxfmt 0.72, which read a configuration in Node. On Windows it still runs.
  test.skipIf(isWindows).each(["prettier.config.mjs", "oxfmt.config.ts"])(
    "a `preload` of bunfig.toml does not run before %s",
    async name => {
      const files = {
        "bunfig.toml": 'preload = ["./preload.ts"]\n',
        "preload.ts": 'throw new Error("not here");\n',
        [name]: "export default { semi: false };\n",
        "a.js": "a;\n",
      };
      const result = await format(files, ["a.js"], { reads: ["a.js"] });
      expect(result.files["a.js"]).toBe("a\n");
      expect(result.exitCode).toBe(0);
    },
  );

  // Prettier 3.9.9 and oxfmt 0.72 read a configuration in their own process: `[node, <the tool>, ...arguments]`.
  test.each(["prettier.config.mjs", "oxfmt.config.ts"])("`process.argv` of %s is the command line", async name => {
    // `--cwd sub` once more would be `sub/sub`.
    const args = ["--cwd", "sub", "--no-color", "--", "a.js"];
    const files = {
      [`sub/${name}`]: `
        const seen = JSON.stringify([process.argv[0] === process.execPath, ...process.argv.slice(1)]);
        export default { semi: seen !== ${JSON.stringify(JSON.stringify([true, "fmt", ...args]))} };\n`,
      "sub/a.js": "a;\n",
    };
    const result = await format(files, args, { reads: ["sub/a.js"] });
    expect(result.files["sub/a.js"]).toBe("a\n");
    expect(result.exitCode).toBe(0);
  });

  test("an oxfmt.config.ts that imports defineConfig from oxfmt works without the package", async () => {
    const files = {
      "oxfmt.config.ts": 'import { defineConfig } from "oxfmt";\nexport default defineConfig({ semi: false });\n',
      "a.js": "a;\n",
    };
    const result = await format(files, ["a.js"], { reads: ["a.js"] });
    expect(result.files["a.js"]).toBe("a\n");
    expect(result.exitCode).toBe(0);
  });

  test.skipIf(isWindows)("a named pipe with the name of a script is passed over, as by Prettier", async () => {
    const before = (dir: string) => expect(Bun.spawnSync(["mkfifo", join(dir, "pipe.js")]).exitCode).toBe(0);
    expect(await different({ "a.js": ugly }, [], { before })).toEqual(["a.js"]);
  });

  test("--experimental-cli is accepted", async () => {
    const result = await format({ "a.js": ugly }, ["--experimental-cli"], { reads: ["a.js"] });
    expect(result.files["a.js"]).toBe(formatted);
    expect(result.exitCode).toBe(0);
  });

  describe("a parser that Prettier does not have", () => {
    const files = {
      "a.astro": '<p   class="a">hi</p>\n',
      "b.foo": "a:   1\n",
      "c.js": "c  ;\n",
      "d.js": "d  ;\n",
    };
    const reads = Object.keys(files);
    const overrides = [
      { files: "*.astro", options: { parser: "astro" } },
      { files: ["*.foo", "c.js"], options: { parser: "nonsense" } },
    ];

    test("in the overrides of a .prettierrc: the files are left as they are, and counted", async () => {
      const config = JSON.stringify({ plugins: ["prettier-plugin-astro"], overrides });
      const result = await format({ ...files, ".prettierrc": config }, [], { reads });
      expect(result.files).toEqual({ ...files, "d.js": "d;\n" });
      expect(result.stderr).toContain(
        "3 files were not formatted because bun fmt does not support their language yet: 1 .astro, 1 .foo, 1 .js",
      );
      expect(result.exitCode).toBe(2);
      const checked = await format({ ...files, ".prettierrc": config, "d.js": "d;\n" }, ["--check", ...reads], {
        reads,
      });
      expect(checked.files).toEqual({ ...files, "d.js": "d;\n" });
      expect(checked.stderr).toContain(
        "3 files were not formatted because bun fmt does not support their language yet",
      );
      expect(checked.exitCode).toBe(2);
    });

    test("at the top of a .prettierrc: every file is left as it is", async () => {
      const result = await format({ ...files, ".prettierrc": '{ "parser": "nonsense" }\n' }, [], { reads });
      expect(result.files).toEqual(files);
      expect(result.stderr).toContain("files were not formatted because bun fmt does not support their language yet");
      expect(result.exitCode).toBe(2);
    });

    test("on standard input: an error, as for a file, and nothing is printed", async () => {
      const config = JSON.stringify({ overrides });
      const result = await format({ ".prettierrc": config }, ["--stdin-filepath", "a.astro"], {
        stdin: files["a.astro"],
      });
      expect(result.raw).toBe("");
      expect(result.stderr).toBe(
        "error: 1 file was not formatted because bun fmt does not support its language yet: 1 .astro\n  Use --allow-unsupported to make this a warning.",
      );
      expect(result.exitCode).toBe(2);
    });

    test("in an .oxfmtrc.json, which has no such option: it does not count", async () => {
      for (const config of [{ parser: "nonsense" }, { overrides }]) {
        const result = await format({ ...files, ".oxfmtrc.json": JSON.stringify(config) + "\n" }, [], { reads });
        expect(result.files).toEqual({ ...files, "c.js": "c;\n", "d.js": "d;\n" });
        expect(result.exitCode).toBe(0);
      }
    });

    test("after --parser: an error, and nothing is written", async () => {
      const result = await format(files, ["--parser", "nonsense"], { reads });
      expect(result.files).toEqual(files);
      expect(result.stderr).toContain(`error: Couldn't resolve parser "nonsense".`);
      expect(result.exitCode).toBe(2);
      const piped = await format({}, ["--parser", "nonsense", "--stdin-filepath", "c.js"], { stdin: files["c.js"] });
      expect(piped.raw).toBe("");
      expect(piped.stderr).toContain(`error: Couldn't resolve parser "nonsense".`);
      expect(piped.exitCode).toBe(2);
    });
  });

  test.each([
    ["arrays", (depth: number) => Buffer.alloc(depth, "[").toString() + Buffer.alloc(depth, "]").toString()],
    [
      "objects",
      (depth: number) => Buffer.alloc(depth * 5, '{"a":').toString() + "1" + Buffer.alloc(depth, "}").toString(),
    ],
  ])("JSON is not formatted into gigabytes: %s", async (_, make) => {
    const files = { "ok.json": make(512), "huge.json": make(200_000) };
    const [ok, huge] = await Promise.all(Object.keys(files).map(name => format(files, ["--check", name])));
    expect(ok.stderr).not.toContain("error:");
    expect(huge.stderr).toMatch(/^error: .+\n    at huge\.json$/m);
    expect(huge.exitCode).toBe(2);
  });

  // Neither Prettier nor oxfmt has a number for how deep something can be nested or how long it can be: Prettier ends where its
  // stack does, or the longest string of JavaScript. What is expected is the SHA-1 of what Prettier 3.9.9 (run with
  // `node --stack-size=50000`, or its stack ends sooner than ours) and oxfmt 0.72.0 print.
  describe("as deep and as long as it is written", () => {
    const nested = (before: string, open: string, middle: string, close: string, after: string, depth: number) =>
      before + open.repeat(depth) + middle + close.repeat(depth) + after;
    const oxfmtrc = { ".oxfmtrc.json": "{}" };
    const wide = { ".prettierrc": `{ "printWidth": 1000000 }` };
    test.skipIf(isDebug || isASAN).concurrent.each<[string, string, Record<string, string>, string, string]>([
      [
        "a srcset of more than 1 MB",
        "a.html",
        {},
        `<img srcset="${"u".repeat(2_000)} 1w${", a 2w".repeat(530)}">`,
        "cd5d914bd74ea6d35260353a2a7d1b863aedda26",
      ],
      [
        "@param tags 300 blocks deep",
        "a.js",
        { ".oxfmtrc.json": `{ "jsdoc": {} }` },
        nested("", "{", "/**\n * @param {x} b x\n * @param {x} a y\n */\nfunction f(a, b) {}", "}", "", 300),
        "a78549a9394497bf5f8ec95622265c3a7e3044bb",
      ],
      [
        "150 unions in each other",
        "a.ts",
        {},
        nested("type A = ", `| ${"a".repeat(90)} | { a: `, "b", " }", ";", 150),
        "560cf5303a94ab88e5b60a881654b7802ee98c0e",
      ],
      [
        "TOML: 300 arrays",
        "a.toml",
        oxfmtrc,
        nested("a = ", "[", "1", "]", "", 300),
        "d09bbd9c36a29ea5b19dba2aee988f14078152bc",
      ],
      [
        "TOML: 300 inline tables in arrays",
        "a.toml",
        oxfmtrc,
        nested("a = ", "[{ b = ", "1", " }]", "", 300),
        "ef05a4d39a16033686fa0f7feaa67915d48f3021",
      ],
      [
        "JSON: 600 arrays",
        "a.json",
        oxfmtrc,
        nested("", "[", "1", "]", "", 600),
        "d3b357229942f2d7f19db1569095a5830ac90354",
      ],
      [
        "JSON: 600 objects",
        "a.json",
        oxfmtrc,
        nested("", '{"a":', "1", "}", "", 600),
        "75277b2894408bad0d9c3f7cde2312caaf0cc7f8",
      ],
      [
        "CSS: 300 rules",
        "a.css",
        {},
        nested("", "a{", "b:c", "}", "", 300),
        "67eeb07bbf7e53a317be732b9e1e6f6778d6a8e4",
      ],
      [
        "SCSS: 300 rules",
        "a.scss",
        {},
        nested("", "a{", "b:c", "}", "", 300),
        "67eeb07bbf7e53a317be732b9e1e6f6778d6a8e4",
      ],
      [
        "Less: 300 rules",
        "a.less",
        {},
        nested("", "a{", "b:c", "}", "", 300),
        "67eeb07bbf7e53a317be732b9e1e6f6778d6a8e4",
      ],
      [
        "CSS: 200 parentheses",
        "a.css",
        {},
        nested("a{b:", "(", "1", ")", "}", 200),
        "1b8aec53490fd2ed6cdea4429746a7738bf7fd19",
      ],
      [
        "CSS: 200 functions",
        "a.css",
        {},
        nested("a{b:", "f(", "1", ")", "}", 200),
        "aa39aa342f4a8213ec969b51635d90bcccda1dd8",
      ],
      [
        "CSS: 200 pseudo classes",
        "a.css",
        {},
        nested("a", ":not(", "b", ")", "{}", 200),
        "ce28e0b8d5fd202f3a3ab2e1f9254d32412ad032",
      ],
      [
        "YAML: 150 flow sequences",
        "a.yaml",
        {},
        nested("", "[", "1", "]", "", 150),
        "76b35730b2709ae9a6c44fe63e3fea53b034d9d6",
      ],
      [
        "YAML: 150 flow mappings",
        "a.yaml",
        {},
        nested("", "{a: ", "1", "}", "", 150),
        "cd73cae399a8333bb28815e88cbccf5f7f13ca73",
      ],
      [
        "YAML: 150 sequences",
        "a.yaml",
        {},
        nested("", "- ", "1", "", "", 150),
        "e1a8ea12ccc9716fce57009c7ca4c541033bc57d",
      ],
      // Each one took twice the memory of the one in it.
      [
        "YAML: 40 mappings with a comment behind the key",
        "a.yaml",
        {},
        Array.from({ length: 40 }, (_, i) => `${Buffer.alloc(i, " ").toString()}a: # c\n`).join("") +
          `${Buffer.alloc(40, " ").toString()}b: c\n`,
        "ed218e0b39393da450552421d2345f583eb8689a",
      ],
      [
        "Handlebars: 300 blocks",
        "a.hbs",
        {},
        nested("", "{{#if a}}", "b", "{{/if}}", "", 300),
        "9a68d3fd6774fab8566ba24622555917ef869b8a",
      ],
      [
        "Handlebars: 300 elements",
        "a.hbs",
        {},
        nested("", "<div>", "b", "</div>", "", 300),
        "360991e16eaad56f383ff2080ade36c8c345f7f9",
      ],
      [
        "Handlebars: 300 expressions",
        "a.hbs",
        {},
        nested("{{a ", "(b ", "c", ")", "}}", 300),
        "38c9869108b53b9fffbfde5362460097932b06ba",
      ],
      [
        "Handlebars: 300 times else if",
        "a.hbs",
        {},
        `{{#if a}}b${"{{else if a}}b".repeat(300)}{{/if}}`,
        "862ae827fa53b6c631b0297941557cd0478e439b",
      ],
      [
        "Angular: 450 blocks",
        "a.component.html",
        {},
        nested("", "@if (a) {", "b", "}", "", 450),
        "72eb9cbaf3752a0693787cff1ba17d2c5ad3a410",
      ],
      [
        "HTML: 450 elements",
        "a.html",
        {},
        nested("", "<div>", "a", "</div>", "", 450),
        "2017edf44316b0dc0b2212749e4fe09f7acd28e6",
      ],
      [
        "Vue: 450 elements",
        "a.vue",
        {},
        nested("<template>", "<div>", "a", "</div>", "</template>", 450),
        "3fbdb4e6fd57e141396b7e393fc1c7cad22b0eab",
      ],
      [
        "HTML in a template that more than 1,024 bytes of its line are before",
        "a.js",
        {},
        `function f() {\n  const ${"a".repeat(1_100)} = /* HTML */ \`<script type="application/json">\n      ["${"a".repeat(70)}", 1]\n    </script>\`;\n}\n`,
        "66b03f2c6730c8595e07fdd3c41ac874dfc3c786",
      ],
      [
        "printWidth 1,000,000: an array of 90,000 columns",
        "a.js",
        wide,
        `x = [${"a, ".repeat(30_000)}a];`,
        "ceb1977b11ba34255575ded81bd39e001c4c5ef1",
      ],
      [
        "printWidth: Infinity in a program: an array of 90,000 columns",
        "a.js",
        { "prettier.config.mjs": "export default { printWidth: Infinity };" },
        `x = [${"a, ".repeat(30_000)}a];`,
        "ceb1977b11ba34255575ded81bd39e001c4c5ef1",
      ],
      [
        "printWidth 1,000,000: a value of 80,000 columns",
        "a.css",
        wide,
        `a{b:${"a ".repeat(40_000)}a}`,
        "c4fabc142c10cf06916f937c3e06f289a39c2673",
      ],
      [
        "printWidth 1,000,000: an array of 100,000 columns",
        "a.json",
        wide,
        `[${'"a", '.repeat(20_000)}1]`,
        "64818eef7c948c717b18d3c465a81ce8590d1a59",
      ],
      [
        "tabWidth 254",
        "a.js",
        { ".prettierrc": `{ "tabWidth": 254 }` },
        `x = {${"a".repeat(69)}: "${"a".repeat(75)}"}`,
        "10952485e69d0548ef12ba7a9d087b5c98c4f6ad",
      ],
    ])("%s", async (_, name, configuration, text, sha1) => {
      const result = await format(configuration, ["--stdin-filepath", name], { stdin: text });
      expect(result.stderr).toBe("");
      expect(new Bun.CryptoHasher("sha1").update(result.raw).digest("hex")).toBe(sha1);
      expect(result.exitCode).toBe(0);
    });

    // The frames of a debug build are larger, so its stack ends sooner.
    const tooDeep = isDebug || isASAN ? 100_000 : 1_000_000;
    test.each([
      ["a.toml", nested("a = ", "[", "1", "]", "", tooDeep)],
      ["a.css", nested("", "a{", "b:c", "}", "", tooDeep)],
      ["b.css", nested("a{b:", "(", "1", ")", "}", tooDeep)],
      ["c.css", nested("a{b:", "f(", "1", ")", "}", tooDeep)],
      ["d.css", nested("a", ":not(", "b", ")", "{}", tooDeep)],
      ["a.graphql", nested("", "{a", "", "}", "", tooDeep)],
      ["a.yaml", nested("", "[", "1", "]", "", tooDeep)],
      ["b.yaml", nested("", "- ", "1", "", "", tooDeep)],
      ["a.md", nested("", "+ ", "a", "", "", tooDeep)],
      ["b.md", nested("", "> ", "a", "", "", tooDeep)],
      ["a.hbs", nested("", "{{#if a}}", "b", "{{/if}}", "", tooDeep)],
      ["b.hbs", nested("", "<div>", "b", "</div>", "", tooDeep)],
      ["c.hbs", nested("{{a ", "(b ", "c", ")", "}}", tooDeep)],
      ["a.html", nested("", "<div>", "a", "</div>", "", tooDeep)],
      ["a.vue", nested("<template>", "<div>", "a", "</div>", "</template>", tooDeep)],
      ["a.component.html", nested("", "@if (a) {", "b", "}", "", tooDeep)],
      ["b.component.html", nested("", "{a, select, b {", "c", "}}", "", tooDeep)],
      // In a JSDoc comment, with `jsdoc` of oxfmt.
      ["a.js", nested("/**\n * ", "> ", "a", "", "\n */ let a;", tooDeep)],
    ])("what there is no stack for, or no string, is an error, and the file stays as it is: %s", async (name, text) => {
      const files = { ".oxfmtrc.json": `{ "jsdoc": {} }`, [name]: text };
      const result = await format(files, [name], { reads: [name] });
      expect(result.files[name]).toBe(text);
      const summary = "\n\nError occurred when checking code style in the above files.";
      expect(result.stderr).toBeOneOf([
        problem(name, "The code is nested too deeply") + summary,
        problem(name, "The formatted code is too long for a string") + summary,
      ]);
      expect(result.exitCode).toBe(2);
    });

    // The guard of a case was written without asking whether there is stack for it: between the depth that the printer
    // refuses and the one that the parser refuses it ran out. The threads that format files have stack to spare, so this
    // is the main thread, with half of what it has.
    test.skipIf(isWindows || isDebug || isASAN).concurrent.each([4_500, 4_612, 4_728, 4_846, 4_967, 5_091])(
      "Flow's match with %d guards in each other, on a stack of 4 MB",
      async depth => {
        using dir = tempDir("bun-format-small-stack", {});
        await using proc = spawn({
          cmd: ["sh", "-c", `ulimit -s 4096 && exec "$0" "$@"`, ...command, "--stdin-filepath", "a.js"],
          env,
          cwd: String(dir),
          stdin: Buffer.from(nested("// @flow\nx = ", "match (a) {b if (", "c", ") => d}", ";\n", depth)),
          stdout: "ignore",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
        expect(stderr).toBeOneOf(["", problem("a.js", "The code is nested too deeply") + "\n\n"]);
        expect({ exitCode, signalCode: proc.signalCode }).toEqual({
          exitCode: stderr === "" ? 0 : 2,
          signalCode: null,
        });
      },
    );

    test("a text that is longer than a string of JavaScript can be is refused", async () => {
      // 560 MB. Prettier prints 490 MB.
      const text = `<img srcset="${"u".repeat(70_000)} 1w${", a 2w".repeat(8_000)}">\n`;
      const result = await format({ "a.html": text }, ["a.html"], { reads: ["a.html"] });
      expect(result.files["a.html"]).toBe(text);
      expect(result.stderr).toStartWith(problem("a.html", "The formatted code is too long for a string") + "\n\n");
      expect(result.exitCode).toBe(2);
    });

    test("the line of a syntax error is shown, however long it is", async () => {
      const text = `a{${Buffer.alloc(1000, "b:c;").toString()}}}`;
      const result = await format({ "a.css": text }, ["a.css"]);
      expect(result.stderr).toStartWith(problem("a.css", 'Unexpected "}"', [1, 1_004, text]) + "\n\n");
      expect(result.exitCode).toBe(2);
    });

    // The time it takes is in proportion to the square of the number of differences: 84 s in Prettier.
    test.skipIf(isDebug || isASAN)(
      "the cursor is found by comparing all of the text, whatever has changed",
      async () => {
        const result = await format({}, ["--stdin-filepath", "a.yaml", "--cursor-offset", "71400"], {
          stdin: "- [a,]\n".repeat(20_400),
        });
        expect(result.raw).toBe("- [a]\n".repeat(20_400));
        expect(result.stderr.trim()).toBe("61200");
        expect(result.exitCode).toBe(0);
      },
      30_000,
    );
  });

  // How deep is too deep is up to the stack, and a thread has four times as much of it on Windows: there `keyof ` is formatted.
  test.each(["@", "keyof ", "renders ", "infer A extends ", "component() renders "])(
    "code that is nested very deeply is refused or formatted, and does not overflow the stack: 100,000 times `%s`",
    async word => {
      const text = word === "@" ? word.repeat(100_000) : `// @flow\ntype A = ${word.repeat(100_000)}x;`;
      const result = await format({ "deep.js": text + "\n" }, ["--check", "deep.js"]);
      expect(result.stdout + "\n" + result.stderr).toMatch(/^(?:error: .+\n    at deep\.js\b|deep\.js$)/m);
      expect(result.exitCode).toBe(result.stderr.includes("error:") ? 2 : 1);
    },
  );

  // What a file is like while it is being written. TypeScript's parser goes on and leaves these to its checker.
  test.each([
    "let x = 1;\nconst",
    "var",
    "export const",
    "export var;",
    "function f() { const }",
    "for (const of a);",
    "for (var of a);",
    "for (const in a);",
    "for (var;;);",
    "class extends A {}",
    "class A extends {}",
    "x = class extends {}",
    "class A<> {}",
    "function f<>() {}",
  ])("JavaScript in which a name is missing is a syntax error, and the file stays as it is: %j", async code => {
    const files = { "a.js": code + "\n", "b.mjs": code + "\n", "c.jsx": code + "\n" };
    const result = await format(files, [], { reads: Object.keys(files) });
    expect(result.files).toEqual(files);
    for (const name of Object.keys(files)) expect(result.stderr).toMatch(syntaxErrorIn(name));
    expect(result.exitCode).toBe(2);
  });

  test.each([
    "x = {a?: 1}",
    "x = {a!}",
    "x = {async a}",
    "x = {async a: 1}",
    "x = {static a: 1}",
    "x = {async get a() {}}",
    "class A { async a }",
    "class A { async a = 1 }",
    "class A { async async a() {} }",
    "class A { accessor a() {} }",
    "class A { accessor static a }",
    "class A { async static {} }",
    "class A { static static {} }",
    "class A { @a static {} }",
    "class A extends B extends C {}",
    "try {} catch (a = 1) {}",
    "let a!",
    "class A { a! }",
    "x = {[a]?: 1}",
    "x = {readonly a: 1}",
    "function f(this) {}",
    "class A { get a?() {} }",
    "export export class A {}",
  ])("what only TypeScript's parser reads is a syntax error in JavaScript: %j", async code => {
    const result = await format({ "a.js": code + "\n" }, ["a.js"], { reads: ["a.js"] });
    expect(result.files).toEqual({ "a.js": code + "\n" });
    expect(result.stderr).toMatch(syntaxErrorIn("a.js"));
    expect(result.exitCode).toBe(2);
  });

  test.each([
    "function f(x: number): string",
    "function* g()",
    "class A { m(): void }",
    "x = { m(): void }",
    "export default function f(): void",
  ])("Flow: a function without a body is a syntax error: %j", async code => {
    const files = { "a.js": `// @flow\n${code}\n` };
    const result = await format(files, ["a.js"], { reads: ["a.js"] });
    expect(result.files).toEqual(files);
    expect(result.stderr).toMatch(syntaxErrorIn("a.js"));
    expect(result.exitCode).toBe(2);
  });

  test("Flow: a function that is declared has no body", async () => {
    const code = `// @flow
declare function f(x: number): string;
declare class A {
  m(): void;
}
declare module "m" {
  declare function g(): void;
}
declare export function h(): void;
`;
    const result = await format({ "a.js": code }, ["--check", "a.js"]);
    expect(result.stderr).not.toContain("a.js");
    expect(result.exitCode).toBe(0);
  });

  // What oxfmt 0.72.0 does with each. It runs OXC's parser alone: what the pass that builds the scopes reports, oxlint refuses
  // and oxfmt formats. Prettier formats a `const` without an initializer.
  test.each([
    ["a.ts", "const a: string;"],
    ["a.ts", "using a;"],
    ["a.js", "const a;"],
    ["a.js", "const { a };"],
    ["a.ts", "class A { set x(a = await g()) {} }"],
    ["a.ts", "yield g;"],
    ["a.ts", "function* g() { function yield() {} }"],
    ["a.js", "class A { static { var await; } }"],
    ["a.ts", "label: enum E {}"],
    ["a.cjs", "void import.meta;"],
    ["a.ts", "module M { await g(); }"],
    ["a.ts", "namespace N { for await (const x of y) ; }"],
    ["a.ts", "let x: { a; b; c?; readonly d; [e: string] };"],
    ["a.d.ts", "await g;"],
    ["a.ts", "declare class A { x = await g; }"],
    ["a.ts", "class A { set x(v?: number) {} }"],
    ["a.ts", "declare module A { export = B }"],
    ["a.d.ts", "function f() { yield; }"],
    ["a.ts", "declare namespace N { export default class {} }"],
    ["a.d.ts", "await using x = g();"],
    ["a.ts", "class A { constructor(this: never) {} }"],
    ["a.js", 'export * from "m" with { type: 1 };'],
    ["a.ts", 'export * from "m" with { type: 1 };'],
    ["a.js", 'import a from "m" with { type: 1 };'],
    ["a.ts", "type T<in out A, const B_ = 1> = A;"],
    ["a.ts", "interface I<const A> {}"],
    ["a.ts", "function f<in A>() {}"],
  ])("with an .oxfmtrc.json what OXC's parser refuses is a syntax error: %s: %j", async (name, code) => {
    const files = { [name]: code + "\n" };
    const result = await format({ ...files, ".oxfmtrc.json": "{}\n" }, [name], { reads: [name] });
    expect(result.files).toEqual(files);
    expect(result.stderr).toMatch(syntaxErrorIn(name));
    expect(result.exitCode).toBe(2);
  });

  test.each([
    ["a.ts", "declare const a: string;"],
    ["a.d.ts", "export const a: string;"],
    ["a.ts", "export const a = /(/;"],
    ["a.ts", "export {};\nlet = 1;"],
    ["a.js", "export {};\nstatic = 1;"],
    ["a.js", "for (const a of b);"],
    // typescript-estree and Babel refuse these.
    ["a.js", "function f(a = await g()) {}"],
    ["a.js", "function* a(x = yield 1) {}"],
    ["a.mts", "for (var i = 0 in {});"],
    ["a.ts", "for (const x: any of y);"],
    ["a.ts", "with (a) b;"],
    ["a.js", "if (a) label: function f() {}"],
    ["a.js", 'import("m", { with: { type: 1 } });'],
    ["a.ts", "class C<const A> {}\nfunction g<const A>() {}\ninterface I<in out A> {}"],
  ])("with an .oxfmtrc.json what OXC's parser takes is formatted: %s: %j", async (name, code) => {
    const result = await format({ [name]: code + "\n", ".oxfmtrc.json": "{}\n" }, ["--check", name]);
    expect(result.stderr).not.toMatch(anError);
    expect(result.exitCode).toBe(0);
  });

  test("the modifiers of JavaScript where they can be", async () => {
    const code = `class A {
  static async *a() {}
  static accessor b = 1;
  static get c() {}
  static async constructor() {}
  async static() {}
  static static() {}
  static async;
  @d static e = 1;
  static {}
}
x = {
  async a() {},
  async *b() {},
  static: 1,
  async,
  static() {},
  async get() {},
};
try {
} catch ({ a = 1 }) {}
`;
    const result = await format({ "a.js": code }, ["--check", "a.js"]);
    expect(result.stderr).not.toContain("a.js");
    expect(result.exitCode).toBe(0);
  });

  test("a block of JavaScript in Markdown in which a name is missing stays as it is", async () => {
    const files = { "a.md": "```js\nlet   x = 1;\nconst\n```\n" };
    const result = await format(files, [], { reads: ["a.md"] });
    expect(result.files).toEqual(files);
    expect(result.exitCode).toBe(0);
  });

  test("YAML, GraphQL, Markdown", async () => {
    const result = await format(
      {
        "a.yaml": "a:   1\nb:   [ c,d ]\n",
        "b.yml": "- 'a'\n",
        "c.graphql": "query Q($a:Int){b(c:$a){d e}}\n",
        "d.md": "Title\n===\n\n*  a\n*  b\n\n```js\nf( 1 )\n```\n",
      },
      [],
      { reads: ["a.yaml", "b.yml", "c.graphql", "d.md"] },
    );
    expect(result.files).toEqual({
      "d.md": "Title\n===\n\n- a\n- b\n\n```js\nf(1);\n```\n",
      "a.yaml": "a: 1\nb: [c, d]\n",
      "b.yml": '- "a"\n',
      "c.graphql": "query Q($a: Int) {\n  b(c: $a) {\n    d\n    e\n  }\n}\n",
    });
    expect(result.exitCode).toBe(0);
  });

  test("CSS", async () => {
    const result = await format({ "a.css": "a{color:red}\n", "b.scss": "a{b{color:RED}}\n" }, [], {
      reads: ["a.css", "b.scss"],
    });
    expect(result.files).toEqual({
      "a.css": "a {\n  color: red;\n}\n",
      "b.scss": "a {\n  b {\n    color: RED;\n  }\n}\n",
    });
    expect(result.exitCode).toBe(0);
  });

  test("--end-of-line auto goes by the first \\r, also if lines before it end in \\n", async () => {
    const result = await format(
      { "a.js": "a;\nb;\r\nc;\n", "b.css": "a {\n}\nb {\n}\r", "c.js": "a;\nb;\n" },
      ["--end-of-line", "auto"],
      { reads: ["a.js", "b.css", "c.js"] },
    );
    expect(result.files).toEqual({
      "a.js": "a;\r\nb;\r\nc;\r\n",
      "b.css": "a {\r}\rb {\r}\r",
      "c.js": "a;\nb;\n",
    });
    expect(result.exitCode).toBe(0);
  });

  test("a value of 10,000 lines in a style sheet does not take quadratic time", async () => {
    const result = await format({ "a.css": `a {\n  b:${Buffer.alloc(60_000, "\n    c").toString()};\n}\n` }, [], {
      reads: ["a.css"],
    });
    expect(result.files["a.css"]?.split(/\s+/).join(" ")).toBe(`a { b:${Buffer.alloc(20_000, " c").toString()}; } `);
    expect(result.exitCode).toBe(0);
  });

  test("100,000 namespaces before a name in a selector do not take the stack", async () => {
    for (const prefix of ["a|", "*|"]) {
      const result = await format({ "a.css": `${Buffer.alloc(200_000, prefix).toString()}a {\n}\n` }, [], {
        reads: ["a.css"],
      });
      expect(result.files["a.css"]).toBe(`${prefix}a {\n}\n`);
      expect(result.exitCode).toBe(0);
    }
  }, 60_000);

  test("100,000 comments on a line of JSON do not take quadratic time", async () => {
    const comments = Buffer.alloc(400_000, "/**/").toString();
    const result = await format({ "a.json": `${comments}1\n`, "b.json": `[1${comments}, 2]\n` }, [], {
      reads: ["a.json", "b.json"],
    });
    expect(result.files["a.json"]?.replaceAll("/**/", "").trim()).toBe("1");
    expect(result.files["a.json"]?.split("/**/").length).toBe(100_001);
    expect(result.files["b.json"]?.split("/**/").length).toBe(100_001);
    // The clock says nothing on a busy machine.
    expect(result.cpu).toBeLessThan(isDebug || isASAN ? 20 : 5);
    expect(result.exitCode).toBe(0);
  }, 60_000);

  test("insert_final_newline of an .editorconfig says nothing to Prettier, and nothing is said about it", async () => {
    const result = await format(
      { ".editorconfig": "root = true\n[*]\ninsert_final_newline = true\nindent_size = 4\n", "a.js": "if (a) b;\n" },
      ["--check", "a.js"],
    );
    expect(result.stderr).toBe("1 file is formatted.");
    expect(result.exitCode).toBe(0);
  });

  test("the first line says what a file without an extension is", async () => {
    const files = {
      "bin/a": "#!/usr/bin/env node\na  ;\n",
      "bin/b": "#!/usr/bin/env tsx\nlet a : number;\n",
      "bin/c": "#!/bin/sh\necho  a\n",
      "bin/d": "#!/usr/local/bin/node\na  ;\n",
      "bin/e": "#!/usr/bin/env -S node --x\na  ;\n",
    };
    const after = {
      ...files,
      "bin/a": "#!/usr/bin/env node\na;\n",
      "bin/b": "#!/usr/bin/env tsx\nlet a: number;\n",
      "bin/d": "#!/usr/local/bin/node\na;\n",
    };
    const reads = Object.keys(files);
    // In a directory the others are passed over.
    const directory = await format(files, ["bin"], { reads });
    expect(directory.files).toEqual(after);
    expect(directory.stderr).not.toMatch(anError);
    expect(directory.exitCode).toBe(0);
    const named = await format(files, reads, { reads });
    expect(named.files).toEqual(after);
    expect(named.stderr.split("\n").filter(line => line.includes("No parser could be inferred")).length).toBe(2);
    expect(named.exitCode).toBe(2);
  });

  // `prettier.getSupportInfo()` has `bun` and `deno` among the interpreters of JavaScript, of Flow and of TypeScript. The first
  // language counts, so the parser is `babel`, and Prettier 3.9.9 refuses a type in such a file.
  test.each(["bun", "deno", "node", "zx"])(
    "a file without an extension for %s is JavaScript, as for Prettier",
    async interpreter => {
      const files = {
        "bin/a": `#!/usr/bin/env ${interpreter}\na  ;\n`,
        "bin/b": `#!/usr/bin/env ${interpreter}\nconst  port: number = 3000\n`,
      };
      const result = await format(files, ["bin/a", "bin/b"], { reads: ["bin/a", "bin/b"] });
      expect(result.files).toEqual({ ...files, "bin/a": `#!/usr/bin/env ${interpreter}\na;\n` });
      expect(result.stderr).toMatch(syntaxErrorIn("bin/b"));
      expect(result.exitCode).toBe(2);
    },
  );

  // linguist has them under JSON. Prettier 3.9.9 leaves them out of its language: `prettier.getSupportInfo()`.
  test("what a tool has written and Prettier does not read", async () => {
    const names = ["composer.lock", "Pipfile.lock", "flake.lock", "deno.lock", "mcmod.info", "MODULE.bazel.lock"];
    const files = Object.fromEntries(names.map(name => [name, '{"a":   1}\n']));
    // Prettier reads glide.lock as YAML. Without a Prettier config, Bun skips it like every other lock file.
    const all = { ...files, "glide.lock": "a:   1\n" };
    const directory = await format({ ...all, ".prettierrc": "{}\n" }, [], { reads: [...names, "glide.lock"] });
    expect(directory.files).toEqual({ ...files, "glide.lock": "a: 1\n" });
    expect(directory.exitCode).toBe(0);
    expect((await format(all, [], { reads: [...names, "glide.lock"] })).files).toEqual(all);
    const named = await format(files, names, { reads: names });
    expect(named.files).toEqual(files);
    expect(named.stderr.split("\n").filter(line => line.includes("No parser could be inferred")).length).toBe(
      names.length,
    );
    expect(named.exitCode).toBe(2);
  });

  // The exit codes of Prettier 3.9.9. `handleError` sets none under `--check`, and `formatFiles` counts the file as one with an
  // error all the same.
  test.each([
    [["--check"], 2],
    [["--list-different"], 2],
    [["--write"], 2],
    [["--check", "--ignore-unknown"], 0],
    [["--list-different", "--ignore-unknown"], 0],
    [["--write", "--ignore-unknown"], 0],
  ])("a file that there is no parser for: %j", async (flags, exitCode) => {
    const files = { "FOO": "x   y\n", "a.xyz": "x   y\n" };
    for (const named of ["FOO", "*.xyz"]) {
      const result = await format(files, [...flags, named], { reads: Object.keys(files) });
      expect(result.stderr.includes("error: No parser could be inferred for file")).toBe(exitCode === 2);
      expect(result.files).toEqual(files);
      expect(result.exitCode).toBe(exitCode);
    }
  });

  test.each([
    [[], 2, true],
    [["--write"], 2, true],
    [["--check"], 0, true],
    [["--list-different"], 0, true],
    [["--check", "--ignore-unknown"], 0, true],
    [["--list-different", "--ignore-unknown"], 0, true],
    [["--ignore-unknown"], 0, false],
    [["--write", "--ignore-unknown"], 0, false],
  ])("standard input that there is no parser for: %j", async (flags, exitCode, isSaid) => {
    const result = await format({}, [...flags, "--stdin-filepath", "FOO"], { stdin: "x   y\n" });
    expect(result.raw).toBe("");
    expect(result.stderr.includes("error: No parser could be inferred for file")).toBe(isSaid);
    expect(result.exitCode).toBe(exitCode);
  });

  // The exit codes of Prettier 3.9.9, whose `listDifferent` leaves the exit code as it is, and of oxfmt 0.72.0.
  test.each<[Record<string, string>, string[], number]>([
    [{}, [], 2],
    [{}, ["--write"], 2],
    [{}, ["--check"], 0],
    [{}, ["--list-different"], 0],
    [{}, ["--check", "--write"], 0],
    [{}, ["-l", "--write"], 0],
    [{ ".prettierrc": "{}" }, ["--check"], 0],
    [{ ".oxfmtrc.json": "{}" }, [], 2],
  ])("standard input that does not parse: %j %j", async (configuration, flags, exitCode) => {
    const result = await format(configuration, [...flags, "--stdin-filepath", "a.ts"], { stdin: "let a: = 1;\n" });
    expect(result.raw).toBe("");
    // The words of the parser of each tool.
    const why = ".oxfmtrc.json" in configuration ? "Unexpected token" : "Type expected.";
    expect(result.stderr).toBe(problem("a.ts", why, [1, 8, "let a: = 1;"]));
    expect(result.exitCode).toBe(exitCode);
  });

  test.each<[string, string, string, number, number]>([
    ["a.css", "a {\n", "Unclosed block", 1, 1],
    ["a.json", '{ "a": \n', "Unexpected end of file", 2, 1],
    ["a.yaml", "a: [\n", "Unexpected token", 2, 1],
    ["a.html", "<div></p>\n", closingTag("p"), 1, 6],
    ["a.vue", "<template><div></template>\n", closingTag("template"), 1, 16],
    ["a.graphql", "query {\n", "Unexpected end of file", 2, 1],
    ["a.hbs", "{{#if a}}\n", "Unclosed block", 1, 1],
  ])("standard input that does not parse, with --check: %s", async (name, stdin, message, line, column) => {
    const result = await format({}, ["--check", "--stdin-filepath", name], { stdin });
    expect(result.raw).toBe("");
    expect(result.stderr).toBe(problem(name, message, [line, column, stdin.split("\n")[line - 1]]));
    expect(result.exitCode).toBe(0);
  });

  test.each(["--check", "--list-different"])("a file that does not parse, with %s", async flag => {
    const result = await format({ "a.ts": "let a: = 1;\n" }, [flag, "a.ts"]);
    expect(result.stderr).toStartWith(problem("a.ts", "Type expected.", [1, 8, "let a: = 1;"]));
    expect(result.exitCode).toBe(2);
  });

  test("JSX in a block of MDX in Markdown is formatted, though what is printed of it is no program", async () => {
    // A number stays in its quotes there: the parser is not `babel`.
    const result = await format({ "a.md": '```mdx\n<hi/>\n<hello\n/>\n\n<a b={{ "200": 1,  c: 2 }} />\n```\n' }, [], {
      reads: ["a.md"],
    });
    expect(result.files["a.md"]).toBe('```mdx\n<hi />\n<hello />\n\n<a b={{ "200": 1, c: 2 }} />\n```\n');
    expect(result.exitCode).toBe(0);
  });

  test("white space that is not ASCII at the end of a comment goes, and the file is written", async () => {
    const result = await format(
      { "a.js": "// a\u00a0\na;\n// b\u3000\nb;\n// c\u000b\nc;\n/**\n * d\u00a0\n */\nd;\n" },
      [],
      { reads: ["a.js"] },
    );
    expect(result.stderr).not.toContain("error");
    expect(result.files["a.js"]).toBe("// a\na;\n// b\nb;\n// c\nc;\n/**\n * d\n */\nd;\n");
    expect(result.exitCode).toBe(0);
  });

  test("400,000 quoted scalars on a line of YAML do not take quadratic time", async () => {
    const result = await format(
      {
        // A debug build is 30 times slower or more, and the machine can be busy.
        "a.yaml": Buffer.alloc(isDebug || isASAN ? 100_000 : 800_000, '""').toString(),
        "b.yaml": `[${Buffer.alloc(5_000, '"a", ').toString()}"a"]\n`,
      },
      [],
      { reads: ["b.yaml"] },
    );
    expect(result.stderr).toMatch(syntaxErrorIn("a.yaml"));
    expect(result.files["b.yaml"]).toBe(`[\n${Buffer.alloc(7_007, '  "a",\n').toString()}]\n`);
    expect(result.exitCode).toBe(2);
  });

  test("40,000 nodes on a line of YAML that is not ASCII do not take quadratic time", async () => {
    const count = isDebug || isASAN ? 10_000 : 40_000;
    const result = await format(
      { "a.yaml": `[${"é, ".repeat(count)}a]\n`, "b.yaml": `{${"é: 😀, ".repeat(count)}a: b}\n` },
      [],
      { reads: ["a.yaml", "b.yaml"] },
    );
    expect(result.stderr).not.toContain("error");
    expect(result.files["a.yaml"]).toBe(`[\n${"  é,\n".repeat(count)}  a,\n]\n`);
    expect(result.files["b.yaml"]).toBe(`{\n${"  é: 😀,\n".repeat(count)}  a: b,\n}\n`);
    expect(result.exitCode).toBe(0);
  });

  // Each unit, repeated, is a file: what has once taken more than linear time, and what is like it. Many are refused, which has
  // to be fast too. All of them together are compared with as many files with as many bytes of ordinary text, so that it holds
  // on a busy machine and in a debug build.
  test.each<[string, string, string[]]>([
    [
      "css",
      '.button:hover > .icon {\n  color: #336699;\n  margin: 0 auto 1px 2em;\n  background: url("a.png") no-repeat center;\n}\n\n',
      [
        ...'a{b:c}\n¦a{¦}¦a,¦a ¦a>¦.a¦#a¦:a¦::a¦[a]¦[a=b]¦(¦)¦[¦]¦{¦;¦:¦,¦/* a */¦/*¦*/¦"a"¦"¦\'¦\\¦@a;¦@a ¦@media a{'.split(
          "¦",
        ),
        ...'@media (a:b) and ¦@import "a";\n¦a:b;¦--a:b;¦--a:{¦a{b:c d e f}\n¦\n¦ ¦\t¦!important¦url(a)¦url(¦1px '.split(
          "¦",
        ),
        ...'+¦-¦*¦/¦%¦#fff ¦é¦😀¦@¦&¦~¦|¦$a:b;¦a{b:c(¦a{b:c,¦a{b:c ¦a{b:(¦a{b:"c" ¦a{b:/* c */¦a{b:c/¦a{b:1+¦a{b:url(c) '.split(
          "¦",
        ),
        ...'a{b:var(--c,¦a{b:calc(1px + ¦a{grid-template-areas:"a"\n¦a:not(¦a:is(b,¦@supports (a:b) or ¦@font-face{a:b}\n'.split(
          "¦",
        ),
        ...'@charset "a";¦<!--¦-->¦a{b:c!important;}\n¦/* prettier-ignore */\na{b:c}\n¦---\n'.split("¦"),
      ],
    ],
    [
      "scss",
      ".button {\n  $size: 12px;\n  &:hover {\n    color: darken($color, 10%);\n    @include shadow(1px, 2px);\n  }\n}\n\n",
      [
        ..."// a\n¦$a:b;\n¦$a:(b:c,¦$a:(¦#{$a}¦#{¦@include a;\n¦@include a(¦@mixin a{¦@if a{}\n¦@else{}\n¦@if a{}@else ".split(
          "¦",
        ),
        ..."@each $a in b{}\n¦@function a(){¦@return a;¦%a{b:c}\n¦&-a{¦&¦a{b:{c:d}}\n¦a{b:$c+¦a{b:$c*¦a{b:$c - ".split(
          "¦",
        ),
        ...'@use "a";\n¦@forward "a";\n¦$a:b !default;\n¦$a:(b:(c:(¦a{b:c, // d\n¦a{// b\n¦$m:(// a\nb:c,¦@debug a;'.split(
          "¦",
        ),
        ...'@error "a"+¦a{@extend b;}\n¦...¦@media #{$a} and '.split("¦"),
      ],
    ],
    [
      "less",
      ".button {\n  @size: 12px;\n  &:hover {\n    color: darken(@color, 10%);\n    .shadow(1px, 2px);\n  }\n}\n\n",
      [
        ...'// a\n¦@a:b;\n¦@a:{¦.a();\n¦.a(¦.a() when (b){¦@{a}¦@{¦.a{.b;}\n¦.a{.b();}\n¦~"a"¦~`a`¦e("a")¦@import (a) "b";\n'.split(
          "¦",
        ),
        ...'.a:extend(.b);\n¦&:extend(¦each(@a,{¦each(@a,{})\n¦@plugin "a";\n¦.a{@b:c;}\n¦@a:@@b;\n¦.a when (default()){'.split(
          "¦",
        ),
        ..."@media @a{¦.m(@a;@b){¦@r:{a:b};\n¦@r();\n¦.a{b:@c+¦.a{b:(@c*¦!important¦.a !important;\n¦// '\n¦// \"\n".split(
          "¦",
        ),
      ],
    ],
    [
      "yaml",
      'name: value\nlist:\n  - one\n  - two: "three"\nmap: { a: 1, b: [2, 3] }\n# a comment\n',
      [
        ..."a: b\n¦- a\n¦a:\n¦- ¦- - ¦? a\n¦: a\n¦? ¦a: ¦[¦]¦{¦}¦[a,¦{a: b,¦\"a\" ¦\"¦'¦'a' ¦# a\n¦#¦&a ¦*a ¦!a ".split(
          "¦",
        ),
        ..."!!a ¦|\n¦>\n¦|\n a\n¦>\n a\n¦a: |\n  b\n¦---\n¦...\n¦--- a\n¦%YAML 1.2\n¦%TAG ! a\n¦\n¦ ¦\t¦a ¦a\n¦ a\n".split(
          "¦",
        ),
        ...'é ¦😀 ¦a: &b c\n¦a: *b\n¦a: !c d\n¦- a: b\n¦- a: b\n  c: d\n¦a: [b, c]\n¦a: {b: c}\n¦"a": "b"\n¦a: "b\n  c"\n'.split(
          "¦",
        ),
        ..."a: b # c\n¦# prettier-ignore\na:   b\n¦a:\n  # b\n¦- # a\n¦<<: *a\n¦,¦:¦-¦?¦a: b\n\n¦a: >-\n  b\n\n  c\n".split(
          "¦",
        ),
        ...'- |+\n  a\n\n¦[é, ¦{é: é, ¦"é", '.split("¦"),
      ],
    ],
    [
      "graphql",
      "type User {\n  id: ID!\n  name(first: Int = 1): [String!]\n}\n\nquery {\n  user(id: 1) {\n    name\n  }\n}\n\n",
      [
        ...'{a}\n¦{¦}¦a ¦query{a}\n¦type A{b:C}\n¦type A{¦b:C ¦# a\n¦"a" ¦"""a""" ¦"¦"""¦(¦)¦[¦]¦$a '.split("¦"),
        ..."@a ¦...¦...a ¦...on A{b} ¦a:b ¦a(b:1) ¦{a{¦!¦|¦&¦=¦:¦,¦\n¦ ¦1 ¦1.5 ¦enum A{B}\n¦union A=B|C\n¦union A=B".split(
          "¦",
        ),
        ..."|B¦input A{b:C=1}\n¦scalar A\n¦directive @a on B\n¦schema{query:A}\n¦extend type A{b:C}\n¦fragment A on B{c}\n".split(
          "¦",
        ),
        ..."interface A{b:C}\n¦type A implements B&C{d:E}\n¦&B¦{a(b:[¦{a(b:{c:¦é¦\\".split("¦"),
      ],
    ],
    [
      "hbs",
      '<div class="a {{b}}">\n  {{#if c}}\n    <span>{{d.e}}</span>\n  {{/if}}\n</div>\n',
      [
        ..."a ¦<a>¦</a>¦<a></a>¦<a/>¦<a ¦<¦>¦{{a}}¦{{¦}}¦{{{a}}}¦{{#a}}¦{{/a}}¦{{#a}}{{/a}}¦{{#if a}}b{{/if}}\n".split(
          "¦",
        ),
        ..."{{else}}¦{{#if a}}{{else if b}}¦{{!a}}¦{{!--a--}}¦{{!--¦<!--a-->¦<!--¦{{a b}}¦{{a b=c}}¦{{a (b)}}¦{{a (".split(
          "¦",
        ),
        ...'{{a "b"}}¦{{a.b}}¦{{a.¦<a b="c">¦<a b={{c}}>¦<a b="{{c}}">¦<a {{b}}>¦<a b="¦&amp;¦&¦\n¦ ¦\t¦"'.split("¦"),
        ..."'¦\\{{a}}¦\\¦<a as |b|>¦{{#a as |b|}}¦<pre>a</pre>¦<br>¦<input>¦é¦😀¦{{~a~}}¦<a\n¦<a b\n¦{{yield}}¦<:a>".split(
          "¦",
        ),
        ..."<A::B/>¦{{@a}}¦{{this.a}}¦<script>a</script>¦<style>a{}</style>¦---\n".split("¦"),
      ],
    ],
  ])(
    "takes time in proportion to the size of the text: .%s",
    async (extension, ordinary, units) => {
      const count = isDebug || isASAN ? 2_000 : 40_000;
      const repeated = (unit: string, times: number) =>
        Buffer.alloc(Buffer.byteLength(unit) * Math.floor(times), unit).toString();
      const texts = units.map(unit => repeated(unit, count));
      const length = Math.ceil(texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0) / texts.length);
      for (const configuration of [{}, { ".oxfmtrc.json": "{}\n" }]) {
        const run = (text: (index: number) => string) =>
          format(
            {
              ...configuration,
              ...Object.fromEntries(texts.map((_, index) => [`${index}.${extension}`, text(index)])),
            },
            ["--check", "--log-level", "silent"],
          );
        const shapes = await run(index => texts[index]);
        const plain = await run(() => repeated(ordinary, length / ordinary.length));
        expect(slowdown(shapes, plain)).toBeLessThan(4);
      }
    },
    120_000,
  );

  // What some part of reading or printing HTML once walked again for each repetition, and what is like it. All of it is weighed
  // against as many bytes of ordinary HTML, by the time of the processor: that holds on a busy machine and in a debug build.
  test("HTML, Vue and Angular take time in proportion to their size", async () => {
    const count = isDebug || isASAN ? 2_000 : 40_000;
    // The ending of the name, what is before, what is repeated, what is behind.
    const shapes: [string, string, string, string][] = [
      ["html", "", "<p>a</p>\n", ""],
      ["html", "", "<b>a</b> ", ""],
      ["html", "", "<b>a</b>", ""],
      ["html", "", "a ", ""],
      ["html", "", "<br>", ""],
      ["html", "", "<!-- a -->", ""],
      ["html", "", "<!-- a -->\n", ""],
      ["html", "", "<!-- prettier-ignore -->\n<p>a</p>\n", ""],
      ["html", "", "&amp;", ""],
      ["html", "", "&", ""],
      ["html", "", "<", ""],
      ["html", "", "< ", ""],
      ["html", "", "</ ", ""],
      ["html", "", "{{a}}", ""],
      ["html", "", "{{", ""],
      ["html", "", "\n", ""],
      ["html", "", "<li>a", ""],
      ["html", "", "<td>a", ""],
      ["html", "<table>", "<tr><td>a</td></tr>", "</table>"],
      ["html", "<select>", "<option>a", "</select>"],
      ["html", "<div", " a", "></div>"],
      ["html", "<div", ' a="b"', "></div>"],
      ["html", '<div class="', "a ", '"></div>'],
      ["html", '<div style="', "a: b; ", '"></div>'],
      ["html", '<img srcset="', "a 1x, ", 'a 2x">'],
      ["html", '<div a="', "&quot;", '"></div>'],
      ["html", '<div a="', "\n", '"></div>'],
      ["html", "<!-- prettier-ignore-attribute", " a", " -->\n<div a b></div>"],
      ["html", "<pre>", "a\n", "</pre>"],
      ["html", "<pre>", "<b>a</b>\n", "</pre>"],
      ["html", "<textarea>", "a\n", "</textarea>"],
      ["html", "<script>", "a;\n", "</script>"],
      ["html", "<script>a = `", "</ ", "`;</script>"],
      ["html", "<style>", "a { b: c }\n", "</style>"],
      ["html", '<script type="text/template">', "<p>a</p>\n", "</script>"],
      ["html", "<!--[if IE]>", "<p>a</p>", "<![endif]-->"],
      ["html", "", "<!--[if IE]><p>a</p><![endif]-->", ""],
      ["html", "---\n", "a: b\n", "---\n<p></p>"],
      ["html", "<svg>", "<g/>", "</svg>"],
      ["html", "", "é ", ""],
      ["html", "", "😀", ""],
      ["vue", "<template>", "<p>a</p>", "</template>"],
      ["vue", "<template><pre>", "{{a}}", "</pre></template>"],
      ["vue", "<template><p>", "{{ a }} ", "</p></template>"],
      ["vue", "<template><a", ' :b="c"', "></a></template>"],
      ["vue", "<template><a", ' @b="c"', "></a></template>"],
      ["vue", '<template><a v-for="a', " ", 'b"></a></template>'],
      ["vue", '<template><a v-for="(', "a, ", 'a) in b"></a></template>'],
      ["vue", '<template><a :b="[', "c, ", ']"></a></template>'],
      ["vue", '<template><a #b="{ ', "c, ", 'c }"></a></template>'],
      ["vue", '<script lang="ts">\na = "', "</ ", '";\n</script>'],
      ["vue", '<script setup generic="', "A, ", 'A"></script>'],
      ["vue", "", "<i18n>a</i18n>\n", ""],
      ["vue", "<docs>\n", "# a\n\n", "</docs>"],
      ["vue", '<template lang="pug">\n', "p a\n", "</template>"],
      ["component.html", "", "@if (a) {<p>b</p>}", ""],
      ["component.html", "", "@let a = 1;", ""],
      ["component.html", "", "@", ""],
      ["component.html", "", "}", ""],
      ["component.html", "@switch (a) {", "@case (1) {b}", "}"],
      ["component.html", "", "{{ a | b }}", ""],
      ["component.html", "{{ a", " + a", " }}"],
      ["component.html", "{{ a", " | b", " }}"],
      ["component.html", "{{ a", ".b", " }}"],
      ["component.html", "{{ [", "a, ", "] }}"],
      ["component.html", "<a", ' [b]="c"', "></a>"],
      ["component.html", "<a", ' (b)="c()"', "></a>"],
      ["component.html", '<a (b)="a()', "; a()", '"></a>'],
      ["component.html", '<a *b="a', "; b c", '"></a>'],
      ["component.html", '<a b="', "{{a}}", '"></a>'],
      ["component.html", "", "{a, plural, =0 {b}}", ""],
      ["component.html", "{a, plural, ", "=0 {b} ", "}"],
    ];
    const texts = shapes.map(([, before, unit, after]) => before + unit.repeat(count) + after);
    const ordinary =
      '<div class="a b">\n  <p>The quick brown fox <b>jumps</b> over the <a href="c">lazy dog</a>.</p>\n  <img src="d" alt="e" />\n</div>\n';
    const length = Math.ceil(texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0) / texts.length);
    const run = (text: (index: number) => string) =>
      format(Object.fromEntries(shapes.map(([ending], index) => [`${index}.${ending}`, text(index)])), ["--check"]);
    const [odd, plain] = [await run(index => texts[index]), await run(() => ordinary.repeat(length / ordinary.length))];
    // 3 when all is well.
    expect(slowdown(odd, plain)).toBeLessThan(6);
  }, 120_000);

  // The same for what is repeated in something. Prettier takes the square of the number of parameters.
  test("the parameters of @include, @mixin and @function take time in proportion to their number", async () => {
    const count = isDebug || isASAN ? 2_000 : 40_000;
    const shapes: [string, string, string][] = [
      ["@include a(", "$b,", "$b);"],
      ["@include a(", "$b, ", "$b...);"],
      ["@mixin a(", "$b,", "$b){}"],
      ["@mixin a(", "$b:1,", "$b:1){}"],
      ["@function a(", "$b,", "$b){@return 1}"],
    ];
    const texts = shapes.map(([before, unit, after]) => before + unit.repeat(count) + after);
    const ordinary =
      ".button {\n  $size: 12px;\n  &:hover {\n    color: darken($color, 10%);\n    @include shadow(1px, 2px);\n  }\n}\n\n";
    const length = Math.ceil(texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0) / texts.length);
    const run = (text: (index: number) => string) =>
      format(Object.fromEntries(shapes.map((_, index) => [`${index}.scss`, text(index)])), ["--check"]);
    const [odd, plain] = [await run(index => texts[index]), await run(() => ordinary.repeat(length / ordinary.length))];
    // 3 when all is well, 1,189 without the fix.
    expect(slowdown(odd, plain)).toBeLessThan(60);
  }, 120_000);

  // What some part of reading or printing Markdown once walked again for each repetition, or took a thousand times too
  // long for, and what is like it. All of it is weighed against as many bytes of prose, by the time of the processor: that
  // holds on a busy machine and in a debug build.
  test.each([
    ["as Prettier prints it", "md", {}],
    ["as oxfmt prints it", "md", { ".oxfmtrc.json": "{}\n" }],
    ["MDX", "mdx", {}],
  ])(
    "Markdown takes time in proportion to its size: %s",
    async (_, extension, configuration) => {
      const count = isDebug || isASAN ? 1_000 : 40_000;
      const units = [
        ..."a b c\n|a b\n\n|- a\n|- a\n\n|1. a\n|- a\n* a\n|1. a\n1) a\n|- a\n\n  ***\n* a\n\n  ***\n|> a\n\n|> a\n|- [ ] a\n".split(
          "|",
        ),
        ..."[a](b) ,[a][b] ,[a] ,![a](b) ,[,],![,[[a]] ,[[,[^a] ,[a]: b\n,[^a]: b\n\n".split(","),
        ..."*a* ,**a** ,*,* a,_a,a_,~~a~~ ,`,`a` ,$a$ ,$,{{ a }} ,{{,{% a %} ,&,&amp; ,\\,\\* ".split(","),
        ..."<,<a> ,<a ,<!-- a --> ,<!-- a -->\n\n,<div>\na\n</div>\n\n,<!-- prettier-ignore -->\n- a\n\n,<<< a\n,<A-b />\n".split(
          ",",
        ),
        ..."# a\n,a\n=\n,---\n\n,```\na\n```\n\n,```js\na\n```\n\n,```\n,    a\n\n,$$\na\n$$\n\n".split(","),
        ...":::\n,:::a\n,:::a\nb\n:::\n\n,:-\n,a\n    - b\n,a\n    <!-- b -->\n,a\n    ```\n,a  \n    # b\n".split(","),
        ..."| a |\n| - |\n| b |\n\n,| - |\n,|\n,http://a.b ,www.a.b ,a@b.c ,a@,a  \n,a\\\n".split(","),
        ..."中文 a\n,a,\ta\n,\n, , ,😀 ".split(","),
      ];
      const each = (line: (index: number) => string) =>
        Array.from({ length: count }, (_, index) => line(index)).join("");
      const texts = [
        ...units.map(unit => unit.repeat(count)),
        each(index => `[a${index}]: b\n`) + each(index => `[a${index}] `),
        `| a | b |\n| - | - |\n${"| c | d |\n".repeat(count)}`,
        each(index => `${"  ".repeat(index % 40)}- a\n`),
        each(index => `${"> ".repeat((index % 40) + 1)}a\n`),
      ];
      const prose = "The quick brown fox jumps over the lazy dog, and *then* it `rests` for a [while](u).\n\n";
      const length = Math.ceil(texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0) / texts.length);
      const run = (text: (index: number) => string) =>
        format(
          { ...configuration, ...Object.fromEntries(texts.map((_, index) => [`${index}.${extension}`, text(index)])) },
          ["--check"],
        );
      const [shapes, plain] = [await run(index => texts[index]), await run(() => prose.repeat(length / prose.length))];
      expect(shapes.stderr).not.toMatch(anError);
      expect(slowdown(shapes, plain)).toBeLessThan(6);
    },
    120_000,
  );

  test("a syntax error in HTML is in the words of Prettier, at the place it gives", async () => {
    const cases: [string, string, string, number, number][] = [
      [
        ".html",
        "<div>\n  <p></div>\n</span>\n",
        'Unexpected closing tag "span". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags',
        3,
        1,
      ],
      [".html", "<div>\n<span", 'Opening tag "span" not terminated.', 2, 1],
      [".html", "<a b='c>", 'Unexpected character "EOF"', 1, 9],
      [".html", "<p>&nope;</p>\n", 'Unknown entity "nope" - use the "&#<decimal>;" or  "&#x<hex>;" syntax', 1, 4],
      [
        ".html",
        "<p>\u00e9&#12 </p>\n",
        'Unable to parse entity "&#12 " - decimal character reference entities must end with ";"',
        1,
        10,
      ],
      [
        ".html",
        "<p>&#x110000000;</p>\n",
        'Unknown entity "&#x110000000;" - use the "&#<decimal>;" or  "&#x<hex>;" syntax',
        1,
        17,
      ],
      [".html", "<br></br>\n", 'Void elements do not have end tags "br"', 1, 5],
      [".html", "<svg><rect", 'Opening tag ":svg:rect" not terminated.', 1, 6],
      [
        ".vue",
        "<template>\n  <div></template>\n",
        'Unexpected closing tag "template". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags',
        2,
        8,
      ],
      [
        ".vue",
        "<script>\n</script>\n<template>\n  <a>&nope;</a>\n</template>\n",
        'Unknown entity "nope" - use the "&#<decimal>;" or  "&#x<hex>;" syntax',
        4,
        6,
      ],
      [".component.html", "@if (a) {\n  <b></b>\n", 'Unclosed block "if"', 1, 1],
      [
        ".component.html",
        "<div>@if (a {</div>\n",
        'Incomplete block "if". If you meant to write the @ character, you should use the "&#64;" HTML entity instead.',
        1,
        6,
      ],
      [
        ".component.html",
        "<b>}</b>\n",
        'Unexpected closing block. The block may have been closed earlier. If you meant to write the `}` character, you should use the "&#125;" HTML entity instead.',
        1,
        4,
      ],
      [
        ".component.html",
        "@if (a) {<b>}</b>\n",
        'Unexpected closing block. The block may have been closed earlier. Did you forget to close the <b> element? If you meant to write the `}` character, you should use the "&#125;" HTML entity instead.',
        1,
        13,
      ],
      [
        ".component.html",
        "@let a;\n",
        'Incomplete @let declaration "a". @let declarations must be written as `@let <name> = <value>;`',
        1,
        1,
      ],
      [
        ".component.html",
        "@let \n",
        "Incomplete @let declaration. @let declarations must be written as `@let <name> = <value>;`",
        1,
        1,
      ],
      [".component.html", "{a, plural, =0 {b}\n", "Invalid ICU message. Missing '}'.", 2, 1],
      [
        ".component.html",
        "{a, plural, =0 b}}\n",
        'Unexpected character "EOF" (Do you have an unescaped "{" in your template? Use "{{ \'{\' }}") to escape it.)',
        2,
        1,
      ],
    ];
    const files = Object.fromEntries(cases.map(([ending, text], index) => [`${index}${ending}`, text]));
    const result = await format(files, ["--check"]);
    const errors = cases.map(([ending, text, message, line, column], index) =>
      problem(`${index}${ending}`, message, [line, column, text.split("\n")[line - 1]]),
    );
    expect(result.stderr.split("\n\n").sort()).toEqual([...errors, `Could not check ${cases.length} files.`].sort());
    expect(result.exitCode).toBe(2);
  });

  test("an e after a dot or a digit is a letter like another, unless it is an exponent of zero", async () => {
    const result = await format(
      {
        "a.html": "<script>e. e</script>\n",
        "b.vue": "<script>\nmodule  .  exports = a1.e + 1e0 + 1.e-00\n</script>\n",
      },
      [],
      { reads: ["a.html", "b.vue"] },
    );
    expect(result.stderr).not.toMatch(anError);
    expect(result.files).toEqual({
      "a.html": "<script>\n  e.e;\n</script>\n",
      "b.vue": "<script>\nmodule.exports = a1.e + 1 + 1;\n</script>\n",
    });
    expect(result.exitCode).toBe(0);
  });

  test("JSON", async () => {
    const result = await format(
      {
        "a.json": '{"a":1,"b":[1,2]}',
        "b.jsonc": '// c\n{"a":1,}\n',
        "package.json": '{"name":"x","files":[]}',
      },
      [],
      { reads: ["a.json", "b.jsonc", "package.json"] },
    );
    expect(result.files).toEqual({
      "a.json": '{ "a": 1, "b": [1, 2] }\n',
      "b.jsonc": '// c\n{ "a": 1 }\n',
      // Like `JSON.stringify`.
      "package.json": '{\n  "name": "x",\n  "files": []\n}\n',
    });
    expect(result.exitCode).toBe(0);
  });

  describe("which files", () => {
    const files = {
      "a.js": ugly,
      "src/b.ts": ugly,
      "src/c.mjs": ugly,
      "src/.hidden/d.js": ugly,
      "src/deep/e.jsx": ugly,
      "node_modules/pkg/f.js": ugly,
      "notes.xyz": "?",
    };

    test("the working directory by default, without node_modules", async () => {
      expect(await different(files, [])).toEqual([
        "a.js",
        "src/.hidden/d.js",
        "src/b.ts",
        "src/c.mjs",
        "src/deep/e.jsx",
      ]);
    });

    test("skips minified code and lock files unless they're named", async () => {
      const generated = [
        "vendor/jquery.min.js",
        "vendor/a.min.mjs",
        "vendor/a.min.cjs",
        "vendor/a.min.css",
        "package-lock.json",
        "npm-shrinkwrap.json",
        "sub/pnpm-lock.yaml",
        "bun.lock",
        "composer.lock",
        "deno.lock",
        "flake.lock",
      ];
      const unformatted = (name: string) =>
        name.endsWith("js")
          ? ugly
          : name.endsWith(".css")
            ? "a{b:c}\n"
            : name.endsWith(".yaml")
              ? "a:   1\n"
              : '{"a":1}\n';
      const all = { ...Object.fromEntries(generated.map(name => [name, unformatted(name)])), "admin.js": ugly };
      expect(await different(all, [])).toEqual(["admin.js"]);
      expect(await different(all, ["**/*"])).toEqual(["admin.js"]);
      expect(await different(all, ["vendor/jquery.min.js", "package-lock.json"])).toEqual([
        "vendor/jquery.min.js",
        "package-lock.json",
      ]);
      // Prettier formats all of these that it has a parser for.
      const withPrettier = await different({ ...all, ".prettierrc": "{}\n" }, []);
      expect(withPrettier).toContain("vendor/jquery.min.js");
      expect(withPrettier).toContain("package-lock.json");
    });

    test("files, directories, patterns, and patterns that exclude", async () => {
      expect(await different(files, ["src/deep", "a.js"])).toEqual(["src/deep/e.jsx", "a.js"]);
      expect(await different(files, ["src/*.{ts,mjs}"])).toEqual(["src/b.ts", "src/c.mjs"]);
      expect(await different(files, ["src", "!**/*.ts", "!src/deep/**"])).toEqual(["src/.hidden/d.js", "src/c.mjs"]);
    });

    test("--with-node-modules", async () => {
      expect(await different(files, ["--with-node-modules", "node_modules"])).toEqual(["node_modules/pkg/f.js"]);
    });

    test(".prettierignore and .gitignore of the working directory", async () => {
      const ignoring = {
        ...files,
        ".prettierignore": "src/deep\n",
        ".gitignore": "*.mjs\n",
        "src/.gitignore": "b.ts\n",
      };
      expect(await different(ignoring, [])).toEqual(["a.js", "src/.hidden/d.js", "src/b.ts"]);
      expect(await different(ignoring, ["src/c.mjs", "a.js"])).toEqual(["a.js"]);
      expect(await different(ignoring, ["--ignore-path", "src/.gitignore"])).toEqual([
        "a.js",
        "src/.hidden/d.js",
        "src/c.mjs",
        "src/deep/e.jsx",
      ]);
    });

    test("links are not followed", async () => {
      const before = (dir: string) => {
        symlinkSync(join("..", "a.js"), join(dir, "src/link.js"), "file");
        symlinkSync("src", join(dir, "linked"), "dir");
      };
      expect(await different(files, ["."], { before })).toEqual([
        "a.js",
        "src/.hidden/d.js",
        "src/b.ts",
        "src/c.mjs",
        "src/deep/e.jsx",
      ]);
    });

    test("an argument that matches nothing fails with 2", async () => {
      const result = await format(files, ["nothing/*.js", "a.js"], { reads: ["a.js"] });
      expect(result.files).toEqual({ "a.js": formatted });
      expect(result.stderr).toContain('error: No files matching the pattern were found: "nothing/*.js".');
      expect(result.exitCode).toBe(2);
    });

    test("a file without a parser fails with 2, unless -u", async () => {
      const [plain, tolerant] = await Promise.all([format(files, ["notes.xyz"]), format(files, ["-u", "notes.xyz"])]);
      expect(plain.stderr).toContain("No parser could be inferred for file");
      expect({ plain: plain.exitCode, tolerant: tolerant.exitCode }).toEqual({ plain: 2, tolerant: 0 });
    });
  });

  // What Prettier 3.9.9 lists.
  test("a pattern that starts above the working directory finds what is in that too", async () => {
    const files = { ".prettierrc": "{}", "x.js": ugly, "here/x.js": ugly, "here/in/x.js": ugly, "there/x.js": ugly };
    const inHere = (pattern: string) => different(files, [pattern], { cwd: "here" });
    expect(await inHere("../**/x.js")).toEqual(["in/x.js", "x.js", "../there/x.js", "../x.js"]);
    expect(await inHere("../here/**/x.js")).toEqual(["in/x.js", "x.js"]);
    expect(await inHere("../*/x.js")).toEqual(["x.js", "../there/x.js"]);
  });

  // A configuration file can be a program. Prettier 3.9.9 runs every one that a pattern leads to. oxfmt 0.72.0 takes no `..`, and
  // looks for what a pattern matches in the working directory only.
  describe("a pattern that leaves a working directory without a configuration file", () => {
    const noSemi = `{ semi: false }`;
    const kinds: Record<string, (says: string) => string> = {
      "prettier.config.js": says => `import fs from "node:fs";\n${says}\nexport default ${noSemi};\n`,
      "prettier.config.cjs": says => `const fs = require("fs");\n${says}\nmodule.exports = ${noSemi};\n`,
      ".prettierrc.mjs": says => `import fs from "node:fs";\n${says}\nexport default ${noSemi};\n`,
      ".prettierrc.ts": says => `import fs from "node:fs";\n${says}\nexport default ${noSemi};\n`,
      "oxfmt.config.ts": says => `import fs from "node:fs";\n${says}\nexport default ${noSemi};\n`,
    };
    /** The directory that has the file called `name`. */
    const of = (name: string) => name.replaceAll(".", "-");
    const all = (where: string) =>
      Object.keys(kinds)
        .map(it => `${where}/${of(it)}`)
        .sort();

    /** The programs that ran, and the files that are not as their configuration has them: `a;` is as the defaults have it. */
    const run = async (args: string[], more: Record<string, string> = {}) => {
      using logs = tempDir("bun-format-ran", {});
      const log = join(String(logs), "ran.log");
      const files: Record<string, string> = { "w/empty/x.js": "a;\n", ...more };
      for (const where of ["beside", "empty/below"]) {
        for (const [name, text] of Object.entries(kinds)) {
          const says = `fs.appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(`${where}/${of(name)}\n`)});`;
          Object.assign(files, {
            [`w/${where}/${of(name)}/x.js`]: "a;\n",
            [`w/${where}/${of(name)}/${name}`]: text(says),
          });
        }
      }
      const { stdout, exitCode } = await format(files, ["-l", ...args], { cwd: "w/empty" });
      const ran = existsSync(log) ? [...new Set(readFileSync(log, "utf8").split("\n").filter(Boolean))].sort() : [];
      return { ran, different: stdout.split("\n").filter(it => it.endsWith("x.js")).length, exitCode };
    };

    test.each(["../**/x.js", "../beside/*/x.js", "../*/*/x.js"])(
      "nothing runs of what %s merely leads to",
      async pattern => {
        const { ran, different } = await run([pattern]);
        expect(ran.filter(it => it.startsWith("beside/"))).toEqual([]);
        // Those below the working directory are not as their own configuration has them.
        expect(different).toBe(pattern === "../**/x.js" ? Object.keys(kinds).length : 0);
      },
    );

    test("in and below the working directory each directory tells", async () => {
      for (const args of [[], ["."], ["**/x.js"]]) {
        expect(await run(args)).toEqual({ ran: all("empty/below"), different: Object.keys(kinds).length, exitCode: 1 });
      }
    });

    test.each(Object.keys(kinds))("what is named tells: %s", async name => {
      const named = { ran: [`beside/${of(name)}`], different: 1, exitCode: 1 };
      expect(await run([`../beside/${of(name)}`])).toEqual(named);
      expect(await run([`../beside/${of(name)}/x.js`])).toEqual(named);
      expect(await run([`../beside/${of(name)}`, "../beside/*/x.js"])).toEqual(named);
    });

    test("what is named is all that is in it", async () => {
      expect(await run(["../beside"])).toEqual({
        ran: all("beside"),
        different: Object.keys(kinds).length,
        exitCode: 1,
      });
    });

    // As Prettier.
    test("with a configuration file in the working directory every directory tells", async () => {
      const { ran } = await run(["../beside/*/x.js"], { "w/empty/.prettierrc": "{}" });
      expect(ran).toEqual(all("beside"));
    });
  });

  describe("configuration", () => {
    const noSemi = formatted.replaceAll(";", "");
    const configs: [string, string][] = [
      [".prettierrc", `{ "semi": false }`],
      [".prettierrc", `semi: false\n`],
      [".prettierrc.json", `{ "semi": false }`],
      [".prettierrc.yaml", `semi: false\n`],
      [".prettierrc.json5", `{ semi: false, }`],
      [".prettierrc.toml", `semi = false\n`],
      [".prettierrc.yml", `\ufeffsemi: false\n`],
      [".prettierrc", `x: &x\n  semi: false\noverrides:\n  - files: "*.ts"\n    options: *x\n`],
      [".prettierrc.toml", `[[overrides]]\nfiles = "*.ts"\n[overrides.options]\nsemi = false\n`],
      ["package.yaml", `name: p\nprettier:\n  semi: false\n`],
      [".prettierrc.js", `module.exports = { semi: false };`],
      [".prettierrc.mjs", `export default { semi: false };`],
      [".prettierrc.ts", `const semi: boolean = false;\nexport default { semi };`],
      ["prettier.config.js", `module.exports = { semi: false };`],
      ["package.json", `{ "name": "p", "prettier": { "semi": false } }`],
      [".oxfmtrc.json", `{ /* comment */ "semi": false }`],
    ];
    test.each(configs)("%s: %s", async (name, text) => {
      const result = await format({ [name]: text, "src/a.ts": ugly }, ["src"], { reads: ["src/a.ts"] });
      expect(result.files).toEqual({ "src/a.ts": noSemi });
      expect(result.exitCode).toBe(0);
    });

    // Both ways to a directory: it is walked into, and it is above a file that is named.
    test.each([
      ["package.json", ["."]],
      ["package.json", ["src/a.ts"]],
      [".prettierrc", ["."]],
      ["prettier.config.js", ["src/a.ts"]],
    ])("a directory called %s is no configuration file: %j", async (name, args) => {
      const files = { ".prettierrc.json": `{ "semi": false }`, [`src/${name}/b.txt`]: "", "src/a.ts": ugly };
      const result = await format(files, args, { reads: ["src/a.ts"] });
      expect(result.stderr).toStartWith("Formatted ");
      expect(result.files).toEqual({ "src/a.ts": noSemi });
      expect(result.exitCode).toBe(0);
    });

    test.each([
      [".prettierrc", `semi: [\n`],
      [".prettierrc", `1\n`],
      [".prettierrc.yaml", `a: b: c\n`],
      [".prettierrc.json5", `{ semi: }`],
      [".prettierrc.toml", `semi = \n`],
    ])("%s that cannot be read: %s", async (name, text) => {
      const result = await format({ [name]: text, "a.ts": ugly }, ["a.ts"], { reads: ["a.ts"] });
      expect(result.files).toEqual({ "a.ts": ugly });
      expect(result.stderr).toContain("Cannot load the configuration file");
      expect(result.exitCode).toBe(2);
    });

    // Where Prettier 3.9.9 says "YAML Error in ..: Map keys must be unique at line .., column ..". A `.prettierrc` is YAML.
    test.each<[string, string, number, number]>([
      [".prettierrc", `{"semi": false, "semi": true}\n`, 1, 17],
      [".prettierrc", `semi: false\nsemi: true\n`, 2, 1],
      [".prettierrc", `"semi": false\nsemi: true\n`, 2, 1],
      [".prettierrc", `semi: false\n"semi": true\n`, 2, 1],
      [".prettierrc", `'semi': false\n'semi': true\n`, 2, 1],
      [".prettierrc", `{ "semi" : false,\n  "semi" : true }\n`, 2, 3],
      [".prettierrc", `a:\n  "b": 1\n  "b": 2\n`, 3, 3],
      [".prettierrc", `{"a": {"b": 1, "b": 2}, "semi": false}\n`, 1, 16],
      [".prettierrc", `overrides:\n  - files: "*.ts"\n    options:\n      semi: false\n      semi: false\n`, 5, 7],
      [".prettierrc", `? semi\n: false\n? semi\n: true\n`, 3, 3],
      [".prettierrc.yaml", `semi: false\nsemi: true\n`, 2, 1],
      [".prettierrc.yml", `semi: false\nsemi: false\n`, 2, 1],
    ])("a key twice in %s: %j", async (name, text, line, column) => {
      const result = await format({ [name]: text, "a.ts": ugly }, ["a.ts"], { reads: ["a.ts"] });
      expect(result.files).toEqual({ "a.ts": ugly });
      expect(result.stderr).toContain("Cannot load the configuration file");
      expect(result.stderr).toContain(`Map keys must be unique at line ${line}, column ${column}:`);
      expect(result.exitCode).toBe(2);
    });

    test("a key twice in YAML is shown as Prettier shows it", async () => {
      const files = { ".prettierrc": `tabWidth: 2\noverrides:\n  - files: a\n    files: b\n`, "a.ts": ugly };
      const result = await format(files, ["a.ts"]);
      const lines = result.stderr.split("\n").map(line => line.replace(/^\[error\] ?/, ""));
      expect(lines.slice(1, 6)).toEqual([
        "Map keys must be unique at line 4, column 5:",
        "",
        "  - files: a",
        "    files: b",
        "    ^",
      ]);
    });

    // Prettier 3.9.9 takes the last.
    test.each([
      [".prettierrc.json", `{"semi": true, "semi": false}\n`],
      [".prettierrc.json5", `{semi: true, semi: false}\n`],
    ])("a key twice in %s", async (name, text) => {
      const result = await format({ [name]: text, "a.ts": ugly }, ["a.ts"], { reads: ["a.ts"] });
      expect(result.files).toEqual({ "a.ts": noSemi });
      expect(result.exitCode).toBe(0);
    });

    test.each([`prettier:\n  semi: false\n  semi: false\n`, `name: a\nname: b\nprettier:\n  semi: false\n`])(
      "a package.yaml with a key twice has no configuration: %j",
      async text => {
        const result = await format({ "package.yaml": text, "a.ts": ugly }, ["a.ts"], { reads: ["a.ts"] });
        expect(result.files).toEqual({ "a.ts": formatted });
        expect(result.exitCode).toBe(0);
      },
    );

    test("a package.yaml that cannot be read has no configuration", async () => {
      const files = { "package.yaml": `name: [\n`, ".prettierrc": `semi: false\n`, "a.ts": ugly };
      const result = await format(files, ["a.ts"], { reads: ["a.ts"] });
      expect(result.files).toEqual({ "a.ts": noSemi });
      expect(result.exitCode).toBe(0);
    });

    test("the nearest configuration file counts, and a package.json without one does not", async () => {
      const result = await format(
        {
          ".prettierrc": `{ "semi": false }`,
          "a.js": ugly,
          "p/package.json": `{ "name": "p" }`,
          "p/b.js": ugly,
          "q/.prettierrc": `{ "singleQuote": true }`,
          "q/c.js": ugly,
        },
        ["a.js", "p/b.js", "q/c.js"],
        { reads: ["a.js", "p/b.js", "q/c.js"] },
      );
      expect(result.files).toEqual({ "a.js": noSemi, "p/b.js": noSemi, "q/c.js": formatted.replaceAll('"', "'") });
    });

    test("overrides", async () => {
      const result = await format(
        {
          ".prettierrc": JSON.stringify({
            overrides: [
              { files: "*.ts", options: { semi: false } },
              { files: "src/**/*.js", excludeFiles: "src/skip/*.js", options: { singleQuote: true } },
            ],
          }),
          "a.ts": ugly,
          "a.js": ugly,
          "src/b.js": ugly,
          "src/skip/c.js": ugly,
        },
        ["a.ts", "a.js", "src"],
        { reads: ["a.ts", "a.js", "src/b.js", "src/skip/c.js"] },
      );
      expect(result.files).toEqual({
        "a.ts": noSemi,
        "a.js": formatted,
        "src/b.js": formatted.replaceAll('"', "'"),
        "src/skip/c.js": formatted,
      });
    });

    test("flags override the file, unless --config-precedence says otherwise", async () => {
      const files = { ".prettierrc": `{ "semi": false }`, "a.js": ugly };
      const [cli, file] = await Promise.all([
        format(files, ["--semi", "a.js"], { reads: ["a.js"] }),
        format(files, ["--semi", "--config-precedence", "file-override", "a.js"], { reads: ["a.js"] }),
      ]);
      expect(cli.files).toEqual({ "a.js": formatted });
      expect(file.files).toEqual({ "a.js": noSemi });
    });

    test("--config and --no-config", async () => {
      const files = { ".prettierrc": `{ "semi": false }`, "other.json": `{ "singleQuote": true }`, "a.js": ugly };
      const [named, none] = await Promise.all([
        format(files, ["--config", "other.json", "a.js"], { reads: ["a.js"] }),
        format(files, ["--no-config", "a.js"], { reads: ["a.js"] }),
      ]);
      expect(named.files).toEqual({ "a.js": formatted.replaceAll('"', "'") });
      expect(none.files).toEqual({ "a.js": formatted });
    });

    test("--find-config-path", async () => {
      const result = await format({ ".prettierrc": "{}", "src/.prettierrc.json": "{}", "src/a.js": "" }, [
        "--find-config-path",
        "src/a.js",
      ]);
      expect(result.raw).toBe("src/.prettierrc.json\n");
      expect(result.exitCode).toBe(0);
    });

    test("an invalid value fails with 2", async () => {
      const result = await format({ ".prettierrc": `{ "trailingComma": "sometimes" }`, "a.js": ugly }, ["a.js"], {
        reads: ["a.js"],
      });
      expect(result.files).toEqual({ "a.js": ugly });
      expect(result.stderr).toContain("Invalid trailingComma value");
      expect(result.exitCode).toBe(2);
    });

    test(".oxfmtrc.json: lines are 100 wide, and ignorePatterns", async () => {
      const result = await format(
        { ".oxfmtrc.json": `{ "ignorePatterns": ["generated/"] }`, "a.js": wide, "generated/b.js": ugly },
        [],
        { reads: ["a.js", "generated/b.js"] },
      );
      expect(result.files).toEqual({ "a.js": wide, "generated/b.js": ugly });
    });

    test("requirePragma and checkIgnorePragma", async () => {
      const files = {
        "none.js": ugly,
        // Not `format.js`: that is what `bun fmt` would run.
        "at-format.js": `/** @format */\n${ugly}`,
        "prettier.js": `#!/usr/bin/env bun\n/**\n * Text.\n * @prettier\n */\n${ugly}`,
        "in-text.js": `/** see @format */\n${ugly}`,
        "noformat.js": `/** @noformat */\n${ugly}`,
      };
      expect(await different({ ...files, ".prettierrc": `{ "requirePragma": true }` }, [])).toEqual([
        "at-format.js",
        "prettier.js",
      ]);
      expect(await different(files, ["--check-ignore-pragma"])).toEqual([
        "at-format.js",
        "in-text.js",
        "none.js",
        "prettier.js",
      ]);
    });

    describe("like oxfmt, with an .oxfmtrc.json", () => {
      const project = {
        ".oxfmtrc.json": "{}\n",
        ".git/HEAD": "ref: refs/heads/main\n",
        ".gitignore": "ignored.js\n",
        "src/.gitignore": "nested.js\n",
        "a.js": ugly,
        "ignored.js": ugly,
        "src/b.ts": ugly,
        "src/nested.js": ugly,
        "src/deep/c.js": ugly,
      };

      test("every .gitignore counts, ! is in the format of .gitignore, a pattern without a slash is for every directory", async () => {
        expect(
          await Promise.all([different(project, []), different(project, ["!deep"]), different(project, ["*.ts"])]),
        ).toEqual([["a.js", "src/b.ts", "src/deep/c.js"], ["a.js", "src/b.ts"], ["src/b.ts"]]);
      });

      // What oxfmt 0.72.0 does.
      describe("a repository in a repository", () => {
        const [o, i, s] = ["dist/o.js", "vendor/lib/dist/i.js", "vendor/lib/src/s.js"];
        const tree = { ".oxfmtrc.json": "{}\n", [o]: ugly, [i]: ugly, [s]: ugly };
        const [outer, inner] = [{ ".git/HEAD": "" }, { "vendor/lib/.git/HEAD": "" }];

        test.each<[Record<string, string>, string[]]>([
          [{ ...inner, ".gitignore": "dist/\n" }, [i, s]],
          [{ "vendor/lib/.git": "gitdir: ../../.git/modules/lib\n", ".gitignore": "dist/\n" }, [i, s]],
          [{ ...inner, ".git/info/exclude": "src/\n" }, [o, i, s]],
          [{ ...inner, "vendor/lib/.git/info/exclude": "src/\n" }, [o, i]],
        ])("the files of Git above its root do not count in it, and its own do: %j", async (files, expected) => {
          expect(await different({ ...tree, ...outer, ...files }, [])).toEqual(expected);
        });

        test.skipIf(isInRepository)("no root counts if a directory is in no repository", async () => {
          const files = { ...tree, ...inner, ".gitignore": "i.js\n" };
          expect(await different(files, ["vendor/lib", "dist"])).toEqual([o, s]);
        });
      });

      test("nested configuration files, --disable-nested-config, .prettierrc is not read", async () => {
        const files = {
          ".oxfmtrc.json": `{ "semi": false }\n`,
          "src/.oxfmtrc.json": `{ "singleQuote": true }\n`,
          "lib/.prettierrc": `{ "tabWidth": 8 }`,
          "src/a.js": ugly,
          "lib/b.js": ugly,
        };
        const reads = ["src/a.js", "lib/b.js"];
        const [nested, disabled] = await Promise.all([
          format(files, [], { reads }),
          format(files, ["--disable-nested-config"], { reads }),
        ]);
        expect(nested.files).toEqual({ "src/a.js": formatted.replaceAll('"', "'"), "lib/b.js": noSemi });
        expect(disabled.files).toEqual({ "src/a.js": noSemi, "lib/b.js": noSemi });
      });

      test("insertFinalNewline, sortPackageJson", async () => {
        const result = await format(
          {
            ".oxfmtrc.json": `{ "insertFinalNewline": false }`,
            "a.js": "a()\n",
            "package.json": `{ "version": "1.0.0", "name": "x" }`,
          },
          [],
          { reads: ["a.js", "package.json"] },
        );
        expect(result.files).toEqual({ "a.js": "a();", "package.json": '{\n  "name": "x",\n  "version": "1.0.0"\n}' });
      });

      test("no file at all fails with 2", async () => {
        const result = await format({ ".oxfmtrc.json": "{}\n" }, ["nothing.js"]);
        expect(result.stderr).toContain("Expected at least one target file.");
        expect(result.exitCode).toBe(2);
      });
    });

    test("prettier-plugin-organize-imports: whether an unused import React stays is up to the nearest tsconfig.json", async () => {
      const jsx = `import React from "react";\nexport const a = <div />;\n`;
      const tsconfig = (compilerOptions: object) => JSON.stringify({ compilerOptions });
      const names = ["classic", "native", "extended", "automatic", "preserve", "none", "factory", "namespace"];
      const { files } = await format(
        {
          ".prettierrc": `{ "plugins": ["prettier-plugin-organize-imports"] }`,
          "base.json": tsconfig({ jsx: "react" }),
          ...Object.fromEntries(names.map(name => [`${name}/a.tsx`, jsx])),
          "classic/tsconfig.json": tsconfig({ jsx: "react" }),
          "classic/b.ts": `import React from "react";\nexport const a = 1;\n`,
          "native/tsconfig.json": tsconfig({ jsx: "react-native" }),
          "extended/tsconfig.json": `{ "extends": "../base.json" }`,
          "automatic/tsconfig.json": tsconfig({ jsx: "react-jsx" }),
          "preserve/tsconfig.json": tsconfig({ jsx: "preserve" }),
          "factory/tsconfig.json": tsconfig({ jsx: "react", jsxFactory: "h", jsxFragmentFactory: "Fragment" }),
          "factory/a.tsx": `import { h, Fragment, other } from "preact";\nimport React from "react";\nexport const a = <></>;\n`,
          "namespace/tsconfig.json": tsconfig({ jsx: "react", reactNamespace: "Preact" }),
          "namespace/a.tsx": `import Preact from "preact";\nimport React from "react";\nexport const a = <div />;\n`,
        },
        [],
        { reads: [...names.map(name => `${name}/a.tsx`), "classic/b.ts"] },
      );
      // What Prettier 3 prints with the plugin and TypeScript 5.
      const without = "export const a = <div />;\n";
      expect(files).toEqual({
        "classic/a.tsx": jsx,
        "native/a.tsx": jsx,
        "extended/a.tsx": jsx,
        "automatic/a.tsx": without,
        "preserve/a.tsx": without,
        "none/a.tsx": without,
        "factory/a.tsx": `import { Fragment, h } from "preact";\nexport const a = <></>;\n`,
        "namespace/a.tsx": `import Preact from "preact";\nexport const a = <div />;\n`,
        "classic/b.ts": "export const a = 1;\n",
      });
    });

    // TypeScript 6.0.3 follows them all. Of two that extend each other it reports that, and has the options of both.
    test("prettier-plugin-organize-imports: a tsconfig.json extends one that extends one, however many there are", async () => {
      const jsx = `import React from "react";\nexport const a = <div />;\n`;
      const { files } = await format(
        {
          ".prettierrc": `{ "plugins": ["prettier-plugin-organize-imports"] }`,
          "chain/a.tsx": jsx,
          "chain/tsconfig.json": `{ "extends": "./1.json" }`,
          ...Object.fromEntries(
            Array.from({ length: 19 }, (_, i) => [`chain/${i + 1}.json`, `{ "extends": "./${i + 2}.json" }`]),
          ),
          "chain/20.json": `{ "compilerOptions": { "jsx": "react" } }`,
          "circle/a.tsx": jsx,
          "circle/tsconfig.json": `{ "extends": "./other.json" }`,
          "circle/other.json": `{ "extends": "./tsconfig.json", "compilerOptions": { "jsx": "react" } }`,
        },
        [],
        { reads: ["chain/a.tsx", "circle/a.tsx"] },
      );
      expect(files).toEqual({ "chain/a.tsx": jsx, "circle/a.tsx": jsx });
    });

    test(".editorconfig", async () => {
      const files = {
        ".editorconfig": "root = true\n[*]\nindent_style = space\nindent_size = 4\n[*.ts]\nindent_style = tab\n",
        "a.js": ugly,
        "a.ts": ugly,
        "b/.prettierrc": `{ "tabWidth": 1 }`,
        "b/c.js": ugly,
      };
      const reads = ["a.js", "a.ts", "b/c.js"];
      const [plain, without] = await Promise.all([
        format(files, [], { reads }),
        format(files, ["--no-editorconfig"], { reads }),
      ]);
      expect(plain.files).toEqual({
        "a.js": formatted.replace("  return", "    return"),
        "a.ts": formatted.replace("  return", "\treturn"),
        "b/c.js": formatted.replace("  return", " return"),
      });
      expect(without.files).toEqual({
        "a.js": formatted,
        "a.ts": formatted,
        "b/c.js": formatted.replace("  return", " return"),
      });
    });

    // What Prettier 3.9.9 does with each. In a worktree `.git` is a file.
    describe.each<[string, Record<string, string>, boolean]>([
      ["nothing", {}, false],
      ["a folder .git", { "repo/.git/HEAD": "" }, true],
      ["a file .git", { "repo/.git": "gitdir: ../elsewhere\n" }, true],
      ["a folder .hg", { "repo/.hg/store": "" }, true],
      ["a file .hg", { "repo/.hg": "" }, false],
      ["a folder .editorconfig", { "repo/.editorconfig/a": "root = true\n" }, false],
    ])("an .editorconfig above a directory with %s", (_, marker, isRoot) => {
      const files = { ".editorconfig": "[*]\nindent_style = tab\n", "repo/src/a.js": ugly, ...marker };
      const expected = isRoot ? formatted : formatted.replace("  return", "\treturn");

      test.each([[["."]], [["src/a.js"]]])("%j", async args => {
        const result = await format(files, args, { cwd: "repo", reads: ["repo/src/a.js"] });
        expect(result.files).toEqual({ "repo/src/a.js": expected });
        expect(result.exitCode).toBe(0);
      });

      test("standard input", async () => {
        const result = await format(files, ["--stdin-filepath", "src/a.js"], { cwd: "repo", stdin: ugly });
        expect(result.raw).toBe(expected);
        expect(result.exitCode).toBe(0);
      });
    });

    describe("how an .editorconfig is read", () => {
      // The one above says whether the one that is read is a root: with it, the quotes are single.
      const project = {
        ".git/HEAD": "",
        ".editorconfig": "[*]\nquote_type = single\n",
        "sub/a.js": 'if (a) {\n  b("c");\n}\n',
      };
      const printed = (indent: string, quote: string) => `if (a) {\n${indent}b(${quote}c${quote});\n}\n`;

      // What Prettier 3.9.9 prints. It has `editorconfig-without-wasm`, which knows no comment behind anything, and gives a
      // file up at the first line that it does not understand.
      test.each([
        ["a comment behind a section: nothing of the file counts", "[*] ; all\nindent_size = 4\n", "  ", "'"],
        ["a comment behind a later section", "[*]\nindent_size = 4\n[*.js] # scripts\nindent_size = 8\n", "  ", "'"],
        ["a comment behind a value is of the value", "[*]\nindent_size = 4 # c\n", "  ", "'"],
        ["a colon", "[*]\nindent_size: 4\n", "  ", "'"],
        ["a line that is nothing", "[*]\nindent_size = 4\ngarbage\n", "  ", "'"],
        ["a section that is not closed", "[*]\nindent_size = 4\n[*.py\n", "  ", "'"],
        ["lines that end with a carriage return", "[*]\rindent_size = 4\r", "    ", "'"],
        ["no-break spaces", "\u00a0[*]\u00a0\n\u00a0indent_size\u00a0=\u00a04\u00a0\n", "    ", "'"],
        ["a byte order mark", "\ufeff[*]\nindent_size = 4\n", "    ", "'"],
        ["root = yes", "root = yes\n[*]\nindent_size = 4\n", "    ", '"'],
        ["root = true # c", "root = true # c\n[*]\nindent_size = 4\n", "    ", '"'],
        ["root = null", "root = null\n[*]\nindent_size = 4\n", "    ", '"'],
        ["root = 0", "root = 0\n[*]\nindent_size = 4\n", "    ", "'"],
        ['root = ""', 'root = ""\n[*]\nindent_size = 4\n', "    ", "'"],
        ["root = true, then false", "root = true\nroot = false\n[*]\nindent_size = 4\n", "    ", "'"],
        ["a word that is not known in upper case", "[*]\nquote_type = Single\n", "  ", '"'],
        ["a word that is known in upper case", "[*]\nindent_style = TAB\n", "\t", "'"],
        ["a word in quotes", '[*]\nindent_style = "tab"\n', "\t", "'"],
        ["a number in quotes", '[*]\nindent_size = "4"\n', "  ", "'"],
        ["04", "[*]\nindent_size = 04\n", "  ", "'"],
        ["4.0", "[*]\nindent_size = 4.0\n", "    ", "'"],
        ["1e1", "[*]\nindent_size = 1e1\n", "          ", "'"],
        ["+4", "[*]\nindent_size = +4\n", "  ", "'"],
        ["4 // c", "[*]\nindent_size = 4 // c\n", "  ", "'"],
        [
          "a section twice goes on where it was",
          "[*]\nindent_size = 2\n[*.js]\nindent_size = 4\n[*]\nindent_size = 8\n",
          "    ",
          "'",
        ],
      ])("by Prettier: %s", async (_, text, indent, quote) => {
        const result = await format({ ...project, "sub/.editorconfig": text }, ["a.js"], {
          cwd: "sub",
          reads: ["sub/a.js"],
        });
        expect(result.files["sub/a.js"]).toBe(printed(indent, quote));
        expect(result.exitCode).toBe(0);
      });

      // What oxfmt 0.72 prints. It has the crate `editorconfig-parser`, reads one file, and goes on behind what it does not
      // understand. `indent_size` counts only if it is known that spaces are used.
      test.each([
        ["indent_size alone says nothing", {}, "[*]\nindent_size = 4\n", "  "],
        ["indent_size with indent_style", {}, "[*]\nindent_style = space\nindent_size = 4\n", "    "],
        ["indent_size with useTabs", { useTabs: false }, "[*]\nindent_size = 4\n", "    "],
        ["indent_size before tab_width", { useTabs: false }, "[*]\nindent_size = 4\ntab_width = 8\n", "    "],
        ["tab_width alone", {}, "[*]\ntab_width = 4\n", "    "],
        [
          "useTabs counts more than indent_style",
          { useTabs: false },
          "[*]\nindent_style = tab\nindent_size = 4\n",
          "    ",
        ],
        [
          "a comment behind a section: what follows is of the one before",
          { useTabs: false },
          "[*]\nindent_size = 4\n[*.py] ; c\nindent_size = 8\n",
          "        ",
        ],
        ["a comment behind a value", { useTabs: false }, "[*]\nindent_size = 4 # c\n", "  "],
        ["a colon", { useTabs: false }, "[*]\nindent_size: 4\n", "  "],
        ["a line that is nothing", { useTabs: false }, "[*]\nindent_size = 4\ngarbage\n", "    "],
        ["a byte order mark", { useTabs: false }, "\ufeff[*]\nindent_size = 4\n", "  "],
        ["no-break spaces", { useTabs: false }, "\u00a0[*]\u00a0\n\u00a0indent_size\u00a0=\u00a04\u00a0\n", "    "],
        ["a key in upper case", { useTabs: false }, "[*]\nINDENT_SIZE = 4\n", "  "],
        ["+4", { useTabs: false }, "[*]\nindent_size = +4\n", "    "],
        ["04", { useTabs: false }, "[*]\nindent_size = 04\n", "    "],
        ["0", { useTabs: false }, "[*]\nindent_size = 0\n", ""],
        ["260 is 4", { useTabs: false }, "[*]\nindent_size = 260\n", "    "],
        [
          "a wrong value takes the place of a right one",
          { useTabs: false },
          "[*]\nindent_size = 4\nindent_size = x\n",
          "  ",
        ],
        [
          "but not that of an earlier section",
          { useTabs: false },
          "[*]\nindent_size = 4\n[*.js]\nindent_size = x\n",
          "    ",
        ],
        ["unset", { useTabs: false }, "[*]\nindent_size = 4\n[*.js]\nindent_size = unset\n", "  "],
        [
          "a width that is not allowed and does not count",
          { printWidth: 80 },
          "[*]\nmax_line_length = 1000\ntab_width = 4\n",
          "    ",
        ],
      ])("by oxfmt: %s", async (_, config, text, indent) => {
        const files = { ...project, "sub/.oxfmtrc.json": JSON.stringify(config), "sub/.editorconfig": text };
        const result = await format(files, ["a.js"], { cwd: "sub", reads: ["sub/a.js"] });
        expect(result.files["sub/a.js"]).toBe(printed(indent, '"'));
        expect(result.exitCode).toBe(0);
      });

      // globset with its default options, on the path from the directory of the file: a name is one file, `*` and `?` cross `/`.
      test.each([
        ["a name", "a.js", "a.js", "    "],
        ["a name, for a file further down", "a.js", "deep/a.js", "  "],
        ["a name in braces, for a file further down", "{a.js,*.ts}", "deep/a.js", "  "],
        ["a star, for a file further down", "*.js", "deep/a.js", "    "],
        ["a star behind a directory, for a file further down", "deep/*.js", "deep/er/a.js", "    "],
        ["a question mark for a slash", "deep?a.js", "deep/a.js", "    "],
        ["a slash in front", "/a.js", "a.js", "  "],
        ["a range of numbers", "{1..3}.js", "2.js", "  "],
        ["braces that are not closed", "{a.js", "a.js", "  "],
      ])("by oxfmt: a section is for %s", async (_, section, at, indent) => {
        const files = {
          "sub/.oxfmtrc.json": '{ "useTabs": false }',
          "sub/.editorconfig": `[${section}]\nindent_size = 4\n`,
          [`sub/${at}`]: project["sub/a.js"],
        };
        const result = await format(files, [at], { cwd: "sub", reads: [`sub/${at}`] });
        expect(result.files[`sub/${at}`]).toBe(printed(indent, '"'));
        expect(result.exitCode).toBe(0);
      });

      test.each([
        ["tabWidth", { tabWidth: 25 }, "", "Invalid tabWidth: The indent width should be between 0 and 24", 1],
        ["tab_width", {}, "[*]\ntab_width = 25\n", "Invalid tabWidth: The indent width should be between 0 and 24", 1],
        [
          "max_line_length",
          {},
          "[*]\nmax_line_length = 321\n",
          "Invalid printWidth: The line width should be between 1 and 320",
          1,
        ],
        [
          "max_line_length = 0",
          {},
          "[*]\nmax_line_length = 0\n",
          "Invalid printWidth: The line width should be between 1 and 320",
          1,
        ],
        // It is found out at the file.
        [
          "tab_width in a later section",
          {},
          "[*]\ntab_width = 4\n[*.js]\ntab_width = 25\n",
          "Invalid tabWidth: The indent width should be between 0 and 24",
          2,
        ],
      ])("oxfmt refuses a width that is not allowed: %s", async (_, config, text, message, exitCode) => {
        const files = { ...project, "sub/.oxfmtrc.json": JSON.stringify(config), "sub/.editorconfig": text };
        const result = await format(files, ["a.js"], { cwd: "sub", reads: ["sub/a.js"] });
        expect(result.stderr).toContain(message);
        expect(result.files["sub/a.js"]).toBe(project["sub/a.js"]);
        expect(result.exitCode).toBe(exitCode);
      });
    });
  });

  describe("--stdin-filepath", () => {
    test("prints the formatted code", async () => {
      const result = await format({}, ["--stdin-filepath", "a.ts"], { stdin: "const a:number=1" });
      expect(result.raw).toBe("const a: number = 1;\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    test("the path decides the configuration, and whether the code is left alone", async () => {
      const files = { "src/.prettierrc": `{ "semi": false }`, ".prettierignore": "ignored.js\n" };
      const [configured, ignored] = await Promise.all([
        format(files, ["--stdin-filepath", "src/new.js"], { stdin: ugly }),
        format(files, ["--stdin-filepath", "ignored.js"], { stdin: ugly }),
      ]);
      expect(configured.raw).toBe(formatted.replaceAll(";", ""));
      expect(ignored.raw).toBe(ugly);
    });

    // Prettier adds the line `node_modules` to every ignore file. oxfmt formats what it is handed.
    test("the code of a package is left alone, as by Prettier, unless --with-node-modules says otherwise", async () => {
      const print = async (files: Record<string, string>, ...args: string[]) => {
        const { raw, stderr, exitCode } = await format(files, args, { stdin: ugly });
        return { raw, stderr, exitCode };
      };
      const [alone, done] = [ugly, formatted].map(raw => ({ raw, stderr: "", exitCode: 0 }));
      const results = await Promise.all([
        print({}, "--stdin-filepath", "node_modules/x/a.js"),
        print({}, "--stdin-filepath", "sub/node_modules/y/a.js"),
        print({}, "--stdin-filepath", "../node_modules/a.js"),
        print({}, "--check", "--stdin-filepath", "node_modules/x/a.js"),
        print({}, "-l", "--stdin-filepath", "node_modules/x/a.js"),
        print({}, "--stdin-filepath", "my_node_modules/a.js"),
        print({}, "--stdin-filepath", ".git/a.js"),
        print({}, "--with-node-modules", "--stdin-filepath", "node_modules/x/a.js"),
        print({ "bunfig.toml": "[fmt]\nwithNodeModules = true\n" }, "--stdin-filepath", "node_modules/x/a.js"),
        print({ ".oxfmtrc.json": "{}" }, "--stdin-filepath", "node_modules/x/a.js"),
        print({}, "--flavor=oxfmt", "--stdin-filepath", "node_modules/x/a.js"),
      ]);
      expect(results).toEqual([alone, alone, alone, alone, alone, done, done, done, done, done, done]);
    });

    test("--check", async () => {
      const result = await format({}, ["--check", "--stdin-filepath", "a.js"], { stdin: ugly });
      expect(result.raw).toBe("(stdin)\n");
      expect(result.exitCode).toBe(1);
    });
  });

  // Expected values come from Prettier 3.9.9, which reads standard input whenever it gets no file arguments.
  describe("--parser without any paths formats standard input", () => {
    const files = {
      "ci.yml": "jobs:\n  test:\n    steps:\n      - run: |\n          bun test\n",
      "src/a.ts": "const a:number=1\n",
      "package.json": `{"name":"a"}\n`,
      ".editorconfig": "[*]\nindent_style = tab\n",
    };
    const reads = Object.keys(files);
    const prettier = { ".prettierrc": "{}\n" };
    const noSemi = { ".prettierrc": `{ "semi": false }\n` };
    const js = `function f(){return "a"}\n`;
    const printed = `function f() {\n  return "a";\n}\n`;
    const withoutSemi = `function f() {\n  return "a"\n}\n`;
    /** Runs `bun fmt --parser babel` with `js` on standard input. */
    const pipe = (project: Record<string, string>, flags: string[] = [], options: Options = {}) =>
      format(project, ["--parser", "babel", ...flags], { stdin: js, ...options });

    test.each([
      ["no config", {}],
      ["a Prettier config", { ".prettierrc": "{}\n" }],
      ["an oxfmt config", { ".oxfmtrc.json": "{}\n" }],
    ])("never writes to files in the working directory: %s", async (_, config) => {
      for (const flags of [[], ["--write"], ["--check"], ["-l"]]) {
        const result = await format({ ...files, ...config }, ["--parser", "markdown", ...flags], {
          reads,
          stdin: "# hi   there\n",
        });
        expect(result.files).toEqual(files);
      }
    });

    test.each([
      ["babel", "const a = {b:1,  c:'two'}\n", 'const a = { b: 1, c: "two" };\n'],
      ["babel", "a = <div  a='1'>x</div>\n", 'a = <div a="1">x</div>;\n'],
      ["babel", "// @flow\ntype A = {|a:1|}\n", "// @flow\ntype A = {| a: 1 |};\n"],
      ["babel-flow", "type A = {|a:1|}\n", "type A = {| a: 1 |};\n"],
      ["flow", "type A = {|a:1|}\n", "type A = {| a: 1 |};\n"],
      ["acorn", "const a = {b:1,  c:'two'}\n", 'const a = { b: 1, c: "two" };\n'],
      ["espree", "const a = {b:1,  c:'two'}\n", 'const a = { b: 1, c: "two" };\n'],
      ["meriyah", "const a = {b:1,  c:'two'}\n", 'const a = { b: 1, c: "two" };\n'],
      ["typescript", "const a:number=1\n", "const a: number = 1;\n"],
      ["babel-ts", "const a:number=1\n", "const a: number = 1;\n"],
      ["css", "a{color:red}\n", "a {\n  color: red;\n}\n"],
      ["scss", "$a:1;a{b{color:$a}}\n", "$a: 1;\na {\n  b {\n    color: $a;\n  }\n}\n"],
      ["less", "@a:1;a{.b();color:@a}\n", "@a: 1;\na {\n  .b();\n  color: @a;\n}\n"],
      ["json", '{"a":1,  "b":[1,2]}\n', '{ "a": 1, "b": [1, 2] }\n'],
      ["json5", '{"a":1,  "b":[1,2]}\n', "{ a: 1, b: [1, 2] }\n"],
      ["jsonc", '{"a":1,  "b":[1,2],}\n', '{ "a": 1, "b": [1, 2] }\n'],
      ["json-stringify", "{'a':1,  b:[1,2]}\n", '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}\n'],
      ["yaml", "a:   1\nb:\n    - 1\n", "a: 1\nb:\n  - 1\n"],
      ["markdown", "# hi   there\n", "# hi there\n"],
      ["markdown", "```js\nconst a = {b:1}\n```\n", "```js\nconst a = { b: 1 };\n```\n"],
      ["mdx", "# hi   there\n\n<A  b='1' />\n", '# hi there\n\n<A b="1" />\n'],
      ["html", "<!doctype HTML>\n<p>a\n", "<!doctype html>\n<p>a</p>\n"],
      [
        "vue",
        "<script setup lang='ts'>const a:number=1</script>\n",
        '<script setup lang="ts">\nconst a: number = 1;\n</script>\n',
      ],
      [
        "angular",
        "<div *ngIf='a  &&  b' (click)='c( )'>{{a|b}}</div>\n",
        '<div *ngIf="a && b" (click)="c()">{{ a | b }}</div>\n',
      ],
      ["lwc", "<div   a={b}>x</div>\n", "<div a={b}>x</div>\n"],
      ["graphql", "query { a  b }\n", "query {\n  a\n  b\n}\n"],
      ["glimmer", "<div   class='a'>{{b}}</div>\n", '<div class="a">{{b}}</div>'],
    ])("%s: %j", async (parser, stdin, expected) => {
      for (const config of [{}, prettier]) {
        const result = await format({ ...files, ...config }, ["--parser", parser], { stdin });
        expect(result).toMatchObject({ raw: expected, stderr: "", exitCode: 0 });
      }
    });

    // With no extension to go by, the TypeScript parsers try with JSX and without.
    test.each([
      ["typescript", "a = <T>x\n", "a = <T>x;\n"],
      ["typescript", "a = <div  a='1'>x</div>\n", 'a = <div a="1">x</div>;\n'],
      ["typescript", "const f = <T>(x:T)=>x\n", "const f = <T,>(x: T) => x;\n"],
      ["typescript", "const a = <T,>(b: T) => <div>{b}</div>\n", "const a = <T,>(b: T) => <div>{b}</div>;\n"],
      ["typescript", "// </div>\nconst a = <T>b;\n", "// </div>\nconst a = <T>b;\n"],
      ["babel-ts", "a = <T>x\n", "a = <T>x;\n"],
      ["babel-ts", "a = <div  a='1'>x</div>\n", 'a = <div a="1">x</div>;\n'],
    ])("%s takes both JSX and type assertions: %j", async (parser, stdin, expected) => {
      const result = await format(prettier, ["--parser", parser], { stdin });
      expect(result).toMatchObject({ raw: expected, stderr: "", exitCode: 0 });
    });

    test.each(["const a = <div>x</div>\nlet b: = 1\n", "const a = <T>x\nlet b: = 1\n"])(
      "typescript reports the error of the syntax the code looks like: %j",
      async stdin => {
        const result = await format(prettier, ["--parser", "typescript"], { stdin });
        expect(result.stderr).toBe(problem("stdin", "Type expected.", [2, 8, "let b: = 1"]));
        expect(result.exitCode).toBe(2);
      },
    );

    test("prints nothing for empty input", async () => {
      // `stdin: "ignore"`, like `< /dev/null`.
      const results = await Promise.all([
        format(files, ["--parser", "babel"], { reads }),
        pipe(files, [], { stdin: "" }),
      ]);
      for (const result of results) expect(result).toMatchObject({ raw: "", stderr: "", exitCode: 0 });
      expect(results[0].files).toEqual(files);
    });

    test("uses the config of the working directory", async () => {
      const nested = { ...noSemi, "sub/.prettierrc": `{ "tabWidth": 8 }\n`, "sub/dir/a.txt": "", "other/a.txt": "" };
      const [here, below, nearer, off, named] = await Promise.all([
        pipe(noSemi),
        pipe(nested, [], { cwd: "other" }),
        pipe(nested, [], { cwd: "sub/dir" }),
        pipe(noSemi, ["--no-config"]),
        pipe({ ...prettier, "x.json": `{ "semi": false }` }, ["--config", "x.json"]),
      ]);
      expect(here.raw).toBe(withoutSemi);
      expect(below.raw).toBe(withoutSemi);
      expect(nearer.raw).toBe(printed.replace("  return", "        return"));
      expect(off.raw).toBe(printed);
      expect(named.raw).toBe(withoutSemi);
    });

    test.each([
      [
        "overrides in .prettierrc",
        { ".prettierrc": `{ "overrides": [{ "files": $, "options": { "singleQuote": true } }] }` },
      ],
      ["overrides in --config", { "x.json": `{ "overrides": [{ "files": $, "options": { "singleQuote": true } }] }` }],
      [
        "overrides in .oxfmtrc.json",
        { ".oxfmtrc.json": `{ "overrides": [{ "files": $, "options": { "singleQuote": true } }] }` },
      ],
      ["[[fmt.overrides]]", { "bunfig.toml": `[[fmt.overrides]]\nfiles = $\noptions = { singleQuote = true }\n` }],
    ])("there's no file name for %s to match", async (_, project) => {
      const [[name, text]] = Object.entries(project);
      const globs = `["*", "**", "**/*", "*.js", "stdin", "(stdin)"]`;
      const flags = name === "x.json" ? ["--config", name] : [];
      const result = await pipe({ [name]: text.replace("$", globs) }, flags);
      expect(result).toMatchObject({ raw: printed, stderr: "", exitCode: 0 });
      // The same override does match a name.
      const control = await format({ [name]: text.replace("$", globs) }, [...flags, "--stdin-filepath", "a.js"], {
        stdin: js,
      });
      expect(control.raw).toBe(printed.replaceAll('"', "'"));
    });

    test.each([
      ["no config", {}],
      ["a Prettier config", prettier],
    ])(".editorconfig doesn't apply: %s", async (_, config) => {
      const project = { ...config, ".editorconfig": "root = true\n[*]\nindent_style = tab\n" };
      expect((await pipe(project)).raw).toBe(printed);
      const control = await format(project, ["--stdin-filepath", "a.js"], { stdin: js });
      expect(control.raw).toBe(printed.replace("  return", "\treturn"));
    });

    test("ignore files don't apply", async () => {
      const everything = "*\n**\nstdin\n";
      const results = await Promise.all([
        pipe({ ...prettier, ".prettierignore": everything }),
        pipe({ ...prettier, ".gitignore": everything }),
        pipe({ ...prettier, ig: everything }, ["--ignore-path", "ig"]),
        pipe(prettier, ["--ignore-path", "missing"]),
        pipe({ ...prettier, "node_modules/x/a.txt": "" }, [], { cwd: "node_modules/x" }),
        pipe({}, ["--ignore-pattern", "*"]),
      ]);
      for (const result of results) expect(result).toMatchObject({ raw: printed, stderr: "", exitCode: 0 });
    });

    test.each([
      [["--check"], js, "(stdin)\n", 1],
      [["--list-different"], js, "(stdin)\n", 1],
      [["--check"], printed, "", 0],
      [["--list-different"], printed, "", 0],
      [["--write"], js, printed, 0],
      [["--check", "--write"], js, "", 0],
      [["--list-different", "--write"], js, "", 0],
      [["--log-level", "silent"], js, printed, 0],
      [["--log-level", "warn", "--check"], js, "", 1],
    ])("%j", async (flags, stdin, raw, exitCode) => {
      for (const config of [{}, prettier]) {
        const result = await pipe({ ...files, ...config }, flags, { stdin, reads });
        expect(result).toMatchObject({ raw, stderr: "", exitCode, files });
      }
    });

    test.each<[Record<string, string>, string[], number]>([
      [prettier, [], 2],
      [prettier, ["--write"], 2],
      [prettier, ["--check"], 0],
      [prettier, ["--list-different"], 0],
      [{}, [], 2],
      [{ ".oxfmtrc.json": "{}" }, [], 2],
    ])("a syntax error: %j %j", async (config, flags, exitCode) => {
      const result = await format(config, ["--parser", "typescript", ...flags], { stdin: "let a: = 1;\n" });
      const why = ".oxfmtrc.json" in config ? "Unexpected token" : "Type expected.";
      expect(result.raw).toBe("");
      expect(result.stderr).toBe(problem("stdin", why, [1, 8, "let a: = 1;"]));
      expect(result.exitCode).toBe(exitCode);
    });

    test.each<[Record<string, string>, string[], number]>([
      [prettier, [], 1],
      [prettier, ["--check"], 0],
      [prettier, ["--list-different"], 0],
      [prettier, ["--ignore-unknown"], 1],
      [{}, [], 2],
      [{}, ["--check"], 2],
    ])("a parser nobody has: %j %j", async (config, flags, exitCode) => {
      const result = await format({ ...files, ...config }, ["--parser", "nonsense", ...flags], { stdin: js, reads });
      expect(result).toMatchObject({
        raw: "",
        stderr: `error: Couldn't resolve parser "nonsense".`,
        exitCode,
        files,
      });
    });

    test("--config-precedence", async () => {
      const none = "error: No parser and no file path given, couldn't infer a parser.";
      const prefer = ["--config-precedence", "prefer-file"];
      const override = ["--config-precedence", "file-override"];
      const json = { ".prettierrc": `{ "parser": "json" }` };
      expect(await pipe(noSemi, ["--semi", ...override])).toMatchObject({ raw: withoutSemi, exitCode: 0 });
      expect(await pipe(noSemi, ["--semi"])).toMatchObject({ raw: printed, exitCode: 0 });
      expect(await pipe(json, override, { stdin: `{"a":1}` })).toMatchObject({ raw: `{ "a": 1 }\n`, exitCode: 0 });
      expect(await pipe(json, prefer, { stdin: `{"a":1}` })).toMatchObject({ raw: `{ "a": 1 }\n`, exitCode: 0 });
      // The config file wins, and it has no parser.
      expect(await pipe(noSemi, prefer)).toMatchObject({ raw: "", stderr: none, exitCode: 2 });
      expect(await pipe(noSemi, [...prefer, "--check"])).toMatchObject({ raw: "", stderr: none, exitCode: 0 });
      expect(await pipe(noSemi, [...prefer, "--ignore-unknown"])).toMatchObject({ raw: "", stderr: "", exitCode: 0 });
    });

    test.each([
      [["--cursor-offset", "13"], js, printed, "14"],
      [["--cursor-offset", "0"], js, printed, "0"],
      [
        ["--range-start", "10", "--range-end", "20"],
        "a  =  1;\nb  =  2;\nc  =  3;\n",
        "a  =  1;\nb = 2;\nc = 3;\n",
        "",
      ],
      [["--range-start", "10", "--cursor-offset", "3"], "a  =  1;\nb  =  2;\n", "a  =  1;\nb = 2;\n", "3"],
      [["--insert-pragma"], "a\n", "/** @format */\n\na;\n", ""],
      [["--require-pragma"], js, js, ""],
      [["--require-pragma"], "/** @format */\n" + js, "/** @format */\n" + printed, ""],
      [["--check-ignore-pragma"], "/** @noformat */\n" + js, "/** @noformat */\n" + js, ""],
      [["--single-quote", "--use-tabs"], js, "function f() {\n\treturn 'a';\n}\n", ""],
      [["--end-of-line", "auto"], "a  =  1;\r\nb;\r\n", "a = 1;\r\nb;\r\n", ""],
    ])("%j", async (flags, stdin, raw, stderr) => {
      expect(await pipe(prettier, flags, { stdin })).toMatchObject({ raw, stderr, exitCode: 0 });
    });

    test("an empty --stdin-filepath is no file name either", async () => {
      expect(await pipe(noSemi, ["--stdin-filepath", ""])).toMatchObject({ raw: withoutSemi, stderr: "", exitCode: 0 });
    });

    test.each([[["--parser", "babel"]], [["--stdin-filepath", "a.js"]]])(
      "warns about an unknown option in the config: %j",
      async args => {
        const result = await format({ ".prettierrc": `{ "nope": 1 }` }, args, { stdin: js });
        expect(result).toMatchObject({
          raw: printed,
          stderr: "warn: Ignored unknown option { nope: 1 }.",
          exitCode: 0,
        });
      },
    );

    test("with an oxfmt config, uses its options", async () => {
      const project = {
        ".oxfmtrc.json": `{ "semi": false }`,
        ".editorconfig": "[*]\nindent_style = tab\n[*.js]\nindent_size = 8\n",
      };
      // oxfmt reads `[*]` as settings for the whole project, not as a pattern.
      expect(await pipe(project)).toMatchObject({
        raw: withoutSemi.replace("  return", "\treturn"),
        stderr: "",
        exitCode: 0,
      });
      expect(await pipe(project, ["--check"])).toMatchObject({ raw: "(stdin)\n", exitCode: 1 });
    });

    test.each(["--staged", "--changed"])("%s has no file list to filter", async flag => {
      const result = await pipe(files, [flag], { reads });
      expect(result).toMatchObject({
        raw: "",
        stderr: `error: ${flag} and --parser without files cannot be used together`,
        exitCode: 2,
        files,
      });
    });

    test("without --parser, piped input still means the working directory", async () => {
      const result = await format({ "a.js": ugly }, [], { stdin: js, reads: ["a.js"] });
      expect(result.files).toEqual({ "a.js": formatted });
      expect(result.stdout).toBe("a.js");
      expect(result.exitCode).toBe(0);
    });

    // Some sandboxes have no pseudo-terminals.
    const hasTerminal = (() => {
      if (isWindows) return false;
      try {
        new Bun.Terminal({}).close();
        return true;
      } catch {
        return false;
      }
    })();

    test.skipIf(!hasTerminal)(
      "in a terminal with nothing piped in, it's an error instead of waiting for input",
      async () => {
        using dir = tempDir("bun-format", files);
        let output = "";
        await using proc = spawn({
          cmd: [...command, "--parser", "babel"],
          env: { ...env, NO_COLOR: "1", TERM: "xterm-256color" },
          cwd: String(dir),
          terminal: {
            cols: 200,
            rows: 40,
            data(_terminal, chunk) {
              output += Buffer.from(chunk).toString();
            },
          },
        });
        expect(await proc.exited).toBe(2);
        expect(output.replaceAll("\r\n", "\n")).toBe(
          "error: --parser without files formats standard input, and nothing is piped in\n  Pipe the code in, or name the files to format.\n",
        );
      },
    );
  });

  describe("--parser with a directory", () => {
    const files = {
      "a.md": "#   a\n",
      "LICENSE": "a   b\n",
      "src/b.md": "#   b\n",
      "src/c.js": "c  ;\n",
      ".env": "A   =   1\n",
    };
    const reads = Object.keys(files);

    test.each([
      [["--parser", "markdown", "."], ".", "markdown", "**/*.md"],
      [["--parser", "markdown", "./"], "./", "markdown", "**/*.md"],
      [["--parser", "flow", "src"], "src", "flow", "src/**/*.js"],
      [["--parser", "babel", "a.md", "src/"], "src/", "babel", "src/**/*.js"],
      [["--parser", "typescript", "--check", "src"], "src", "typescript", "src/**/*.ts"],
      [["--parser", "json5", "-l", "src"], "src", "json5", "src/**/*.json5"],
      [["--parser", "glimmer", "--no-config", "src"], "src", "glimmer", "src/**/*.hbs"],
      [["--parser", "markdown", ""], "", "markdown", "**/*.md"],
    ])("is an error without a config: %j", async (args, directory, parser, glob) => {
      const result = await format(files, args, { reads });
      expect(result.files).toEqual(files);
      expect(result.raw).toBe("");
      expect(result.stderr.split("\n")).toEqual([
        `error: --parser ${parser} would read every file in "${directory}" as ${parser}`,
        `  Name the files, or use a glob: bun fmt --parser ${parser} "${glob}"`,
      ]);
      expect(result.exitCode).toBe(2);
    });

    // oxfmt 0.72.0 has no --parser, so there's nothing to be compatible with.
    test.each<[Record<string, string>, string[]]>([
      [{ ".oxfmtrc.json": "{}\n" }, []],
      [{}, ["--flavor=oxfmt"]],
    ])("is an error when formatting like oxfmt: %j %j", async (config, flags) => {
      const result = await format({ ...files, ...config }, [...flags, "--parser", "markdown", "."], { reads });
      expect(result.files).toEqual(files);
      expect(result.raw).toBe("");
      expect(result.stderr.split("\n")).toEqual([
        `error: --parser markdown would read every file in "." as markdown`,
        `  Name the files, or use a glob: bun fmt --parser markdown "**/*.md"`,
      ]);
      expect(result.exitCode).toBe(2);
    });

    test("files and globs are explicit, so they're formatted", async () => {
      const result = await format(files, ["--parser", "markdown", "LICENSE", "**/*.md"], { reads });
      expect(result.files).toEqual({ ...files, "LICENSE": "a b\n", "a.md": "# a\n", "src/b.md": "# b\n" });
      expect(result.exitCode).toBe(0);
    });

    // Prettier 3.9.9 rewrites the same files.
    test("with a Prettier config, every file in it is read with that parser, like Prettier does", async () => {
      const result = await format({ ...files, ".prettierrc": "{}\n" }, ["--parser", "markdown", "."], { reads });
      expect(result.files).toEqual({
        "a.md": "# a\n",
        "LICENSE": "a b\n",
        "src/b.md": "# b\n",
        "src/c.js": "c ;\n",
        ".env": "A = 1\n",
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("the command line", () => {
    test("formatting options", async () => {
      const result = await format(
        { "a.js": ugly + wide },
        ["--no-semi", "--single-quote", "--tab-width=4", "--print-width", "60", "--trailing-comma", "none"],
        {
          reads: ["a.js"],
        },
      );
      expect(result.files["a.js"]).toMatchInlineSnapshot(`
        "const a = { b: 1, c: 'two' }
        function f(x) {
            return [x, 'y']
        }
        const value = someFunction(
            argumentNumberOne,
            argumentNumberTwo,
            argumentNumberThree,
            four
        )
        "
      `);
    });

    test("an unknown flag fails with 2", async () => {
      const result = await format({ "a.js": ugly }, ["--chekc"], { reads: ["a.js"] });
      expect(result.files).toEqual({ "a.js": ugly });
      expect(result.stderr).toContain("Invalid option '--chekc' - perhaps you meant '--check'?");
      expect(result.exitCode).toBe(2);
    });

    test("--log-level", async () => {
      const result = await format({ "a.js": ugly }, ["--log-level", "silent", "--check"]);
      expect(result.raw).toBe("");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    test("--help", async () => {
      const result = await format({}, ["--help"]);
      expect(result.stdout).toContain("bun fmt");
      expect(result.stdout).toContain("--check");
      expect(result.exitCode).toBe(0);
    });
  });
});

/** The files that are not formatted, according to `-l`, in a directory that is there. */
async function differentIn(cwd: string, args: string[]) {
  await using proc = spawn({ cmd: [...command, "-l", ...args], env, cwd, stdout: "pipe", stderr: "ignore" });
  return (await proc.stdout.text()).split("\n").filter(Boolean);
}

describe.concurrent("what an ignore file has is not written, however it is come to", () => {
  // What Prettier 3.9.9 does.
  test("a directory that is ignored, and named", async () => {
    const files = {
      ".prettierignore": "generated/\n/vendor\n",
      "generated/a.js": ugly,
      "generated/deep/b.js": ugly,
      "vendor/c.js": ugly,
      "src/d.js": ugly,
    };
    expect(
      await Promise.all([
        different(files, ["generated", join("generated", "deep"), "vendor", "src"]),
        // The search for a pattern starts in the directory that all it matches is in.
        different(files, ["generated/*.js", "generated/deep/**", "vendor/**/*.js", "src"]),
        different(files, ["{generated,src}/*.js"]),
      ]),
    ).toEqual([["src/d.js"], ["src/d.js"], ["src/d.js"]]);
    const kept = ["generated/a.js", "generated/deep/b.js", "vendor/c.js"];
    const result = await format(files, ["generated", "generated/*.js", "vendor", "src"], { reads: kept });
    expect(result.stdout).toBe("src/d.js");
    expect(result.stderr).not.toMatch(anError);
    expect(result.files).toEqual(Object.fromEntries(kept.map(name => [name, ugly])));
    expect(result.exitCode).toBe(0);
  });

  test.each([["src"], ["src/*.js"], ["src", "src/*.js"]])(
    "%s, of which every file is ignored, is no error",
    async (...args) => {
      const files = { ".prettierignore": "src/a.js\nsrc/b.js\n", "src/a.js": ugly, "src/b.js": ugly };
      const result = await format(files, ["--check", ...args], { reads: ["src/a.js"] });
      expect(result.stderr).not.toMatch(anError);
      expect(result.files).toEqual({ "src/a.js": ugly });
      expect(result.exitCode).toBe(0);
    },
  );

  test("a pattern that matches nothing is an error beside a directory of which every file is ignored", async () => {
    const files = { ".prettierignore": "src/a.js\n", "src/a.js": ugly };
    const result = await format(files, ["--check", "src", "none/*.js"]);
    expect(result.stderr).toContain(`error: No files matching the pattern were found: "none/*.js".`);
    expect(result.stderr).not.toContain(`"src"`);
    expect(result.exitCode).toBe(2);
  });

  // From the directory of the file they are `..`, which `.*` matches. Nobody asks about them: a file in the project is `src/a.js`.
  test("a pattern says nothing about the directories that the ignore file is in", async () => {
    const files = { ".prettierignore": ".*\n", "src/a.js": ugly, "b.js": ugly, ".hidden.js": ugly };
    expect(await Promise.all([different(files, ["src", "b.js", ".hidden.js"]), different(files, ["."])])).toEqual([
      ["src/a.js", "b.js"],
      ["b.js", "src/a.js"],
    ]);
  });

  const beside = {
    "configs/ignored": "skipped.js\n*.gen.js\n/src/anchored.js\ndir/\n../lib/up.js\n**/src/any.js\nsrc/mid.js\n",
    "configs/hidden": ".*\n",
    "configs/skipped.js": ugly,
    "lib/up.js": ugly,
    "src/a.gen.js": ugly,
    "src/anchored.js": ugly,
    "src/any.js": ugly,
    "src/dir/in.js": ugly,
    "src/kept.js": ugly,
    "src/mid.js": ugly,
    "src/skipped.js": ugly,
    "top.js": ugly,
  };
  const ignored = ["--ignore-path", join("configs", "ignored")];

  // src/utilities/ignore.js: `ignore({ allowRelativePaths: true })` is asked about `path.relative(..)`, `../src/skipped.js`. A
  // pattern without `/` finds the name in it, and `..` is a directory like any other.
  test("a file beside the directory of the file that --ignore-path names", async () => {
    expect(
      await Promise.all([
        different(beside, [...ignored, "."]),
        different(beside, [...ignored, "src/skipped.js", "src/dir/in.js", "src/kept.js"]),
        different(beside, [...ignored, "src/dir"]),
        different(beside, ["--ignore-path", join("configs", "hidden"), "."]),
      ]),
    ).toEqual([
      ["src/anchored.js", "src/kept.js", "src/mid.js", "top.js"],
      ["src/kept.js"],
      [],
      ["configs/skipped.js"],
    ]);
  });

  // What oxfmt 0.72.0 does. apps/oxfmt/src/core/global_ignore.rs: in a search `Gitignore::matched` gets the whole path, in which a
  // pattern without `/` finds the name. For an argument, "a path outside the matcher's root is never ignored".
  test("the same, like oxfmt", async () => {
    const files = { ...beside, ".oxfmtrc.json": "{}\n" };
    expect(
      await Promise.all([
        different(files, [...ignored, "."]),
        different(files, [...ignored, "src/skipped.js", "src/kept.js"]),
        different(files, [...ignored, "src/dir"]),
      ]),
    ).toEqual([
      ["lib/up.js", "src/anchored.js", "src/kept.js", "src/mid.js", "top.js"],
      ["src/kept.js", "src/skipped.js"],
      ["src/dir/in.js"],
    ]);
  });
});

describe.concurrent("how a path is written", () => {
  test("an absolute pattern", async () => {
    using dir = tempDir("bun-format", {
      "src/a.js": ugly,
      "src/deep/b.js": ugly,
      "src/c.ts": ugly,
      "other/d.js": ugly,
    });
    const at = (...names: string[]) => join(String(dir), ...names);
    expect(
      await Promise.all([
        differentIn(String(dir), [at("**", "*.js")]),
        differentIn(String(dir), [at("src", "*.{js,ts}")]),
        differentIn(at("other"), [at("src", "**", "*.js")]),
      ]),
    ).toEqual([
      ["other/d.js", "src/a.js", "src/deep/b.js"],
      ["src/a.js", "src/c.ts"],
      ["../src/a.js", "../src/deep/b.js"],
    ]);
  });

  // The answer is looked up by them, and they have `/` on every system. `path.win32` makes `\\` of what it is asked about.
  test("what the program that asks Tailwind answers has the paths of the question, also on Windows", async () => {
    const root = "C:/p/node_modules/tailwindcss";
    const groups = [
      { root, config: "C:/p/tailwind.config.js", classes: ["a"] },
      { root, stylesheet: "C:/p/app.css", classes: ["b"] },
    ];
    using dir = tempDir("bun-format", {});
    const source = ["evaluate-start.js", "fmt/tailwind.js"]
      .map(it => readFileSync(join(import.meta.dir, "../../../src/lint/driver", it), "utf8"))
      .join("")
      .replaceAll('require("node:path")', 'require("node:path").win32');
    // `run` in src/lint/driver/evaluate.rs.
    const given = {
      path: join(String(dir), "-"),
      marker: "<marker>",
      argument: JSON.stringify({ groups }),
      commandLine: [],
    };
    await using proc = spawn({
      // As there: nothing is fetched.
      cmd: [bunExe(), "--no-install", "-e", `const given = ${JSON.stringify(given)};\n${source}`],
      env,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    });
    const stdout = await proc.stdout.text();
    const { config } = JSON.parse(stdout.slice(stdout.lastIndexOf("<marker>") + "<marker>".length));
    // Nothing is installed there, so each is answered with an error.
    expect(config.groups.map(({ error, ...which }: { error: string }) => [typeof error, which])).toEqual(
      groups.map(({ classes, ...which }) => ["string", which]),
    );
  });

  // Nothing in it is replaced: `normalizeBunSnapshot` makes `/` of every `\\`.
  test("what cannot be used is named as the system writes it", async () => {
    using dir = tempDir("bun-format", { "src/a.js": ugly, "notes.foo": "a\n" });
    const firstLine = async (args: string[], stdin?: string) => {
      await using proc = spawn({
        cmd: [...command, ...args],
        env,
        cwd: String(dir),
        stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
        stdout: "ignore",
        stderr: "pipe",
      });
      return (await proc.stderr.text()).split(/\r?\n/)[0];
    };
    const noParser = `error: No parser could be inferred for file "${join(String(dir), "notes.foo")}".`;
    expect(
      await Promise.all([
        firstLine(["-l", join("src", "*.foo")]),
        firstLine(["-l", join(String(dir), "notes.foo")]),
        firstLine(["--stdin-filepath", join("src", "..", "notes.foo")], "a\n"),
      ]),
    ).toEqual([`error: No files matching the pattern were found: "${join("src", "*.foo")}".`, noParser, noParser]);
  });

  // src/config/prettier-config/config-searcher.js and the package `editorconfig` ask the system for a file of that name.
  test("a configuration file whose name is written in other capitals counts where the system finds it", async () => {
    using dir = tempDir("bun-format", {
      "rc/.Prettierrc": '{ "semi": false }\n',
      "rc/a.js": "a  ;\n",
      "editorconfig/.EditorConfig": "[*]\nindent_style = tab\n",
      "editorconfig/a.js": "if (a) {\n  b;\n}\n",
    });
    const foldsCase = existsSync(join(String(dir), "rc", ".prettierrc"));
    await using proc = spawn({ cmd: command, env, cwd: String(dir), stdout: "ignore", stderr: "ignore" });
    expect(await proc.exited).toBe(0);
    expect(["rc", "editorconfig"].map(name => readFileSync(join(String(dir), name, "a.js"), "utf8"))).toEqual(
      foldsCase ? ["a\n", "if (a) {\n\tb;\n}\n"] : ["a;\n", "if (a) {\n  b;\n}\n"],
    );
  });
});

describe.concurrent("a file that is not UTF-8, or has a NUL", () => {
  /** Formats the directory with `files`. The files afterwards, byte for byte: one character of the string is one byte. */
  async function bytesAfter(files: Record<string, string | Buffer>) {
    using dir = tempDir("bun-format-bytes", files);
    await using proc = spawn({
      cmd: [...command, "--no-config", "--no-editorconfig", "."],
      env,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    return {
      // All that is printed about each error. A blank line follows it.
      errors: stderr
        .replaceAll("\r\n", "\n")
        .split("\n\n")
        .filter(part => /^error: /m.test(part)),
      exitCode,
      files: Object.fromEntries(
        Object.keys(files).map(name => [name, readFileSync(join(String(dir), name)).toString("latin1")]),
      ),
    };
  }
  const utf16le = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  const utf16be = (text: string) => Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()]);
  const texts = {
    "a.html": "<p   a>b</p>\r\n<p>c</p>\r\n",
    "a.vue": "<template>\r\n<p   a>b</p>\r\n</template>\r\n<script>\r\nlet a  =  1\r\n</script>\r\n",
    "a.md": "#  a\r\n\r\n*  b\r\n",
    "a.yaml": "a:    1\r\nb:    2\r\n",
    "a.css": "a{b:c}\r\n",
    "a.scss": "a{b:c}\r\n",
    "a.less": "a{b:c}\r\n",
    "a.json": '{"a":   1}\r\n',
    "a.graphql": "query   { a }\r\n",
    "a.hbs": "<p   a>b</p>\r\n",
    "a.js": "a  =  1\r\n",
    "a.ts": "let a:number  =  1\r\n",
  };

  // What `>` and `Out-File` of Windows PowerShell write.
  test.each([
    ["little", utf16le],
    ["big", utf16be],
  ])("UTF-16, %s endian, is refused in every language and stays as it is", async (_, encode) => {
    const files = Object.fromEntries(Object.entries(texts).map(([name, text]) => [name, encode(text)]));
    const result = await bytesAfter(files);
    expect(result.files).toEqual(
      Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString("latin1")])),
    );
    expect(result.errors.sort()).toEqual(
      Object.keys(files)
        .map(name => problem(name, "This file is UTF-16. bun fmt only reads UTF-8"))
        .sort(),
    );
    expect(result.exitCode).toBe(2);
  });

  test("what follows a NUL in HTML is not dropped", async () => {
    const files = {
      "a.html": "<p   a>b</p>\n<p>c\0d</p>\n<p>e</p>\n",
      "a.vue": "<template>\n<p>b\0c</p>\n</template>\n<script>\nlet a  = 1\n</script>\n",
      // The template is no HTML then, and stays as it is.
      "a.js": "x = html`<p   a>b</p><p>c\0d</p><p>e</p>`;\n",
    };
    const result = await bytesAfter(files);
    expect(result.files).toEqual(files);
    expect(result.errors.sort()).toEqual(
      [
        problem("a.html", "Unexpected NUL character", [2, 5, "<p>c\0d</p>"]),
        problem("a.vue", "Unexpected NUL character", [2, 5, "<p>b\0c</p>"]),
      ].sort(),
    );
    expect(result.exitCode).toBe(2);
  });

  // Prettier 3.9.9 and oxfmt 0.72 fail here too, with these words.
  test.each([
    ["the name of a tag", "<a\0b   >x</a\0b>\n", "a"],
    ["the name of an attribute", '<p   a\0b="c">x</p>\n', "p"],
    ["the value of an attribute without quotes", "<p   title=a\0b>x</p>\n", "p"],
  ])("a NUL in %s", async (_, text, name) => {
    expect(await bytesAfter({ "a.html": text })).toEqual({
      errors: [problem("a.html", `Opening tag "${name}" not terminated.`, [1, 1, text])],
      exitCode: 2,
      files: { "a.html": text },
    });
  });

  test("a NUL where the text of HTML does not end with it stays", async () => {
    const result = await bytesAfter({
      "a.html": '<p   a="\0">b</p>\n<!-- \0 -->\n<script>a\0b</script>\n<p>e</p>\n',
    });
    expect(result).toEqual({
      errors: [],
      exitCode: 0,
      files: { "a.html": '<p a="\0">b</p>\n<!-- \0 -->\n<script>\n  a\0b\n</script>\n<p>e</p>\n' },
    });
  });

  test("bytes that are Windows-1252 stay what they are", async () => {
    const files = {
      "a.js": Buffer.from("// caf\xE9\nconst a  = 'd\xE9j\xE0';\n", "latin1"),
      "a.css": Buffer.from("/* caf\xE9 */\na{content:'\xE9'}\n", "latin1"),
      "a.md": Buffer.from("#  caf\xE9\n", "latin1"),
      "a.yaml": Buffer.from("a:    caf\xE9\n", "latin1"),
      "a.html": Buffer.from("<p   title='\xE9'>caf\xE9</p>\n", "latin1"),
    };
    expect(await bytesAfter(files)).toEqual({
      errors: [],
      exitCode: 0,
      files: {
        "a.js": '// caf\xE9\nconst a = "d\xE9j\xE0";\n',
        "a.css": '/* caf\xE9 */\na {\n  content: "\xE9";\n}\n',
        "a.md": "# caf\xE9\n",
        "a.yaml": "a: caf\xE9\n",
        "a.html": '<p title="\xE9">caf\xE9</p>\n',
      },
    });
  });
});

describe.concurrent("line breaks, byte order marks and encodings", () => {
  type Files = Record<string, string | Buffer>;

  /** Formats the directory with `files`. The files afterwards, byte for byte: one character of the string is one byte. */
  async function bytesAfter(files: Files, args: string[] = []) {
    using dir = tempDir("bun-format-bytes", files);
    await using proc = spawn({
      cmd: [...command, "--no-config", "--no-editorconfig", ...args, "."],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      errors: stderr.split(/\r?\n/).filter(line => line.startsWith("error: ")),
      exitCode,
      files: Object.fromEntries(
        Object.keys(files).map(name => [name, readFileSync(join(String(dir), name)).toString("latin1")]),
      ),
    };
  }
  const mapped = (files: Record<string, string>, change: (text: string) => string) =>
    Object.fromEntries(Object.entries(files).map(([name, text]) => [name, change(text)]));
  const BOM = "\xEF\xBB\xBF";

  // What all the others are compared with.
  const withLineFeeds = bytesAfter(lineEndingInputs);

  test("every input can be formatted, and no \\r comes from nowhere", async () => {
    const result = await withLineFeeds;
    expect(result.errors).toEqual([]);
    expect(Object.keys(result.files).filter(name => result.files[name].includes("\r"))).toEqual([]);
    expect(result.exitCode).toBe(0);
  });

  test.each([
    ["\\r\\n", "\r\n"],
    ["\\r", "\r"],
  ])("lines that end in %s are formatted like lines that end in \\n", async (_, lineBreak) => {
    const expected = await withLineFeeds;
    const result = await bytesAfter(mapped(lineEndingInputs, text => text.replaceAll("\n", lineBreak)));
    expect(result.errors).toEqual([]);
    expect(result.files).toEqual(expected.files);
    expect(result.exitCode).toBe(0);
  });

  test("lines that end in \\r\\n and in \\n in one file", async () => {
    const expected = await withLineFeeds;
    let count = 0;
    const result = await bytesAfter(
      mapped(lineEndingInputs, text => text.replaceAll("\n", () => (count++ % 2 ? "\n" : "\r\n"))),
    );
    expect(result.errors).toEqual([]);
    expect(result.files).toEqual(expected.files);
  });

  test("a byte order mark stays, and changes nothing else", async () => {
    const expected = await withLineFeeds;
    const result = await bytesAfter(mapped(lineEndingInputs, text => "\uFEFF" + text));
    expect(result.errors).toEqual([]);
    expect(result.files).toEqual(mapped(expected.files, text => BOM + text));
  });

  test.each([
    ["crlf", "\n", "\r\n"],
    ["cr", "\n", "\r"],
    ["auto", "\r\n", "\r\n"],
    ["auto", "\r", "\r"],
  ])("--end-of-line %s: every line break that is written is that one, once", async (option, before, after) => {
    const expected = await withLineFeeds;
    const result = await bytesAfter(
      mapped(lineEndingInputs, text => text.replaceAll("\n", before)),
      ["--end-of-line", option],
    );
    expect(result.errors).toEqual([]);
    expect(result.files).toEqual(mapped(expected.files, text => text.replaceAll("\n", after)));
    expect(result.exitCode).toBe(0);
  });

  test("a template over several lines that is a name", async () => {
    const files = {
      "a.js": "const o = { [`a\r\nb`]: 1, c: 2 };\r\nclass A { [`a\r\nb`] = 1 }\r\n",
      "b.ts": "type D = { [`a\r\nb`]: 1 };\r\n",
    };
    const printed = {
      "a.js": "const o = {\n  [`a\nb`]: 1,\n  c: 2,\n};\nclass A {\n  [`a\nb`] = 1;\n}\n",
      "b.ts": "type D = {\n  [`a\nb`]: 1;\n};\n",
    };
    expect(await bytesAfter(files)).toEqual({ errors: [], exitCode: 0, files: printed });
    expect(await bytesAfter(files, ["--end-of-line", "auto"])).toEqual({
      errors: [],
      exitCode: 0,
      files: mapped(printed, text => text.replaceAll("\n", "\r\n")),
    });
  });

  test("a cell over several lines in the table of it.each", async () => {
    const files = { "a.js": "it.each`\n  a | b\n  ${function(){a;b}} | ${`x\ny`}\n`('t', () => {});\n" };
    const printed = 'it.each`\n  a | b\n  ${function () {\n    a;\n    b;\n  }} | ${`x\ny`}\n`("t", () => {});\n';
    expect(await bytesAfter(files)).toEqual({ errors: [], exitCode: 0, files: { "a.js": printed } });
    expect(await bytesAfter(files, ["--end-of-line", "crlf"])).toEqual({
      errors: [],
      exitCode: 0,
      files: { "a.js": printed.replaceAll("\n", "\r\n") },
    });
    // In Markdown the formatter marks line breaks with a `\r` of its own.
    const block = (code: string) => "```js\n" + code + "```\n";
    expect(await bytesAfter({ "a.md": block(files["a.js"]) })).toEqual({
      errors: [],
      exitCode: 0,
      files: { "a.md": block(printed) },
    });
  });

  test("a string of JSON5 that goes on in the next line and gets other quotes", async () => {
    const result = await bytesAfter({ "a.json5": "{a:'x\\\ny','b\\\nc':1}\n" }, ["--end-of-line", "crlf"]);
    expect(result.files).toEqual({ "a.json5": '{\r\n  a: "x\\\r\ny",\r\n  "b\\\r\nc": 1,\r\n}\r\n' });
  });

  describe("--range-start, --range-end and --cursor-offset count UTF-16 code units of the text as it is", () => {
    const onStdin = async (name: string, text: string, args: string[]) => {
      using dir = tempDir("bun-format-stdin", {});
      await using proc = spawn({
        cmd: [...command, "--no-config", "--stdin-filepath", name, ...args],
        env,
        cwd: String(dir),
        stdin: Buffer.from(text),
        stdout: "pipe",
        stderr: "pipe",
      });
      // `text()` would leave out a byte order mark.
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
      return { printed: Buffer.from(stdout).toString("utf8"), cursor: stderr.trim(), exitCode };
    };

    // Nothing in a style sheet or in YAML is formatted on its own: a range that is not all of the text formats nothing.
    test.each([
      ["a.css", "a{b:c}\r\nd{e:f}\r\n", "a {\n  b: c;\n}\nd {\n  e: f;\n}\n"],
      ["a.yaml", "a:   1\r\nb:   2\r\n", "a: 1\nb: 2\n"],
    ])("%s with \\r\\n", async (name, text, whole) => {
      const asItIs = text.replaceAll("\r\n", "\n");
      // Before the last `\r\n`: not all of it.
      expect((await onStdin(name, text, ["--range-end", "14"])).printed).toBe(asItIs);
      // In the last `\r\n`, and behind it: all of it.
      expect((await onStdin(name, text, ["--range-end", "15"])).printed).toBe(whole);
      expect((await onStdin(name, text, ["--range-end", "16"])).printed).toBe(whole);
      // An empty range: not even the line breaks change.
      expect((await onStdin(name, text, ["--range-start", "15"])).printed).toBe(text);
    });

    test.each([
      ["a.css", "a{b:'é'}\n", 'a {\n  b: "é";\n}\n'],
      ["a.yaml", "a:   é\n", "a: é\n"],
    ])("%s with a character of two bytes", async (name, text, whole) => {
      expect((await onStdin(name, text, ["--range-end", String(text.length)])).printed).toBe(whole);
      expect((await onStdin(name, text, ["--range-end", String(text.length - 1)])).printed).toBe(text);
    });

    test.each([
      ["a.css", "\uFEFFa{b:c}\n", "\uFEFFa {\n  b: c;\n}\n"],
      ["a.yaml", "\uFEFFa:   1\n", "\uFEFFa: 1\n"],
    ])("%s with a byte order mark", async (name, text, whole) => {
      expect((await onStdin(name, text, ["--range-end", "8"])).printed).toBe(whole);
      expect((await onStdin(name, text, ["--range-end", "7"])).printed).toBe(text);
    });

    test("--insert-pragma inserts nothing if a part of a style sheet is formatted", async () => {
      const result = await onStdin("a.css", "a{b:c}\r\nd{e:f}\r\n", ["--range-end", "14", "--insert-pragma"]);
      expect(result.printed).toBe("a{b:c}\nd{e:f}\n");
    });

    test("the cursor in HTML of which a part is formatted", async () => {
      const range = ["--range-start", "12", "--range-end", "16"];
      expect(await onStdin("a.html", "<p>a</p>\r\n<p   b>c</p>\r\n", [...range, "--cursor-offset", "10"])).toEqual({
        printed: "<p>a</p>\n<p   b>c</p>\n",
        cursor: "9",
        exitCode: 0,
      });
      expect(
        await onStdin("a.html", "\uFEFF<p>a</p>\r\n<p   b>c</p>\r\n", [...range, "--cursor-offset", "11"]),
      ).toEqual({
        printed: "\uFEFF<p>a</p>\n<p   b>c</p>\n",
        cursor: "10",
        exitCode: 0,
      });
    });

    test("the cursor behind a character of several bytes, with a range", async () => {
      const range = ["--range-start", "3", "--range-end", "5", "--cursor-offset", "1"];
      expect(await onStdin("a.js", "\uFEFFa  =  1;\nb  =  2;\n", range)).toEqual({
        printed: "\uFEFFa = 1;\nb  =  2;\n",
        cursor: "1",
        exitCode: 0,
      });
      expect(await onStdin("a.js", "é  =  1;\nb  =  2;\n", range)).toEqual({
        printed: "é = 1;\nb  =  2;\n",
        cursor: "1",
        exitCode: 0,
      });
    });

    test("a range that ends behind the byte order mark is empty", async () => {
      const text = "\uFEFFa  =  1;\nb  =  2;\n";
      expect((await onStdin("a.js", text, ["--range-end", "1"])).printed).toBe(text);
    });

    test.each(["a.js", "a.json", "a.css"])(
      "there is no cursor in %s if it is a byte order mark and blanks",
      async name => {
        expect(await onStdin(name, "\uFEFF\r\n", ["--cursor-offset", "1"])).toEqual({
          printed: "\uFEFF",
          cursor: "",
          exitCode: 0,
        });
      },
    );
  });

  test("--insert-pragma in a file whose first \\r stands alone", async () => {
    const result = await bytesAfter({ "a.js": "/*\r * x\n */\nfoo;\n" }, ["--insert-pragma"]);
    expect(result.files).toEqual({ "a.js": "/**\n * x\n *\n * @format\n */\n\nfoo;\n" });
  });

  test("insertFinalNewline: false with endOfLine: cr", async () => {
    const config = JSON.stringify({ endOfLine: "cr", insertFinalNewline: false });
    const result = await format(
      { ".oxfmtrc.json": config, "a.js": "a  =  1\nb\n", "a.css": "a{b:c}\n" },
      ["a.js", "a.css"],
      {
        reads: ["a.js", "a.css"],
      },
    );
    expect(result.files).toEqual({ "a.js": "a = 1;\rb;", "a.css": "a {\r  b: c;\r}" });
  });

  test("U+2028 behind the { of an object is no line break to Prettier, and is one to oxfmt", async () => {
    const files = { "a.ts": "const o = {\u2028a: 1 };\ntype A = {\u2028a: 1 };\n" };
    const asPrettier = await format(files, ["--no-config", "a.ts"], { reads: ["a.ts"] });
    expect(asPrettier.files).toEqual({ "a.ts": "const o = { a: 1 };\ntype A = { a: 1 };\n" });
    const asOxfmt = await format({ ...files, ".oxfmtrc.json": "{}\n" }, ["a.ts"], { reads: ["a.ts"] });
    expect(asOxfmt.files).toEqual({ "a.ts": "const o = {\n  a: 1,\n};\ntype A = {\n  a: 1;\n};\n" });
  });

  // ONLY WITH FIX G. oxfmt 0.72 writes `\r\r\n` here. See the finding: whether to follow it is to be decided.
  test("a type over several lines in a JSDoc comment, with endOfLine: crlf", async () => {
    const config = JSON.stringify({ endOfLine: "crlf", jsdoc: true, printWidth: 40 });
    const result = await format(
      {
        ".oxfmtrc.json": config,
        "a.js": "/**\n * @returns {{ aaaaaaaaaaaaaaaa: string; bbbbbbbbbbbbbbbbbb: number }} x\n */\nfunction f() {}\n",
      },
      ["a.js"],
      { reads: ["a.js"] },
    );
    expect(result.files["a.js"]).not.toContain("\r\r");
    expect(result.files["a.js"]?.replaceAll("\r\n", "")).not.toMatch(/[\r\n]/);
  });
});

describe.concurrent("upper and lower case in the name of a file", () => {
  const files = {
    "A.JS": "a  =  1\n",
    "sub/B.TS": "let a:number  =  1\n",
    "C.YML": "a:    1\n",
    "D.GQL": "query   { a }\n",
    "E.Yaml": "a:    1\n",
    "F.TSX": "const a  = <b   />\n",
    "G.MJS": "import   a from 'a'\n",
    "H.CTS": "import a = require('a')\nexport = a\n",
    "I.JS.FLOW": "type A  = {| a: 1 |}\n",
    "citation.CFF": "a:    1\n",
    "jakefile": "a  =  1\n",
    "K.GraphQL": "query   { a }\n",
    // `shouldForceTrailingComma` asks `/\.ts$/` of the name as it is.
    "Q.TS": "const f = <T,>() => {}\n",
    // These were taken for what they are before.
    "L.CSS": "a{b:c}\n",
    "README.MD": "*  a\n",
    "M.JSON": '{"a":\n1}\n',
    "N.HTML": "<a   b></a>\n",
    "O.VUE": "<template><a   b /></template>\n",
    "P.HBS": "<a   b></a>\n",
  };
  // What Prettier 3.9.9 prints: its `getLanguageByFileName` compares the name in lower case.
  const printed = {
    "A.JS": "a = 1;\n",
    "sub/B.TS": "let a: number = 1;\n",
    "C.YML": "a: 1\n",
    "D.GQL": "query {\n  a\n}\n",
    "E.Yaml": "a: 1\n",
    "F.TSX": "const a = <b />;\n",
    "G.MJS": 'import a from "a";\n',
    "H.CTS": 'import a = require("a");\nexport = a;\n',
    "I.JS.FLOW": "type A = {| a: 1 |};\n",
    "citation.CFF": "a: 1\n",
    "jakefile": "a = 1;\n",
    "K.GraphQL": "query {\n  a\n}\n",
    "Q.TS": "const f = <T,>() => {};\n",
    "L.CSS": "a {\n  b: c;\n}\n",
    "README.MD": "- a\n",
    "M.JSON": '{ "a": 1 }\n',
    "N.HTML": "<a b></a>\n",
    "O.VUE": "<template><a b /></template>\n",
    "P.HBS": "<a b></a>",
  };

  test("in a directory", async () => {
    const result = await format(files, ["--no-config", "."], { reads: Object.keys(files) });
    expect(result.files).toEqual(printed);
    expect(result.exitCode).toBe(0);
  });

  test("as arguments", async () => {
    const result = await format(files, ["--no-config", ...Object.keys(files)], { reads: Object.keys(files) });
    expect(result.files).toEqual(printed);
    expect(result.stderr).not.toContain("No parser could be inferred");
    expect(result.exitCode).toBe(0);
  });

  test.each(Object.keys(files))("--stdin-filepath %s", async name => {
    const result = await format({}, ["--no-config", "--stdin-filepath", name], {
      stdin: files[name as keyof typeof files],
    });
    expect(result.raw).toBe(printed[name as keyof typeof printed]);
    expect(result.exitCode).toBe(0);
  });

  // oxfmt tells upper case from lower case: `classify_file_kind`.
  test("not with the configuration of oxfmt", async () => {
    const result = await format({ ".oxfmtrc.json": "{}\n", "A.JS": "a  =  1\n", "b.js": "a  =  1\n" }, ["."], {
      reads: ["A.JS", "b.js"],
    });
    expect(result.files).toEqual({ "A.JS": "a  =  1\n", "b.js": "a = 1;\n" });
  });

  // Real coverage on Windows and macOS, whose file systems find `a.ts` under the name `A.TS`.
  test("a name that is typed in another case than the file has", async () => {
    using dir = tempDir("bun-format-case", { "a.ts": "let a:number  =  1\n" });
    if (!existsSync(join(String(dir), "A.TS"))) return;
    await using proc = spawn({
      cmd: [...command, "--no-config", "A.TS"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).not.toMatch(anError);
    expect(readFileSync(join(String(dir), "a.ts"), "utf8")).toBe("let a: number = 1;\n");
    // The file that takes its place has its name, not the one that was typed.
    expect(readdirSync(String(dir))).toEqual(["a.ts"]);
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("a fmt script in package.json", () => {
  test("wins over the formatter", async () => {
    const result = await format(
      { "package.json": JSON.stringify({ scripts: { fmt: "echo the script" } }), "a.js": ugly },
      [],
      { reads: ["a.js"] },
    );
    expect(result.stdout).toBe("the script");
    expect(result.files).toEqual({ "a.js": ugly });
  });

  // Most projects call theirs `format`.
  test("a format script does not", async () => {
    const scripts = { format: "echo the script", preformat: "echo before", postformat: "echo after" };
    const files = { "package.json": JSON.stringify({ scripts }, null, 2) + "\n", "a.js": ugly };
    const result = await format(files, [], { reads: ["a.js"] });
    expect(result.stdout).toBe("a.js");
    expect(result.files).toEqual({ "a.js": formatted });
    expect(result.exitCode).toBe(0);
  });

  test("in that script, bun fmt is the formatter", async () => {
    const script = `"${bunExe().replaceAll("\\", "/")}" fmt a.js`;
    const result = await format({ "package.json": JSON.stringify({ scripts: { fmt: script } }), "a.js": ugly }, [], {
      reads: ["a.js"],
    });
    expect(result.files).toEqual({ "a.js": formatted });
    expect(result.exitCode).toBe(0);
  });
});

// What `bun fmt` meant before there was a formatter.
describe.concurrent("what else is called fmt in the project", () => {
  test.each([
    ["a file", { "fmt.ts": 'console.log("the file");' }, "the file"],
    ["the index of a directory", { "fmt/index.js": 'console.log("the index");' }, "the index"],
  ])("%s wins over the formatter, and nothing is rewritten", async (_, files, printed) => {
    const result = await format({ ...files, "a.js": ugly }, [], { reads: ["a.js"] });
    expect(result.stdout).toBe(printed);
    expect(result.files).toEqual({ "a.js": ugly });
    expect(result.exitCode).toBe(0);
  });

  test.skipIf(isWindows)("an executable of a package wins over the formatter, and nothing is rewritten", async () => {
    const files = { "node_modules/.bin/fmt": "#!/bin/sh\necho the executable\n", "a.js": ugly };
    const result = await format(files, [], {
      reads: ["a.js"],
      before: dir => chmodSync(join(dir, "node_modules/.bin/fmt"), 0o755),
    });
    expect(result.stdout).toBe("the executable");
    expect(result.files).toEqual({ "a.js": ugly });
    expect(result.exitCode).toBe(0);
  });

  test("a directory with nothing to run in it does not", async () => {
    const result = await format({ "fmt/notes.txt": "x", "a.js": ugly }, [], { reads: ["a.js"] });
    expect(result.files).toEqual({ "a.js": formatted });
    expect(result.exitCode).toBe(0);
  });

  // On macOS a directory that can be searched is executable for `which`.
  test("nor beside package.json", async () => {
    const files = { "package.json": "{}\n", "fmt/notes.txt": "x", "a.js": ugly };
    const result = await format(files, [], { reads: ["a.js"] });
    expect(result.files).toEqual({ "a.js": formatted });
    expect(result.exitCode).toBe(0);
  });
});

// What the formatter takes from the process that it runs in: the terminal, the arguments, the streams, the stack, a way to run a
// configuration file that is a program. Where `bun fmt` is developed something else is in Bun's place for each of these.
describe.concurrent("what bun fmt takes from Bun", () => {
  /** `bun ...args` in a directory with `files`. */
  async function bun(files: Record<string, string>, args: string[], variables: Record<string, string> = {}) {
    using dir = tempDir("bun-format-process", files);
    await using proc = spawn({
      cmd: [bunExe(), ...args],
      env: { ...env, ...variables },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("colors are Bun's to decide: FORCE_COLOR, NO_COLOR, and none in a pipe", async () => {
    const files = { "a.js": ugly };
    const ofPrettier = { ...files, ".prettierrc": "{}\n" };
    const [forced, refused, piped, asOxfmt] = await Promise.all([
      format(ofPrettier, ["--check"], { env: { FORCE_COLOR: "1" } }),
      format(ofPrettier, ["--check"], { env: { NO_COLOR: "1" } }),
      format(ofPrettier, ["--check"]),
      format({ ...files, ".oxfmtrc.json": "{}\n" }, ["--check", "a.js"], { env: { FORCE_COLOR: "1" } }),
    ]);
    expect(forced.stderr.split("\n")[0]).toBe("[\x1b[33mwarn\x1b[0m] a.js");
    expect(refused.stderr.split("\n")[0]).toBe("[warn] a.js");
    expect(piped.stderr.split("\n")[0]).toBe("[warn] a.js");
    expect(asOxfmt.raw.split("\n")[2]).toMatch(/^\x1b\[33ma\.js\x1b\[0m \(\d+ms\)$/);
  });

  test("--cwd behind format, before it, and in BUN_OPTIONS, whose other flags are not the formatter's", async () => {
    const files = { "a.js": ugly, "sub/b.js": ugly };
    const results = await Promise.all([
      bun(files, ["fmt", "--cwd", "sub", "-l"]),
      bun(files, ["fmt", "--cwd=sub", "-l"]),
      bun(files, ["--cwd=sub", "fmt", "-l"]),
      bun(files, ["fmt", "-l"], { BUN_OPTIONS: "--cwd=sub" }),
      bun(files, ["--silent", "fmt", "-l", "sub"]),
      bun(files, ["fmt", "-l", "sub"], { BUN_OPTIONS: "--silent --no-install" }),
    ]);
    expect(results.map(it => [it.stdout.replaceAll("\\", "/"), it.stderr, it.exitCode])).toEqual([
      ...Array(4).fill(["b.js\n", "", 1]),
      ...Array(2).fill(["sub/b.js\n", "", 1]),
    ]);
  });

  // The process that runs the configuration file starts in that directory. With BUN_OPTIONS it would look for `sub` in `sub`.
  test("--cwd in BUN_OPTIONS, with a configuration file that is a program", async () => {
    const files = { "sub/.prettierrc.mjs": "export default { semi: false };\n", "sub/b.js": "b;\n" };
    const result = await bun(files, ["fmt", "-l", "b.js"], { BUN_OPTIONS: "--cwd=sub" });
    expect(result).toEqual({ stdout: "b.js\n", stderr: "", exitCode: 1 });
  });

  // Prettier prints the names and never ends.
  test("a configuration file that leaves a timer behind", async () => {
    const files = {
      "prettier.config.mjs": "setInterval(() => {}, 1000);\nexport default { semi: false };\n",
      "b.js": "b;\n",
    };
    expect(await bun(files, ["fmt", "-l", "b.js"])).toEqual({ stdout: "b.js\n", stderr: "", exitCode: 1 });
  });

  test("what the bunfig.toml of the project has for other commands is not read", async () => {
    const result = await bun({ "bunfig.toml": "[install]\nglobalDir = 1\n", "a.js": ugly }, ["fmt", "-l"]);
    expect(result).toEqual({ stdout: "a.js\n", stderr: "", exitCode: 1 });
  });

  test("--config= before format names another file than bunfig.toml", async () => {
    const files = {
      "bunfig.toml": "[fmt]\nsemi = false\n",
      "other.toml": "[fmt]\nsingleQuote = true\n",
      "a.js": "a('b');\n",
    };
    const results = await Promise.all([
      bun(files, ["fmt", "-l"]),
      bun(files, ["--config=other.toml", "fmt", "-l"]),
      bun(files, ["-c=other.toml", "fmt", "-l"]),
      bun(files, ["--config=none.toml", "fmt", "-l"]),
    ]);
    expect(results.map(it => [it.stdout, it.exitCode])).toEqual([
      ["a.js\n", 1],
      ["", 0],
      ["", 0],
      ["", 2],
    ]);
    expect(results[3].stderr).toContain(`while reading config "`);
  });

  test("what is wrong with [fmt] is shown where it is, as for every other section", async () => {
    const files = { "bunfig.toml": `[fmt]\nsemi = false\nprintWidth = "wide"\n`, "a.js": ugly };
    const result = await bun(files, ["fmt", "-l"]);
    expect(result.stderr).toContain(`3 | printWidth = "wide"\n`);
    expect(result.stderr).toMatch(/error: expected number but received string\n\s+at .*bunfig\.toml:3:14\n/);
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(2);
  });

  const count = isDebug || isASAN ? 20_000 : 300_000;
  const long = `a(${Array.from({ length: count }, (_, i) => `"x${i}"`).join(",")});\n`;

  test("more is printed than a pipe holds", async () => {
    const result = await format({}, ["--stdin-filepath", "a.js"], { stdin: long });
    const expected = `a(\n${Array.from({ length: count }, (_, i) => `  "x${i}",\n`).join("")});\n`;
    expect(result.raw.length).toBe(expected.length);
    expect(Bun.hash(result.raw)).toBe(Bun.hash(expected));
    expect(result.exitCode).toBe(0);
  });

  test("nobody reads what is printed to its end", async () => {
    using dir = tempDir("bun-format-process", {});
    await using proc = spawn({
      cmd: [...command, "--stdin-filepath", "a.js"],
      env,
      cwd: String(dir),
      stdin: Buffer.from(long),
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = proc.stdout.getReader();
    expect((await reader.read()).done).toBe(false);
    await reader.cancel();
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isLinux)("a name that is not UTF-8, found in a directory and as an argument", async () => {
    using dir = tempDir("bun-format-process", { "ok.js": formatted });
    const name = Buffer.concat([Buffer.from(String(dir) + "/n"), Buffer.from([0xff]), Buffer.from(".js")]);
    writeFileSync(name, ugly);
    const run = async (argument: string) => {
      await using proc = spawn({
        cmd: ["sh", "-c", `exec "$0" fmt ${argument}`, bunExe()],
        env,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
      return { stdout: Buffer.from(stdout).toString("latin1"), stderr, exitCode };
    };
    expect(await run("-l .")).toEqual({ stdout: "n\xff.js\n", stderr: "", exitCode: 1 });
    expect(await run(`-l "$(printf 'n\\377.js')"`)).toEqual({ stdout: "n\xff.js\n", stderr: "", exitCode: 1 });
    expect((await run(`"$(printf 'n\\377.js')"`)).exitCode).toBe(0);
    expect(readFileSync(name, "utf8")).toBe(formatted);
  });

  test("a configuration file that is a program in each of many directories, asked for by all threads at once", async () => {
    const directories = Array.from({ length: isDebug || isASAN ? 6 : 24 }, (_, i) => i);
    const files = Object.fromEntries(
      directories.flatMap(i => [
        [`d${i}/.prettierrc.mjs`, `export default { semi: ${i % 2 === 0}, tabWidth: ${(i % 4) + 1} };\n`],
        [`d${i}/a.js`, "if (a) {\nb;\n}\n"],
      ]),
    );
    const reads = directories.map(i => `d${i}/a.js`);
    const result = await format(files, reads, { reads });
    expect(result.files).toEqual(
      Object.fromEntries(
        directories.map(i => [
          `d${i}/a.js`,
          `if (a) {\n${Buffer.alloc((i % 4) + 1, " ").toString()}b${i % 2 === 0 ? ";" : ""}\n}\n`,
        ]),
      ),
    );
    expect(result.exitCode).toBe(0);
  });

  // Standard input is formatted on the main thread, whose stack is not that of a thread of the pool.
  test.each(["[", "a(", "{a:", "<a>"])(
    "standard input that is nested too deeply is refused: 100,000 times `%s`",
    async open => {
      const result = await format({}, ["--stdin-filepath", "deep.jsx"], { stdin: open.repeat(100_000) + "\n" });
      expect(result.raw).toBe("");
      expect(result.stderr).toMatch(/^error: .+\n    at deep\.jsx\b/m);
      expect(result.exitCode).toBe(2);
    },
  );
});

// What differs between Windows, macOS and Linux, for `bun fmt`: how a path is written, which names are the same file, how a line
// ends, what a link is, what can be written. Nothing here is passed through `normalizeBunSnapshot`, which makes `/` of every `\`
// and `\n` of every `\r\n`: what is printed is compared as it is printed.
//
// A test that can only tell something on one system runs on all of them where it can: there it is a test that nothing else breaks.
describe("bun fmt on Windows, macOS and Linux", () => {
  const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, NO_COLOR: "1", FORCE_COLOR: undefined };

  // A drive letter that a test has taken would stay, for every process of the session, if the test ran out of time.
  const drives = new Set<string>();
  const subst = (...args: string[]) => Bun.spawnSync({ cmd: ["subst", ...args] }).exitCode === 0;
  afterAll(() => {
    endChildren();
    for (const drive of drives) subst(drive, "/D");
  });

  /** `subst` gives `directory` a drive letter, for as long as `use` runs. */
  async function withDrive(directory: string, use: (drive: string) => Promise<void>) {
    const drive = [..."GHIJKLMNOP"]
      .map(letter => `${letter}:`)
      .find(drive => !existsSync(`${drive}\\`) && subst(drive, directory));
    if (drive === undefined) throw new Error("No drive letter is free.");
    drives.add(drive);
    try {
      await use(drive);
    } finally {
      subst(drive, "/D");
      drives.delete(drive);
    }
  }
  const slow = isDebug || isASAN;
  const isRoot = process.getuid?.() === 0;

  type Directory = string | { toString(): string };

  /** Runs `bun fmt <args>` in `cwd`. What it prints is returned as it is. */
  async function format(cwd: Directory, args: string[], stdin?: string, before: string[] = []) {
    const proc = spawn({
      cmd: [...before, bunExe(), "fmt", ...args],
      env,
      cwd: String(cwd),
      stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  /** The files that are not formatted, according to `-l`, as they are printed. */
  const different = async (cwd: Directory, args: string[]) =>
    (await format(cwd, ["-l", ...args])).stdout.split("\n").filter(Boolean);
  const read = (dir: Directory, ...names: string[]) => readFileSync(join(String(dir), ...names), "utf8");
  /** All names in `dir`, directories too, from `dir`, with `/`. */
  const everythingIn = (dir: Directory) =>
    (readdirSync(String(dir), { recursive: true }) as string[]).map(it => it.replaceAll(sep, "/")).sort();
  const swapCase = (text: string) =>
    text.replace(/[a-z]/gi, letter => (letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase()));

  /** Sets and reads an extended attribute of a file, where a file in the temporary directory takes one. */
  const attributes = (() => {
    if (!isLinux && !isMacOS) return undefined;
    const c = (text: string) => Buffer.from(`${text}\0`);
    // macOS has a position in the attribute before the flags.
    const ofMacOS = () => {
      const { symbols } = dlopen("libSystem.B.dylib", {
        setxattr: { args: ["ptr", "ptr", "ptr", "u64", "u32", "i32"], returns: "i32" },
        getxattr: { args: ["ptr", "ptr", "ptr", "u64", "u32", "i32"], returns: "i64" },
      });
      return {
        set: (path: string, name: string, value: Buffer) =>
          symbols.setxattr(c(path), c(name), value, value.length, 0, 0),
        get: (path: string, name: string, into: Buffer) => symbols.getxattr(c(path), c(name), into, into.length, 0, 0),
      };
    };
    const ofLinux = () => {
      const machine = process.arch === "arm64" ? "aarch64" : "x86_64";
      const { symbols } = dlopen(isMusl ? `libc.musl-${machine}.so.1` : "libc.so.6", {
        setxattr: { args: ["ptr", "ptr", "ptr", "u64", "i32"], returns: "i32" },
        getxattr: { args: ["ptr", "ptr", "ptr", "u64"], returns: "i64" },
      });
      return {
        set: (path: string, name: string, value: Buffer) => symbols.setxattr(c(path), c(name), value, value.length, 0),
        get: (path: string, name: string, into: Buffer) => symbols.getxattr(c(path), c(name), into, into.length),
      };
    };
    const { set, get } = isMacOS ? ofMacOS() : ofLinux();
    const all = {
      set: (path: string, name: string, value: string) => set(path, name, Buffer.from(value)) === 0,
      get(path: string, name: string) {
        const into = Buffer.alloc(256);
        const length = Number(get(path, name, into));
        return length < 0 ? null : into.toString("utf8", 0, length);
      },
    };
    using dir = tempDir("bun-attributes", { "a": "" });
    return all.set(join(String(dir), "a"), "user.tag", "a") ? all : undefined;
  })();

  const ugly = "a  ;\n";
  const formatted = "a;\n";
  const BOM = "\uFEFF";
  const crlf = (text: string) => text.replaceAll("\n", "\r\n");

  describe.concurrent("how a path is written", () => {
    // src/cli/format.js: `const fileNameToDisplay = normalizeToPosix(path.relative(cwd, filename))`
    test("a name is printed from the working directory, with `/`, and a line ends with \\n", async () => {
      const files = { "a.js": ugly, "src/deep/b.ts": ugly, "src/c.js": formatted, "src/broken.js": "const = 1;\n" };
      using listed = tempDir("bun-format-platform", files);
      using checked = tempDir("bun-format-platform", files);
      using written = tempDir("bun-format-platform", files);
      const results = await Promise.all([format(listed, ["-l"]), format(checked, ["--check"]), format(written, [])]);
      expect(results.map(it => it.stdout)).toEqual([
        "a.js\nsrc/deep/b.ts\n",
        "a.js\nsrc/deep/b.ts\n",
        "a.js\nsrc/deep/b.ts\n",
      ]);
      for (const { stderr } of results) {
        expect(stderr).toStartWith(
          problem("src/broken.js", "Variable declaration expected.", [1, 7, "const = 1;"]) + "\n\n",
        );
        expect(stderr).not.toContain("\r");
      }
    });

    // src/cli/expand-patterns.js: `fixWindowsSlashes`
    test("arguments can be written as the system writes paths", async () => {
      using dir = tempDir("bun-format-platform", {
        "a.js": ugly,
        "src/b.js": ugly,
        "lib/c.js": ugly,
        "pkg/one/d.js": ugly,
        "pkg/one/e.mjs": ugly,
        "pkg/skip/f.js": ugly,
        "deep/dir/g.js": ugly,
        "other/h.js": ugly,
      });
      const at = (...names: string[]) => join(String(dir), ...names);
      expect(
        await Promise.all([
          different(dir, [join("src", "b.js"), `.${sep}lib`, join("deep", "dir") + sep]),
          different(dir, [join("pkg", "**", "*.js"), `!${join("pkg", "skip", "**")}`]),
          different(dir, [at("src", "b.js"), at("deep") + sep]),
          different(at("pkg", "one"), [join("..", "..", "lib"), `..${sep}..${sep}a.js`]),
        ]),
      ).toEqual([
        ["src/b.js", "lib/c.js", "deep/dir/g.js"],
        ["pkg/one/d.js"],
        ["src/b.js", "deep/dir/g.js"],
        ["../../lib/c.js", "../../a.js"],
      ]);
    });

    test("so can the paths that flags take", async () => {
      using dir = tempDir("bun-format-platform", {
        "configs/mine.json": `{ "semi": false }\n`,
        // The patterns are from the directory of the file.
        "configs/ignored": "/src/skipped.js\n",
        "configs/src/a.js": formatted,
        "configs/src/skipped.js": ugly,
        "src/.prettierrc": "{}\n",
        "src/skipped.js": ugly,
      });
      const at = (...names: string[]) => join(String(dir), ...names);
      for (const [config, ignored] of [
        [join("configs", "mine.json"), join("configs", "ignored")],
        [at("configs", "mine.json"), at("configs", "ignored")],
        [`.${sep}configs${sep}mine.json`, `.${sep}configs${sep}ignored`],
      ]) {
        expect(await different(dir, ["--config", config, "--ignore-path", ignored, "src", "configs/src"])).toEqual([
          "src/skipped.js",
          "configs/src/a.js",
        ]);
      }
      const found = await Promise.all(
        [join("src", "a.js"), at("src", "a.js")].map(file => format(dir, ["--find-config-path", file])),
      );
      expect(found.map(it => it.stdout)).toEqual(["src/.prettierrc\n", "src/.prettierrc\n"]);
    });

    test("--stdin-filepath", async () => {
      using dir = tempDir("bun-format-platform", {
        "src/deep/.prettierrc": `{ "semi": false }`,
        ".prettierignore": "src/ignored/\n",
      });
      const at = (...names: string[]) => join(String(dir), ...names);
      const names = [
        join("src", "deep", "new.js"),
        at("src", "deep", "new.js"),
        join("src", "ignored", "new.js"),
        at("src", "ignored", "new.js"),
      ];
      const results = await Promise.all(names.map(name => format(dir, ["--stdin-filepath", name], ugly)));
      expect(results.map(it => it.stdout)).toEqual(["a\n", "a\n", ugly, ugly]);
    });

    // What a URL would take for something else: a configuration file that is a program is imported by its URL.
    test(
      "a project in a directory with blanks, `#`, `%41` and letters that are not ASCII",
      async () => {
        using dir = tempDir("bun fmt #1 %41 é 日本", {
          ".prettierrc.mjs": `import shared from "./my configs/shared#1.mjs";\nexport default { ...shared };\n`,
          "my configs/shared#1.mjs": "export default { semi: false };\n",
          "sources é/ü 100%.js": formatted,
          "sources é/中文.js": formatted,
        });
        const { stdout, stderr, exitCode } = await format(dir, ["sources é"]);
        expect(stderr).not.toMatch(anError);
        expect(stdout).toBe("sources é/ü 100%.js\nsources é/中文.js\n");
        expect(read(dir, "sources é", "ü 100%.js")).toBe("a\n");
        expect(exitCode).toBe(0);
      },
      slow ? 120_000 : undefined,
    );

    // 300 characters from the project: more than the 260 of Windows' MAX_PATH, and with what is before it less than the 1024 of macOS.
    test("a path of more than 260 characters", async () => {
      using dir = tempDir("bun-format-platform", { ".prettierrc": `{ "semi": false }\n` });
      const names = Array.from({ length: 12 }, (_, index) => `directory-number-${String(index).padStart(2, "0")}-xxxx`);
      mkdirSync(join(String(dir), ...names), { recursive: true });
      writeFileSync(join(String(dir), ...names, "a.js"), formatted);
      writeFileSync(join(String(dir), ...names, "b.js"), formatted);
      const walked = await format(dir, []);
      expect(walked.stderr).not.toMatch(anError);
      expect(walked.stdout).toBe(`${names.join("/")}/a.js\n${names.join("/")}/b.js\n`);
      expect(read(dir, ...names, "a.js")).toBe("a\n");
      writeFileSync(join(String(dir), ...names, "b.js"), formatted);
      const named = await format(dir, [join(...names, "b.js")]);
      expect(read(dir, ...names, "b.js")).toBe("a\n");
      expect(named.exitCode).toBe(0);
    });

    // `subst` gives the directory a drive letter.
    test.skipIf(!isWindows)("a project at the root of a drive", async () => {
      using dir = tempDir("bun-format-platform", {
        ".prettierrc": `{ "semi": false }\n`,
        ".prettierignore": "sub/ignored.js\n",
        "a.js": formatted,
        "sub/b.js": formatted,
        "sub/ignored.js": formatted,
      });
      await withDrive(realpathSync(String(dir)), async drive => {
        expect(
          await Promise.all([
            different(`${drive}\\`, []),
            different(`${drive}\\`, [`${drive}\\`]),
            different(`${drive}\\`, [`${drive}\\sub`]),
            // The ignore files are those of the working directory, which has none.
            different(`${drive}\\sub`, [`${drive}\\a.js`, "ignored.js"]),
            different(`${drive}\\sub`, ["--ignore-path", `${drive}\\.prettierignore`, `${drive}\\a.js`, "ignored.js"]),
            // From another drive: `path.relative()` has nothing to leave out. The configuration is in the root, above the file.
            different(dir, [`${drive}\\a.js`, `${drive}\\sub\\b.js`]),
          ]),
        ).toEqual([
          ["a.js", "sub/b.js"],
          ["a.js", "sub/b.js"],
          ["sub/b.js"],
          ["../a.js", "ignored.js"],
          ["../a.js"],
          [`${drive}/a.js`, `${drive}/sub/b.js`],
        ]);
      });
    });

    // The administrative share of the drive, as in test/js/node/fs/cp.test.ts. The same for `\\wsl.localhost\..` and the shared
    // folders of a virtual machine.
    test.skipIf(!isWindows)("a project on a network share", async () => {
      using dir = tempDir("bun-format-platform", {
        ".prettierrc": `{ "semi": false }\n`,
        ".prettierignore": "src/ignored.js\n",
        "src/a.js": formatted,
        "src/ignored.js": formatted,
      });
      const real = realpathSync(String(dir));
      const share = `\\\\localhost\\${real[0]}$\\${real.slice(3)}`;
      expect(
        await Promise.all([
          different(share, []),
          different(share, [`${share}\\src`]),
          // From the drive, of which `path.relative()` does not know that it is the same.
          different(dir, [`${share}\\src\\a.js`]),
        ]),
      ).toEqual([["src/a.js"], ["src/a.js"], [`${share}/src/a.js`.replaceAll("\\", "/")]]);
      const written = await format(share, []);
      expect(written.stderr).not.toMatch(anError);
      expect(read(dir, "src", "a.js")).toBe("a\n");
      expect(read(dir, "src", "ignored.js")).toBe(formatted);
      expect(everythingIn(dir)).toEqual([".prettierignore", ".prettierrc", "src", "src/a.js", "src/ignored.js"]);
    });

    // By its address: a file URL does not keep the name `localhost`, in Node.js neither, so Prettier cannot import from there either.
    // For Windows alone, and never run: whether Bun imports `file://127.0.0.1/C$/..` nobody has seen.
    test.todo(
      "a configuration file that is a program, on a network share",
      async () => {
        using dir = tempDir("bun-format-platform", {
          "a.js": formatted,
          "prettier.config.mjs": "export default { semi: false };\n",
        });
        const real = realpathSync(String(dir));
        const { stderr, exitCode } = await format(`\\\\127.0.0.1\\${real[0]}$\\${real.slice(3)}`, ["a.js"]);
        expect(stderr).not.toMatch(anError);
        expect(read(dir, "a.js")).toBe("a\n");
        expect(exitCode).toBe(0);
      },
      slow ? 120_000 : undefined,
    );

    // src/utilities/ignore.js asks `path.relative()`, which on Windows takes `c:\A` and `C:\a` for the same. An editor hands out
    // `c:\..`, a shell `C:\..`. A file that is ignored must not be written.
    test.skipIf(!isWindows)(
      "a path whose drive and directories are written in the other case is in the project",
      async () => {
        using dir = tempDir("bun-format-platform", {
          ".prettierignore": "src/ignored.js\ngenerated/\n",
          "src/a.js": ugly,
          "src/ignored.js": ugly,
          "generated/b.js": ugly,
        });
        const other = swapCase(String(dir));
        // The other way around, and what is not a file yet.
        const [from, piped] = await Promise.all([
          different(other, [join(String(dir), "src", "a.js"), join(String(dir), "src", "ignored.js")]),
          format(dir, ["--stdin-filepath", join(other, "src", "ignored.js")], ugly),
        ]);
        expect([from, piped.stdout]).toEqual([["src/a.js"], ugly]);
        const { stdout } = await format(dir, [
          join(other, "src", "a.js"),
          join(other, "src", "ignored.js"),
          join(other, "generated"),
        ]);
        expect(stdout).toBe("src/a.js\n");
        expect([read(dir, "src", "a.js"), read(dir, "src", "ignored.js"), read(dir, "generated", "b.js")]).toEqual([
          formatted,
          ugly,
          ugly,
        ]);
      },
    );

    // `path.resolve("\\proj\\a.js")` is on the drive of the working directory.
    test.skipIf(!isWindows)("a path from the root of the drive", async () => {
      using dir = tempDir("bun-format-platform", {
        "a.js": ugly,
        "ignored.js": ugly,
        ".prettierignore": "ignored.js\n",
      });
      const rooted = realpathSync(String(dir)).slice(2);
      expect(await different(dir, [join(rooted, "a.js"), join(rooted, "ignored.js")])).toEqual(["a.js"]);
    });
  });

  describe.concurrent("which names are the same file", () => {
    test("a file that is named in the other case is formatted if the system finds it", async () => {
      using dir = tempDir("bun-format-platform", { "src/Button.js": ugly });
      const foldsCase = existsSync(join(String(dir), "SRC", "bUTTON.JS"));
      const { stdout, stderr, exitCode } = await format(dir, [join("src", "Button.js"), join("SRC", "bUTTON.JS")]);
      expect(stdout.split("\n")[0]).toBe("src/Button.js");
      expect(read(dir, "src", "Button.js")).toBe(formatted);
      expect(everythingIn(dir)).toEqual(["src", "src/Button.js"]);
      // With stderr, so that a failure says why.
      expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: foldsCase ? 0 : 2 });
    });

    // macOS finds `é` whether it is written as one character or as `e` and an accent.
    test("a file that is named in the other normalization form is formatted if the system finds it", async () => {
      using dir = tempDir("bun-format-platform", { ["caf\u00e9.js"]: ugly });
      const decomposed = "cafe\u0301.js";
      const isFound = existsSync(join(String(dir), decomposed));
      const { exitCode } = await format(dir, [decomposed]);
      expect(read(dir, "caf\u00e9.js")).toBe(isFound ? formatted : ugly);
      expect(exitCode).toBe(isFound ? 0 : 2);
    });
  });

  describe.concurrent("how a line ends, and what a file starts with", () => {
    const code = "function f() {\n  return `a\nb`;\n}\n";

    // The default is `lf` on every system since Prettier 2.
    test("\\r\\n becomes \\n, unless the options say otherwise", async () => {
      const files = {
        "a.js": crlf(code),
        "b.css": crlf("a {\n  b: c;\n}\n"),
        "c.md": crlf("# a\n\nb\n"),
        "d.json": crlf('{\n  "a": 1\n}\n'),
      };
      const names = Object.keys(files);
      const after = async (more: Record<string, string>, args: string[] = []) => {
        using dir = tempDir("bun-format-platform", { ...files, ...more });
        const { stdout } = await format(dir, [...args, ...names]);
        return {
          changed: stdout.split("\n").filter(Boolean),
          isAsBefore: names.map(name => read(dir, name) === files[name as "a.js"]),
        };
      };
      const all = (value: boolean) => names.map(() => value);
      expect(
        await Promise.all([
          after({}),
          after({}, ["--end-of-line", "auto"]),
          after({ ".prettierrc": `{ "endOfLine": "crlf" }` }),
          after({ ".editorconfig": crlf("root = true\n[*]\nend_of_line = crlf\n") }),
        ]),
      ).toEqual([
        { changed: names, isAsBefore: all(false) },
        { changed: [], isAsBefore: all(true) },
        { changed: [], isAsBefore: all(true) },
        { changed: [], isAsBefore: all(true) },
      ]);
      using dir = tempDir("bun-format-platform", files);
      expect((await format(dir, ["--check", "a.js"])).exitCode).toBe(1);
      await format(dir, ["a.js"]);
      expect(read(dir, "a.js")).toBe(code);
    });

    test("a byte order mark stays where it is", async () => {
      const files = {
        "a.js": [`${BOM}a  ;\n`, `${BOM}a;\n`],
        "b.css": [`${BOM}a{b:c}\n`, `${BOM}a {\n  b: c;\n}\n`],
        "c.json": [`${BOM}{"a":1}\n`, `${BOM}{ "a": 1 }\n`],
        "d.md": [`${BOM}#   a\n`, `${BOM}# a\n`],
        "e.yaml": [`${BOM}a:   1\n`, `${BOM}a: 1\n`],
        "f.html": [`${BOM}<p   >a</p>\n`, `${BOM}<p>a</p>\n`],
        "g.ts": [`${BOM}a  ;\r\n`, `${BOM}a;\n`],
      };
      const inputs = Object.fromEntries(Object.entries(files).map(([name, texts]) => [name, texts[0]]));
      for (const config of [{}, { ".oxfmtrc.json": "{}\n" }] as Record<string, string>[]) {
        using dir = tempDir("bun-format-platform", { ...inputs, ...config });
        const { exitCode } = await format(dir, Object.keys(files));
        expect(Object.fromEntries(Object.keys(files).map(name => [name, read(dir, name)]))).toEqual(
          Object.fromEntries(Object.entries(files).map(([name, texts]) => [name, texts[1]])),
        );
        expect(exitCode).toBe(0);
      }
    });

    test.each([
      [".prettierrc", '{\n  "semi": false\n}\n'],
      [".prettierrc", "semi: false\n"],
      [".prettierrc.json", '{\n  "semi": false\n}\n'],
      [".prettierrc.yaml", "# a comment\nsemi: false\n"],
      [".prettierrc.toml", "# a comment\nsemi = false\n"],
      [".prettierrc.json5", "{\n  // a comment\n  semi: false,\n}\n"],
      ["package.json", '{\n  "prettier": {\n    "semi": false\n  }\n}\n'],
      [".oxfmtrc.json", '{\n  // a comment\n  "semi": false\n}\n'],
      [".editorconfig", "root = true\n\n[*.js]\nindent_style = tab\n"],
    ])("\\r\\n in %s: %j", async (name, text) => {
      const [before, after] =
        name === ".editorconfig" ? ["if (a) {\n  b;\n}\n", "if (a) {\n\tb;\n}\n"] : [formatted, "a\n"];
      using dir = tempDir("bun-format-platform", { [name]: crlf(text), "a.js": before });
      const { stderr } = await format(dir, ["a.js"]);
      expect(stderr).not.toMatch(anError);
      expect(read(dir, "a.js")).toBe(after);
    });
  });

  describe.concurrent("links", () => {
    // A junction needs no privilege on Windows. Elsewhere the third argument says nothing, and it is a link to a directory.
    const link = (target: string, path: string) => symlinkSync(target, path, "junction");

    test.each([
      ["Prettier", {}],
      ["oxfmt", { ".oxfmtrc.json": "{}\n" }],
    ])("a link to a directory is not followed, wherever it leads: like %s", async (_, config) => {
      using dir = tempDir("bun-format-platform", { ...config, "real/a.js": ugly, "pkg/deep/b.js": ugly });
      const at = (...names: string[]) => join(String(dir), ...names);
      link(at("real"), at("linked"));
      link(String(dir), at("pkg", "deep", "up"));
      link(at("nowhere"), at("broken"));
      expect(await different(dir, [])).toEqual(["pkg/deep/b.js", "real/a.js"]);
    });

    test("a link to a directory that is named is an error, as for Prettier", async () => {
      using dir = tempDir("bun-format-platform", { "real/a.js": ugly });
      link(join(String(dir), "real"), join(String(dir), "linked"));
      const { stderr, exitCode } = await format(dir, ["-l", "linked"]);
      expect(stderr).toContain('error: Explicitly specified pattern "linked" is a symbolic link.');
      expect(exitCode).toBe(2);
    });

    test("from a working directory that is a link, the file is written that the link leads to", async () => {
      using dir = tempDir("bun-format-platform", { "real/a.js": ugly });
      link(join(String(dir), "real"), join(String(dir), "linked"));
      const { exitCode } = await format(join(String(dir), "linked"), ["a.js"]);
      expect(read(dir, "real", "a.js")).toBe(formatted);
      expect(everythingIn(join(String(dir), "real"))).toEqual(["a.js"]);
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("what is written", () => {
    test("nothing but the file is left, and a file that is formatted is not touched", async () => {
      using dir = tempDir("bun-format-platform", { "a.js": ugly, "src/b.js": ugly, "src/c.js": formatted });
      const before = everythingIn(dir);
      const time = new Date(Date.now() - 60_000);
      utimesSync(join(String(dir), "src", "c.js"), time, time);
      const stamp = statSync(join(String(dir), "src", "c.js")).mtimeMs;
      const { exitCode } = await format(dir, []);
      expect(everythingIn(dir)).toEqual(before);
      expect(statSync(join(String(dir), "src", "c.js")).mtimeMs).toBe(stamp);
      expect(read(dir, "src", "b.js")).toBe(formatted);
      expect(exitCode).toBe(0);
    });

    // A file that takes the name of another has none of its tags, nor its ACL. Prettier writes into every file.
    test.skipIf(attributes === undefined)("a file keeps its extended attributes", async () => {
      using dir = tempDir("bun-format-platform", { "tagged.js": ugly, "plain.js": ugly });
      const [tagged, plain] = ["tagged.js", "plain.js"].map(name => join(String(dir), name));
      expect(attributes!.set(tagged, "user.tag", "hello")).toBe(true);
      const before = [tagged, plain].map(path => statSync(path).ino);
      const { exitCode } = await format(dir, []);
      expect([read(tagged), read(plain)]).toEqual([formatted, formatted]);
      expect(attributes!.get(tagged, "user.tag")).toBe("hello");
      expect(statSync(tagged).ino).toBe(before[0]);
      // What the system gives every file, as a label of SELinux, is no reason to write in place.
      if (isLinux) expect(statSync(plain).ino).not.toBe(before[1]);
      expect(everythingIn(dir)).toEqual(["plain.js", "tagged.js"]);
      expect(exitCode).toBe(0);
    });

    // As `fopen` of the C runtime opens a file, and so Python and many editors: others may read and write it, and not rename or
    // delete it. Prettier writes into it.
    test.skipIf(!isWindows)("a file that another program has open", async () => {
      using dir = tempDir("bun-format-platform", { "a.js": ugly });
      const { symbols, close } = dlopen("kernel32.dll", {
        CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "u64" },
        CloseHandle: { args: ["u64"], returns: "i32" },
      });
      const [GENERIC_READ, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING] = [0x80000000, 1, 2, 3];
      const name = Buffer.from(`${join(String(dir), "a.js")}\0`, "utf16le");
      const handle = symbols.CreateFileW(
        name,
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE,
        null,
        OPEN_EXISTING,
        0,
        null,
      );
      // `INVALID_HANDLE_VALUE`: without the handle the test would pass whatever is done.
      expect(handle).not.toBe(0xffffffffffffffffn);
      try {
        const { stderr, exitCode } = await format(dir, []);
        expect(stderr).not.toMatch(anError);
        expect(read(dir, "a.js")).toBe(formatted);
        expect(everythingIn(dir)).toEqual(["a.js"]);
        expect(exitCode).toBe(0);
      } finally {
        symbols.CloseHandle(handle);
        close();
      }
    });
  });

  describe.concurrent("a configuration file that is a program", () => {
    test.each([
      ["exports options", `export default { semi: false };`, true, 1],
      ["prints", `console.log("out"); console.error("err"); export default { semi: false };`, true, 1],
      ["sets process.exitCode", `process.exitCode = 5; export default { semi: false };`, true, 1],
      ["exports an option that does not exist", `export default { semi: false, nonsense: 1 };`, true, 1],
      ["exports a value that an option does not take", `export default { semi: "perhaps" };`, true, 2],
      ["throws", `console.error("before"); throw new Error("boom");`, false, 2],
      ["leaves with an error, and without a word", `process.exit(3);`, false, 2],
    ])(
      "one that %s",
      async (_, config, isLoaded, exitCode) => {
        using dir = tempDir("bun-format-platform", {
          "node_modules/.keep": "",
          "prettier.config.mjs": config,
          "a.js": "a;\n",
        });
        const result = await format(dir, ["--check", "a.js"]);
        // What it prints is seen only if it fails.
        expect(result.stdout + result.stderr).not.toMatch(/\bout\b|\berr\b/);
        if (!isLoaded) expect(result.stderr).toMatch(/prettier\.config\.mjs:\r?\n./);
        expect(everythingIn(dir)).toEqual(["a.js", "node_modules", "node_modules/.keep", "prettier.config.mjs"]);
        expect(result.exitCode).toBe(exitCode);
      },
      slow ? 240_000 : 30_000,
    );

    test(
      "every run evaluates it: a package that it looks for is found as soon as it is installed",
      async () => {
        using dir = tempDir("bun-format-platform", {
          "node_modules/.keep": "",
          "prettier.config.mjs": `let optional;
          try {
            optional = (await import("prettier-config-optional")).default;
          } catch {}
          export default optional ?? { semi: false };`,
          "a.js": formatted,
        });
        const at = (...names: string[]) => join(String(dir), ...names);
        // As old as a file that nobody is working on.
        const time = new Date(Date.now() - 60_000);
        utimesSync(at("prettier.config.mjs"), time, time);
        expect(await different(dir, ["a.js"])).toEqual(["a.js"]);
        mkdirSync(at("node_modules", "prettier-config-optional"));
        writeFileSync(at("node_modules", "prettier-config-optional", "package.json"), "{}");
        writeFileSync(at("node_modules", "prettier-config-optional", "index.js"), "module.exports = { semi: true };");
        expect(await different(dir, ["a.js"])).toEqual([]);
        expect(readdirSync(at("node_modules")).sort()).toEqual([".keep", "prettier-config-optional"]);
      },
      slow ? 240_000 : 30_000,
    );
  });
});

// A key of `[fmt]` is the default of the flag of the same name.
describe.concurrent("[fmt] in bunfig.toml", () => {
  /** What a run leaves behind: what it prints but for the times, how it ends, and the files. */
  async function run(files: Record<string, string>, args: string[]) {
    const reads = Object.keys(files).filter(name => name !== "bunfig.toml");
    const result = await format(files, args, { reads });
    const text = (printed: string) => printed.replace(/\d+(\.\d+)?m?s\b/g, "0ms");
    return { stdout: text(result.stdout), stderr: text(result.stderr), exitCode: result.exitCode, files: result.files };
  }

  const toml = (value: unknown) => JSON.stringify(value);
  const flagOf = (key: string, value: unknown) => {
    const name = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
    return value === true ? `--${name}` : value === false ? `--no-${name}` : `--${name}=${value}`;
  };

  const element = `<div className="some-class-name" id="some-identifier" title="some title that is long">\n  text\n</div>;\n`;
  const long = JSON.stringify(Buffer.alloc(40, "a").toString());
  const paragraph = `${Array(30).fill("word").join(" ")}\n`;
  const sum = `const total = ${Array(8).fill("someLongOperandName").join(" + ")};\n`;
  const choice = `const message = someCondition ? someValueThatIsRatherLong(withAnArgument) : anotherCondition ? anotherValue : last;\n`;

  // An option of Prettier, a value that is not the default, another value, and a file that each of the two prints in its way.
  const options: [key: string, value: unknown, other: unknown, name: string, source: string][] = [
    ["printWidth", 40, 120, "a.js", `${wide}const other = someFunction(argumentOne, argumentTwo, three);\n`],
    ["tabWidth", 4, 8, "a.js", "function f() {\n  return 1;\n}\n"],
    ["useTabs", true, false, "a.js", "function f() {\n  return 1;\n}\n"],
    ["semi", false, true, "a.js", "a;\n"],
    ["singleQuote", true, false, "a.js", `a("b");\n`],
    ["jsxSingleQuote", true, false, "a.jsx", `<a b="c" />;\n`],
    ["quoteProps", "consistent", "preserve", "a.js", `a = { b: 1, "c-d": 2, "e": 3 };\n`],
    ["trailingComma", "none", "es5", "a.js", `f(\n  ${long},\n  ${long},\n);\na = [\n  ${long},\n  ${long},\n];\n`],
    ["bracketSpacing", false, true, "a.js", "a = { b: 1 };\n"],
    ["bracketSameLine", true, false, "a.jsx", element],
    ["arrowParens", "avoid", "always", "a.js", "a = (b) => b;\n"],
    ["objectWrap", "collapse", "preserve", "a.js", "a = {\n  b: 1,\n};\n"],
    ["singleAttributePerLine", true, false, "a.jsx", `<a b="1" c="2" />;\n`],
    ["htmlWhitespaceSensitivity", "ignore", "strict", "a.html", `<span>${paragraph.trim()}</span><span>b</span>\n`],
    ["vueIndentScriptAndStyle", true, false, "a.vue", "<script>\nlet a;\n</script>\n"],
    ["proseWrap", "always", "never", "a.md", `${paragraph}${paragraph}`],
    ["embeddedLanguageFormatting", "off", "auto", "a.js", "a = css`a{b:c}`;\n"],
    ["endOfLine", "crlf", "cr", "a.js", "a;\n"],
    ["requirePragma", true, false, "a.js", "a  ;\n"],
    ["checkIgnorePragma", true, false, "a.js", "/** @noformat */\na  ;\n"],
    ["insertPragma", true, false, "a.js", "a;\n"],
    ["experimentalTernaries", true, false, "a.js", choice],
    ["experimentalOperatorPosition", "start", "end", "a.js", sum],
  ];

  test.each(options)("%s", async (key, value, other, name, source) => {
    const files = { [name]: source };
    const bunfig = { "bunfig.toml": `[fmt]\n${key} = ${toml(value)}\n` };
    const rc = { ".prettierrc": JSON.stringify({ [key]: other }) };
    const [plain, byKey, byFlag, underFlag, byOtherFlag, overFile, flagOverFile] = await Promise.all([
      run(files, [name]),
      run({ ...files, ...bunfig }, [name]),
      run(files, [flagOf(key, value), name]),
      run({ ...files, ...bunfig }, [flagOf(key, other), name]),
      run(files, [flagOf(key, other), name]),
      run({ ...files, ...rc, ...bunfig }, [name]),
      run({ ...files, ...rc }, [flagOf(key, value), name]),
    ]);
    expect(byKey).toEqual(byFlag);
    expect(byKey.files).not.toEqual(plain.files);
    expect(underFlag).toEqual(byOtherFlag);
    expect(overFile).toEqual(flagOverFile);
    expect(overFile.files[name]).toBe(byKey.files[name]);
    expect(byKey.exitCode).toBe(0);
  });

  // A key, the flags that say the same, flags that say otherwise, the files, and the arguments.
  const semicolons = {
    ".prettierrc": `{ "semi": false }`,
    "other.json": `{ "singleQuote": true }`,
    "a.js": `a("b");\n`,
  };
  const others: [line: string, flags: string[], opposite: string[], files: Record<string, string>, args: string[]][] = [
    [`config = "other.json"`, ["--config=other.json"], ["--no-config"], semicolons, ["a.js"]],
    [`config = false`, ["--no-config"], ["--config=other.json"], semicolons, ["a.js"]],
    [`flavor = "oxfmt"`, ["--flavor=oxfmt"], ["--flavor=prettier"], { "a.js": wide }, ["a.js"]],
    [
      `configPrecedence = "prefer-file"`,
      ["--config-precedence=prefer-file"],
      ["--config-precedence=file-override"],
      { ".prettierrc": "{}", "a.js": `a("b");\n` },
      ["--single-quote", "a.js"],
    ],
    [
      `editorconfig = false`,
      ["--no-editorconfig"],
      ["--editorconfig"],
      { ".editorconfig": "[*]\nindent_size = 8\n", "a.js": "function f() {\n  return 1;\n}\n" },
      ["a.js"],
    ],
    [`ignorePath = ["mine"]`, ["--ignore-path=mine"], [], { "mine": "b.js\n", "a.js": ugly, "b.js": ugly }, ["."]],
    [`ignorePath = "mine"`, ["--ignore-path=mine"], [], { "mine": "b.js\n", "a.js": ugly, "b.js": ugly }, ["."]],
    [
      `ignorePatterns = ["b.js", "sub/"]`,
      ["--ignore-pattern=b.js", "--ignore-pattern", "sub/"],
      [],
      { "a.js": ugly, "b.js": ugly, "sub/c.js": ugly },
      ["."],
    ],
    [
      `withNodeModules = true`,
      ["--with-node-modules"],
      ["--no-with-node-modules"],
      { "node_modules/a/a.js": ugly, "b.js": ugly },
      ["."],
    ],
    [
      `ignoreUnknown = true`,
      ["-u"],
      ["--no-ignore-unknown"],
      { "a.unknown": "a", "b.js": ugly },
      ["a.unknown", "b.js"],
    ],
    [
      `errorOnUnmatchedPattern = false`,
      ["--no-error-on-unmatched-pattern"],
      ["--error-on-unmatched-pattern"],
      { "a.js": ugly },
      ["a.js", "none.js"],
    ],
    [
      `disableNestedConfig = true`,
      ["--disable-nested-config"],
      ["--no-disable-nested-config"],
      { ".prettierrc": "{}", "sub/.prettierrc": `{ "semi": false }`, "sub/a.js": "a;\n" },
      ["sub/a.js"],
    ],
    [`logLevel = "silent"`, ["--log-level=silent"], ["--log-level=log"], { "a.js": ugly }, ["--check", "a.js"]],
    [
      `allowUnsupported = true`,
      ["--allow-unsupported"],
      ["--no-allow-unsupported"],
      { ".prettierrc": `{ "plugins": ["prettier-plugin-of-nobody"] }`, "a.js": ugly },
      ["a.js"],
    ],
  ];

  test.each(others)("%s", async (line, flags, opposite, files, args) => {
    const bunfig = { "bunfig.toml": `[fmt]\n${line}\n` };
    // bunfig.toml gets formatted too, so every run has one to keep the outputs comparable.
    const empty = { "bunfig.toml": "# Nothing.\n" };
    const [plain, byKey, byFlag, underFlag, byOtherFlag] = await Promise.all([
      run({ ...files, ...empty }, args),
      run({ ...files, ...bunfig }, args),
      run({ ...files, ...empty }, [...flags, ...args]),
      run({ ...files, ...bunfig }, [...opposite, ...args]),
      run({ ...files, ...empty }, [...(opposite.length ? opposite : flags), ...args]),
    ]);
    expect(byKey).toEqual(byFlag);
    expect(byKey).not.toEqual(plain);
    expect(underFlag).toEqual(byOtherFlag);
  });

  test("threads", async () => {
    const files = { "a.js": ugly, "b.js": ugly };
    const [byKey, byFlag, zero] = await Promise.all([
      run({ ...files, "bunfig.toml": "[fmt]\nthreads = 1\n" }, ["a.js", "b.js"]),
      run(files, ["--threads=1", "a.js", "b.js"]),
      run({ ...files, "bunfig.toml": "[fmt]\nthreads = 0\n" }, ["a.js", "b.js"]),
    ]);
    expect(byKey).toEqual(byFlag);
    expect(zero.stderr).toContain(`--threads takes a number above zero, not "0"`);
    expect(zero.exitCode).toBe(2);
  });

  test.each(["67108864", "9007199254740991"])("%s threads are as many as there can be", async count => {
    const files = { "a.js": ugly, "b.js": ugly };
    const [byKey, byFlag, few] = await Promise.all([
      run({ ...files, "bunfig.toml": `[fmt]\nthreads = ${count}\n` }, ["a.js", "b.js"]),
      run(files, [`--threads=${count}`, "a.js", "b.js"]),
      run(files, ["--threads=1", "a.js", "b.js"]),
    ]);
    expect(byKey).toEqual(few);
    expect(byFlag).toEqual(few);
  });

  test("a list on the command line is added to the list of the file", async () => {
    const files = { "a.js": ugly, "b.js": ugly, "c.js": ugly, "bunfig.toml": `[fmt]\nignorePatterns = ["b.js"]\n` };
    expect(await different(files, ["--ignore-pattern=c.js", "."])).toEqual(["a.js"]);
  });

  test("with configPrecedence = prefer-file the section counts only where there is no configuration file", async () => {
    const bunfig = `[fmt]\nconfigPrecedence = "prefer-file"\nsemi = false\n`;
    const [alone, beside] = await Promise.all([
      run({ "bunfig.toml": bunfig, "a.js": "a;\n" }, ["a.js"]),
      run({ "bunfig.toml": bunfig, ".prettierrc": "{}", "a.js": "a;\n" }, ["a.js"]),
    ]);
    expect([alone.files["a.js"], beside.files["a.js"]]).toEqual(["a\n", "a;\n"]);
  });

  test("the file is that of the working directory, after --cwd", async () => {
    const files = { "bunfig.toml": "[fmt]\nsemi = false\n", "sub/bunfig.toml": "[fmt]\nsingleQuote = true\n" };
    const source = { "a.js": `a("b");\n`, "sub/a.js": `a("b");\n` };
    const [above, below, inside] = await Promise.all([
      run({ ...files, ...source }, ["sub/a.js"]),
      run({ ...files, ...source }, ["--cwd=sub", "a.js"]),
      format({ ...files, ...source }, ["a.js"], { cwd: "sub", reads: ["sub/a.js"] }),
    ]);
    expect(above.files["sub/a.js"]).toBe(`a("b")\n`);
    expect(below.files["sub/a.js"]).toBe(`a('b');\n`);
    expect(inside.files["sub/a.js"]).toBe(`a('b');\n`);
  });

  // The flags that say what one run does.
  test.each([
    ["check = true", "--check"],
    ["listDifferent = true", "--list-different"],
    ["write = true", "--write"],
    [`stdinFilepath = "a.js"`, "--stdin-filepath"],
    [`findConfigPath = "a.js"`, "--find-config-path"],
    ["rangeStart = 1", "--range-start"],
    ["rangeEnd = 1", "--range-end"],
    ["cursorOffset = 1", "--cursor-offset"],
    ["init = true", "--init"],
    ["timing = true", "--timing"],
    ["color = true", "--color"],
    [`cwd = "sub"`, "--cwd"],
  ])("%s is refused, and nothing is written", async (line, flag) => {
    const key = line.split(" ")[0];
    const result = await run({ "bunfig.toml": `[fmt]\n${line}\n`, "a.js": ugly }, ["a.js"]);
    expect(result.stderr).toContain(
      `error: "${key}" cannot be set in bunfig.toml\n  Use ${flag} on the command line\n`,
    );
    expect(result.files["a.js"]).toBe(ugly);
    expect(result.exitCode).toBe(2);
  });

  test.each([
    ["semi = 1", "expected boolean but received number"],
    [`semi = "no"`, "expected boolean but received string"],
    [`printWidth = "80"`, "expected number but received string"],
    ["printWidth = true", "expected number but received boolean"],
    ["printWidth = 1.5", "Invalid printWidth value: 1.5."],
    ["trailingComma = 5", "expected string but received number"],
    [`trailingComma = "some"`, "Invalid trailingComma value: some."],
    [`endOfLine = ["lf"]`, "expected string but received array"],
    ["config = true", "expected string but received boolean"],
    ["ignorePatterns = 1", "expected array but received number"],
    ["ignorePatterns = [1]", "expected string but received number"],
    [`flavor = "biome"`, `Invalid --flavor value. Expected "oxfmt" or "prettier", but received "biome".`],
    [`logLevel = "loud"`, `Invalid --log-level value.`],
    [`configPrecedence = "mine"`, `Invalid --config-precedence value.`],
    ["semicolons = false", `Unknown key "semicolons" in [fmt]\n`],
    ["printwidth = 80", `Unknown key "printwidth" in [fmt]\n  Did you mean "printWidth"?`],
    [`plugins = ["a"]`, `Unknown key "plugins" in [fmt]\n`],
    [`parser = "babel"`, `Unknown key "parser" in [fmt]\n`],
  ])("%s is refused: %s", async (line, message) => {
    const result = await run({ "bunfig.toml": `[fmt]\n${line}\n`, "a.js": ugly }, ["a.js"]);
    expect(result.stderr).toContain(message);
    expect(result.files["a.js"]).toBe(ugly);
    expect(result.exitCode).toBe(2);
  });

  test("a file that is not TOML", async () => {
    const result = await run({ "bunfig.toml": "[fmt\nsemi = false\n", "a.js": ugly }, ["a.js"]);
    expect(result.files["a.js"]).toBe(ugly);
    expect(result.exitCode).toBe(2);
  });

  test("fmt that is no table", async () => {
    const result = await run({ "bunfig.toml": `fmt = "prettier"\n`, "a.js": ugly }, ["a.js"]);
    expect(result.stderr).toContain("expected object but received string");
    expect(result.exitCode).toBe(2);
  });

  test("every flag in the help is a key, or is refused as a key with its name", async () => {
    const help = await format({}, ["--help", "--all"]);
    const flags = [...help.stdout.matchAll(/^\s+(?:-\w, )?--([a-z-]+)/gm)].map(it => it[1]);
    expect(flags.length).toBeGreaterThan(60);
    const answers = await Promise.all(
      flags.map(async flag => {
        const positive = flag.replace(/^no-/, "");
        const key =
          positive === "ignore-pattern" ? "ignorePatterns" : positive.replace(/-(\w)/g, (_, it) => it.toUpperCase());
        // Of a type that no key takes: one that exists says what it expects.
        const { stderr } = await run({ "bunfig.toml": `[fmt]\n${key} = [[]]\n` }, ["--list-files"]);
        return [flag, /expected [\w ]+ but received array|cannot be set in bunfig\.toml/.test(stderr)];
      }),
    );
    // Prettier and oxfmt flags that aren't project settings, or that do nothing.
    expect(answers.filter(it => !it[1]).map(it => it[0])).toEqual([
      "parser",
      "plugin",
      "jsx-bracket-same-line",
      "cache",
      "cache-location",
      "cache-strategy",
      "experimental-cli",
      "lsp",
    ]);
  });
});
