// Svelte components: a port of prettier-plugin-svelte 4.1.1, which oxfmt calls too, and of the parser of Svelte 5.57.
// cases.json: inputs with what Prettier 3.9.9 with the plugin, and oxfmt 0.72, print for them. It is made by
// test/cli/format/oracle/svelte/make-fixtures.ts. A case without an output is one that they refuse.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../../children";
import cases from "./cases.json";
import { forOxfmt } from "./for-oxfmt";

afterAll(endChildren);

async function formatIn(cwd: string, names: string[], flags: string[] = ["."]) {
  await using proc = spawn({
    cmd: [bunExe(), "format", "--log-level=warn", ...flags],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, files: names.map(name => readFileSync(join(cwd, name), "utf8")) };
}

async function format(files: Record<string, string>, names: string[], flags: string[] = []) {
  using dir = tempDir("bun-format-svelte", files);
  return await formatIn(String(dir), names, [...flags, "."]);
}

const plugins = ["prettier-plugin-svelte"];
const prettierrc = JSON.stringify({ plugins });
const oxfmtrc = '{ "svelte": true }';
/** The plugin, as far as it is looked at. */
const plugin = (version: string) => ({
  "node_modules/prettier-plugin-svelte/package.json": JSON.stringify({ name: "prettier-plugin-svelte", version }),
});

describe.concurrent("Svelte", () => {
  // One run for all the cases with the same options.
  for (const [options, group] of Map.groupBy(cases, it => JSON.stringify(it.options))) {
    const configs = {
      prettier: { ".prettierrc": JSON.stringify({ plugins, ...JSON.parse(options) }) },
      oxfmt: { ".oxfmtrc.json": JSON.stringify(forOxfmt(JSON.parse(options))) },
    };
    test.each(["prettier", "oxfmt"] as const)(`as %s: ${options}`, async tool => {
      const names = group.map((_, index) => `${index}.svelte`);
      const files = Object.fromEntries(group.map((it, index) => [names[index], it.input]));
      const result = await format({ ...configs[tool], ...files }, names);
      for (const [index, it] of group.entries()) {
        // What is refused stays as it is.
        const output = it[tool] ?? it.input;
        expect({ name: it.name, output: result.files[index] }).toEqual({ name: it.name, output });
        expect({ name: it.name, isRefused: result.stderr.includes(`[error] ${names[index]}:`) }).toEqual({
          name: it.name,
          isRefused: !(tool in it),
        });
      }
      expect(result.exitCode).toBe(group.every(it => tool in it) ? 0 : 2);
    });
  }

  const [input, output] = ["<p   >a</p>\n<script>let  a</script>\n", "<script>\n  let a;\n</script>\n\n<p>a</p>\n"];

  test("oxfmt formats components only with `svelte` in the configuration", async () => {
    expect(await format({ ".oxfmtrc.json": oxfmtrc, "a.svelte": input }, ["a.svelte"])).toMatchObject({
      stderr: "",
      files: [output],
      exitCode: 0,
    });
    for (const config of ["{}", '{ "svelte": false }']) {
      const files = { ".oxfmtrc.json": config, "a.svelte": input, "b.js": "b  ;\n" };
      expect((await format(files, ["a.svelte", "b.js"])).files).toEqual([input, "b;\n"]);
    }
  });

  // What oxfmt 0.72 names.
  test.each([
    [
      "only in an override",
      { overrides: [{ files: ["**/*.svelte"], options: { svelte: {} } }] },
      ["App.svelte", "legacy/Old.svelte"],
    ],
    [
      "only for Markdown",
      { overrides: [{ files: ["**/*.md"], options: { svelte: {} } }] },
      ["README.md", "legacy/old.md"],
    ],
    [
      "off in an override",
      { svelte: {}, overrides: [{ files: ["legacy/**"], options: { svelte: false } }] },
      ["App.svelte", "Doc.mdx", "README.md"],
    ],
    [
      "off and on again",
      {
        svelte: {},
        overrides: [
          { files: ["legacy/**"], options: { svelte: false } },
          { files: ["**/Old.svelte"], options: { svelte: true } },
        ],
      },
      ["App.svelte", "Doc.mdx", "README.md", "legacy/Old.svelte"],
    ],
    [
      "on and off again",
      {
        overrides: [
          { files: ["**/*.svelte"], options: { svelte: true } },
          { files: ["legacy/**"], options: { svelte: false } },
        ],
      },
      ["App.svelte"],
    ],
  ])("oxfmt's `svelte` %s", async (_, config, named) => {
    const block = `# a\n\n\`\`\`svelte\n${input}\`\`\`\n`;
    const files = {
      ".oxfmtrc.json": JSON.stringify(config),
      "App.svelte": input,
      "legacy/Old.svelte": input,
      "README.md": block,
      "Doc.mdx": block,
      "legacy/old.md": block,
    };
    const result = await format(files, [], ["--log-level=log", "--list-different"]);
    expect(
      result.stdout
        .split("\n")
        .filter(it => /\.(svelte|mdx?)$/.test(it))
        .sort(),
    ).toEqual(named);
    expect(result.exitCode).toBe(1);
  });

  // What Prettier 3.9.9 names: the last list of plugins that applies to a file is its list.
  test.each([
    [
      "only in an override",
      { overrides: [{ files: "*.svelte", options: { plugins } }] },
      ["App.svelte", "legacy/Old.svelte"],
    ],
    [
      "in an override for a directory",
      { overrides: [{ files: "legacy/**", options: { plugins } }] },
      ["legacy/Old.svelte", "legacy/old.md"],
    ],
    [
      "in an override for Markdown",
      { overrides: [{ files: "*.md", options: { plugins } }] },
      ["README.md", "legacy/old.md"],
    ],
    [
      "that an override empties",
      { plugins, overrides: [{ files: "legacy/**", options: { plugins: [] } }] },
      ["App.svelte", "Doc.mdx", "README.md"],
    ],
    [
      "by its path",
      { plugins: ["./node_modules/prettier-plugin-svelte/plugin.js"] },
      ["App.svelte", "Doc.mdx", "README.md", "legacy/Old.svelte", "legacy/old.md"],
    ],
  ])("Prettier's plugin %s", async (_, config, named) => {
    const block = `# a\n\n\`\`\`svelte\n${input}\`\`\`\n`;
    const files = {
      ".prettierrc": JSON.stringify(config),
      "App.svelte": input,
      "legacy/Old.svelte": input,
      "README.md": block,
      "Doc.mdx": block,
      "legacy/old.md": block,
    };
    const result = await format(files, [], ["--log-level=log", "--list-different"]);
    expect(
      result.stdout
        .split("\n")
        .filter(it => /\.(svelte|mdx?)$/.test(it))
        .sort(),
    ).toEqual(named);
    expect(result.exitCode).toBe(1);
  });

  test("oxfmt gives a component on standard input back if it is not to format it", async () => {
    using dir = tempDir("bun-format-svelte", { ".oxfmtrc.json": "{}" });
    await using proc = spawn({
      cmd: [bunExe(), "format", "--stdin-filepath", "a.svelte"],
      env: bunEnv,
      cwd: String(dir),
      stdin: Buffer.from(input),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: input, stderr: "", exitCode: 0 });
  });

  test("Prettier formats components only with the plugin", async () => {
    expect(await format({ ".prettierrc": prettierrc, "a.svelte": input }, ["a.svelte"])).toMatchObject({
      stderr: "",
      files: [output],
      exitCode: 0,
    });
    const files = { ".prettierrc": "{}", "a.svelte": input, "b.js": "b  ;\n" };
    expect((await format(files, ["a.svelte", "b.js"])).files).toEqual([input, "b;\n"]);
    const named = { ".prettierrc": '{ "overrides": [{ "files": "*.svelte", "options": { "parser": "svelte" } }] }' };
    const withParser = await format({ ...named, "a.svelte": input }, ["a.svelte"]);
    expect(withParser.files).toEqual([input]);
    expect(withParser.exitCode).toBe(2);
    const both = { ".prettierrc": JSON.stringify({ plugins, ...JSON.parse(named[".prettierrc"]) }) };
    expect((await format({ ...both, "a.svelte": input }, ["a.svelte"])).files).toEqual([output]);
  });

  test(
    "another version of the plugin than 4.1.1 prints in another way, so the Prettier of the project is asked",
    async () => {
      // A stand-in, which says that it has been there.
      const prettier = {
        "node_modules/prettier/package.json": '{ "name": "prettier", "version": "3.0.0", "main": "index.cjs" }',
        "node_modules/prettier/index.cjs": `exports.resolveConfig = async () => null;
exports.format = async text => "<!-- by Prettier -->\\n" + text;
`,
      };
      const files = { ...prettier, ".prettierrc": prettierrc, "a.svelte": input };
      expect((await format({ ...files, ...plugin("4.1.1") }, ["a.svelte"])).files).toEqual([output]);
      expect((await format(files, ["a.svelte"])).files).toEqual([output]);
      for (const version of ["4.1.0", "4.0.0", "3.5.2", "3.2.6", "4.1.2", "4.2.0", "5.0.0"]) {
        expect({ version, files: (await format({ ...files, ...plugin(version) }, ["a.svelte"])).files }).toEqual({
          version,
          files: [`<!-- by Prettier -->\n${input}`],
        });
      }
      // So it is for a range.
      const range = await format({ ...files, ...plugin("4.1.1") }, ["a.svelte"], ["--range-start=1"]);
      expect(range.files).toEqual([`<!-- by Prettier -->\n${input}`]);
    },
    isDebug || isASAN ? 120_000 : 10_000,
  );

  test("from standard input", async () => {
    using dir = tempDir("bun-format-svelte", { ".oxfmtrc.json": oxfmtrc });
    await using proc = spawn({
      cmd: [bunExe(), "format", "--stdin-filepath=a.svelte"],
      env: bunEnv,
      cwd: String(dir),
      stdin: Buffer.from(input),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: output, stderr: "", exitCode: 0 });
  });

  test("the options of oxfmt's `svelte`", async () => {
    const config = {
      svelte: { sortOrder: "markup-scripts-styles-options", indentScriptAndStyle: false, allowShorthand: false },
    };
    const result = await format({ ".oxfmtrc.json": JSON.stringify(config), "a.svelte": `<a {b}>c</a>\n${input}` }, [
      "a.svelte",
    ]);
    expect(result).toMatchObject({ stderr: "", files: ["<a b={b}>c</a>\n<p>a</p>\n\n<script>\nlet a;\n</script>\n"] });
    const wrong = await format({ ".oxfmtrc.json": '{ "svelte": { "sortOrder": "a-b" } }', "a.svelte": input }, [
      "a.svelte",
    ]);
    expect(wrong.files).toEqual([input]);
    expect(wrong.exitCode).not.toBe(0);
  });

  test("pragmas", async () => {
    const config = (options: object) => ({ ".prettierrc": JSON.stringify({ plugins, ...options }) });
    const files = { "a.svelte": "<p   >a</p>\n", "b.svelte": "<!-- @format -->\n<p   >a</p>\n" };
    expect((await format({ ...config({ requirePragma: true }), ...files }, ["a.svelte", "b.svelte"])).files).toEqual([
      files["a.svelte"],
      "<!-- @format -->\n<p>a</p>\n",
    ]);
    expect((await format({ ...config({ insertPragma: true }), ...files }, ["a.svelte", "b.svelte"])).files).toEqual([
      "<!-- @format -->\n<p>a</p>\n",
      "<!-- @format -->\n<p>a</p>\n",
    ]);
  });

  // The plugin writes these, and what it writes is another component, or none.
  test.each([
    ["a quote in single quotes", `<Child prop='"' />\n`],
    ["an element that is void to Svelte and not to the plugin", "<keygen>\n"],
    ["comments behind an expression", "{a + b // c\n}\n"],
    ["the key of a property with a default", "{#each a as { b: c = 1 }}{c}{/each}\n"],
    ["rows that are closed by the next", "<table><tr><td>a<tr><td>b</table>\n"],
  ])("what the plugin would damage is left as it is: %s", async (_, text) => {
    for (const config of [{ ".prettierrc": prettierrc }, { ".oxfmtrc.json": oxfmtrc }]) {
      const result = await format({ ...config, "a.svelte": text, "b.svelte": input }, ["a.svelte", "b.svelte"]);
      expect(result.files).toEqual([text, output]);
      expect(result.stderr).toContain("[error] a.svelte: ");
      expect(result.stderr).toContain("would change what is in it");
      expect(result.exitCode).toBe(2);
    }
  });

  test(
    "texts that are made to take long do not",
    async () => {
      // Where something took time in proportion to the square of this, it took a minute at 40,000.
      const n = isDebug || isASAN ? 2_000 : 40_000;
      // The frames of such a build are larger, so the stack ends sooner.
      const depth = isDebug || isASAN ? 100 : 390;
      const numbered = (text: (index: number) => string) =>
        Array.from({ length: n }, (_, index) => text(index)).join(" ");
      const shapes: Record<string, string> = {
        "paragraphs": "<p>some words here</p>\n".repeat(n),
        "comments-not-closed": "<!-- ".repeat(n),
        "scripts-not-closed": "<script>".repeat(n),
        "styles-with-a-quote-not-closed": '<style a="'.repeat(n),
        "attributes-of-a-script": `<script ${'a="b" '.repeat(n)}x`,
        "attributes-of-a-script-next-to-quotes": `<script ${'a="b"c '.repeat(n)}>`,
        "ends-of-scripts": "</script ".repeat(n),
        "less-than": "<".repeat(n),
        "attributes": `<a ${numbered(index => `a${index}`)}></a>`,
        "attributes-with-values": `<a ${numbered(index => `a${index}="b c"`)}></a>`,
        "the-same-attribute": `<a ${"b ".repeat(n)}>`,
        "elements-in-each-other": "<b>".repeat(n),
        "as-deep-as-it-may-be": `${"<b>".repeat(depth)}x${"</b>".repeat(depth)}\n`.repeat(n / 400),
        "inline-elements": "<b>x</b> ".repeat(n),
        "blocks": "<div>x</div>".repeat(n),
        "comments": "<!-- a -->".repeat(n),
        "comments-before-a-script": `${"<!-- a -->\n".repeat(n)}<script></script>`,
        "words": "word ".repeat(4 * n),
        "one-word": "w".repeat(8 * n),
        "line-breaks": "\n".repeat(8 * n),
        "pre": `<pre>${"a\n".repeat(n)}</pre>`,
        "textarea": `<textarea>${"a\n".repeat(n)}</textarea>`,
        "textareas-not-closed": "<textarea>".repeat(n),
        "ignored": "<!-- prettier-ignore -->\n<p   >a</p>\n".repeat(n),
        "an-ignored-range": `<!-- prettier-ignore-start -->\n${"<p   >a</p>\n".repeat(n)}<!-- prettier-ignore-end -->`,
        "classes": `<p class="${"a  b\n".repeat(n)}"></p>`,
        "the-mark-of-the-plugin": '✂prettier:content✂="1">'.repeat(n),
        "the-mark-of-the-plugin-in-elements": '<a ✂prettier:content✂="1">'.repeat(n),
        "paragraphs-not-closed": "<p>".repeat(n),
        "items-not-closed": `<ul>${"<li>a".repeat(n)}</ul>`,
        "void-elements": "<br>".repeat(n),
        "entities": "&amp;".repeat(n),
        "nul": "\0".repeat(n),
        "end-tags": "</a>".repeat(n),
        "starts-of-blocks": "{#".repeat(n),
        "braces": "{".repeat(n),
        "closing-braces": "}".repeat(n),
        "tags": "{a}".repeat(n),
        "parentheses-in-a-tag": `{${"(".repeat(n)}`,
        "blocks-in-each-other": "{#if a}".repeat(n),
        "attributes-of-the-options": `<svelte:options ${"a ".repeat(n)}/>`,
        "ends-of-regions": `<script></script>${"<!-- #endregion -->".repeat(n)}`,
        "style-sheets": "<style></style>".repeat(n),
        "scripts-in-an-element": `<div>${"<script>a</script>".repeat(n / 10)}</div>`,
      };
      using dir = tempDir("bun-format-svelte", {
        ".oxfmtrc.json": oxfmtrc,
        ...Object.fromEntries(Object.entries(shapes).map(([name, text]) => [`${name}.svelte`, text])),
      });
      await using proc = spawn({
        cmd: [bunExe(), "format", "--check", "--threads=1", "."],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
      const refused = Array.from(stderr.matchAll(/^\[error\] ([\w-]+)\.svelte: (\w+)/gm), it => `${it[1]}: ${it[2]}`);
      expect(refused.sort()).toMatchInlineSnapshot(`
        [
          "attributes-of-a-script-next-to-quotes: SyntaxError",
          "attributes-of-a-script: SyntaxError",
          "attributes-of-the-options: SyntaxError",
          "blocks-in-each-other: RangeError",
          "braces: SyntaxError",
          "comments-not-closed: SyntaxError",
          "elements-in-each-other: RangeError",
          "end-tags: SyntaxError",
          "ends-of-scripts: SyntaxError",
          "less-than: SyntaxError",
          "paragraphs-not-closed: SyntaxError",
          "parentheses-in-a-tag: SyntaxError",
          "scripts-not-closed: SyntaxError",
          "starts-of-blocks: SyntaxError",
          "style-sheets: SyntaxError",
          "styles-with-a-quote-not-closed: SyntaxError",
          "textareas-not-closed: SyntaxError",
          "the-mark-of-the-plugin-in-elements: RangeError",
          "the-same-attribute: SyntaxError",
        ]
      `);
      expect(exitCode).toBe(2);
      expect(Number(proc.resourceUsage()!.cpuTime.user) / 1e6).toBeLessThan(isDebug || isASAN ? 60 : 10);
    },
    isDebug || isASAN ? 120_000 : 30_000,
  );

  test("blocks of Svelte in Markdown are formatted where components are", async () => {
    const block = (text: string) => `# a\n\n\`\`\`svelte\n${text}\`\`\`\n`;
    for (const config of [{ ".prettierrc": prettierrc }, { ".oxfmtrc.json": oxfmtrc }]) {
      expect(await format({ ...config, "a.md": block(input) }, ["a.md"])).toMatchObject({
        stderr: "",
        files: [block(output)],
      });
      // One that is refused, and one of which something would be lost, stay as they are.
      for (const text of ["<p   >{a +}</p>\n", `<p   a='"'>b</p>\n`]) {
        expect(await format({ ...config, "a.md": block(text) }, ["a.md"])).toMatchObject({
          files: [block(text)],
          exitCode: 0,
        });
      }
    }
    const without = [
      { ".prettierrc": "{}" },
      { ".oxfmtrc.json": "{}" },
      { ".prettierrc": prettierrc, ...plugin("4.1.0") },
    ];
    for (const config of without) {
      expect((await format({ ...config, "a.md": block(input) }, ["a.md"], ["--allow-unsupported"])).files).toEqual([
        block(input),
      ]);
    }
  });

  test("the classes of Tailwind CSS are sorted", async () => {
    // What oxfmt 0.72 prints with tailwindcss 4.3.3. The package is a stand-in, as in ../tailwind.
    const tailwind = {
      "node_modules/tailwindcss/package.json": '{ "name": "tailwindcss", "version": "4.0.0", "main": "index.js" }',
      "node_modules/tailwindcss/theme.css": "",
      "node_modules/tailwindcss/index.js": `const order = ["m-2", "flex", "p-4"];
exports.__unstable__loadDesignSystem = async () => ({
  getClassOrder: classes => classes.map(name => [name, order.includes(name) ? BigInt(order.indexOf(name)) : null]),
});
`,
    };
    const before = `<script>
  const a = cn("p-4 flex");
</script>

<p class="p-4 flex m-2">a</p>
<p class="p-4  flex   flex m-2">b</p>
<p class="p-4 {a} flex m-2">c</p>
<p class="p-4 flex{a}m-2 flex p-4">d</p>
<p class={"p-4 flex"}>e</p>
<p class={a ? "p-4 flex" : \`m-2 \${b} p-4 flex\`}>f</p>
<p class={cn("p-4 flex", { "p-4 m-2": a })}>g</p>
<p look="p-4 flex" other="p-4 flex" class:flex>h</p>
<Comp class="p-4 flex" />
<p title={cn("p-4 flex")}>{cn("p-4 flex")}</p>
`;
    const after = `<script>
  const a = cn("flex p-4");
</script>

<p class="m-2 flex p-4">a</p>
<p class="m-2 flex p-4">b</p>
<p class="p-4 {a} m-2 flex">c</p>
<p class="p-4 flex{a}m-2 flex p-4">d</p>
<p class={"flex p-4"}>e</p>
<p class={a ? "flex p-4" : \`m-2 \${b} flex p-4\`}>f</p>
<p class={cn("flex p-4", { "m-2 p-4": a })}>g</p>
<p look="flex p-4" other="p-4 flex" class:flex>h</p>
<Comp class="flex p-4" />
<p title={cn("p-4 flex")}>{cn("p-4 flex")}</p>
`;
    const config = { svelte: {}, sortTailwindcss: { attributes: ["look"], functions: ["cn"] } };
    const files = { ...tailwind, ".oxfmtrc.json": JSON.stringify(config), "a.svelte": before };
    expect(await format(files, ["a.svelte"])).toMatchObject({ stderr: "", files: [after], exitCode: 0 });
  });

  test('with svelteSortOrder "none" every part is there once, in its place', async () => {
    // The plugin puts a script or a style sheet back next to a node of the markup. One that has none is lost: the first of these
    // comes out empty. Some are there twice.
    const script = "<script>\n  let a;\n</script>\n";
    const files = {
      "only.svelte": "<script>let  a</script>",
      "last.svelte": "<p   >a</p><style>a{b:c}</style>\n\n<script>let  a</script>",
      "all.svelte":
        "<style>a{b:c}</style>\n<script module>let m</script>\n<script>let  a</script>\n<svelte:options runes />\n",
    };
    const style = "<style>\n  a {\n    b: c;\n  }\n</style>";
    const expected = [
      script,
      `<p>a</p>\n${style}\n\n${script}`,
      `${style}\n<script module>\n  let m;\n</script>\n${script}<svelte:options runes />\n`,
    ];
    const configs = [
      { ".prettierrc": JSON.stringify({ plugins, svelteSortOrder: "none" }) },
      { ".oxfmtrc.json": '{ "svelte": { "sortOrder": "none" } }' },
    ];
    for (const config of configs) {
      using dir = tempDir("bun-format-svelte", { ...config, ...files });
      expect(await formatIn(String(dir), Object.keys(files))).toMatchObject({
        stderr: "",
        files: expected,
        exitCode: 0,
      });
      expect(await formatIn(String(dir), [], ["--check", "."])).toMatchObject({ exitCode: 0 });
    }
  });

  test("under prettier-ignore a script keeps what is in it", async () => {
    // The plugin prints `<script ✂prettier:content✂="bGV0ICBh">{}</script>`.
    const text = "<!-- prettier-ignore -->\n<div   ><script>let  a</script></div>\n";
    expect(await format({ ".prettierrc": prettierrc, "a.svelte": text }, ["a.svelte"])).toMatchObject({
      stderr: "",
      files: [text],
    });
  });
});
