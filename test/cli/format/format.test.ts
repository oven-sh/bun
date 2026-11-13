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
  closeSync,
  constants,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
  writeSync,
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
 * The text that `bun fmt` prints when a file can't be formatted, with any configuration. It's Bun's usual error format:
 * the source line, a caret under the position, the message and the location. Without `at` the error is about the whole
 * file. Trailing whitespace on the source line isn't shown, and a line with nothing else on it is omitted. The caret is
 * only right if every character before it is one column wide. A blank line follows, which isn't included here.
 */
function problem(file: string, message: string, at?: [line: number, column: number, text: string]) {
  if (!at) return `error: ${message}\n    at ${file}`;
  const [line, column] = at;
  const text = at[2].trimEnd();
  const shown = text && `${line} | ${text}\n${Buffer.alloc(`${line} | `.length + column - 1, " ").toString()}^\n`;
  return `${shown}error: ${message}\n    at ${file}:${line}:${column}`;
}

/** Matches a syntax error in `file` with any message: an error with a line and a column. */
const syntaxErrorIn = (file: string) =>
  new RegExp(`^error: .+\\n    at ${file.replaceAll(".", "\\.")}:[0-9]+:[0-9]+$`, "m");

/** Prettier's message for an HTML end tag that doesn't close anything. */
const closingTag = (name: string) =>
  `Unexpected closing tag "${name}". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags`;

const ugly = `const a = {b:1,  c:"two"}\nfunction f(x){return [x,\n'y']}\n`;
const formatted = `const a = { b: 1, c: "two" };\nfunction f(x) {\n  return [x, "y"];\n}\n`;
const wide = `const value = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, four);\n`;

type Options = {
  cwd?: string;
  stdin?: string;
  /** Files to read after the command has run. */
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
    /** CPU time in seconds. Wall-clock time means little on a busy machine. */
    cpu: Number(proc.resourceUsage()?.cpuTime.total ?? 0) / 1e6,
    files: Object.fromEntries((options.reads ?? []).map(name => [name, read(name)])),
  };
}

/** Runs `format` once `--debug-check`, which writes nothing, confirms that formatting keeps the files' meaning. */
async function formatChecked(files: Record<string, string>, args: string[], options: Options = {}) {
  expect(await format(files, ["--debug-check", ...args])).toMatchObject({ stderr: "", exitCode: 0 });
  return format(files, ["--log-level=warn", ...args], options);
}

/**
 * The CPU time of the run `odd` as a multiple of `plain`'s. Windows measures CPU time in ticks of 1/64 s, so a short
 * run can report 0. Anything below one tick counts as one tick.
 */
const slowdown = (odd: { cpu: number }, plain: { cpu: number }) =>
  odd.cpu / Math.max(plain.cpu, isWindows ? 1 / 64 : 0);

/** True if the temporary directory is inside a repository. */
const isInRepository = (function look(directory: string): boolean {
  const isRoot = [".git", ".jj"].some(name => existsSync(join(directory, name)));
  return isRoot || (dirname(directory) !== directory && look(dirname(directory)));
})(realpathSync(tmpdir()));

/** Returns the unformatted files that `-l` lists. */
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

  // Taken from runs of Prettier 3.9.9 and oxfmt 0.72.0, whose messages start with "[error] " and "Error: ". Both report
  // this before they look at the files, the patterns or the configuration.
  describe("mutually exclusive mode flags", () => {
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
    ])("rejected with %s: %j %j", async (_, configuration, args, stderr) => {
      const files = { ...configuration, "good.js": formatted, "bad.js": ugly };
      const result = await format(files, args, { reads: Object.keys(files), stdin: ugly });
      expect({ ...result, cpu: 0, raw: "" }).toEqual({ raw: "", stdout: "", stderr, exitCode: 1, cpu: 0, files });
    });

    test.each<[Record<string, string>, string[], string, number, string]>([
      // The last occurrence of a flag wins.
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
      // In oxfmt, `-c` followed by a path is `--config`.
      [oxfmt, ["-c", ".oxfmtrc.json", "--list-different", "bad.js"], "bad.js", 1, ugly],
    ])("accepted: %j %j", async (configuration, args, stdout, exitCode, bad) => {
      const result = await format({ ...configuration, "good.js": formatted, "bad.js": ugly }, args, {
        reads: ["bad.js"],
      });
      expect(result.stdout).toBe(stdout);
      expect(result.files).toEqual({ "bad.js": bad });
      expect(result.exitCode).toBe(exitCode);
    });
  });

  // Taken from runs of Prettier 3.9.9. A command-line value is parsed with `Number(text)`, and an integer is a number
  // that equals its own `Math.floor`.
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
    ])("accept the values that Prettier accepts: %j %j", async (configuration, args, sha1) => {
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
    ])("reject invalid values with Prettier's message: %j %j", async (configuration, args, stderr, exitCode) => {
      const result = await format(configuration, [...args, "--stdin-filepath", "a.js"], { stdin: text });
      expect({ stdout: result.raw, stderr: result.stderr.split("\n")[0], exitCode }).toEqual({
        stdout: "",
        stderr,
        exitCode,
      });
      expect(result.exitCode).toBe(exitCode);
    });

    test("stop the run at the first file whose configuration has a non-integer value", async () => {
      const files = { ".prettierrc": `{ "printWidth": 1.5 }`, "a.js": ugly, "b.js": ugly };
      const result = await format(files, ["--check", "a.js", "b.js"]);
      expect(result.stdout).toBe("Checking formatting...");
      expect(result.stderr).toBe("error: Invalid printWidth value. Expected an integer, but received 1.5.");
      expect(result.exitCode).toBe(1);
    });
  });

  // Prettier's `listDifferent` doesn't report a file that's about to be written, and then the code isn't printed
  // either.
  test.each([
    ["--check", "--write"],
    ["--write", "--check"],
    ["-l", "--write"],
    ["--check", "--write", "--log-level", "warn"],
  ])("stdin with %s %s prints nothing at all", async (...args) => {
    const result = await format({ ".prettierrc": "{}" }, [...args, "--stdin-filepath", "a.js"], { stdin: ugly });
    expect({ stdout: result.raw, stderr: result.stderr, exitCode: result.exitCode }).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
  });

  test("doesn't rewrite a file that's already formatted", async () => {
    let before = 0;
    using dir = tempDir("bun-format", { "a.js": formatted });
    before = statSync(join(String(dir), "a.js")).mtimeMs;
    await using proc = spawn({ cmd: [...command, "a.js"], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(0);
    expect(statSync(join(String(dir), "a.js")).mtimeMs).toBe(before);
  });

  // Prettier and oxfmt write into the existing file (`fs.writeFile`, `fs::write`), so everything but its text stays the
  // same.
  describe("a written file", () => {
    const isRoot = process.getuid?.() === 0;
    /** Runs `bun fmt` in `dir`, which isn't deleted afterwards. `before` is a prefix for the command. */
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

    test("keeps its hard links", async () => {
      using dir = tempDir("bun-format", { "a.js": ugly });
      linkSync(join(String(dir), "a.js"), join(String(dir), "other-name.txt"));
      const { exitCode } = await write(String(dir), ["a.js"]);
      expect([read(String(dir), "a.js"), read(String(dir), "other-name.txt")]).toEqual([formatted, formatted]);
      expect(statSync(join(String(dir), "a.js")).nlink).toBe(2);
      expect(readdirSync(String(dir)).sort()).toEqual(["a.js", "other-name.txt"]);
      expect(exitCode).toBe(0);
    });

    // Two threads once formatted such a file at the same time. One read a partial write from the other, which was
    // writing in place, and wrote that back.
    test("isn't corrupted when the run reaches it through two hard links", async () => {
      const count = 100;
      const text = Array.from({ length: 150 }, (_, i) => `*   item ${i} with   some text\n`).join("");
      const wanted = text.replaceAll("*   item", "- item").replaceAll("with   some", "with some");
      const names = (kind: string) => Array.from({ length: count }, (_, i) => `${i}-${kind}.md`);
      using dir = tempDir(
        "bun-format",
        Object.fromEntries([...names("first"), ...names("only")].map(name => [name, text])),
      );
      for (let i = 0; i < count; i++) linkSync(join(String(dir), `${i}-first.md`), join(String(dir), `${i}-second.md`));
      const all = [...names("first"), ...names("second"), ...names("only")];
      const damaged = () => all.filter(name => read(String(dir), name) !== wanted);
      const once = await write(String(dir), ["--threads=8"]);
      expect(damaged()).toEqual([]);
      // Both names are counted, whichever came first.
      expect(once.stderr).toContain(`Formatted ${all.length} files, 0 unchanged`);
      const again = await write(String(dir), ["--threads=8"]);
      expect(damaged()).toEqual([]);
      expect(again.stderr).toContain(`Formatted 0 files, ${all.length} unchanged`);
      expect([once.exitCode, again.exitCode]).toEqual([0, 0]);
    });

    // A file with a second hard link is written in place.
    test("is truncated when it's written in place and gets shorter", async () => {
      using dir = tempDir("bun-format", { "a.js": "const a      =      1;\n\n\n\n" });
      linkSync(join(String(dir), "a.js"), join(String(dir), "other-name.txt"));
      const { exitCode } = await write(String(dir), ["a.js"]);
      expect(read(String(dir), "a.js")).toBe("const a = 1;\n");
      expect(exitCode).toBe(0);
    });

    // With `ulimit -f 16` a write fails with EFBIG once it's 8 KB into a file, much like on a full disk.
    test.skipIf(isWindows)("keeps its old text when writing it in place fails partway", async () => {
      const text = `{${Array.from({ length: 3000 }, (_, i) => `"k${i}":   [1,2,3]`).join(",")}}\n`;
      using dir = tempDir("bun-format", { "a.json": text });
      linkSync(join(String(dir), "a.json"), join(String(dir), "other-name.txt"));
      const { stderr, exitCode } = await write(String(dir), ["a.json"], ["sh", "-c", 'ulimit -f 16; exec "$0" "$@"']);
      expect(statSync(join(String(dir), "a.json")).size).toBe(text.length);
      expect(read(String(dir), "a.json")).toBe(text);
      expect(stderr).toStartWith('error: Unable to write file "a.json":\nEFBIG: File too large\n');
      expect(exitCode).toBe(2);
    });

    // A new file would get fewer permission bits, unless the process's umask is 0.
    test.skipIf(isWindows)("keeps its mode regardless of the umask", async () => {
      using dir = tempDir("bun-format", { "a.js": ugly, "b.js": ugly });
      chmodSync(join(String(dir), "a.js"), 0o664);
      chmodSync(join(String(dir), "b.js"), 0o777);
      const { exitCode } = await write(String(dir), [], ["sh", "-c", 'umask 077; exec "$0" "$@"']);
      expect([read(String(dir), "a.js"), read(String(dir), "b.js")]).toEqual([formatted, formatted]);
      expect(["a.js", "b.js"].map(name => statSync(join(String(dir), name)).mode & 0o7777)).toEqual([0o664, 0o777]);
      expect(exitCode).toBe(0);
    });

    // Prettier and oxfmt write there. People don't audit the symlinks in a project that they've checked out.
    test("can't be reached through a symlink that leaves the repository", async () => {
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

    test("can be reached through a symlink that stays in the repository", async () => {
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

    // A file name can have at most 255 bytes. On Windows the path would also be too long.
    test.skipIf(isWindows)(
      "can have the longest possible name, and is still replaced rather than written in place",
      async () => {
        const name = `${Buffer.alloc(252, "a")}.ts`;
        using dir = tempDir("bun-format", { [name]: ugly });
        const before = statSync(join(String(dir), name)).ino;
        const { exitCode } = await write(String(dir), []);
        expect(read(String(dir), name)).toBe(formatted);
        expect(statSync(join(String(dir), name)).ino).not.toBe(before);
        expect(readdirSync(String(dir))).toEqual([name]);
        expect(exitCode).toBe(0);
      },
    );

    // For example in a container with a user's project mounted into it.
    test.skipIf(!isRoot)("keeps its owner if root formats it", async () => {
      using dir = tempDir("bun-format", { "a.js": ugly });
      try {
        chownSync(join(String(dir), "a.js"), 12345, 12345);
      } catch {
        // Root in a container that doesn't have these ids.
        return;
      }
      const { exitCode } = await write(String(dir), []);
      const { uid, gid } = statSync(join(String(dir), "a.js"));
      expect([read(String(dir), "a.js"), uid, gid]).toEqual([formatted, 12345, 12345]);
      expect(exitCode).toBe(0);
    });

    // Prettier doesn't need write access to the directory.
    test.skipIf(isWindows || isRoot)("can be in a read-only directory", async () => {
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

    // `fs.writeFile` fails with EACCES, or EPERM on Windows. A version control system that keeps files read-only until
    // they're checked out does that on purpose.
    test.skipIf(isRoot)("isn't replaced if it's read-only, which is an error", async () => {
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

  // Every write to /dev/full fails with ENOSPC, as on a full disk.
  describe.skipIf(!isLinux)("standard output", () => {
    /** Runs `bun fmt` wrapped in the shell `script`, where `"$0" "$@"` is the command. */
    async function inShell(script: string, args: string[]) {
      using dir = tempDir("bun-format", { "a.js": ugly });
      await using proc = spawn({
        cmd: ["sh", "-c", script, ...command, ...args],
        env,
        cwd: String(dir),
        stdin: Buffer.from(ugly),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      return { stderr, exitCode };
    }

    test.each([[["--stdin-filepath", "a.js"]], [["--list-files"]], [["-l"]]])(
      "exits with 2 if it can't be written: %j",
      async args => {
        const { stderr, exitCode } = await inShell('exec "$0" "$@" > /dev/full', args);
        expect(stderr).toContain("error: Cannot write standard output: ENOSPC: ");
        expect(exitCode).toBe(2);
      },
    );

    test("isn't an error if the reader has closed it", async () => {
      const { stderr } = await inShell('{ "$0" "$@"; echo "exit code $?" >&2; } | :', ["--stdin-filepath", "a.js"]);
      expect(stderr).toBe("exit code 0\n");
    });
  });

  test("reports a path longer than the OS limit as not found", async () => {
    // The limit is 4,096 bytes on Linux, 1,024 on macOS and 32,767 characters on Windows, which is also the limit for
    // its command line.
    const long = Buffer.alloc(isWindows ? 30_000 : 40_000, "a/").toString() + "a.js";
    const result = await format({ "a.js": ugly }, [long, "a.js"], { reads: ["a.js"] });
    expect(result.stderr).toStartWith('error: No files matching the pattern were found: "a/a/');
    expect(result.files).toEqual({ "a.js": formatted });
    expect(result.exitCode).toBe(2);
  });

  test("--check doesn't write and exits with 1", async () => {
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

  test("in an oxfmt project, prints oxfmt's run messages", async () => {
    const files = { "a.js": ugly, "b.js": formatted, "src/c.js": ugly, ".oxfmtrc.json": "{}\n" };
    const normalize = (text: string) => text.replace(/\d+ms/g, "0ms").replace(/\d+ threads/, "1 threads");
    const check = await format(files, ["--check"]);
    expect(normalize(check.raw)).toBe(
      "Checking formatting...\n\na.js (0ms)\nsrc/c.js (0ms)\n\n" +
        "Format issues found in above 2 files. Run without `--check` to fix.\n" +
        "Finished in 0ms on 4 files using 1 threads.\n",
    );
    expect(check.stderr).toBe("");
    expect(check.exitCode).toBe(1);
    const clean = await format({ "b.js": formatted, ".oxfmtrc.json": "{}\n" }, ["--check"]);
    expect(normalize(clean.raw)).toBe(
      "Checking formatting...\n\nAll matched files use the correct format.\n" +
        "Finished in 0ms on 2 files using 1 threads.\n",
    );
    expect(clean.exitCode).toBe(0);
    const written = await format(files, [], { reads: ["a.js"] });
    expect(normalize(written.raw)).toBe("Finished in 0ms on 4 files using 1 threads.\n");
    expect(written.stderr).toBe("");
    expect(written.files["a.js"]).toBe(formatted);
    expect(written.exitCode).toBe(0);
    const listed = await format(files, ["--list-different"]);
    expect(listed.raw).toBe("a.js\nsrc/c.js\n");
    expect(listed.stderr).toBe("");
    expect(listed.exitCode).toBe(1);
    const broken = await format({ ...files, "d.js": "d = (\n" }, ["--check"]);
    expect(normalize(broken.raw)).toBe("Checking formatting...\n\na.js (0ms)\nsrc/c.js (0ms)\n");
    expect(broken.stderr).toEndWith("Error occurred when checking code style in the above files.");
    expect(broken.exitCode).toBe(2);
    const none = await format(files, ["--check", "nothing.js"]);
    expect(none.raw).toBe("Checking formatting...\n\n");
    expect(none.exitCode).toBe(2);
  });

  test("--list-different prints the unformatted files and exits with 1", async () => {
    const result = await format({ "a.js": ugly, "b.js": formatted, "src/c.js": ugly }, ["-l"], { reads: ["a.js"] });
    expect(result.files).toEqual({ "a.js": ugly });
    expect(result.raw).toBe("a.js\nsrc/c.js\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });

  test("reports a syntax error, formats the other files and exits with 2", async () => {
    const result = await format({ "a.js": "const = 1;\n", "b.js": ugly }, [], { reads: ["a.js", "b.js"] });
    expect(result.files).toEqual({ "a.js": "const = 1;\n", "b.js": formatted });
    expect(result.stderr).toStartWith(problem("a.js", "Variable declaration expected.", [1, 7, "const = 1;"]) + "\n\n");
    expect(result.exitCode).toBe(2);
  });

  test("a syntax error has a message and a position in every language", async () => {
    // One case per language and kind of error: the file, its text, the message, the line and the column.
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
      ["blank-in-header.yaml", "a: | 2\n    b\n  c\n", "Unexpected character", 1, 6],
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
    // `format` turns every backslash in the output into a `/`.
    const expected = cases.map(([name, text, message, line, column]) =>
      problem(name, message, [line, column, text.split("\n")[line - 1].replaceAll("\\", "/")]),
    );
    expect(result.stderr.split("\n\n").sort()).toEqual([...expected, "Formatted 0 files, 0 unchanged"].sort());
    expect(result.exitCode).toBe(2);
  });

  test("prints a syntax error in Bun's usual format: the line, a caret, the message and the location", async () => {
    const files = {
      // A byte order mark isn't counted, `\r\n` is one line break, and a column is a UTF-16 code unit. The caret is
      // indented by the display width of the characters before it. A tab counts as one column.
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
    // Another tool's configuration makes no difference.
    for (const configuration of [{ ".prettierrc": "{}\n" }, { ".oxfmtrc.json": "{}\n" }]) {
      const result = await format({ ...configuration, "b.css": files["b.css"] }, ["b.css"]);
      expect(result.stderr).toStartWith(problem("b.css", "Unclosed string", [7, 6, '  e: "f']) + "\n\n");
      expect(result.exitCode).toBe(2);
    }
  });

  // `bun lint` and `bun build` count lines the same way, and don't count the byte order mark either.
  test.each<[string, string, number, number, string]>([
    ["\\r\\n is one line break", "let b;\r\nlet c;\r\nconst a = ; let d;\r\n", 3, 11, "const a = ; let d;"],
    ["\\r is a line break", "let b;\rlet c;\rconst a = ; let d;\r", 3, 11, "const a = ; let d;"],
    ["a byte order mark isn't counted", "\uFEFFconst a = ; let d;\n", 1, 11, "const a = ; let d;"],
    ["the mark doesn't shift later lines", "\uFEFFlet b;\r\nconst a = ; let d;\r\n", 2, 11, "const a = ; let d;"],
    ["U+2028 is a line break", "let b;\u2028let c;\u2028const a = ; let d;\n", 3, 11, "const a = ; let d;"],
    ["U+2029 is a line break", "let b;\u2029const a = ; let d;\n", 2, 11, "const a = ; let d;"],
  ])("position of a JavaScript syntax error: %s", async (_, text, line, column, shown) => {
    for (const name of ["a.js", "a.ts"]) {
      const result = await format({}, ["--stdin-filepath", name], { stdin: text });
      expect(result.stderr).toBe(problem(name, "Expression expected.", [line, column, shown]));
      expect(result.exitCode).toBe(2);
    }
  });

  test("a TOML syntax error uses Bun's parser message and is only a warning, because oxfmt skips such a file", async () => {
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

  describe("--no-semi puts a `;` before a statement that would otherwise continue the previous line", () => {
    // Prettier 3.9.9 doesn't add one before these, which turns two statements into `c(..)`, and two others into
    // `let c`.
    test.each([
      [
        "before the parentheses that --experimental-ternaries puts around a condition",
        ["--experimental-ternaries"],
        "a ? b : c;\n(d ? e : f) ? g : h;\n",
        "a ? b : c\n;(\n  d ? e : f\n) ?\n  g\n: h\n",
        "a ? b : c\n(\n  d ? e : f\n) ?\n  g\n: h\n",
      ],
      [
        "before those parentheses around a condition that doesn't fit on the line",
        ["--experimental-ternaries", "--print-width=20"],
        "a;\nbbbbbbbbbb && cccccccccc ? d : e;\nf && g ? h : i;\n",
        "a\n;(\n  bbbbbbbbbb &&\n  cccccccccc\n) ?\n  d\n: e\nf && g ? h : i\n",
        "a\n(\n  bbbbbbbbbb &&\n  cccccccccc\n) ?\n  d\n: e\nf && g ? h : i\n",
      ],
      ["before a variable named let", [], "a;\nlet;\nc;\n", "a\n;(let)\nc\n", "a\nlet\nc\n"],
    ])("%s", async (_, flags, text, right, byPrettier) => {
      expect(right).not.toBe(byPrettier);
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

  test("in TypeScript, never ends a line with something that looks like type arguments", async () => {
    // Prettier 3.9.9 prints `a <\n  b >\n  c;`, which parses as `a<b>; c;`.
    const files = { "a.ts": "a < b > c;\n", "b.js": "a < b > c;\n" };
    const flags = ["--print-width=5"];
    const result = await format(files, flags, { reads: ["a.ts", "b.js"] });
    expect(result.files).toEqual({ "a.ts": "a <\n  b > c;\n", "b.js": "a <\n  b >\n  c;\n" });
    expect(result.exitCode).toBe(0);
    const checked = await format(files, [...flags, "--debug-check"]);
    expect(checked.stderr).toBe("");
    expect(checked.exitCode).toBe(0);
  });

  test("formats the syntax that's new in TypeScript 7.1", async () => {
    // The attributes of an ambient module are printed like those of an import.
    const rows = [
      [
        `declare module '*.css' with {"type":'css'} { const sheet: CSSStyleSheet; export default sheet }`,
        `declare module "*.css" with { type: "css" } {\n  const sheet: CSSStyleSheet;\n  export default sheet;\n}`,
      ],
      [`declare module "a" with {type:"text",}`, `declare module "a" with { type: "text" };`],
      [`declare module "a" with {type:"text";};`, `declare module "a" with { type: "text" };`],
      [`declare module "a"\n  with {\n    type: "text"\n  }\n  {}`, `declare module "a" with { type: "text" } {}`],
      [`declare module "a" with {};`, `declare module "a" with {};`],
      [`declare module "a" with { b: "c"; 'd-e': "f" } {}`, `declare module "a" with { b: "c", "d-e": "f" } {}`],
      [`declare module "a" with { b: "c"\n  d: "e" };`, `declare module "a" with { b: "c", d: "e" };`],
      [`declare module "a" with {\n  b: "c", d: "e" } {}`, `declare module "a" with {\n  b: "c",\n  d: "e",\n} {}`],
      [
        `declare module "a" with { type: "text", ${Buffer.alloc(30, "b")}: "${Buffer.alloc(30, "c")}" };`,
        `declare module "a" with {\n  type: "text",\n  ${Buffer.alloc(30, "b")}: "${Buffer.alloc(30, "c")}",\n};`,
      ],
      [
        `declare module "a" /* 1 */ with /* 2 */ { /* 3 */ type /* 4 */ : /* 5 */ "b" /* 6 */ } /* 7 */ { /* 8 */ }`,
        `declare module "a" /* 1 */ with /* 2 */ {\n  /* 3 */ type /* 4 */: /* 5 */ "b" /* 6 */,\n} /* 7 */ {\n  /* 8 */\n}`,
      ],
      [`declare module "a" with { /* 1 */ };`, `declare module "a" with {/* 1 */};`],
      [
        `declare module "a" with { b: "c", // 1\n  d: "e" };`,
        `declare module "a" with {\n  b: "c", // 1\n  d: "e",\n};`,
      ],
      [`declare module "a" // 1\n  with { type: "b" } {}`, `declare module "a" with { type: "b" } {} // 1`],
      [`declare module "a" with // 1\n  { type: "b" } {}`, `declare module "a" with { type: "b" } {} // 1`],
      [`declare module "a" with { type: "b" } // 1\n  {}`, `declare module "a" with { type: "b" } {} // 1`],
      [`import   source   a   from   './a.wasm'`, `import source a from "./a.wasm";`],
      [
        `import source /* 1 */ a /* 2 */ from "a" with {type:'b'}`,
        `import source /* 1 */ a /* 2 */ from "a" with { type: "b" };`,
      ],
      [
        `import source from "a"; import source source from "a"`,
        `import source from "a";\nimport source source from "a";`,
      ],
      [`a = import . source ( './a.wasm' )`, `a = import.source("./a.wasm");`],
      [`a = import.source(/* 1 */ "a", {with:{type:"b"}})`, `a = import.source(/* 1 */ "a", { with: { type: "b" } });`],
      [
        `class A { #a = 1; b(c: A) { let d: typeof   this . #a; let e: typeof c.#a.f; let g: typeof c.h.#a<string> } }`,
        `class A {\n  #a = 1;\n  b(c: A) {\n    let d: typeof this.#a;\n    let e: typeof c.#a.f;\n    let g: typeof c.h.#a<string>;\n  }\n}`,
      ],
    ];
    // A declaration file has no statements.
    const extensions = (code: string) => [
      "ts",
      "tsx",
      "mts",
      "cts",
      ...(/^(declare|import) /.test(code) ? ["d.ts"] : []),
    ];
    const names = rows.flatMap(([code], index) => extensions(code).map(extension => `${index}.${extension}`));
    const column = (at: 0 | 1) => Object.fromEntries(names.map(name => [name, rows[parseInt(name)][at] + "\n"]));
    const result = await formatChecked(column(0), [], { reads: names });
    expect(result.files).toEqual(column(1));
    expect(result).toMatchObject({ stderr: "", exitCode: 0 });
    expect((await format(column(1), ["--check"])).exitCode).toBe(0);
    // An oxfmt config selects another dialect of the parser.
    const oxfmt = { ".oxfmtrc.json": "{}\n" };
    expect((await format({ ...oxfmt, ...column(0) }, ["--debug-check"])).exitCode).toBe(0);
    const withOxfmt = await format({ ...oxfmt, ...column(0) }, [], { reads: names });
    expect(withOxfmt.exitCode).toBe(0);
    const again = await format({ ...oxfmt, ...(withOxfmt.files as Record<string, string>) }, ["--check"]);
    expect(again.exitCode).toBe(0);

    const options = [
      ["--no-semi", `declare module "a" with { b: "c", "d-e": "f" }\n`],
      ["--single-quote", `declare module 'a' with { b: 'c', 'd-e': 'f' };\n`],
      ["--quote-props=consistent", `declare module "a" with { "b": "c", "d-e": "f" };\n`],
      ["--no-bracket-spacing", `declare module "a" with {b: "c", "d-e": "f"};\n`],
      ["--print-width=30", `declare module "a" with {\n  b: "c",\n  "d-e": "f",\n};\n`],
      ["--print-width=30 --trailing-comma=none", `declare module "a" with {\n  b: "c",\n  "d-e": "f"\n};\n`],
    ];
    const stdin = `declare module "a" with { b: "c", "d-e": "f" };\n`;
    const printed = options.map(([flags]) => format({}, [...flags.split(" "), "--stdin-filepath=a.d.ts"], { stdin }));
    expect((await Promise.all(printed)).map(it => it.raw)).toEqual(options.map(it => it[1]));
  });

  test("keeps two comments before an arrow function's `=>` on the same line", async () => {
    // Prettier 3.9.9 prints `(a) /* b */\n/* c */ => d`, and no line break is allowed before `=>`.
    const files = {
      "a.js": "const f = a /* b */ /* c */ => d;\nuseEffect(() /* b */ /* c */ => { a(); }, [d]);\n",
      "b.vue": '<template>\n  <div :x="a /* b */ /* c */ => a"></div>\n</template>\n',
      "c.svelte": "<div x={a /* b */ /* c */ => d}></div>\n",
    };
    const result = await format(files, [], { reads: Object.keys(files) });
    expect(result.files).toEqual({
      "a.js":
        "const f = (a) /* b */ /* c */ => d;\nuseEffect(\n  () /* b */ /* c */ => {\n    a();\n  },\n  [d],\n);\n",
      "b.vue": '<template>\n  <div :x="(a) /* b */ /* c */ => a"></div>\n</template>\n',
      "c.svelte": "<div x={(a) /* b */ /* c */ => d}></div>\n",
    });
    expect(result.exitCode).toBe(0);
    const checked = await format(files, ["--debug-check"]);
    expect(checked.stderr).toBe("");
    expect(checked.exitCode).toBe(0);
  });

  test("treats a vertical tab next to a comment as whitespace", async () => {
    const text = "function a(b\v/* c */) {}\nfunction d(/* e */\vf) {}\nconst g = /* h */\vi;\n";
    const result = await format({ "a.js": text }, [], { reads: ["a.js"] });
    expect(result.files).toEqual({ "a.js": text.replaceAll("\v", " ") });
    expect(result.exitCode).toBe(0);
  });

  test.each(["\v", "\f"])("treats %j between a comment and a type as whitespace", async space => {
    const text = `let a: /* b */${space}C;\nfunction d(e: /* f */${space}G) {}\n`;
    const result = await format({ "a.ts": text }, [], { reads: ["a.ts"] });
    expect(result.files).toEqual({ "a.ts": text.replaceAll(space, " ") });
    expect(result.exitCode).toBe(0);
  });

  // Option+Space on a Mac, and the space typed with a Chinese or Japanese input method.
  test.each(["\u00a0", "\u3000"])("treats %j next to `prettier-ignore` as whitespace", async space => {
    const files = {
      "a.ts": `//${space}prettier-ignore\nconst  a  =  1;\n/* prettier-ignore${space}*/\nconst  b  =  2;\n`,
      "b.jsx": `<a>\n  {/*${space}prettier-ignore */}\n  <b   c="d"   />\n</a>;\n`,
      "c.graphql": `#${space}prettier-ignore\ntype  A  { a:  Int }\n`,
    };
    expect(await different(files, [])).toEqual([]);
  });

  // Cases where a comment makes the other tool print a different program or invalid code. Each row is the extension,
  // the input, `bun fmt`'s output and the other tool's output.
  describe.each([
    [
      "Prettier 3.9.9 adds a `;` to a declaration in the head of a `for`",
      {},
      [
        [
          "js",
          "for (/* prettier-ignore */ const  a of b) {\n}\n",
          "for (/* prettier-ignore */ const  a of b) {\n}\n",
          "for (/* prettier-ignore */ const  a; of b) {\n}\n",
        ],
        [
          "js",
          "for (/* prettier-ignore */ const  a in b) {\n}\n",
          "for (/* prettier-ignore */ const  a in b) {\n}\n",
          "for (/* prettier-ignore */ const  a; in b) {\n}\n",
        ],
        [
          "js",
          "for (/* prettier-ignore */ var i   =   1; ; ) {\n}\n",
          "for (/* prettier-ignore */ var i   =   1; ;) {}\n",
          "for (/* prettier-ignore */ var i   =   1;; ;) {}\n",
        ],
      ],
    ],
    [
      "Prettier 3.9.9 drops the parentheses around code it prints verbatim, where only the verbatim text needs them",
      {},
      [
        [
          "js",
          "({}.a) && // prettier-ignore\n  b;\n",
          "({}.a) && // prettier-ignore\n  b;\n",
          "{}.a && // prettier-ignore\n  b;\n",
        ],
        [
          "js",
          "({} + a) /* prettier-ignore */ && b;\n",
          "({} + a) /* prettier-ignore */ && b;\n",
          "{} + a /* prettier-ignore */ && b;\n",
        ],
        [
          "js",
          "(function () {}()) && // prettier-ignore\n  b;\n",
          "(function () {}()) && // prettier-ignore\n  b;\n",
          "function () {}() && // prettier-ignore\n  b;\n",
        ],
        [
          "js",
          "x = () => ({}.a) && // prettier-ignore\n  b;\n",
          "x = () =>\n  ({}.a) && // prettier-ignore\n  b;\n",
          "x = () =>\n  {}.a && // prettier-ignore\n  b;\n",
        ],
        [
          "js",
          "for (let x = (a in b == c) && // prettier-ignore\n  d; ; );\n",
          "for (\n  let x =\n    (a in b == c) && // prettier-ignore\n    d;\n  ;\n);\n",
          "for (\n  let x =\n    a in b == c && // prettier-ignore\n    d;\n  ;\n);\n",
        ],
        [
          "js",
          "(new   A) // prettier-ignore\n  .foo();\n",
          "(new   A) // prettier-ignore\n  .foo();\n",
          "new   A // prettier-ignore\n  .foo();\n",
        ],
        [
          "ts",
          "b + (/* prettier-ignore */ a<T>) + c;\n",
          "b + /* prettier-ignore */ (a<T>) + c;\n",
          "b + /* prettier-ignore */ a<T> + c;\n",
        ],
        [
          "ts",
          "(/* prettier-ignore */ new A)!.b;\n",
          "/* prettier-ignore */ (new A)!.b;\n",
          "/* prettier-ignore */ new A!.b;\n",
        ],
        [
          "ts",
          "(/* prettier-ignore */ a<T>)<U>;\n",
          "/* prettier-ignore */ (a<T>)<U>;\n",
          "/* prettier-ignore */ a<T><U>;\n",
        ],
        [
          "ts",
          "x = b = (/* prettier-ignore */ a<T>) > c;\n",
          "x = b = /* prettier-ignore */ (a<T>) > c;\n",
          "x = b = /* prettier-ignore */ a<T> > c;\n",
        ],
        [
          "js",
          "(function(){}()) // prettier-ignore\n  .b();\n",
          "(function(){}()) // prettier-ignore\n  .b();\n",
          "function(){}() // prettier-ignore\n  .b();\n",
        ],
        [
          "js",
          "({}.a) // prettier-ignore\n  [0];\n",
          "({}.a) // prettier-ignore\n[0];\n",
          "{}.a // prettier-ignore\n[0];\n",
        ],
        [
          "ts",
          "x = (a  <T>) // prettier-ignore\n+ y;\n",
          "x =\n  (a  <T>) + // prettier-ignore\n  y;\n",
          "x =\n  a  <T> + // prettier-ignore\n  y;\n",
        ],
        [
          "js",
          "(new (A)) // prettier-ignore\n.b;\n",
          "(new (A)) // prettier-ignore\n.b;\n",
          "new (A) // prettier-ignore\n.b;\n",
        ],
        [
          "js",
          "(new (a + b)) // prettier-ignore\n(1);\n",
          "(new (a + b)) // prettier-ignore\n(1);\n",
          "new (a + b) // prettier-ignore\n(1);\n",
        ],
      ],
    ],
    [
      "oxfmt 0.72 drops the parentheses around code it prints verbatim",
      { ".oxfmtrc.json": "{}" },
      [
        [
          "js",
          "/** @type {Foo} */ (new Foo // prettier-ignore\n).bar;\n",
          "/** @type {Foo} */ (\n  new Foo // prettier-ignore\n).bar;\n",
          "/** @type {Foo} */ new Foo.bar; // prettier-ignore\n",
        ],
        [
          "js",
          "const x = (a  +  b // prettier-ignore\n)(1);\n",
          "const x = (a  +  b) // prettier-ignore\n(1);\n",
          "const x = a  +  b // prettier-ignore\n(1);\n",
        ],
        [
          "js",
          "const x = (a  =  b // prettier-ignore\n) ? c : d;\n",
          "const x = (a  =  b) // prettier-ignore\n  ? c\n  : d;\n",
          "const x = a  =  b // prettier-ignore\n  ? c\n  : d;\n",
        ],
        [
          "js",
          "const x = a ? (b  ,  c // prettier-ignore\n) : d;\n",
          "const x = a\n  ? (b  ,  c) // prettier-ignore\n  : d;\n",
          "const x = a\n  ? b  ,  c // prettier-ignore\n  : d;\n",
        ],
        [
          "js",
          "const x = a ? b : (c  ,  d // prettier-ignore\n);\n",
          "const x = a ? b : (c  ,  d); // prettier-ignore\n",
          "const x = a ? b : c  ,  d; // prettier-ignore\n",
        ],
        [
          "js",
          "class A extends (a  +  b // prettier-ignore\n) {}\n",
          "class A extends (a  +  b) // prettier-ignore\n{}\n",
          "class A extends a  +  b // prettier-ignore\n{}\n",
        ],
        [
          "js",
          "const x = (()  =>  {} // prettier-ignore\n)();\n",
          "const x = (()  =>  {}) // prettier-ignore\n();\n",
          "const x = ()  =>  {} // prettier-ignore\n();\n",
        ],
        [
          "ts",
          "const x = (a  +  b /* prettier-ignore */\n) as T;\n",
          "const x = (a  +  b) as /* prettier-ignore */ T;\n",
          "const x = a  +  b as /* prettier-ignore */ T;\n",
        ],
        [
          "ts",
          "const x = (y  as  T // prettier-ignore\n)(1);\n",
          "const x = (y  as  T) // prettier-ignore\n(1);\n",
          "const x = y  as  T // prettier-ignore\n(1);\n",
        ],
        [
          "ts",
          "type A = B extends (C  extends D ? E : F // prettier-ignore\n) ? G : H;\n",
          "type A = B extends (C  extends D ? E : F) // prettier-ignore\n  ? G\n  : H;\n",
          "type A = B extends C  extends D ? E : F // prettier-ignore\n  ? G\n  : H;\n",
        ],
        [
          "js",
          "try {} catch (/* prettier-ignore */ e) {}\n",
          "try {\n} catch (/* prettier-ignore */ e) {}\n",
          "try {\n} catch /* prettier-ignore */ e {}\n",
        ],
        [
          "js",
          "try {\n} catch (\n  // prettier-ignore\n  { a,   b }\n) {}\n",
          "try {\n} catch (\n  // prettier-ignore\n  { a,   b }\n) {}\n",
          "try {\n} catch // prettier-ignore\n{ a,   b } {}\n",
        ],
      ],
    ],
    [
      "Prettier 3.9.9 moves a multi-line comment before the `[]` of an array type, where a line break ends the type",
      {},
      [
        ["ts", "type A = B[ /* a\n b */ ];\n", "type A = B[] /* a\n b */;\n", "type A = B /* a\n b */[];\n"],
        [
          "ts",
          "let a: B[ /* a\n b */ ] | null;\n",
          "let a:\n  | B[] /* a\n b */\n  | null;\n",
          "let a:\n  | B /* a\n b */[]\n  | null;\n",
        ],
      ],
    ],
    [
      "oxfmt 0.72 moves a multi-line comment before the `[]` of an array type, where a line break ends the type",
      { ".oxfmtrc.json": "{}" },
      [
        [
          "ts",
          "let a: B[ /* a\n b */ ] | null;\n",
          "let a:\n  | B[] /* a\n b */\n  | null;\n",
          "let a:\n  | B /* a\n b */[]\n  | null;\n",
        ],
      ],
    ],
    [
      "oxfmt 0.72 writes the `]` of an array after a line comment that follows a hole",
      { ".oxfmtrc.json": "{}" },
      [
        ["js", "x = [a,\n// c\n,];\n", "x = [\n  a,\n  ,// c\n];\n", "x = [a, ,// c];\n"],
        [
          "js",
          "const z = [a, , b, \n// c\n,];\n",
          "const z = [\n  a,\n  ,\n  b,\n  ,// c\n];\n",
          "const z = [a, , b, ,// c];\n",
        ],
      ],
    ],
    [
      "Prettier 3.9.9 writes the `}` of a substitution in a template type after a line comment",
      {},
      [["ts", "type A = `${B}-${ // c\nC}`;\n", "type A = `${\n  B // c\n}-${C}`;\n", "type A = `${B // c}-${C}`;\n"]],
    ],
    [
      "Prettier 3.9.9 writes an anonymous class's `implements` list after a line comment",
      {},
      [
        [
          "ts",
          "x = class // c\nimplements A {};\n",
          "x = class // c\nimplements A {};\n",
          "x = class implements // cA {};\n",
        ],
        [
          "ts",
          "export default class\n// a\n// b\nimplements A {}\n",
          "export default class // a\n// b\nimplements A {}\n",
          "export default class implements // a\n// bA {}\n",
        ],
      ],
    ],
  ])("%s", (_, config, rows) => {
    test("`bun fmt` doesn't", async () => {
      const names = rows.map(([extension], index) => `${index}.${extension}`);
      const texts = Object.fromEntries(rows.map(([, text], index) => [names[index], text]));
      const result = await format({ ...config, ...texts }, [], { reads: names });
      expect(result.files).toEqual(Object.fromEntries(rows.map(([, , printed], index) => [names[index], printed])));
      expect(result.exitCode).toBe(0);
    });
  });

  // An object type that doesn't fit breaks, and one that's broken in the source stays broken. Prettier 3.9.9 and oxfmt
  // 0.72 put a function's only parameter on its own line unless the return type is already broken in the source, so
  // they print
  //
  //   m(
  //     a: string,
  //   ): {
  //
  // the first time and `m(a: string): {` from then on. `bun fmt` prints the latter right away.
  describe("a function's only parameter before a return type that contains an object type", () => {
    const members = ["aaaaaaaaaaaaaaa: number", "bbbbbbbbbbbbbbbb: number", "cccccccccccccccccc: number"];
    // An object type that doesn't fit on one line, as written and as printed.
    const flat = `{ ${members.join(", ")} }`;
    const broken = (indent = "", end = ";") => `{\n${members.map(it => `${indent}  ${it}${end}\n`).join("")}${indent}}`;
    const flavors = [
      ["Prettier", {}],
      ["oxfmt", { ".oxfmtrc.json": `{ "printWidth": 80 }` }],
    ] as const;
    type Row = [extension: string, text: string, printed: string, flavor?: "Prettier"];

    /** Formats the texts, then formats the output again. oxfmt doesn't support Flow. */
    async function printedTwice(flavor: string, config: Record<string, string>, all: Row[]) {
      const rows = all.filter(row => flavor === "Prettier" || (row[0] !== "js" && row[3] === undefined));
      const names = rows.map(([extension], index) => `${index}.${extension}`);
      const texts = Object.fromEntries(rows.map(([, text], index) => [names[index], text]));
      const first = await format({ ...config, ...texts }, [], { reads: names });
      const second = await format({ ...config, ...(first.files as Record<string, string>) }, [], { reads: names });
      const expected = Object.fromEntries(rows.map(([, , printed], index) => [names[index], printed]));
      return { first: first.files, second: second.files, expected };
    }

    // What both tools print on their second pass.
    const sameLine: Row[] = [
      [
        "ts",
        `class A {\n  m(\n    a: string,\n  ): ${flat} | null {}\n}\n`,
        `class A {\n  m(a: string): ${broken("  ")} | null {}\n}\n`,
      ],
      ["ts", `class A {\n  m(a: string): B<${flat}> {}\n}\n`, `class A {\n  m(a: string): B<${broken("  ")}> {}\n}\n`],
      [
        "ts",
        `abstract class A {\n  abstract m(a: string): B<${flat}>;\n}\n`,
        `abstract class A {\n  abstract m(a: string): B<${broken("  ")}>;\n}\n`,
      ],
      ["ts", `function f(a: string): ${flat} | null {}\n`, `function f(a: string): ${broken()} | null {}\n`],
      ["ts", `function f(a: string): B<${flat}> {}\n`, `function f(a: string): B<${broken()}> {}\n`],
      ["ts", `function f<T>(a: string): B<${flat}> {}\n`, `function f<T>(a: string): B<${broken()}> {}\n`],
      ["ts", `declare function f(a: string): B<${flat}>;\n`, `declare function f(a: string): B<${broken()}>;\n`],
      [
        "ts",
        `const f = function (a: string): B<${flat}> {};\n`,
        `const f = function (a: string): B<${broken()}> {};\n`,
      ],
      ["ts", `f(function (a: string): B<${flat}> {});\n`, `f(function (a: string): B<${broken()}> {});\n`],
      [
        "ts",
        `const o = {\n  m(a: string): B<${flat}> {},\n};\n`,
        `const o = {\n  m(a: string): B<${broken("  ")}> {},\n};\n`,
      ],
      [
        "ts",
        `interface I {\n  m(a: string): B<${flat}>;\n}\n`,
        `interface I {\n  m(a: string): B<${broken("  ")}>;\n}\n`,
      ],
      [
        "ts",
        `interface I {\n  (a: string): B<${flat}>;\n}\n`,
        `interface I {\n  (a: string): B<${broken("  ")}>;\n}\n`,
      ],
      [
        "ts",
        `interface I {\n  new (a: string): B<${flat}>;\n}\n`,
        `interface I {\n  new (a: string): B<${broken("  ")}>;\n}\n`,
      ],
      ["ts", `type F = (a: string) => ${flat} | null;\n`, `type F = (a: string) => ${broken()} | null;\n`],
      ["ts", `type F = (a: string) => B<${flat}>;\n`, `type F = (a: string) => B<${broken()}>;\n`],
      ["ts", `type F = new (a: string) => B<${flat}>;\n`, `type F = new (a: string) => B<${broken()}>;\n`],
      ["ts", `type F = { m(a: string): B<${flat}> };\n`, `type F = {\n  m(a: string): B<${broken("  ")}>;\n};\n`],
      // For any kind of parameter.
      ["ts", `function f(this: A): B<${flat}> {}\n`, `function f(this: A): B<${broken()}> {}\n`],
      ["ts", `function f(...a: string[]): B<${flat}> {}\n`, `function f(...a: string[]): B<${broken()}> {}\n`],
      ["ts", `function f({ a, b }: A): B<${flat}> {}\n`, `function f({ a, b }: A): B<${broken()}> {}\n`],
      ["ts", `function f(a: { b: 1 }): B<${flat}> {}\n`, `function f(a: { b: 1 }): B<${broken()}> {}\n`],
      // Wherever the object type appears.
      ["ts", `function f(a: string): A & ${flat} {}\n`, `function f(a: string): A & ${broken()} {}\n`],
      ["ts", `function f(a: string): ${flat}[] {}\n`, `function f(a: string): ${broken()}[] {}\n`],
      ["ts", `function f(a: string): a is ${flat} {}\n`, `function f(a: string): a is ${broken()} {}\n`],
      [
        "ts",
        `function f(a: string): (b: number) => ${flat} {}\n`,
        `function f(a: string): (b: number) => ${broken()} {}\n`,
      ],
      ["ts", `function f(a: string): B<C, ${flat}> {}\n`, `function f(a: string): B<\n  C,\n  ${broken("  ")}\n> {}\n`],
      ["ts", `function f(a: string): [C, ${flat}] {}\n`, `function f(a: string): [\n  C,\n  ${broken("  ")},\n] {}\n`],
      [
        "ts",
        `function f(a: string): C | D | ${flat} {}\n`,
        `function f(a: string):\n  | C\n  | D\n  | ${broken("    ")} {}\n`,
      ],
      // The object type that didn't fit after the `)` stays broken, even though it fits where it is now.
      [
        "ts",
        `function fffffffffffffffffffff(a: string): (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: number) => { ccccccccccccc: 1; ddddddddddddd: 2 } {}\n`,
        `function fffffffffffffffffffff(a: string): (\n  bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: number,\n) => {\n  ccccccccccccc: 1;\n  ddddddddddddd: 2;\n} {}\n`,
      ],
      // A mapped type and the options of an import type stay broken too.
      [
        "ts",
        `function f(a: string): B<{ [Kkkkkkkkkkkkkkkkkkkkkkkkk in Tttttttttttttttttttttt]: Vvvvvvvvvvvvvvvvv }> {}\n`,
        `function f(a: string): B<{\n  [Kkkkkkkkkkkkkkkkkkkkkkkkk in Tttttttttttttttttttttt]: Vvvvvvvvvvvvvvvvv;\n}> {}\n`,
      ],
      [
        "ts",
        `function f(a: string): B<typeof import("./aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { with: { type: "json" } })> {}\n`,
        `function f(a: string): B<\n  typeof import("./aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {\n    with: { type: "json" },\n  })\n> {}\n`,
        "Prettier",
      ],
      [
        "js",
        `// @flow\nclass A {\n  m(a: string): ${flat} | null {}\n}\n`,
        `// @flow\nclass A {\n  m(a: string): ${broken("  ", ",")} | null {}\n}\n`,
      ],
      [
        "js",
        `// @flow\nfunction f(a: string): B<${flat}> {}\n`,
        `// @flow\nfunction f(a: string): B<${broken("", ",")}> {}\n`,
      ],
      [
        "js",
        `// @flow\nfunction f(a: string): ?${flat} {}\n`,
        `// @flow\nfunction f(a: string): ?${broken("", ",")} {}\n`,
      ],
      [
        "js",
        `// @flow\nfunction f(a: string): B<{| ${members.join(", ")} |}> {}\n`,
        `// @flow\nfunction f(a: string): B<{|${broken("", ",").slice(1, -1)}|}> {}\n`,
      ],
      [
        "js",
        `// @flow\ntype F = (a: string) => B<${flat}>;\n`,
        `// @flow\ntype F = (a: string) => B<${broken("", ",")}>;\n`,
      ],
      [
        "js",
        `// @flow\ndeclare function f(a: string): B<${flat}>;\n`,
        `// @flow\ndeclare function f(a: string): B<${broken("", ",")}>;\n`,
      ],
      [
        "js",
        `// @flow\ndeclare class A {\n  m(a: string): B<${flat}>;\n}\n`,
        `// @flow\ndeclare class A {\n  m(a: string): B<${broken("  ", ",")}>;\n}\n`,
      ],
    ];
    test.each(flavors)("stays on the function's line if the object type breaks: %s", async (flavor, config) => {
      const { first, second, expected } = await printedTwice(flavor, config, sameLine);
      expect(first).toEqual(expected);
      expect(second).toEqual(expected);
    });

    // What both tools print on every pass.
    const ownLine: Row[] = [
      // The object type fits once the parameter is on its own line.
      [
        "ts",
        `function ffffffffffffffffffffffffffffff(aaaaaaaaaaaaaaaaaaaaaaaaaaaa: string): Promise<{ a: number; b: string }> {}\n`,
        `function ffffffffffffffffffffffffffffff(\n  aaaaaaaaaaaaaaaaaaaaaaaaaaaa: string,\n): Promise<{ a: number; b: string }> {}\n`,
      ],
      // The return type breaks, but no object type in it does.
      [
        "ts",
        `function f(a: string): Bbbbbbbbbbbbbbbbbbbb<Array<{ id: string; name: string; other: string }>, C<{ message: string }>> {}\n`,
        `function f(\n  a: string,\n): Bbbbbbbbbbbbbbbbbbbb<\n  Array<{ id: string; name: string; other: string }>,\n  C<{ message: string }>\n> {}\n`,
      ],
      // These parameters break together with the return type, however it's written.
      [
        "ts",
        `function f(a: string, b: number): B<${flat}> {}\n`,
        `function f(\n  a: string,\n  b: number,\n): B<${broken()}> {}\n`,
      ],
      ["ts", `function f(): B<${flat}> {}\n`, `function f(): B<${broken()}> {}\n`],
      [
        "ts",
        `function f<T extends A>(a: string): B<${flat}> {}\n`,
        `function f<T extends A>(\n  a: string,\n): B<${broken()}> {}\n`,
      ],
      ["ts", `const f = (a: string): B<${flat}> => null;\n`, `const f = (\n  a: string,\n): B<${broken()}> => null;\n`],
      [
        "ts",
        `const f = (a: string): ${flat} | null => null;\n`,
        `const f = (\n  a: string,\n): ${broken()} | null => null;\n`,
      ],
      [
        "js",
        `// @flow\nconst f = (a: string): B<${flat}> => null;\n`,
        `// @flow\nconst f = (\n  a: string,\n): B<${broken("", ",")}> => null;\n`,
      ],
    ];
    test.each(flavors)("gets its own line otherwise: %s", async (flavor, config) => {
      const { first, second, expected } = await printedTwice(flavor, config, ownLine);
      expect(first).toEqual(expected);
      expect(second).toEqual(expected);
    });

    test("nested function types take linear time", async () => {
      const times = (text: string, count: number) => Buffer.alloc(text.length * Math.floor(count), text).toString();
      const nested = `type F = ${times("(a: A) => ", isDebug || isASAN ? 1_000 : 4_000)}${flat};\n`;
      const ordinary = "type F = (a: A) => B;\n";
      const run = (text: string) => format({ "a.ts": text }, ["--check"]);
      const [odd, plain] = [await run(nested), await run(times(ordinary, nested.length / ordinary.length))];
      expect(slowdown(odd, plain)).toBeLessThan(8);
    });
  });

  test("copies a comment inside code under `prettier-ignore` once, along with the code", async () => {
    const text = "x = <a {\n  // prettier-ignore\n  ...b\n  // c1\n  .c} />;\n";
    const result = await format({ "a.jsx": text }, [], { reads: ["a.jsx"] });
    expect(result.files).toEqual({
      "a.jsx": "x = (\n  <a\n    {\n      // prettier-ignore\n      ...b\n  // c1\n  .c\n    }\n  />\n);\n",
    });
    expect(result.exitCode).toBe(0);
  });

  test("prints a `prettier-ignore` comment before an empty body", async () => {
    // Prettier 3.9.9 moves the comment into the body, copies the body, and throws: 'Comment "prettier-ignore" was not printed.'
    const rows = [
      ["class A // prettier-ignore\n{  }\n", "class A // prettier-ignore\n{  }\n"],
      ["class A extends (a  +  b) // prettier-ignore\n{  }\n", "class A extends (a + b) // prettier-ignore\n{  }\n"],
      [
        "class A extends (a  +  b /* prettier-ignore */\n) {  }\n",
        "class A extends (a + b) /* prettier-ignore */\n{  }\n",
      ],
      ["x = (function  () // prettier-ignore\n{  })();\n", "x = (function () // prettier-ignore\n{  })();\n"],
    ];
    const names = rows.map((_, index) => `${index}.js`);
    const texts = Object.fromEntries(rows.map(([text], index) => [names[index], text]));
    const result = await format(texts, [], { reads: names });
    expect(result.files).toEqual(Object.fromEntries(rows.map(([, printed], index) => [names[index], printed])));
    expect(result.exitCode).toBe(0);
  });

  test("writes a comment that no printer handles after its statement", async () => {
    // The file used to be rejected with "The formatter failed". Once a printer handles this input's `/* a */`, which
    // would be the right fix, switch to another input that `bun fmt --debug-unprinted-comments <directory> <file>`
    // prints a line for.
    const text = "type N = keyof ( /* a */ B | C /* prettier-ignore */ );\ne;\n";
    const result = await format({ "a.ts": text }, [], { reads: ["a.ts"] });
    expect(result.files["a.ts"]).toBe("type N = keyof (B | C) /* prettier-ignore */; /* a */\ne;\n");
    expect(result.exitCode).toBe(0);
  });

  test("keeps a comment before the `:` in a Flow object type in place with an oxfmt config", async () => {
    // oxfmt doesn't support Flow, so this is Prettier's output.
    const files = { ".oxfmtrc.json": "{}", "a.js": "// @flow\ntype A = { a /* comment */ : B };\n" };
    const result = await format(files, ["--parser", "flow", "a.js"], { reads: ["a.js"] });
    expect(result.files["a.js"]).toBe("// @flow\ntype A = { a /* comment */: B };\n");
    expect(result.exitCode).toBe(0);
  });

  test("formats `<!--` and `-->` comments in a script", async () => {
    // This is oxfmt 0.72's output unless noted otherwise. Prettier 3.9.9 can't parse these files.
    const rows = [
      ["<!-- prettier-ignore\na(  b  );\nc(  d  );\n", "<!-- prettier-ignore\na(  b  );\nc(d);\n"],
      ["a;\n--> prettier-ignore\nb(  c  );\nd(  e  );\n", "a;\n--> prettier-ignore\nb(  c  );\nd(e);\n"],
      ["<!-- a comment\na(  b  );\n", "<!-- a comment\na(b);\n"],
      // `-->` only starts a comment at the start of a line. oxfmt prints `var --> c`, which doesn't parse, and
      // `x = a--> c`, which means `x = a-- > c.b.c()`.
      ["var\n--> c\na = b;\n", "var\n  --> c\n  a = b;\n"],
      ["x = a\n--> c\n.b.c();\n", "x = a\n--> c\n.b\n  .c();\n"],
    ];
    const names = rows.map((_, index) => `${index}.js`);
    const texts = Object.fromEntries(rows.map(([text], index) => [names[index], text]));
    const printed = Object.fromEntries(rows.map(([, printed], index) => [names[index], printed]));
    for (const configuration of [{}, { ".oxfmtrc.json": "{}" }]) {
      const result = await format({ ...configuration, ...texts }, [], { reads: names });
      expect(result.files).toEqual(printed);
      expect(result.exitCode).toBe(0);
    }
  });

  test("doesn't write a comment deferred to the end of the line into the middle of the next comment", async () => {
    // Prettier 3.9.9 prints `a; /**⏎// b⏎ * c⏎ */`, and with `/* b */` on its own line its output doesn't parse.
    const rows = [
      ["a // b\n; /**\n * c\n */\n", "a; // b\n/**\n * c\n */\n"],
      ["a\n/* b */\n; /**\n * c\n */\n", "a;\n/* b */ /**\n * c\n */\n"],
      // Prettier: `import a from /** // b⏎ * c⏎ */ "d";`
      ['import a // b\n/**\n * c\n */ from "d";\n', 'import a from  // b\n/**\n * c\n */ "d";\n'],
    ];
    const names = rows.map((_, index) => `${index}.js`);
    const texts = Object.fromEntries(rows.map(([text], index) => [names[index], text]));
    const result = await format(texts, [], { reads: names });
    expect(result.files).toEqual(Object.fromEntries(rows.map(([, printed], index) => [names[index], printed])));
    expect(result.exitCode).toBe(0);
    // Nor into a comment that the `jsdoc` option rewrites.
    const text = 'import a // b\n/**\n * @returns   {U}   it\n * @param   {T}   x   text\n */ from "d";\n';
    const withOption = await format({ "a.js": text }, ["--jsdoc"], { reads: ["a.js"] });
    expect(withOption.files["a.js"]).toBe(
      'import a from  // b\n/**\n * @param {T} x Text\n * @returns {U} It\n */ "d";\n',
    );
    expect(withOption.exitCode).toBe(0);
  });

  test("leaves a Vue binding that's only a comment unchanged", async () => {
    // oxfmt 0.72 prints `v-slot=""` and `v-for=" in xs"`.
    const text =
      '<template>\n  <a   v-slot="/* a */"   b="c" />\n  <a   v-for="(/* d */) in xs"   b="c" />\n</template>\n';
    const result = await format({ ".oxfmtrc.json": "{}", "a.vue": text }, [], { reads: ["a.vue"] });
    expect(result.files).toEqual({
      "a.vue": '<template>\n  <a v-slot="/* a */" b="c" />\n  <a v-for="(/* d */) in xs" b="c" />\n</template>\n',
    });
    expect(result.exitCode).toBe(0);
  });

  test("formats Handlebars", async () => {
    const result = await format({ "a.hbs": '<div   class="a  b">{{foo   bar}}</div>\n', "b.handlebars": "{{a}}" }, [], {
      reads: ["a.hbs", "b.handlebars"],
    });
    expect(result.files).toEqual({ "a.hbs": '<div class="a b">{{foo bar}}</div>', "b.handlebars": "{{a}}" });
    expect(result.stdout).toBe("a.hbs");
    expect(result.exitCode).toBe(0);
  });

  // Prettier 3.9.9 drops the parentheses. The line break after the comment then ends the `yield`, so it yields nothing.
  test.each([
    ["a line comment", "yield (\n    // a\n    1\n  );"],
    ["a block comment on its own line", "yield (\n    /* a */\n    1\n  );"],
    ["a block comment that spans lines", "yield (\n    /* a\n     */ 1\n  );"],
    ["an assignment", "const x = yield (\n    // a\n    1\n  );"],
    ["a call argument", "f(\n    yield (\n      // a\n      1\n    ),\n  );"],
    ["a function expression", "yield (\n    // a\n    function () {}\n  );"],
  ])("keeps the parentheses around a yielded value that follows a comment: %s", async (_, body) => {
    const code = `function* g() {\n  ${body}\n}\n`;
    const result = await formatChecked({ "a.js": code }, [], { reads: ["a.js"] });
    expect(result).toMatchObject({ stderr: "", files: { "a.js": code }, exitCode: 0 });
  });

  test("a comment after `yield` doesn't add parentheses where a line break is harmless", async () => {
    const files = {
      "same-line.js": "function* g() {\n  yield /* a */ 1;\n}\n",
      "delegate.js": "function* g() {\n  yield* // a\n  h();\n}\n",
      "two-statements.js": "function* g() {\n  yield; // a\n  1;\n}\n",
      "member-chain.js": "function* a() {\n  yield task\n    // No extra parens\n    .run();\n}\n",
    };
    const result = await formatChecked(files, [], { reads: Object.keys(files) });
    expect(result).toMatchObject({ stderr: "", files, exitCode: 0 });
  });

  // Prettier 3.9.9 prints `yield // comment⏎(a as any).b;`, and so on, which yields nothing.
  test("keeps `yield` and its value together when the leftmost operand follows a comment", async () => {
    // What follows `yield (⏎// comment⏎a as any⏎)`, and what's printed after the comment.
    const shapes = [
      ["", "a as any"],
      [" + 1", "(a as any) + 1"],
      [" ? 0 : 1", "(a as any)\n      ? 0\n      : 1"],
      [".b", "(a as any).b"],
      ["[a]", "(a as any)[a]"],
      ["()", "(a as any)()"],
      ["``", "(a as any)``"],
      [" as any", "a as any as any"],
      [" satisfies any", "a as any satisfies any"],
      ["!", "(a as any)!"],
    ];
    const code = shapes.map(
      ([rest], i) => `function* t${i}() {\n  yield (\n    // comment\n    a as any\n  )${rest};\n}\n`,
    );
    const printed = shapes.map(
      ([, value], i) => `function* t${i}() {\n  yield (\n    // comment\n    ${value}\n  );\n}\n`,
    );
    const result = await formatChecked({ "a.ts": code.join("") }, [], { reads: ["a.ts"] });
    expect(result).toMatchObject({ stderr: "", files: { "a.ts": printed.join("") }, exitCode: 0 });
  });

  // Prettier 3.9.9 drops the parentheses around `a` and adds none. The line break in the comment then ends the `return` or
  // the `yield`, and after `throw` it's a syntax error.
  describe.each(["return", "throw", "yield"])(
    "a comment that spans lines at the start of the value after `%s`",
    keyword => {
      const inFunction = (body: string) => `function${keyword === "yield" ? "*" : ""} f() {\n  ${body}\n}\n`;

      test.each(["prettier", "oxfmt"])("gets parentheses around it and the value: %s", async flavor => {
        // What follows `(/* two⏎lines */ `, and what's printed after the comment.
        const shapes: Record<string, [source: string, printed: string]> = {
          "member.js": ["a).b", "a.b"],
          "index.js": ["a)[0]", "a[0]"],
          "call.js": ["a)()", "a()"],
          "optional-member.js": ["a)?.b", "a?.b"],
          "member-chain.js": ["a).b.c.d()", "a.b.c.d()"],
          "member-of-a-call.js": ["a()).b", "a().b"],
          "tagged-template.js": ["a)`x`", "a`x`"],
          "postfix.js": ["a)++", "a++"],
          "conditional.js": ["a) ? b : c", "a\n      ? b\n      : c"],
          "as.ts": ["a) as any", "a as any"],
          "satisfies.ts": ["a) satisfies B", "a satisfies B"],
          "non-null.ts": ["a)!", "a!"],
          "non-null-member.ts": ["a)!.b", "a!.b"],
          "type-arguments.ts": ["a)<T>", "a<T>"],
        };
        const names = Object.keys(shapes);
        const files = Object.fromEntries(
          names.map(name => [name, inFunction(`${keyword} (/* two\n     lines */ ${shapes[name][0]};`)]),
        );
        const printed = Object.fromEntries(
          names.map(name => [name, inFunction(`${keyword} (\n    /* two\n     lines */ ${shapes[name][1]}\n  );`)]),
        );
        const result = await formatChecked(files, [`--flavor=${flavor}`], { reads: names });
        expect(result).toMatchObject({ stderr: "", files: printed, exitCode: 0 });
      });

      test("doesn't get its own parentheses where something else is printed first", async () => {
        const shapes: Record<string, [source: string, printed: string]> = {
          "assignment.js": ["(/* two\n     lines */ a) = b;", "(/* two\n     lines */ a = b);"],
          "assignment-in-parentheses.js": ["((/* two\n     lines */ a) = b).c;", "(/* two\n     lines */ a = b).c;"],
          "new.js": ["new (/* two\n     lines */ a)();", "new /* two\n     lines */ a();"],
        };
        const names = Object.keys(shapes);
        const files = Object.fromEntries(names.map(name => [name, inFunction(`${keyword} ${shapes[name][0]}`)]));
        const printed = Object.fromEntries(names.map(name => [name, inFunction(`${keyword} ${shapes[name][1]}`)]));
        const result = await formatChecked(files, [], { reads: names });
        expect(result).toMatchObject({ stderr: "", files: printed, exitCode: 0 });
      });
    },
  );

  test("a comment at the start of a returned value is unchanged in the cases that were already correct", async () => {
    const shapes: Record<string, [source: string, printed: string]> = {
      "one-line.js": ["return (/* one line */ a).b;", "return /* one line */ a.b;"],
      "whole-value.js": ["return (/* two\n     lines */ a.b);", "return (\n    /* two\n     lines */ a.b\n  );"],
      "binary.js": ["return (/* two\n     lines */ a) + b;", "return (\n    /* two\n     lines */ a + b\n  );"],
      "line-comment.js": ["return (\n    // line\n    a).b;", "return (\n    // line\n    a.b\n  );"],
    };
    const names = Object.keys(shapes);
    const files = Object.fromEntries(names.map(name => [name, `function f() {\n  ${shapes[name][0]}\n}\n`]));
    const printed = Object.fromEntries(names.map(name => [name, `function f() {\n  ${shapes[name][1]}\n}\n`]));
    const result = await formatChecked(files, [], { reads: names });
    expect(result).toMatchObject({ stderr: "", files: printed, exitCode: 0 });
  });

  // Prettier 3.9.9 and oxfmt 0.72.0 print `static async // why⏎m() {}`. No line break is allowed after `async`, so that's a
  // static field named `async` and a plain method `m`. The same goes for `accessor` and `readonly`.
  test.each(["prettier", "oxfmt"])(
    "moves a comment between two modifiers of a class member in front of them: %s",
    async flavor => {
      const members: Record<string, [source: string, printed: string]> = {
        "line-comment.js": ["static // why\n  async m() {}", "// why\n  static async m() {}"],
        "own-line.js": ["static\n  // why\n  async m() {}", "// why\n  static async m() {}"],
        "spans-lines.js": ["static /* why\n  so */ async m() {}", "/* why\n  so */ static async m() {}"],
        "private-name.js": ["static // why\n  async #m() {}", "// why\n  static async #m() {}"],
        "accessor.js": ["static // why\n  accessor x = 1;", "// why\n  static accessor x = 1;"],
        "accessor.ts": ["static // why\n  accessor x = 1;", "// why\n  static accessor x = 1;"],
        "public.ts": ["public static // why\n  async m() {}", "// why\n  public static async m() {}"],
        "override.ts": ["static // why\n  override async m() {}", "// why\n  static override async m() {}"],
        "readonly.ts": ["static // why\n  readonly x = 1;", "// why\n  static readonly x = 1;"],
      };
      const names = Object.keys(members);
      const files = Object.fromEntries(names.map(name => [name, `class A {\n  ${members[name][0]}\n}\n`]));
      const printed = Object.fromEntries(names.map(name => [name, `class A {\n  ${members[name][1]}\n}\n`]));
      const result = await formatChecked(files, [`--flavor=${flavor}`], { reads: names });
      expect(result).toMatchObject({ stderr: "", files: printed, exitCode: 0 });
    },
  );

  test("a comment between two modifiers of a class member stays where its line break is harmless", async () => {
    const members: Record<string, [source: string, printed: string]> = {
      "one-line.js": ["static /* why */ async m() {}", "static async /* why */ m() {}"],
      "method.js": ["static // why\n  m() {}", "static // why\n  m() {}"],
      "field.js": ["static // why\n  x = 1;", "static // why\n  x = 1;"],
      "getter.js": ["static // why\n  get m() {}", "static get // why\n  m() {}"],
      "declare.ts": ["static // why\n  declare x: number;", "declare static // why\n  x: number;"],
      "decorator.ts": ["@dec static // why\n  async m() {}", "@dec // why\n  static async m() {}"],
    };
    const names = Object.keys(members);
    const files = Object.fromEntries(names.map(name => [name, `class A {\n  ${members[name][0]}\n}\n`]));
    const printed = Object.fromEntries(names.map(name => [name, `class A {\n  ${members[name][1]}\n}\n`]));
    const result = await formatChecked(files, [], { reads: names });
    expect(result).toMatchObject({ stderr: "", files: printed, exitCode: 0 });
  });

  // Prettier 3.9.9 writes no `;` there, because `x` needs no parentheses. But the statement is copied with the ones it has, so
  // `const a = b⏎(x).bar()` calls `b`.
  test.each(["prettier", "oxfmt"])(
    "--no-semi guards an ignored statement that starts with a parenthesis it doesn't need: %s",
    async flavor => {
      const statements: Record<string, string> = {
        "member.js": "(x).bar()",
        "call.js": "(x)()",
        "twice.js": "((x)).bar()",
        "logical.js": "(x)   &&   y()",
        "conditional.js": "(x) ? y() : z()",
        "binary.js": "(a * b) + c",
        "assignment.js": "(x.y) = 1",
        "name.js": "(x)",
        "non-null.ts": "(x)!.y()",
      };
      const names = Object.keys(statements);
      const files = Object.fromEntries(
        names.map(name => [name, `const a = b;\n// prettier-ignore\n${statements[name]};\n`]),
      );
      const printed = Object.fromEntries(
        names.map(name => [name, `const a = b\n// prettier-ignore\n;${statements[name]}\n`]),
      );
      const result = await formatChecked(files, ["--no-semi", `--flavor=${flavor}`], { reads: names });
      expect(result).toMatchObject({ stderr: "", files: printed, exitCode: 0 });
    },
  );

  test.each(["prettier", "oxfmt"])("--no-semi doesn't guard any other ignored statement: %s", async flavor => {
    const files = {
      "name.js": "const a = b\n// prettier-ignore\nx  .bar()\n",
      "array.js": "const a = b\n// prettier-ignore\n;[1,  2].forEach(f)\n",
      "needed.js": "const a = b\n// prettier-ignore\n;(x  || y).bar()\n",
      "increment.js": "const a = b\n// prettier-ignore\n++x\n",
      // A `;` here would become the whole body of the `if` or the loop.
      "if.js": "if (a)\n  // prettier-ignore\n  (x)  .bar()\nelse\n  // prettier-ignore\n  (y)  .bar()\n",
      "for.js": "for (;;)\n  // prettier-ignore\n  (x)  .bar()\n",
      "for-same-line.js": "for (;;) /* prettier-ignore */ (x)  .bar()\n",
      "for-in.js": "for (a in b)\n  // prettier-ignore\n  (x)  .bar()\n",
      "for-of.js": "for (a of b)\n  // prettier-ignore\n  (x)  .bar()\n",
      "while.js": "while (a)\n  // prettier-ignore\n  (x)  .bar()\n",
      "do.js": "do\n  // prettier-ignore\n  (x)  .bar()\nwhile (a)\n",
      "with.js": "with (a)\n  // prettier-ignore\n  (x)  .bar()\n",
      // In oxfmt 0.72.0 a comment after a label doesn't apply to anything.
      "label.js":
        flavor === "oxfmt" ? "l:\n// prettier-ignore\nx.bar()\n" : "l:\n  // prettier-ignore\n  (x)  .bar()\n",
    };
    const result = await formatChecked(files, ["--no-semi", `--flavor=${flavor}`], { reads: Object.keys(files) });
    expect(result).toMatchObject({ stderr: "", files, exitCode: 0 });
  });

  describe("a Handlebars template whose meaning Prettier changes", () => {
    // Each entry is the template, Bun's output and Prettier 3.9.9's output, which means something else or no longer
    // parses. Where no other output is clearly right, the smallest part around the problem is left as written.
    const templates: Record<string, [before: string, after: string, byPrettier: string]> = {
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
    // These look similar, but Handlebars reads Prettier's output the same way as the template.
    const harmless: Record<string, [before: string, after: string]> = {
      "inverted-block": ["{{^a   }}b{{else}}c{{/a}}\n", "{{#a}}c{{else}}b{{/a}}"],
      "block-parameter-in-brackets": ["{{#a   as |[b] c|}}{{/a}}\n", "{{#a as |[b] c|}}{{/a}}"],
      "backslash-at-the-end-of-a-string": ['{{a   "b\\"}}\n', '{{a "b\\"}}'],
      "line-separator-behind-a-line-break": ["a\n\u2028{{b   }}\n", "a \u2028{{b}}"],
    };
    const all = Object.entries({ ...templates, ...harmless });
    const files = Object.fromEntries(all.map(([name, it]) => [`${name}.hbs`, it[0]]));
    const written = Object.fromEntries(all.map(([name, it]) => [`${name}.hbs`, it[1]]));

    test("keeps its meaning", async () => {
      for (const [, after, byPrettier] of Object.values(templates)) expect(after).not.toBe(byPrettier);
      const result = await format(files, [], { reads: Object.keys(files) });
      expect(result.files).toEqual(written);
      expect(result.exitCode).toBe(0);
    });

    test.each([
      ["no config", {}],
      [".prettierrc", { ".prettierrc": "{}\n" }],
      [".oxfmtrc.json", { ".oxfmtrc.json": "{}\n" }],
    ])("keeps its meaning with %s", async (_, config: Record<string, string>) => {
      const result = await format({ ...config, ...files }, Object.keys(files), { reads: Object.keys(files) });
      expect(result.files).toEqual(written);
      expect(result.exitCode).toBe(0);
    });

    test("passes --debug-check", async () => {
      const result = await format(files, ["--debug-check"], { reads: Object.keys(files) });
      expect(result.files).toEqual(files);
      expect(result.stderr).toBe("");
      expect(result.stdout.split("\n").sort()).toEqual(Object.keys(files).sort());
      expect(result.exitCode).toBe(0);
    });

    test("is stable when the output is formatted again", async () => {
      expect(await different(written, [])).toEqual([]);
    });

    test("with whitespace sensitivity off, a word and an escaped mustache stay two words", async () => {
      // Prettier 3.9.9 prints `p\\{{a}} {{q}}`.
      const flags = ["--html-whitespace-sensitivity=ignore"];
      const result = await format({ "a.hbs": "p \\{{a}} {{q   }}\n" }, flags, { reads: ["a.hbs"] });
      expect(result.files).toEqual({ "a.hbs": "p \\{{a}} {{q}}" });
      expect(result.exitCode).toBe(0);
    });

    test("keeps its meaning from stdin", async () => {
      const [before, after] = templates.doctype;
      const result = await format({}, ["--stdin-filepath", "a.hbs"], { stdin: before });
      expect(result.raw).toBe(after);
      expect(result.exitCode).toBe(0);
    });

    test("keeps its meaning in a Markdown code block", async () => {
      const text = "#   a\n\n```hbs\n<!DOCTYPE html>\n<p   ></p>\n```\n\n```hbs\n<p   ></p>\n```\n";
      const result = await format({ "a.md": text }, [], { reads: ["a.md"] });
      expect(result.files).toEqual({
        "a.md": "# a\n\n```hbs\n<!DOCTYPE html>\n<p></p>\n```\n\n```hbs\n<p></p>\n```\n",
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Markdown whose meaning Prettier changes", () => {
    // Each row is the text, Bun's output and Prettier 3.9.9's output. Prettier gives two adjacent emphases the same
    // marker, which merges them into one or into none.
    test.each([
      ["x   *a*_b_\n", "x *a*_b_\n", "x _a__b_\n"],
      ["x   _a_*b*\n", "x _a_*b*\n", "x _a__b_\n"],
      ["x   **a**__b__\n", "x **a**__b__\n", "x **a****b**\n"],
      ["x   ***a******b***\n", "x ***a******b***\n", "x _**a**__**b**_\n"],
      ["-   *a*_b_*c*\n", "- *a*_b_*c*\n", "- _a__b__c_\n"],
      ["*b   **(a)**b c*\n", "*b **(a)**b c*\n", "*b **(a)*_b c_\n"],
    ])("%j", async (before, after, byPrettier) => {
      expect(after).not.toBe(byPrettier);
      const result = await format({ "a.md": before, "b.md": after }, [], { reads: ["a.md", "b.md"] });
      expect(result.files).toEqual({ "a.md": after, "b.md": after });
      expect(result.exitCode).toBe(0);
    });

    // Known issue: for these Bun prints what Prettier 3.9.9 prints, and a CommonMark parser reads that output
    // differently. All are emphasis nested three deep, or runs of `*` and `_` that are text inside an emphasis. Telling
    // them apart from `*foo_bar*`, where `_foo_bar_` is correct, requires the delimiter run rules.
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
      ["*b _\u4e2d_a c*\n", "_b _\u4e2d_a c_\n"],
      ["*b a_\u4e2d_ c*\n", "_b a_\u4e2d_ c_\n"],
    ])("known issue: %j", async (before, byPrettier) => {
      const result = await format({ "a.md": before }, [], { reads: ["a.md"] });
      expect(result.files).toEqual({ "a.md": byPrettier });
    });

    describe("a file that starts with a line of four dashes", () => {
      // Front matter is fenced by exactly three dashes, plus signs or dots. Prettier 3.9.9 and oxfmt 0.72.0 treat the
      // first three characters of a longer line as the fence, and what's left of the closing line turns into a list
      // item or into text. Each row has the text, Bun's output as Markdown and as MDX, and Prettier's output as both.
      test.each([
        [
          "----\nNotice\n----\nbody\n",
          "---\n\nNotice\n----\n\nbody\n",
          "---\n\n## Notice\n\nbody\n",
          "----\nNotice\n---\n\n-\n\nbody\n",
          "----\nNotice\n---\n\n- body\n",
        ],
        [
          "-----\nNotice\n-----\nbody\n",
          "---\n\nNotice\n-----\n\nbody\n",
          "---\n\n## Notice\n\nbody\n",
          "-----\nNotice\n---\n\n--\nbody\n",
          "-----\nNotice\n---\n\n--\nbody\n",
        ],
        [
          "---\ntitle: x\n----\nbody\n",
          "---\n\ntitle: x\n----\n\nbody\n",
          "---\n\n## title: x\n\nbody\n",
          "---\ntitle: x\n---\n\n-\n\nbody\n",
          "---\ntitle: x\n---\n\n- body\n",
        ],
        [
          "++++\nNotice\n++++\nbody\n",
          "++++\nNotice\n++++\nbody\n",
          "++++\nNotice\n++++\nbody\n",
          "++++\nNotice\n+++\n\n-\n\nbody\n",
          "++++\nNotice\n+++\n\n- body\n",
        ],
        [
          "---\ntitle: x\n....\nbody\n",
          "---\n\ntitle: x\n....\nbody\n",
          "---\n\ntitle: x\n....\nbody\n",
          "---\ntitle: x\n...\n\n.\nbody\n",
          "---\ntitle: x\n...\n\n.\nbody\n",
        ],
      ])("%j", async (before, markdown, mdx, prettierMarkdown, prettierMdx) => {
        const html = Bun.markdown.html(before);
        expect(Bun.markdown.html(markdown)).toBe(html);
        expect(Bun.markdown.html(mdx)).toBe(html);
        expect(Bun.markdown.html(prettierMarkdown)).not.toBe(html);
        expect(Bun.markdown.html(prettierMdx)).not.toBe(html);
        const files = { "a.md": before, "b.md": markdown, "a.mdx": before, "b.mdx": mdx };
        const names = Object.keys(files);
        const [result, asOxfmt] = await Promise.all([
          format(files, [], { reads: names }),
          format(files, ["--flavor=oxfmt"], { reads: names }),
        ]);
        expect(result.files).toEqual({ "a.md": markdown, "b.md": markdown, "a.mdx": mdx, "b.mdx": mdx });
        expect(result.exitCode).toBe(0);
        // That flavor writes a rule at the start of a file as `***`.
        expect(names.map(name => Bun.markdown.html(asOxfmt.files[name]!))).toEqual(names.map(() => html));
        expect(asOxfmt.exitCode).toBe(0);
      });

      test("three dashes are still front matter", async () => {
        const texts = [
          "---\na: 1\n---\n\nbody\n",
          "---yaml\na: 1\n---\n\nbody\n",
          "+++\na = 1\n+++\n\nbody\n",
          "---\na: 1\n...\n\nbody\n",
          "---\n---\n\nbody\n",
          "---\na: |\n  ----\n---\n\nbody\n",
        ];
        const files = Object.fromEntries(texts.flatMap((text, i) => [`${i}.md`, `${i}.mdx`].map(name => [name, text])));
        const result = await format({ ...files, "ugly.md": "---\na:   1\n---\n*body*\n" }, [], {
          reads: [...Object.keys(files), "ugly.md"],
        });
        expect(result.files).toEqual({ ...files, "ugly.md": "---\na: 1\n---\n\n_body_\n" });
        expect(result.exitCode).toBe(0);
      });
    });

    describe("an underlined MDX heading with several lines of text", () => {
      // `## text` ends at the first line break, so the heading keeps its underline as long as its text has one.
      // Prettier 3.9.9 reads all of these as a paragraph. It puts an empty line above `---`, which makes that a rule, and
      // with `always` or `never` it pulls `===` up into the text.
      // Each row has the formatted text, and the output with `--prose-wrap=always` or `never`.
      const headings = [
        [
          "two lines above ---",
          "Bun runs on Render.\nThis guide deploys a server.\n---\n",
          "## Bun runs on Render. This guide deploys a server.\n",
        ],
        ["two lines above ===", "first line\nsecond line\n===\n", "# first line second line\n"],
        ["three lines above ---", "one\ntwo\nthree\n---\n", "## one two three\n"],
        ["three lines above ===", "one\ntwo\nthree\n===\n", "# one two three\n"],
        ["emphasis across the lines", "_first\nsecond_\n===\n", "# _first second_\n"],
        ["code across the lines", "`first\nsecond`\n---\n", "## `first second`\n"],
        ["in a block quote", "> first\n> second\n> ---\n", "> ## first second\n"],
        // A hard break stays a line break regardless of `proseWrap`.
        ["a hard break with two spaces", "first  \nsecond\n---\n", "first  \nsecond\n---\n"],
        ["a hard break with a backslash", "first\\\nsecond\n===\n", "first\\\nsecond\n===\n"],
        ["a hard break and a plain line break", "first\\\nsecond\nthird\n---\n", "first\\\nsecond third\n---\n"],
      ] as const;
      const html = (text: string) => Bun.markdown.html(text).replace(/\s+/g, " ");

      test.each(headings)("%s", async (_, text) => {
        const files = { "a.mdx": text, "a.md": text };
        const result = await format(files, [], { reads: Object.keys(files) });
        expect(result.files).toEqual(files);
        expect(result.exitCode).toBe(0);
      });

      test.each(headings.flatMap(row => (["always", "never"] as const).map(proseWrap => [proseWrap, ...row] as const)))(
        "--prose-wrap=%s: %s",
        async (proseWrap, _, text, joined) => {
          expect(html(joined)).toBe(html(text));
          const result = await format({ "a.mdx": text, "b.mdx": joined }, [`--prose-wrap=${proseWrap}`], {
            reads: ["a.mdx", "b.mdx"],
          });
          expect(result.files).toEqual({ "a.mdx": joined, "b.mdx": joined });
          expect(result.exitCode).toBe(0);
        },
      );

      test("still formats the text and keeps the underline's length", async () => {
        const files = { "a.mdx": "*first\nsecond*\n===\n", "b.mdx": "first   line\nsecond line\n-----\n" };
        const result = await format(files, [], { reads: Object.keys(files) });
        expect(result.files).toEqual({
          "a.mdx": "_first\nsecond_\n===\n",
          "b.mdx": "first line\nsecond line\n-----\n",
        });
        expect(result.exitCode).toBe(0);
      });

      test("text that ends up on one line gets ##", async () => {
        // `2.` at the start of a line looks like a list, so that line is joined to the one above.
        const files = { "a.mdx": "first\n2. second\n---\n", "b.mdx": "one line\n---\n" };
        const result = await format(files, [], { reads: Object.keys(files) });
        expect(result.files).toEqual({ "a.mdx": "## first 2. second\n", "b.mdx": "## one line\n" });
        expect(result.exitCode).toBe(0);
      });
    });

    describe("the fence of a code block", () => {
      // Each row is the text, Bun's output and Prettier 3.9.9's output. A backtick fence can't have a backtick after it
      // on its line, and it ends at the first line with as many backticks. Where Prettier writes one anyway, the code
      // turns into prose and what follows it into code.
      test.each([
        [
          "~~~js title=`a`\nlet a;\n~~~\n\nafter\n",
          "~~~js title=`a`\nlet a;\n~~~\n\nafter\n",
          "```js title=`a`\nlet a;\n```\n\nafter\n",
        ],
        ["~~~~~txt `\n~~~\n~~~~~\n", "~~~~txt `\n~~~\n~~~~\n", "```txt `\n~~~\n```\n"],
        ["~~~txt `\n```\n~~~\n", "~~~txt `\n```\n~~~\n", "````txt `\n```\n````\n"],
        // Prettier is right about these.
        ["~~~txt\n```\na\n```\n~~~\n", "````txt\n```\na\n```\n````\n", null],
        ["```txt\n~~~\na\n~~~\n```\n", "```txt\n~~~\na\n~~~\n```\n", null],
      ])("%j", async (before, after, byPrettier) => {
        expect(after).not.toBe(byPrettier);
        expect(Bun.markdown.html(after)).toBe(Bun.markdown.html(before));
        const files = { "a.md": before, "b.md": after, "a.mdx": before, "b.mdx": after };
        const result = await format(files, [], { reads: Object.keys(files) });
        expect(result.files).toEqual({ "a.md": after, "b.md": after, "a.mdx": after, "b.mdx": after });
        expect(result.exitCode).toBe(0);
      });

      test("is longer than the fences that formatting the code puts in it", async () => {
        // Prettier 3.9.9 counts the backticks in the code before it's formatted, and writes three.
        const after = "````md\n```txt\na\n```\n````\n";
        const files = { "a.md": "```md\n~~~txt\na\n~~~\n```\n", "b.md": after };
        const result = await format(files, [], { reads: Object.keys(files) });
        expect(result.files).toEqual({ "a.md": after, "b.md": after });
        expect(result.exitCode).toBe(0);
      });
    });

    describe("spaces and tabs at the end of a line of code", () => {
      // They're part of the code. Prettier 3.9.9 and oxfmt 0.72.0 remove them.
      const blocks = {
        "the empty context line of a patch": "```diff\n a\n \n-b\n+c\n```\n",
        "a hard break that is shown": "```md\nline one  \nline two\n```\n",
        "a tab": "```txt\nname\t\nvalue \t\n```\n",
        "a fence without a language": "```\nabc  \n```\n",
        "indented code": "    abc  \n    def\n",
        "the last line of indented code": "    abc  \n\nafter\n",
        "a whitespace-only line in indented code": "    abc\n      \n    def\n",
        "in a list item": "- ```\n  abc  \n  ```\n",
        "in a list item, next to an empty line": "- ```diff\n   a\n   \n\n  -b\n  ```\n",
        "indented code in a list item": "- a\n\n      abc  \n\n- b\n",
        "in a block quote": "> ```\n> abc  \n>\n> def\t\n> ```\n",
      };
      test.each(
        Object.entries(blocks).flatMap(([title, text]) =>
          [[], ["--embedded-language-formatting=off"], ["--flavor=oxfmt"]].map(args => [title, args, text] as const),
        ),
      )("%s %j", async (_, args, text) => {
        const files = { "a.md": text, "a.mdx": text };
        const result = await format(files, [...args], { reads: Object.keys(files) });
        expect(result.files).toEqual(files);
        expect(result.exitCode).toBe(0);
      });

      test("the rest of the file is still formatted", async () => {
        const before = "#   a\n\n```txt\nb  \n```\n*   c\n\n        d  \n";
        const after = "# a\n\n```txt\nb  \n```\n\n- c\n\n      d  \n";
        expect(Bun.markdown.html(after)).toBe(Bun.markdown.html(before));
        const result = await format({ "a.md": before, "a.mdx": before }, [], { reads: ["a.md", "a.mdx"] });
        expect(result.files).toEqual({ "a.md": after, "a.mdx": after });
        expect(result.exitCode).toBe(0);
      });

      describe("indented code in a template", () => {
        const template = (title: string, code: string[], item: string) =>
          [
            "const a = markdown`",
            `  ${title}`,
            "",
            ...code.map(line => `      ${line}`),
            "",
            `  ${item}`,
            "`;",
            "",
          ].join("\n");

        test.each([
          ["none", ["abc", "def"]],
          ["before the last line", ["abc  ", "def"]],
        ])("%s: the template is formatted", async (_, code) => {
          const result = await format({ "a.js": template("#  a", code, "*  b") }, [], { reads: ["a.js"] });
          expect(result.files).toEqual({ "a.js": template("# a", code, "- b") });
          expect(result.exitCode).toBe(0);
        });

        test("at the end of the last line: the template is left unformatted", async () => {
          const text = template("#  a", ["abc", "def \t"], "*  b");
          const result = await format({ "a.js": text }, [], { reads: ["a.js"] });
          expect(result.files).toEqual({ "a.js": text });
          expect(result.exitCode).toBe(0);
        });
      });

      describe("before an empty line of the code, in a template", () => {
        const indented = (by: string, lines: string[]) => lines.map(line => line && by + line);
        /** The tag and the lines of a template with the heading `title` and a block of `code`. */
        const shapes: Record<string, (title: string, code: string[]) => [string, string[]]> = {
          "indented": (title, code) => ["markdown", [`  ${title}`, "", ...indented("      ", code), "", "  - b"]],
          "tag-md": (title, code) => ["md", [`  ${title}`, "", ...indented("      ", code), "", "  - b"]],
          "column-0": (title, code) => ["markdown", [title, "", ...indented("    ", code), "", "- b"]],
          "in-a-list-item": (title, code) => [
            "markdown",
            [`  ${title}`, "", "  - b", "", ...indented("        ", code)],
          ],
          "at-the-end": (title, code) => ["markdown", [`  ${title}`, "", ...indented("      ", code)]],
          "fenced": (title, code) => [
            "markdown",
            [`  ${title}`, "", "  ~~~txt", ...indented("  ", code), "  ~~~", "", "  - b"],
          ],
          "fenced-column-0": (title, code) => ["markdown", [title, "", "~~~txt", ...code, "~~~"]],
          "fenced-in-a-list-item": (title, code) => [
            "markdown",
            [`  ${title}`, "", "  - ~~~txt", ...indented("    ", code), "    ~~~"],
          ],
        };
        const blanks = { "two-blanks": "  ", "one-blank": " ", "tab": "\t" };
        /** Every shape, with each kind of trailing whitespace and with one and two empty lines. */
        const templates = (title: string) =>
          Object.fromEntries(
            Object.entries(shapes).flatMap(([shape, make]) =>
              Object.entries(blanks).flatMap(([kind, blank]) =>
                [[""], ["", ""]].map(empty => {
                  const [tag, lines] = make(title, [`abc${blank}`, ...empty, "def"]);
                  return [`${shape}-${kind}-${empty.length}.js`, [`const a = ${tag}\``, ...lines, "`;", ""].join("\n")];
                }),
              ),
            ),
          );

        // Prettier 3.9.9 prints each of these the same way, except for the trailing whitespace.
        test("keeps the empty lines, and a second run changes nothing", async () => {
          const [before, after] = [templates("#  a"), templates("# a")];
          const reads = Object.keys(before);
          const first = await format(before, [], { reads });
          expect(first.files).toEqual(after);
          const second = await format(after, [], { reads });
          expect(second.files).toEqual(after);
          expect([first.exitCode, second.exitCode]).toEqual([0, 0]);
        });
      });
    });

    /** The rendered HTML, with every run of whitespace collapsed to one space. */
    const rendered = (text: string) => Bun.markdown.html(text).replace(/\s+/g, " ");

    describe("stars next to a space in MDX", () => {
      // Each row is the text, Bun's output and Prettier 3.9.9's output. Prettier's MDX parser pairs up any two stars,
      // so a product turns into emphasis, and real emphasis further on loses its partner. A star that's text is written
      // `\*` in MDX, which is also what Prettier does when there's only one.
      test.each([
        [
          "The volume is width * height * depth.\n",
          "The volume is width \\* height \\* depth.\n",
          "The volume is width _ height _ depth.\n",
        ],
        ["2 * 3 * 4 = 24\n", "2 \\* 3 \\* 4 = 24\n", "2 _ 3 _ 4 = 24\n"],
        ["- a * b * c\n", "- a \\* b \\* c\n", "- a _ b _ c\n"],
        ["# a * b * c\n", "# a \\* b \\* c\n", "# a _ b _ c\n"],
        [
          "| a * b * c |\n| --------- |\n| 1 * 2 * 3 |\n",
          "| a \\* b \\* c |\n| ----------- |\n| 1 \\* 2 \\* 3 |\n",
          "| a _ b _ c |\n| --------- |\n| 1 _ 2 _ 3 |\n",
        ],
        ["a *b * c\n", "a \\*b \\* c\n", "a _b _ c\n"],
        ["a * b* c\n", "a \\* b\\* c\n", "a _ b_ c\n"],
        ["/* d */\n", "/\\* d \\*/\n", "/_ d _/\n"],
        [
          "width * height is *important*.\n",
          "width \\* height is _important_.\n",
          "width * height is *important\\*.\n",
        ],
        ["a ** b **c** d\n", "a \\*\\* b **c** d\n", "a ** b **c\\*\\* d\n"],
        // Prettier is right about these.
        ["a * b\n", "a \\* b\n", null],
        ["a *b* c\n", "a _b_ c\n", null],
        ["e**.** f\n", "e**.** f\n", null],
      ])("%j", async (before, after, byPrettier) => {
        expect(after).not.toBe(byPrettier);
        expect(rendered(after)).toBe(rendered(before));
        const result = await format({ "a.mdx": before, "b.mdx": after }, [], { reads: ["a.mdx", "b.mdx"] });
        expect(result.files).toEqual({ "a.mdx": after, "b.mdx": after });
        expect(result.exitCode).toBe(0);
      });
    });

    describe("a line that is text only because it's indented by four or more", () => {
      // Each row is the text, Bun's output and Prettier 3.9.9's output. Prettier removes the indentation, so the line
      // starts a code block, a rule, HTML or a table. Bun joins it to the line above, as both do with `- x`. After a
      // hard break it keeps four spaces.
      test.each([
        [
          "Run this:\n     ```\nthen read on.\n\nThe rest of the page.\n",
          "Run this: ```\nthen read on.\n\nThe rest of the page.\n",
          "Run this:\n```\nthen read on.\n\nThe rest of the page.\n",
        ],
        ["text\n     ~~~\nmore\n", "text ~~~\nmore\n", "text\n~~~\nmore\n"],
        ["text\n     ***\n", "text ***\n", "text\n***\n"],
        ["text\n     ___\n", "text ___\n", "text\n___\n"],
        ["text\n     <div>\nmore\n", "text <div>\nmore\n", "text\n<div>\nmore\n"],
        ["text\n     <!-- c -->\nmore\n", "text <!-- c -->\nmore\n", "text\n<!-- c -->\nmore\n"],
        [
          "| a | b |\n     | - | - |\n| c | d |\n",
          "| a | b | | - | - |\n| c | d |\n",
          "| a | b |\n| - | - |\n| c | d |\n",
        ],
        ["> quote\n    ```\n    x\n", "> quote ```\n> x\n", "> quote\n> ```\n> x\n"],
        ["text  \n     ```\nmore\n", "text  \n    ```\nmore\n", "text  \n```\nmore\n"],
        ["text\\\n     ***\n", "text\\\n    ***\n", "text\\\n***\n"],
        // Prettier is right about these.
        ["text\n     - x\n", "text - x\n", null],
        ["text\n     ===\n", "text\n\\===\n", null],
        ["text\n     <span>\nmore\n", "text\n<span>\nmore\n", null],
        ["text\n     ```a```\n", "text\n`a`\n", null],
      ])("%j", async (before, after, byPrettier) => {
        expect(after).not.toBe(byPrettier);
        expect(rendered(after)).toBe(rendered(before));
        const result = await format({ "a.md": before, "b.md": after }, [], { reads: ["a.md", "b.md"] });
        expect(result.files).toEqual({ "a.md": after, "b.md": after });
        expect(result.exitCode).toBe(0);
      });
    });

    describe("a star left over from a longer run", () => {
      // Each row is the text, Bun's output and Prettier 3.9.9's output. The first and the last star are text, because a
      // run of two and a run of one can't pair. With `_a_` in between, the first is a run of one, and they can.
      test.each([
        ["**a*(*) x\n", "**a*(*) x\n", "_*a*(_) x\n"],
        ["**a*{{*: x\n", "**a*{{*: x\n", "_*a*{{_: x\n"],
        ["*a**(*) x\n", "*a**(*) x\n", "_a_*(*) x\n"],
        // Nothing here for the star to pair with, and Prettier is right.
        ["**a* b\n", "*_a_ b\n", null],
        ["**a* b * c\n", "*_a_ b * c\n", null],
        ["****a*\n", "***_a_\n", null],
      ])("%j", async (before, after, byPrettier) => {
        expect(after).not.toBe(byPrettier);
        expect(rendered(after)).toBe(rendered(before));
        const result = await format({ "a.md": before, "b.md": after }, [], { reads: ["a.md", "b.md"] });
        expect(result.files).toEqual({ "a.md": after, "b.md": after });
        expect(result.exitCode).toBe(0);
      });
    });

    describe("--prose-wrap=always doesn't start a line with a word that would be markup there", () => {
      const words = (count: number) => Array.from({ length: count }, () => "word").join(" ");
      const url = "https://example.com/" + Buffer.alloc(70, "x").toString();
      // Each row is the width, the text, Bun's output and Prettier 3.9.9's output, which has a heading, a rule, a code
      // block or HTML.
      const rows = [
        [80, `${words(16)} = ${url}\n`, `${words(15)}\nword =\n${url}\n`, `${words(16)}\n=\n${url}\n`],
        [80, `${words(16)} -- ${url}\n`, `${words(15)}\nword --\n${url}\n`, `${words(16)}\n--\n${url}\n`],
        [13, "a is the the word a word ===\n", "a is the the\nword a\nword ===\n", "a is the the\nword a word\n===\n"],
        [22, "x is is a is x is this ___\n", "x is is a is x is\nthis ___\n", "x is is a is x is this\n___\n"],
        [
          21,
          "word a x the x then x ```\n\nnext paragraph\n",
          "word a x the x then\nx ```\n\nnext paragraph\n",
          "word a x the x then x\n```\n\nnext paragraph\n",
        ],
        [21, "word a x the x then x <div>\n", "word a x the x then\nx <div>\n", "word a x the x then x\n<div>\n"],
        // With something after it on its line it's only a word, and Prettier is right.
        [13, "aaaa bbbb ccc = dd\n", "aaaa bbbb ccc\n= dd\n", null],
        [13, "aaaa bbbb ccc -- dd\n", "aaaa bbbb ccc\n-- dd\n", null],
      ] as const;

      test.each(rows)("at %d columns: %j", async (width, before, after, byPrettier) => {
        expect(after).not.toBe(byPrettier);
        expect(rendered(after)).toBe(rendered(before));
        const args = ["--prose-wrap=always", `--print-width=${width}`];
        const result = await format({ "a.md": before, "b.md": after }, args, { reads: ["a.md", "b.md"] });
        expect(result.files).toEqual({ "a.md": after, "b.md": after });
        expect(result.exitCode).toBe(0);
      });

      test.each(rows)("with --flavor=oxfmt at %d columns: %j", async (width, before) => {
        const args = ["--flavor=oxfmt", "--prose-wrap=always", `--print-width=${width}`];
        const once = await format({ "a.md": before }, args, { reads: ["a.md"] });
        const written = once.files["a.md"]!;
        expect(rendered(written)).toBe(rendered(before));
        expect(await different({ "a.md": written }, args)).toEqual([]);
      });
    });
  });

  test("--prose-wrap=never doesn't add a line break to a YAML folded scalar that keeps its line breaks", async () => {
    // Prettier 3.9.9 prints `k: >+\n  a\n  \n  \n\nl: m\n`, which has one more.
    const result = await format({ "a.yaml": "k: >+\n  a\n\n\nl:   m\n" }, ["--prose-wrap=never"], {
      reads: ["a.yaml"],
    });
    expect(result.files).toEqual({ "a.yaml": "k: >+\n  a\n\n\nl: m\n" });
    expect(result.exitCode).toBe(0);
  });

  describe("an escaped space at the end of an at-rule's parameters", () => {
    // Prettier 3.9.9 prints `@extend .a\;`, where the backslash escapes the `;`.
    const names = ["extend", "include", "media", "supports", "container", "layer", "import", "custom"];
    test.each(["a.css", "a.scss", "a.less"])("is kept in %s", async file => {
      const before = names.map(name => `x{@${name}   .a\\ ;}\n@${name} .a\\ ;\n`).join("") + "@last .a\\ ";
      const after = names.map(name => `x {\n  @${name} .a\\ ;\n}\n@${name} .a\\ ;\n`).join("") + "@last .a\\ ;\n";
      const result = await format({ [file]: before }, [], { reads: [file] });
      expect(result.files).toEqual({ [file]: after });
      expect(result.exitCode).toBe(0);
      expect(await different({ [file]: after }, [])).toEqual([]);
    });

    test("is kept before a parenthesis, and isn't doubled where Prettier already keeps it", async () => {
      // Prettier 3.9.9 prints `@media (a\\) {`. Its output for the second rule is right.
      const files = { "a.scss": "@media (a\\ ){b{c:d}}\n@each   .a\\ ;\n" };
      const result = await format(files, [], { reads: ["a.scss"] });
      expect(result.files).toEqual({ "a.scss": "@media (a\\ ) {\n  b {\n    c: d;\n  }\n}\n@each .a\\ ;\n" });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("a selector without a namespace", () => {
    // Each row is the selector, Bun's output and Prettier 3.9.9's output.
    test.each([
      ["x |b", "x |b", "x|b"],
      ["x,|b,y", "x,\n|b,\ny", "x,\n,|b,\ny"],
    ])("%j", async (before, after, byPrettier) => {
      expect(after).not.toBe(byPrettier);
      const written = `${after} {\n  c: d;\n}\n`;
      const result = await format({ "a.css": `${before}{c:d}\n`, "b.css": written }, [], { reads: ["a.css", "b.css"] });
      expect(result.files).toEqual({ "a.css": written, "b.css": written });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("a backslash in a CSS value", () => {
    // Each row is the value, Bun's output and Prettier 3.9.9's output. Prettier drops the whitespace after a word with
    // a backslash.
    test.each([
      ["Font\\ Awesome\\ 5", "Font\\ Awesome\\ 5", "Font\\Awesome\\5"],
      ["a\\g   c", "a\\g c", "a\\gc"],
      ["d\\  e", "d\\  e", "d\\e"],
      ["d\\ -5", "d\\ -5", "d\\-5"],
      ["d\\ ", "d\\ ", "d\\"],
      ["(a\\ )", "(a\\ )", "(a\\)"],
      ["f(b a\\ )", "f(b a\\ )", "f(b a\\)"],
      ["f(a\\ , b)", "f(a\\ , b)", "f(a\\, b)"],
      ["a\\ , b", "a\\ , b", "a\\, b"],
      // The backslash doesn't escape a space here, and Prettier is right.
      ["\\@a   1\\/3", "\\@a 1\\/3", null],
      ["d\\\\   e", "d\\\\ e", "d\\\\e"],
      ["x d\\h   f g", "x d\\h f g", "x d\\hf g"],
      // `\b` and `\e` are hexadecimal escapes, and the first space after one is part of it. With one space it's one
      // word.
      ["a\\b   c", "a\\b  c", "a\\bc"],
      ["x d\\e   f g", "x d\\e  f g", "x d\\ef g"],
      ["a\\b c", "a\\b c", "a\\bc"],
    ])("%j", async (before, after, byPrettier) => {
      expect(after).not.toBe(byPrettier);
      const files = Object.fromEntries(["a.css", "b.scss", "c.less"].map(name => [name, `a{b:${before}}\n`]));
      const result = await format(files, [], { reads: Object.keys(files) });
      const written = `a {\n  b: ${after};\n}\n`;
      expect(result.files).toEqual({ "a.css": written, "b.scss": written, "c.less": written });
      expect(result.exitCode).toBe(0);
      expect(await different({ "a.css": written }, [])).toEqual([]);
    });
  });

  describe("YAML whose values Prettier changes", () => {
    // Each row is the text, Bun's output and Prettier 3.9.9's output, which has a key with an extra line break, a
    // scalar that became a marker, a byte order mark that was the start of a key, or a key that can't be parsed.
    test.each([
      ["? |+\n  a\n\n:   m\n", "? |+\n  a\n\n: m\n", "? |+\n  a\n\n\n: m\n"],
      ["k:   l\n? >+\n  a\n\n", "k: l\n? >+\n  a\n\n", "k: l\n? >+\n  a\n\n\n"],
      ["---   ---\n", "--- ---\n", "---\n---\n"],
      ["---   ... x\n", "--- ... x\n", "---\n... x\n"],
      ["? \ufeffa\n:   m\n", "? \ufeffa\n: m\n", "\ufeffa: m\n"],
      ["? {a\n  b: c}\n:   m\n", "? { ? a\n      b\n    : c }\n: m\n", "{ ? a\n      b\n    : c }: m\n"],
      // Spaces and tabs at the end of a block scalar's last line are part of the string. Prettier drops them.
      [
        "prompt:   |-\n  Question: {q}\n  Answer: \n",
        "prompt: |-\n  Question: {q}\n  Answer: \n",
        "prompt: |-\n  Question: {q}\n  Answer:\n",
      ],
      [
        "text:   |\n  one\n  two  \nnext: 1\n",
        "text: |\n  one\n  two  \nnext: 1\n",
        "text: |\n  one\n  two\nnext: 1\n",
      ],
      ["text:   >\n  one\n  two  \n", "text: >\n  one\n  two  \n", "text: >\n  one\n  two\n"],
      ["text:   |\n  one\t\n", "text: |\n  one\t\n", "text: |\n  one\n"],
      ["-   |\n  x \n- y\n", "- |\n  x \n- y\n", "- |\n  x\n- y\n"],
      ["a:   |+\n  x \nb: 1\n", "a: |+\n  x \nb: 1\n", "a: |+\n  x\nb: 1\n"],
      ["?   |\n  a \n: m\n", "? |\n  a \n: m\n", "? |\n  a\n: m\n"],
      [
        "text:   |\r\n  one\r\n  two  \r\nnext: 1\r\n",
        "text: |\n  one\n  two  \nnext: 1\n",
        "text: |\n  one\n  two\nnext: 1\n",
      ],
      // So is a last line that has nothing but spaces past the indentation.
      ["a:   |\n  x\n      \n", "a: |\n  x\n      \n", "a: |\n  x\n"],
      ["a:   |\n  x\n      \nb: 1\n", "a: |\n  x\n      \nb: 1\n", "a: |\n  x\n\nb: 1\n"],
      ["--- >-\n ab\n \n  \n...\n", "---\n>-\n  ab\n\n   \n...\n", "---\n>-\n  ab\n...\n"],
      // An indentation indicator counts from the key or the `-`. Prettier leaves the lines where they are when that moves.
      ["a:\n- |2\n    x\n  yz\n", "a:\n  - |2\n      x\n    yz\n", "a:\n  - |2\n    x\n   z\n"],
      ["a:\n- b: >1-\n    x\n   yz\n", "a:\n  - b: >1-\n      x\n     yz\n", "a:\n  - b: >1-\n    x\n   yz\n"],
      [
        "a:\n    b: |2\n          x\n      y\n",
        "a:\n  b: |2\n        x\n    y\n",
        "a:\n  b: |2\n          x\n      y\n",
      ],
      ["  a: |1\n    x\n   y\n", "a: |1\n  x\n y\n", "a: |1\n    x\n   y\n"],
      ["-   - |1\n       x\n      y\n", "- - |1\n     x\n    y\n", "- - |1\n       x\n      y\n"],
    ])("%j", async (before, after, byPrettier) => {
      expect(after).not.toBe(byPrettier);
      expect(Bun.YAML.parse(after)).toEqual(Bun.YAML.parse(before));
      const result = await format({ "a.yaml": before, "b.yaml": after }, [], { reads: ["a.yaml", "b.yaml"] });
      expect(result.files).toEqual({ "a.yaml": after, "b.yaml": after });
      expect(result.exitCode).toBe(0);
      const checked = await format({ "a.yaml": before }, ["--debug-check"]);
      expect(checked.stderr).toBe("");
      expect(checked.exitCode).toBe(0);
    });

    test.each(["always", "never"])(
      "--prose-wrap=%s keeps the spaces at the end of a folded scalar",
      async proseWrap => {
        // Prettier 3.9.9 prints `text: >\n  one two\n`.
        const files = { "a.yaml": "text: >\n  one\n  two  \n" };
        const result = await format(files, [`--prose-wrap=${proseWrap}`], { reads: ["a.yaml"] });
        expect(result.files).toEqual({ "a.yaml": "text: >\n  one two  \n" });
        expect(result.exitCode).toBe(0);
      },
    );

    test("--debug-check reports a scalar that would change", async () => {
      // With no indentation, as in Prettier, the text of the scalar becomes the next key: `a: >\nb: c\n`.
      const files = { "a.yaml": "a: >\n  b: c\n", "b.yaml": "a:   b\n" };
      const result = await format(files, ["--debug-check", "--tab-width=0"], { reads: ["a.yaml", "b.yaml"] });
      expect(result.files).toEqual(files);
      expect(result.stderr).toBe(problem("a.yaml", "Not formatted, because formatting would change its contents"));
      expect(result.stdout).toBe("b.yaml");
      expect(result.exitCode).toBe(2);
    });

    describe.each([
      ["before another key", "next: 1\n"],
      ["at the end", ""],
    ])("embedded in another file, %s", (_, rest) => {
      // Prettier 3.9.9 prints `  Answer:` in all of them.
      const before = "prompt:   |-\n  Question: {q}\n  Answer: \n" + rest;
      const after = "prompt: |-\n  Question: {q}\n  Answer: \n" + rest;
      test.each([
        ["a.md", (yaml: string) => `---\n${yaml}---\n\n# a\n`],
        ["a.mdx", (yaml: string) => `---\n${yaml}---\n\n# a\n`],
        ["a.css", (yaml: string) => `---\n${yaml}---\n\na {\n  b: c;\n}\n`],
        ["a.html", (yaml: string) => `---\n${yaml}---\n\n<p>c</p>\n`],
        ["a.hbs", (yaml: string) => `---\n${yaml}---\n\n<p>c</p>`],
        ["fence.md", (yaml: string) => "```yaml\n" + yaml + "```\n"],
        ["fence-in-a-list.md", (yaml: string) => "- a\n\n  ```yaml\n" + yaml.replace(/^/gm, "  ") + "```\n"],
      ])("%s", async (name, around) => {
        const result = await format({ [name]: around(before) }, [], { reads: [name] });
        expect(result.files).toEqual({ [name]: around(after) });
        expect(result.exitCode).toBe(0);
        expect(await different({ [name]: around(after) }, [])).toEqual([]);
      });
    });
  });

  describe("GraphQL whose values Prettier changes", () => {
    const Q = '"""';
    const type = "\ntype A {\n  b: C\n}\n";
    const argument = (...lines: string[]) => `{\n  a(\n    ${lines.join("\n    ")}\n  )\n}\n`;
    /** The specification's `BlockStringValue` for each block string in `text`. */
    const values = (text: string) =>
      Array.from(text.matchAll(/"""([^]*?)"""/g), ([, raw]) => {
        const lines = raw.split("\n");
        const indents = lines.slice(1).flatMap(line => (line.trim() ? [line.search(/[^ \t]/)] : []));
        const dedented = lines.map((line, index) => (index ? line.slice(Math.min(...indents)) : line));
        while (dedented.length && !dedented[0].trim()) dedented.shift();
        while (dedented.length && !dedented.at(-1)!.trim()) dedented.pop();
        return dedented.join("\n");
      });

    // Spaces and tabs at the end of a line in a block string are part of its value, and so are those at the start of
    // the first line. Each row is the text, Bun's output (null if unchanged) and Prettier 3.9.9's output, which drops
    // them. In the last row, Prettier puts a comment in the string.
    test.each([
      [`${Q}\nFirst line  \nsecond line\n${Q}${type}`, null, `${Q}\nFirst line\nsecond line\n${Q}${type}`],
      [`${Q}\na  \n\n\nb\t\n\nc\n${Q}${type}`, null, `${Q}\na\n\n\nb\n\nc\n${Q}${type}`],
      [`${Q}\na\n   \nb\n${Q}${type}`, null, `${Q}\na\n\nb\n${Q}${type}`],
      [`${Q} Customer ${Q}${type}`, null, `${Q}\nCustomer\n${Q}${type}`],
      [`{\n  a(b: ${Q}Answer: ${Q})\n}\n`, null, argument(`b: ${Q}`, "Answer:", Q)],
      [`{\n  a(b: ${Q} d${Q})\n}\n`, null, argument(`b: ${Q}`, "d", Q)],
      [`{\n  a(b: ${Q} d\n  ${Q})\n}\n`, argument(`b: ${Q} d`, Q), argument(`b: ${Q}`, "d", Q)],
      [`{\n  a(b: ${Q}c  \nd${Q})\n}\n`, argument(`b: ${Q}`, "c  ", "d", Q), argument(`b: ${Q}`, "c", "d", Q)],
      [`{\n  a(b # why\n  : ${Q}x${Q})\n}\n`, argument("b:  # why", Q, "x", Q), argument(`b: ${Q} # why`, "x", Q)],
    ])("%j", async (before, changed, byPrettier) => {
      const after = changed ?? before;
      expect(values(after)).toEqual(values(before));
      expect(values(byPrettier)).not.toEqual(values(before));
      const files = { "a.graphql": before, "b.graphql": after };
      const result = await format(files, [], { reads: ["a.graphql", "b.graphql"] });
      expect(result.files).toEqual({ "a.graphql": after, "b.graphql": after });
      expect(result.exitCode).toBe(0);
    });
  });

  // `Bun.YAML.parse` skips the space and reads `|2`, `>2`, `|-` and `|2-`. Prettier 3.9.9 and oxfmt 0.72 reject these
  // too.
  test.each([
    ["a: | 2\n    four\n  abcdefgh\n", 6],
    ["a: >  2\n    four\n  abcdefgh\n", 7],
    ["- | -\n  four\n", 5],
    ["a: |2 -\n    four\n  abcdefgh\n", 7],
    ["a: | 2 # comment\n    four\n  abcdefgh\n", 6],
  ])("a space inside the header of a YAML block scalar is a syntax error: %j", async (text, column) => {
    const configs: Record<string, string>[] = [{}, { ".oxfmtrc.json": "{}\n" }];
    const results = await Promise.all(
      configs.map(config => format({ ...config, "a.yaml": text }, ["a.yaml"], { reads: ["a.yaml"] })),
    );
    for (const result of results) {
      expect(result.files).toEqual({ "a.yaml": text });
      expect(result.stderr).toStartWith(problem("a.yaml", "Unexpected character", [1, column, text.split("\n")[0]]));
      expect(result.exitCode).toBe(2);
    }
  });

  // This is what Prettier 3.9.9 prints.
  test.each([
    ["  a: 1\n  # x\n# y\n", "a: 1\n# x\n# y\n"],
    ["  - a\n  # x\n# y\n# z\n", "- a\n# x\n# y\n# z\n"],
    ["---\n  a: 1\n  # x\n# y\n---\nb: 2\n", "---\na: 1\n# x\n# y\n---\nb: 2\n"],
    ["  a: 1\n # x\n# y\n", "a: 1\n# x\n# y\n"],
    ["  a: 1\n  # x\n\n# y\n", "a: 1\n# x\n\n# y\n"],
    ["  a: 1\n\n  # x\n# y\n", "a: 1\n\n# x\n# y\n"],
    ["  a: 1\n   # w\n  # x\n# y\n", "a:\n  1\n  # w\n# x\n# y\n"],
  ])("comments after indented top-level YAML stay in order: %j", async (before, after) => {
    const result = await format({ "a.yaml": before, "b.yaml": after }, [], { reads: ["a.yaml", "b.yaml"] });
    expect(result.files).toEqual({ "a.yaml": after, "b.yaml": after });
    expect(result.exitCode).toBe(0);
  });

  describe("front matter that would end early", () => {
    // Prettier 3.9.9 formats the YAML, which puts the second `---` at the start of its line, where it ends the front
    // matter.
    const frontMatter = "---\n ---\na: b\n---\n";
    test.each([
      ["a.md", "\n#   c\n", "\n# c\n"],
      ["a.mdx", "\n#   c\n", "\n# c\n"],
      ["a.css", "a{b:c}\n", "\na {\n  b: c;\n}\n"],
      ["a.scss", "a{b:c}\n", "\na {\n  b: c;\n}\n"],
      ["a.html", "<p   >c</p>\n", "\n<p>c</p>\n"],
    ])("is left as written in %s", async (name, before, after) => {
      const result = await format({ [name]: frontMatter + before }, [], { reads: [name] });
      expect(result.files).toEqual({ [name]: frontMatter + after });
      expect(result.exitCode).toBe(0);
      expect(await different({ [name]: frontMatter + after }, [])).toEqual([]);
    });
  });

  test("formats HTML, Vue, Angular templates and MJML", async () => {
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

  describe("the options that HTML and Vue use, from every source", () => {
    const long = Buffer.alloc(40, "j").toString();
    // Each row is the option, its value, the flag, a file that's formatted without the option, and the same file
    // formatted with it.
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
        // A file that's formatted with the option isn't formatted without it. The reverse also holds, except that
        // formatted code that's left alone is fine, and so is having no whitespace where it would be significant.
        const result = await format({ ...files, "a.vue": withIt, "b.vue": without }, [...args, "-l", "a.vue", "b.vue"]);
        const isOneWay = name === "embeddedLanguageFormatting" || name === "htmlWhitespaceSensitivity";
        const isForBoth = !source.startsWith("overrides") && !isOneWay;
        expect(result.stdout.split("\n").filter(Boolean)).toEqual(isForBoth ? ["b.vue"] : []);
      },
    );

    // A file that's formatted with it is also formatted without it, so this uses an unformatted file.
    test.each(Object.keys(sources))("%s: proseWrap", async source => {
      const [files, args] = sources[source]("proseWrap", "never", "--prose-wrap=never");
      const rename = (text: string) => text.replaceAll("a.vue", "a.md");
      const renamed = Object.fromEntries(Object.entries(files).map(([name, text]) => [name, rename(text)]));
      const result = await format({ ...renamed, "a.md": "a\nb\n" }, [...args, "-l", "a.md"]);
      expect(result.stdout.split("\n").filter(Boolean)).toEqual(["a.md"]);
      expect((await format({ "a.md": "a\nb\n" }, ["-l", "a.md"])).stdout).toBe("");
    });

    test.each(options)("without %s", async (_name, _value, _flag, without, withIt) => {
      const result = await format({ "a.vue": withIt, "b.vue": without }, ["-l"]);
      expect(result.stdout.split("\n").filter(Boolean)).toEqual(["a.vue"]);
    });
  });

  test("reports a syntax error in HTML", async () => {
    const result = await format({ "a.html": "<div></span>\n", "b.html": "<p   >a</p>\n" }, [], {
      reads: ["a.html", "b.html"],
    });
    expect(result.files).toEqual({ "a.html": "<div></span>\n", "b.html": "<p>a</p>\n" });
    expect(result.stderr).toStartWith(problem("a.html", closingTag("span"), [1, 6, "<div></span>"]) + "\n\n");
    expect(result.exitCode).toBe(2);
  });

  describe("a <pre> with an element in it and no end tag", () => {
    // Each row is the text, Bun's output and Prettier 3.9.9's output, which loses everything after the start tag.
    test.each([
      ["<pre   ><b>a</b>\n", "<pre><b>a</b>\n", "<pre>>\n"],
      ["<pre   >a<b>c\n", "<pre>a<b>c\n", "<pre>>\n"],
      [
        '<p>x</p><pre   class="y"><i>a</i>\n  b\n',
        '<p>x</p>\n<pre class="y"><i>a</i>\n  b\n',
        '<p>x</p>\n<pre class="y">>\n',
      ],
      ["<listing   ><b>a\n", "<listing><b>a\n", "<listing>>\n"],
    ])("%j", async (before, after, byPrettier) => {
      expect(after).not.toBe(byPrettier);
      const result = await format({ "a.html": before, "b.html": after }, [], { reads: ["a.html", "b.html"] });
      expect(result.files).toEqual({ "a.html": after, "b.html": after });
      expect(result.exitCode).toBe(0);
      const checked = await format({ "a.html": before }, ["--debug-check"]);
      expect(checked.stderr).toBe("");
      expect(checked.exitCode).toBe(0);
    });
  });

  describe("an unquoted attribute value", () => {
    /** The elements of `html` with their attributes, as a browser parses them. */
    const elements = async (html: string) => {
      const all: unknown[] = [];
      const rewriter = new HTMLRewriter().on("*", {
        element(element) {
          all.push([element.tagName, ...element.attributes]);
        },
      });
      await rewriter.transform(new Response(html)).text();
      return all;
    };

    // In HTML it ends at whitespace or `>`, whatever else is in it. Each row is the text, Bun's output and Prettier
    // 3.9.9's output, where the value ends at the first `=`, `/` or no-break space. `null` means Prettier rejects the
    // file.
    test.each([
      [
        "<meta name=viewport content=width=device-width,initial-scale=1>\n",
        '<meta name="viewport" content="width=device-width,initial-scale=1" />\n',
        '<meta name="viewport" content="width" ="device-width,initial-scale" ="1" />\n',
      ],
      ["<img src=a.png?v=1>\n", '<img src="a.png?v=1" />\n', '<img src="a.png?v" ="1" />\n'],
      [
        "<script src=a.js?v=2></script>\n",
        '<script src="a.js?v=2"></script>\n',
        '<script src="a.js?v" ="2"></script>\n',
      ],
      [
        "<a href=?page=2&sort=name>next</a>\n",
        '<a href="?page=2&sort=name">next</a>\n',
        '<a href="?page" ="2&sort" ="name">next</a>\n',
      ],
      ["<p class=a=b id=c>x</p>\n", '<p class="a=b" id="c">x</p>\n', '<p class="a" ="b" id="c">x</p>\n'],
      ["<input value=a/>\n", '<input value="a/" />\n', '<input value="a" />\n'],
      ["<p title=a\u00a0b>x</p>\n", '<p title="a\u00a0b">x</p>\n', '<p title="a" b>x</p>\n'],
      ["<a href=/x?a=1>x</a>\n", '<a href="/x?a=1">x</a>\n', null],
      [
        "<link href=https://fonts.googleapis.com/css?family=Roboto rel=stylesheet>\n",
        '<link href="https://fonts.googleapis.com/css?family=Roboto" rel="stylesheet" />\n',
        null,
      ],
      ["<a href=a/>x</a>\n", '<a href="a/">x</a>\n', null],
      ['<p title=a"b>x</p>\n', "<p title='a\"b'>x</p>\n", null],
      ["<p title=a'b>x</p>\n", '<p title="a\'b">x</p>\n', null],
      ["<p title=a<b>x</p>\n", '<p title="a<b">x</p>\n', null],
    ])("%j", async (before, after, byPrettier) => {
      expect(after).not.toBe(byPrettier);
      expect(await elements(after)).toEqual(await elements(before));
      const result = await formatChecked({ "a.html": before, "b.html": after }, [], { reads: ["a.html", "b.html"] });
      expect(result.files).toEqual({ "a.html": after, "b.html": after });
      expect(result.exitCode).toBe(0);
    });

    test("in a Vue file", async () => {
      // Prettier 3.9.9 prints `<img src="a.png?v" ="1" />`.
      const files = { "a.vue": "<template><img src=a.png?v=1></template>\n" };
      const result = await formatChecked(files, [], { reads: ["a.vue"] });
      expect(result.files).toEqual({ "a.vue": '<template><img src="a.png?v=1" /></template>\n' });
      expect(result.exitCode).toBe(0);
    });

    test("in an Angular template it ends where Angular ends it", async () => {
      const files = { "a.component.html": "<img src=a.png?v=1>\n" };
      const result = await formatChecked(files, [], { reads: ["a.component.html"] });
      expect(result.files).toEqual({ "a.component.html": '<img src="a.png?v" ="1" />\n' });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("an SVG <text>", () => {
    /** The text that `html` renders in its `<text>` elements, with whitespace runs collapsed to one space and trimmed. */
    const shown = async (html: string) => {
      let all = "";
      const rewriter = new HTMLRewriter().on("text", {
        text(chunk) {
          all += chunk.text;
        },
      });
      await rewriter.transform(new Response(html)).text();
      return all.replace(/\s+/g, " ").trim();
    };
    const inSvg = (text: string) => `<svg>\n  ${text}\n</svg>\n`;
    const onLines = (...lines: string[]) => inSvg(lines.join("\n  "));

    // Each row is the text, Bun's output and Prettier 3.9.9's output. Prettier puts every element on its own line,
    // which adds a space between adjacent elements and drops a space at the end of an element.
    test.each([
      [
        '<svg><text x="0" y="10">H<tspan baseline-shift="sub">2</tspan>O</text></svg>\n',
        inSvg('<text x="0" y="10">H<tspan baseline-shift="sub">2</tspan>O</text>'),
        onLines('<text x="0" y="10">', "  H", '  <tspan baseline-shift="sub">2</tspan>', "  O", "</text>"),
      ],
      [
        "<svg><text>H<tspan>2</tspan>O</text></svg>\n",
        "<svg><text>H<tspan>2</tspan>O</text></svg>\n",
        onLines("<text>", "  H", "  <tspan>2</tspan>", "  O", "</text>"),
      ],
      [
        "<svg><text><tspan>a</tspan><tspan>b</tspan></text></svg>\n",
        inSvg("<text><tspan>a</tspan><tspan>b</tspan></text>"),
        onLines("<text>", "  <tspan>a</tspan>", "  <tspan>b</tspan>", "</text>"),
      ],
      [
        '<svg><text>see<a href="x">here</a>.</text></svg>\n',
        inSvg('<text>see<a href="x">here</a>.</text>'),
        onLines("<text>", "  see", '  <a href="x">here</a>', "  .", "</text>"),
      ],
      [
        '<svg><text><textPath href="#p">a</textPath>b</text></svg>\n',
        inSvg('<text><textPath href="#p">a</textPath>b</text>'),
        onLines("<text>", '  <textPath href="#p">a</textPath>', "  b", "</text>"),
      ],
      [
        "<svg><text><tspan>a </tspan><tspan>b</tspan></text></svg>\n",
        inSvg("<text><tspan>a </tspan><tspan>b</tspan></text>"),
        onLines("<text>", "  <tspan>a</tspan>", "  <tspan>b</tspan>", "</text>"),
      ],
      [
        "<svg><text>a<tspan> </tspan>b</text></svg>\n",
        inSvg("<text>a<tspan> </tspan>b</text>"),
        onLines("<text>", "  a", "  <tspan></tspan>", "  b", "</text>"),
      ],
    ])("%j", async (before, after, byPrettier) => {
      expect(after).not.toBe(byPrettier);
      expect(await shown(after)).toBe(await shown(before));
      for (const flags of [[], ["--html-whitespace-sensitivity=strict"]]) {
        const result = await format({ "a.html": before, "b.html": after }, flags, { reads: ["a.html", "b.html"] });
        expect(result.files).toEqual({ "a.html": after, "b.html": after });
        expect(result.exitCode).toBe(0);
      }
    });

    test("in a Vue file", async () => {
      const files = { "a.vue": "<template><svg><text>H<tspan>2</tspan>O</text></svg></template>\n" };
      const result = await format(files, [], { reads: ["a.vue"] });
      expect(result.files).toEqual({
        "a.vue": "<template>\n  <svg><text>H<tspan>2</tspan>O</text></svg>\n</template>\n",
      });
      expect(result.exitCode).toBe(0);
    });

    // This is what Prettier 3.9.9 prints.
    test.each([
      [
        [],
        "<svg><text>a <tspan>b</tspan> c</text></svg>\n",
        onLines("<text>", "  a", "  <tspan>b</tspan>", "  c", "</text>"),
      ],
      [
        [],
        onLines(
          '<text x="1">',
          '  <tspan x="0">a</tspan>',
          '  <tspan x="0" dy="1em">',
          "    b",
          "  </tspan>",
          "</text>",
        ),
        onLines('<text x="1">', '  <tspan x="0">a</tspan>', '  <tspan x="0" dy="1em">b</tspan>', "</text>"),
      ],
      [
        ["--html-whitespace-sensitivity=ignore"],
        "<svg><text>H<tspan>2</tspan>O</text></svg>\n",
        onLines("<text>", "  H", "  <tspan>2</tspan>", "  O", "</text>"),
      ],
    ])("every element still gets its own line where that renders the same: %j %j", async (flags, before, after) => {
      const result = await format({ "a.html": before }, flags, { reads: ["a.html"] });
      expect(result.files).toEqual({ "a.html": after });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("an element that takes up no space in its line", () => {
    /** The text that `html` renders, with whitespace runs collapsed to one space and trimmed. */
    const shown = async (html: string) => {
      let all = "";
      const rewriter = new HTMLRewriter().on("body", {
        text(chunk) {
          all += chunk.text;
        },
      });
      await rewriter.transform(new Response(`<body>${html}</body>`)).text();
      return all.replace(/\s+/g, " ").trim();
    };

    // Each row is the text, Bun's output and Prettier 3.9.9's output. Prettier treats these elements as blocks and puts
    // them on their own line, which splits one word into two. A line still ends after a script, but inside its end tag.
    test.each([
      [
        '<main><span>a</span><script src="x.js"></script><span>b</span></main>\n',
        '<main>\n  <span>a</span\n  ><script src="x.js"></script\n  ><span>b</span>\n</main>\n',
        '<main>\n  <span>a</span>\n  <script src="x.js"></script>\n  <span>b</span>\n</main>\n',
      ],
      [
        '<main   >foo<script src="x.js"></script>bar</main>\n',
        '<main>\n  foo<script src="x.js"></script\n  >bar\n</main>\n',
        '<main>\n  foo\n  <script src="x.js"></script>\n  bar\n</main>\n',
      ],
      [
        "<main   ><b>a</b><dialog></dialog><b>b</b></main>\n",
        "<main><b>a</b><dialog></dialog><b>b</b></main>\n",
        "<main>\n  <b>a</b>\n  <dialog></dialog>\n  <b>b</b>\n</main>\n",
      ],
      [
        '<p   >a<script src="x.js"></script><script src="y.js"></script>b</p>\n',
        '<p>\n  a<script src="x.js"></script\n  ><script src="y.js"></script\n  >b\n</p>\n',
        '<p>\n  a\n  <script src="x.js"></script>\n  <script src="y.js"></script>\n  b\n</p>\n',
      ],
      [
        '<span   >a<script src="x.js"></script></span>b\n',
        '<span>a<script src="x.js"></script></span>b\n',
        '<span\n  >a\n  <script src="x.js"></script></span\n>b\n',
      ],
    ])("%j", async (before, after, byPrettier) => {
      expect(after).not.toBe(byPrettier);
      expect(await shown(after)).toBe(await shown(before));
      expect(await shown(byPrettier)).not.toBe(await shown(before));
      const result = await formatChecked({ "a.html": before, "b.html": after }, [], { reads: ["a.html", "b.html"] });
      expect(result.files).toEqual({ "a.html": after, "b.html": after });
      expect(result.exitCode).toBe(0);
    });

    // This is what Prettier 3.9.9 prints.
    test.each([
      [
        '<body><div>a</div><script src="x.js"></script><script src="y.js"></script></body>\n',
        '<body>\n  <div>a</div>\n  <script src="x.js"></script>\n  <script src="y.js"></script>\n</body>\n',
      ],
      ['<p>a <script src="x.js"></script>b</p>\n', '<p>\n  a\n  <script src="x.js"></script>\n  b\n</p>\n'],
      ['<div><script src="x.js"></script>b</div>\n', '<div>\n  <script src="x.js"></script>\n  b\n</div>\n'],
      [
        '<video><source src="a.mp4"><source src="b.webm">c</video>\n',
        '<video>\n  <source src="a.mp4" />\n  <source src="b.webm" />\n  c\n</video>\n',
      ],
    ])("still gets its own line where that renders the same: %j", async (before, after) => {
      const result = await format({ "a.html": before }, [], { reads: ["a.html"] });
      expect(result.files).toEqual({ "a.html": after });
      expect(result.exitCode).toBe(0);
    });
  });

  // HTML splits a class list at ASCII whitespace. Prettier 3.9.9 splits at what JavaScript counts as whitespace, and
  // prints `a b` for all of these.
  test.each(["\u00a0", "\u3000", "\u2003", "\u2028", "\ufeff", "\v"])(
    "%j in a class is part of its name",
    async blank => {
      const files = { "a.html": `<a class="  a${blank}b   c ">x</a>\n` };
      const result = await formatChecked(files, [], { reads: ["a.html"] });
      expect(result.files).toEqual({ "a.html": `<a class="a${blank}b c">x</a>\n` });
      expect(result.exitCode).toBe(0);
    },
  );

  // It's what a <pre> renders and a <textarea>'s value. Each row is the text, which stays unchanged, and Prettier
  // 3.9.9's output.
  test.each([
    ["<textarea>\n\n</textarea>\n", "<textarea> </textarea>\n"],
    ["<textarea>   </textarea>\n", "<textarea> </textarea>\n"],
    ["<pre> </pre>\n", "<pre></pre>\n"],
    ["<pre>\n\n</pre>\n", "<pre></pre>\n"],
    ["<div><pre>  </pre></div>\n", "<div><pre></pre></div>\n"],
  ])("keeps whitespace that's the whole content of a <pre> or <textarea>: %j", async (text, byPrettier) => {
    expect(text).not.toBe(byPrettier);
    const result = await formatChecked({ "a.html": text }, [], { reads: ["a.html"] });
    expect(result.files).toEqual({ "a.html": text });
    expect(result.exitCode).toBe(0);
  });

  describe("an element that is kept as written, next to another node", () => {
    /** The elements of `html` with their attributes, and the text that it renders, as a browser parses them. */
    const read = async (html: string) => {
      const elements: unknown[] = [];
      let text = "";
      const rewriter = new HTMLRewriter()
        .on("*", {
          element(element) {
            elements.push([element.tagName, ...element.attributes]);
          },
        })
        .on("body", {
          text(chunk) {
            text += chunk.text;
          },
        });
      await rewriter.transform(new Response(`<body>${html}</body>`)).text();
      return { elements, text: text.replace(/\s+/g, " ").trim() };
    };
    const long = Buffer.alloc(60, "a").toString();
    const strict = ["--html-whitespace-sensitivity=strict"];

    // Each row is the text, and the output of both Bun and Prettier 3.9.9. `null` means it's unchanged.
    test.each([
      ["<label>x</label><textarea> </textarea>\n", null],
      ["<div><b>a</b><textarea> </textarea></div>\n", null],
      ["<b>a</b><textarea> </textarea><textarea> </textarea>\n", null],
      ["<b>a</b><textarea> </textarea><b>c</b>\n", null],
      ['<b>a</b><textarea   class="c"   > </textarea>\n', '<b>a</b><textarea class="c"> </textarea>\n'],
      ["<form><input><textarea> </textarea></form>\n", "<form><input /><textarea> </textarea></form>\n"],
      ["<br><textarea> </textarea>\n", "<br /><textarea> </textarea>\n"],
      ["<img><textarea> </textarea><img>\n", "<img /><textarea> </textarea><img />\n"],
      [
        `<b>${long}</b><textarea class="c"> </textarea><b>${long}</b>\n`,
        `<b>${long}</b\n><textarea class="c"> </textarea\n><b>${long}</b>\n`,
      ],
      ["<textarea> </textarea><b>a</b>\n", null],
      ["<textarea> </textarea>x\n", null],
      ["<span><textarea> </textarea></span>\n", null],
      ["<label><textarea> </textarea></label>\n", null],
      ["x<textarea> </textarea>\n", null],
      ["<!-- c --><textarea> </textarea>\n", "<!-- c --><textarea\n> </textarea>\n"],
      ["<b>a</b> <textarea> </textarea>\n", null],
      ["<b>a</b><textarea>x</textarea>\n", null],
      ["<b>a</b><textarea></textarea>\n", null],
    ])("a <textarea> that contains one space: %j", async (before, changed) => {
      const after = changed ?? before;
      expect(await read(after)).toEqual(await read(before));
      const result = await formatChecked({ "a.html": before, "b.html": after }, [], { reads: ["a.html", "b.html"] });
      expect(result.files).toEqual({ "a.html": after, "b.html": after });
      expect(result.exitCode).toBe(0);
    });

    // Each row is the flags, the text, Bun's output (`null` if unchanged) and Prettier 3.9.9's output, where the
    // whitespace is one space or none.
    test.each([
      [[], "<b>a</b><textarea>  </textarea><i>b</i>\n", null, "<b>a</b><textarea> </textarea><i>b</i>\n"],
      [
        [],
        "<b>a</b><textarea>\n\n</textarea><i>b</i>\n",
        "<b>a</b\n><textarea>\n\n</textarea\n><i>b</i>\n",
        "<b>a</b><textarea> </textarea><i>b</i>\n",
      ],
      [[], "<b>a</b><pre> </pre>\n", "<b>a</b>\n<pre> </pre>\n", "<b>a</b>\n<pre></pre>\n"],
      [strict, "<b>a</b><pre>  </pre><b>c</b>\n", null, "<b>a</b><pre> </pre><b>c</b>\n"],
    ])("more whitespace than one space: %j %j", async (flags, before, changed, byPrettier) => {
      const after = changed ?? before;
      expect(after).not.toBe(byPrettier);
      expect(await read(after)).toEqual(await read(before));
      const result = await formatChecked({ "a.html": before, "b.html": after }, flags, { reads: ["a.html", "b.html"] });
      expect(result.files).toEqual({ "a.html": after, "b.html": after });
      expect(result.exitCode).toBe(0);
    });

    // Each row is the flags, the text, Bun's output (`null` if unchanged) and Prettier 3.9.9's output. Prettier writes
    // the end of a tag twice, which makes it text the second time, or takes `/>` from a tag that ends in `>`.
    test.each([
      [
        strict,
        "<b>a</b><pre><i>x</i></pre><b>c</b>\n",
        "<b>a</b><pre><i>x</i></pre\n><b>c</b>\n",
        "<b>a</b>><pre><i>x</i></pre\n><b>c</b>\n",
      ],
      [strict, "<b>a</b><pre   ><i>x</i>\n", "<b>a</b><pre><i>x</i>\n", "<b>a</b>><pre>>\n"],
      [
        [],
        "<span><!--[if IE]><p>b<![endif]--></span>\n",
        "<span\n  ><!--[if IE]><p>b<![endif]--></span\n>\n",
        "<span\n  >><!--[if IE]><p>b<![endif]--></span</span\n>\n",
      ],
      [
        [],
        "<i>a</i><!--[if IE]><p>b<![endif]--><i>c</i>\n",
        "<i>a</i\n><!--[if IE]><p>b<!\n[endif]--><i>c</i>\n",
        "<i>a</i\n>><!--[if IE]><p>b<!\n[endif]--><i>c</i>\n",
      ],
      [[], "<a><!-- prettier-ignore --><b   ></b></a>\n", null, "<a><!-- prettier-ignore --><b   ></b>></a>\n"],
      [
        [],
        "<a><!-- prettier-ignore --><b   ><i></i></b></a>\n",
        "<a\n  ><!-- prettier-ignore --><b   ><i></i></b\n></a>\n",
        "<a\n  ><!-- prettier-ignore --><b   ><i></i></b>\n></a>\n",
      ],
      [
        [],
        '<a><!-- prettier-ignore --><img   src="b" /></a>\n',
        '<a><!-- prettier-ignore --><img   src="b"/></a>\n',
        '<a><!-- prettier-ignore --><img   src="b" />/></a>\n',
      ],
      [[], "<a><!-- prettier-ignore --><img   src=b></a>\n", null, "<a><!-- prettier-ignore --><img   src=b>/></a>\n"],
      [[], "<!-- prettier-ignore --><img   src=b><i>c</i>\n", null, "<!-- prettier-ignore --><img   src=/><i>c</i>\n"],
      [
        [],
        "<!-- prettier-ignore -->\n<br><br>\n",
        "<!-- prettier-ignore -->\n<br><br />\n",
        "<!-- prettier-ignore -->\n<b/><br />\n",
      ],
      [
        [],
        "<p>\n  <!-- prettier-ignore -->\n  <input   type=text>x\n</p>\n",
        null,
        "<p>\n  <!-- prettier-ignore -->\n  <input   type=tex/>x\n</p>\n",
      ],
    ])("writes the end of a tag only once: %j %j", async (flags, before, changed, byPrettier) => {
      const after = changed ?? before;
      expect(await read(after)).toEqual(await read(before));
      expect(await read(byPrettier)).not.toEqual(await read(before));
      const result = await formatChecked({ "a.html": before, "b.html": after }, flags, { reads: ["a.html", "b.html"] });
      expect(result.files).toEqual({ "a.html": after, "b.html": after });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Vue", () => {
    const inTemplate = (html: string) => `<template>\n  ${html}\n</template>\n`;

    // Vue doesn't compile any of it: `{{name}}` is rendered as text, and `:b` is an ordinary attribute. Each row is the
    // HTML, which stays unchanged, and Prettier 3.9.9's output.
    test.each([
      ["<code v-pre>{{name}}</code>", "<code v-pre>{{ name }}</code>"],
      ["<p v-pre>Use {{msg}} and {{a+b}} here</p>", "<p v-pre>Use {{ msg }} and {{ a + b }} here</p>"],
      ['<div v-pre><span :b="c  +d">t</span></div>', '<div v-pre><span :b="c + d">t</span></div>'],
      ['<span v-pre :b="c  +d" @e="f( )">t</span>', '<span v-pre :b="c + d" @e="f()">t</span>'],
    ])("doesn't format an element with v-pre or its content as code: %j", async (html, byPrettier) => {
      expect(html).not.toBe(byPrettier);
      const files = { "a.vue": inTemplate(html), "b.vue": inTemplate(html.replace(" v-pre", "")) };
      const result = await formatChecked(files, [], { reads: ["a.vue", "b.vue"] });
      expect(result.files).toEqual({ "a.vue": files["a.vue"], "b.vue": inTemplate(byPrettier.replace(" v-pre", "")) });
      expect(result.exitCode).toBe(0);
    });

    // Prettier 3.9.9 prints the same.
    test.each([
      "<div><b>a</b><textarea> </textarea></div>",
      "<p><label>x</label><textarea> </textarea><textarea> </textarea></p>",
      "<div><textarea> </textarea><b>a</b></div>",
      "<div>{{ a }}<textarea> </textarea></div>",
      "<div><A /><textarea> </textarea></div>",
      "<div><b>a</b><textarea>x</textarea></div>",
    ])("a <textarea> that contains one space stays attached to its neighbors: %j", async html => {
      const result = await formatChecked({ "a.vue": inTemplate(html) }, [], { reads: ["a.vue"] });
      expect(result.files).toEqual({ "a.vue": inTemplate(html) });
      expect(result.exitCode).toBe(0);
    });

    test("keeps a comment at the end of v-for inside the quotes", async () => {
      // Prettier 3.9.9 prints `v-for="a in b" // c`, which it can't parse.
      const files = { "a.vue": inTemplate('<div   v-for="a in b // c">x</div>') };
      const result = await formatChecked(files, [], { reads: ["a.vue"] });
      expect(result.files).toEqual({ "a.vue": inTemplate('<div v-for="a in b // c">x</div>') });
      expect(result.exitCode).toBe(0);
    });

    test("keeps a comment after an object literal in an Angular binding inside the quotes", async () => {
      // Prettier 3.9.9 and oxfmt 0.72.0 print `[x]="{ one: 1 }" // comment`, which turns the comment into attributes.
      const html = '<a [x]="{ one: 1 } // comment"></a>\n<a [x]="{one:  1} // prettier-ignore"></a>\n';
      const result = await formatChecked({ "a.component.html": html }, [], { reads: ["a.component.html"] });
      expect(result.files).toEqual({ "a.component.html": html });
      expect(result.exitCode).toBe(0);
    });

    test("prints a comment at the end of any other directive like Prettier", async () => {
      const files = { "a.vue": inTemplate('<div :a="b // c">x</div>') };
      const result = await format(files, [], { reads: ["a.vue"] });
      expect(result.files).toEqual({
        "a.vue": inTemplate('<div\n    :a="\n      b // c\n    "\n  >\n    x\n  </div>'),
      });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("a style sheet in which Prettier changes a letter", () => {
    // Prettier 3.9.9 lowercases a media query, which turns the Kelvin sign into a `k`: `@media (ka)`. CSS is only
    // case-insensitive for ASCII letters.
    const lossy = "<style>@media (\u212AA){a{b:c}}</style>\n";
    const written = "<style>\n  @media (\u212Aa) {\n    a {\n      b: c;\n    }\n  }\n</style>\n";

    test("keeps the letter", async () => {
      const files = { "a.html": lossy, "b.css": "@media (\u212AA){a{b:c}}\n" };
      const result = await format(files, [], { reads: ["a.html", "b.css"] });
      expect(result.files).toEqual({ "a.html": written, "b.css": "@media (\u212Aa) {\n  a {\n    b: c;\n  }\n}\n" });
      expect(result.exitCode).toBe(0);
    });

    test("passes --debug-check", async () => {
      const result = await format({ "a.html": lossy }, ["--debug-check"], { reads: ["a.html"] });
      expect(result.files).toEqual({ "a.html": lossy });
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("a.html");
      expect(result.exitCode).toBe(0);
    });

    test.each([["--check"], ["-l"]])("%s reports it as unformatted", async flag => {
      const result = await format({ "a.html": lossy }, [flag], { reads: ["a.html"] });
      expect(result.files).toEqual({ "a.html": lossy });
      expect(result.stdout).toBe("a.html");
      expect(result.exitCode).toBe(1);
    });

    test("keeps the letter from stdin", async () => {
      const result = await format({}, ["--stdin-filepath", "a.html"], { stdin: lossy });
      expect(result.raw).toBe(written);
      expect(result.exitCode).toBe(0);
    });

    test("keeps the letter in a template literal and in a Markdown code block", async () => {
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

    describe("a Less variable with nothing between the colon and the value", () => {
      // Each row is the code, Bun's output and Prettier 3.9.9's output. postcss reads `@a:1px` as the name of an
      // at-rule, and Prettier reassembles the value without the whitespace that followed that name. oxfmt 0.72.0 keeps
      // the space.
      test.each([
        ["@a:1px solid #ccc;\n", "@a: 1px solid #ccc;\n", "@a: 1pxsolid #ccc;\n"],
        [
          "@a:0 1px 2px rgba(0,0,0,.05);\n",
          "@a: 0 1px 2px rgba(0, 0, 0, 0.05);\n",
          "@a: 01px 2px rgba(0, 0, 0, 0.05);\n",
        ],
        ["@a:@b - @c;\n", "@a: @b - @c;\n", "@a: @b- @c;\n"],
        ["@a:0 -@b;\n", "@a: 0 -@b;\n", "@a: 0-@b;\n"],
        ["@a:-1px -2px;\n", "@a: -1px -2px;\n", "@a: -1px-2px;\n"],
        ["@a:10px ./ 2;\n", "@a: 10px ./ 2;\n", "@a: 10px./ 2;\n"],
        ["@a:screen and (min-width:1px);\n", "@a: screen and (min-width: 1px);\n", "@a: screenand (min-width: 1px);\n"],
        ["@a:1px solid!important;\n", "@a: 1px solid!important;\n", "@a: 1pxsolid!important;\n"],
        ["@a:1px\n  solid;\n", "@a: 1px solid;\n", "@a: 1pxsolid;\n"],
        [
          ".a{@b:1px solid red;c:@b}\n",
          ".a {\n  @b: 1px solid red;\n  c: @b;\n}\n",
          ".a {\n  @b: 1pxsolid red;\n  c: @b;\n}\n",
        ],
        [".a(){@b:1px solid;}\n", ".a() {\n  @b: 1px solid;\n}\n", ".a() {\n  @b: 1pxsolid;\n}\n"],
        ["@a:{@b:1px solid}\n", "@a: {\n  @b: 1px solid;\n};\n", "@a: {\n  @b: 1pxsolid;\n};\n"],
        ["@a:1px // b\n solid;\n", "@a: 1px // b\n  solid;\n", "@a: 1px  //\n  solid;\n"],
        // Prettier is right about these.
        ["@a:1px;\n", "@a: 1px;\n", null],
        ['@a:~"b c" d;\n', '@a: ~"b c" d;\n', null],
        ['@a:"b c" d;\n', '@a: "b c" d;\n', null],
        ["@a:fade(@b, 10%) 1px;\n", "@a: fade(@b, 10%) 1px;\n", null],
        ["@a:#fff #000;\n", "@a: #fff #000;\n", null],
        ["@a:{b:c d}\n", "@a: {\n  b: c d;\n};\n", null],
      ])("%j", async (before, after, byPrettier) => {
        expect(after).not.toBe(byPrettier);
        const files = { "a.less": before, "b.less": after };
        const [result, asOxfmt] = await Promise.all([
          format(files, [], { reads: ["a.less", "b.less"] }),
          format(files, ["--flavor=oxfmt"], { reads: ["a.less", "b.less"] }),
        ]);
        expect(result.files).toEqual({ "a.less": after, "b.less": after });
        expect(result.exitCode).toBe(0);
        expect(asOxfmt.files).toEqual({ "a.less": after, "b.less": after });
        expect(asOxfmt.exitCode).toBe(0);
      });

      test("SCSS isn't affected", async () => {
        const result = await format({ "a.scss": "$a:1px solid;\n.b{$c:1px solid}\n" }, [], { reads: ["a.scss"] });
        expect(result.files).toEqual({ "a.scss": "$a: 1px solid;\n.b {\n  $c: 1px solid;\n}\n" });
        expect(result.exitCode).toBe(0);
      });
    });

    describe("a comment in the value of a Less variable", () => {
      // Each row is the code, Bun's output and Prettier 3.9.9's output. postcss removes a comment with a space next to
      // it from the text that Prettier parses. Prettier then reads the text of the remaining comments from the file, at
      // the offsets they'd have if nothing were missing. oxfmt 0.72.0 keeps them all.
      test.each([
        ["@a: 1px /* why */ solid;\n", "@a: 1px /* why */ solid;\n", "@a: 1px solid;\n"],
        [
          '@a: "Helvetica Neue" /* mac */, Arial /* win */, sans-serif;\n',
          '@a:\n  "Helvetica Neue" /* mac */,\n  Arial /* win */,\n  sans-serif;\n',
          '@a: "Helvetica Neue", Arial, sans-serif;\n',
        ],
        ["@a: /* why */ 1px;\n", "@a: /* why */ 1px;\n", "@a: 1px;\n"],
        ["@a: darken(@b, 10% /* why */);\n", "@a: darken(@b, 10% /* why */);\n", "@a: darken(@b, 10%);\n"],
        ["@a: (1 /* why */ + 2);\n", "@a: (1 /* why */ + 2);\n", "@a: (1 + 2);\n"],
        ["@a: red ! /* why */ important;\n", "@a: red ! /* why */ important;\n", "@a: red ! important;\n"],
        ["@a: b /* c */ d/* e */f;\n", "@a: b /* c */ d /* e */ f;\n", "@a: b d  c */ d f;\n"],
        ["@a : 1px /* why */ solid;\n", "@a: 1px /* why */ solid;\n", "@a: 1px solid;\n"],
        ["x{@a: 1px /* why */ solid}\n", "x {\n  @a: 1px /* why */ solid;\n}\n", "x {\n  @a: 1px solid;\n}\n"],
        ["@a:1px /* why */ solid;\n", "@a: 1px /* why */ solid;\n", "@a: 1pxsolid;\n"],
        ["@a:1px/* why */solid;\n", "@a: 1px /* why */ solid;\n", "@a: 1pxsolid;\n"],
        ["@a:b(c)/* d */e;\n", "@a: b(c) /* d */ e;\n", "@a: b(c) )/* d * e;\n"],
        ["@a:darken(@b,10%/* why */);\n", "@a: darken(@b, 10% /* why */);\n", "@a: darken(@b, 10% %/* why *);\n"],
        ["@a:b /* c */ d/* e */f;\n", "@a: b /* c */ d /* e */ f;\n", "@a: bd /* c */ f;\n"],
        // Prettier is right about these.
        ["@a: darken(@b,10%/* why */);\n", "@a: darken(@b, 10% /* why */);\n", null],
        ["@a: 1px; /* why */\n", "@a: 1px; /* why */\n", null],
        ["@a: 1px // why\n  solid;\n", "@a: 1px // why\n  solid;\n", null],
      ])("%j", async (before, after, byPrettier) => {
        expect(after).not.toBe(byPrettier);
        const files = { "a.less": before, "b.less": after };
        const [result, asOxfmt] = await Promise.all([
          format(files, [], { reads: ["a.less", "b.less"] }),
          format(files, ["--flavor=oxfmt"], { reads: ["a.less", "b.less"] }),
        ]);
        expect(result.files).toEqual({ "a.less": after, "b.less": after });
        expect(result.exitCode).toBe(0);
        expect(asOxfmt.files).toEqual({ "a.less": after, "b.less": after });
        expect(asOxfmt.exitCode).toBe(0);
      });
    });

    describe("a comment between the head of a statement and its { or ;", () => {
      // Each row is the language, the code, Bun's output and Prettier 3.9.9's output. Prettier cuts a comment that's
      // the only thing after the name one character short, and it puts the `{` or `;` from the next line after a `//`
      // comment, which makes it part of the comment.
      test.each([
        [
          "scss",
          "@if $a {\n  b: c;\n} @else /* why */ {\n  d: e;\n}\n",
          "@if $a {\n  b: c;\n} @else /* why */ {\n  d: e;\n}\n",
          "@if $a {\n  b: c;\n} @else  /* why * {\n  d: e;\n}\n",
        ],
        [
          "scss",
          "@else /* a */ /* b */ {\n}\n@function /* a */ {\n}\n@return /* a */;\n",
          "@else /* a */ /* b */ {\n}\n@function /* a */ {\n}\n@return /* a */;\n",
          "@else  /* a *  /* b * {\n}\n@function  /* a * {\n}\n@return  /* a *;\n",
        ],
        [
          "scss",
          "@if $a {\n  b: c;\n} @else // why\n{\n  d: e;\n}\n",
          "@if $a {\n  b: c;\n} @else // why\n{\n  d: e;\n}\n",
          "@if $a {\n  b: c;\n} @else  { // wh\n  d: e;\n}\n",
        ],
        [
          "scss",
          "@media (min-width: 1px) // Why\n{\n  a {\n    b: c;\n  }\n}\n",
          "@media (min-width: 1px) // Why\n{\n  a {\n    b: c;\n  }\n}\n",
          "@media (min-width: 1px) // Why {\n  a {\n    b: c;\n  }\n}\n",
        ],
        [
          "less",
          "@media (min-width: 1px) // Why\n{\n  a {\n    b: c;\n  }\n}\n",
          "@media (min-width: 1px) // Why\n{\n  a {\n    b: c;\n  }\n}\n",
          "@media (min-width: 1px) // Why {\n  a {\n    b: c;\n  }\n}\n",
        ],
        [
          "scss",
          "@media screen // Why\n  and (min-width: 1px) {\n  a {\n    b: c;\n  }\n}\n",
          "@media screen // Why\n  and (min-width: 1px) {\n  a {\n    b: c;\n  }\n}\n",
          "@media screen // Why and (min-width: 1px) {\n  a {\n    b: c;\n  }\n}\n",
        ],
        ["scss", "@if $a// why\n{\n  b: c;\n}\n", "@if $a // why\n{\n  b: c;\n}\n", "@if $a// why {\n  b: c;\n}\n"],
        [
          "scss",
          "a {\n  @extend .b // why\n  ;\n  c: d\n}\n",
          "a {\n  @extend .b; // why\n  c: d;\n}\n",
          "a {\n  @extend .b // why;\n  c: d;\n}\n",
        ],
        [
          "scss",
          '@warn "a" // why\n;\n@b c // why\n;\n',
          '@warn "a"; // why\n@b c; // why\n',
          '@warn "a" // why;\n@b c // why;\n',
        ],
        ["scss", "$a: b// why\n;\n$c: 1;\n", "$a: b; // why\n$c: 1;\n", "$a: b// why;\n$c: 1;\n"],
        ["scss", "a { b: c// why\n; d: e }\n", "a {\n  b: c; // why\n  d: e;\n}\n", "a {\n  b: c// why;\n  d: e;\n}\n"],
        ["less", ".a() // why\n;\n.b();\n", ".a(); // why\n.b();\n", ".a() // why;\n.b();\n"],
        // Before it parses Less, Prettier replaces every quote and `*` after a `//` with a space.
        ["less", '.a() // "why"\n;\n.b();\n', '.a(); // "why"\n.b();\n', ".a() //  why;\n.b();\n"],
        [
          "less",
          'a { b: c//"why"\n; d: e }\n',
          'a {\n  b: c; //"why"\n  d: e;\n}\n',
          "a {\n  b: c// why;\n  d: e;\n}\n",
        ],
        ["less", "@plugin \"a\" // 'why'\n;\n", "@plugin \"a\"; // 'why'\n", '@plugin "a" //  why;\n'],
        // Prettier is right about these.
        ["scss", "@if $a // why\n{\n  b: c;\n}\n", "@if $a // why\n{\n  b: c;\n}\n", null],
        ["scss", "a // why\n{\n  b: c;\n}\n", "a // why\n{\n  b: c;\n}\n", null],
        ["scss", "@a b // why\n{\n  c: d;\n}\n", "@a b // why\n{\n  c: d;\n}\n", null],
        ["scss", "@include a // why\n;\n$b: c // why\n;\n", "@include a; // why\n$b: c; // why\n", null],
        [
          "scss",
          "@media (min-width: 1px) /* Why */ {\n  a {\n    b: c;\n  }\n}\n",
          "@media (min-width: 1px) /* Why */ {\n  a {\n    b: c;\n  }\n}\n",
          null,
        ],
        [
          "scss",
          "@include a(url(http://b)) {\n  c: d;\n}\n@import url(http://b);\n",
          "@include a(url(http://b)) {\n  c: d;\n}\n@import url(http://b);\n",
          null,
        ],
      ])("%s: %j", async (language, before, after, byPrettier) => {
        expect(after).not.toBe(byPrettier);
        const files = { [`a.${language}`]: before, [`b.${language}`]: after };
        const names = Object.keys(files);
        const [result, asOxfmt] = await Promise.all([
          format(files, [], { reads: names }),
          format(files, ["--flavor=oxfmt"], { reads: names }),
        ]);
        const expected = Object.fromEntries(names.map(name => [name, after]));
        expect(result.files).toEqual(expected);
        expect(result.exitCode).toBe(0);
        expect(asOxfmt.files).toEqual(expected);
        expect(asOxfmt.exitCode).toBe(0);
      });
    });

    describe("a selector or value in which a space is significant", () => {
      /** Formats `before` and `after` as CSS, SCSS and Less, in both flavors, and expects `after` each time. */
      async function expectFormatted(before: string, after: string) {
        const files = Object.fromEntries(
          ["css", "scss", "less"].flatMap(language => [
            [`a.${language}`, before],
            [`b.${language}`, after],
          ]),
        );
        const names = Object.keys(files);
        const [result, asOxfmt] = await Promise.all([
          format(files, [], { reads: names }),
          format(files, ["--flavor=oxfmt"], { reads: names }),
        ]);
        const expected = Object.fromEntries(names.map(name => [name, after]));
        expect(result.files).toEqual(expected);
        expect(result.exitCode).toBe(0);
        expect(asOxfmt.files).toEqual(expected);
        expect(asOxfmt.exitCode).toBe(0);
      }

      // Each row is the selector, Bun's output and Prettier 3.9.9's output. oxfmt 0.72.0 is right about all of them.
      test.each([
        // With a space after the sign it isn't a valid selector, and the browser drops the rule.
        [":nth-child(+n+3)", ":nth-child(+n + 3)", ":nth-child(+ n + 3)"],
        [":nth-child(+3)", ":nth-child(+3)", ":nth-child(+ 3)"],
        ["li:nth-child(+2n+1)", "li:nth-child(+2n + 1)", "li:nth-child(+ 2n + 1)"],
        [":nth-last-child(+n + 2)", ":nth-last-child(+n + 2)", ":nth-last-child(+ n + 2)"],
        [":nth-col(+2)", ":nth-col(+2)", ":nth-col(+ 2)"],
        [":NTH-CHILD(+N+3 of .a)", ":nth-child(+N + 3 of .a)", ":nth-child(+ N + 3 of .a)"],
        // The first space after `\31` ends the escape, so only the second one makes `.b` a descendant.
        [".\\31  .b", ".\\31  .b", ".\\31 .b"],
        ["#\\31  li", "#\\31  li", "#\\31 li"],
        [".\\e9  a", ".\\e9  a", ".\\e9 a"],
        [".\\31 \\30  .b", ".\\31 \\30  .b", ".\\31 \\30 .b"],
        [".\\000031  b", ".\\000031  b", ".\\000031 b"],
        ["a:not(.\\31  b)", "a:not(.\\31  b)", "a:not(.\\31 b)"],
        [".\\31 \n.b", ".\\31  .b", ".\\31 .b"],
        // The value is "x1i", and there's no flag.
        ["[a=x\\31 i]", '[a="x\\31 i"]', '[a="x\\31" i]'],
        // The value is "b c". Prettier prints an unterminated string.
        ["[a=b\\ c]", '[a="b\\ c"]', '[a="b\\" c]'],
        ["[a=b\\ c i]", '[a="b\\ c" i]', '[a="b\\" c i]'],
        // Prettier is right about these.
        [":nth-child(+ n)", ":nth-child(+ n)", null],
        [":nth-child(-n+3)", ":nth-child(-n + 3)", null],
        [":nth-child(2n+1)", ":nth-child(2n + 1)", null],
        ["a:has(+b)", "a:has(+ b)", null],
        [".\\31 .b", ".\\31 .b", null],
        [".\\31 0", ".\\31 0", null],
        [".\\31 > b", ".\\31 > b", null],
        [".\\\\31  b", ".\\\\31 b", null],
        [".a\\:b  c", ".a\\:b c", null],
        ["[a=x\\31  i]", '[a="x\\31" i]', null],
        ["[a=b i]", '[a="b" i]', null],
        ["[a=b s]", '[a="b" s]', null],
      ])("%j", async (before, after, byPrettier) => {
        expect(after).not.toBe(byPrettier);
        await expectFormatted(`${before}{c:d}\n`, `${after} {\n  c: d;\n}\n`);
      });

      // The same for whole style sheets.
      test.each([
        [
          "@keyframes x{+50%{a:b}}\n",
          "@keyframes x {\n  +50% {\n    a: b;\n  }\n}\n",
          "@keyframes x {\n  + 50% {\n    a: b;\n  }\n}\n",
        ],
        ["a{animation-name:\\31  x}\n", "a {\n  animation-name: \\31  x;\n}\n", "a {\n  animation-name: \\31 x;\n}\n"],
        [
          'a{b:\\31  x \\e9  "y" \\31 z}\n',
          'a {\n  b: \\31  x \\e9  "y" \\31 z;\n}\n',
          'a {\n  b: \\31 x \\e9"y" \\31 z;\n}\n',
        ],
        ["a{+b{c:d}}\n", "a {\n  + b {\n    c: d;\n  }\n}\n", null],
      ])("%j", async (before, after, byPrettier) => {
        expect(after).not.toBe(byPrettier);
        await expectFormatted(before, after);
      });

      // `\31 abc` is the single word "1abc". Each row is the start of a declaration that's too long for 80 columns, its
      // end in Bun's output, and its end in Prettier 3.9.9's output, which splits it into "1" and "abc". oxfmt 0.72.0
      // leaves the line unchanged.
      test.each([
        [`animation-name: ${"word ".repeat(11)}wo`, "\n    \\31 abcdefghijklmnop", " \\31\n    abcdefghijklmnop"],
        [`--x: ${"word ".repeat(13)}wo`, "\n    \\31 abcdefghijklmnop", " \\31\n    abcdefghijklmnop"],
        [`b: ${"word ".repeat(13)}wor`, "\n    x\\31 abcdefghijklmnop", " x\\31\n    abcdefghijklmnop"],
      ])("%j", async (start, end, byPrettier) => {
        expect(end).not.toBe(byPrettier);
        const [onOneLine, after] = [`a {\n  ${start} ${end.trim()};\n}\n`, `a {\n  ${start}${end};\n}\n`];
        const files = Object.fromEntries(
          ["css", "scss", "less"].flatMap(language => [
            [`a.${language}`, onOneLine],
            [`b.${language}`, after],
          ]),
        );
        const names = Object.keys(files);
        const [result, asOxfmt] = await Promise.all([
          format(files, [], { reads: names }),
          format(files, ["--flavor=oxfmt"], { reads: names }),
        ]);
        expect(result.files).toEqual(Object.fromEntries(names.map(name => [name, after])));
        expect(result.exitCode).toBe(0);
        // It fits in 100 columns.
        expect(asOxfmt.files).toEqual(Object.fromEntries(names.map(name => [name, onOneLine])));
        expect(asOxfmt.exitCode).toBe(0);
      });
    });

    describe("a number right before a ${} in a template", () => {
      // Each row is the declaration, which stays unchanged, and Prettier 3.9.9's output. With "px" for `u` and 5 for
      // `n`, "100px" turns into "100 px" and "0.5" into "0 5". A number that touches a `${}` isn't normalized either:
      // "1.50" and "5" make 1.505, but "1.5" and "5" make 1.55.
      test.each([
        ["width: 100${u};", "width: 100 ${u};"],
        ["opacity: 0.${n};", "opacity: 0 ${n};"],
        ["transition: all 0.${n}s;", "transition: all 0 ${n}s;"],
        ["margin: -1${u} 0;", "margin: -1 ${u} 0;"],
        ["margin: 0 -1${u};", "margin: 0 -1 ${u};"],
        ["width: 1.50${n};", "width: 1.5 ${n};"],
        ["width: 1E3${u};", "width: 1e3 ${u};"],
        ["width: +.5${u};", "width: +0.5 ${u};"],
        ["margin: 1PX${u};", "margin: 1px ${u};"],
        ["z-index: 1${n};", "z-index: 1 ${n};"],
        ["width: calc(1${u} + 2px);", "width: calc(1 ${u} + 2px);"],
        ["grid-area: 1${a} / 2${b};", "grid-area: 1 ${a} / 2 ${b};"],
        ["margin: 1${a}${b} 2${c};", "margin: 1 ${a}${b} 2 ${c};"],
        // Prettier is right about these.
        ["width: ${n}px;", null],
        ["margin: ${a} ${b} ${a}${b};", null],
        ["color: #f${n};", null],
        ["width: 100 ${u};", null],
      ])("%j", async (declaration, byPrettier) => {
        expect(declaration).not.toBe(byPrettier);
        const after = "x = styled.div`\n  " + declaration + "\n`;\n";
        const files = { "a.js": "x = styled.div`" + declaration + "`;\n", "b.js": after };
        const [result, asOxfmt] = await Promise.all([
          format(files, [], { reads: ["a.js", "b.js"] }),
          format(files, ["--flavor=oxfmt"], { reads: ["a.js", "b.js"] }),
        ]);
        expect(result.files).toEqual({ "a.js": after, "b.js": after });
        expect(result.exitCode).toBe(0);
        expect(asOxfmt.files).toEqual({ "a.js": after, "b.js": after });
        expect(asOxfmt.exitCode).toBe(0);
      });

      test("a number followed by a space is still normalized", async () => {
        const result = await format({ "a.js": "x = styled.div`width: 1.50PX ${u};`;\n" }, [], { reads: ["a.js"] });
        expect(result.files).toEqual({ "a.js": "x = styled.div`\n  width: 1.5px ${u};\n`;\n" });
        expect(result.exitCode).toBe(0);
      });
    });

    describe("a name that only looks like a property", () => {
      // Each row is the code, Bun's output and Prettier 3.9.9's output. Tailwind CSS 4 passes the contents of
      // `@plugin`'s braces to the plugin as an object, and `font-variant-alternates: styleset(niceStyle)` looks up that
      // exact name.
      test.each([
        [
          '@plugin "@tailwindcss/typography" {className:wysiwyg}\n',
          '@plugin "@tailwindcss/typography" {\n  className: wysiwyg;\n}\n',
          '@plugin "@tailwindcss/typography" {\n  classname: wysiwyg;\n}\n',
        ],
        [
          '@plugin "./my-plugin.js" {darkMode:class;maxWidth:10px}\n',
          '@plugin "./my-plugin.js" {\n  darkMode: class;\n  maxWidth: 10px;\n}\n',
          '@plugin "./my-plugin.js" {\n  darkmode: class;\n  maxwidth: 10px;\n}\n',
        ],
        [
          "@font-feature-values Font One {@styleset {niceStyle:12} @swash {Fancy:1}}\n",
          "@font-feature-values Font One {\n  @styleset {\n    niceStyle: 12;\n  }\n  @swash {\n    Fancy: 1;\n  }\n}\n",
          "@font-feature-values Font One {\n  @styleset {\n    nicestyle: 12;\n  }\n  @swash {\n    fancy: 1;\n  }\n}\n",
        ],
        // Properties and descriptors are case-insensitive.
        [
          "@font-face {FONT-FAMILY:a}\na{COLOR:red}\n@media print{a{COLOR:red}}\n",
          "@font-face {\n  font-family: a;\n}\na {\n  color: red;\n}\n@media print {\n  a {\n    color: red;\n  }\n}\n",
          null,
        ],
      ])("%j", async (before, after, byPrettier) => {
        expect(after).not.toBe(byPrettier);
        const files = Object.fromEntries(
          ["css", "scss", "less"].flatMap(language => [
            [`a.${language}`, before],
            [`b.${language}`, after],
          ]),
        );
        const names = Object.keys(files);
        const [result, asOxfmt] = await Promise.all([
          format(files, [], { reads: names }),
          format(files, ["--flavor=oxfmt"], { reads: names }),
        ]);
        const expected = Object.fromEntries(names.map(name => [name, after]));
        expect(result.files).toEqual(expected);
        expect(result.exitCode).toBe(0);
        expect(asOxfmt.files).toEqual(expected);
        expect(asOxfmt.exitCode).toBe(0);
      });

      test("still lowercases the same name in a rule in the same file", async () => {
        // A declaration's printed form is cached for the next one with the same text.
        const result = await format(
          { "a.css": '@plugin "a" {maxWidth:1px}\nb{maxWidth:1px}\n@plugin "a" {maxWidth:1px}\n' },
          [],
          {
            reads: ["a.css"],
          },
        );
        expect(result.files).toEqual({
          "a.css": '@plugin "a" {\n  maxWidth: 1px;\n}\nb {\n  maxwidth: 1px;\n}\n@plugin "a" {\n  maxWidth: 1px;\n}\n',
        });
        expect(result.exitCode).toBe(0);
      });
    });

    describe("the value of a custom property", () => {
      // Each row is the value, Bun's output, Bun's output in the oxfmt flavor, and Prettier 3.9.9's output.
      // `getPropertyValue("--x")` returns what the author wrote, and `@container style(--x: #FFF)` compares against it.
      // So colors, numbers, units, keywords and strings stay as written, and no space is added where there was none.
      // The layout is still the tool's: whitespace is collapsed, and a long value is broken. oxfmt 0.72.0 rewrites what
      // Prettier rewrites, except that it leaves `16:9`, `a*b` and `a+b` alone.
      test.each([
        ["#FFF", "#FFF", "#FFF", "#fff"],
        ["#AbCdEf", "#AbCdEf", "#AbCdEf", "#abcdef"],
        ["1E3", "1E3", "1E3", "1e3"],
        ["1PX", "1PX", "1PX", "1px"],
        [".50", ".50", ".50", "0.5"],
        ["0.50em 1.0em", "0.50em 1.0em", "0.50em 1.0em", "0.5em 1em"],
        ["+.5", "+.5", "+.5", "+0.5"],
        ["1.", "1.", "1.", "1"],
        ["INHERIT", "INHERIT", "INHERIT", "inherit"],
        ["'a'", "'a'", "'a'", '"a"'],
        ["\"a\",'b'", "\"a\",'b'", "\"a\",'b'", '"a", "b"'],
        ["1,000", "1,000", "1,000", "1, 000"],
        ["16:9", "16:9", "16:9", "16: 9"],
        ["a,b", "a,b", "a,b", "a, b"],
        ["a ,b", "a,b", "a,b", "a, b"],
        ["a*b", "a*b", "a*b", "a * b"],
        ["a+b", "a+b", "a+b", "a + b"],
        ["a:b", "a:b", "a:b", "a: b"],
        ["(a:b)", "(a:b)", "(a:b)", "(a: b)"],
        ["rgba(0,0,0,.5)", "rgba(0,0,0,.5)", "rgba(0,0,0,.5)", "rgba(0, 0, 0, 0.5)"],
        ["translate(1PX,2PX)", "translate(1PX,2PX)", "translate(1PX,2PX)", "translate(1px, 2px)"],
        ["calc( 1PX + .50EM )", "calc(1PX + .50EM)", "calc(1PX + .50EM)", "calc(1px + 0.5em)"],
        ['[{"a":1}]', '[{"a":1}]', '[{"a":1}]', '[{"a": 1}]'],
        ["['red' ]", "['red']", "['red']", '[ "red"]'],
        [
          "[ 'red', 'green', 'blue' ]",
          "[ 'red', 'green', 'blue']",
          "['red', 'green', 'blue']",
          '[ "red", "green", "blue"]',
        ],
        ["#FFF   RED", "#FFF RED", "#FFF RED", "#fff RED"],
        ["#FFF,\n     #EEE", "#FFF, #EEE", "#FFF, #EEE", "#fff, #eee"],
        // Prettier is right about these.
        ["a  b", "a b", "a b", null],
        ["a /* c */  b", "a /* c */ b", "a /* c */ b", null],
        ["1px   2px", "1px 2px", "1px 2px", null],
        ['[1,  "2",  [4]]', '[1, "2", [4]]', '[1, "2", [4]]', null],
        ['"a:b"   c', '"a:b" c', '"a:b" c', null],
        ["url(data:x)   c", "url(data:x) c", "url(data:x) c", null],
        ["$a   b", "$a b", "$a b", null],
        ["[ a ]", "[ a]", "[a]", null],
        ["[ a b ]", "[ a b]", "[a b]", null],
        ["f(x)  {  y  }", "f(x) {y}", "f(x)  {  y  }", null],
        ["(a  ,  b)", "(a, b)", "(a  ,  b)", null],
        ["1px   !foo", "1px !foo", "1px   !foo", null],
        ["@a   b", "@a b", "@a   b", null],
        ["a:  b", "a: b", "a:  b", null],
        [
          "rgb(from var(--color-text-on-media-of-the-page) r g b / var(--overlay-strength-secondary))",
          "rgb(\n    from var(--color-text-on-media-of-the-page) r g b /\n      var(--overlay-strength-secondary)\n  )",
          "rgb(from var(--color-text-on-media-of-the-page) r g b / var(--overlay-strength-secondary))",
          null,
        ],
        ["Red", "Red", "Red", null],
        ["calc(1px+2px)", "calc(1px+2px)", "calc(1px+2px)", null],
        ["var(--Y)", "var(--Y)", "var(--Y)", null],
        ['"a  b"', '"a  b"', '"a  b"', null],
      ])("%j", async (value, after, afterAsOxfmt, byPrettier) => {
        expect(after).not.toBe(byPrettier);
        // Where the flavors differ, so do the languages.
        const languages = after === afterAsOxfmt ? ["css", "scss", "less"] : ["css"];
        const sheets = (before: string, after: string) =>
          Object.fromEntries(
            languages.flatMap(language => [
              [`a.${language}`, `a {\n  --x: ${before};\n}\n`],
              [`b.${language}`, `a {\n  --x: ${after};\n}\n`],
              [`c.${language}`, `a{--x:${before}}\n`],
            ]),
          );
        const names = Object.keys(sheets(value, after));
        const [result, asOxfmt] = await Promise.all([
          format(sheets(value, after), [], { reads: names }),
          format(sheets(value, afterAsOxfmt), ["--flavor=oxfmt"], { reads: names }),
        ]);
        expect(result.files).toEqual(Object.fromEntries(names.map(name => [name, `a {\n  --x: ${after};\n}\n`])));
        expect(result.exitCode).toBe(0);
        expect(asOxfmt.files).toEqual(
          Object.fromEntries(names.map(name => [name, `a {\n  --x: ${afterAsOxfmt};\n}\n`])),
        );
        expect(asOxfmt.exitCode).toBe(0);
      });

      // In a value that doesn't fit on the line, no line ends after a comma that has no space after it. Each row is the
      // value, what follows `--x:` in Bun's output, the same in the oxfmt flavor, which has 100 columns, and the same
      // in Prettier 3.9.9's output. oxfmt 0.72.0 adds the same spaces and line breaks as Prettier. A line break right
      // inside a function's parentheses means nothing to CSS.
      const thousands = Array(16).fill("1,000").join(",");
      const fonts =
        '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans",sans-serif,"Apple Color Emoji"';
      const zeros = "0".repeat(21);
      const [a, b, c, d] = ["a".repeat(25), "b".repeat(31), "c".repeat(24), "d".repeat(23)];
      test.each([
        [
          thousands,
          `\n    ${thousands}`,
          `\n    ${thousands}`,
          `\n    ${"1, 000, ".repeat(9)}1,\n    000, ${"1, 000, ".repeat(5)}1, 000`,
        ],
        [
          fonts,
          `\n    ${fonts}`,
          `\n    ${fonts}`,
          '\n    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",\n    Arial, "Noto Sans", sans-serif, "Apple Color Emoji"',
        ],
        [
          '-apple-system, BlinkMacSystemFont,"Segoe UI", Roboto,"Helvetica Neue", Arial,"Noto Sans", sans-serif,"Apple Color Emoji"',
          '\n    -apple-system, BlinkMacSystemFont,"Segoe UI", Roboto,"Helvetica Neue",\n    Arial,"Noto Sans", sans-serif,"Apple Color Emoji"',
          '\n    -apple-system, BlinkMacSystemFont,"Segoe UI", Roboto,"Helvetica Neue", Arial,"Noto Sans",\n    sans-serif,"Apple Color Emoji"',
          '\n    -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue",\n    Arial, "Noto Sans", sans-serif, "Apple Color Emoji"',
        ],
        [
          `rgba(${zeros},${zeros},${zeros},${zeros},.5)`,
          ` rgba(\n    ${zeros},${zeros},${zeros},${zeros},.5\n  )`,
          ` rgba(\n    ${zeros},${zeros},${zeros},${zeros},.5\n  )`,
          ` rgba(\n    ${zeros},\n    ${zeros},\n    ${zeros},\n    ${zeros},\n    0.5\n  )`,
        ],
        [
          `f(${a},${b}, ${c},${d})`,
          ` f(\n    ${a},${b},\n    ${c},${d}\n  )`,
          ` f(\n    ${a},${b},\n    ${c},${d}\n  )`,
          ` f(\n    ${a},\n    ${b},\n    ${c},\n    ${d}\n  )`,
        ],
        [
          `f( ${a},${b},${c},${d} )`,
          ` f(\n    ${a},${b},${c},${d}\n  )`,
          ` f(\n    ${a},${b},${c},${d}\n  )`,
          ` f(\n    ${a},\n    ${b},\n    ${c},\n    ${d}\n  )`,
        ],
      ])("too long: %j", async (value, after, afterAsOxfmt, byPrettier) => {
        expect(after).not.toBe(byPrettier);
        const sheets = (after: string) =>
          Object.fromEntries(
            ["css", "scss", "less"].flatMap(language => [
              [`a.${language}`, `a {\n  --x: ${value};\n}\n`],
              [`b.${language}`, `a {\n  --x:${after};\n}\n`],
            ]),
          );
        const names = Object.keys(sheets(after));
        const [result, asOxfmt] = await Promise.all([
          format(sheets(after), [], { reads: names }),
          format(sheets(afterAsOxfmt), ["--flavor=oxfmt"], { reads: names }),
        ]);
        expect(result.files).toEqual(Object.fromEntries(names.map(name => [name, `a {\n  --x:${after};\n}\n`])));
        expect(result.exitCode).toBe(0);
        expect(asOxfmt.files).toEqual(
          Object.fromEntries(names.map(name => [name, `a {\n  --x:${afterAsOxfmt};\n}\n`])),
        );
        expect(asOxfmt.exitCode).toBe(0);
      });

      // JSON meant for a script stays unchanged. Prettier 3.9.9 and oxfmt 0.72.0 treat it as a set of declarations and
      // put a `;` in it.
      test.each([
        ['{"a":1,"b":[1,2]}', '{\n    "a":1,"b": [1, 2];\n  }'],
        ['{ "a": 1 }', '{\n    "a":1;\n  }'],
      ])("%j", async (value, byPrettier) => {
        expect(value).not.toBe(byPrettier);
        const after = `a {\n  --x: ${value};\n}\n`;
        const files = Object.fromEntries(
          ["css", "scss", "less"].flatMap(language => [
            [`a.${language}`, `a{--x:${value}}\n`],
            [`b.${language}`, after],
          ]),
        );
        const names = Object.keys(files);
        const [result, asOxfmt] = await Promise.all([
          format(files, [], { reads: names }),
          format(files, ["--flavor=oxfmt"], { reads: names }),
        ]);
        const expected = Object.fromEntries(names.map(name => [name, after]));
        expect(result.files).toEqual(expected);
        expect(result.exitCode).toBe(0);
        expect(asOxfmt.files).toEqual(expected);
        expect(asOxfmt.exitCode).toBe(0);
      });

      test("what's around the value is still formatted", async () => {
        const result = await format(
          { "a.css": "a{--X:   #FFF   !important;--y:#FFF!IMPORTANT;--z:a:b   c   !important;COLOR:#FFF}\n" },
          [],
          { reads: ["a.css"] },
        );
        expect(result.files).toEqual({
          "a.css":
            "a {\n  --X: #FFF !important;\n  --y: #FFF !important;\n  --z: a:b c !important;\n  color: #fff;\n}\n",
        });
        expect(result.exitCode).toBe(0);
      });

      test("stays as written in a style attribute and in a template literal", async () => {
        const files = {
          "a.html": '<p style="--x:#FFF;COLOR:#FFF">a</p>\n',
          "b.js": "x = css`a{--x:#FFF ${h};color:#FFF}`;\n",
          "c.js":
            "x = css`a{--x:0 0 0 1px ${(p) => p.theme.colors.main},   ${(p) => p.theme.boxShadowSoft}, ${l};}`;\n",
        };
        const result = await format(files, [], { reads: Object.keys(files) });
        expect(result.files).toEqual({
          "a.html": '<p style="--x: #FFF; color: #fff">a</p>\n',
          "b.js": "x = css`\n  a {\n    --x: #FFF ${h};\n    color: #fff;\n  }\n`;\n",
          "c.js":
            "x = css`\n  a {\n    --x:\n      0 0 0 1px ${(p) => p.theme.colors.main}, ${(p) => p.theme.boxShadowSoft},\n      ${l};\n  }\n`;\n",
        });
        expect(result.exitCode).toBe(0);
      });

      // Each row is the languages, the value, which stays unchanged, and Prettier 3.9.9's output. Prettier treats `//`
      // as the start of a comment, which it moves after the `;`. CSS has no such comment, and Less only recognizes one
      // after a space.
      test.each([
        [["css", "less"], "https://Example.com/A", "https: ; //Example.com/A"],
        // In CSS and SCSS, `/*` starts a comment here.
        [["less"], "https://*.example.com/*", "https: ; //*.example.com/*"],
        [["css", "less"], "https://example.com/a?b=\"c\"&d='e'", "https: ; //example.com/a?b=\"c\"&d='e'"],
        [["css", "less"], 'http://x.y/z /* note */ "s"', 'http: ; //x.y/z /* note */ "s"'],
        [["css", "less"], 'http://b/"c" !important', 'http:  !important; //b/"c"'],
        [["css", "less"], '{"u":http://"c"}', '{\n    "u":http: ;//"c"\n  }'],
        [["css"], "//Example.com/A", ";//Example.com/A"],
        [["css"], "#FFF // b", "#fff; // b"],
      ])("in %j: %j", async (languages, value, byPrettier) => {
        expect(`${value};`).not.toBe(byPrettier);
        const after = `a {\n  --x: ${value};\n  c: d;\n}\n`;
        const files = Object.fromEntries(
          languages.flatMap(language => [
            [`a.${language}`, `a{--x:${value};c:d}\n`],
            [`b.${language}`, after],
          ]),
        );
        const names = Object.keys(files);
        const [result, asOxfmt] = await Promise.all([
          format(files, [], { reads: names }),
          format(files, ["--flavor=oxfmt"], { reads: names }),
        ]);
        const expected = Object.fromEntries(names.map(name => [name, after]));
        expect(result.files).toEqual(expected);
        expect(result.exitCode).toBe(0);
        expect(asOxfmt.files).toEqual(expected);
        expect(asOxfmt.exitCode).toBe(0);
      });

      test("stays as written with several URLs in a row", async () => {
        // In CSS, everything from the first `/*` to the last `*/` is a comment.
        const sheet =
          "a {\n  --hosts: https://*.example.com/*;\n  --query: https://example.com/a?b=\"c\"&d='e';\n" +
          '  --note: http://x.y/z /* note */ "s";\n}\n';
        const files = { "a.css": sheet, "a.less": sheet };
        const [result, asOxfmt] = await Promise.all([
          format(files, [], { reads: Object.keys(files) }),
          format(files, ["--flavor=oxfmt"], { reads: Object.keys(files) }),
        ]);
        expect(result.files).toEqual(files);
        expect(result.exitCode).toBe(0);
        expect(asOxfmt.files).toEqual(files);
        expect(asOxfmt.exitCode).toBe(0);
      });

      test.each(['"see" https://b.example.com', "'see' https://b.example.com", "*see* https://b.example.com"])(
        "after another one with a `//` on the same line: %j",
        async value => {
          const files = { "a.less": `a { --a: https://a.example.com; --b: ${value}; }\n` };
          const after = { "a.less": `a {\n  --a: https://a.example.com;\n  --b: ${value};\n}\n` };
          for (const flags of [[], ["--flavor=oxfmt"]]) {
            const result = await format(files, flags, { reads: ["a.less"] });
            expect(result.files).toEqual(after);
            expect(result.exitCode).toBe(0);
            const again = await format(after, flags, { reads: ["a.less"] });
            expect(again.files).toEqual(after);
            expect(again.exitCode).toBe(0);
          }
        },
      );

      // oxfmt 0.72.0 prints `http:; //y "// z";`.
      test("a URL before a string with `//` stays as written in Less with the oxfmt flavor", async () => {
        const files = { "a.less": 'a {\n  --x: http://y "// z";\n}\n' };
        const result = await format(files, ["--flavor=oxfmt"], { reads: ["a.less"] });
        expect(result.files).toEqual(files);
        expect(result.exitCode).toBe(0);
      });

      test("moves a // comment in SCSS and Less after the ;", async () => {
        const files = { "a.scss": "a{--x:#FFF // c\n}\n", "a.less": "a{--x:#FFF // c\n}\n" };
        const result = await format(files, [], { reads: Object.keys(files) });
        const after = "a {\n  --x: #FFF; // c\n}\n";
        expect(result.files).toEqual({ "a.scss": after, "a.less": after });
        expect(result.exitCode).toBe(0);
      });

      test("known issue: a set of declarations for @apply is laid out as a block, like in Prettier 3.9.9", async () => {
        const result = await format({ "a.css": "a{--x:{COLOR:#FFF}}\n" }, [], { reads: ["a.css"] });
        expect(result.files).toEqual({ "a.css": "a {\n  --x: {\n    color: #fff;\n  };\n}\n" });
      });
    });
  });

  // This is what Prettier 3.9.9 does with the flag. oxfmt 0.72 doesn't have it. The comparison itself is Bun's own.
  describe.each([
    ["no config", {}, "error: "],
    [".prettierrc", { ".prettierrc": "{}\n" }, "error: "],
    [".oxfmtrc.json", { ".oxfmtrc.json": "{}\n" }, "error: "],
  ])("--debug-check with %s", (_, config: Record<string, string>, prefix) => {
    const files = { "a.js": formatted, "b.js": ugly };
    const names = Object.keys(files);
    // Without the parentheses, which neither Prettier nor Bun prints, it means the same but has a different tree.
    // Prettier's check reports it too.
    const lossy = "(a<b>)();\n";

    test("lists every file that passes, formatted or not, and doesn't write", async () => {
      const result = await format({ ...config, ...files }, ["--debug-check", ...names], { reads: names });
      expect(result.files).toEqual(files);
      expect(result.stderr).toBe("");
      expect(result.stdout.split("\n")).toEqual(["a.js", "b.js"]);
      expect(result.exitCode).toBe(0);
    });

    test("reports an error for a file whose meaning would change", async () => {
      const all = { "a.ts": lossy, "b.js": ugly };
      const result = await format({ ...config, ...all }, ["--debug-check", "a.ts", "b.js"], {
        reads: ["a.ts", "b.js"],
      });
      expect(result.files).toEqual(all);
      expect(result.stderr).toBe(problem("a.ts", "Not formatted, because formatting would change what the code does"));
      expect(result.stdout).toBe("b.js");
      expect(result.exitCode).toBe(2);
    });

    test("-l also lists unformatted files", async () => {
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

    test("rejects --write", async () => {
      const result = await format({ ...config, ...files }, ["--debug-check", "--write", ...names], { reads: names });
      expect(result.files).toEqual(files);
      expect(result.stderr.trim()).toBe(`${prefix}Cannot use --write and --debug-check together.`);
      expect(result.exitCode).toBe(1);
    });

    test("checks stdin", async () => {
      const [withPath, withParser, checked, unsafe] = await Promise.all([
        format(config, ["--debug-check", "--stdin-filepath", "x.js"], { stdin: ugly }),
        format(config, ["--debug-check", "--parser", "babel"], { stdin: ugly }),
        format(config, ["--debug-check", "--check", "--stdin-filepath", "x.js"], { stdin: ugly }),
        format(config, ["--debug-check", "--stdin-filepath", "x.ts"], { stdin: lossy }),
      ]);
      // The path, without a line break.
      expect(withPath.raw).toEndWith(`${sep}x.js`);
      expect(withPath.exitCode).toBe(0);
      expect(withParser.raw).toBe("(stdin)\n");
      expect(withParser.exitCode).toBe(0);
      // oxfmt rejects --check with --stdin-filepath.
      expect(checked.raw).toBe(".oxfmtrc.json" in config ? "" : "(stdin)\n");
      expect(checked.exitCode).toBe(1);
      expect(unsafe.raw).toBe("");
      expect(unsafe.stderr).toBe(problem("x.ts", "Not formatted, because formatting would change what the code does"));
      expect(unsafe.exitCode).toBe(2);
    });
  });

  test("formats HTML in template literals", async () => {
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

  test("leaves a template whose HTML doesn't parse unchanged and formats the rest of the file", async () => {
    const result = await format({ "a.js": 'const a = html`<div   class="b"></p>`;\nconst   b = 1;\n' }, [], {
      reads: ["a.js"],
    });
    expect(result.files).toEqual({ "a.js": 'const a = html`<div   class="b"></p>`;\nconst b = 1;\n' });
    expect(result.exitCode).toBe(0);
  });

  test("--embedded-language-formatting=off leaves HTML in templates and in Markdown unchanged", async () => {
    const files = {
      "a.js": 'const a = html`<div   class="b"></div>`;\n',
      "b.md": '```html\n<div   class="b"></div>\n```\n',
    };
    const result = await format(files, ["--embedded-language-formatting=off"], { reads: ["a.js", "b.md"] });
    expect(result.files).toEqual(files);
    expect(result.exitCode).toBe(0);
  });

  describe("HTML in a template whose substitutions Prettier changes", () => {
    // Each row is the code, Bun's output and Prettier 3.9.9's output. Prettier closes the element, so `b` is evaluated
    // twice, and it can't find its placeholder for `${b}` again once that's been lowercased. oxfmt 0.72 leaves both
    // unchanged.
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
    ])("%j", async (before, after, byPrettier) => {
      expect(after).not.toBe(byPrettier);
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

  test("formats HTML and Vue in Markdown code blocks", async () => {
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

  test("formats MDX like Prettier, with and without an .oxfmtrc.json", async () => {
    const files = { "a.mdx": "import   A from 'a'\n\n#   b\n\n<A   c='d'/>\n" };
    const printed = 'import A from "a";\n\n# b\n\n<A c="d" />\n';
    const result = await format(files, [], { reads: ["a.mdx"] });
    expect(result.files).toEqual({ "a.mdx": printed });
    expect(result.exitCode).toBe(0);
    const forOxfmt = await format({ ...files, ".oxfmtrc.json": "{}\n" }, [], { reads: ["a.mdx"] });
    expect(forOxfmt.files["a.mdx"]).toBe(printed);
    expect(forOxfmt.exitCode).toBe(0);
  });

  test("skips unsupported languages and reports an error at the end, or a warning with --allow-unsupported", async () => {
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

  describe("a language that only a Prettier plugin supports", () => {
    // A run starts a VM, and the leak check at exit takes seconds with a VM's threads.
    const timeout = isDebug || isASAN ? 120_000 : 5_000;
    // Stand-ins. This Prettier collapses spaces and logs the arguments of each call.
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
      "is formatted by the project's own Prettier, with its configuration file and the flags",
      async () => {
        const result = await format(files, ["--tab-width", "8"], { reads });
        expect(result.files["a.astro"]).toBe("<p >a</p>\n");
        expect(result.files["b.js"]).toBe("b\n");
        const calls = result.files[reads[2]]!.trim().split("\n");
        expect(calls.map(it => JSON.parse(it))).toEqual([
          { ...config, tabWidth: 8, filepath: expect.stringMatching(/[\\/]a\.astro$/) },
        ]);
        // A plugin sees native paths.
        const paths = [JSON.parse(calls[0]).filepath, ...result.files[reads[3]]!.trim().split("\n")];
        expect(paths.map(it => basename(it))).toEqual(["a.astro", "a.astro", ".prettierrc"]);
        expect(paths).toEqual(paths.map(it => resolve(it)));
        expect(result.stderr).toContain("Used your installed Prettier for 1 file in a language that needs a plugin");
        expect(result.exitCode).toBe(0);
      },
      timeout,
    );

    test("passes native paths to Prettier and its plugins, also on Windows", async () => {
      const worker = join(import.meta.dir, "../../../src/lint/js_plugin/worker");
      const head = { usesConfig: true, editorconfig: true, flags: {}, precedence: "cli-override" };
      // Stubs for what the file uses from the rest of the worker, with another system's path module.
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
      "is covered by --check and -l",
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
      "is formatted from stdin",
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

    // Same as Prettier 3.9.9 with a plugin that throws this.
    test.each<[string[], string, number]>([
      [[], "error: c.astro: SyntaxError: Unexpected token (1:2)", 2],
      [["--check"], "error: Unexpected token (1:2)", 0],
      [["--list-different"], "error: Unexpected token (1:2)", 0],
    ])(
      "from stdin, with code that doesn't parse: %j",
      async (flags, stderr, exitCode) => {
        const result = await format(files, [...flags, "--stdin-filepath", "c.astro"], { stdin: "<p>broken</p>\n" });
        expect(result).toMatchObject({ raw: "", stderr, exitCode });
      },
      timeout,
    );

    // A caller that gets the text back with exit code 0 assumes it's formatted. Prettier 3.9.9 without the plugin
    // prints `Cannot find package` and exits with 2, whatever the flags.
    describe.each([
      ["prettier, prettier-plugin-astro", []],
      ["prettier-plugin-astro", ["node_modules/prettier/package.json"]],
      ["prettier", ["node_modules/prettier-plugin-astro/package.json"]],
    ])("from stdin, with %s not installed", (missing, installed) => {
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

    // Each thread that hands off a file waits for the result, and Prettier also reads files on threads.
    test(
      "handles more files than there are threads",
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

    // Compiling the first pattern also starts JavaScriptCore, on the thread that formats the file.
    test(
      "works alongside files that compile a pattern from the configuration",
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
      "a Prettier that exits the process ends the run without corrupting any file",
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
        // Another thread may be between writing a temporary file and renaming it.
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
      "a promise that can never settle is an error for the file",
      async () => {
        const hangs = packages["node_modules/prettier/index.cjs"].replace(
          "exports.format = async (text, options) => {",
          'exports.format = async (text, options) => {\n  if (text.includes("waits")) await new Promise(() => {});',
        );
        const result = await format(
          { ...files, "node_modules/prettier/index.cjs": hangs, "c.astro": "<p   >waits</p>\n" },
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
      "timers and servers that Prettier leaves running don't keep the run alive",
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
      "shows an error thrown by Prettier the way Prettier shows it",
      async () => {
        const result = await format({ ...files, "a.astro": "broken\n" }, [], { reads });
        expect(result.files["a.astro"]).toBe("broken\n");
        expect(result.stderr).toContain("error: a.astro: SyntaxError: Unexpected token (1:2)");
        expect(result.exitCode).toBe(2);
      },
      timeout,
    );

    test(
      "is left unformatted if the plugin isn't installed, with a hint to install it",
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

  // Unless a test says otherwise, the expected output is what Prettier 3.9.9 prints on Node, with
  // prettier-plugin-packagejson 3.0.2 and sort-package-json 3.7.1.
  describe("prettier-plugin-packagejson", () => {
    const plugin = "prettier-plugin-packagejson";
    /** Like `format`, without the summary. */
    const quiet = (files: Record<string, string>, args: string[], options?: Options) =>
      format(files, ["--log-level=warn", ...args], options);
    const prettierrc = `{ "plugins": ["${plugin}"] }\n`;
    // Stand-ins whose output would show that they ran.
    const packages = {
      "node_modules/prettier/package.json": '{ "name": "prettier", "version": "3.0.0", "main": "index.cjs" }',
      "node_modules/prettier/index.cjs": `exports.resolveConfig = async () => null;
exports.format = async text => "by Prettier";
`,
      [`node_modules/${plugin}/package.json`]: `{ "name": "${plugin}", "version": "2.0.0" }`,
    };
    const [unsorted, sorted] = ['{ "version": "1", "name": "a" }\n', '{\n  "name": "a",\n  "version": "1"\n}\n'];
    const onlyFormatted = '{\n  "version": "1",\n  "name": "a"\n}\n';
    const rows: [title: string, before: object, after: object][] = [
      [
        "top-level keys",
        {
          "_b": 1,
          "zeta": 1,
          "dependencies": {},
          "_a": 1,
          "version": "1.0.0",
          "alpha": 1,
          "scripts": {},
          "name": "a",
          "$schema": "s",
          "exports": {},
          "main": "m",
          "type": "module",
          "license": "MIT",
          "description": "d",
          "private": true,
          "Beta": 1,
          "pnpm": {},
          "engines": {},
          "packageManager": "bun@1",
          "files": [],
          "devDependencies": {},
          "types": "t",
          "bin": {},
          "author": "a",
          "repository": "r",
          "keywords": [],
          "homepage": "h",
          "bugs": "b",
          "publishConfig": {},
          "peerDependencies": {},
          "workspaces": [],
          "sideEffects": false,
          "module": "m",
          "browser": "b",
          "imports": {},
          "overrides": {},
          "resolutions": {},
          "optionalDependencies": {},
          "lint-staged": {},
          "prettier": {},
          "eslintConfig": {},
          "jest": {},
          "husky": {},
          "config": {},
          "os": [],
          "cpu": [],
          "volta": {},
          "funding": "f",
          "contributors": [],
          "man": "m",
          "directories": {},
          "displayName": "A",
        },
        {
          "$schema": "s",
          "name": "a",
          "displayName": "A",
          "version": "1.0.0",
          "private": true,
          "description": "d",
          "keywords": [],
          "homepage": "h",
          "bugs": "b",
          "repository": "r",
          "funding": "f",
          "license": "MIT",
          "author": "a",
          "contributors": [],
          "sideEffects": false,
          "type": "module",
          "imports": {},
          "exports": {},
          "main": "m",
          "module": "m",
          "browser": "b",
          "types": "t",
          "bin": {},
          "man": "m",
          "directories": {},
          "files": [],
          "workspaces": [],
          "scripts": {},
          "husky": {},
          "lint-staged": {},
          "config": {},
          "prettier": {},
          "eslintConfig": {},
          "jest": {},
          "resolutions": {},
          "overrides": {},
          "dependencies": {},
          "devDependencies": {},
          "peerDependencies": {},
          "optionalDependencies": {},
          "packageManager": "bun@1",
          "engines": {},
          "volta": {},
          "os": [],
          "cpu": [],
          "publishConfig": {},
          "pnpm": {},
          "Beta": 1,
          "alpha": 1,
          "zeta": 1,
          "_a": 1,
          "_b": 1,
        },
      ],
      [
        "objects with their own key order",
        {
          "bugs": { "email": "e", "url": "u", "a": 1 },
          "repository": { "directory": "d", "url": "u", "type": "git" },
          "funding": { "url": "u", "type": "t" },
          "license": { "url": "u", "type": "t" },
          "author": { "url": "u", "email": "e", "name": "n" },
          "maintainers": [{ "email": "e", "name": "n" }, "x"],
          "contributors": [{ "url": "u", "name": "n" }],
          "directories": { "test": "t", "example": "e", "doc": "d", "man": "m", "bin": "b", "lib": "l", "a": "a" },
          "binary": { "host": "h", "package_name": "p", "remote_path": "r", "module_path": "p", "module_name": "n" },
          "volta": { "yarn": "1", "npm": "1", "node": "1" },
          "badges": [{ "href": "h", "url": "u", "description": "d" }],
          "devEngines": {
            "runtime": { "version": "1", "name": "bun" },
            "packageManager": { "onFail": "warn", "version": "1", "name": "bun" },
          },
          "husky": { "hooks": { "pre-push": "a", "commit-msg": "b", "pre-commit": "c", "custom": "d" } },
          "simple-git-hooks": { "post-merge": "a", "pre-commit": "b" },
        },
        {
          "bugs": { "url": "u", "email": "e", "a": 1 },
          "repository": { "type": "git", "url": "u", "directory": "d" },
          "funding": { "type": "t", "url": "u" },
          "license": { "type": "t", "url": "u" },
          "author": { "name": "n", "email": "e", "url": "u" },
          "maintainers": [{ "name": "n", "email": "e" }, "x"],
          "contributors": [{ "name": "n", "url": "u" }],
          "directories": { "lib": "l", "bin": "b", "man": "m", "doc": "d", "example": "e", "test": "t", "a": "a" },
          "binary": { "module_name": "n", "module_path": "p", "remote_path": "r", "package_name": "p", "host": "h" },
          "husky": { "hooks": { "pre-commit": "c", "commit-msg": "b", "pre-push": "a", "custom": "d" } },
          "simple-git-hooks": { "pre-commit": "b", "post-merge": "a" },
          "devEngines": {
            "runtime": { "version": "1", "name": "bun" },
            "packageManager": { "name": "bun", "version": "1", "onFail": "warn" },
          },
          "volta": { "node": "1", "npm": "1", "yarn": "1" },
          "badges": [{ "description": "d", "url": "u", "href": "h" }],
        },
      ],
      [
        "objects that are sorted by name, and objects that aren't",
        {
          "bin": { "b": 1, "a": 1 },
          "contributes": { "b": { "d": 1, "c": 1 }, "a": 1 },
          "config": { "b": 1, "a": 1 },
          "babel": { "presets": [], "plugins": [] },
          "jest": { "b": { "d": 1, "c": 1 }, "a": 1 },
          "engines": { "npm": "1", "node": "1" },
          "publishConfig": { "registry": "r", "access": "a" },
          "resolutions": { "b": "1", "a": "1" },
          "oclif": { "b": { "d": 1, "c": { "f": 1, "e": 1 } }, "a": 1 },
          "peerDependenciesMeta": { "b": { "optional": true, "a": 1 }, "a": {} },
          "dependenciesMeta": { "b@2": { "unplugged": true, "built": true }, "b@1": {}, "@s/a@1": {}, "a": {} },
          "imports": { "#b": 1, "#a": 1 },
          "typesVersions": { "b": 1, "a": 1 },
          "lint-staged": { "b": 1, "a": 1 },
          "stylelint": { "b": 1, "a": 1 },
          "browserslist": ["b", "a"],
          "unknown": { "b": 1, "a": 1 },
        },
        {
          "imports": { "#b": 1, "#a": 1 },
          "typesVersions": { "b": 1, "a": 1 },
          "bin": { "a": 1, "b": 1 },
          "contributes": { "a": 1, "b": { "d": 1, "c": 1 } },
          "lint-staged": { "b": 1, "a": 1 },
          "config": { "a": 1, "b": 1 },
          "babel": { "plugins": [], "presets": [] },
          "browserslist": ["b", "a"],
          "stylelint": { "b": 1, "a": 1 },
          "jest": { "a": 1, "b": { "d": 1, "c": 1 } },
          "oclif": { "a": 1, "b": { "c": { "e": 1, "f": 1 }, "d": 1 } },
          "resolutions": { "a": "1", "b": "1" },
          "dependenciesMeta": { "@s/a@1": {}, "a": {}, "b@2": { "built": true, "unplugged": true }, "b@1": {} },
          "peerDependenciesMeta": { "a": {}, "b": { "a": 1, "optional": true } },
          "engines": { "node": "1", "npm": "1" },
          "publishConfig": { "access": "a", "registry": "r" },
          "unknown": { "b": 1, "a": 1 },
        },
      ],
      [
        "arrays",
        {
          "keywords": ["b", "a", "b"],
          "categories": ["b", "a", "b"],
          "files": ["b", "a", "b"],
          "activationEvents": ["b", "a", "b"],
          "bundledDependencies": ["b", "a", "b"],
          "bundleDependencies": ["b", "a", "B", "b"],
          "extensionPack": ["b", "a", "b"],
          "extensionDependencies": ["b", "a"],
          "os": ["b", "a", "b"],
          "man": ["b", "a", "b"],
          "workspaces": ["b", "a", "b"],
        },
        {
          "categories": ["b", "a"],
          "keywords": ["b", "a"],
          "man": ["b", "a", "b"],
          "files": ["b", "a"],
          "workspaces": ["b", "a", "b"],
          "activationEvents": ["b", "a"],
          "bundledDependencies": ["a", "b"],
          "bundleDependencies": ["B", "a", "b"],
          "extensionPack": ["a", "b"],
          "extensionDependencies": ["a", "b"],
          "os": ["b", "a", "b"],
        },
      ],
      [
        "an array with anything other than strings is left alone",
        { "keywords": ["b", 1, "b"], "bundledDependencies": ["b", "a", null, "b"] },
        { "keywords": ["b", 1, "b"], "bundledDependencies": ["b", "a", null, "b"] },
      ],
      [
        "exports",
        {
          "exports": {
            "default": "./d.js",
            "./b": {
              "default": "./b.js",
              "require": "./b.cjs",
              "import": { "default": "./b.mjs", "types": "./b.d.ts" },
            },
            "types": "./t.d.ts",
            ".": "./a.js",
            "./a": ["./a.js", { "default": 1, "node": 2 }],
          },
        },
        {
          "exports": {
            "./b": {
              "require": "./b.cjs",
              "import": { "types": "./b.d.ts", "default": "./b.mjs" },
              "default": "./b.js",
            },
            ".": "./a.js",
            "./a": ["./a.js", { "default": 1, "node": 2 }],
            "types": "./t.d.ts",
            "default": "./d.js",
          },
        },
      ],
      [
        "scripts",
        {
          "scripts": {
            "test": "t",
            "lint:fix": "f",
            "postbuild": "p",
            "build:b": "b",
            "lint": "l",
            "build-all": "a",
            "prebuild": "p",
            "build:a:z": "z",
            "build": "b",
            "build:a": "a",
            "pretest": "p",
            "prepare": "p",
            "postinstall": "p",
            "preinstall": "p",
            "presto": "p",
            "lint:": "x",
            ":a": "y",
            "postlint": "z",
          },
          "betterScripts": { "b": "b", "preb": "p", "a": "a" },
        },
        {
          "scripts": {
            ":a": "y",
            "prebuild": "p",
            "build": "b",
            "postbuild": "p",
            "build:a": "a",
            "build:a:z": "z",
            "build:b": "b",
            "build-all": "a",
            "preinstall": "p",
            "postinstall": "p",
            "lint": "l",
            "postlint": "z",
            "lint:": "x",
            "lint:fix": "f",
            "prepare": "p",
            "presto": "p",
            "pretest": "p",
            "test": "t",
          },
          "betterScripts": { "a": "a", "preb": "p", "b": "b" },
        },
      ],
      [
        "scripts keep their order if run-s runs them in that order",
        {
          "scripts": { "build:b": "b", "prebuild": "p", "build:a": "a", "build": "run-s build:*", "a": "a" },
          "devDependencies": { "npm-run-all": "1" },
        },
        {
          "scripts": { "build:b": "b", "prebuild": "p", "build": "run-s build:*", "build:a": "a", "a": "a" },
          "devDependencies": { "npm-run-all": "1" },
        },
      ],
      [
        "scripts keep their order with npm-run-all --serial too",
        {
          "scripts": { "c": "c", "b": "echo && npm-run-all2 x --serial b:*; echo", "a": "a" },
          "devDependencies": { "npm-run-all2": "1" },
        },
        {
          "scripts": { "c": "c", "b": "echo && npm-run-all2 x --serial b:*; echo", "a": "a" },
          "devDependencies": { "npm-run-all2": "1" },
        },
      ],
      [
        "scripts are sorted if npm-run-all isn't a dependency",
        { "scripts": { "c": "c", "b": "run-s b:*", "a": "a" }, "devDependencies": { "other": "1" } },
        { "scripts": { "a": "a", "b": "run-s b:*", "c": "c" }, "devDependencies": { "other": "1" } },
      ],
      [
        "scripts are sorted without a pattern, or if they run in parallel",
        {
          "scripts": { "d": "npm-run-all -p b:*", "c": "run-s b a", "b": "xrun-s b:*", "a": "run-sx a:*" },
          "devDependencies": { "npm-run-all": "1" },
        },
        {
          "scripts": { "a": "run-sx a:*", "b": "xrun-s b:*", "c": "run-s b a", "d": "npm-run-all -p b:*" },
          "devDependencies": { "npm-run-all": "1" },
        },
      ],
      [
        "dependencies in npm's order",
        {
          "dependencies": {
            "b": "1",
            "@b/a": "1",
            "B": "1",
            "a": "1",
            "a-b": "1",
            "a_b": "1",
            "@a/b": "1",
            "a.b": "1",
            "A": "1",
            "a1": "1",
            "a10": "1",
            "a2": "1",
          },
          "devDependencies": { "b": "1", "B": "1", "a": "1" },
          "peerDependencies": { "b": "1", "B": "1", "a": "1" },
          "optionalDependencies": { "b": "1", "B": "1", "a": "1" },
          "overrides": { "b": { "d": "1", "c": "1" }, "B": "1", "a": "1" },
          "workspaces": {
            "catalog": { "b": "1", "B": "1", "a": "1" },
            "nohoist": ["b", "a"],
            "packages": ["b", "a", "b"],
            "catalogs": { "b": { "d": "1", "c": "1" }, "a": {} },
          },
        },
        {
          "workspaces": {
            "packages": ["a", "b"],
            "catalog": { "a": "1", "b": "1", "B": "1" },
            "catalogs": { "b": { "d": "1", "c": "1" }, "a": {} },
            "nohoist": ["b", "a"],
          },
          "overrides": { "a": "1", "b": { "d": "1", "c": "1" }, "B": "1" },
          "dependencies": {
            "@a/b": "1",
            "@b/a": "1",
            "a": "1",
            "A": "1",
            "a_b": "1",
            "a-b": "1",
            "a.b": "1",
            "a1": "1",
            "a10": "1",
            "a2": "1",
            "b": "1",
            "B": "1",
          },
          "devDependencies": { "a": "1", "b": "1", "B": "1" },
          "peerDependencies": { "a": "1", "b": "1", "B": "1" },
          "optionalDependencies": { "a": "1", "b": "1", "B": "1" },
        },
      ],
      [
        "dependencies in Yarn's and pnpm's order",
        {
          "packageManager": "pnpm@9.0.0",
          "dependencies": { "b": "1", "@b/a": "1", "B": "1", "a": "1", "a-b": "1", "a_b": "1", "A": "1" },
        },
        {
          "dependencies": { "@b/a": "1", "A": "1", "B": "1", "a": "1", "a-b": "1", "a_b": "1", "b": "1" },
          "packageManager": "pnpm@9.0.0",
        },
      ],
      [
        "packageManager: npm",
        { "packageManager": "npm@10.0.0", "pnpm": {}, "dependencies": { "b": "1", "B": "1", "a": "1" } },
        { "dependencies": { "a": "1", "b": "1", "B": "1" }, "packageManager": "npm@10.0.0", "pnpm": {} },
      ],
      [
        "devEngines.packageManager",
        {
          "devEngines": { "packageManager": { "name": "yarn" } },
          "engines": { "npm": "1" },
          "dependencies": { "b": "1", "B": "1", "a": "1" },
        },
        {
          "dependencies": { "B": "1", "a": "1", "b": "1" },
          "engines": { "npm": "1" },
          "devEngines": { "packageManager": { "name": "yarn" } },
        },
      ],
      [
        "pnpm",
        { "pnpm": { "a": 1 }, "engines": { "npm": "1" }, "dependencies": { "b": "1", "B": "1", "a": "1" } },
        { "dependencies": { "B": "1", "a": "1", "b": "1" }, "engines": { "npm": "1" }, "pnpm": { "a": 1 } },
      ],
      [
        "eslintConfig",
        {
          "eslintConfig": {
            "rules": { "b/a": 1, "semi": 1, "a/b/c": 1, "a/b": 1, "B": 1, "b": 1 },
            "root": true,
            "overrides": [
              {
                "rules": { "b": 1, "a": 1 },
                "excludedFiles": "e",
                "files": "f",
                "overrides": [{ "env": { "b": 1, "a": 1 }, "files": "g" }],
              },
            ],
            "extends": ["b", "a"],
            "globals": { "b": 1, "a": 1 },
            "env": { "node": true, "browser": true },
            "parserOptions": { "sourceType": "module", "ecmaVersion": 6 },
            "settings": { "b": { "d": 1, "c": 1 }, "a": 1 },
            "plugins": ["b", "a"],
            "parser": "p",
            "ignorePatterns": [],
          },
        },
        {
          "eslintConfig": {
            "env": { "browser": true, "node": true },
            "parser": "p",
            "parserOptions": { "ecmaVersion": 6, "sourceType": "module" },
            "settings": { "a": 1, "b": { "d": 1, "c": 1 } },
            "plugins": ["b", "a"],
            "extends": ["b", "a"],
            "rules": { "b": 1, "B": 1, "semi": 1, "a/b": 1, "b/a": 1, "a/b/c": 1 },
            "overrides": [
              {
                "files": "f",
                "excludedFiles": "e",
                "rules": { "a": 1, "b": 1 },
                "overrides": [{ "files": "g", "env": { "a": 1, "b": 1 } }],
              },
            ],
            "globals": { "a": 1, "b": 1 },
            "ignorePatterns": [],
            "root": true,
          },
        },
      ],
      [
        "prettier",
        {
          "prettier": {
            "semi": false,
            "overrides": [{ "options": { "semi": true, "printWidth": 1 }, "files": "f", "excludeFiles": "e" }],
            "plugins": ["b", "a"],
            "arrowParens": "avoid",
          },
        },
        {
          "prettier": {
            "arrowParens": "avoid",
            "plugins": ["b", "a"],
            "semi": false,
            "overrides": [{ "excludeFiles": "e", "files": "f", "options": { "printWidth": 1, "semi": true } }],
          },
        },
      ],
      [
        "pnpm.overrides are sorted by the lowest version in each range",
        {
          "pnpm": {
            "packageExtensions": { "b": { "peerDependencies": { "d": "1", "c": "1" } }, "a": {} },
            "overrides": {
              "b@2": "1",
              "c": "1",
              "b@^1.5": "1",
              "b@>=1.0.0 <1.2": "1",
              "b@<1": "1",
              "b": "1",
              "a@1>z": "1",
              "a@1>y": "1",
              "@s/a@2": "1",
              "@s/a@1.x": "1",
              "@s/a": "1",
              "b@>1.5.0": "1",
              "b@1.5.1-rc.1": "1",
              "b@10": "1",
              "b@3 || 1.1": "1",
            },
            "zeta": 1,
            "onlyBuiltDependencies": ["b", "a"],
            "patchedDependencies": { "b@1": "p", "a@1": "p" },
            "peerDependencyRules": { "ignoreMissing": ["b"], "allowedVersions": { "b": "1", "a": "1" } },
          },
        },
        {
          "pnpm": {
            "peerDependencyRules": { "allowedVersions": { "a": "1", "b": "1" }, "ignoreMissing": ["b"] },
            "onlyBuiltDependencies": ["b", "a"],
            "overrides": {
              "@s/a": "1",
              "@s/a@1.x": "1",
              "@s/a@2": "1",
              "a@1>y": "1",
              "a@1>z": "1",
              "b@>=1.0.0 <1.2": "1",
              "b@>1.5.0": "1",
              "b": "1",
              "b@<1": "1",
              "b@3 || 1.1": "1",
              "b@^1.5": "1",
              "b@1.5.1-rc.1": "1",
              "b@2": "1",
              "b@10": "1",
              "c": "1",
            },
            "patchedDependencies": { "a@1": "p", "b@1": "p" },
            "packageExtensions": { "a": {}, "b": { "peerDependencies": { "c": "1", "d": "1" } } },
            "zeta": 1,
          },
        },
      ],
      [
        "wireit",
        {
          "wireit": {
            "b": {
              "output": ["o"],
              "files": ["f"],
              "env": { "B": { "default": "d", "external": true }, "A": {} },
              "dependencies": [{ "cascade": false, "script": "a" }, "x"],
              "service": { "b": 1, "readyWhen": { "lineMatches": "l", "a": 1 } },
              "command": "c",
              "clean": true,
            },
            "a": {},
          },
        },
        {
          "wireit": {
            "a": {},
            "b": {
              "command": "c",
              "dependencies": [{ "script": "a", "cascade": false }, "x"],
              "files": ["f"],
              "output": ["o"],
              "clean": true,
              "env": { "A": {}, "B": { "external": true, "default": "d" } },
              "service": { "readyWhen": { "a": 1, "lineMatches": "l" }, "b": 1 },
            },
          },
        },
      ],
    ];
    // The plugin passes the text through `JSON.parse` and `JSON.stringify`. Bun only moves members.
    const asWritten: [title: string, before: string, after: string, byPlugin: string][] = [
      [
        "keeps numbers as written",
        '{ "b": 1.0, "a": -0, "c": 1e400, "d": 1E5, "e": 12345678901234567890, "f": 0.10 }',
        '{\n  "a": -0,\n  "b": 1.0,\n  "c": 1e400,\n  "d": 1E5,\n  "e": 12345678901234567890,\n  "f": 0.10\n}\n',
        '{\n  "a": 0,\n  "b": 1,\n  "c": null,\n  "d": 100000,\n  "e": 12345678901234567000,\n  "f": 0.1\n}\n',
      ],
      [
        "keeps strings and keys as written, and compares their decoded values",
        '{ "b": "\\u00e9\\/\\ud83d\\ude00\\ud800", "\\u0061": "é", "n\\u0061me": "x", "keywords": ["\\u0062", "b", "a"] }',
        '{\n  "n\\u0061me": "x",\n  "keywords": [\n    "\\u0062",\n    "a"\n  ],\n  "\\u0061": "é",\n  "b": "\\u00e9\\/\\ud83d\\ude00\\ud800"\n}\n',
        '{\n  "name": "x",\n  "keywords": [\n    "b",\n    "a"\n  ],\n  "a": "é",\n  "b": "é/😀\\ud800"\n}\n',
      ],
      [
        "keeps every member with a duplicate key, in the order they're written in",
        '{ "b": 1, "a": 2, "b": { "d": 1, "c": 1, "d": 2 }, "scripts": { "b": "1", "a": "", "b": "2" } }',
        '{\n  "scripts": {\n    "a": "",\n    "b": "1",\n    "b": "2"\n  },\n  "a": 2,\n  "b": 1,\n  "b": {\n    "d": 1,\n    "c": 1,\n    "d": 2\n  }\n}\n',
        '{\n  "scripts": {\n    "a": "",\n    "b": "2"\n  },\n  "a": 2,\n  "b": {\n    "d": 2,\n    "c": 1\n  }\n}\n',
      ],
      [
        "sorts numeric keys like any other key, and only where it sorts",
        '{ "name": "a", "10": 1, "9": 1, "scripts": { "b": "", "10": "", "9": "" }, "x": { "b": 1, "1": 1 } }',
        '{\n  "name": "a",\n  "scripts": {\n    "10": "",\n    "9": "",\n    "b": ""\n  },\n  "10": 1,\n  "9": 1,\n  "x": {\n    "b": 1,\n    "1": 1\n  }\n}\n',
        '{\n  "9": 1,\n  "10": 1,\n  "name": "a",\n  "scripts": {\n    "9": "",\n    "10": "",\n    "b": ""\n  },\n  "x": {\n    "1": 1,\n    "b": 1\n  }\n}\n',
      ],
      [
        "doesn't sort a file that isn't an object",
        '[{ "b": 1, "a": 1 }, 1.0]',
        '[\n  {\n    "b": 1,\n    "a": 1\n  },\n  1.0\n]\n',
        '[\n  {\n    "b": 1,\n    "a": 1\n  },\n  1\n]\n',
      ],
    ];

    test("puts the keys in the plugin's order", async () => {
      const names = rows.map((_, index) => `${index}/package.json`);
      const files = Object.fromEntries(rows.map(([, before], index) => [names[index], JSON.stringify(before)]));
      // `--config` is needed because one of the files has a `prettier` key, which counts as a config.
      const result = await quiet({ ".prettierrc": prettierrc, ...files }, ["--config", ".prettierrc", "."], {
        reads: names,
      });
      for (const [index, [title, , after]] of rows.entries()) {
        const text = JSON.stringify(after, null, 2) + "\n";
        expect({ title, text: result.files[names[index]] }).toEqual({ title, text });
      }
      expect(result).toMatchObject({ stderr: "", exitCode: 0 });
      const again = Object.fromEntries(
        rows.map(([, , after], index) => [names[index], JSON.stringify(after, null, 2) + "\n"]),
      );
      expect(await different({ ".prettierrc": prettierrc, ...again }, ["--config", ".prettierrc", "."])).toEqual([]);
    });

    test.each(asWritten)("%s", async (_, before, after, byPlugin) => {
      expect(after).not.toBe(byPlugin);
      // After the plugin's round trip, the two are the same.
      expect(JSON.stringify(JSON.parse(after), null, 2) + "\n").toBe(byPlugin);
      const files = { ".prettierrc": prettierrc, "package.json": before };
      const result = await quiet(files, ["package.json"], { reads: ["package.json"] });
      expect(result).toMatchObject({ stderr: "", files: { "package.json": after }, exitCode: 0 });
      expect(await different({ ...files, "package.json": after }, [])).toEqual([]);
    });

    test("keeps a byte order mark and \\r\\n", async () => {
      const files = {
        ".prettierrc": `{ "plugins": ["${plugin}"], "endOfLine": "auto" }\n`,
        "package.json": '\uFEFF{\r\n  "version": "1",\r\n  "name": "a"\r\n}\r\n',
      };
      const result = await quiet(files, ["package.json"], { reads: ["package.json"] });
      expect(result).toMatchObject({
        stderr: "",
        files: { "package.json": '\uFEFF{\r\n  "name": "a",\r\n  "version": "1"\r\n}\r\n' },
        exitCode: 0,
      });
    });

    test("sorts every package.json and no other file, whatever is installed", async () => {
      const files = {
        ".prettierrc": prettierrc,
        "package.json": unsorted,
        "packages/b/package.json": unsorted,
        "my-package.json": unsorted,
        "package.json5": unsorted,
        "composer.json": unsorted,
        "other/Package.json": unsorted,
        "d.js": "d  ;\n",
      };
      const after = {
        "package.json": sorted,
        "packages/b/package.json": sorted,
        "my-package.json": '{ "version": "1", "name": "a" }\n',
        "package.json5": '{ version: "1", name: "a" }\n',
        "composer.json": onlyFormatted,
        "other/Package.json": onlyFormatted,
        "d.js": "d;\n",
      };
      for (const installed of [{}, packages]) {
        for (const flags of [[], ["--allow-unsupported"]]) {
          const result = await quiet({ ...files, ...installed }, flags, { reads: Object.keys(after) });
          expect(result).toMatchObject({ stderr: "", files: after, exitCode: 0 });
        }
      }
      expect(await different({ ...files, ...after, "package.json": unsorted }, [])).toEqual(["package.json"]);
    });

    test("sorts standard input", async () => {
      const files = { ".prettierrc": prettierrc, ...packages };
      const piped = (flags: string[]) => quiet(files, flags, { stdin: unsorted });
      expect(await piped(["--stdin-filepath", "a/package.json"])).toMatchObject({
        raw: sorted,
        stderr: "",
        exitCode: 0,
      });
      expect(await format(files, ["--stdin-filepath", "package.json", "--check"], { stdin: unsorted })).toMatchObject({
        raw: "(stdin)\n",
        exitCode: 1,
      });
      expect(await piped(["--stdin-filepath", "a.json"])).toMatchObject({ raw: unsorted, stderr: "", exitCode: 0 });
      // The plugin checks the file name.
      expect(await piped(["--parser", "json-stringify"])).toMatchObject({
        raw: onlyFormatted,
        stderr: "",
        exitCode: 0,
      });
    });

    test.each<[string, Record<string, string>, string[]?]>([
      ["--plugin", {}, ["--plugin", plugin]],
      [
        "an override",
        { ".prettierrc": JSON.stringify({ overrides: [{ files: "*.json", options: { plugins: [plugin] } }] }) },
      ],
      ["a path", { ".prettierrc": `{ "plugins": ["./node_modules/${plugin}/lib/index.cjs"] }` }],
      [
        "an imported module",
        {
          "prettier.config.mjs": `import plugin from "${plugin}";\nexport default { plugins: [plugin] };`,
          [`node_modules/${plugin}/package.json`]: `{ "name": "${plugin}", "main": "index.cjs" }`,
          [`node_modules/${plugin}/index.cjs`]:
            'exports.parsers = { "json-stringify": {} };\nexports.options = { packageSortOrder: { type: "string", array: true } };\n',
        },
      ],
    ])("enabled by %s", async (_, config, flags = []) => {
      const result = await quiet({ ...config, "package.json": unsorted }, [...flags, "package.json"], {
        reads: ["package.json"],
      });
      expect(result).toMatchObject({ stderr: "", files: { "package.json": sorted }, exitCode: 0 });
    });

    test("doesn't sort files where an override clears the plugin list or sets another parser", async () => {
      const overrides = [
        { files: "a/**", options: { plugins: [] } },
        { files: "b/**", options: { parser: "json" } },
      ];
      const files = {
        ".prettierrc": JSON.stringify({ plugins: [plugin], overrides }),
        "a/package.json": unsorted,
        "b/package.json": unsorted,
      };
      const result = await quiet(files, ["a", "b"], { reads: ["a/package.json", "b/package.json"] });
      expect(result.files).toEqual({ "a/package.json": onlyFormatted, "b/package.json": unsorted });
    });

    test("puts the keys in packageSortOrder first", async () => {
      const config = { plugins: [plugin], packageSortOrder: ["zeta", "version", "_a"] };
      const before = { name: "a", _a: 1, main: "m", alpha: 1, version: "1", zeta: 1 };
      const after = { zeta: 1, version: "1", _a: 1, name: "a", main: "m", alpha: 1 };
      const files = { ".prettierrc": JSON.stringify(config), "package.json": JSON.stringify(before) };
      const result = await quiet(files, [], { reads: ["package.json"] });
      expect(result).toMatchObject({
        stderr: "",
        files: { "package.json": JSON.stringify(after, null, 2) + "\n" },
        exitCode: 0,
      });
      // Without the plugin, Prettier doesn't know the option.
      const unknown = await quiet({ ...files, ".prettierrc": '{ "packageSortOrder": ["version"] }' }, []);
      expect(unknown.stderr).toBe('warn: Ignored unknown option { packageSortOrder: ["version"] }.');
    });

    test.each([
      ['"version"', '"version"'],
      ["[1]", "[1]"],
      ['["a", null]', '["a", null]'],
      ["true", "true"],
      ['{ "a": 1 }', "{ a: 1 }"],
    ])("packageSortOrder: %s is rejected for every file, as in Prettier", async (value, shown) => {
      const files = { ".prettierrc": `{ "plugins": ["${plugin}"], "packageSortOrder": ${value} }`, "a.js": ugly };
      const result = await quiet(files, ["a.js"], { reads: ["a.js"] });
      expect(result.stderr).toBe(
        `error: Invalid packageSortOrder value. Expected an array of a string, but received ${shown}.`,
      );
      expect(result).toMatchObject({ files: { "a.js": ugly }, exitCode: 1 });
    });

    // npm sorts names in dictionary order, Yarn and pnpm by code unit. The plugin looks in the working directory.
    test.each(["yarn.lock", ".yarnrc.yml", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".yarn/a"])(
      "with %s, dependencies are sorted the way Yarn and pnpm sort them",
      async name => {
        const before = { dependencies: { b: "1", B: "1", a: "1" } };
        const files = { ".prettierrc": prettierrc, "package.json": JSON.stringify(before), "c/package.json": "{}\n" };
        const text = (names: string[]) =>
          JSON.stringify({ dependencies: Object.fromEntries(names.map(name => [name, "1"])) }, null, 2) + "\n";
        const run = (files: Record<string, string>) => quiet(files, [], { reads: ["package.json"] });
        expect((await run(files)).files["package.json"]).toBe(text(["a", "b", "B"]));
        expect((await run({ ...files, [name]: "" })).files["package.json"]).toBe(text(["B", "a", "b"]));
        expect((await run({ ...files, [`c/${name}`]: "" })).files["package.json"]).toBe(text(["a", "b", "B"]));
      },
    );

    // The plugin throws for these: "SyntaxError: Expected double-quoted property name in JSON at position 17".
    test.each([
      ['{\n  "version": "1",\n  "name": "a",\n}\n', sorted],
      ["{ version: '1', name: 'a' }\n", sorted],
      ['{ "version": `1`, "name": "a", }\n', sorted],
      ['{ "b": +1, "a": [1, , 2] }\n', '{\n  "a": [\n    1,\n    null,\n    2\n  ],\n  "b": 1\n}\n'],
    ])("sorts whatever it can format without the plugin: %j", async (text, after) => {
      const result = await quiet({ ".prettierrc": prettierrc, "package.json": text }, [], { reads: ["package.json"] });
      expect(result).toMatchObject({ stderr: "", files: { "package.json": after }, exitCode: 0 });
    });

    // Prettier doesn't allow comments in a package.json, with or without the plugin, so none ever has to move.
    test.each<[string, string, [number, number, string]]>([
      ['{\n  // a\n  "name": "a"\n}\n', "Unexpected token", [2, 3, "  // a"]],
      ['{ "b": 1, /* c */ "a": 1 }\n', "Unexpected token", [1, 11, '{ "b": 1, /* c */ "a": 1 }']],
      ['{ "é": 1 } x\n', "Expected end of file", [1, 12, '{ "é": 1 } x']],
    ])("reports a syntax error the way it does without the plugin: %j", async (text, message, at) => {
      for (const config of [prettierrc, "{}"]) {
        const files = { ".prettierrc": config, "package.json": text, "a.js": ugly };
        const result = await quiet(files, [], { reads: ["package.json", "a.js"] });
        expect(result.stderr).toStartWith(problem("package.json", message, at));
        expect(result).toMatchObject({ files: { "package.json": text, "a.js": formatted }, exitCode: 2 });
      }
    });

    test("accepts an empty file", async () => {
      for (const text of ["", " \n"]) {
        const result = await quiet({ ".prettierrc": prettierrc, "package.json": text }, [], {
          reads: ["package.json"],
        });
        expect(result).toMatchObject({ stderr: "", files: { "package.json": "" }, exitCode: 0 });
      }
    });

    // JavaScript decodes the file before it compares anything, so by then a truncated character is a single U+FFFD.
    test.each<[string, string, string[], (a: string, b: string) => number]>([
      [
        "npm's order (localeCompare)",
        "",
        ["\xF0\x9F\x98b", "\xEF\xBF\xBDc", "\xEF\xBF\xBD\xEF\xBF\xBD\\ud800"],
        (a, b) => a.localeCompare(b, "en"),
      ],
      [
        "pnpm's order (code units)",
        ',\n  "packageManager": "pnpm@9"',
        ["\xF0A", "\xF1\x80\x80\x80", "\\udc00"],
        (a, b) => (a < b ? -1 : 1),
      ],
    ])("dependencies whose names aren't valid UTF-8 sort consistently in %s", async (_, more, kinds, compare) => {
      const all = kinds.flatMap(kind => Array.from({ length: 8 }, (_, digit) => kind + digit));
      const text = (names: string[]) =>
        `{\n  "name": "x",\n  "dependencies": {\n${names.map(name => `    "${name}": "1"`).join(",\n")}\n  }${more}\n}\n`;
      const decode = (name: string): string => JSON.parse(`"${new TextDecoder().decode(Buffer.from(name, "latin1"))}"`);
      const sorted = text(all.toSorted((a, b) => compare(decode(a), decode(b))));
      for (const stride of [11, 7]) {
        using dir = tempDir("bun-format", {
          ".prettierrc": prettierrc,
          "package.json": Buffer.from(text(all.map((_, i) => all[(i * stride) % all.length])), "latin1"),
        });
        for (const _ of ["sorts", "has nothing to sort"]) {
          const cmd = [...command, "--log-level=warn", "package.json"];
          await using proc = spawn({
            // Don't leave a core file after a crash.
            cmd: isWindows ? cmd : ["sh", "-c", 'ulimit -c 0; exec "$0" "$@"', ...cmd],
            env,
            cwd: String(dir),
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
          expect(readFileSync(join(String(dir), "package.json"), "latin1")).toBe(sorted);
          expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
        }
      }
    });

    test("sortPackageJson, as a flag or in [fmt], overrides the plugin", async () => {
      const before = '{ "license": "MIT", "author": "a", "repository": "r" }\n';
      const text = (...names: string[]) =>
        JSON.stringify(Object.fromEntries(names.map(name => [name, JSON.parse(before)[name]])), null, 2) + "\n";
      const files = { ".prettierrc": prettierrc, "package.json": before };
      const run = async (more: Record<string, string>, flags: string[] = []) =>
        (await quiet({ ...files, ...more }, flags, { reads: ["package.json"] })).files["package.json"];
      expect(await run({})).toBe(text("repository", "license", "author"));
      expect(await run({ "bunfig.toml": "[fmt]\nsortPackageJson = true\n" })).toBe(
        text("license", "author", "repository"),
      );
      expect(await run({}, ["--sort-package-json"])).toBe(text("license", "author", "repository"));
      expect(await run({ "bunfig.toml": "[fmt]\nsortPackageJson = false\n" })).toBe(
        text("license", "author", "repository"),
      );
      expect(await run({}, ["--no-sort-package-json"])).toBe(text("license", "author", "repository"));
    });

    // In a package.json, a range formats the whole file except for the final line break, with or without the plugin.
    // Prettier looks for the offsets in the text that the plugin wrote, so with some ranges it prints that text
    // verbatim: `{"name":"a","version":"1","files":["b","a"]}`.
    test("sorts with a range too", async () => {
      const text = '{ "version": "1", "name": "a", "files": [ "b",   "a" ] }\n';
      const run = async (...flags: string[]) => {
        const files = { ".prettierrc": prettierrc, "package.json": text };
        return (await quiet(files, [...flags, "package.json"], { reads: ["package.json"] })).files["package.json"];
      };
      const whole = '{\n  "name": "a",\n  "version": "1",\n  "files": [\n    "b",\n    "a"\n  ]\n}';
      expect(await run("--range-end=16")).toBe(whole);
      expect(await run("--range-start=42", "--range-end=52")).toBe(whole);
      expect(await run("--range-start=0", `--range-end=${text.length}`)).toBe(whole + "\n");
      expect(await run("--range-end=1000")).toBe(whole + "\n");
      expect(await run("--range-start=5", "--range-end=5")).toBe(text);
    });

    test("requirePragma leaves the file unchanged, because it can't have a comment", async () => {
      const files = { ".prettierrc": `{ "plugins": ["${plugin}"], "requirePragma": true }`, "package.json": unsorted };
      const result = await quiet(files, [], { reads: ["package.json"] });
      expect(result).toMatchObject({ stderr: "", files: { "package.json": unsorted }, exitCode: 0 });
    });

    describe("where the plugin drops a key or throws", () => {
      const run = async (before: string) => {
        const result = await quiet({ ".prettierrc": prettierrc, "package.json": before }, [], {
          reads: ["package.json"],
        });
        expect(result).toMatchObject({ stderr: "", exitCode: 0 });
        return JSON.stringify(JSON.parse(result.files["package.json"]!));
      };

      // The plugin prints `{"scripts":{"b":"","a":""},"a":1}`.
      test("keeps a __proto__ key", async () => {
        expect(await run('{"__proto__":{"c":1},"a":1,"scripts":{"b":"","a":""},"_a":1}')).toBe(
          '{"scripts":{"a":"","b":""},"a":1,"__proto__":{"c":1},"_a":1}',
        );
      });

      // "TypeError: command.includes is not a function"
      test("sorts scripts that aren't strings, with npm-run-all in devDependencies", async () => {
        expect(await run('{"betterScripts":{"b":{"command":"c"},"a":"a"},"devDependencies":{"npm-run-all":"1"}}')).toBe(
          '{"betterScripts":{"a":"a","b":{"command":"c"}},"devDependencies":{"npm-run-all":"1"}}',
        );
      });

      // "TypeError: Cannot convert undefined or null to object"
      test("sorts scripts next to devDependencies: null", async () => {
        expect(await run('{"scripts":{"b":"","a":""},"devDependencies":null}')).toBe(
          '{"scripts":{"a":"","b":""},"devDependencies":null}',
        );
      });

      // "TypeError: Invalid SemVer Range: latest"
      test("sorts an invalid version range in pnpm.overrides last", async () => {
        expect(await run('{"pnpm":{"overrides":{"a@latest":"1","a@2":"1","a@>3 <2":"1","a@1":"1","a":"1"}}}')).toBe(
          '{"pnpm":{"overrides":{"a@>3 <2":"1","a":"1","a@1":"1","a@2":"1","a@latest":"1"}}}',
        );
      });
    });

    test("doesn't overflow the stack on very deeply nested objects and arrays", async () => {
      const depth = 30_000;
      const nested = (open: string, close: string) =>
        Buffer.alloc(depth * open.length, open).toString() + "1" + Buffer.alloc(depth * close.length, close).toString();
      const text = `{"exports":${nested('{"a":', "}")},"oclif":${nested('{"a":', "}")},"eslintConfig":${nested('{"overrides":[', "]}")},"x":${nested("[", "]")}}`;
      const result = await quiet({ ".prettierrc": prettierrc, "package.json": text }, [], { reads: ["package.json"] });
      expect(result.stderr).toBe(problem("package.json", "The formatted code is too long for a string"));
      expect(result).toMatchObject({ files: { "package.json": text }, exitCode: 2 });
    });
  });

  test("with an .oxfmtrc.json, formats TOML, and Svelte if the config has `svelte`", async () => {
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
    // oxfmt 0.72 formats the first and returns the second unchanged.
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

  // Notepad and Windows PowerShell's `Out-File -Encoding utf8` write the mark. Git, Prettier 3.9.9 and oxfmt 0.72.0
  // skip it.
  test.each([
    ["\\r\\n", (text: string) => text.replaceAll("\n", "\r\n")],
    ["a byte order mark", (text: string) => "\uFEFF" + text],
    ["both", (text: string) => "\uFEFF" + text.replaceAll("\n", "\r\n")],
  ])("handles %s in an ignore file", async (_, written) => {
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

  test(".prettierignore and .gitignore are case-insensitive, like in Prettier", async () => {
    const files = {
      ".prettierignore": "readme.md\nSUB/\n",
      ".gitignore": "*.JS\n",
      "README.md": "#   a\n",
      "sub/b.md": "#   b\n",
      "c.js": ugly,
      "other.md": "#   c\n",
    };
    expect(await different(files, [])).toEqual(["other.md"]);
    // In oxfmt they're case-sensitive.
    expect(await different({ ...files, ".oxfmtrc.json": "{}\n" }, [])).toEqual([
      "README.md",
      "c.js",
      "other.md",
      "sub/b.md",
    ]);
  });

  test("(a|b) in a pattern matches a or b, like in Prettier", async () => {
    const files = { "src/a.ts": ugly, "test/x/b.ts": ugly, "lib/c.ts": ugly };
    expect(await different(files, ["(src|test)/**/*.ts"])).toEqual(["src/a.ts", "test/x/b.ts"]);
  });

  test("ignorePatterns that match *.* don't ignore the directory being searched", async () => {
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
  ])("a .prettierrc that Prettier rejects is an error: %s", async (config, message) => {
    const result = await format({ ".prettierrc": config, "a.js": ugly }, ["a.js"], { reads: ["a.js"] });
    expect(result.files["a.js"]).toBe(ugly);
    expect(result.stderr).toContain(message);
    expect(result.exitCode).toBe(2);
  });

  // The file is entirely sparse. Node fails with "Cannot create a string longer than 0x1fffffe8 characters".
  test("doesn't read a file too large for a JavaScript string, and still reads the others", async () => {
    const result = await format({ "a.json": "", "b.js": ugly }, ["--check", "."], {
      before: dir => truncateSync(join(dir, "a.json"), 2 ** 29),
    });
    expect(result.stderr).toContain(`error: Unable to read file "a.json":\nEFBIG: `);
    expect(result.stdout).toBe("b.js");
    expect(result.exitCode).toBe(2);
  });

  test.skipIf(isWindows)(
    "/dev/null works as an ignore file without patterns and as a configuration without options",
    async () => {
      const files = { ".prettierignore": "a.js\n", ".prettierrc": `{ "semi": false }\n`, "a.js": formatted };
      expect(await different(files, ["."])).toEqual([]);
      expect(await different(files, ["--ignore-path", "/dev/null", "."])).toEqual(["a.js"]);
      expect(await different(files, ["--ignore-path", "/dev/null", "--config", "/dev/null", "."])).toEqual([]);
    },
  );

  // This means "never break a line". Prettier accepts every integer from 0 up, and Infinity.
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

  // oxfmt 0.72 prints "Failed to load configuration file." and exits with 1.
  test("rejects an infinite printWidth in an oxfmt config", async () => {
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

  test("ignores an option unknown to Prettier with Prettier's warning, unless a plugin may define it", async () => {
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
    // oxfmt silently ignores unknown keys, and treats null as unset.
    const oxfmt = await format({ ".oxfmtrc.json": '{ "semi": null, "nonsense": 1 }\n', "a.js": ugly }, ["a.js"], {
      reads: ["a.js"],
    });
    expect(oxfmt.files["a.js"]).toBe(formatted);
    expect(oxfmt.stderr).not.toContain("nonsense");
    expect(oxfmt.exitCode).toBe(0);
  });

  test("skips files that an unsupported plugin may print differently, which is an error unless --allow-unsupported is passed", async () => {
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

  test.each([
    "C:\\p\\node_modules\\@ianvs\\prettier-plugin-sort-imports\\lib\\index.js",
    "C:/p/node_modules/@ianvs/prettier-plugin-sort-imports/lib/index.js",
    "C:\\p\\node_modules/@prettier\\plugin-oxc/index.js",
    "C:\\p\\node_modules\\a\\node_modules\\@prettier\\plugin-oxc\\index.js",
    "C:\\p\\node_modules\\prettier-plugin-tailwindcss\\dist\\index.mjs",
    "@trivago/prettier-plugin-sort-imports",
  ])("a built-in plugin is recognized by the path of a file in its package: %s", async plugin => {
    const result = await format({ "a.js": ugly }, ["--plugin", plugin], { reads: ["a.js"] });
    expect(result.stderr).not.toContain("does not include the plugin");
    expect(result.files["a.js"]).toBe(formatted);
    expect(result.exitCode).toBe(0);
  });

  test("an unsupported plugin in an override only skips the files that the override matches", async () => {
    const overrides = [{ files: "legacy/**", options: { plugins: ["prettier-plugin-brace-style"] } }];
    const files = { ".prettierrc": JSON.stringify({ overrides }), "a.js": ugly, "legacy/b.js": ugly };
    const result = await format(files, [], { reads: ["a.js", "legacy/b.js"] });
    expect(result.files).toEqual({ "a.js": formatted, "legacy/b.js": ugly });
    expect(result.stderr).toContain(
      "error: 1 file was not formatted because the Prettier config uses plugins that bun fmt does not include: prettier-plugin-brace-style\n",
    );
    expect(result.exitCode).toBe(2);
    // An override that empties the plugin list exempts its files.
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
  ])("@prettier/plugin-oxc, set by %s, only swaps the parser and changes nothing", async (_, files, flags = []) => {
    const result = await format({ ...files, "a.js": ugly, "a.ts": "let  a: 1\n" }, ["--log-level=warn", ...flags], {
      reads: ["a.js", "a.ts"],
    });
    expect(result.stderr).toBe("");
    expect(result.files).toEqual({ "a.js": formatted, "a.ts": "let a: 1;\n" });
    expect(result.exitCode).toBe(0);
  });

  test("with a plugin that only adds a language, formats the rest and counts that language's files", async () => {
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

  // Each registers a parser and a printer under new names, for these file names only.
  test.each<[string, string[]]>([
    ["prettier-plugin-ember-template-tag", [".gjs", ".gts"]],
    ["@shopify/prettier-plugin-liquid", [".liquid"]],
    ["prettier-plugin-blade", [".blade.php"]],
    ["prettier-plugin-edgejs", [".edge"]],
    ["prettier-plugin-sql-cst", [".sql", ".sqlite", ".bigquery"]],
    ["prettier-plugin-terraform-formatter", [".tf"]],
    ["@zackad/prettier-plugin-twig", [".twig"]],
  ])("%s only adds a language", async (plugin, endings) => {
    const others = Object.fromEntries(endings.map(ending => [`b${ending}`, "b   b\n"]));
    const files = { ".prettierrc": JSON.stringify({ plugins: [plugin] }), "a.js": ugly, ...others };
    const result = await format(files, [], { reads: ["a.js", ...Object.keys(others)] });
    expect(result.files).toEqual({ "a.js": formatted, ...others });
    expect(result.stderr).toContain(`Not installed: prettier, ${plugin}\n`);
    expect(result.stderr).not.toContain("does not include");
    expect(result.exitCode).toBe(2);
  });

  test("recognizes the file names that Prettier does, or with an .oxfmtrc.json those that oxfmt does, which is case-sensitive", async () => {
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

  test("formats files under an .oxfmtrc.json like oxfmt, even if the run starts above it", async () => {
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
    // 90 columns, which fits on one line in oxfmt's 100.
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
      // A configuration file takes precedence over the dependency.
      expect(
        await after({ "package.json": '{ "devDependencies": { "oxfmt": "0.72.0" } }\n', ".prettierrc": "{}\n" }),
      ).toBe(asPrettier);
    });

    // Monorepos list their tools in the root's package.json.
    test("the dependency can be in a package.json above the nearest one", async () => {
      const check = async (tools: object, cwd: string, file: (dir: string) => string) => {
        using dir = tempDir("bun-format", {
          "package.json": JSON.stringify({ workspaces: ["packages/*"], devDependencies: tools }),
          "packages/app/package.json": '{ "name": "app", "dependencies": { "react": "19.0.0" } }\n',
          "packages/app/src/a.ts": asOxfmt,
        });
        await using proc = spawn({
          cmd: [...command, "--check", file(String(dir))],
          env,
          cwd: join(String(dir), cwd),
          stdout: "ignore",
          stderr: "ignore",
        });
        return await proc.exited;
      };
      const absolute = (dir: string) => join(dir, "packages", "app", "src", "a.ts");
      const runs: [cwd: string, file: (dir: string) => string][] = [
        [".", () => "packages/app/src/a.ts"],
        [".", absolute],
        ["packages/app", () => "src/a.ts"],
        ["packages/app", absolute],
        ["packages/app/src", () => "a.ts"],
      ];
      const exitCodes = (tools: object) => Promise.all(runs.map(([cwd, file]) => check(tools, cwd, file)));
      expect(await exitCodes({ oxfmt: "0.72.0" })).toEqual([0, 0, 0, 0, 0]);
      expect(await exitCodes({ "vite-plus": "1.0.0" })).toEqual([0, 0, 0, 0, 0]);
      expect(await exitCodes({ typescript: "5.9.3" })).toEqual([1, 1, 1, 1, 1]);
    });

    test("doesn't contact a registry for a configuration file's imports", async () => {
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

    test("a project that depends on Vite+ takes its options from `fmt` in the nearest vite.config.ts that has it", async () => {
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
      // In a directory whose own vite.config has no `fmt`, the one above applies.
      const below = await format(files, ["d.js"], { reads, cwd: "other" });
      expect(below.files["other/d.js"]).toBe("d\n");
      const explicit = await format(files, ["--config", "other/vite.config.mjs", "a.js"], { reads });
      expect(explicit.stderr).toContain("Expected a `fmt` field in the default export of");
      expect(explicit.files["a.js"]).toBe("a;\n");
      expect(explicit.exitCode).toBe(1);
      // Without the dependency, the file is only Vite's config.
      const without = await format({ ...files, "package.json": "{}\n" }, ["a.js"], { reads });
      expect(without.files["a.js"]).toBe("a;\n");
    });

    test("--flavor picks the style", async () => {
      expect(await after({}, ["--flavor", "oxfmt"])).toBe(asOxfmt);
      expect(
        await after({ "package.json": '{ "devDependencies": { "oxfmt": "0.72.0" } }\n' }, ["--flavor=prettier"]),
      ).toBe(asPrettier);
      const result = await format({ "a.ts": asOxfmt }, ["--flavor", "biome"]);
      expect(result.stderr).toContain('Invalid --flavor value. Expected "oxfmt" or "prettier", but received "biome".');
      expect(result.exitCode).toBe(2);
    });

    test("--config treats a file with oxfmt in its name as an oxfmt config", async () => {
      const files = { "config/oxfmtrc.json": "{}\n", "a.ts": asOxfmt, "pnpm-lock.yaml": "a:   1\n" };
      const result = await format(files, ["--config", "config/oxfmtrc.json"], { reads: ["a.ts", "pnpm-lock.yaml"] });
      expect(result.files).toEqual({ "a.ts": asOxfmt, "pnpm-lock.yaml": "a:   1\n" });
      expect(result.exitCode).toBe(0);
    });
  });

  // Same as Prettier 3.9.9 and oxfmt 0.72.
  test.each(["prettier.config.mjs", "oxfmt.config.ts"])(
    "`process.cwd()` in %s is where the command runs, not where the file is",
    async name => {
      const files = {
        [name]: `import { basename } from "node:path";\nexport default { semi: basename(process.cwd()) !== "sub" };\n`,
        "sub/a.js": "a\n",
      };
      const [below, atRoot] = await Promise.all([
        format(files, ["a.js"], { cwd: "sub", reads: ["sub/a.js"] }),
        format(files, ["sub/a.js"], { reads: ["sub/a.js"] }),
      ]);
      expect([below.files["sub/a.js"], atRoot.files["sub/a.js"]]).toEqual(["a\n", "a;\n"]);
    },
  );

  // Same as Prettier 3.9.9 and oxfmt 0.72, which load a configuration in Node.
  test.each(["prettier.config.mjs", "oxfmt.config.ts"])(
    "`process.env` in %s has inherited variables but not the project's .env",
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

  // Same as Prettier 3.9.9 and oxfmt 0.72, which load a configuration in Node. On Windows it still runs.
  test.skipIf(isWindows).each(["prettier.config.mjs", "oxfmt.config.ts"])(
    "a `preload` in bunfig.toml doesn't run before %s",
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
  test.each(["prettier.config.mjs", "oxfmt.config.ts"])("`process.argv` in %s is the command line", async name => {
    // Applying `--cwd sub` a second time would give `sub/sub`.
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

  test.skipIf(isWindows)("a named pipe whose name ends in .js is skipped, like in Prettier", async () => {
    const before = (dir: string) => expect(Bun.spawnSync(["mkfifo", join(dir, "pipe.js")]).exitCode).toBe(0);
    expect(await different({ "a.js": ugly }, [], { before })).toEqual(["a.js"]);
  });

  // Opening a pipe like this blocks until a writer opens it.
  test
    .skipIf(isWindows)
    .each([".gitignore", ".git/info/exclude", ".prettierignore", ".editorconfig", ".prettierrc", "package.json"])(
    "doesn't hang when %s is a link to a named pipe without a writer",
    async name => {
      const before = (dir: string) => {
        expect(Bun.spawnSync(["mkfifo", join(dir, "pipe")]).exitCode).toBe(0);
        symlinkSync(join(dir, "pipe"), join(dir, "project", name));
      };
      const files = { "project/a.js": ugly, "project/.git/info/a": "" };
      expect(await different(files, [], { cwd: "project", before })).toEqual(["a.js"]);
    },
  );

  test.skipIf(isWindows).each([
    ["writes to it is read", "echo a.js", "b.js\n"],
    ["closes it without writing is read as an empty file", ":", "a.js\nb.js\n"],
  ])("a pipe whose writer %s", async (_, writer, expected) => {
    using dir = tempDir("bun-format", { "a.js": ugly, "b.js": ugly });
    await using proc = spawn({
      cmd: ["sh", "-c", `${writer} | "$0" "$@"`, ...command, "-l", "--ignore-path", "/dev/stdin"],
      env,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe(expected);
    expect(exitCode).toBe(1);
  });

  describe.skipIf(isWindows)("a named pipe passed to a flag", () => {
    const makePipes = (dir: string) =>
      expect(Bun.spawnSync(["mkfifo", join(dir, "pipe"), join(dir, "pipe.json")]).exitCode).toBe(0);

    // Reading the pipe as empty would silently disable the ignore list, and `a.js` would be rewritten, so it's an
    // error. `bun fmt` doesn't block waiting for a writer either.
    describe.each([
      ["no config", {}],
      [".prettierrc", { ".prettierrc": "{}\n" }],
      [".oxfmtrc.json", { ".oxfmtrc.json": "{}\n" }],
    ])("without a writer is an error, with %s", (_, config: Record<string, string>) => {
      test.each([
        [["--ignore-path", "pipe"], "pipe"],
        [["--ignore-path=.gitignore", "--ignore-path=./pipe"], "./pipe"],
        [["--config", "pipe.json"], "pipe.json"],
        [["--config=pipe"], "pipe"],
      ])("%j", async (flags, name) => {
        const files = { ...config, ".gitignore": "b.js\n", "a.js": ugly };
        const result = await format(files, flags, { before: makePipes, reads: ["a.js"] });
        expect(result.stderr).toBe(`error: cannot read ${name}: nothing is writing to this pipe`);
        expect(result.raw).toBe("");
        expect(result.files).toEqual({ "a.js": ugly });
        expect(result.exitCode).toBe(2);
      });
    });

    test("oxfmt's -c without a writer is an error", async () => {
      const files = { ".oxfmtrc.json": "{}\n", "a.js": ugly };
      const result = await format(files, ["-c", "pipe.json"], { before: makePipes, reads: ["a.js"] });
      expect(result.stderr).toBe("error: cannot read pipe.json: nothing is writing to this pipe");
      expect(result.files).toEqual({ "a.js": ugly });
      expect(result.exitCode).toBe(2);
    });

    test("a pipe set as ignorePath in bunfig.toml is still read as empty", async () => {
      const files = { "bunfig.toml": '[fmt]\nignorePath = ["pipe"]\n', "a.js": ugly };
      expect(await different(files, ["a.js"], { before: makePipes })).toEqual(["a.js"]);
    });

    /** Runs `bun fmt` with `args` in a directory with `files`, while `text` is written to the pipe called `name` there. */
    async function formatWhileWriting(files: Record<string, string>, args: string[], name: string, text: string) {
      using dir = tempDir("bun-format", files);
      makePipes(String(dir));
      // With a reader open, opening it for writing doesn't block, and the written data stays buffered until it's read.
      const reader = openSync(join(String(dir), name), constants.O_RDONLY | constants.O_NONBLOCK);
      const writer = openSync(join(String(dir), name), constants.O_WRONLY);
      try {
        await using proc = spawn({
          cmd: [...command, ...args],
          env,
          cwd: String(dir),
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        writeSync(writer, text);
        closeSync(writer);
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return { stdout, stderr, exitCode };
      } finally {
        closeSync(reader);
      }
    }

    test("--ignore-path reads what a writer sends", async () => {
      const files = { "a.js": ugly, "b.js": ugly };
      const result = await formatWhileWriting(files, ["-l", "--ignore-path", "pipe"], "pipe", "a.js\n");
      expect(result).toEqual({ stdout: "b.js\n", stderr: "", exitCode: 1 });
    });

    // `-c` is `--check` here. Finding that out takes one read of the configuration, and using it takes another.
    test.each([[["-l"]], [["-c", "a.js"]]])("--config reads what a writer sends, with %j", async flags => {
      const files = { "a.js": "a\n", "b.js": "b;\n" };
      const args = [...flags, "--log-level=error", "--config", "pipe.json", "a.js"];
      const result = await formatWhileWriting(files, args, "pipe.json", '{ "semi": false }\n');
      expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    });
  });

  test("--experimental-cli is accepted", async () => {
    const result = await format({ "a.js": ugly }, ["--experimental-cli"], { reads: ["a.js"] });
    expect(result.files["a.js"]).toBe(formatted);
    expect(result.exitCode).toBe(0);
  });

  describe("a parser that Prettier doesn't have", () => {
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

    test("in a .prettierrc's overrides: the files are skipped and counted", async () => {
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

    test("at the top level of a .prettierrc: every file is skipped", async () => {
      const result = await format({ ...files, ".prettierrc": '{ "parser": "nonsense" }\n' }, [], { reads });
      expect(result.files).toEqual(files);
      expect(result.stderr).toContain("files were not formatted because bun fmt does not support their language yet");
      expect(result.exitCode).toBe(2);
    });

    test("for stdin: an error, as for a file, and no output", async () => {
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

    test("in an .oxfmtrc.json, which has no such option: it's ignored", async () => {
      for (const config of [{ parser: "nonsense" }, { overrides }]) {
        const result = await format({ ...files, ".oxfmtrc.json": JSON.stringify(config) + "\n" }, [], { reads });
        expect(result.files).toEqual({ ...files, "c.js": "c;\n", "d.js": "d;\n" });
        expect(result.exitCode).toBe(0);
      }
    });

    test("passed to --parser: an error, and nothing is written", async () => {
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
  ])("doesn't format deeply nested JSON into gigabytes: %s", async (_, make) => {
    const files = { "ok.json": make(512), "huge.json": make(200_000) };
    const [ok, huge] = await Promise.all(Object.keys(files).map(name => format(files, ["--check", name])));
    expect(ok.stderr).not.toContain("error:");
    expect(huge.stderr).toMatch(/^error: .+\n    at huge\.json$/m);
    expect(huge.exitCode).toBe(2);
  });

  // Neither Prettier nor oxfmt has a fixed limit on nesting depth or length. Prettier's limits are its stack and
  // JavaScript's maximum string length. Each expected value is the SHA-1 of what Prettier 3.9.9 (run with
  // `node --stack-size=50000`, because otherwise its stack overflows before ours) and oxfmt 0.72.0 print.
  describe("no limit on depth or length", () => {
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
        "150 nested unions",
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
      // Each level used to take twice the memory of the level inside it.
      [
        "YAML: 40 mappings with a comment after the key",
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
        "HTML in a template that starts more than 1,024 bytes into its line",
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

    // A debug build has larger stack frames, so it runs out of stack sooner.
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
      // In a JSDoc comment, with oxfmt's `jsdoc`.
      ["a.js", nested("/**\n * ", "> ", "a", "", "\n */ let a;", tooDeep)],
    ])("too deep for the stack or too long for a string is an error that keeps the file: %s", async (name, text) => {
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

    // A case's guard used to be printed without a stack check, so the stack overflowed at depths between the printer's
    // limit and the parser's. The threads that format files have stack to spare, so this uses the main thread with half
    // of its usual stack.
    test.skipIf(isWindows || isDebug || isASAN).concurrent.each([4_500, 4_612, 4_728, 4_846, 4_967, 5_091])(
      "Flow's match with %d nested guards, on a 4 MB stack",
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

    test("rejects output longer than JavaScript's maximum string length", async () => {
      // 560 MB. Prettier prints 490 MB.
      const text = `<img srcset="${"u".repeat(70_000)} 1w${", a 2w".repeat(8_000)}">\n`;
      const result = await format({ "a.html": text }, ["a.html"], { reads: ["a.html"] });
      expect(result.files["a.html"]).toBe(text);
      expect(result.stderr).toStartWith(problem("a.html", "The formatted code is too long for a string") + "\n\n");
      expect(result.exitCode).toBe(2);
    });

    test("shows the line of a syntax error, however long it is", async () => {
      const text = `a{${Buffer.alloc(1000, "b:c;").toString()}}}`;
      const result = await format({ "a.css": text }, ["a.css"]);
      expect(result.stderr).toStartWith(problem("a.css", 'Unexpected "}"', [1, 1_004, text]) + "\n\n");
      expect(result.exitCode).toBe(2);
    });

    // The time is quadratic in the number of differences: 84 s in Prettier.
    test.skipIf(isDebug || isASAN)(
      "finds the cursor by diffing the whole text, however much has changed",
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

  // The depth limit depends on the stack size, and a thread has four times as much stack on Windows, where `keyof ` is
  // formatted.
  test.each(["@", "keyof ", "renders ", "infer A extends ", "component() renders "])(
    "very deeply nested code is rejected or formatted without overflowing the stack: 100,000 times `%s`",
    async word => {
      const text = word === "@" ? word.repeat(100_000) : `// @flow\ntype A = ${word.repeat(100_000)}x;`;
      const result = await format({ "deep.js": text + "\n" }, ["--check", "deep.js"]);
      expect(result.stdout + "\n" + result.stderr).toMatch(/^(?:error: .+\n    at deep\.js\b|deep\.js$)/m);
      expect(result.exitCode).toBe(result.stderr.includes("error:") ? 2 : 1);
    },
  );

  // What a file looks like while it's being typed. TypeScript's parser recovers and leaves these to its checker.
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
  ])("JavaScript with a missing name is a syntax error, and the file is unchanged: %j", async code => {
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
  ])("syntax that only TypeScript's parser accepts is a syntax error in JavaScript: %j", async code => {
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

  test("Flow: a spread in an object type can be a union that starts with `|`", async () => {
    const code = `// @flow
type A = {|
  a: 1,
  ...
    | {|
        b: 2,
      |}
    | {||},
|};
type B = {
  ...C | D,
};
`;
    const files = { "a.js": code.replace("...C | D", "...| C | D") };
    const result = await format(files, ["a.js"], { reads: ["a.js"] });
    expect(result.files).toEqual({ "a.js": code });
    expect(result.exitCode).toBe(0);
  });

  test("Flow: a declared function has no body", async () => {
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

  // Prettier 3.9.9 does this with `--parser flow`. Babel's tree doesn't record which of the two was written, so with
  // `babel`, which parses `.js` files, and with `babel-flow` it prints `T: A` for `T extends A`.
  test.each([[[]], [["--parser", "babel"]], [["--parser", "babel-flow"]], [["--parser", "flow"]]])(
    "Flow: the bound of a type parameter keeps its `extends` or its `:` with %j",
    async flags => {
      const code = `// @flow
type Box<T extends string> = { value: T };
function id<T extends number>(x: T): T {
  return x;
}
type A<T: string, +U extends T = T, -V: T = T> = T;
type B<in T extends string, out U: string> = T;
type C<T extends (A extends B ? C : D)> = T;
type D<T: A extends B ? C : D> = T;
type E<Props extends { ... }> = { a: Props };
function f<const T extends number>(x: T): T {
  return x;
}
function g<const T: number>(x: T): T {
  return x;
}
const h = <T extends number>(x: T): T => x;
class I<+T extends string = "a", U: React.ComponentType<T> = J> extends K<T> {
  m<V extends T>(v: V): V {
    return v;
  }
}
opaque type L<T extends string>: T = T;
export opaque type M<T: string>: T = T;
declare type N<T extends string> = T;
declare opaque type O<T extends string>: T;
declare function p<T extends string>(x: T): T;
declare class Q<T extends string> {
  m<U extends T>(u: U): U;
}
declare export function r<T extends string>(x: T): T;
interface S<T extends string> {
  m<U: T>(u: U): U;
}
type U = <T extends string>(x: T) => T;
type V = { m<T extends string>(x: T): T, n<T: string>(x: T): T };
`;
      const files = { "a.js": code.replace("<T extends string>", "<T   extends\n string>").replace("<T: ", "<T  :") };
      const result = await format(files, [...flags, "a.js"], { reads: ["a.js"] });
      expect(result.files).toEqual({ "a.js": code });
      expect(result.exitCode).toBe(0);
    },
  );

  test("Flow: with --arrow-parens=avoid, the function type of an indexer keeps its parentheses", async () => {
    const code = `// @flow
type A = {|
  [name: string]: (B) => { [string]: mixed },
  [string]: (B) => C,
  a: B => C,
  [[slot]]: B => C,
  +b: B => C,
  m(): B => C,
|};
declare class D {
  [k: string]: (B) => C;
  static [k: string]: (B) => C;
  a: B => C;
}
interface I {
  [k: string]: (B) => C;
}
`;
    const result = await format({ "a.js": code }, ["--arrow-parens=avoid", "--check", "a.js"]);
    expect(result.stderr).not.toContain("a.js");
    expect(result.exitCode).toBe(0);
  });

  test("Flow: a type guard as the return type of an arrow function gets no parentheses", async () => {
    // Prettier 3.9.9 prints `(x: mixed): (x is { a: () => void }) => true`, which its `flow` parser can't parse.
    const code = `// @flow
const a = (x: mixed): x is { a: () => void } => true;
const b = (x: mixed): implies x is { a: () => void } => true;
`;
    const result = await format({ "a.js": code }, ["--parser", "flow", "--check", "a.js"]);
    expect(result.stderr).not.toContain("a.js");
    expect(result.exitCode).toBe(0);
  });

  // This is what oxfmt 0.72.0 does with each. It only runs OXC's parser, so code with errors from the pass that builds
  // the scopes is rejected by oxlint but formatted by oxfmt. Prettier formats a `const` without an initializer.
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
    ["a.ts", "({ a? });"],
    ["a.ts", "({ a?: 1 });"],
    ["a.ts", "({ a! });"],
    ["a.ts", "({ a!: 1 });"],
    ["a.ts", "({ a?() {} });"],
    ["a.ts", "({ a? } = b);"],
  ])("with an .oxfmtrc.json, code that OXC's parser rejects is a syntax error: %s: %j", async (name, code) => {
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
    // typescript-estree and Babel reject these.
    ["a.js", "function f(a = await g()) {}"],
    ["a.js", "function* a(x = yield 1) {}"],
    ["a.mts", "for (var i = 0 in {});"],
    ["a.ts", "for (const x: any of y);"],
    ["a.ts", "with (a) b;"],
    ["a.js", "if (a) label: function f() {}"],
    ["a.js", 'import("m", { with: { type: 1 } });'],
    ["a.ts", "class C<const A> {}\nfunction g<const A>() {}\ninterface I<in out A> {}"],
  ])("with an .oxfmtrc.json, code that OXC's parser accepts is formatted: %s: %j", async (name, code) => {
    const result = await format({ [name]: code + "\n", ".oxfmtrc.json": "{}\n" }, ["--check", name]);
    expect(result.stderr).not.toMatch(anError);
    expect(result.exitCode).toBe(0);
  });

  test("accepts JavaScript's modifiers wherever they're valid", async () => {
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

  test("leaves a JavaScript code block in Markdown with a missing name unchanged", async () => {
    const files = { "a.md": "```js\nlet   x = 1;\nconst\n```\n" };
    const result = await format(files, [], { reads: ["a.md"] });
    expect(result.files).toEqual(files);
    expect(result.exitCode).toBe(0);
  });

  test("formats YAML, GraphQL and Markdown", async () => {
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

  test("formats CSS and SCSS", async () => {
    const result = await format({ "a.css": "a{color:red}\n", "b.scss": "a{b{color:RED}}\n" }, [], {
      reads: ["a.css", "b.scss"],
    });
    expect(result.files).toEqual({
      "a.css": "a {\n  color: red;\n}\n",
      "b.scss": "a {\n  b {\n    color: RED;\n  }\n}\n",
    });
    expect(result.exitCode).toBe(0);
  });

  test("--end-of-line auto uses the first \\r, even if earlier lines end in \\n", async () => {
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

  test("a 10,000-line CSS value doesn't take quadratic time", async () => {
    const result = await format({ "a.css": `a {\n  b:${Buffer.alloc(60_000, "\n    c").toString()};\n}\n` }, [], {
      reads: ["a.css"],
    });
    expect(result.files["a.css"]?.split(/\s+/).join(" ")).toBe(`a { b:${Buffer.alloc(20_000, " c").toString()}; } `);
    expect(result.exitCode).toBe(0);
  });

  test("100,000 namespaces before a name in a selector don't overflow the stack", async () => {
    for (const prefix of ["a|", "*|"]) {
      const result = await format({ "a.css": `${Buffer.alloc(200_000, prefix).toString()}a {\n}\n` }, [], {
        reads: ["a.css"],
      });
      expect(result.files["a.css"]).toBe(`${prefix}a {\n}\n`);
      expect(result.exitCode).toBe(0);
    }
  }, 60_000);

  test("80,000 private fields in a class don't take quadratic time", async () => {
    const fields = Array.from({ length: 80_000 }, (_, i) => `  #p${i};\n`).join("");
    const code = `class A {\n${fields}}\n`;
    const result = await format({ "a.js": code }, [], { reads: ["a.js"] });
    expect(result.files["a.js"]).toBe(code);
    // Wall-clock time is meaningless on a busy machine. It took 8 seconds in a release build when it was quadratic.
    expect(result.cpu).toBeLessThan(isDebug || isASAN ? 30 : 3);
    expect(result.exitCode).toBe(0);
  });

  test("12,000 nested labels don't take quadratic time", async () => {
    const count = isDebug || isASAN ? 1_000 : 12_000;
    const code = `${Array.from({ length: count }, (_, i) => `l${i}`).join(": ")}:;\n`;
    const result = await format({ "a.js": code }, [], { reads: ["a.js"] });
    expect(result.files["a.js"]).toBe(code);
    // Wall-clock time is meaningless on a busy machine. It took over a second in a release build when it was quadratic.
    expect(result.cpu).toBeLessThan(isDebug || isASAN ? 30 : 0.6);
    expect(result.exitCode).toBe(0);
  });

  test("a label is only a duplicate if the first one encloses the second in the same function", async () => {
    const fine = "a: {\n  b:;\n  b:;\n}\na: (function () {\n  a:;\n})();\n";
    const result = await format({ "fine.js": fine, "twice.js": "a: {\n  b: {\n    c:;\n    a:;\n  }\n}\n" }, [], {
      reads: ["fine.js"],
    });
    expect(result.files["fine.js"]).toBe(fine);
    expect(result.stderr).toContain(problem("twice.js", "Label 'a' is already declared", [4, 5, "    a:;"]));
    expect(result.exitCode).toBe(2);
  });

  test("100,000 comments on a line of JSON don't take quadratic time", async () => {
    const comments = Buffer.alloc(400_000, "/**/").toString();
    const result = await format({ "a.json": `${comments}1\n`, "b.json": `[1${comments}, 2]\n` }, [], {
      reads: ["a.json", "b.json"],
    });
    expect(result.files["a.json"]?.replaceAll("/**/", "").trim()).toBe("1");
    expect(result.files["a.json"]?.split("/**/").length).toBe(100_001);
    expect(result.files["b.json"]?.split("/**/").length).toBe(100_001);
    // Wall-clock time is meaningless on a busy machine.
    expect(result.cpu).toBeLessThan(isDebug || isASAN ? 20 : 5);
    expect(result.exitCode).toBe(0);
  }, 60_000);

  test("silently ignores insert_final_newline in an .editorconfig, like Prettier", async () => {
    const result = await format(
      { ".editorconfig": "root = true\n[*]\ninsert_final_newline = true\nindent_size = 4\n", "a.js": "if (a) b;\n" },
      ["--check", "a.js"],
    );
    expect(result.stderr).toBe("1 file is formatted.");
    expect(result.exitCode).toBe(0);
  });

  test("detects the language of a file without an extension from its shebang", async () => {
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
    // In a directory, the others are skipped.
    const directory = await format(files, ["bin"], { reads });
    expect(directory.files).toEqual(after);
    expect(directory.stderr).not.toMatch(anError);
    expect(directory.exitCode).toBe(0);
    const byName = await format(files, reads, { reads });
    expect(byName.files).toEqual(after);
    expect(byName.stderr.split("\n").filter(line => line.includes("No parser could be inferred")).length).toBe(2);
    expect(byName.exitCode).toBe(2);
  });

  // `prettier.getSupportInfo()` lists `bun` and `deno` as interpreters for JavaScript, Flow and TypeScript. The first
  // language wins, so the parser is `babel`, and Prettier 3.9.9 rejects a type annotation in such a file.
  test.each(["bun", "deno", "node", "zx"])(
    "a file without an extension and a %s shebang is JavaScript, like in Prettier",
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

  // linguist lists them under JSON. Prettier 3.9.9 excludes them from its JSON language: see
  // `prettier.getSupportInfo()`.
  test("skips generated files that Prettier doesn't recognize", async () => {
    const names = ["composer.lock", "Pipfile.lock", "flake.lock", "deno.lock", "mcmod.info", "MODULE.bazel.lock"];
    const files = Object.fromEntries(names.map(name => [name, '{"a":   1}\n']));
    // Prettier reads glide.lock as YAML. Without a Prettier config, Bun skips it like every other lock file.
    const all = { ...files, "glide.lock": "a:   1\n" };
    const directory = await format({ ...all, ".prettierrc": "{}\n" }, [], { reads: [...names, "glide.lock"] });
    expect(directory.files).toEqual({ ...files, "glide.lock": "a: 1\n" });
    expect(directory.exitCode).toBe(0);
    expect((await format(all, [], { reads: [...names, "glide.lock"] })).files).toEqual(all);
    const byName = await format(files, names, { reads: names });
    expect(byName.files).toEqual(files);
    expect(byName.stderr.split("\n").filter(line => line.includes("No parser could be inferred")).length).toBe(
      names.length,
    );
    expect(byName.exitCode).toBe(2);
  });

  // These are Prettier 3.9.9's exit codes. `handleError` doesn't set one under `--check`, but `formatFiles` still
  // counts the file as having an error.
  test.each([
    [["--check"], 2],
    [["--list-different"], 2],
    [["--write"], 2],
    [["--check", "--ignore-unknown"], 0],
    [["--list-different", "--ignore-unknown"], 0],
    [["--write", "--ignore-unknown"], 0],
  ])("a file with no matching parser: %j", async (flags, exitCode) => {
    const files = { "FOO": "x   y\n", "a.xyz": "x   y\n" };
    for (const argument of ["FOO", "*.xyz"]) {
      const result = await format(files, [...flags, argument], { reads: Object.keys(files) });
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
  ])("stdin with no matching parser: %j", async (flags, exitCode, isReported) => {
    const result = await format({}, [...flags, "--stdin-filepath", "FOO"], { stdin: "x   y\n" });
    expect(result.raw).toBe("");
    expect(result.stderr.includes("error: No parser could be inferred for file")).toBe(isReported);
    expect(result.exitCode).toBe(exitCode);
  });

  // These are the exit codes of Prettier 3.9.9, whose `listDifferent` doesn't set the exit code, and of oxfmt 0.72.0.
  test.each<[Record<string, string>, string[], number]>([
    [{}, [], 2],
    [{}, ["--write"], 2],
    [{}, ["--check"], 0],
    [{}, ["--list-different"], 0],
    [{}, ["--check", "--write"], 0],
    [{}, ["-l", "--write"], 0],
    [{ ".prettierrc": "{}" }, ["--check"], 0],
    [{ ".oxfmtrc.json": "{}" }, [], 2],
  ])("stdin that doesn't parse: %j %j", async (configuration, flags, exitCode) => {
    const result = await format(configuration, [...flags, "--stdin-filepath", "a.ts"], { stdin: "let a: = 1;\n" });
    expect(result.raw).toBe("");
    // Each tool's own parser message.
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
  ])("stdin that doesn't parse, with --check: %s", async (name, stdin, message, line, column) => {
    const result = await format({}, ["--check", "--stdin-filepath", name], { stdin });
    expect(result.raw).toBe("");
    expect(result.stderr).toBe(problem(name, message, [line, column, stdin.split("\n")[line - 1]]));
    expect(result.exitCode).toBe(0);
  });

  test.each(["--check", "--list-different"])("a file that doesn't parse, with %s", async flag => {
    const result = await format({ "a.ts": "let a: = 1;\n" }, [flag, "a.ts"]);
    expect(result.stderr).toStartWith(problem("a.ts", "Type expected.", [1, 8, "let a: = 1;"]));
    expect(result.exitCode).toBe(2);
  });

  test("formats JSX in an MDX code block in Markdown, even though the output isn't a valid program", async () => {
    // A numeric key keeps its quotes there, because the parser isn't `babel`.
    const result = await format({ "a.md": '```mdx\n<hi/>\n<hello\n/>\n\n<a b={{ "200": 1,  c: 2 }} />\n```\n' }, [], {
      reads: ["a.md"],
    });
    expect(result.files["a.md"]).toBe('```mdx\n<hi />\n<hello />\n\n<a b={{ "200": 1, c: 2 }} />\n```\n');
    expect(result.exitCode).toBe(0);
  });

  test("removes non-ASCII whitespace at the end of a comment and writes the file", async () => {
    const result = await format(
      { "a.js": "// a\u00a0\na;\n// b\u3000\nb;\n// c\u000b\nc;\n/**\n * d\u00a0\n */\nd;\n" },
      [],
      { reads: ["a.js"] },
    );
    expect(result.stderr).not.toContain("error");
    expect(result.files["a.js"]).toBe("// a\na;\n// b\nb;\n// c\nc;\n/**\n * d\n */\nd;\n");
    expect(result.exitCode).toBe(0);
  });

  test("400,000 quoted scalars on a line of YAML don't take quadratic time", async () => {
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

  test("40,000 nodes on a non-ASCII line of YAML don't take quadratic time", async () => {
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

  // Each unit is repeated to make a file. They're inputs that once took more than linear time, and similar ones. Many
  // are rejected, which has to be fast too. Their total time is compared with that of the same number of files with the
  // same number of bytes of ordinary text, so the test holds on a busy machine and in a debug build.
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
    "takes linear time in the size of the text: .%s",
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

  // Inputs that some part of parsing or printing HTML once rescanned for each repetition, and similar ones. Their CPU
  // time is compared with that of the same number of bytes of ordinary HTML, which holds on a busy machine and in a
  // debug build.
  test("HTML, Vue and Angular take linear time", async () => {
    const count = isDebug || isASAN ? 2_000 : 40_000;
    // Each row is the file extension, a prefix, the repeated unit and a suffix.
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

  // A comment in each repetition. These are inputs that attaching or printing comments once rescanned for each comment,
  // and similar ones.
  test("JavaScript with many comments takes linear time", async () => {
    const count = isDebug || isASAN ? 2_000 : 40_000;
    // Each row is the file extension, a prefix, the repeated unit and a suffix.
    const shapes: [string, string, string, string][] = [
      ["js", "", "a; // c\n", ""],
      ["js", "", "// c\na;\n", ""],
      ["js", "", "// c\n", ""],
      ["js", "a; // c\n", ";", ""],
      ["js", "a(", "/* c */ ", "b);"],
      ["js", "a;\n", "/* c */ ", "\n"],
      ["js", "x = ", "/* c */ ", "a;"],
      ["js", "x ", "/* c */ ", "= a;"],
      ["js", "x =\n", "// c\n", "a;"],
      ["js", "x\n", "// c\n", "= a;"],
      ["js", "", "// c\n", "a;"],
      ["js", "a;\n", "// c\n", "b;"],
      ["js", "x = a ", "/* c */ ", "+ b;"],
      ["js", "x = a + ", "/* c */ ", "b;"],
      ["js", "x = a\n", "// c\n", "+ b;"],
      ["js", "x = a +\n", "// c\n", "b;"],
      ["js", "x = { a: ", "/* c */ ", "b };"],
      ["js", "x = a ? ", "/* c */ ", "b : c;"],
      ["js", "x = a.", "/* c */ ", "b;"],
      ["js", "function f() ", "/* c */ ", "{}"],
      ["js", "if (a) ", "/* c */ ", "b;"],
      ["js", "if (a) {}\n", "// c\n", "else {}"],
      ["js", "return_: ", "/* c */ ", "a;"],
      ["ts", "type A = (", "/* c */ ", "B | C)[];"],
      ["ts", "type A = ", "/* c */ ", "B;"],
      ["ts", "let a: ", "/* c */ ", "B = c;"],
      ["ts", "let a ", "/* c */ ", ": B = c;"],
      ["ts", "class A {\n", "// c\n", "a = 1;\n}"],
      ["jsx", "x = <a ", "/* c */ ", "b />;"],
      ["js", "x = `", "${/* c */ a}", "`;"],
      ["js", "x = `", "${a /* c */}", "`;"],
      ["js", "x = [\n", "a, // c\n", "];"],
      ["js", "x = [\n", "// c\na,\n", "];"],
      ["js", "x = [\n", "/* c */ a,\n", "];"],
      ["js", "x = [\n", ", // c\n", "];"],
      ["js", "// prettier-ignore\nx = [\n", "a, // c\n", "];"],
      ["js", "x = {\n", "a: 1, // c\n", "};"],
      ["js", "x = {\n", "// c\na: 1,\n", "};"],
      ["js", "x = {\n", "a: /* c */ 1,\n", "};"],
      ["js", "x = {\n", "a: /* c */ 1, // d\n", "};"],
      ["js", "x = {\n", "// c\na: /* d */ 1,\n", "};"],
      ["js", "function f(\n", "a = /* c */ 1, // d\n", ") {}"],
      ["js", "let\n", "a = /* c */ 1, // d\n", "b;"],
      ["js", "switch (a) {\n", "case /* c */ 1: // d\n", "}"],
      ["js", "export {\n", "a as /* c */ b, // d\n", "};"],
      ["ts", "class A {\n", "a = /* c */ 1; // d\n", "}"],
      ["ts", "interface I {\n", "a: /* c */ 1; // d\n", "}"],
      ["ts", "enum E {\n", "A = /* c */ 1, // d\n", "}"],
      ["ts", "type T = [\n", "a: /* c */ A, // d\n", "];"],
      ["ts", "type T<\n", "A = /* c */ B, // d\n", "> = 1;"],
      ["jsx", "x = <a\n", 'b=/* c */ "d" // e\n', "/>;"],
      ["js", "f(\n", "a, // c\n", ");"],
      ["js", "function f(\n", "a, // c\n", ") {}"],
      ["js", "switch (a) {\n", "// c\ncase 1:\n", "}"],
      ["js", "x = a\n", ".b() // c\n", ";"],
      ["js", "x = a\n", "+ b // c\n", ";"],
      ["js", "export {\n", "a, // c\n", "};"],
      ["js", "x = ", "! /* c */ ", "a;"],
      ["js", "x = ", "new /* c */ ", "a;"],
      ["js", "x = ", "() => /* c */ ", "a;"],
      ["js", "", "{ // c\n", ""],
      ["js", "x = ", "[ // c\n", ""],
      ["js", "x = ", "/** @type {T} */ (", "a"],
      ["jsx", "x = <a>\n", "{/* c */}\n", "</a>;"],
      ["jsx", "x = <a\n", "b // c\n", "/>;"],
      ["ts", "type T =\n", "| A // c\n", ";"],
      ["ts", "type T =\n", "& A // c\n", ";"],
      ["ts", "type T = [\n", "A, // c\n", "];"],
      ["ts", "class A {\n", "// c\na = 1;\n", "}"],
      ["ts", "class A {\n", "a = 1; // c\n", "}"],
      ["ts", "interface I {\n", "a: 1; // c\n", "}"],
      ["ts", "enum E {\n", "A, // c\n", "}"],
      ["ts", "class A {\n", "@a // c\n", "b;\n}"],
      ["ts", "class A {\nb(", "@a // c\n", "c) {}\n}"],
      ["js", "x = ", "@a // c\n", "class {};"],
      ["js", "", "@a // c\n", "class A {}"],
      ["js", "f()", "(/* c */)", ";"],
      ["js", "f()", " /* c */ ()", ";"],
      ["js", "a[0]", "(/* c */)", ".b();"],
      ["js", `"${"a".repeat(100 * count)}"\n`, "// c\n", "[b];"],
      ["js", "a", "\n// c\n.b", ";"],
      ["js", "(", "/* c */ ", `a${".b".repeat(count)})();`],
      ["js", "(", "/* c */ ", `a${".b".repeat(count)}).c;`],
    ];
    const texts = shapes.map(([, before, unit, after]) => before + unit.repeat(count) + after);
    const ordinary =
      "// Returns the sum.\nfunction add(first, second) {\n  const sum = first + second; // a number\n  return [sum, { first, second }];\n}\n\n";
    const length = Math.ceil(texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0) / texts.length);
    for (const configuration of [{}, { ".oxfmtrc.json": "{}\n" }]) {
      const run = (text: (index: number) => string) =>
        format(
          {
            ...configuration,
            ...Object.fromEntries(shapes.map(([ending], index) => [`${index}.${ending}`, text(index)])),
          },
          ["--check", "--log-level", "silent"],
        );
      const odd = await run(index => texts[index]);
      const plain = await run(() => ordinary.repeat(length / ordinary.length));
      // 2.3 to 3 on Linux and 8.3 on Windows when all is well. One shape that takes quadratic time adds 9 or more.
      expect(slowdown(odd, plain)).toBeLessThan(isWindows ? 16 : 8);
    }
  }, 120_000);

  // The same for a unit repeated inside a construct. Prettier's time is quadratic in the number of parameters.
  test("the parameters of @include, @mixin and @function take linear time", async () => {
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

  // Inputs that some part of parsing or printing Markdown once rescanned for each repetition, or took a thousand times
  // too long for, and similar ones. Their CPU time is compared with that of the same number of bytes of prose, which
  // holds on a busy machine and in a debug build.
  test.each([
    ["Prettier flavor", "md", {}],
    ["oxfmt flavor", "md", { ".oxfmtrc.json": "{}\n" }],
    ["MDX", "mdx", {}],
  ])(
    "Markdown takes linear time: %s",
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

  test("a syntax error in HTML uses Prettier's message and position", async () => {
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

  test("an e after a dot or a digit is an ordinary letter, unless it's a zero exponent", async () => {
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

  test("formats JSON", async () => {
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

  describe("file selection", () => {
    const files = {
      "a.js": ugly,
      "src/b.ts": ugly,
      "src/c.mjs": ugly,
      "src/.hidden/d.js": ugly,
      "src/deep/e.jsx": ugly,
      "node_modules/pkg/f.js": ugly,
      "notes.xyz": "?",
    };

    test("defaults to the working directory, without node_modules", async () => {
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

    test("accepts files, directories, patterns and negated patterns", async () => {
      expect(await different(files, ["src/deep", "a.js"])).toEqual(["src/deep/e.jsx", "a.js"]);
      expect(await different(files, ["src/*.{ts,mjs}"])).toEqual(["src/b.ts", "src/c.mjs"]);
      expect(await different(files, ["src", "!**/*.ts", "!src/deep/**"])).toEqual(["src/.hidden/d.js", "src/c.mjs"]);
    });

    test("--with-node-modules includes node_modules", async () => {
      expect(await different(files, ["--with-node-modules", "node_modules"])).toEqual(["node_modules/pkg/f.js"]);
    });

    // Prettier doesn't read any others, so a project with its config gets the same files from both tools.
    test("with a Prettier config, only the working directory's .prettierignore and .gitignore apply", async () => {
      const ignoring = {
        ...files,
        ".prettierrc": "{}\n",
        ".prettierignore": "src/deep\n",
        ".gitignore": "*.mjs\n",
        "src/.gitignore": "b.ts\n",
      };
      expect(await different(ignoring, [])).toEqual(["a.js", "src/.hidden/d.js", "src/b.ts"]);
      expect(await different(ignoring, [], { cwd: "src" })).toEqual([".hidden/d.js", "c.mjs", "deep/e.jsx"]);
      expect(await different(ignoring, ["src/c.mjs", "a.js"])).toEqual(["a.js"]);
      expect(await different(ignoring, ["--ignore-path", "src/.gitignore"])).toEqual([
        "a.js",
        "src/.hidden/d.js",
        "src/c.mjs",
        "src/deep/e.jsx",
      ]);
    });

    describe("without another tool's config, every .gitignore in the repository applies", () => {
      const json = '{"a":1,\n"b":2}\n';
      const names = ["c.gen.json", "dist/b.json", "kept.gen.json", "out/d.json", "src/a.json", "top.json"];
      const project = {
        ".git/HEAD": "ref: refs/heads/main\n",
        ".gitignore": "dist/\n*.gen.json\n/top.json\n",
        "top.json": json,
        "packages/app/.gitignore": "out/\n!kept.gen.json\n",
        ...Object.fromEntries(names.map(name => [`packages/app/${name}`, json])),
      };
      // The `names` that `git status --ignored` doesn't list.
      const left = ["kept.gen.json", "src/a.json", "top.json"];
      const fromRoot = (names: string[]) => names.map(name => `packages/app/${name}`);
      const inApp = { cwd: "packages/app" };

      test("from whichever directory it's run", async () => {
        expect(
          await Promise.all([
            different(project, []),
            different(project, ["packages/app"]),
            different(project, ["**/*.json"]),
            different({ ...project, "bunfig.toml": "[fmt]\nsemi = true\n" }, []),
            different(project, [], inApp),
            different(project, ["**/*.json"], inApp),
            different(project, [], { cwd: "packages/app/src" }),
          ]),
        ).toEqual([fromRoot(left), fromRoot(left), fromRoot(left), fromRoot(left), left, left, ["a.json"]]);
      });

      test("doesn't write an ignored file", async () => {
        const result = await format(project, [], { ...inApp, reads: fromRoot(names) });
        const written = Object.entries(result.files).filter(([, text]) => text !== json);
        expect(written.map(([name]) => name)).toEqual(fromRoot(left));
        expect(result.exitCode).toBe(0);
      });

      test("skips an ignored file or directory even when it's passed by name", async () => {
        expect(
          await Promise.all([
            different(project, ["dist/b.json", "c.gen.json", "out", "dist", "*.gen.json", "src/a.json"], inApp),
            different(project, ["packages/app/out/d.json", "packages/app/kept.gen.json"]),
          ]),
        ).toEqual([["kept.gen.json", "src/a.json"], ["packages/app/kept.gen.json"]]);
        const stdin = ["dist/b.json", "src/a.json"].map(name =>
          format(project, ["--stdin-filepath", name], { ...inApp, stdin: json }),
        );
        expect((await Promise.all(stdin)).map(it => it.raw)).toEqual([json, '{ "a": 1, "b": 2 }\n']);
      });

      test("--ignore-path replaces all of them", async () => {
        const files = { ...project, "packages/app/mine": "src\n" };
        expect(await different(files, ["--ignore-path", "mine"], inApp)).toEqual(
          names.filter(it => it !== "src/a.json"),
        );
      });

      test("those above an inner repository's root don't apply inside it", async () => {
        const files = { ...project, "vendor/lib/.git/HEAD": "", "vendor/lib/dist/i.json": json, "dist/o.json": json };
        expect(await different(files, ["vendor", "dist"])).toEqual(["vendor/lib/dist/i.json"]);
      });

      test("one above the repository's root doesn't apply", async () => {
        const inside = Object.entries(project).map(([name, text]) => [`repository/${name}`, text]);
        const files = { ".gitignore": "src/\n", ...Object.fromEntries(inside) };
        expect(await different(files, [], { cwd: "repository/packages/app" })).toEqual(left);
      });

      // Git ignores nothing there, and Prettier reads the one in the working directory.
      test.skipIf(isInRepository)("outside a repository, none above the working directory applies", async () => {
        const files = {
          "home/.gitignore": "*.json\n",
          "home/other/e.json": json,
          "home/project/.gitignore": "dist/\n",
          "home/project/a.json": json,
          "home/project/dist/b.json": json,
          "home/project/src/.gitignore": "c.json\n",
          "home/project/src/c.json": json,
          "home/project/src/d.json": json,
        };
        const inProject = { cwd: "home/project" };
        expect(
          await Promise.all([
            different(files, [], inProject),
            different(files, ["a.json", "dist/b.json", "src/c.json", "src/d.json"], inProject),
            different(files, ["../other"], inProject),
            different(files, [], { cwd: "home/project/src" }),
            different(files, [], { cwd: "home" }),
          ]),
        ).toEqual([["a.json", "src/d.json"], ["a.json", "src/d.json"], ["../other/e.json"], ["d.json"], []]);
      });

      test("with a Prettier config they don't apply", async () => {
        const files = { ...project, ".prettierrc": "{}\n" };
        expect(await Promise.all([different(files, []), different(files, [], inApp)])).toEqual([
          fromRoot(["out/d.json", "src/a.json", "top.json"]),
          names.filter(it => it !== "out/d.json"),
        ]);
      });
    });

    test("doesn't follow symlinks", async () => {
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

    test("exits with 2 if an argument matches nothing", async () => {
      const result = await format(files, ["nothing/*.js", "a.js"], { reads: ["a.js"] });
      expect(result.files).toEqual({ "a.js": formatted });
      expect(result.stderr).toContain('error: No files matching the pattern were found: "nothing/*.js".');
      expect(result.exitCode).toBe(2);
    });

    test("exits with 2 for a file without a parser, unless -u is passed", async () => {
      const [plain, tolerant] = await Promise.all([format(files, ["notes.xyz"]), format(files, ["-u", "notes.xyz"])]);
      expect(plain.stderr).toContain("No parser could be inferred for file");
      expect({ plain: plain.exitCode, tolerant: tolerant.exitCode }).toEqual({ plain: 2, tolerant: 0 });
    });
  });

  // This is what Prettier 3.9.9 lists.
  test("a pattern that starts above the working directory also matches files inside it", async () => {
    const files = { ".prettierrc": "{}", "x.js": ugly, "here/x.js": ugly, "here/in/x.js": ugly, "there/x.js": ugly };
    const inHere = (pattern: string) => different(files, [pattern], { cwd: "here" });
    expect(await inHere("../**/x.js")).toEqual(["in/x.js", "x.js", "../there/x.js", "../x.js"]);
    expect(await inHere("../here/**/x.js")).toEqual(["in/x.js", "x.js"]);
    expect(await inHere("../*/x.js")).toEqual(["x.js", "../there/x.js"]);
  });

  // A configuration file can be a program. Prettier 3.9.9 runs every one that a pattern reaches. oxfmt 0.72.0 doesn't
  // accept `..`, and only searches the working directory for a pattern's matches.
  describe("a pattern that leaves a working directory without a configuration file", () => {
    const noSemi = `{ semi: false }`;
    const kinds: Record<string, (note: string) => string> = {
      "prettier.config.js": note => `import fs from "node:fs";\n${note}\nexport default ${noSemi};\n`,
      "prettier.config.cjs": note => `const fs = require("fs");\n${note}\nmodule.exports = ${noSemi};\n`,
      ".prettierrc.mjs": note => `import fs from "node:fs";\n${note}\nexport default ${noSemi};\n`,
      ".prettierrc.ts": note => `import fs from "node:fs";\n${note}\nexport default ${noSemi};\n`,
      "oxfmt.config.ts": note => `import fs from "node:fs";\n${note}\nexport default ${noSemi};\n`,
    };
    /** The directory that has the file called `name`. */
    const dirOf = (name: string) => name.replaceAll(".", "-");
    const all = (where: string) =>
      Object.keys(kinds)
        .map(it => `${where}/${dirOf(it)}`)
        .sort();

    /** Returns the programs that ran and how many files don't match their config. `a;` matches the defaults. */
    const run = async (args: string[], more: Record<string, string> = {}) => {
      using logs = tempDir("bun-format-ran", {});
      const log = join(String(logs), "ran.log");
      const files: Record<string, string> = { "w/empty/x.js": "a;\n", ...more };
      for (const where of ["beside", "empty/below"]) {
        for (const [name, text] of Object.entries(kinds)) {
          const note = `fs.appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(`${where}/${dirOf(name)}\n`)});`;
          Object.assign(files, {
            [`w/${where}/${dirOf(name)}/x.js`]: "a;\n",
            [`w/${where}/${dirOf(name)}/${name}`]: text(note),
          });
        }
      }
      const { stdout, exitCode } = await format(files, ["-l", ...args], { cwd: "w/empty" });
      const ran = existsSync(log) ? [...new Set(readFileSync(log, "utf8").split("\n").filter(Boolean))].sort() : [];
      return { ran, different: stdout.split("\n").filter(it => it.endsWith("x.js")).length, exitCode };
    };

    test.each(["../**/x.js", "../beside/*/x.js", "../*/*/x.js"])(
      "doesn't run the programs that %s merely reaches",
      async pattern => {
        const { ran, different } = await run([pattern]);
        expect(ran.filter(it => it.startsWith("beside/"))).toEqual([]);
        // The files below the working directory don't match their own configuration.
        expect(different).toBe(pattern === "../**/x.js" ? Object.keys(kinds).length : 0);
      },
    );

    test("in and below the working directory, each directory's configuration applies", async () => {
      for (const args of [[], ["."], ["**/x.js"]]) {
        expect(await run(args)).toEqual({ ran: all("empty/below"), different: Object.keys(kinds).length, exitCode: 1 });
      }
    });

    test.each(Object.keys(kinds))("a path passed by name uses its own configuration: %s", async name => {
      const expected = { ran: [`beside/${dirOf(name)}`], different: 1, exitCode: 1 };
      expect(await run([`../beside/${dirOf(name)}`])).toEqual(expected);
      expect(await run([`../beside/${dirOf(name)}/x.js`])).toEqual(expected);
      expect(await run([`../beside/${dirOf(name)}`, "../beside/*/x.js"])).toEqual(expected);
    });

    test("a directory passed by name covers everything in it", async () => {
      expect(await run(["../beside"])).toEqual({
        ran: all("beside"),
        different: Object.keys(kinds).length,
        exitCode: 1,
      });
    });

    // Same as Prettier.
    test("with a configuration file in the working directory, every directory's configuration applies", async () => {
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
    test.each(configs)("reads %s: %s", async (name, text) => {
      const result = await format({ [name]: text, "src/a.ts": ugly }, ["src"], { reads: ["src/a.ts"] });
      expect(result.files).toEqual({ "src/a.ts": noSemi });
      expect(result.exitCode).toBe(0);
    });

    // Both ways of reaching a directory: walking into it, and looking above a file passed by name.
    test.each([
      ["package.json", ["."]],
      ["package.json", ["src/a.ts"]],
      [".prettierrc", ["."]],
      ["prettier.config.js", ["src/a.ts"]],
    ])("a directory named %s isn't a configuration file: %j", async (name, args) => {
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
    ])("%s that can't be parsed: %s", async (name, text) => {
      const result = await format({ [name]: text, "a.ts": ugly }, ["a.ts"], { reads: ["a.ts"] });
      expect(result.files).toEqual({ "a.ts": ugly });
      expect(result.stderr).toContain("Cannot load the configuration file");
      expect(result.exitCode).toBe(2);
    });

    // Prettier 3.9.9 reports "YAML Error in ..: Map keys must be unique at line .., column .." for these. A
    // `.prettierrc` is YAML.
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
    ])("a duplicate key in %s: %j", async (name, text, line, column) => {
      const result = await format({ [name]: text, "a.ts": ugly }, ["a.ts"], { reads: ["a.ts"] });
      expect(result.files).toEqual({ "a.ts": ugly });
      expect(result.stderr).toContain("Cannot load the configuration file");
      expect(result.stderr).toContain(`Map keys must be unique at line ${line}, column ${column}:`);
      expect(result.exitCode).toBe(2);
    });

    test("a duplicate key in YAML is reported the way Prettier reports it", async () => {
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

    // Prettier 3.9.9 uses the last one.
    test.each([
      [".prettierrc.json", `{"semi": true, "semi": false}\n`],
      [".prettierrc.json5", `{semi: true, semi: false}\n`],
    ])("the last duplicate key wins in %s", async (name, text) => {
      const result = await format({ [name]: text, "a.ts": ugly }, ["a.ts"], { reads: ["a.ts"] });
      expect(result.files).toEqual({ "a.ts": noSemi });
      expect(result.exitCode).toBe(0);
    });

    test.each([`prettier:\n  semi: false\n  semi: false\n`, `name: a\nname: b\nprettier:\n  semi: false\n`])(
      "a package.yaml with a duplicate key is ignored as a configuration: %j",
      async text => {
        const result = await format({ "package.yaml": text, "a.ts": ugly }, ["a.ts"], { reads: ["a.ts"] });
        expect(result.files).toEqual({ "a.ts": formatted });
        expect(result.exitCode).toBe(0);
      },
    );

    test("a package.yaml that can't be parsed is ignored as a configuration", async () => {
      const files = { "package.yaml": `name: [\n`, ".prettierrc": `semi: false\n`, "a.ts": ugly };
      const result = await format(files, ["a.ts"], { reads: ["a.ts"] });
      expect(result.files).toEqual({ "a.ts": noSemi });
      expect(result.exitCode).toBe(0);
    });

    test("uses the nearest configuration file, skipping a package.json without a `prettier` key", async () => {
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

    test("applies overrides", async () => {
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
      const [explicit, none] = await Promise.all([
        format(files, ["--config", "other.json", "a.js"], { reads: ["a.js"] }),
        format(files, ["--no-config", "a.js"], { reads: ["a.js"] }),
      ]);
      expect(explicit.files).toEqual({ "a.js": formatted.replaceAll('"', "'") });
      expect(none.files).toEqual({ "a.js": formatted });
    });

    describe("--config doesn't load the config files of the project", () => {
      // Each config writes a file next to itself when it's evaluated.
      const program = (tabWidth: number) =>
        `import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./evaluated", import.meta.url), "");\nexport default { tabWidth: ${tabWidth} };\n`;
      const code = (indent: number) => `function f() {\n${" ".repeat(indent)}return 1;\n}\n`;
      const reads = ["evaluated", "nested/evaluated", "a.js", "nested/b.js"];

      test.each([".prettierrc.mjs", "prettier.config.ts", "oxfmt.config.ts"])("%s", async name => {
        const files = {
          [name]: program(8),
          [`nested/${name}`]: program(6),
          "own.json": `{ "tabWidth": 4 }\n`,
          "a.js": code(0),
          "nested/b.js": code(0),
        };
        const after = (evaluated: string | null, a: number, b: number) => ({
          "evaluated": evaluated,
          "nested/evaluated": evaluated,
          "a.js": code(a),
          "nested/b.js": code(b),
        });
        const [looked, none, own, missing, inNested] = await Promise.all([
          format(files, ["."], { reads }),
          format(files, ["--no-config", "."], { reads }),
          format(files, ["--config=own.json", "."], { reads }),
          format(files, ["--config=missing.json", "."], { reads }),
          format(files, ["--config=../own.json", "."], { reads, cwd: "nested" }),
        ]);
        expect(looked.files).toEqual(after("", 8, 6));
        expect(none.files).toEqual(after(null, 2, 2));
        expect(own.files).toEqual(after(null, 4, 4));
        expect(missing.files).toEqual(after(null, 0, 0));
        expect(missing.exitCode).not.toBe(0);
        expect(inNested.files).toEqual(after(null, 0, 4));
      });

      test.skipIf(isWindows)("/dev/null", async () => {
        const files = { ".prettierrc.mjs": program(8), "a.js": code(0) };
        const result = await format(files, ["--config=/dev/null", "."], { reads: ["evaluated", "a.js"] });
        expect(result.files).toEqual({ "evaluated": null, "a.js": code(2) });
      });

      test("still uses the flavor of the tool that the project's config file is named after", async () => {
        const files = { "oxfmt.config.ts": program(8), "own.json": "{}\n", "a.js": wide };
        const result = await format(files, ["--config=own.json", "a.js"], { reads: ["evaluated", "a.js"] });
        // oxfmt's lines are 100 wide.
        expect(result.files).toEqual({ "evaluated": null, "a.js": wide });
      });
    });

    test("--find-config-path prints the nearest config file", async () => {
      const result = await format({ ".prettierrc": "{}", "src/.prettierrc.json": "{}", "src/a.js": "" }, [
        "--find-config-path",
        "src/a.js",
      ]);
      expect(result.raw).toBe("src/.prettierrc.json\n");
      expect(result.exitCode).toBe(0);
    });

    test("exits with 2 for an invalid value", async () => {
      const result = await format({ ".prettierrc": `{ "trailingComma": "sometimes" }`, "a.js": ugly }, ["a.js"], {
        reads: ["a.js"],
      });
      expect(result.files).toEqual({ "a.js": ugly });
      expect(result.stderr).toContain("Invalid trailingComma value");
      expect(result.exitCode).toBe(2);
    });

    test(".oxfmtrc.json: 100-column lines and ignorePatterns", async () => {
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

      test("every .gitignore applies, ! uses .gitignore syntax, and a pattern without a slash matches in every directory", async () => {
        expect(
          await Promise.all([different(project, []), different(project, ["!deep"]), different(project, ["*.ts"])]),
        ).toEqual([["a.js", "src/b.ts", "src/deep/c.js"], ["a.js", "src/b.ts"], ["src/b.ts"]]);
      });

      // This is what oxfmt 0.72.0 does.
      describe("a repository in a repository", () => {
        const [o, i, s] = ["dist/o.js", "vendor/lib/dist/i.js", "vendor/lib/src/s.js"];
        const tree = { ".oxfmtrc.json": "{}\n", [o]: ugly, [i]: ugly, [s]: ugly };
        const [outer, inner] = [{ ".git/HEAD": "" }, { "vendor/lib/.git/HEAD": "" }];

        test.each<[Record<string, string>, string[]]>([
          [{ ...inner, ".gitignore": "dist/\n" }, [i, s]],
          [{ "vendor/lib/.git": "gitdir: ../../.git/modules/lib\n", ".gitignore": "dist/\n" }, [i, s]],
          [{ ...inner, ".git/info/exclude": "src/\n" }, [o, i, s]],
          [{ ...inner, "vendor/lib/.git/info/exclude": "src/\n" }, [o, i]],
        ])("Git's ignore files above its root don't apply inside it, but its own do: %j", async (files, expected) => {
          expect(await different({ ...tree, ...outer, ...files }, [])).toEqual(expected);
        });

        test.skipIf(isInRepository)("outside a repository, an inner repository's root isn't a boundary", async () => {
          const files = { ...tree, ...inner, ".gitignore": "i.js\n" };
          expect(await different(files, ["vendor/lib", "dist"])).toEqual([o, s]);
        });
      });

      test("reads nested configuration files unless --disable-nested-config is passed, and never .prettierrc", async () => {
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

      test("supports insertFinalNewline and sorts package.json", async () => {
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

      test("exits with 2 if no file matches", async () => {
        const result = await format({ ".oxfmtrc.json": "{}\n" }, ["nothing.js"]);
        expect(result.stderr).toContain("Expected at least one target file.");
        expect(result.exitCode).toBe(2);
      });
    });

    test("prettier-plugin-organize-imports: the nearest tsconfig.json decides whether an unused React import stays", async () => {
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
      // This is what Prettier 3 prints with the plugin and TypeScript 5.
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

    test("prettier-plugin-organize-imports: a Flow function type whose parameter has no name", async () => {
      const { files, exitCode } = await format(
        {
          ".prettierrc": `{ "plugins": ["prettier-plugin-organize-imports"] }`,
          "a.js": `// @flow\nimport b from "b";\nimport a from "a";\nexport type T = (A) => B;\nexport default [a, b];\n`,
        },
        [],
        { reads: ["a.js"] },
      );
      expect(files).toEqual({
        "a.js": `// @flow\nimport a from "a";\nimport b from "b";\nexport type T = (A) => B;\nexport default [a, b];\n`,
      });
      expect(exitCode).toBe(0);
    });

    // TypeScript 6.0.3 follows them all. For two that extend each other, it reports the cycle and uses the options of
    // both.
    test("prettier-plugin-organize-imports: follows a chain of tsconfig.json `extends` of any length", async () => {
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

    test("reads .editorconfig unless --no-editorconfig is passed", async () => {
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

    // This is what Prettier 3.9.9 does with each. In a worktree `.git` is a file.
    describe.each<[string, Record<string, string>, boolean]>([
      ["nothing", {}, false],
      ["a .git directory", { "repo/.git/HEAD": "" }, true],
      ["a .git file", { "repo/.git": "gitdir: ../elsewhere\n" }, true],
      ["a .hg directory", { "repo/.hg/store": "" }, true],
      ["a .hg file", { "repo/.hg": "" }, false],
      ["an .editorconfig directory", { "repo/.editorconfig/a": "root = true\n" }, false],
    ])("an .editorconfig above a directory with %s", (_, marker, isRoot) => {
      const files = { ".editorconfig": "[*]\nindent_style = tab\n", "repo/src/a.js": ugly, ...marker };
      const expected = isRoot ? formatted : formatted.replace("  return", "\treturn");

      test.each([[["."]], [["src/a.js"]]])("%j", async args => {
        const result = await format(files, args, { cwd: "repo", reads: ["repo/src/a.js"] });
        expect(result.files).toEqual({ "repo/src/a.js": expected });
        expect(result.exitCode).toBe(0);
      });

      test("stdin", async () => {
        const result = await format(files, ["--stdin-filepath", "src/a.js"], { cwd: "repo", stdin: ugly });
        expect(result.raw).toBe(expected);
        expect(result.exitCode).toBe(0);
      });
    });

    describe("parsing an .editorconfig", () => {
      // The parent .editorconfig shows whether the one under test is a root: if the parent applies, the quotes are
      // single.
      const project = {
        ".git/HEAD": "",
        ".editorconfig": "[*]\nquote_type = single\n",
        "sub/a.js": 'if (a) {\n  b("c");\n}\n',
      };
      const printed = (indent: string, quote: string) => `if (a) {\n${indent}b(${quote}c${quote});\n}\n`;

      // This is what Prettier 3.9.9 prints. It uses `editorconfig-without-wasm`, which doesn't support trailing
      // comments and gives up on a file at the first line it doesn't understand.
      test.each([
        ["a comment after a section: the whole file is ignored", "[*] ; all\nindent_size = 4\n", "  ", "'"],
        ["a comment after a later section", "[*]\nindent_size = 4\n[*.js] # scripts\nindent_size = 8\n", "  ", "'"],
        ["a comment after a value is part of the value", "[*]\nindent_size = 4 # c\n", "  ", "'"],
        ["a colon", "[*]\nindent_size: 4\n", "  ", "'"],
        ["an unparsable line", "[*]\nindent_size = 4\ngarbage\n", "  ", "'"],
        ["an unclosed section", "[*]\nindent_size = 4\n[*.py\n", "  ", "'"],
        ["lines that end with a carriage return", "[*]\rindent_size = 4\r", "    ", "'"],
        ["no-break spaces", "\u00a0[*]\u00a0\n\u00a0indent_size\u00a0=\u00a04\u00a0\n", "    ", "'"],
        ["a byte order mark", "\ufeff[*]\nindent_size = 4\n", "    ", "'"],
        ["root = yes", "root = yes\n[*]\nindent_size = 4\n", "    ", '"'],
        ["root = true # c", "root = true # c\n[*]\nindent_size = 4\n", "    ", '"'],
        ["root = null", "root = null\n[*]\nindent_size = 4\n", "    ", '"'],
        ["root = 0", "root = 0\n[*]\nindent_size = 4\n", "    ", "'"],
        ['root = ""', 'root = ""\n[*]\nindent_size = 4\n', "    ", "'"],
        ["root = true, then false", "root = true\nroot = false\n[*]\nindent_size = 4\n", "    ", "'"],
        ["quote_type = Single isn't recognized", "[*]\nquote_type = Single\n", "  ", '"'],
        ["indent_style = TAB is recognized", "[*]\nindent_style = TAB\n", "\t", "'"],
        ["a word in quotes", '[*]\nindent_style = "tab"\n', "\t", "'"],
        ["a number in quotes", '[*]\nindent_size = "4"\n', "  ", "'"],
        ["04", "[*]\nindent_size = 04\n", "  ", "'"],
        ["4.0", "[*]\nindent_size = 4.0\n", "    ", "'"],
        ["1e1", "[*]\nindent_size = 1e1\n", "          ", "'"],
        ["+4", "[*]\nindent_size = +4\n", "  ", "'"],
        ["4 // c", "[*]\nindent_size = 4 // c\n", "  ", "'"],
        [
          "a repeated section continues at its first position",
          "[*]\nindent_size = 2\n[*.js]\nindent_size = 4\n[*]\nindent_size = 8\n",
          "    ",
          "'",
        ],
      ])("like Prettier: %s", async (_, text, indent, quote) => {
        const result = await format({ ...project, "sub/.editorconfig": text }, ["a.js"], {
          cwd: "sub",
          reads: ["sub/a.js"],
        });
        expect(result.files["sub/a.js"]).toBe(printed(indent, quote));
        expect(result.exitCode).toBe(0);
      });

      // This is what oxfmt 0.72 prints. It uses the `editorconfig-parser` crate, reads a single file, and continues
      // after anything it doesn't understand. `indent_size` only applies if it's known that spaces are used.
      test.each([
        ["indent_size on its own is ignored", {}, "[*]\nindent_size = 4\n", "  "],
        ["indent_size with indent_style", {}, "[*]\nindent_style = space\nindent_size = 4\n", "    "],
        ["indent_size with useTabs", { useTabs: false }, "[*]\nindent_size = 4\n", "    "],
        ["indent_size before tab_width", { useTabs: false }, "[*]\nindent_size = 4\ntab_width = 8\n", "    "],
        ["tab_width on its own", {}, "[*]\ntab_width = 4\n", "    "],
        [
          "useTabs takes precedence over indent_style",
          { useTabs: false },
          "[*]\nindent_style = tab\nindent_size = 4\n",
          "    ",
        ],
        [
          "a comment after a section: what follows belongs to the previous section",
          { useTabs: false },
          "[*]\nindent_size = 4\n[*.py] ; c\nindent_size = 8\n",
          "        ",
        ],
        ["a comment after a value", { useTabs: false }, "[*]\nindent_size = 4 # c\n", "  "],
        ["a colon", { useTabs: false }, "[*]\nindent_size: 4\n", "  "],
        ["an unparsable line", { useTabs: false }, "[*]\nindent_size = 4\ngarbage\n", "    "],
        ["a byte order mark", { useTabs: false }, "\ufeff[*]\nindent_size = 4\n", "  "],
        ["no-break spaces", { useTabs: false }, "\u00a0[*]\u00a0\n\u00a0indent_size\u00a0=\u00a04\u00a0\n", "    "],
        ["a key in upper case", { useTabs: false }, "[*]\nINDENT_SIZE = 4\n", "  "],
        ["+4", { useTabs: false }, "[*]\nindent_size = +4\n", "    "],
        ["04", { useTabs: false }, "[*]\nindent_size = 04\n", "    "],
        ["0", { useTabs: false }, "[*]\nindent_size = 0\n", ""],
        ["260 is 4", { useTabs: false }, "[*]\nindent_size = 260\n", "    "],
        [
          "an invalid value replaces an earlier valid one",
          { useTabs: false },
          "[*]\nindent_size = 4\nindent_size = x\n",
          "  ",
        ],
        [
          "an invalid value doesn't replace one from an earlier section",
          { useTabs: false },
          "[*]\nindent_size = 4\n[*.js]\nindent_size = x\n",
          "    ",
        ],
        ["unset", { useTabs: false }, "[*]\nindent_size = 4\n[*.js]\nindent_size = unset\n", "  "],
        [
          "an out-of-range max_line_length that printWidth overrides",
          { printWidth: 80 },
          "[*]\nmax_line_length = 1000\ntab_width = 4\n",
          "    ",
        ],
      ])("like oxfmt: %s", async (_, config, text, indent) => {
        const files = { ...project, "sub/.oxfmtrc.json": JSON.stringify(config), "sub/.editorconfig": text };
        const result = await format(files, ["a.js"], { cwd: "sub", reads: ["sub/a.js"] });
        expect(result.files["sub/a.js"]).toBe(printed(indent, '"'));
        expect(result.exitCode).toBe(0);
      });

      // globset with its default options, matched against the path relative to the .editorconfig's directory: a plain
      // name matches one file, and `*` and `?` cross `/`.
      test.each([
        ["a name", "a.js", "a.js", "    "],
        ["a name, for a file further down", "a.js", "deep/a.js", "  "],
        ["a name in braces, for a file further down", "{a.js,*.ts}", "deep/a.js", "  "],
        ["a star, for a file further down", "*.js", "deep/a.js", "    "],
        ["a star after a directory, for a file further down", "deep/*.js", "deep/er/a.js", "    "],
        ["a question mark for a slash", "deep?a.js", "deep/a.js", "    "],
        ["a slash in front", "/a.js", "a.js", "  "],
        ["a range of numbers", "{1..3}.js", "2.js", "  "],
        ["unclosed braces", "{a.js", "a.js", "  "],
      ])("like oxfmt: section matching with %s", async (_, section, at, indent) => {
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
        // This is only detected when the file is formatted.
        [
          "tab_width in a later section",
          {},
          "[*]\ntab_width = 4\n[*.js]\ntab_width = 25\n",
          "Invalid tabWidth: The indent width should be between 0 and 24",
          2,
        ],
      ])("like oxfmt, rejects an out-of-range width: %s", async (_, config, text, message, exitCode) => {
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

    test("the path decides the configuration and whether the code is ignored", async () => {
      const files = { "src/.prettierrc": `{ "semi": false }`, ".prettierignore": "ignored.js\n" };
      const [configured, ignored] = await Promise.all([
        format(files, ["--stdin-filepath", "src/new.js"], { stdin: ugly }),
        format(files, ["--stdin-filepath", "ignored.js"], { stdin: ugly }),
      ]);
      expect(configured.raw).toBe(formatted.replaceAll(";", ""));
      expect(ignored.raw).toBe(ugly);
    });

    // Prettier adds the line `node_modules` to every ignore file. oxfmt formats whatever it's given.
    test("skips node_modules like Prettier unless --with-node-modules is passed", async () => {
      const print = async (files: Record<string, string>, ...args: string[]) => {
        const { raw, stderr, exitCode } = await format(files, args, { stdin: ugly });
        return { raw, stderr, exitCode };
      };
      const [skipped, done] = [ugly, formatted].map(raw => ({ raw, stderr: "", exitCode: 0 }));
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
      expect(results).toEqual([skipped, skipped, skipped, skipped, skipped, done, done, done, done, done, done]);
    });

    test("--check prints (stdin) and exits with 1", async () => {
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
      const [here, below, nearer, off, explicit] = await Promise.all([
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
      expect(explicit.raw).toBe(withoutSemi);
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
    ])("an unknown parser: %j %j", async (config, flags, exitCode) => {
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
      // The cursor is in a comment that moves. It stays after the name, which is the node before it.
      [["--cursor-offset", "20"], "function f // comment\n(a, b) {}\n", "function f(a, b) {} // comment\n", "10"],
      // It is before the body, which is the node after it and has the comment in it.
      [
        ["--parser", "typescript", "--cursor-offset", "20"],
        "x  ( );\nclass A  // c1\n{}\ny  ( );\n",
        "x();\nclass A {\n  // c1\n}\ny();\n",
        "13",
      ],
      // After the source of an import type, whose quotes change.
      [
        ["--parser", "typescript", "--cursor-offset", "30"],
        "x  ( );\ntype A = import(  'a'  ).B;\ny  ( );\n",
        'x();\ntype A = import("a").B;\ny();\n',
        "24",
      ],
      [
        ["--parser", "flow", "--cursor-offset", "28"],
        "x  ( );\ndeclare class A  // c1\n{}\ny  ( );\n",
        "x();\ndeclare class A {\n  // c1\n}\ny();\n",
        "21",
      ],
      [
        ["--parser", "typescript", "--cursor-offset", "24"],
        "x  ( );\ninterface A  // c1\n{}\ny  ( );\n",
        "x();\ninterface A {\n  // c1\n}\ny();\n",
        "17",
      ],
      [
        ["--parser", "typescript", "--cursor-offset", "27"],
        "x  ( );\ninterface A<T>  // c1\n{}\ny  ( );\n",
        "x();\ninterface A<T> {\n  // c1\n}\ny();\n",
        "20",
      ],
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

    test("an empty --stdin-filepath doesn't count as a file name", async () => {
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
    test("accepts formatting options", async () => {
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

    test.each([
      ["--chekc", "--check"],
      ["--no-ignore", "--init"],
    ])("exits with 2 for the unknown flag %s and quotes it as written", async (flag, closest) => {
      const result = await format({ "a.js": ugly }, [flag], { reads: ["a.js"] });
      expect(result.files).toEqual({ "a.js": ugly });
      expect(result.stderr).toContain(`Invalid option '${flag}' - perhaps you meant '${closest}'?`);
      expect(result.exitCode).toBe(2);
    });

    test("--log-level silent prints nothing", async () => {
      const result = await format({ "a.js": ugly }, ["--log-level", "silent", "--check"]);
      expect(result.raw).toBe("");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    test("--help prints the usage", async () => {
      const result = await format({}, ["--help"]);
      expect(result.stdout).toContain("bun fmt");
      expect(result.stdout).toContain("--check");
      expect(result.exitCode).toBe(0);
    });
  });
});

/** Returns the unformatted files that `-l` lists in an existing directory. */
async function differentIn(cwd: string, args: string[]) {
  await using proc = spawn({ cmd: [...command, "-l", ...args], env, cwd, stdout: "pipe", stderr: "ignore" });
  return (await proc.stdout.text()).split("\n").filter(Boolean);
}

describe.concurrent("ignored files are never written, however they're reached", () => {
  // This is what Prettier 3.9.9 does.
  test("an ignored directory passed by name", async () => {
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
        // A pattern's search starts in the deepest directory that contains all of its matches.
        different(files, ["generated/*.js", "generated/deep/**", "vendor/**/*.js", "src"]),
        different(files, ["{generated,src}/*.js"]),
      ]),
    ).toEqual([["src/d.js"], ["src/d.js"], ["src/d.js"]]);
    const untouched = ["generated/a.js", "generated/deep/b.js", "vendor/c.js"];
    const result = await format(files, ["generated", "generated/*.js", "vendor", "src"], { reads: untouched });
    expect(result.stdout).toBe("src/d.js");
    expect(result.stderr).not.toMatch(anError);
    expect(result.files).toEqual(Object.fromEntries(untouched.map(name => [name, ugly])));
    expect(result.exitCode).toBe(0);
  });

  test.each([["src"], ["src/*.js"], ["src", "src/*.js"]])(
    "%s isn't an error if every file in it is ignored",
    async (...args) => {
      const files = { ".prettierignore": "src/a.js\nsrc/b.js\n", "src/a.js": ugly, "src/b.js": ugly };
      const result = await format(files, ["--check", ...args], { reads: ["src/a.js"] });
      expect(result.stderr).not.toMatch(anError);
      expect(result.files).toEqual({ "src/a.js": ugly });
      expect(result.exitCode).toBe(0);
    },
  );

  test("a pattern that matches nothing is still an error next to a directory whose files are all ignored", async () => {
    const files = { ".prettierignore": "src/a.js\n", "src/a.js": ugly };
    const result = await format(files, ["--check", "src", "none/*.js"]);
    expect(result.stderr).toContain(`error: No files matching the pattern were found: "none/*.js".`);
    expect(result.stderr).not.toContain(`"src"`);
    expect(result.exitCode).toBe(2);
  });

  // Relative to the ignore file's directory they're `..`, which `.*` matches. But they're never looked up: a file in
  // the project is `src/a.js`.
  test("a pattern doesn't apply to the ignore file's own ancestor directories", async () => {
    const files = { ".prettierignore": ".*\n", "src/a.js": ugly, "b.js": ugly, ".hidden.js": ugly };
    expect(await Promise.all([different(files, ["src", "b.js", ".hidden.js"]), different(files, ["."])])).toEqual([
      ["src/a.js", "b.js"],
      ["b.js", "src/a.js"],
    ]);
  });

  const project = {
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

  // src/utilities/ignore.js passes `path.relative(..)`, here `../src/skipped.js`, to
  // `ignore({ allowRelativePaths: true })`. A pattern without `/` matches the name in it, and `..` is treated like any
  // other directory.
  test("a file outside the directory of the --ignore-path file", async () => {
    expect(
      await Promise.all([
        different(project, [...ignored, "."]),
        different(project, [...ignored, "src/skipped.js", "src/dir/in.js", "src/kept.js"]),
        different(project, [...ignored, "src/dir"]),
        different(project, ["--ignore-path", join("configs", "hidden"), "."]),
      ]),
    ).toEqual([
      ["src/anchored.js", "src/kept.js", "src/mid.js", "top.js"],
      ["src/kept.js"],
      [],
      ["configs/skipped.js"],
    ]);
  });

  // This is what oxfmt 0.72.0 does. In apps/oxfmt/src/core/global_ignore.rs, a search passes the whole path to
  // `Gitignore::matched`, so a pattern without `/` matches the name in it. For an argument, "a path outside the
  // matcher's root is never ignored".
  test("a file outside the directory of the --ignore-path file, like oxfmt", async () => {
    const files = { ...project, ".oxfmtrc.json": "{}\n" };
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

// Prettier 3.9.9 doesn't read it. The skipped files are the ones that `git check-ignore` reports.
describe.concurrent("the info/exclude of the working directory's repository", () => {
  const names = ["a.js", "gen/b.js", "kept.js", "sub/a.js", "sub/anchored.js", "sub/named.js"];
  const tree = Object.fromEntries(names.map(name => [name, ugly]));
  const excludes = "# a comment\n/a.js\nnamed.js\ngen/\n/sub/anchored.js\n";
  const left = ["kept.js", "sub/a.js"];
  /** `files`, moved into `directory`. */
  const inside = (directory: string, files: Record<string, string>) =>
    Object.fromEntries(Object.entries(files).map(([name, text]) => [`${directory}/${name}`, text]));

  test.each([
    ["no configuration", {}],
    [".prettierrc", { ".prettierrc": "{}\n" }],
  ])("its patterns are relative to the working tree's root, with %s", async (_, configuration) => {
    const files = { ...tree, ...configuration, ".git/info/exclude": excludes };
    expect(
      await Promise.all([
        different(files, []),
        different(files, [], { cwd: "sub" }),
        different(files, ["a.js", "sub/named.js", "gen", "gen/b.js", "sub/a.js"]),
        different(files, ["**/*.js"]),
        // Like .gitignore, it isn't read if --ignore-path is passed.
        different({ ...files, "mine": "kept.js\n" }, ["--ignore-path", "mine"]),
        different({ ...tree, ...configuration, ".git/HEAD": "ref: refs/heads/main\n" }, []),
      ]),
    ).toEqual([left, ["a.js"], ["sub/a.js"], left, names.filter(it => it !== "kept.js"), names]);
  });

  test("one that exists but can't be read is an error, like a .gitignore", async () => {
    const results = await Promise.all(
      [".git/info/exclude", ".gitignore"].map(name => format({ [`${name}/a`]: "", "a.js": ugly }, ["--check"])),
    );
    expect(results.map(it => [it.stderr.split(":")[1], it.exitCode])).toEqual([
      [" Unable to read '.git/info/exclude'", 2],
      [" Unable to read '.gitignore'", 2],
    ]);
  });

  test("--check succeeds if every other file is formatted", async () => {
    const files = { ".git/info/exclude": "/ugly.ts\n", "ugly.ts": "const   a=1\n", "ok.ts": "const a = 1;\n" };
    const results = await Promise.all([
      format(files, ["--check"]),
      format(files, ["--check", "--ignore-path=.git/info/exclude"]),
    ]);
    expect(results.map(it => it.exitCode)).toEqual([0, 0]);
  });

  test("stdin with the name of an excluded file is printed unchanged", async () => {
    const files = { ".git/info/exclude": "/a.js\n" };
    const results = await Promise.all(
      ["a.js", "b.js"].map(name => format(files, ["--stdin-filepath", name], { stdin: ugly })),
    );
    expect(results.map(it => it.raw)).toEqual([ugly, formatted]);
  });

  test(".gitignore takes precedence over it", async () => {
    const files = { "a.js": ugly, "b.js": ugly, "c.js": ugly, "dir/d.js": ugly };
    expect(
      await Promise.all([
        different({ ...files, ".git/info/exclude": "a.js\nb.js\n", ".gitignore": "!a.js\n" }, []),
        different({ ...files, ".git/info/exclude": "!a.js\n", ".gitignore": "a.js\n" }, []),
        different({ ...files, ".git/info/exclude": "*.js\n!a.js\n" }, []),
        // Nothing can un-ignore a file in an ignored directory.
        different({ ...files, ".git/info/exclude": "dir/\n", ".gitignore": "!dir/d.js\n" }, []),
        // .prettierignore isn't one of Git's files.
        different({ ...files, ".git/info/exclude": "!a.js\n", ".prettierignore": "a.js\n" }, []),
      ]),
    ).toEqual([
      ["a.js", "c.js", "dir/d.js"],
      ["b.js", "c.js", "dir/d.js"],
      ["a.js"],
      ["a.js", "b.js", "c.js"],
      ["b.js", "c.js", "dir/d.js"],
    ]);
  });

  // `git worktree add` writes these, the first with an absolute path unless it's run with `--relative-paths`.
  const worktree = {
    ...inside("wt", tree),
    "wt/.git": "gitdir: ../main/.git/worktrees/wt\n",
    "main/.git/worktrees/wt/commondir": "../..\n",
    "main/.git/info/exclude": excludes,
  };

  test("in a `git worktree add` working tree, uses the main repository's", async () => {
    const absolute = (dir: string) =>
      writeFileSync(join(dir, "wt", ".git"), `gitdir: ${join(dir, "main", ".git", "worktrees", "wt")}\n`);
    expect(
      await Promise.all([
        different(worktree, [], { cwd: "wt" }),
        different(worktree, [], { cwd: "wt/sub" }),
        different(worktree, [], { cwd: "wt", before: absolute }),
      ]),
    ).toEqual([left, ["a.js"], left]);
  });

  test("in a submodule, uses the submodule's", async () => {
    const files = {
      ...inside("vendor/lib", tree),
      ".git/info/exclude": "kept.js\n",
      ".git/modules/vendor/lib/info/exclude": excludes,
      "vendor/lib/.git": "gitdir: ../../.git/modules/vendor/lib\n",
    };
    expect(
      await Promise.all([different(files, [], { cwd: "vendor/lib" }), different(files, [], { cwd: "vendor/lib/sub" })]),
    ).toEqual([left, ["a.js"]]);
  });

  test("in a nested repository, uses the inner one's", async () => {
    const files = {
      ...inside("inner", tree),
      ".git/info/exclude": "kept.js\n",
      "inner/.git/info/exclude": excludes,
    };
    expect(await different(files, [], { cwd: "inner/sub" })).toEqual(["a.js"]);
  });

  test("doesn't apply to a file outside the working tree", async () => {
    const files = { "repo/.git/info/exclude": "*.js\n.*\n", "repo/a.js": ugly, "other/b.js": ugly };
    expect(
      await Promise.all([
        different(files, [".", "../other"], { cwd: "repo" }),
        different(files, [".", "../other/b.js"], { cwd: "repo" }),
        different(files, ["--ignore-path", ".git/info/exclude", ".", "../other"], { cwd: "repo" }),
      ]),
    ).toEqual([["../other/b.js"], ["../other/b.js"], ["../other/b.js"]]);
  });

  describe("passed to --ignore-path", () => {
    test.each([
      ["no configuration", {}],
      [".prettierrc", { ".prettierrc": "{}\n" }],
      [".oxfmtrc.json", { ".oxfmtrc.json": "{}\n" }],
    ])("its patterns are relative to the working tree's root, with %s", async (_, configuration) => {
      const files = { ...tree, ...configuration, ".git/info/exclude": excludes };
      expect(
        await Promise.all([
          different(files, ["--ignore-path", ".git/info/exclude"]),
          different(files, ["--ignore-path", "../.git/info/exclude"], { cwd: "sub" }),
          different(files, ["--ignore-path", ".git/info/exclude", "a.js", "sub/named.js", "sub/a.js"]),
          // Any other file's patterns are relative to that file's directory.
          different({ ...files, "sub/info/exclude": "/a.js\n", "sub/info/a.js": ugly }, [
            "--ignore-path",
            "sub/info/exclude",
            ...names,
            "sub/info/a.js",
          ]),
        ]),
      ).toEqual([left, ["a.js"], ["sub/a.js"], names]);
    });

    test("from above the repository", async () => {
      const files = { ...inside("repo", tree), "repo/.git/info/exclude": excludes, "a.js": ugly };
      expect(await different(files, ["--ignore-path", "repo/.git/info/exclude"])).toEqual([
        "a.js",
        ...left.map(it => `repo/${it}`),
      ]);
    });

    test("from another working tree of the repository", async () => {
      expect(
        await Promise.all([
          different(worktree, ["--ignore-path", "../main/.git/info/exclude"], { cwd: "wt" }),
          different(worktree, ["--ignore-path", "../../main/.git/info/exclude"], { cwd: "wt/sub" }),
        ]),
      ).toEqual([left, ["a.js"]]);
    });
  });
});

describe.concurrent("path handling", () => {
  test("accepts an absolute pattern", async () => {
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

  // The answers are looked up by these paths, which use `/` on every system. `path.win32` turns `/` into `\\`.
  test("the Tailwind helper's answers echo the request's paths, also on Windows", async () => {
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
      // As in `run`: nothing is downloaded.
      cmd: [bunExe(), "--no-install", "-e", `const given = ${JSON.stringify(given)};\n${source}`],
      env,
      cwd: String(dir),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    });
    const stdout = await proc.stdout.text();
    const { config } = JSON.parse(stdout.slice(stdout.lastIndexOf("<marker>") + "<marker>".length));
    // Nothing is installed there, so each group gets an error.
    expect(config.groups.map(({ error, ...which }: { error: string }) => [typeof error, which])).toEqual(
      groups.map(({ classes, ...which }) => ["string", which]),
    );
  });

  // This doesn't use `normalizeBunSnapshot`, which turns every `\\` into `/`.
  test("error messages show native paths", async () => {
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

  // src/config/prettier-config/config-searcher.js and the `editorconfig` package ask the file system for a file with
  // that name.
  test("a configuration file whose name differs in case is used on a case-insensitive file system", async () => {
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

describe.concurrent("a file that isn't UTF-8 or contains a NUL", () => {
  /** Formats a directory with `files`. Returns the files afterwards as latin1 strings, one character per byte. */
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
      // Everything printed for each error. A blank line follows each one.
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

  // This is what Windows PowerShell's `>` and `Out-File` write.
  test.each([
    ["little", utf16le],
    ["big", utf16be],
  ])("UTF-16, %s endian, is rejected in every language and left unchanged", async (_, encode) => {
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

  test("doesn't drop what follows a NUL in HTML", async () => {
    const files = {
      "a.html": "<p   a>b</p>\n<p>c\0d</p>\n<p>e</p>\n",
      "a.vue": "<template>\n<p>b\0c</p>\n</template>\n<script>\nlet a  = 1\n</script>\n",
      // The template isn't treated as HTML then, and stays unchanged.
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

  // Prettier 3.9.9 and oxfmt 0.72 fail here too, with the same message.
  test.each([
    ["a tag name", "<a\0b   >x</a\0b>\n", "a"],
    ["an attribute name", '<p   a\0b="c">x</p>\n', "p"],
    ["an unquoted attribute value", "<p   title=a\0b>x</p>\n", "p"],
  ])("a NUL in %s is an error", async (_, text, name) => {
    expect(await bytesAfter({ "a.html": text })).toEqual({
      errors: [problem("a.html", `Opening tag "${name}" not terminated.`, [1, 1, text])],
      exitCode: 2,
      files: { "a.html": text },
    });
  });

  test("keeps a NUL in places where it doesn't cut the HTML short", async () => {
    const result = await bytesAfter({
      "a.html": '<p   a="\0">b</p>\n<!-- \0 -->\n<script>a\0b</script>\n<p>e</p>\n',
    });
    expect(result).toEqual({
      errors: [],
      exitCode: 0,
      files: { "a.html": '<p a="\0">b</p>\n<!-- \0 -->\n<script>\n  a\0b\n</script>\n<p>e</p>\n' },
    });
  });

  test("leaves Windows-1252 bytes unchanged", async () => {
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

  /** Formats a directory with `files`. Returns the files afterwards as latin1 strings, one character per byte. */
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

  // The baseline that all the others are compared with.
  const withLineFeeds = bytesAfter(lineEndingInputs);

  test("formats every input without introducing a \\r", async () => {
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

  test("handles \\r\\n and \\n mixed in one file", async () => {
    const expected = await withLineFeeds;
    let count = 0;
    const result = await bytesAfter(
      mapped(lineEndingInputs, text => text.replaceAll("\n", () => (count++ % 2 ? "\n" : "\r\n"))),
    );
    expect(result.errors).toEqual([]);
    expect(result.files).toEqual(expected.files);
  });

  test("keeps a byte order mark, which changes nothing else", async () => {
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
  ])("--end-of-line %s: writes exactly that line break everywhere", async (option, before, after) => {
    const expected = await withLineFeeds;
    const result = await bytesAfter(
      mapped(lineEndingInputs, text => text.replaceAll("\n", before)),
      ["--end-of-line", option],
    );
    expect(result.errors).toEqual([]);
    expect(result.files).toEqual(mapped(expected.files, text => text.replaceAll("\n", after)));
    expect(result.exitCode).toBe(0);
  });

  test("a multi-line template as a computed key", async () => {
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

  test("a multi-line cell in an it.each table", async () => {
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

  test("a JSON5 string that continues on the next line and changes quotes", async () => {
    const result = await bytesAfter({ "a.json5": "{a:'x\\\ny','b\\\nc':1}\n" }, ["--end-of-line", "crlf"]);
    expect(result.files).toEqual({ "a.json5": '{\r\n  a: "x\\\r\ny",\r\n  "b\\\r\nc": 1,\r\n}\r\n' });
  });

  describe("--range-start, --range-end and --cursor-offset count UTF-16 code units of the original text", () => {
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
      // `text()` would strip a byte order mark.
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
      return { printed: Buffer.from(stdout).toString("utf8"), cursor: stderr.trim(), exitCode };
    };

    // Nothing in CSS or YAML can be formatted on its own, so a range that doesn't cover the whole text formats nothing.
    test.each([
      ["a.css", "a{b:c}\r\nd{e:f}\r\n", "a {\n  b: c;\n}\nd {\n  e: f;\n}\n"],
      ["a.yaml", "a:   1\r\nb:   2\r\n", "a: 1\nb: 2\n"],
    ])("%s with \\r\\n", async (name, text, whole) => {
      const unformatted = text.replaceAll("\r\n", "\n");
      // Before the last `\r\n`: not the whole text.
      expect((await onStdin(name, text, ["--range-end", "14"])).printed).toBe(unformatted);
      // Inside the last `\r\n`, and after it: the whole text.
      expect((await onStdin(name, text, ["--range-end", "15"])).printed).toBe(whole);
      expect((await onStdin(name, text, ["--range-end", "16"])).printed).toBe(whole);
      // An empty range: not even the line breaks change.
      expect((await onStdin(name, text, ["--range-start", "15"])).printed).toBe(text);
    });

    test.each([
      ["a.css", "a{b:'é'}\n", 'a {\n  b: "é";\n}\n'],
      ["a.yaml", "a:   é\n", "a: é\n"],
    ])("%s with a two-byte character", async (name, text, whole) => {
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

    test("--insert-pragma inserts nothing if only part of a style sheet is formatted", async () => {
      const result = await onStdin("a.css", "a{b:c}\r\nd{e:f}\r\n", ["--range-end", "14", "--insert-pragma"]);
      expect(result.printed).toBe("a{b:c}\nd{e:f}\n");
    });

    test("the cursor in HTML with a range", async () => {
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

    test("the cursor after a multi-byte character, with a range", async () => {
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

    test("a range that ends right after the byte order mark is empty", async () => {
      const text = "\uFEFFa  =  1;\nb  =  2;\n";
      expect((await onStdin("a.js", text, ["--range-end", "1"])).printed).toBe(text);
    });

    test.each(["a.js", "a.json", "a.css"])(
      "prints no cursor for %s if it's only a byte order mark and whitespace",
      async name => {
        expect(await onStdin(name, "\uFEFF\r\n", ["--cursor-offset", "1"])).toEqual({
          printed: "\uFEFF",
          cursor: "",
          exitCode: 0,
        });
      },
    );
  });

  test("--insert-pragma in a file whose first \\r isn't followed by \\n", async () => {
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

  test("U+2028 after an object's { is a line break in oxfmt but not in Prettier", async () => {
    const files = { "a.ts": "const o = {\u2028a: 1 };\ntype A = {\u2028a: 1 };\n" };
    const asPrettier = await format(files, ["--no-config", "a.ts"], { reads: ["a.ts"] });
    expect(asPrettier.files).toEqual({ "a.ts": "const o = { a: 1 };\ntype A = { a: 1 };\n" });
    const asOxfmt = await format({ ...files, ".oxfmtrc.json": "{}\n" }, ["a.ts"], { reads: ["a.ts"] });
    expect(asOxfmt.files).toEqual({ "a.ts": "const o = {\n  a: 1,\n};\ntype A = {\n  a: 1;\n};\n" });
  });

  // oxfmt 0.72 writes `\r\r\n` here. Bun writes each line break once.
  test("a multi-line type in a JSDoc comment, with endOfLine: crlf", async () => {
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

describe.concurrent("uppercase and mixed-case file names", () => {
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
    // `shouldForceTrailingComma` tests the name as written against `/\.ts$/`.
    "Q.TS": "const f = <T,>() => {}\n",
    // These were already recognized before.
    "L.CSS": "a{b:c}\n",
    "README.MD": "*  a\n",
    "M.JSON": '{"a":\n1}\n',
    "N.HTML": "<a   b></a>\n",
    "O.VUE": "<template><a   b /></template>\n",
    "P.HBS": "<a   b></a>\n",
  };
  // This is what Prettier 3.9.9 prints. Its `getLanguageByFileName` compares lowercased names.
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

  test("are recognized in a directory", async () => {
    const result = await format(files, ["--no-config", "."], { reads: Object.keys(files) });
    expect(result.files).toEqual(printed);
    expect(result.exitCode).toBe(0);
  });

  test("are recognized as arguments", async () => {
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

  // oxfmt's `classify_file_kind` is case-sensitive.
  test("aren't recognized with an oxfmt config", async () => {
    const result = await format({ ".oxfmtrc.json": "{}\n", "A.JS": "a  =  1\n", "b.js": "a  =  1\n" }, ["."], {
      reads: ["A.JS", "b.js"],
    });
    expect(result.files).toEqual({ "A.JS": "a  =  1\n", "b.js": "a = 1;\n" });
  });

  // This only tests something on Windows and macOS, whose file systems find `a.ts` under the name `A.TS`.
  test("a name typed in a different case than the file's", async () => {
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
    // The replacement file gets the original name, not the one that was typed.
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
  test("a format script doesn't win", async () => {
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

// This is what `bun fmt` ran before the formatter existed.
describe.concurrent("other things named fmt in the project", () => {
  test.each([
    ["a file", { "fmt.ts": 'console.log("the file");' }, "the file"],
    ["the index of a directory", { "fmt/index.js": 'console.log("the index");' }, "the index"],
  ])("%s wins over the formatter, and nothing is rewritten", async (_, files, printed) => {
    const result = await format({ ...files, "a.js": ugly }, [], { reads: ["a.js"] });
    expect(result.stdout).toBe(printed);
    expect(result.files).toEqual({ "a.js": ugly });
    expect(result.exitCode).toBe(0);
  });

  test.skipIf(isWindows)("a package's executable wins over the formatter, and nothing is rewritten", async () => {
    const files = { "node_modules/.bin/fmt": "#!/bin/sh\necho the executable\n", "a.js": ugly };
    const result = await format(files, [], {
      reads: ["a.js"],
      before: dir => chmodSync(join(dir, "node_modules/.bin/fmt"), 0o755),
    });
    expect(result.stdout).toBe("the executable");
    expect(result.files).toEqual({ "a.js": ugly });
    expect(result.exitCode).toBe(0);
  });

  test("a directory with nothing to run in it doesn't win", async () => {
    const result = await format({ "fmt/notes.txt": "x", "a.js": ugly }, [], { reads: ["a.js"] });
    expect(result.files).toEqual({ "a.js": formatted });
    expect(result.exitCode).toBe(0);
  });

  // On macOS, `which` treats a searchable directory as executable.
  test("such a directory doesn't win next to a package.json either", async () => {
    const files = { "package.json": "{}\n", "fmt/notes.txt": "x", "a.js": ugly };
    const result = await format(files, [], { reads: ["a.js"] });
    expect(result.files).toEqual({ "a.js": formatted });
    expect(result.exitCode).toBe(0);
  });
});

// What the formatter needs from its host process: the terminal, the arguments, the streams, the stack, and a way to run
// a configuration file that's a program. In `bun fmt`'s development setup, each of these is provided by something other
// than Bun.
describe.concurrent("what bun fmt gets from Bun", () => {
  /** Runs `bun ...args` in a directory with `files`. */
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

  test("colors follow Bun's rules: FORCE_COLOR, NO_COLOR, and no colors in a pipe", async () => {
    const files = { "a.js": ugly };
    const withPrettier = { ...files, ".prettierrc": "{}\n" };
    const [forced, disabled, piped, asOxfmt] = await Promise.all([
      format(withPrettier, ["--check"], { env: { FORCE_COLOR: "1" } }),
      format(withPrettier, ["--check"], { env: { NO_COLOR: "1" } }),
      format(withPrettier, ["--check"]),
      format({ ...files, ".oxfmtrc.json": "{}\n" }, ["--check", "a.js"], { env: { FORCE_COLOR: "1" } }),
    ]);
    expect(forced.stderr.split("\n")[0]).toBe("[\x1b[33mwarn\x1b[0m] a.js");
    expect(disabled.stderr.split("\n")[0]).toBe("[warn] a.js");
    expect(piped.stderr.split("\n")[0]).toBe("[warn] a.js");
    expect(asOxfmt.raw.split("\n")[2]).toMatch(/^\x1b\[33ma\.js\x1b\[0m \(\d+ms\)$/);
  });

  test("--cwd works after fmt, before it and in BUN_OPTIONS, whose other flags aren't passed to the formatter", async () => {
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

  // The process that runs the configuration file starts in that directory. If it inherited BUN_OPTIONS, it would look
  // for `sub` in `sub`.
  test("--cwd in BUN_OPTIONS, with a configuration file that is a program", async () => {
    const files = { "sub/.prettierrc.mjs": "export default { semi: false };\n", "sub/b.js": "b;\n" };
    const result = await bun(files, ["fmt", "-l", "b.js"], { BUN_OPTIONS: "--cwd=sub" });
    expect(result).toEqual({ stdout: "b.js\n", stderr: "", exitCode: 1 });
  });

  // Prettier prints the names and never exits.
  test("exits despite a configuration file that leaves a timer running", async () => {
    const files = {
      "prettier.config.mjs": "setInterval(() => {}, 1000);\nexport default { semi: false };\n",
      "b.js": "b;\n",
    };
    expect(await bun(files, ["fmt", "-l", "b.js"])).toEqual({ stdout: "b.js\n", stderr: "", exitCode: 1 });
  });

  test("doesn't read the sections of bunfig.toml that are for other commands", async () => {
    const result = await bun({ "bunfig.toml": "[install]\nglobalDir = 1\n", "a.js": ugly }, ["fmt", "-l"]);
    expect(result).toEqual({ stdout: "a.js\n", stderr: "", exitCode: 1 });
  });

  test("--config= before fmt selects a file other than bunfig.toml", async () => {
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

  test("an error in [fmt] is shown with its location, as for every other section", async () => {
    const files = { "bunfig.toml": `[fmt]\nsemi = false\nprintWidth = "wide"\n`, "a.js": ugly };
    const result = await bun(files, ["fmt", "-l"]);
    expect(result.stderr).toContain(`3 | printWidth = "wide"\n`);
    expect(result.stderr).toMatch(/error: expected number but received string\n\s+at .*bunfig\.toml:3:14\n/);
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(2);
  });

  const count = isDebug || isASAN ? 20_000 : 300_000;
  const long = `a(${Array.from({ length: count }, (_, i) => `"x${i}"`).join(",")});\n`;

  test("prints more output than fits in a pipe", async () => {
    const result = await format({}, ["--stdin-filepath", "a.js"], { stdin: long });
    const expected = `a(\n${Array.from({ length: count }, (_, i) => `  "x${i}",\n`).join("")});\n`;
    expect(result.raw.length).toBe(expected.length);
    expect(Bun.hash(result.raw)).toBe(Bun.hash(expected));
    expect(result.exitCode).toBe(0);
  });

  test("exits with 0 if the reader closes the pipe early", async () => {
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

  test.skipIf(!isLinux)("a file name that isn't UTF-8, found in a directory and passed as an argument", async () => {
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

  test("many directories that each have a program as a configuration file, loaded by all threads at once", async () => {
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

  // Standard input is formatted on the main thread, whose stack differs from a pool thread's.
  test.each(["[", "a(", "{a:", "<a>"])(
    "standard input that's nested too deeply is rejected: 100,000 times `%s`",
    async open => {
      const result = await format({}, ["--stdin-filepath", "deep.jsx"], { stdin: open.repeat(100_000) + "\n" });
      expect(result.raw).toBe("");
      expect(result.stderr).toMatch(/^error: .+\n    at deep\.jsx\b/m);
      expect(result.exitCode).toBe(2);
    },
  );
});

// The differences between Windows, macOS and Linux that matter to `bun fmt`: path syntax, which names refer to the same
// file, line endings, links and write permissions. Nothing here goes through `normalizeBunSnapshot`, which turns every
// `\` into `/` and every `\r\n` into `\n`, so the output is compared exactly as printed.
//
// A test that's only meaningful on one system still runs on the others where it can, to check that nothing else breaks
// there.
describe("bun fmt on Windows, macOS and Linux", () => {
  const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, NO_COLOR: "1", FORCE_COLOR: undefined };

  // If a test timed out, the drive letter it took would stay assigned for every process in the session.
  const drives = new Set<string>();
  const subst = (...args: string[]) => Bun.spawnSync({ cmd: ["subst", ...args] }).exitCode === 0;
  afterAll(() => {
    endChildren();
    for (const drive of drives) subst(drive, "/D");
  });

  /** Uses `subst` to give `directory` a drive letter while `use` runs. */
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

  /** Runs `bun fmt <args>` in `cwd`. Returns its output unmodified. */
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

  /** Returns the unformatted files that `-l` lists, exactly as printed. */
  const different = async (cwd: Directory, args: string[]) =>
    (await format(cwd, ["-l", ...args])).stdout.split("\n").filter(Boolean);
  const read = (dir: Directory, ...names: string[]) => readFileSync(join(String(dir), ...names), "utf8");
  /** Every name under `dir`, including directories, relative to `dir` and with `/`. */
  const everythingIn = (dir: Directory) =>
    (readdirSync(String(dir), { recursive: true }) as string[]).map(it => it.replaceAll(sep, "/")).sort();
  const swapCase = (text: string) =>
    text.replace(/[a-z]/gi, letter => (letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase()));

  /** Sets and reads a file's extended attributes, if the temporary directory's file system supports them. */
  const attributes = (() => {
    if (!isLinux && !isMacOS) return undefined;
    const c = (text: string) => Buffer.from(`${text}\0`);
    // On macOS, a position argument comes before the flags.
    const onMacOS = () => {
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
    const onLinux = () => {
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
    const { set, get } = isMacOS ? onMacOS() : onLinux();
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

  describe.concurrent("path syntax", () => {
    // src/cli/format.js: `const fileNameToDisplay = normalizeToPosix(path.relative(cwd, filename))`
    test("prints names relative to the working directory with `/`, and ends lines with \\n", async () => {
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
    test("accepts native paths as arguments", async () => {
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

    test("accepts native paths as flag values", async () => {
      using dir = tempDir("bun-format-platform", {
        "configs/mine.json": `{ "semi": false }\n`,
        // The patterns are relative to the file's directory.
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

    test("accepts a native path for --stdin-filepath", async () => {
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

    // These characters have a special meaning in a URL, and a configuration file that's a program is imported by its
    // URL.
    test(
      "a project in a directory with spaces, `#`, `%41` and non-ASCII letters",
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

    // 300 characters below the project: more than Windows' MAX_PATH of 260, and with the project's own path still less
    // than macOS's 1024.
    test("a path longer than 260 characters", async () => {
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
      const byName = await format(dir, [join(...names, "b.js")]);
      expect(read(dir, ...names, "b.js")).toBe("a\n");
      expect(byName.exitCode).toBe(0);
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
            // From another drive, `path.relative()` has no common prefix to strip. The configuration is in the root,
            // above the file.
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

    // Uses the drive's administrative share, as in test/js/node/fs/cp.test.ts. `\\wsl.localhost\..` and a virtual
    // machine's shared folders behave the same.
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
          // From the drive, which `path.relative()` doesn't recognize as the same location.
          different(dir, [`${share}\\src\\a.js`]),
        ]),
      ).toEqual([["src/a.js"], ["src/a.js"], [`${share}/src/a.js`.replaceAll("\\", "/")]]);
      const written = await format(share, []);
      expect(written.stderr).not.toMatch(anError);
      expect(read(dir, "src", "a.js")).toBe("a\n");
      expect(read(dir, "src", "ignored.js")).toBe(formatted);
      expect(everythingIn(dir)).toEqual([".prettierignore", ".prettierrc", "src", "src/a.js", "src/ignored.js"]);
    });

    // Uses the IP address, because a file URL drops the host name `localhost`, in Node.js too, so Prettier can't import
    // from there either. Windows only, and never run so far: it's untested whether Bun can import
    // `file://127.0.0.1/C$/..`.
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

    // src/utilities/ignore.js uses `path.relative()`, which treats `c:\A` and `C:\a` as equal on Windows. An editor
    // passes `c:\..`, a shell `C:\..`. An ignored file must not be written.
    test.skipIf(!isWindows)(
      "a path whose drive and directories are in the opposite case still belongs to the project",
      async () => {
        using dir = tempDir("bun-format-platform", {
          ".prettierignore": "src/ignored.js\ngenerated/\n",
          "src/a.js": ugly,
          "src/ignored.js": ugly,
          "generated/b.js": ugly,
        });
        const other = swapCase(String(dir));
        // The other way around, and a path that doesn't exist yet.
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
    test.skipIf(!isWindows)("a path that starts at the drive's root", async () => {
      using dir = tempDir("bun-format-platform", {
        "a.js": ugly,
        "ignored.js": ugly,
        ".prettierignore": "ignored.js\n",
      });
      const rooted = realpathSync(String(dir)).slice(2);
      expect(await different(dir, [join(rooted, "a.js"), join(rooted, "ignored.js")])).toEqual(["a.js"]);
    });
  });

  describe.concurrent("names that refer to the same file", () => {
    test("formats a file passed in a different case if the file system finds it", async () => {
      using dir = tempDir("bun-format-platform", { "src/Button.js": ugly });
      const foldsCase = existsSync(join(String(dir), "SRC", "bUTTON.JS"));
      const { stdout, stderr, exitCode } = await format(dir, [join("src", "Button.js"), join("SRC", "bUTTON.JS")]);
      expect(stdout.split("\n")[0]).toBe("src/Button.js");
      expect(read(dir, "src", "Button.js")).toBe(formatted);
      expect(everythingIn(dir)).toEqual(["src", "src/Button.js"]);
      // stderr is included so that a failure shows the reason.
      expect({ stderr, exitCode }).toEqual({ stderr: expect.any(String), exitCode: foldsCase ? 0 : 2 });
    });

    // macOS finds `é` whether it's written as one character or as `e` plus a combining accent.
    test("formats a file passed in a different normalization form if the file system finds it", async () => {
      using dir = tempDir("bun-format-platform", { ["caf\u00e9.js"]: ugly });
      const decomposed = "cafe\u0301.js";
      const isFound = existsSync(join(String(dir), decomposed));
      const { exitCode } = await format(dir, [decomposed]);
      expect(read(dir, "caf\u00e9.js")).toBe(isFound ? formatted : ugly);
      expect(exitCode).toBe(isFound ? 0 : 2);
    });
  });

  describe.concurrent("line endings and byte order marks", () => {
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
          isUnchanged: names.map(name => read(dir, name) === files[name as "a.js"]),
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
        { changed: names, isUnchanged: all(false) },
        { changed: [], isUnchanged: all(true) },
        { changed: [], isUnchanged: all(true) },
        { changed: [], isUnchanged: all(true) },
      ]);
      using dir = tempDir("bun-format-platform", files);
      expect((await format(dir, ["--check", "a.js"])).exitCode).toBe(1);
      await format(dir, ["a.js"]);
      expect(read(dir, "a.js")).toBe(code);
    });

    test("keeps a byte order mark", async () => {
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
    ])("reads %s with \\r\\n: %j", async (name, text) => {
      const [before, after] =
        name === ".editorconfig" ? ["if (a) {\n  b;\n}\n", "if (a) {\n\tb;\n}\n"] : [formatted, "a\n"];
      using dir = tempDir("bun-format-platform", { [name]: crlf(text), "a.js": before });
      const { stderr } = await format(dir, ["a.js"]);
      expect(stderr).not.toMatch(anError);
      expect(read(dir, "a.js")).toBe(after);
    });
  });

  describe.concurrent("links", () => {
    // A junction doesn't need any privilege on Windows. Elsewhere the third argument is ignored, and it's a symlink to
    // a directory.
    const link = (target: string, path: string) => symlinkSync(target, path, "junction");

    test.each([
      ["Prettier", {}],
      ["oxfmt", { ".oxfmtrc.json": "{}\n" }],
    ])("doesn't follow a link to a directory, wherever it leads: like %s", async (_, config) => {
      using dir = tempDir("bun-format-platform", { ...config, "real/a.js": ugly, "pkg/deep/b.js": ugly });
      const at = (...names: string[]) => join(String(dir), ...names);
      link(at("real"), at("linked"));
      link(String(dir), at("pkg", "deep", "up"));
      link(at("nowhere"), at("broken"));
      expect(await different(dir, [])).toEqual(["pkg/deep/b.js", "real/a.js"]);
    });

    test("a link to a directory passed by name is an error, like in Prettier", async () => {
      using dir = tempDir("bun-format-platform", { "real/a.js": ugly });
      link(join(String(dir), "real"), join(String(dir), "linked"));
      const { stderr, exitCode } = await format(dir, ["-l", "linked"]);
      expect(stderr).toContain('error: Explicitly specified pattern "linked" is a symbolic link.');
      expect(exitCode).toBe(2);
    });

    test("from a working directory that's a link, writes the file in the link's target", async () => {
      using dir = tempDir("bun-format-platform", { "real/a.js": ugly });
      link(join(String(dir), "real"), join(String(dir), "linked"));
      const { exitCode } = await format(join(String(dir), "linked"), ["a.js"]);
      expect(read(dir, "real", "a.js")).toBe(formatted);
      expect(everythingIn(join(String(dir), "real"))).toEqual(["a.js"]);
      expect(exitCode).toBe(0);
    });
  });

  describe.concurrent("writing files", () => {
    test("leaves no temp files and doesn't rewrite a formatted file", async () => {
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

    // A file that's renamed over another one doesn't get its tags or its ACL. Prettier writes into the existing file.
    test.skipIf(attributes === undefined)("a file keeps its extended attributes", async () => {
      using dir = tempDir("bun-format-platform", { "tagged.js": ugly, "plain.js": ugly });
      const [tagged, plain] = ["tagged.js", "plain.js"].map(name => join(String(dir), name));
      expect(attributes!.set(tagged, "user.tag", "hello")).toBe(true);
      const before = [tagged, plain].map(path => statSync(path).ino);
      const { exitCode } = await format(dir, []);
      expect([read(tagged), read(plain)]).toEqual([formatted, formatted]);
      expect(attributes!.get(tagged, "user.tag")).toBe("hello");
      expect(statSync(tagged).ino).toBe(before[0]);
      // An attribute that the system gives every file, like an SELinux label, is no reason to write in place.
      if (isLinux) expect(statSync(plain).ino).not.toBe(before[1]);
      expect(everythingIn(dir)).toEqual(["plain.js", "tagged.js"]);
      expect(exitCode).toBe(0);
    });

    // Opened the way the C runtime's `fopen` does, and therefore Python and many editors: others may read and write the
    // file, but not rename or delete it. Prettier writes into it.
    test.skipIf(!isWindows)("writes a file that another program has open", async () => {
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
      // `INVALID_HANDLE_VALUE`: without the handle, the test would pass no matter what.
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
      ["exports an option that doesn't exist", `export default { semi: false, nonsense: 1 };`, true, 1],
      ["exports an invalid value for an option", `export default { semi: "perhaps" };`, true, 2],
      ["throws", `console.error("before"); throw new Error("boom");`, false, 2],
      ["exits with an error code and no output", `process.exit(3);`, false, 2],
    ])(
      "one that %s",
      async (_, config, isLoaded, exitCode) => {
        using dir = tempDir("bun-format-platform", {
          "node_modules/.keep": "",
          "prettier.config.mjs": config,
          "a.js": "a;\n",
        });
        const result = await format(dir, ["--check", "a.js"]);
        // Its output is only shown if it fails.
        expect(result.stdout + result.stderr).not.toMatch(/\bout\b|\berr\b/);
        if (!isLoaded) expect(result.stderr).toMatch(/prettier\.config\.mjs:\r?\n./);
        expect(everythingIn(dir)).toEqual(["a.js", "node_modules", "node_modules/.keep", "prettier.config.mjs"]);
        expect(result.exitCode).toBe(exitCode);
      },
      slow ? 240_000 : 30_000,
    );

    test(
      "is evaluated on every run: a package it imports is found as soon as it's installed",
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
        // Backdated, like a file that isn't being edited.
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

// A `[fmt]` key sets the default for the flag with the same name.
describe.concurrent("[fmt] in bunfig.toml", () => {
  /** Returns a run's results: its output with times normalized, its exit code and the files. */
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

  // Each row is a Prettier option, a non-default value, another value, and a file that the two values print
  // differently.
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

  test.each(options)("the %s key matches its flag", async (key, value, other, name, source) => {
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

  // Each row is a key, the equivalent flags, flags that override it, the files and the arguments.
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

  test.each(others)("%s matches its flags", async (line, flags, opposite, files, args) => {
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

  test("the threads key matches --threads, and 0 is rejected", async () => {
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

  test.each(["67108864", "9007199254740991"])("%s threads are capped at the maximum", async count => {
    const files = { "a.js": ugly, "b.js": ugly };
    const [byKey, byFlag, few] = await Promise.all([
      run({ ...files, "bunfig.toml": `[fmt]\nthreads = ${count}\n` }, ["a.js", "b.js"]),
      run(files, [`--threads=${count}`, "a.js", "b.js"]),
      run(files, ["--threads=1", "a.js", "b.js"]),
    ]);
    expect(byKey).toEqual(few);
    expect(byFlag).toEqual(few);
  });

  test("a list on the command line is appended to the file's list", async () => {
    const files = { "a.js": ugly, "b.js": ugly, "c.js": ugly, "bunfig.toml": `[fmt]\nignorePatterns = ["b.js"]\n` };
    expect(await different(files, ["--ignore-pattern=c.js", "."])).toEqual(["a.js"]);
  });

  test("with configPrecedence = prefer-file, the section only applies where there's no configuration file", async () => {
    const bunfig = `[fmt]\nconfigPrecedence = "prefer-file"\nsemi = false\n`;
    const [withoutConfig, withConfig] = await Promise.all([
      run({ "bunfig.toml": bunfig, "a.js": "a;\n" }, ["a.js"]),
      run({ "bunfig.toml": bunfig, ".prettierrc": "{}", "a.js": "a;\n" }, ["a.js"]),
    ]);
    expect([withoutConfig.files["a.js"], withConfig.files["a.js"]]).toEqual(["a\n", "a;\n"]);
  });

  test("reads the working directory's bunfig.toml, after --cwd is applied", async () => {
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

  // Flags that describe a single run.
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
    ["script = false", "--no-script"],
  ])("rejects %s and writes nothing", async (line, flag) => {
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
  ])("rejects %s: %s", async (line, message) => {
    const result = await run({ "bunfig.toml": `[fmt]\n${line}\n`, "a.js": ugly }, ["a.js"]);
    expect(result.stderr).toContain(message);
    expect(result.files["a.js"]).toBe(ugly);
    expect(result.exitCode).toBe(2);
  });

  test("a bunfig.toml that isn't valid TOML is an error", async () => {
    const result = await run({ "bunfig.toml": "[fmt\nsemi = false\n", "a.js": ugly }, ["a.js"]);
    expect(result.files["a.js"]).toBe(ugly);
    expect(result.exitCode).toBe(2);
  });

  test("fmt that isn't a table is an error", async () => {
    const result = await run({ "bunfig.toml": `fmt = "prettier"\n`, "a.js": ugly }, ["a.js"]);
    expect(result.stderr).toContain("expected object but received string");
    expect(result.exitCode).toBe(2);
  });

  test("every flag in --help is a key, or is rejected as a key with a message that names the flag", async () => {
    const help = await format({}, ["--help", "--all"]);
    const flags = [...help.stdout.matchAll(/^\s+(?:-\w, )?--([a-z-]+)/gm)].map(it => it[1]);
    expect(flags.length).toBeGreaterThan(60);
    const answers = await Promise.all(
      flags.map(async flag => {
        const positive = flag.replace(/^no-/, "");
        const key =
          positive === "ignore-pattern" ? "ignorePatterns" : positive.replace(/-(\w)/g, (_, it) => it.toUpperCase());
        // A value of a type that no key accepts, so an existing key reports what it expects.
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
