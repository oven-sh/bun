import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { existsSync, readFileSync, statSync, symlinkSync } from "node:fs";
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
};

async function format(files: Record<string, string>, args: string[], options: Options = {}) {
  using dir = tempDir("bun-format", files);
  options.before?.(String(dir));
  await using proc = Bun.spawn({
    cmd: [...command, ...args],
    env,
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

  test("other languages are left alone, which is an error at the end, or a warning with --allow-unsupported", async () => {
    const files = { "a.mdx": "#   a\n", "b.mdx": "#   b\n", "c.js": ugly };
    const reads = Object.keys(files);
    const text = "2 files are in a language that bun format does not support yet, and left as they are: 2 .mdx";
    const result = await format(files, [], { reads });
    expect(result.files).toEqual({ ...files, "c.js": formatted });
    expect(result.stderr.trimEnd().split("\n").at(-1)).toBe(
      `[error] ${text}. With --allow-unsupported this is a warning.`,
    );
    expect(result.exitCode).toBe(2);
    const checked = await format({ ...files, "c.js": formatted }, ["--check"], { reads });
    expect(checked.stderr).toContain(`[error] ${text}`);
    expect(checked.exitCode).toBe(2);
    const allowed = await format(files, ["--allow-unsupported"], { reads });
    expect(allowed.files).toEqual({ ...files, "c.js": formatted });
    expect(allowed.stderr.split("\n")).toContain(`[warn] ${text}`);
    expect(allowed.exitCode).toBe(0);
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
    expect(broken.stderr).toContain("b.toml: SyntaxError: It is not TOML.");
    expect(broken.exitCode).toBe(2);
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
      { ".prettierrc": `{ "plugins": ["prettier-plugin-tailwindcss"], ${unknown} }`, "a.js": ugly },
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

  test("sortTailwindcss, where it has no effect yet, is an error at the end of the run, or a warning with --allow-unsupported", async () => {
    const html = '<p class="b c">{{d}}</p>\n';
    const files = {
      ".oxfmtrc.json": '{ "sortTailwindcss": {} }\n',
      "a.js": ugly,
      "b.hbs": html,
      "c.hbs": "<p></p>\n",
    };
    const result = await format(files, [], { reads: ["a.js"] });
    expect(result.files["a.js"]).toBe(formatted);
    const text = "sortTailwindcss is not supported yet in these languages, and has no effect there: 1 .hbs";
    expect(result.stderr).toContain(`[error] ${text}. With --allow-unsupported this is a warning.`);
    expect(result.exitCode).toBe(2);
    const allowed = await format(files, ["--allow-unsupported"], { reads: ["a.js"] });
    expect(allowed.stderr).toContain(`[warn] ${text}`);
    expect(allowed.exitCode).toBe(0);
    const off = await format({ ...files, ".oxfmtrc.json": '{ "sortTailwindcss": false }\n' }, [], { reads: ["a.js"] });
    expect(off.stderr).not.toContain("sortTailwindcss");
    expect(off.exitCode).toBe(0);
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

  test("JSX in a block of MDX in Markdown is formatted, though what is printed of it is no program", async () => {
    const result = await format({ "a.md": "```mdx\n<hi/>\n<hello\n/>\n```\n" }, [], { reads: ["a.md"] });
    expect(result.files["a.md"]).toBe("```mdx\n<hi />\n<hello />\n```\n");
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

  // A debug build is 30 times slower or more: a third of the size shows as much there.
  const times = (text: string, count: number) => text.repeat(isDebug || isASAN ? count / 3 : count);
  test.each([
    ["interpolations in <pre>", "a.vue", `<template><pre>${times("{{a}}", 30_000)}</pre></template>\n`],
    [
      "names after prettier-ignore-attribute",
      "a.html",
      `<!-- prettier-ignore-attribute${times(" a", 20_000)} -->\n<div${times(" b", 20_000)}></div>\n`,
    ],
    ["end tags in a string of TypeScript", "a.vue", `<script lang="ts">\na = "${times("</ ", 60_000)}";\n</script>\n`],
    ["blanks in v-for", "a.vue", `<template><a v-for="a${times(" ", 60_000)}b"></a></template>\n`],
  ])(
    "HTML does not take quadratic time: %s",
    async (_, name, text) => {
      const result = await format({ [name]: text }, ["--check", name]);
      expect(result.stderr).not.toContain("[error]");
      expect(result.cpu).toBeLessThan(5);
      expect(result.exitCode).toBe(1);
    },
    60_000,
  );

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
