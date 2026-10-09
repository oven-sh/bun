import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { chmodSync, chownSync, existsSync, linkSync, readdirSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";

const command = [bunExe(), "format"];

const env = { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: undefined };

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
  await using proc = Bun.spawn({
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

/** The files that are not formatted, according to `-l`. */
async function different(files: Record<string, string>, args: string[], options?: Options) {
  const { stdout } = await format(files, ["-l", ...args], options);
  return stdout.split("\n").filter(Boolean);
}

describe.concurrent("bun format", () => {
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

  test("does not touch a file that is formatted", async () => {
    let before = 0;
    using dir = tempDir("bun-format", { "a.js": formatted });
    before = statSync(join(String(dir), "a.js")).mtimeMs;
    await using proc = Bun.spawn({ cmd: [...command, "a.js"], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
    expect(await proc.exited).toBe(0);
    expect(statSync(join(String(dir), "a.js")).mtimeMs).toBe(before);
  });

  // Prettier and oxfmt write into the file (`fs.writeFile`, `fs::write`): all but its text stays as it is.
  describe("the file that is written", () => {
    const isRoot = process.getuid?.() === 0;
    /** `bun format` in `dir`, which is still there afterwards. `before`: what starts the command. */
    async function write(dir: string, args: string[], before: string[] = []) {
      await using proc = Bun.spawn({
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
          '[error] Unable to write file "c/d.js":\n[error] A link leads out of the repository.',
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
      chownSync(join(String(dir), "a.js"), 12345, 12345);
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
        expect(stderr).not.toContain("[error]");
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
        expect(stderr).toMatch(/\[error\] Unable to write file "a\.js":\r?\n(\[error\] )?(EACCES|EPERM)/);
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
    expect(result.stderr).toStartWith('[error] No files matching the pattern were found: "a/a/');
    expect(result.files).toEqual({ "a.js": formatted });
    expect(result.exitCode).toBe(2);
  });

  test("--check writes nothing and exits with 1", async () => {
    const result = await format({ "a.js": ugly, "b.js": formatted, "c.js": ugly }, ["--check"], { reads: ["a.js"] });
    expect(result.files).toEqual({ "a.js": ugly });
    expect(result.stdout).toMatchInlineSnapshot(`"Checking formatting..."`);
    expect(result.stderr).toMatchInlineSnapshot(`
      "[warn] a.js
      [warn] c.js
      [warn] Code style issues found in 2 files. Run bun format to fix."
    `);
    expect(result.exitCode).toBe(1);
  });

  test("--check exits with 0 if everything is formatted", async () => {
    const result = await format({ "a.js": formatted }, ["--check"]);
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
    expect(result.stderr).toContain("[error] a.js: SyntaxError:");
    expect(result.stderr).toContain("(1:7)");
    expect(result.exitCode).toBe(2);
  });

  test("a syntax error says what is wrong and where, in every language", async () => {
    // One for each language and kind of refusal: the file, and what is said about it.
    const cases: [string, string, string][] = [
      ["string.css", 'a {\n  b: "x\n}\n', "This string is not closed (2:6)"],
      ["block.css", "a {\n  b: c;\n", "This block is not closed (1:1)"],
      ["brace.css", "a {\n}\n}\n", 'Unexpected "}" (3:1)'],
      ["comment.css", "a {\n  /* b\n}\n", "This comment is not closed (2:3)"],
      ["bracket.css", "a {\n  b: c(1;\n}\n", "This bracket is not closed (2:7)"],
      ["url.css", "a {\n  b: url(c;\n}\n", "This bracket is not closed (2:9)"],
      ["word.css", "a {\n  b c;\n}\n", "This is neither a declaration nor a rule (2:3)"],
      ["at.css", "@ a;\n", 'Expected a name after "@" (1:1)'],
      ["colon.css", "a {\n  b: c: d;\n}\n", 'Unexpected ":" (2:7)'],
      ["first-colon.css", "a {\n  : b;\n  c: d:\n}\n", 'Unexpected ":" (3:7)'],
      ["no-name.css", "a {\n  (): ;\n}\n", "Expected the name of a property (2:3)"],
      ["two-words.css", "a {\n  b c: d;\n}\n", 'Expected ":" (2:5)'],
      ["selector.css", "{\n  a: b;\n}\n", "Expected a selector (1:1)"],
      ["custom-selector.css", "@custom-selector a;\n", "The parameters of this at-rule cannot be read (1:1)"],
      ["value.css", "a {\n  b: c);\n}\n", "This value cannot be read (2:6)"],
      ["deep.css", "a{".repeat(300) + "\n", "It is nested too deeply (1:513)"],
      ["interpolation.scss", "a {\n  b: #{$c;\n", "This interpolation is not closed (2:6)"],
      ["string.scss", 'a {\n  b: "x;\n}\n', "This string is not closed (2:6)"],
      ["nested.scss", "a {\n  b: c: {\n    d: e;\n  }\n}\n", 'Unexpected ":" (2:7)'],
      ["mixin.less", "a {\n  .b(;\n}\n", "This bracket is not closed (2:5)"],
      ["each.less", "each(@a, {\n", "This bracket is not closed (1:5)"],
      ["word.less", "a {\n  b c;\n}\n", "This is neither a declaration nor a rule (2:3)"],
      ["end.graphql", "query {\n  a\n", "Unexpected end of file (3:1)"],
      ["name.graphql", "query {\n}\n", "Expected a name (2:1)"],
      ["value.graphql", "query { a(b: ) }\n", "Expected a value (1:14)"],
      ["string.graphql", 'query { a(b: "x) }\n', "This string is not closed (1:14)"],
      ["block-string.graphql", '"""\na\n', "This string is not closed (1:1)"],
      ["escape.graphql", 'query { a(b: "\\x") }\n', "Invalid escape sequence (1:15)"],
      ["definition.graphql", "foo A { b }\n", "Expected a definition (1:1)"],
      ["colon.graphql", "query ($a) { b }\n", 'Expected ":" (1:10)'],
      ["character.graphql", "query { a ? }\n", "Unexpected character (1:11)"],
      ["number.graphql", "query { a(b: 01) }\n", "Invalid number (1:14)"],
      ["digit.graphql", "query { a(b: 1.) }\n", "Expected a digit (1:16)"],
      ["extension.graphql", "extend type A\n", "This extension adds nothing (1:14)"],
      ["location.graphql", "directive @a on B\n", "Expected a place where a directive can be (1:17)"],
      ["brace.graphql", "fragment A on B\n@c d\n", 'Expected "{" (2:4)'],
      ["parenthesis.graphql", "query { a(b: 1 }\n", "Expected a name (1:16)"],
      ["bracket.graphql", "type A { b: [C }\n", 'Expected "]" (1:16)'],
      ["closing-brace.graphql", "schema { query: A ]\n", "Expected a name (1:19)"],
      ["block.hbs", "<div>\n  {{#if a}}\n</div>\n", "This block is not closed (2:3)"],
      ["mustache.hbs", "<div>\n  {{a\n</div>\n", "Unexpected character (3:1)"],
      ["end.hbs", "{{a", "Unexpected end of file (1:4)"],
      ["end-tag.hbs", "<div>\n<p>\n</div>\n", "This end tag does not close the element that is open (3:1)"],
      ["name.hbs", "{{#if a}}b{{/each}}\n", "This is not the name of the block that is open (1:11)"],
      ["no-start.hbs", "</div>\n", "This end tag has no start tag (1:1)"],
      ["hash.hbs", "{{a b=}}\n", "Unexpected token (1:6)"],
      ["in-tag.hbs", "<div {{#if a}}b{{/if}}></div>\n", "A block can only be in an element or in another block (1:6)"],
      ["partial.hbs", "{{> a}}\n", "Partials, decorators and raw blocks are not supported (1:1)"],
      ["void.hbs", "<input></input>\n", "This element has no end tag (1:8)"],
      ["element.hbs", "{{#if a}}<div>{{/if}}\n", "This element is not closed (1:10)"],
      ["comment.hbs", "{{!-- a\n", "This comment is not closed (1:1)"],
      ["short-comment.hbs", "{{! a\n", "This comment is not closed (1:1)"],
      ["string.hbs", '{{a "b}}\n', "This string is not closed (1:5)"],
      ["segment.hbs", "{{a [b}}\n", "This bracket is not closed (1:5)"],
      ["path.hbs", "{{a/../b}}\n", '"..", "." and "this" can only be at the start of a path (1:8)'],
      ["params.hbs", "{{#each a as ||}}{{/each}}\n", "Expected a name (1:15)"],
      ["tag-params.hbs", "<A as |b>\n</A>\n", "These block parameters cannot be read (1:9)"],
      ["attribute.hbs", '<div></div a="b">\n', "An end tag cannot have attributes (1:12)"],
      ["self-closing.hbs", "<div></div/>\n", "An end tag cannot close itself (1:6)"],
      ["unquoted.hbs", "<div a=b{{c}}></div>\n", "A value with a mustache and text in it needs quotes (1:8)"],
      ["tag-name.hbs", "<{{a}}></a>\n", "A mustache cannot be here (1:2)"],
      ["equals.hbs", "<div =a></div>\n", "Unexpected character (1:6)"],
      ["sexpr.hbs", "{{a (b}}\n", 'Expected ")" (1:7)'],
      ["doctype.hbs", "<!DOCTYPE a PUBLIC b>\n", "This doctype cannot be read (1:20)"],
      ["close.hbs", "{{a b=c d}}\n", 'Expected "}}" (1:9)'],
      ["mustache-comment.hbs", "<div a={{! b }}></div>\n", "A comment cannot be here (1:8)"],
      ["raw.hbs", "{{{{a}}}} b\n", "This block is not closed (1:10)"],
      ["colon.hbs", "<:></:>\n", "This is not the name of an element (1:1)"],
      ["mapping.yaml", "a: b: c\n", "A mapping cannot start on the line of the key that it is the value of (1:4)"],
      ["flow.yaml", "a: [1, 2\nb: 3\n", "This bracket is not closed (1:4)"],
      ["string.yaml", 'a: "x\n', "This string is not closed (1:4)"],
      ["single.yaml", "a: 'x\n", "This string is not closed (1:4)"],
      ["tab.yaml", "\ta: 1\n", "A tab cannot be indentation (1:1)"],
      ["anchors.yaml", "a: &x &y 1\n", "A node has one anchor and one tag at most (1:7)"],
      ["token.yaml", "- a\nb: 1\n", "Unexpected token (2:2)"],
      ["directive.yaml", "%YAML 1.2\na: 1\n", 'Expected "---" after the directives (2:1)'],
      ["directive-end.yaml", "%YAML 1.2\n", 'Expected "---" after the directives (2:1)'],
      ["bad-directive.yaml", "%YAML a b\n---\n", "This directive cannot be read (1:1)"],
      ["header.yaml", "a: |x\n  b\n", 'This is not what can follow "|" or ">" (1:4)'],
      ["tag.yaml", "a: !b!c d\n", "This tag cannot be resolved (1:4)"],
      ["alias.yaml", "a: &b *c\n", "An alias has a name, and neither an anchor nor a tag (1:7)"],
      ["anchor.yaml", "a: & b\n", 'Expected a name after "&" (1:4)'],
      ["plain.yaml", "a: @b\n", "A plain scalar cannot start with this character (1:4)"],
      ["escape.yaml", 'a: "\\q"\n', "This string has an invalid escape sequence or indentation (1:4)"],
      ["comma.yaml", "a: [b c: d e]\n[a b]\n", 'Expected ":" (2:6)'],
      ["missing-comma.yaml", "[a: b c: d]\n", "A block collection or scalar cannot be between brackets (1:5)"],
      ["comment.yaml", 'a: "b"#c\n', "Expected white space (1:7)"],
      ["key.yaml", "[a\nb: c]\n", 'A key without "?" has to be on one line (1:2)'],
      ["colon.yaml", "a: 1\nb\n", 'Expected ":" (2:2)'],
      ["indent.yaml", "a:\n  - b\n - c\n", "This is not indented as it has to be (3:2)"],
      ["block-in-flow.yaml", "[a: |\n  b\n]\n", "A plain scalar cannot start with this character (1:5)"],
      ["seq-prop.yaml", "a: &b - c\n", "Unexpected token (1:7)"],
      ["doc-start.yaml", "--- a: b\n", "Expected a line break (1:5)"],
      ["binary.yaml", 'a: !!binary "?"\n', "The value is not what its tag says (1:13)"],
      ["indicator.yaml", "&a ? b\n: c\n", "This has to come before the anchor and the tag, and once (1:4)"],
      ["long-key.yaml", "a".repeat(1030) + ": b\n", 'A key without "?" cannot be longer than 1024 characters (1:1)'],
      ["scalar-indent.yaml", "a: |2\n b\n", "This is not indented as it has to be (2:2)"],
      ["no-comma.yaml", "[: ? 1]\n", 'Expected "," (1:6)'],
      ["comma-or-colon.yaml", '["a" "b"]\n', 'Expected "," or ":" (1:6)'],
      ["set.yaml", "{!!set}\n", "This cannot be formatted (1:1)"],
      ["token.json", '{"a": }\n', "Unexpected token (1:7)"],
      ["end.json", '{"a": 1\n', "Unexpected end of file (2:1)"],
      ["string.json", '{"a": "x\n}\n', "This string is not closed (1:7)"],
      ["escape.json", '{"a": "\\x"}\n', "Invalid escape sequence (1:7)"],
      ["comment.json", '{"a": 1} /* b\n', "This comment is not closed (1:10)"],
      ["more.json", '{"a": 1} 2\n', "Expected the end of the file (1:10)"],
      ["only-comments.json", "// a\n", "Unexpected end of file (2:1)"],
    ];
    const result = await format(Object.fromEntries(cases.map(([name, text]) => [name, text])), []);
    const said = [...result.stderr.matchAll(/^\[error\] ([^:\n]+): SyntaxError: (.+)$/gm)].map(it => [it[1], it[2]]);
    expect(Object.fromEntries(said)).toEqual(Object.fromEntries(cases.map(([name, , message]) => [name, message])));
    expect(result.exitCode).toBe(2);
  });

  test("under a syntax error are the lines around it, as Prettier shows them", async () => {
    const files = {
      // A byte order mark does not count, `\r\n` is one line break, and a column is a UTF-16 code unit.
      "a.css": '\uFEFFa {\r\n  /* é😀 */ b: "x\r\n}\r\n',
      "b.css": 'a {\n  b: c;\n}\n\n\nd {\n  e: "f\n}\n\ng {\n  h: i;\n}\nj {\n}\n',
      "c.js": "const a = ;\n",
      "d.yaml": "a:\n\t- b\n",
      // Not lines that nobody has written, which fill the screen.
      "e.css": `a{b:${"c ".repeat(600)}"}\n`,
    };
    const result = await format(files, []);
    expect(result.stderr).toMatchInlineSnapshot(`
      "[error] a.css: SyntaxError: This string is not closed (2:16)
      [error]   1 | a {
      [error] > 2 |   /* é😀 */ b: "x
      [error]     |                ^
      [error]   3 | }
      [error]   4 |
      [error] b.css: SyntaxError: This string is not closed (7:6)
      [error]    5 |
      [error]    6 | d {
      [error] >  7 |   e: "f
      [error]      |      ^
      [error]    8 | }
      [error]    9 |
      [error]   10 | g {
      [error] c.js: SyntaxError: Expression expected. (1:11)
      [error] > 1 | const a = ;
      [error]     |           ^
      [error]   2 |
      [error] d.yaml: SyntaxError: A tab cannot be indentation (2:1)
      [error]   1 | a:
      [error] > 2 | 	- b
      [error]     | ^
      [error]   3 |
      [error] e.css: SyntaxError: This string is not closed (1:1205)
      Formatted 0 files, 0 unchanged"
    `);
    expect(result.exitCode).toBe(2);
    const stdin = await format({}, ["--stdin-filepath", "a.css"], { stdin: "a {\n" });
    expect(stdin.stderr).toMatchInlineSnapshot(`
      "[error] a.css: SyntaxError: This block is not closed (1:1)
      [error] > 1 | a {
      [error]     | ^
      [error]   2 |"
    `);
    expect(stdin.exitCode).toBe(2);
  });

  test("a syntax error in TOML is in the words of Bun's parser, and a warning: oxfmt passes over such a file", async () => {
    const files = { "a.toml": 'a = 1\nb = "c\n', ".oxfmtrc.json": "{}\n" };
    const warning = [
      "[warn] a.toml: SyntaxError: Unterminated string; newlines must be escaped in basic strings (2:5)",
      "[warn]   1 | a = 1",
      '[warn] > 2 | b = "c',
      "[warn]     |     ^",
      "[warn]   3 |",
    ].join("\n");
    for (const flags of [[], ["--check"], ["-l"]]) {
      const result = await format(files, flags, { reads: ["a.toml"] });
      expect(result.stderr).toContain(warning);
      expect(result.files["a.toml"]).toBe(files["a.toml"]);
      expect(result.exitCode).toBe(0);
    }
  });

  test("a file is left as it is if what would be written is another program", async () => {
    // Like Prettier 3.9.9, the formatter writes no `;` before the `(` here, which makes `c(..)` of the two statements.
    const text = "a ? b : c;\n(d ? e : f) ? g : h;\n";
    const result = await format({ "a.js": text, "b.js": ugly }, ["--no-semi", "--experimental-ternaries"], {
      reads: ["a.js"],
    });
    expect(result.files).toEqual({ "a.js": text });
    expect(result.stderr).toContain("[error] a.js: formatting would change what the code means.");
    expect(result.exitCode).toBe(2);
  });

  test("Handlebars", async () => {
    const result = await format({ "a.hbs": '<div   class="a  b">{{foo   bar}}</div>\n', "b.handlebars": "{{a}}" }, [], {
      reads: ["a.hbs", "b.handlebars"],
    });
    expect(result.files).toEqual({ "a.hbs": '<div class="a b">{{foo bar}}</div>', "b.handlebars": "{{a}}" });
    expect(result.stdout).toBe("a.hbs");
    expect(result.exitCode).toBe(0);
  });

  describe("a template that Prettier damages is left as it is", () => {
    // What Prettier 3.9.9 prints for each of these says something else, or cannot be parsed any more.
    const damaged = {
      "doctype": "<!DOCTYPE html>\n<p   ></p>\n",
      "character-behind-less-than": "a <3 b   ></b>\n",
      "start-of-a-comment": "<!---a--><p   ></p>\n",
      "mustache-where-a-comment-starts": "<!--{{a}}--><p   ></p>\n",
      "open-tag-at-the-end": "<p   ></p><a",
      "escaped-mustache-in-a-comment": "<!-- \\{{a}} --><p   ></p>\n",
      "escaped-mustache-in-a-name": "<a   \\{{b}}></a>\n",
      "escaped-mustache-in-pre": "<pre   >\\{{a}}</pre>\n",
      "escaped-mustache-in-style": '<style   >a{b:"\\{{c}}"}</style>\n',
      "white-space-next-to-a-mustache-in-style": "<style   >a{margin: 0 {{b}} 0}</style>\n",
      "no-break-space-that-is-all-of-a-block": "{{#a   }}\u00a0{{/a}}\n",
      "no-break-space-that-is-all-of-a-component": "<A   >\u00a0</A>\n",
      "no-break-space-in-a-class": '<a   class="b\u00a0c"></a>\n',
      "escaped-mustache-that-is-ignored": "{{! prettier-ignore }}a\\{{b}}<p   ></p>\n",
      "backslash-before-a-mustache-in-a-value": '<a   b="c\\\\{{d}}"></a>\n',
      "backslash-before-a-comment": "a\\\\{{!   b }}\n",
      "backslash-before-the-end-of-a-block": "{{#a   }}b\\\\{{/a}}\n",
      "both-quotes-in-a-value": `<a   b=c"d'e></a>\n`,
      "lines-of-a-script": "<script   >\n  // a\n  b()\n</script>\n",
      "lines-of-a-textarea": "<textarea   >\n  a\n    b\n</textarea>\n",
      "white-space-further-down-in-pre": "<pre   ><b>a\n  b</b></pre>\n",
      "children-of-what-counts-as-void": "<imG   >a</imG>\n",
      "this-and-a-slash": "{{this/a   }}\n",
      "this-behind-an-at": "{{@this.a   }}\n",
      "this-in-brackets": "{{[this]   }}\n",
      "empty-brackets": "{{[].a   }}\n",
      "arguments-of-a-literal": '{{"a"   b}}\n',
      "hash-that-is-called": "{{(a=b)   c}}\n",
      "raw-block": "{{{{a}}}}   {{b}} {{{{/a}}}}\n",
      "inverted-block": "{{^a   }}b{{else}}c{{/a}}\n",
      "key-in-brackets": "{{a   [b c]=d}}\n",
      "literal-in-brackets": "{{a   [true]}}\n",
      "number-in-brackets": "{{a   [-1]}}\n",
      "else-in-brackets": "{{[else]   }}\n",
      "argument-in-brackets": "{{a   [@b]}}\n",
      "bracket-in-brackets": "{{a   [b\\]]}}\n",
      "line-break-in-brackets": "{{a   [b\nc]}}\n",
      "block-parameter-in-brackets": "{{#a   as |[b] c|}}{{/a}}\n",
      "private-name": "{{a.#b   }}\n",
      "number-with-an-exponent": "{{a   1000000000000000000000}}\n",
      "backslash-at-the-end-of-a-string": '{{a   "b\\"}}\n',
      "tilde-in-three-braces": "{{{a   }~}}\n",
      "three-braces-around-a-modifier": "<a   {{{b}}}></a>\n",
      "tilde-at-the-end-of-a-comment": "{{!--   a ~--}}\n",
      "dashes-at-the-start-of-a-comment": "{{!----   a --}}\n",
      "rest-of-the-name-behind-else": "{{#a   }}{{else if.b c}}{{/a}}\n",
      "tilde-of-an-if-that-is-all-that-follows-else": "{{#a   }}{{else}}{{~#if b}}c{{/if}}{{/a}}\n",
      "line-separator-behind-a-line-break": "a\n\u2028{{b   }}\n",
      "indented-mark-of-a-document-in-front-matter": "---\n ---\na: b\n---\n<p   ></p>\n",
    };
    const files = Object.fromEntries(Object.entries(damaged).map(([name, text]) => [`${name}.hbs`, text]));
    const errors = Object.keys(files)
      .map(
        name => `[error] ${name}: formatting it the way Prettier does would change what it means. It is left as it is.`,
      )
      .sort();
    const errorsIn = (stderr: string) =>
      stderr
        .split("\n")
        .filter(line => line.startsWith("[error] "))
        .sort();

    test.each([[[] as string[]], [["--check"]], [["-l"]]])("%j", async args => {
      const result = await format({ ...files, "fine.hbs": "{{a   }}" }, args, {
        reads: [...Object.keys(files), "fine.hbs"],
      });
      expect(result.files).toEqual({ ...files, "fine.hbs": args.length > 0 ? "{{a   }}" : "{{a}}" });
      expect(errorsIn(result.stderr)).toEqual(errors);
      expect(result.exitCode).toBe(2);
    });

    test("standard input", async () => {
      const result = await format({}, ["--stdin-filepath", "a.hbs"], { stdin: damaged.doctype });
      expect(result.raw).toBe("");
      expect(errorsIn(result.stderr)).toEqual([
        "[error] a.hbs: formatting it the way Prettier does would change what it means. It is left as it is.",
      ]);
      expect(result.exitCode).toBe(2);
    });

    test("in Markdown, only the block of code is", async () => {
      const text = "#   a\n\n```hbs\n<!DOCTYPE html>\n<p   ></p>\n```\n\n```hbs\n<p   ></p>\n```\n";
      const result = await format({ "a.md": text }, [], { reads: ["a.md"] });
      expect(result.files).toEqual({
        "a.md": "# a\n\n```hbs\n<!DOCTYPE html>\n<p   ></p>\n```\n\n```hbs\n<p></p>\n```\n",
      });
      expect(result.exitCode).toBe(0);
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
    expect(result.stderr).toContain("[error] a.html: SyntaxError:");
    expect(result.exitCode).toBe(2);
  });

  describe("HTML of which something would be lost is left as it is", () => {
    // Prettier 3.9.9 writes a media query in lower case, which makes a `k` of the Kelvin sign.
    const lossy = "<style>@media (\u212Aa){a{b:c}}</style>\n";
    const error = (name: string) =>
      `[error] ${name}: formatting it the way Prettier does would change what is in it. It is left as it is.`;

    test.each([[[] as string[]], [["--check"]], [["-l"]]])("%j", async args => {
      const result = await format({ "a.html": lossy, "b.html": "<p   >a</p>\n" }, args, {
        reads: ["a.html", "b.html"],
      });
      expect(result.files).toEqual({ "a.html": lossy, "b.html": args.length > 0 ? "<p   >a</p>\n" : "<p>a</p>\n" });
      expect(result.stderr.split("\n").filter(line => line.startsWith("[error] "))).toEqual([error("a.html")]);
      expect(result.exitCode).toBe(2);
    });

    test("standard input", async () => {
      const result = await format({}, ["--stdin-filepath", "a.html"], { stdin: lossy });
      expect(result.raw).toBe("");
      expect(result.stderr.split("\n").filter(line => line.startsWith("[error] "))).toEqual([error("a.html")]);
      expect(result.exitCode).toBe(2);
    });

    test("in a template and in a block of code, only that is", async () => {
      const files = {
        "a.js": "const a = html`" + lossy.trim() + "`;\nconst   b = html`<p   >c</p>`;\n",
        "b.md": "#   a\n\n```html\n" + lossy + "```\n\n```html\n<p   >c</p>\n```\n",
      };
      const result = await format(files, [], { reads: ["a.js", "b.md"] });
      expect(result.files).toEqual({
        "a.js": "const a = html`" + lossy.trim() + "`;\nconst b = html`<p>c</p>`;\n",
        "b.md": "# a\n\n```html\n" + lossy + "```\n\n```html\n<p>c</p>\n```\n",
      });
      expect(result.exitCode).toBe(0);
    });

    test("--no-verify", async () => {
      const result = await format({ "a.html": lossy }, ["--no-verify"], { reads: ["a.html"] });
      expect(result.files).toEqual({
        "a.html": "<style>\n  @media (ka) {\n    a {\n      b: c;\n    }\n  }\n</style>\n",
      });
      expect(result.exitCode).toBe(0);
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

  test("a file is left as it is if a template would get an expression twice", async () => {
    // Like Prettier 3.9.9, the formatter closes the element: html`<${b}>c</${b}>`.
    const text = "const a = html`<${b}>c`;\n";
    const result = await format({ "a.js": text }, [], { reads: ["a.js"] });
    expect(result.files).toEqual({ "a.js": text });
    expect(result.stderr).toContain("[error] a.js: formatting would change what the code means.");
    expect(result.exitCode).toBe(2);
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
    const left = { "a.svelte": "<p   >a</p>\n", "b.svelte": "<p   >b</p>\n" };
    const files = { ".prettierrc": '{ "plugins": ["prettier-plugin-svelte"] }\n', ...left, "c.js": ugly };
    const reads = [...Object.keys(left), "c.js"];
    const text = "2 files are in a language that bun format does not support yet, and left as they are: 2 .svelte";
    const result = await format(files, [], { reads });
    expect(result.files).toEqual({ ...left, "c.js": formatted });
    expect(result.stderr.trimEnd().split("\n").at(-1)).toBe(
      `[error] ${text}. With --allow-unsupported this is a warning.`,
    );
    expect(result.exitCode).toBe(2);
    const checked = await format({ ...files, "c.js": formatted }, ["--check"], { reads });
    expect(checked.stderr).toContain(`[error] ${text}`);
    expect(checked.exitCode).toBe(2);
    const allowed = await format(files, ["--allow-unsupported"], { reads });
    expect(allowed.files).toEqual({ ...left, "c.js": formatted });
    expect(allowed.stderr.split("\n")).toContain(`[warn] ${text}`);
    expect(allowed.exitCode).toBe(0);
  });

  describe("a language that only a plugin of Prettier reads", () => {
    // Stand-ins. This Prettier takes blanks away, and writes down what it is called with.
    const packages = {
      "node_modules/prettier/package.json": '{ "name": "prettier", "version": "3.0.0", "main": "index.cjs" }',
      "node_modules/prettier/index.cjs": `const fs = require("node:fs");
exports.resolveConfig = async (file, { config }) => (config ? JSON.parse(fs.readFileSync(config, "utf8")) : null);
exports.format = async (text, options) => {
  fs.appendFileSync(__dirname + "/calls.txt", JSON.stringify(options) + "\\n");
  if (text.includes("broken")) throw Object.assign(new SyntaxError("Unexpected token (1:2)"), { loc: {} });
  return text.replace(/ +/g, " ");
};
`,
      "node_modules/prettier-plugin-svelte/package.json": '{ "name": "prettier-plugin-svelte", "version": "4.0.0" }',
    };
    const config = { plugins: ["prettier-plugin-svelte"], svelteSortOrder: "none", semi: false };
    const files = {
      ...packages,
      ".prettierrc": '{\n  "plugins": ["prettier-plugin-svelte"],\n  "svelteSortOrder": "none",\n  "semi": false\n}\n',
      "a.svelte": "<p   >a</p>\n",
      "b.js": "b  ;\n",
    };
    const reads = ["a.svelte", "b.js", "node_modules/prettier/calls.txt"];

    test("goes to the project's own Prettier, with its configuration file and the flags", async () => {
      const result = await format(files, ["--tab-width", "8"], { reads });
      expect(result.files["a.svelte"]).toBe("<p >a</p>\n");
      expect(result.files["b.js"]).toBe("b\n");
      const calls = result.files[reads[2]]!.trim().split("\n");
      expect(calls.map(it => JSON.parse(it))).toEqual([
        { ...config, tabWidth: 8, filepath: expect.stringMatching(/[\\/]a\.svelte$/) },
      ]);
      expect(result.stderr).toContain("1 file was handed to the Prettier of the project");
      expect(result.exitCode).toBe(0);
    });

    test("is checked, and listed", async () => {
      const checked = await format(files, ["--check"], { reads });
      expect(checked.files["a.svelte"]).toBe(files["a.svelte"]);
      expect(checked.stderr).toContain("[warn] a.svelte");
      expect(checked.exitCode).toBe(1);
      expect(await different(files, [])).toEqual(["a.svelte", "b.js"]);
      const fine = await format({ ...files, "a.svelte": "<p>a</p>\n", "b.js": "b\n" }, ["--check"]);
      expect(fine.stdout).toContain("All matched files use Prettier code style!");
      expect(fine.exitCode).toBe(0);
    });

    test("from standard input", async () => {
      const result = await format(files, ["--stdin-filepath", "c.svelte"], { stdin: "<p   >c</p>\n" });
      expect(result).toMatchObject({ raw: "<p >c</p>\n", stderr: "", exitCode: 0 });
      const checked = await format(files, ["--stdin-filepath", "c.svelte", "--check"], { stdin: "<p   >c</p>\n" });
      expect(checked).toMatchObject({ raw: "(stdin)\n", exitCode: 1 });
    });

    test("what Prettier throws is shown as it shows it", async () => {
      const result = await format({ ...files, "a.svelte": "broken\n" }, [], { reads });
      expect(result.files["a.svelte"]).toBe("broken\n");
      expect(result.stderr).toContain("[error] a.svelte: SyntaxError: Unexpected token (1:2)");
      expect(result.exitCode).toBe(2);
    });

    test("is left as it is if the plugin is not installed, and what would help is said", async () => {
      const { "node_modules/prettier-plugin-svelte/package.json": _, ...rest } = files;
      const result = await format(rest, [], { reads });
      expect(result.files["a.svelte"]).toBe(files["a.svelte"]);
      expect(result.stderr).toContain(
        "[warn] Not installed: prettier-plugin-svelte. With all plugins of the configuration and prettier installed, bun format hands the files of their languages to them.",
      );
      expect(result.stderr).toContain("and left as they are: 1 .svelte.");
      expect(result.exitCode).toBe(2);
    });
  });

  test("with an .oxfmtrc.json TOML is formatted, and Svelte, which bun format cannot format, is named if the configuration has svelte", async () => {
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
    expect(result.files).toEqual(after);
    expect(result.stderr).toContain(
      "[error] 1 file is in a language that bun format does not support yet, and left as they are: 1 .svelte",
    );
    expect(result.exitCode).toBe(2);
    const without = await format({ ...files, ".oxfmtrc.json": "{}\n" }, [], { reads });
    expect(without.files).toEqual(after);
    expect(without.stderr).not.toContain("does not support yet");
    expect(without.exitCode).toBe(0);
    // Prettier has no TOML.
    expect(await different(files, [])).toEqual(["c.js"]);
    const broken = await format({ "b.toml": "a = = 1\n", ".oxfmtrc.json": "{}\n" }, [], { reads: ["b.toml"] });
    expect(broken.files["b.toml"]).toBe("a = = 1\n");
    expect(broken.stderr).toMatch(/b\.toml: SyntaxError: .+ \(1:\d+\)/);
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
    ['{ "printWidth": "80" }', 'Invalid printWidth value: "80".'],
    ['{ "endOfLine": null }', "Invalid endOfLine value: null."],
    ['{ "plugins": "x" }', '"plugins" is not an array.'],
    ['{ "overrides": 1 }', '"overrides" is not an array of objects with "files"'],
    ['{ "overrides": [{ "options": {} }] }', '"overrides" is not an array of objects with "files"'],
    ['{ "overrides": [{ "files": 1 }] }', '"overrides" is not an array of objects with "files"'],
  ])("a .prettierrc that Prettier cannot use is an error: %s", async (config, message) => {
    const result = await format({ ".prettierrc": config, "a.js": ugly }, ["a.js"], { reads: ["a.js"] });
    expect(result.files["a.js"]).toBe(ugly);
    expect(result.stderr).toContain(message);
    expect(result.exitCode).toBe(2);
  });

  test("an option that Prettier does not know is ignored with its warning, unless a plugin may know it", async () => {
    const unknown = '"nonsense": 1, "other": [1, "a"], "tailwindConfig": "x", "$schema": "y"';
    const result = await format({ ".prettierrc": `{ ${unknown} }`, "a.js": ugly }, ["a.js"], { reads: ["a.js"] });
    expect(result.files["a.js"]).toBe(formatted);
    expect(result.stderr).toContain("[warn] Ignored unknown option { nonsense: 1 }.");
    expect(result.stderr).toContain('[warn] Ignored unknown option { other: [1, "a"] }.');
    expect(result.stderr).toContain('[warn] Ignored unknown option { tailwindConfig: "x" }.');
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
      ".prettierrc": '{ "plugins": ["prettier-plugin-brace-style", "prettier-plugin-svelte", "./own.js"] }\n',
      "a.js": ugly,
      "b.svelte": "<p   >b</p>\n",
      "other/.prettierrc": "{}\n",
      "other/c.js": ugly,
    };
    const reads = ["a.js", "b.svelte", "other/c.js"];
    // The other file is the .prettierrc itself.
    const result = await format(files, [], { reads });
    expect(result.files).toEqual({ "a.js": ugly, "b.svelte": files["b.svelte"], "other/c.js": formatted });
    expect(result.stderr).toContain(
      "[error] 2 files are left as they are: the configuration names plugins that bun format does not have, and that may print them in another way: prettier-plugin-brace-style, ./own.js. With --allow-unsupported they are formatted without.",
    );
    expect(result.stderr).toContain("[error] 1 file is in a language that bun format does not support yet");
    expect(result.exitCode).toBe(2);
    const allowed = await format(files, ["--allow-unsupported"], { reads });
    expect(allowed.files).toEqual({ "a.js": formatted, "b.svelte": files["b.svelte"], "other/c.js": formatted });
    expect(allowed.stderr).toContain("[warn] Plugins are not supported");
    expect(allowed.exitCode).toBe(0);
    const flag = await format({ "a.js": ugly }, ["--plugin", "prettier-plugin-brace-style"], { reads: ["a.js"] });
    expect(flag.files["a.js"]).toBe(ugly);
    expect(flag.stderr).toContain("bun format does not have the plugin prettier-plugin-brace-style");
    expect(flag.exitCode).toBe(2);
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
    expect(result.stderr).toContain("and left as they are: 1 .astro.");
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

    test("a project that depends on oxfmt, or Vite+, and not on Prettier is formatted like oxfmt does", async () => {
      expect(await after({})).toBe(asPrettier);
      expect(await after({ "package.json": '{ "devDependencies": { "oxfmt": "0.72.0" } }\n' })).toBe(asOxfmt);
      expect(await after({ "package.json": '{ "dependencies": { "vite-plus": "1.0.0" } }\n' })).toBe(asOxfmt);
      const both = await format(
        { "a.ts": asOxfmt, "package.json": '{ "devDependencies": { "oxfmt": "0.72.0", "prettier": "3.9.9" } }\n' },
        ["a.ts"],
        { reads: ["a.ts"] },
      );
      expect(both.files["a.ts"]).toBe(asPrettier);
      expect(both.stderr).toContain(
        "[warn] There is no configuration file, and the project depends on both oxfmt and prettier",
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

    test("--init writes an .oxfmtrc.json, as oxfmt does, and not over one that is there", async () => {
      const result = await format({ "a.ts": asOxfmt }, ["--init"], { reads: [".oxfmtrc.json", "a.ts"] });
      expect(result.files).toEqual({ ".oxfmtrc.json": '{\n  "ignorePatterns": []\n}\n', "a.ts": asOxfmt });
      expect(result.stdout).toBe("Created `.oxfmtrc.json`.");
      expect(result.exitCode).toBe(0);
      const again = await format({ ".oxfmtrc.jsonc": "{}\n" }, ["--init"], { reads: [".oxfmtrc.jsonc"] });
      expect(again.files[".oxfmtrc.jsonc"]).toBe("{}\n");
      expect(again.stderr).toContain("A configuration file of oxfmt already exists.");
      expect(again.exitCode).toBe(1);
    });
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
      "a.svelte": '<p   class="a">hi</p>\n',
      "b.foo": "a:   1\n",
      "c.js": "c  ;\n",
      "d.js": "d  ;\n",
    };
    const reads = Object.keys(files);
    const overrides = [
      { files: "*.svelte", options: { parser: "svelte" } },
      { files: ["*.foo", "c.js"], options: { parser: "nonsense" } },
    ];

    test("in the overrides of a .prettierrc: the files are left as they are, and counted", async () => {
      const config = JSON.stringify({ plugins: ["prettier-plugin-svelte"], overrides });
      const result = await format({ ...files, ".prettierrc": config }, [], { reads });
      expect(result.files).toEqual({ ...files, "d.js": "d;\n" });
      expect(result.stderr).toContain(
        "3 files are in a language that bun format does not support yet, and left as they are: 1 .foo, 1 .js, 1 .svelte",
      );
      expect(result.exitCode).toBe(2);
      const checked = await format({ ...files, ".prettierrc": config, "d.js": "d;\n" }, ["--check", ...reads], {
        reads,
      });
      expect(checked.files).toEqual({ ...files, "d.js": "d;\n" });
      expect(checked.stderr).toContain("3 files are in a language that bun format does not support yet");
      expect(checked.exitCode).toBe(2);
    });

    test("at the top of a .prettierrc: every file is left as it is", async () => {
      const result = await format({ ...files, ".prettierrc": '{ "parser": "nonsense" }\n' }, [], { reads });
      expect(result.files).toEqual(files);
      expect(result.stderr).toContain("files are in a language that bun format does not support yet");
      expect(result.exitCode).toBe(2);
    });

    test("on standard input: what is read is printed", async () => {
      const config = JSON.stringify({ overrides });
      const result = await format({ ".prettierrc": config }, ["--stdin-filepath", "a.svelte"], {
        stdin: files["a.svelte"],
      });
      expect(result.raw).toBe(files["a.svelte"]);
      expect(result.exitCode).toBe(0);
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
      expect(result.stderr).toContain(`[error] Couldn't resolve parser "nonsense".`);
      expect(result.exitCode).toBe(2);
      const piped = await format({}, ["--parser", "nonsense", "--stdin-filepath", "c.js"], { stdin: files["c.js"] });
      expect(piped.raw).toBe("");
      expect(piped.stderr).toContain(`[error] Couldn't resolve parser "nonsense".`);
      expect(piped.exitCode).toBe(2);
    });
  });

  test.each([
    ["arrays", (depth: number) => Buffer.alloc(depth, "[").toString() + Buffer.alloc(depth, "]").toString()],
    [
      "objects",
      (depth: number) => Buffer.alloc(depth * 5, '{"a":').toString() + "1" + Buffer.alloc(depth, "}").toString(),
    ],
  ])("JSON that is nested too deeply is refused, not formatted into gigabytes: %s", async (_, make) => {
    const files = { "ok.json": make(512), "deep.json": make(513), "huge.json": make(200_000) };
    const [ok, deep, huge] = await Promise.all(Object.keys(files).map(name => format(files, ["--check", name])));
    expect(ok.stderr).not.toContain("[error]");
    expect({ deep: deep.exitCode, huge: huge.exitCode }).toEqual({ deep: 2, huge: 2 });
    expect(huge.stderr).toContain("[error] huge.json:");
  });

  test.each(["@", "keyof ", "renders ", "infer A extends ", "component() renders "])(
    "code that is nested too deeply is refused, and does not overflow the stack: 100,000 times `%s`",
    async word => {
      const text = word === "@" ? word.repeat(100_000) : `// @flow\ntype A = ${word.repeat(100_000)}x;`;
      const result = await format({ "deep.js": text + "\n" }, ["--check", "deep.js"]);
      expect(result.stderr).toContain("[error] deep.js:");
      expect(result.exitCode).toBe(2);
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
    for (const name of Object.keys(files)) expect(result.stderr).toContain(`[error] ${name}: SyntaxError: `);
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
    expect(result.stderr).toContain("[error] a.js: SyntaxError: ");
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
    expect(result.stderr).toContain("[error] a.js: SyntaxError: ");
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
  ])("with an .oxfmtrc.json what OXC's parser refuses is a syntax error: %s: %j", async (name, code) => {
    const files = { [name]: code + "\n" };
    const result = await format({ ...files, ".oxfmtrc.json": "{}\n" }, [name], { reads: [name] });
    expect(result.files).toEqual(files);
    expect(result.stderr).toContain(`[error] ${name}: SyntaxError: `);
    expect(result.exitCode).toBe(2);
  });

  test.each([
    ["a.ts", "declare const a: string;"],
    ["a.d.ts", "export const a: string;"],
    ["a.ts", "export const a = /(/;"],
    ["a.ts", "export {};\nlet = 1;"],
    ["a.js", "export {};\nstatic = 1;"],
    ["a.js", "for (const a of b);"],
  ])("with an .oxfmtrc.json what OXC's parser takes is formatted: %s: %j", async (name, code) => {
    const result = await format({ [name]: code + "\n", ".oxfmtrc.json": "{}\n" }, ["--check", name]);
    expect(result.stderr).not.toContain("[error]");
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
    expect(result.stderr).toBe("");
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
    expect(directory.stderr).not.toContain("[error]");
    expect(directory.exitCode).toBe(0);
    const named = await format(files, reads, { reads });
    expect(named.files).toEqual(after);
    expect(named.stderr.split("\n").filter(line => line.includes("No parser could be inferred")).length).toBe(2);
    expect(named.exitCode).toBe(2);
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
    expect(result.stderr).toContain("a.yaml: SyntaxError");
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
    expect(odd.cpu / plain.cpu).toBeLessThan(6);
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
      const count = isDebug || isASAN ? 2_000 : 40_000;
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
      expect(shapes.stderr).not.toContain("[error]");
      expect(shapes.cpu / plain.cpu).toBeLessThan(6);
    },
    120_000,
  );

  test("a syntax error in HTML is what Prettier says it is, with its place", async () => {
    const cases = [
      [
        ".html",
        "<div>\n  <p></div>\n</span>\n",
        'Unexpected closing tag "span". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags (3:1)',
      ],
      [".html", "<div>\n<span", 'Opening tag "span" not terminated. (2:1)'],
      [".html", "<a b='c>", 'Unexpected character "EOF" (1:9)'],
      [".html", "<p>&nope;</p>\n", 'Unknown entity "nope" - use the "&#<decimal>;" or  "&#x<hex>;" syntax (1:4)'],
      [
        ".html",
        "<p>\u00e9&#12 </p>\n",
        'Unable to parse entity "&#12 " - decimal character reference entities must end with ";" (1:10)',
      ],
      [
        ".html",
        "<p>&#x110000000;</p>\n",
        'Unknown entity "&#x110000000;" - use the "&#<decimal>;" or  "&#x<hex>;" syntax (1:17)',
      ],
      [".html", "<br></br>\n", 'Void elements do not have end tags "br" (1:5)'],
      [".html", "<svg><rect", 'Opening tag ":svg:rect" not terminated. (1:6)'],
      [
        ".vue",
        "<template>\n  <div></template>\n",
        'Unexpected closing tag "template". It may happen when the tag has already been closed by another tag. For more info see https://www.w3.org/TR/html5/syntax.html#closing-elements-that-have-implied-end-tags (2:8)',
      ],
      [
        ".vue",
        "<script>\n</script>\n<template>\n  <a>&nope;</a>\n</template>\n",
        'Unknown entity "nope" - use the "&#<decimal>;" or  "&#x<hex>;" syntax (4:6)',
      ],
      [".component.html", "@if (a) {\n  <b></b>\n", 'Unclosed block "if" (1:1)'],
      [
        ".component.html",
        "<div>@if (a {</div>\n",
        'Incomplete block "if". If you meant to write the @ character, you should use the "&#64;" HTML entity instead. (1:6)',
      ],
      [
        ".component.html",
        "<b>}</b>\n",
        'Unexpected closing block. The block may have been closed earlier. If you meant to write the `}` character, you should use the "&#125;" HTML entity instead. (1:4)',
      ],
      [
        ".component.html",
        "@if (a) {<b>}</b>\n",
        'Unexpected closing block. The block may have been closed earlier. Did you forget to close the <b> element? If you meant to write the `}` character, you should use the "&#125;" HTML entity instead. (1:13)',
      ],
      [
        ".component.html",
        "@let a;\n",
        'Incomplete @let declaration "a". @let declarations must be written as `@let <name> = <value>;` (1:1)',
      ],
      [
        ".component.html",
        "@let \n",
        "Incomplete @let declaration. @let declarations must be written as `@let <name> = <value>;` (1:1)",
      ],
      [".component.html", "{a, plural, =0 {b}\n", "Invalid ICU message. Missing '}'. (2:1)"],
      [
        ".component.html",
        "{a, plural, =0 b}}\n",
        'Unexpected character "EOF" (Do you have an unescaped "{" in your template? Use "{{ \'{\' }}") to escape it.) (2:1)',
      ],
    ];
    const files = Object.fromEntries(cases.map(([ending, text], index) => [`${index}${ending}`, text]));
    const result = await format(files, ["--check"]);
    const errors = result.stderr.split("\n").filter(line => /^\[error\] \d+\./.test(line));
    expect(errors.sort()).toEqual(
      cases.map(([ending, , message], index) => `[error] ${index}${ending}: SyntaxError: ${message}`).sort(),
    );
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
    expect(result.stderr).not.toContain("[error]");
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

    test.skipIf(isWindows)("links are not followed", async () => {
      const before = (dir: string) => {
        symlinkSync("../a.js", join(dir, "src/link.js"));
        symlinkSync("src", join(dir, "linked"));
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
      expect(result.stderr).toContain('[error] No files matching the pattern were found: "nothing/*.js".');
      expect(result.exitCode).toBe(2);
    });

    test("a file without a parser fails with 2, unless -u", async () => {
      const [plain, tolerant] = await Promise.all([format(files, ["notes.xyz"]), format(files, ["-u", "notes.xyz"])]);
      expect(plain.stderr).toContain("No parser could be inferred for file");
      expect({ plain: plain.exitCode, tolerant: tolerant.exitCode }).toEqual({ plain: 2, tolerant: 0 });
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
        "format.js": `/** @format */\n${ugly}`,
        "prettier.js": `#!/usr/bin/env bun\n/**\n * Text.\n * @prettier\n */\n${ugly}`,
        "in-text.js": `/** see @format */\n${ugly}`,
        "noformat.js": `/** @noformat */\n${ugly}`,
      };
      expect(await different({ ...files, ".prettierrc": `{ "requirePragma": true }` }, [])).toEqual([
        "format.js",
        "prettier.js",
      ]);
      expect(await different(files, ["--check-ignore-pragma"])).toEqual([
        "format.js",
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

    test("--check", async () => {
      const result = await format({}, ["--check", "--stdin-filepath", "a.js"], { stdin: ugly });
      expect(result.raw).toBe("(stdin)\n");
      expect(result.exitCode).toBe(1);
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
      expect(result.stdout).toContain("bun format");
      expect(result.stdout).toContain("--list-different");
      expect(result.exitCode).toBe(0);
    });
  });
});

describe.concurrent("a format script in package.json", () => {
  test("wins over the formatter", async () => {
    const result = await format(
      { "package.json": JSON.stringify({ scripts: { format: "echo the script" } }), "a.js": ugly },
      [],
      { reads: ["a.js"] },
    );
    expect(result.stdout).toBe("the script");
    expect(result.files).toEqual({ "a.js": ugly });
  });

  test("in that script, bun format is the formatter", async () => {
    const script = `"${bunExe().replaceAll("\\", "/")}" format a.js`;
    const result = await format({ "package.json": JSON.stringify({ scripts: { format: script } }), "a.js": ugly }, [], {
      reads: ["a.js"],
    });
    expect(result.files).toEqual({ "a.js": formatted });
    expect(result.exitCode).toBe(0);
  });
});
