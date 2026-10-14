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
    cmd: [bunExe(), "fmt", "--log-level=warn", ...flags],
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
/** Matches what is said about a file that is left as it is. */
const refusalOf = (name: string) => new RegExp(`^    at ${name.replaceAll(".", "\\.")}(:\\d+:\\d+)?$`, "m");
/** `fill`, `count` times. */
const repeated = (fill: string, count: number) => Buffer.alloc(count * Buffer.byteLength(fill), fill).toString();
/** The plugin, as far as it is looked at. */
const plugin = (version: string) => ({
  "node_modules/prettier-plugin-svelte/package.json": JSON.stringify({ name: "prettier-plugin-svelte", version }),
});

// Where what the plugin prints is another component, Bun prints the right thing. By the name of the case: what is recorded, once, and
// what Bun prints in its place.
const exceptions: Record<string, [recorded: string, printed: string]> = {
  // The plugin loses the comment of `bind:value={/** ( */ (() => value, (v) => ..)}`.
  "directives": ["() => value,", "/** ( */ () => value,"],
  // The plugin leaves out a `{:catch}` with nothing in it. Without one, Svelte throws the error again.
  "generated gen2 3842": ["{#await p}{/await}", "{#await p catch}{/await}"],
  "generated gen 5634": ["{/key}\n{/await}", "{/key}\n{:catch}{/await}"],
  "generated gen 5622": ["{/await}", "{:catch e}{/await}"],
  // The plugin takes a no-break space off the start of a component, where it is text to Svelte.
  "generated gen 3860": ["some and &amp; text", "\u00A0 some and &amp; text"],
  "generated gen 5952": ["there there here", "\u00A0there there here"],
  "generated gen2 738": ["words text", "\u00A0 words text"],
};
// `bun fmt --debug-check-svelte` is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

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
        let output = it[tool] ?? it.input;
        if (it.name in exceptions) {
          const [recorded, printed] = exceptions[it.name];
          expect({ name: it.name, count: output.split(recorded).length - 1 }).toEqual({ name: it.name, count: 1 });
          output = output.replace(recorded, printed);
        }
        expect({ name: it.name, output: result.files[index] }).toEqual({ name: it.name, output });
        expect({ name: it.name, isRefused: refusalOf(names[index]).test(result.stderr) }).toEqual({
          name: it.name,
          isRefused: !(tool in it),
        });
      }
      expect(result.exitCode).toBe(group.every(it => tool in it) ? 0 : 2);
    });
  }

  const [input, output] = ["<p   >a</p>\n<script>let  a</script>\n", "<script>\n  let a;\n</script>\n\n<p>a</p>\n"];
  // A stand-in for Prettier, which says that it has been there.
  const prettier = {
    "node_modules/prettier/package.json": '{ "name": "prettier", "version": "3.0.0", "main": "index.cjs" }',
    "node_modules/prettier/index.cjs": `exports.resolveConfig = async () => null;
exports.format = async text => "<!-- by Prettier -->\\n" + text;
`,
  };
  const byPrettier = `<!-- by Prettier -->\n${input}`;
  // A run that asks it starts a VM, which takes long in a debug build: one such run in a test.

  test("without a Prettier or oxfmt config components are formatted", async () => {
    expect(await format({ "a.svelte": input }, ["a.svelte"])).toMatchObject({
      stderr: "",
      files: [output],
      exitCode: 0,
    });
  });

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
      cmd: [bunExe(), "fmt", "--stdin-filepath", "a.svelte"],
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

  describe("another version of the plugin than 4.1.1 prints in another way, so the Prettier of the project is asked", () => {
    const files = { ...prettier, ".prettierrc": prettierrc, "a.svelte": input };

    test.each([[plugin("4.1.1")], [{}]])("not with 4.1.1, and not without any: %j", async installed => {
      expect((await format({ ...files, ...installed }, ["a.svelte"])).files).toEqual([output]);
    });

    test.each(["4.1.0", "4.0.0", "3.5.2", "4.1.2", "5.0.0"])("%s", async version => {
      expect((await format({ ...files, ...plugin(version) }, ["a.svelte"])).files).toEqual([byPrettier]);
    });

    test("so it is for a range", async () => {
      const range = await format({ ...files, ...plugin("4.1.1") }, ["a.svelte"], ["--range-start=1"]);
      expect(range.files).toEqual([byPrettier]);
    });
  });

  test("the version is that of the plugin that the Prettier of the project would load: from the working directory", async () => {
    const inApp = (files: Record<string, string>) =>
      Object.fromEntries(Object.entries(files).map(([name, text]) => [`packages/app/${name}`, text]));
    using dir = tempDir("bun-format-svelte", {
      ".prettierrc": prettierrc,
      ...inApp({ ...prettier, ...plugin("4.0.0"), "a.svelte": input }),
    });
    expect((await formatIn(join(String(dir), "packages/app"), ["a.svelte"])).files).toEqual([byPrettier]);
  });

  describe("a range or a cursor in the configuration is one too", () => {
    const files = { ...prettier, ...plugin("4.1.1"), "a.svelte": input };
    const forSvelte = (options: object) => ({ overrides: [{ files: "*.svelte", options }] });

    test.each([[{ rangeStart: 1 }], [{ rangeEnd: 5 }], [forSvelte({ cursorOffset: 2 })], [forSvelte({ rangeEnd: 5 })]])(
      "%j",
      async config => {
        const result = await format({ ...files, ".prettierrc": JSON.stringify({ plugins, ...config }) }, ["a.svelte"]);
        expect(result.files).toEqual([byPrettier]);
      },
    );

    test("not one for other files", async () => {
      const config = { plugins, overrides: [{ files: "*.js", options: { rangeEnd: 5 } }] };
      expect((await format({ ...files, ".prettierrc": JSON.stringify(config) }, ["a.svelte"])).files).toEqual([output]);
    });
  });

  describe("a value of an option that this version of the plugin does not take", () => {
    // What 2.x takes.
    const options = { svelteSortOrder: "scripts-markup-styles" };
    const files = { "a.svelte": input, "b.js": "b  ;\n" };

    test("is an error where components are formatted here", async () => {
      const result = await format({ ...files, ".prettierrc": JSON.stringify({ plugins, ...options }) }, ["a.svelte"]);
      expect(result.stderr).toContain("error: Invalid svelteSortOrder value: scripts-markup-styles.\n");
      expect(result).toMatchObject({ files: [input], exitCode: 2 });
    });

    test("is an unknown option without the plugin", async () => {
      const result = await format({ ...files, ".prettierrc": JSON.stringify(options) }, ["a.svelte", "b.js"]);
      expect(result).toMatchObject({
        stderr: 'warn: Ignored unknown option { svelteSortOrder: "scripts-markup-styles" }.\n',
        files: [input, "b;\n"],
        exitCode: 0,
      });
    });

    test("is for the Prettier of the project to judge with another version", async () => {
      const project = { ...files, ...prettier, ...plugin("2.10.1") };
      const config = { ".prettierrc": JSON.stringify({ plugins, ...options }) };
      expect(await format({ ...project, ...config }, ["a.svelte", "b.js"])).toMatchObject({
        stderr: "",
        files: [byPrettier, "b;\n"],
        exitCode: 0,
      });
    });
  });

  // 4.1.1 has svelte5CompilerPath, svelteSortOrder, svelteAllowShorthand and svelteIndentScriptAndStyle.
  describe("svelteStrictMode, which 4.1.1 does not have", () => {
    const files = { ".prettierrc": JSON.stringify({ plugins, svelteStrictMode: true }), "a.svelte": input };

    test.each([[{}], [plugin("4.1.1")]])("is ignored, which is said, as Prettier says it: %j", async installed => {
      expect(await format({ ...files, ...installed }, ["a.svelte"])).toMatchObject({
        stderr: "warn: Ignored unknown option { svelteStrictMode: true }.\n",
        files: [output],
        exitCode: 0,
      });
    });

    test("is for another version to judge, whose files go to the Prettier of the project", async () => {
      expect(await format({ ...files, ...prettier, ...plugin("3.4.0") }, ["a.svelte"])).toMatchObject({
        stderr: "",
        files: [byPrettier],
        exitCode: 0,
      });
    });

    test("the options that 4.1.1 has are known", async () => {
      const config = { plugins, svelte5CompilerPath: "", svelteAllowShorthand: true, svelteIndentScriptAndStyle: true };
      expect(await format({ ".prettierrc": JSON.stringify(config), "a.svelte": input }, ["a.svelte"])).toMatchObject({
        stderr: "",
        files: [output],
        exitCode: 0,
      });
    });
  });

  test("from standard input", async () => {
    using dir = tempDir("bun-format-svelte", { ".oxfmtrc.json": oxfmtrc });
    await using proc = spawn({
      cmd: [bunExe(), "fmt", "--stdin-filepath=a.svelte"],
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
    // Once for each file: the configuration is one too.
    const error = "error: Invalid svelte.sortOrder value: a-b.\n";
    expect(wrong).toMatchObject({
      stderr: `${error}${error}Error occurred when checking code style in the above files.\n`,
      files: [input],
      exitCode: 2,
    });
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
    // Behind the comment the plugin leaves out the empty lines between the parts, and puts them back with the next run.
    const parts = "<script>\n  let a;\n</script>\n\n<p>a</p>\n\n<style></style>\n";
    for (const text of [parts, `<!-- @format -->\n${parts}`]) {
      expect((await format({ ...config({ insertPragma: true }), "a.svelte": text }, ["a.svelte"])).files).toEqual([
        `<!-- @format -->\n${parts}`,
      ]);
    }
  });

  // The text, what Bun makes of it, and what the plugin makes of it, which is another component, or none.
  test.each([
    ["a quote in single quotes", `<Child   prop='"' />\n`, `<Child prop='"' />\n`, `<Child prop=""" />\n`],
    ["an element that is void to Svelte and not to the plugin", "<keygen>\n", "<keygen />\n", "<keygen></keygen>\n"],
    ["a comment behind an expression", "{a  /* b */}\n", "{a /* b */}\n", "{a}\n"],
    ["a comment before a parenthesis", "{/* b */ (a)}\n", "{/* b */ a}\n", "{a}\n"],
    ["a comment up to the end of the line", "{a  + b // c\n}\n", "{a + b // c\n}\n", "{a + b}\n"],
    [
      "a comment in the value of an attribute",
      "<p a={b  /* c */}></p>\n",
      "<p a={b /* c */}></p>\n",
      "<p a={b}></p>\n",
    ],
    ["the same where the value is the name", "<p a={a  /* c */}></p>\n", "<p a={a /* c */}></p>\n", "<p {a}></p>\n"],
    [
      "the key of a property with a default",
      "{#each a as { b:  c = 1 }}{c}{/each}\n",
      "{#each a as { b: c = 1 }}{c}{/each}\n",
      "{#each a as { c = 1 }}{c}{/each}\n",
    ],
    [
      "a computed key that is the name",
      "{#each a as { [b]:  b }}{b}{/each}\n",
      "{#each a as { [b]: b }}{b}{/each}\n",
      "{#each a as { b }}{b}{/each}\n",
    ],
    [
      "a key that is a string, before a pattern",
      `{#each a as { "b":  { c } }}{c}{/each}\n`,
      `{#each a as { "b": { c } }}{c}{/each}\n`,
      "{#each a as { undefined: { c } }}{c}{/each}\n",
    ],
  ])("what the plugin damages is printed right: %s", async (_, before, after, ofPlugin) => {
    expect(after).not.toBe(ofPlugin);
    for (const config of [{}, { ".prettierrc": prettierrc }, { ".oxfmtrc.json": oxfmtrc }]) {
      const result = await format({ ...config, "a.svelte": before, "b.svelte": after }, ["a.svelte", "b.svelte"]);
      expect(result).toMatchObject({ stderr: "", files: [after, after], exitCode: 0 });
      const checked = await format({ ...config, "a.svelte": before }, ["a.svelte"], ["--debug-check"]);
      expect(checked).toMatchObject({ stderr: "", files: [before], exitCode: 0 });
    }
  });

  // The same for a comment at every place where there is an expression or a pattern.
  const comments = [
    ["{#if a  /* b */}c{/if}\n", "{#if a /* b */}c{/if}\n", "{#if a}c{/if}\n"],
    ["{#if a}c{:else if d  /* b */}e{/if}\n", "{#if a}c{:else if d /* b */}e{/if}\n", "{#if a}c{:else if d}e{/if}\n"],
    ["{#each a  /* b */ as c}d{/each}\n", "{#each a /* b */ as c}d{/each}\n", "{#each a as c}d{/each}\n"],
    [
      "{#each a as c (c.d  /* b */)}e{/each}\n",
      "{#each a as c (c.d /* b */)}e{/each}\n",
      "{#each a as c (c.d)}e{/each}\n",
    ],
    ["{#each a as { c /* b */ }}d{/each}\n", "{#each a as { c /* b */ }}d{/each}\n", "{#each a as { c }}d{/each}\n"],
    ["{#each a as [c /* b */, d]}e{/each}\n", "{#each a as [c /* b */, d]}e{/each}\n", "{#each a as [c, d]}e{/each}\n"],
    [
      "{#each a as { c, // b\n d }}e{/each}\n",
      "{#each a as { c, // b\n d }}e{/each}\n",
      "{#each a as { c, d }}e{/each}\n",
    ],
    ["{#await a  /* b */}c{/await}\n", "{#await a /* b */}c{/await}\n", "{#await a}c{/await}\n"],
    ["{#await a  /* b */ then c}d{/await}\n", "{#await a /* b */ then c}d{/await}\n", "{#await a then c}d{/await}\n"],
    [
      "{#await a then { c /* b */ }}d{/await}\n",
      "{#await a then { c /* b */ }}d{/await}\n",
      "{#await a then { c }}d{/await}\n",
    ],
    ["{#key a  /* b */}c{/key}\n", "{#key a /* b */}c{/key}\n", "{#key a}c{/key}\n"],
    ["{@debug a /* b */, c}\n", "{@debug a /* b */, c}\n", "{@debug a, c}\n"],
    ["{@debug /* b */ a}\n", "{@debug /* b */ a}\n", "{@debug a}\n"],
    ["{@debug a // b\n}\n", "{@debug a // b\n}\n", "{@debug a}\n"],
    ["<p on:click={a  /* b */}>c</p>\n", "<p on:click={a /* b */}>c</p>\n", "<p on:click={a}>c</p>\n"],
    ["<p on:click={/* b */ (a)}>c</p>\n", "<p on:click={/* b */ a}>c</p>\n", "<p on:click={a}>c</p>\n"],
    ["<p bind:a={c  /* b */}>d</p>\n", "<p bind:a={c /* b */}>d</p>\n", "<p bind:a={c}>d</p>\n"],
    ["<p bind:a={a  /* b */}>d</p>\n", "<p bind:a={a /* b */}>d</p>\n", "<p bind:a>d</p>\n"],
    [
      "<p bind:a={/* b */ (() => c, d => e)}>f</p>\n",
      "<p bind:a={/* b */ () => c, (d) => e}>f</p>\n",
      "<p bind:a={() => c, (d) => e}>f</p>\n",
    ],
    ["<p class:a={c  /* b */}>d</p>\n", "<p class:a={c /* b */}>d</p>\n", "<p class:a={c}>d</p>\n"],
    ["<p class:a={a  /* b */}>d</p>\n", "<p class:a={a /* b */}>d</p>\n", "<p class:a>d</p>\n"],
    ["<p let:a={a  /* b */}>d</p>\n", "<p let:a={a /* b */}>d</p>\n", "<p let:a>d</p>\n"],
    ["<p use:a={c  /* b */}>d</p>\n", "<p use:a={c /* b */}>d</p>\n", "<p use:a={c}>d</p>\n"],
    ["<p transition:a={c  /* b */}>d</p>\n", "<p transition:a={c /* b */}>d</p>\n", "<p transition:a={c}>d</p>\n"],
    ["<p animate:a={c  /* b */}>d</p>\n", "<p animate:a={c /* b */}>d</p>\n", "<p animate:a={c}>d</p>\n"],
    ["<p style:a={a  /* b */}>d</p>\n", "<p style:a={a /* b */}>d</p>\n", "<p style:a>d</p>\n"],
    [
      "<svelte:element this={a  /* b */}>c</svelte:element>\n",
      "<svelte:element this={a /* b */}>c</svelte:element>\n",
      "<svelte:element this={a}>c</svelte:element>\n",
    ],
    [
      '<svelte:element this={"a"  /* b */}>c</svelte:element>\n',
      '<svelte:element this={"a" /* b */}>c</svelte:element>\n',
      '<svelte:element this={"a"}>c</svelte:element>\n',
    ],
    [
      "<svelte:component this={A  /* b */} />\n",
      "<svelte:component this={A /* b */} />\n",
      "<svelte:component this={A} />\n",
    ],
    // One without a letter.
    ["{a  /* 1 */}\n", "{a /* 1 */}\n", "{a}\n"],
    ["{#if a  /* 1 */}c{/if}\n", "{#if a /* 1 */}c{/if}\n", "{#if a}c{/if}\n"],
    // What follows a `//` has to be on the next line. The plugin has some of it before the comment, which is text then.
    ["{#if a  // b\n}c{/if}\n", "{#if a // b\n}c{/if}\n", "{#if a}c{/if}\n"],
    ["{#if a // b\n && c}d{/if}\n", "{#if a && // b\n  c}d{/if}\n", "{#if a && c}d{/if} // b\n"],
    ["{#key a(c, // b\n d)}e{/key}\n", "{#key a(\n  c, // b\n  d,\n)}e{/key}\n", "{#key a(c, d)}e{/key} // b\n"],
    ["{#each a  // b\n as c}d{/each}\n", "{#each a // b\n as c}d{/each}\n", "{#each a as c}d{/each}\n"],
    ["{@const a = c // b\n}\n", "{@const a = c // b\n}\n", "{@const a = c} // b\n"],
    // So has what follows one that is on a line of its own.
    ["{a // b\n/* c */\n}\n", "{a // b\n/* c */\n}\n", "{a}\n"],
    ["{a\n/* c */\n}\n", "{a\n/* c */\n}\n", "{a}\n"],
    ["{#if a\n/* c */\n}d{/if}\n", "{#if a\n/* c */\n}d{/if}\n", "{#if a}d{/if}\n"],
    ["<p on:click={a // b\n}>c</p>\n", "<p\n  on:click={a // b\n  }\n>\n  c\n</p>\n", "<p on:click={a}>c</p>\n"],
  ];
  test.each([[{}], [{ ".prettierrc": prettierrc }], [{ ".oxfmtrc.json": oxfmtrc }]])(
    "no comment is lost: %j",
    async config => {
      const names = comments.map((_, index) => `${index}.svelte`);
      const files = (which: number) => Object.fromEntries(comments.map((it, index) => [names[index], it[which]]));
      for (const [, after, ofPlugin] of comments) expect(after).not.toBe(ofPlugin);
      const expected = { stderr: "", files: comments.map(it => it[1]), exitCode: 0 };
      expect(await format({ ...config, ...files(0) }, names)).toMatchObject(expected);
      expect(await format({ ...config, ...files(1) }, names)).toMatchObject(expected);
      const checked = await format({ ...config, ...files(0) }, names, ["--debug-check"]);
      expect(checked).toMatchObject({ stderr: "", files: comments.map(it => it[0]), exitCode: 0 });
    },
  );

  // By what is wrong with the plugin: the text, what Bun makes of it, and what the plugin makes of it. `null`: it refuses it.
  // `false`: `--debug-check` has nothing to say about that, which has more white space where there is some, or a parenthesis.
  const damaged: Record<string, [string, string, string | null, false?][]> = {
    "scripts and style sheets are where the parser finds them": [
      [
        "<script module>\n  // writes a <style> tag\n</script>\n<script>\n  let  b = 2;\n</script>\n<p>{b}</p>\n<style>\n  p{margin:0}\n</style>\n",
        "<script module>\n  // writes a <style> tag\n</script>\n\n<script>\n  let b = 2;\n</script>\n\n<p>{b}</p>\n\n<style>\n  p {\n    margin: 0;\n  }\n</style>\n",
        "<script module>\n  // writes a <style> tag\n</script>\n\n<script></script>\n\n<p>{b}</p>\n\n<style>\n  p {\n    margin: 0;\n  }\n</style>\n",
      ],
      [
        '<script lang= "ts">\n  let b:  string = ""\n</script>\n<p>{b}</p>\n',
        '<script lang="ts">\n  let b: string = "";\n</script>\n\n<p>{b}</p>\n',
        '<script lang="ts"></script>\n\n<p>{b}</p>\n',
      ],
      [
        '<p>{"<!--"}</p>\n<script>let  b=2</script>\n<!-- z -->\n',
        '<script>\n  let b = 2;\n</script>\n\n<p>{"<!--"}</p>\n<!-- z -->\n',
        '<script></script>\n\n<p>{"<!--"}</p>\n<!-- z -->\n',
      ],
      [
        '<style>b{content:"<script>"}</style>\n<p>y</p>\n<script>let  b = 2;</script>\n',
        '<script>\n  let b = 2;\n</script>\n\n<p>y</p>\n\n<style>\n  b {\n    content: "<script>";\n  }\n</style>\n',
        '<script></script>\n\n<p>y</p>\n\n<style>\n  b {\n    content: "<script>";\n  }\n</style>\n',
      ],
      [
        '<div><script type = "module">let  b = 2</script></div>\n',
        '<div>\n  <script type="module">\n    let b = 2;\n  </script>\n</div>\n',
        '<div><script type="module"></script></div>\n',
      ],
      [
        '<svelte:head><style media = "screen">b{c:d}</style></svelte:head>\n',
        '<svelte:head\n  ><style media="screen">\n    b {\n      c: d;\n    }\n  </style></svelte:head\n>\n',
        '<svelte:head><style media="screen"></style></svelte:head>\n',
      ],
      [
        '<!-- prettier-ignore -->\n<svelte:head>\n  <script\n    src="y"\n    async>let b = 2;</script>\n</svelte:head>\n',
        '<!-- prettier-ignore -->\n<svelte:head>\n  <script\n    src="y"\n    async>let b = 2;</script>\n</svelte:head>\n',
        '<!-- prettier-ignore -->\n<svelte:head>\n  <script\n    src="y"\n    async ✂prettier:content✂="0">{}</script>\n</svelte:head>\n',
      ],
      [
        '{@html `<script\n  type="application/ld+json">${JSON.stringify(data)}</script>`}\n',
        '{@html `<script\n  type="application/ld+json">${JSON.stringify(data)}</script>`}\n',
        '{@html `<script\n  type="application/ld+json" ✂prettier:content✂="0">{}</script>`}\n',
      ],
      [
        "<textarea><style>b</style></textarea>\n",
        "<textarea><style>b</style></textarea>\n",
        '<textarea><style ✂prettier:content✂="0"></style></textarea>\n',
      ],
      [
        "<div /* <script>y</script> */ b>y</div>\n",
        "<div /* <script>y</script> */ b>y</div>\n",
        '<div /* <script ✂prettier:content✂="0">{}</script> */ b>y</div>\n',
      ],
      [
        '<template lang="pug">\np\n  <script>b</script>\n</template>\n',
        '<template lang="pug">\np\n  <script>b</script>\n</template>\n',
        '<template lang="pug">\np\n  <script ✂prettier:content✂="0">{}</script>\n</template>\n',
      ],
      ["{`<script>y</script\n>`}\n", "{`<script>y</script\n>`}\n", "{`<script>y</script>`}\n"],
      ["<p>{'<script>b</script>'}</p>\n", '<p>{"<script>b</script>"}</p>\n', '<p>{"<script>b</script>"}</p>\n'],
      ['{@html "<style>" + css + "</style>"}\n', '{@html "<style>" + css + "</style>"}\n', null],
      [
        '<iframe srcdoc="<style>b</style><p>y</p>" title="u"></iframe>\n',
        '<iframe srcdoc="<style>b</style><p>y</p>" title="u"></iframe>\n',
        null,
      ],
      ['<style lang= "scss">b{c:d}</style>\n', '<style lang="scss">\n  b {\n    c: d;\n  }\n</style>\n', null],
    ],
    "a comment next to a script takes nothing with it": [
      [
        "<!-- d --><script>let b</script>\n<div>kept</div>\n",
        "<!-- d -->\n<script>\n  let b;\n</script>\n\n<div>kept</div>\n",
        "<!-- d -->\n<script>\n  let b;\n</script>\n",
      ],
      [
        "<h1>first</h1>\n<p>second</p><!-- d --><style>b{c:d}</style>\n",
        "<h1>first</h1>\n<p>second</p>\n\n<!-- d -->\n<style>\n  b {\n    c: d;\n  }\n</style>\n",
        "<h1>first</h1>\n\n<!-- d -->\n<style>\n  b {\n    c: d;\n  }\n</style>\n",
      ],
      [
        "kept <!-- d --><script></script>\n",
        "<!-- d -->\n<script></script>\n\nkept\n",
        "<!-- d -->\n<script></script>\n",
      ],
      [
        "<p>first</p>\n<p>second</p>\n<!-- d --><!-- e --><script></script>\n",
        "<!-- d -->\n<!-- e -->\n<script></script>\n\n<p>first</p>\n<p>second</p>\n",
        "<!-- d -->\n<!-- e -->\n<script></script>\n\n<p>first</p>\n",
      ],
    ],
    "white space that is text stays": [
      ["<div>y</div>\nsome <b>words</b>\n", "<div>y</div>\nsome <b>words</b>\n", "<div>y</div>\nsome<b>words</b>\n"],
      [
        '<div>\n  <p>y</p>\n  See <a href="z">that</a>.\n</div>\n',
        '<div>\n  <p>y</p>\n  See <a href="z">that</a>.\n</div>\n',
        '<div>\n  <p>y</p>\n  See<a href="z">that</a>.\n</div>\n',
      ],
      ["<hr>some <i>words</i>\n", "<hr />\nsome <i>words</i>\n", "<hr />\nsome<i>words</i>\n"],
      [
        "b <script>let y</script>c\n",
        "<script>\n  let y;\n</script>\n\nb c\n",
        "<script>\n  let y;\n</script>\n\nbc\n",
      ],
      ["b <style></style>c\n", "b c\n\n<style></style>\n", "bc\n\n<style></style>\n"],
      ["b <svelte:options runes />c\n", "<svelte:options runes />\n\nb c\n", "<svelte:options runes />\n\nbc\n"],
      ["<b>y</b> <script></script>c\n", "<script></script>\n\n<b>y</b> c\n", "<script></script>\n\n<b>y</b>c\n"],
      ["\u00A0b\n", "\u00A0b\n", "b\n"],
      ["\u2028b\n", "\u2028b\n", "b\n"],
      // At the end of the file it would be nothing to Svelte, which has `trimEnd()`.
      ["b\u00A0<script></script>\n", "<script></script>\n\nb&nbsp;\n", "<script></script>\n\nb\u00A0\n"],
      ["b\u2028<script></script>\n", "<script></script>\n\nb&#x2028;\n", "<script></script>\n\nb\u2028\n"],
      ["b\u00A0<style></style>\n", "b\u00A0\n\n<style></style>\n", null],
      // At the start of the file it would be a byte order mark.
      ["\n\uFEFFb\n", "&#xFEFF;b\n", "b\n"],
      // What goes with a comment that goes with a script.
      [
        "b<!-- d -->\n<script></script>c\n",
        "<!-- d -->\n<script></script>\n\nb c\n",
        "<!-- d -->\n<script></script>\n\nbc\n",
      ],
      [
        "<b>y</b><!-- d -->\n<script></script><i>z</i>\n",
        "<!-- d -->\n<script></script>\n\n<b>y</b>\n<i>z</i>\n",
        "<!-- d -->\n<script></script>\n\n<b>y</b><i>z</i>\n",
      ],
      [
        "b<script></script> <!-- #endregion -->c\n",
        "<script></script>\n\n<!-- #endregion -->\n\nb c\n",
        "<script></script>\n\n<!-- #endregion -->\n\nbc\n",
      ],
      [
        "b<!-- d --> <svelte:options runes />c\n",
        "<!-- d -->\n<svelte:options runes />\n\nb c\n",
        "<!-- d -->\n<svelte:options runes />\n\nbc\n",
      ],
      [
        "<pre><span>let</span><span> </span><span>y</span></pre>\n",
        "<pre><span>let</span><span> </span><span>y</span></pre>\n",
        "<pre><span>let</span><span></span><span>y</span></pre>\n",
      ],
      [
        "<pre>{#each rows as row}\n{row}\n{/each}</pre>\n",
        "<pre>{#each rows as row}\n{row}\n{/each}</pre>\n",
        "<pre>{#each rows as row}\n    {row}\n  {/each}</pre>\n",
      ],
      [
        "<pre>{#if b}\n  c\n{:else}\n  d\n{/if}</pre>\n",
        "<pre>{#if b}\n  c\n{:else}\n  d\n{/if}</pre>\n",
        "<pre>{#if b}\n    c\n  {:else}\n    d\n  {/if}</pre>\n",
      ],
      ["<pre> </pre>\n", "<pre> </pre>\n", "<pre></pre>\n"],
      ["<textarea> </textarea>\n", "<textarea> </textarea>\n", "<textarea></textarea>\n"],
      ["<pre>\n\n</pre>\n", "<pre>\n\n</pre>\n", "<pre></pre>\n"],
    ],
    "what is ignored is there once, and is the same with every run": [
      [
        "<!-- prettier-ignore -->\nwords\n<style>b{c:d}</style>\n<p>behind</p>\n",
        "<!-- prettier-ignore -->\nwords\n<p>behind</p>\n\n<style>\n  b {\n    c: d;\n  }\n</style>\n",
        "<!-- prettier-ignore -->\nwords\n<style>b{c:d}</style>\n\n<p>behind</p>\n\n<style>\n  b {\n    c: d;\n  }\n</style>\n",
      ],
      [
        "<p>\n  <!-- prettier-ignore -->\n  two   words\n</p>\n",
        "<p>\n  <!-- prettier-ignore -->\n  two   words\n</p>\n",
        "<p>\n  <!-- prettier-ignore -->\n  two   words\n\n</p>\n",
        false,
      ],
      [
        "{#if b}\n  <!-- prettier-ignore -->\n  two   words\n{/if}\n",
        "{#if b}\n  <!-- prettier-ignore -->\n  two   words\n{/if}\n",
        "{#if b}\n  <!-- prettier-ignore -->\n  two   words\n\n{/if}\n",
        false,
      ],
      [
        "<!-- prettier-ignore -->words <b>y</b>\n",
        "<!-- prettier-ignore -->words <b>y</b>\n",
        "<!-- prettier-ignore -->words  <b>y</b>\n",
        false,
      ],
      [
        "<p><!-- prettier-ignore --><script>b</script>y</p>\n",
        "<p>\n  <!-- prettier-ignore --><script>\nb\n  </script>y\n</p>\n",
        "<p>\n  <!-- prettier-ignore --><script>\nb\n  </script>y\n</p>\n",
      ],
      [
        "<table>\n<tr><td>b\n<tr><td>c\n</table>\n",
        "<table>\n  <tr><td>b\n<tr><td>c\n</table>\n",
        "<table>\n  <tr><td>b\n<tr><td>c\n\n</table>\n",
        false,
      ],
      [
        "<ul>\n<!-- prettier-ignore -->\n<li>b\n<li>c\n</ul>\n",
        "<ul>\n  <!-- prettier-ignore -->\n  <li>b\n  <li>c</li>\n</ul>\n",
        "<ul>\n  <!-- prettier-ignore -->\n  <li>b\n\n  <li>c</li>\n</ul>\n",
        false,
      ],
    ],
    "comments in a start tag": [
      ["<div /* d */>y</div>\n", "<div /* d */>y</div>\n", "<div>y</div>\n"],
      ["<B\n  // d\n/>\n", "<B\n  // d\n/>\n", "<B />\n"],
      ['<div\n  b="c"\n  // y > z\n>y</div>\n', '<div\n  b="c"\n  // y > z\n>\n  y\n</div>\n', '<div b="c">y</div>\n'],
      ["<svelte:options runes /* d */ />\n", "<svelte:options runes /* d */ />\n", "<svelte:options runes />\n"],
      ['<span b="c" // d\n>y</span>\n', '<span\n  b="c" // d\n>y</span\n>\n', '<span\n  b="c">y</span // d\n>\n'],
      ['<pre b="c" // d\n>y</pre>\n', '<pre\n  b="c" // d\n>y</pre>\n', '<pre\n  b="c">y</pre> // d\n'],
      ["<span // d\n>y</span>\n", "<span\n  // d\n>y</span\n>\n", "<span>y</span>\n"],
    ],
    "what is written is not left out": [
      [
        '<svelte:element this="h{level}">y</svelte:element>\n',
        '<svelte:element this="h{level}">y</svelte:element>\n',
        '<svelte:element this="h">y</svelte:element>\n',
      ],
      [
        "<div use:b|c={d} bind:e|f={g} class:h|i={j} let:k|l={m} animate:n|o={p}></div>\n",
        "<div use:b|c={d} bind:e|f={g} class:h|i={j} let:k|l={m} animate:n|o={p}></div>\n",
        "<div use:b={d} bind:e={g} class:h={j} let:k={m} animate:n={p}></div>\n",
      ],
      ["<input bind:value|b />\n", "<input bind:value|b />\n", "<input bind:value={value | b} />\n"],
      ["{#await b}c{:catch}{/await}\n", "{#await b}c{:catch}{/await}\n", "{#await b}c{/await}\n"],
      ["{#await b}c{:catch d} {/await}\n", "{#await b}c{:catch d}{/await}\n", "{#await b}c{/await}\n"],
      ["{#await b catch d}{/await}\n", "{#await b catch d}{/await}\n", "{#await b}{/await}\n"],
    ],
    "what is printed can be parsed": [
      ["{(/b/).test(c)}\n", "{(/b/.test(c))}\n", "{/b/.test(c)}\n"],
      ["{(/b/g)}\n", "{(/b/g)}\n", "{/b/g}\n"],
      // One that is printed as it is written, because it has no such flag.
      ["{(/b/c)}\n", "{(/b/c)}\n", "{/b/c}\n"],
      // To Svelte this says that the markup is TypeScript, to the plugin it does not.
      [
        '<script data-lang="ts"></script>\n\n{f<string>(a)}\n',
        '<script data-lang="ts"></script>\n\n{f<string>(a)}\n',
        '<script data-lang="ts"></script>\n\n{f < string > a}\n',
        false,
      ],
      ["{(/b/).test(c) ? 1 : 2}\n", "{(/b/.test(c) ? 1 : 2)}\n", "{/b/.test(c) ? 1 : 2}\n"],
      ["{(@b class {})}\n", "{(@b\nclass {})}\n", "{@b\nclass {}}\n"],
      ["{(let)[0]}\n", "{(let[0])}\n", "{let[0]}\n"],
      [
        "<a bind:b={/* d */ () => c, (v) => c = v} />\n",
        "<a bind:b={/* d */ () => c, (v) => (c = v)} />\n",
        "<a bind:b={/* d */ (() => c, (v) => (c = v))} />\n",
        false,
      ],
      ["{#each  b=1}y{/each}\n", "{#each b = 1}y{/each}\n", "{#each (b = 1)}y{/each}\n"],
    ],
    "a default that the plugin throws for": [
      ["{#each b as { c = -1 }}{c}{/each}\n", "{#each b as { c = -1 }}{c}{/each}\n", null],
      ["{#each b as { c = d() }}{c}{/each}\n", "{#each b as { c = d() }}{c}{/each}\n", null],
      ["{#each b as [c  =  d.e, f = !g]}{c}{/each}\n", "{#each b as [c = d.e, f = !g]}{c}{/each}\n", null],
      ["{#await b then { c = `d` }}{c}{/await}\n", "{#await b then { c = `d` }}{c}{/await}\n", null],
      ["{#await b}y{:catch { c = d ?? e }}{c}{/await}\n", "{#await b}y{:catch { c = d ?? e }}{c}{/await}\n", null],
      [
        "{#each b as { c = [-1], d = { e: f() } }}{c}{/each}\n",
        "{#each b as { c = [-1], d = { e: f() } }}{c}{/each}\n",
        null,
      ],
      ["{#each b as { c = (d, e) }}{c}{/each}\n", "{#each b as { c = (d, e) }}{c}{/each}\n", null],
    ],
  };
  const typescript = '<script lang="ts"></script>\n\n';
  // By what Svelte is strict about: the text, what Bun makes of it, and what must not become of it, which Svelte refuses or
  // reads as something else. `null`: nothing in particular.
  const strict: typeof damaged = {
    "no comment is behind a declaration": [
      ["{const sum = (b // c\n)}\n", "{const sum = (b // c\n)}\n", "{const sum =\n  b // c\n}\n"],
      ["{const sum = // c\n  1}\n", "{const sum = // c\n  1}\n", "{const sum = 1 // c\n}\n"],
      ["{let sum = (b /* c */)}\n", "{let sum = (b /* c */)}\n", "{let sum = b /* c */}\n"],
      ["{const sum = b + (c /* d */)}\n", "{const sum = b + (c /* d */)}\n", "{const sum = b + c /* d */}\n"],
      ["{let sum /* c */;}\n", "{let sum /* c */;}\n", "{let sum /* c */}\n"],
      [
        `${typescript}{const sum = b as C[/* d */]}\n`,
        `${typescript}{const sum = b as C[/* d */]}\n`,
        `${typescript}{const sum = b as C[] /* d */}\n`,
      ],
      // This one stays where it is: something follows it that does not close anything.
      ["{const  sum = [1 /* c */,2]}\n", "{const sum = [1 /* c */, 2]}\n", null],
    ],
    "no comment is behind the expression of an each block without `as`": [
      ["{#each rows[0 // c\n]}y{/each}\n", "{#each rows[0 // c\n]}y{/each}\n", "{#each rows[0] // c\n}y{/each}\n"],
      [
        "{#each rows[0 // c\n], i}y{/each}\n",
        "{#each rows[0 // c\n], i}y{/each}\n",
        "{#each rows[0] // c\n, i}y{/each}\n",
      ],
      ["{#each b + (c /* d */)}y{/each}\n", "{#each b + (c /* d */)}y{/each}\n", "{#each b + c /* d */}y{/each}\n"],
      ["{#each  f(b /* c */)}y{/each}\n", "{#each f(b /* c */)}y{/each}\n", null],
    ],
    "an each block without `as` gets none": [
      [
        `${typescript}{#each (b: C) => (b as D)}y{/each}\n`,
        `${typescript}{#each (b: C) => (b as D)}y{/each}\n`,
        `${typescript}{#each (b: C) => b as D}y{/each}\n`,
      ],
      [
        `${typescript}{#each b = (c as D), i}y{/each}\n`,
        `${typescript}{#each b = (c as D), i}y{/each}\n`,
        `${typescript}{#each b = c as D, i}y{/each}\n`,
      ],
      // With one of its own, the last is that.
      [
        `${typescript}{#each (b: C) => (b as D) as e}y{/each}\n`,
        `${typescript}{#each (b: C) => b as D as e}y{/each}\n`,
        null,
      ],
    ],
    "no comment is behind the name of a snippet": [
      [
        "{#snippet row(/* c */\n  b)}y{/snippet}\n",
        "{#snippet row(/* c */\n  b)}y{/snippet}\n",
        "{#snippet row /* c */(b)}y{/snippet}\n",
      ],
      [
        `${typescript}{#snippet row</* c */\n  T>(b: T)}y{/snippet}\n`,
        `${typescript}{#snippet row</* c */\n  T>(b: T)}y{/snippet}\n`,
        `${typescript}{#snippet row /* c */<T>(b: T)}y{/snippet}\n`,
      ],
      // The line ends behind another comment.
      [
        "{#snippet row(/* c */ // d\n  b)}y{/snippet}\n",
        "{#snippet row(/* c */ // d\n  b)}y{/snippet}\n",
        "{#snippet row /* c */( // d\n  b,\n)}y{/snippet}\n",
      ],
      ["{#snippet  row(b   /* c */)}y{/snippet}\n", "{#snippet row(b /* c */)}y{/snippet}\n", null],
      // On a line of its own it is printed before the parameter.
      ["{#snippet row(\n  /* c */\n  b)}y{/snippet}\n", "{#snippet row(\n  /* c */\n  b,\n)}y{/snippet}\n", null],
      [
        "{#snippet row(\n  /** c */\n  b, d)}y{/snippet}\n",
        "{#snippet row(\n  /** c */\n  b,\n  d,\n)}y{/snippet}\n",
        null,
      ],
      [
        "{#snippet row(\n/* c */ // d\n b)}y{/snippet}\n",
        "{#snippet row(\n  /* c */ // d\n  b,\n)}y{/snippet}\n",
        null,
      ],
    ],
    "no comment is behind the parameters of a snippet": [
      // The only parameter is a pattern, so no line ends before the `)`.
      [
        "{#snippet row({ b } // c\n = {})}y{/snippet}\n",
        "{#snippet row({ b } // c\n = {})}y{/snippet}\n",
        "{#snippet row({\n  b,\n} = {}) // c\n}y{/snippet}\n",
      ],
      [
        "{#snippet row([b] = // c\n [])}y{/snippet}\n",
        "{#snippet row([b] = // c\n [])}y{/snippet}\n",
        "{#snippet row([\n  b,\n] = []) // c\n}y{/snippet}\n",
      ],
      [
        `${typescript}{#snippet row({ b } // c\n : D)}y{/snippet}\n`,
        `${typescript}{#snippet row({ b } // c\n : D)}y{/snippet}\n`,
        `${typescript}{#snippet row({\n  b,\n}: D) // c\n}y{/snippet}\n`,
      ],
      [
        `${typescript}{#snippet row({ b }: D[E // c\n])}y{/snippet}\n`,
        `${typescript}{#snippet row({ b }: D[E // c\n])}y{/snippet}\n`,
        `${typescript}{#snippet row({\n  b,\n}: D[E]) // c\n}y{/snippet}\n`,
      ],
      // With a second one there is a line for it.
      [
        "{#snippet row(\n  { b }   = {}, // c\n  d,\n)}y{/snippet}\n",
        "{#snippet row(\n  { b } = {}, // c\n  d,\n)}y{/snippet}\n",
        null,
      ],
      // So there is behind the parameter, which is not hugged then, and between its brackets and braces.
      ["{#snippet row({ b } // c\n)}y{/snippet}\n", "{#snippet row(\n  { b }, // c\n)}y{/snippet}\n", null],
      [
        "{#snippet row({\n  id,   // the id\n  name,\n})}\n<p>y</p>\n{/snippet}\n",
        "{#snippet row({\n  id, // the id\n  name,\n})}\n  <p>y</p>\n{/snippet}\n",
        null,
      ],
      [
        "{#snippet row({\n  /** The id. */\n  id,\n    name,\n})}\n<p>y</p>\n{/snippet}\n",
        "{#snippet row({\n  /** The id. */\n  id,\n  name,\n})}\n  <p>y</p>\n{/snippet}\n",
        null,
      ],
      [
        "{#snippet row([\n  id,   // the id\n  name,\n])}\n<p>y</p>\n{/snippet}\n",
        "{#snippet row([\n  id, // the id\n  name,\n])}\n  <p>y</p>\n{/snippet}\n",
        null,
      ],
      [
        `${typescript}{#snippet row({ id, name }: {\n  id: string;   // the id\n  name: string;\n})}\n<p>y</p>\n{/snippet}\n`,
        `${typescript}{#snippet row({\n  id,\n  name,\n}: {\n  id: string; // the id\n  name: string;\n})}\n  <p>y</p>\n{/snippet}\n`,
        null,
      ],
    ],
    "a comment that Prettier moves each time stays where it is in the head of a snippet": [
      [
        `${typescript}{#snippet row(b = // c\n(d as E).f)}y{/snippet}\n`,
        `${typescript}{#snippet row(b = // c\n(d as E).f)}y{/snippet}\n`,
        null,
      ],
      [
        `${typescript}{#snippet row({ b = // c\n(d as E)[0] })}y{/snippet}\n`,
        `${typescript}{#snippet row({ b = // c\n(d as E)[0] })}y{/snippet}\n`,
        null,
      ],
      // These it does not move.
      ["{#snippet row(b = // c\n (1))}y{/snippet}\n", "{#snippet row(\n  b = 1, // c\n)}y{/snippet}\n", null],
      [
        "{#snippet row(b = c == // d\n (1))}y{/snippet}\n",
        "{#snippet row(\n  b = c == // d\n    1,\n)}y{/snippet}\n",
        null,
      ],
    ],
    "a vertical tab next to a comment is white space": [
      [
        "{#snippet row(b\v/* c */)}y{/snippet}\n",
        "{#snippet row(b /* c */)}y{/snippet}\n",
        "{#snippet row(b)}y{/snippet}\n",
      ],
      [
        "{#snippet row(/* c */\vb)}y{/snippet}\n",
        "{#snippet row(/* c */ b)}y{/snippet}\n",
        "{#snippet row /* c */(b)}y{/snippet}\n",
      ],
      [
        "{#if b}{@const c = /* d */\ve}{/if}\n",
        "{#if b}{@const c = /* d */ e}{/if}\n",
        "{#if b}{@const c /* d */ = e}{/if}\n",
      ],
    ],
    "a `{:then}` with nothing in it stays if there is a comment in its head": [
      // What the plugin prints is the third.
      [
        "{#await b}wait{:then { c /* d */ }}{/await}\n",
        "{#await b}wait{:then { c /* d */ }}{/await}\n",
        "{#await b}wait{/await}\n",
      ],
      ["{#await b then { c /* d */ }}{/await}\n", "{#await b then { c /* d */ }}{/await}\n", "{#await b}{/await}\n"],
      [
        "{#await b then { c /* d */ }}  {:catch e}y{/await}\n",
        "{#await b then { c /* d */ }}{:catch e}y{/await}\n",
        "{#await b catch e}y{/await}\n",
      ],
      [
        `${typescript}{#await b}wait{:then c: /* d */ E}{/await}\n`,
        `${typescript}{#await b}wait{:then c: /* d */ E}{/await}\n`,
        `${typescript}{#await b}wait{/await}\n`,
      ],
      [
        `${typescript}{#await b}wait{:then c: E</* d */ F>}{/await}\n`,
        `${typescript}{#await b}wait{:then c: E</* d */ F>}{/await}\n`,
        `${typescript}{#await b}wait{/await}\n`,
      ],
      // Without one it goes as before.
      ["{#await b}wait{:then c}{/await}\n", "{#await b}wait{/await}\n", null],
      ["{#await b}wait{:then { c = 1 / 2 }}{/await}\n", "{#await b}wait{/await}\n", null],
      ["{#await b}wait{:then { c = /d/ }}{/await}\n", "{#await b}wait{/await}\n", null],
      ['{#await b}wait{:then { c = "/* d */" }}{/await}\n', "{#await b}wait{/await}\n", null],
      ["{#await b then { c = `// d` }}{/await}\n", "{#await b}{/await}\n", null],
      [`${typescript}{#await b}wait{:then c: "d/e"}{/await}\n`, `${typescript}{#await b}wait{/await}\n`, null],
    ],
    "the parameters of a snippet end where their parentheses do": [
      [
        "{#snippet row(b /* () */)}y{/snippet}\n",
        "{#snippet row(b /* () */)}y{/snippet}\n",
        "{#snippet row(b /* ()}y{/snippet}\n",
      ],
    ],
    "a comment before a type": [
      [
        `${typescript}{#each rows as row : /* c */ T}y{/each}\n`,
        `${typescript}{#each rows as row: /* c */ T}y{/each}\n`,
        `${typescript}{#each rows as row : /* c */: T}y{/each}\n`,
      ],
      [
        `${typescript}{#each rows as row : // c\n  T}y{/each}\n`,
        `${typescript}{#each rows as row: // c\n  T}y{/each}\n`,
        `${typescript}{#each rows as row : // c: T}y{/each}\n`,
      ],
      [
        `${typescript}{#each rows as { b } : /* c */ T}y{/each}\n`,
        `${typescript}{#each rows as { b }: /* c */ T}y{/each}\n`,
        // What the plugin prints.
        `${typescript}{#each rows as { b }: T}y{/each}\n`,
      ],
      [
        `${typescript}{#await b then row : /* c */ T}y{/await}\n`,
        `${typescript}{#await b then row: /* c */ T}y{/await}\n`,
        `${typescript}{#await b then row : /* c */: T}y{/await}\n`,
      ],
      [
        `${typescript}{#await b}y{:then row : /* c */ T}z{:catch e : /* d */ U}w{/await}\n`,
        `${typescript}{#await b}y{:then row: /* c */ T}z{:catch e: /* d */ U}w{/await}\n`,
        `${typescript}{#await b}y{:then row : /* c */: T}z{:catch e : /* d */: U}w{/await}\n`,
      ],
    ],
    "the string of `this` keeps its quotes": [
      [
        "<svelte:element this={'b\"c'}>y</svelte:element>\n",
        "<svelte:element this={'b\"c'}>y</svelte:element>\n",
        // What the plugin prints.
        '<svelte:element this={"b"c"}>y</svelte:element>\n',
      ],
      [
        "<svelte:element this={'b\\'c'}>y</svelte:element>\n",
        '<svelte:element this={"b\'c"}>y</svelte:element>\n',
        null,
      ],
      [
        "<svelte:element this='b\"c'>y</svelte:element>\n",
        "<svelte:element this='b\"c'>y</svelte:element>\n",
        '<svelte:element this="b"c">y</svelte:element>\n',
      ],
      ["<svelte:element this={'b'}>y</svelte:element>\n", '<svelte:element this={"b"}>y</svelte:element>\n', null],
      // Not right behind the `{`, the plugin makes a text of the string.
      ["<svelte:element this={ 'b' }>y</svelte:element>\n", '<svelte:element this="b">y</svelte:element>\n', null],
      [
        "<svelte:element this={ 'b\"c' }>y</svelte:element>\n",
        "<svelte:element this={'b\"c'}>y</svelte:element>\n",
        '<svelte:element this="b"c">y</svelte:element>\n',
      ],
      [
        "<svelte:element this={('b\"c')}>y</svelte:element>\n",
        "<svelte:element this={'b\"c'}>y</svelte:element>\n",
        '<svelte:element this=b"c>y</svelte:element>\n',
      ],
      [
        "<svelte:element this={\n  'b\"c'}>y</svelte:element>\n",
        "<svelte:element this={'b\"c'}>y</svelte:element>\n",
        '<svelte:element this=b"c>y</svelte:element>\n',
      ],
      // One backslash in the string would be two in the text, and an entity in the text is none in the string.
      [
        '<svelte:element this={ "b\\\\c" }>y</svelte:element>\n',
        '<svelte:element this={"b\\\\c"}>y</svelte:element>\n',
        '<svelte:element this="b\\\\c">y</svelte:element>\n',
      ],
      [
        '<svelte:element this={ "b&amp;c" }>y</svelte:element>\n',
        '<svelte:element this={"b&amp;c"}>y</svelte:element>\n',
        '<svelte:element this="b&amp;c">y</svelte:element>\n',
      ],
    ],
    "a value with a comment in it is not left out": [
      // What the plugin prints is the third.
      ["<Row item={/* keep */ item} />\n", "<Row item={/* keep */ item} />\n", "<Row {item} />\n"],
      [
        "<Row\n  item={\n    // keep this\n    item\n  }\n/>\n",
        "<Row\n  item={// keep this\n  item}\n/>\n",
        "<Row {item} />\n",
      ],
      ["<Row item={/** @type {Item} */ item} />\n", "<Row item={/** @type {Item} */ item} />\n", "<Row {item} />\n"],
      ['<Row item="{/* c */ item}" />\n', "<Row item={/* c */ item} />\n", "<Row {item} />\n"],
      ["<input bind:value={/* c */ value} />\n", "<input bind:value={/* c */ value} />\n", "<input bind:value />\n"],
      [
        "<p class:on={/* c */ on} style:top={/* d */ top}>y</p>\n",
        "<p class:on={/* c */ on} style:top={/* d */ top}>y</p>\n",
        "<p class:on style:top>y</p>\n",
      ],
      ["<Row let:item={/* c */ item} />\n", "<Row let:item={/* c */ item} />\n", "<Row let:item />\n"],
      [
        '<svelte:element this={/* c */ "b"}>y</svelte:element>\n',
        '<svelte:element this={/* c */ "b"}>y</svelte:element>\n',
        '<svelte:element this="b">y</svelte:element>\n',
      ],
      // The parentheses go, the comment does not go with them the next time.
      ["<Row item={/* c */ (item)} />\n", "<Row item={/* c */ item} />\n", "<Row {item} />\n"],
      // Without a comment it is left out as before.
      ["<Row item={ (item) } />\n", "<Row {item} />\n", null],
    ],
    "a declaration ends behind its `;`": [
      ["{const sum = 1;}\n", "{const sum = 1}\n", null],
      ["{let sum ;}\n", "{let sum}\n", null],
    ],
    "a script that is not code stays as it is": [
      [
        '<script type="text/template"><p   >{{b}}</p></script>\n',
        '<script type="text/template"><p   >{{b}}</p></script>\n',
        // What the plugin prints: it is JSX.
        '<script type="text/template">\n  <p>{{ b }}</p>;\n</script>\n',
        false,
      ],
      [
        '<div><script type="text/x-template">\n  <b   >{{c}}</b>\n</script></div>\n',
        '<div>\n  <script type="text/x-template">\n  <b   >{{c}}</b>\n</script>\n</div>\n',
        null,
      ],
      // Whether it can be read as JavaScript or not.
      [
        '<script type="math/tex">x^2 + y^2</script>\n',
        '<script type="math/tex">x^2 + y^2</script>\n',
        '<script type="math/tex">\n  x ^ (2 + y) ^ 2;\n</script>\n',
        false,
      ],
      [
        '<script type="text/yaml">a: 1\nb: 2</script>\n',
        '<script type="text/yaml">a: 1\nb: 2</script>\n',
        '<script type="text/yaml">\n  a: 1;\n  b: 2;\n</script>\n',
        false,
      ],
      [
        '<script type="text/x-mustache">{{x}}</script>\n',
        '<script type="text/x-mustache">{{x}}</script>\n',
        '<script type="text/x-mustache">\n  {\n    {\n      x;\n    }\n  }\n</script>\n',
        false,
      ],
      [
        '<script type="text/plain">hello</script>\n',
        '<script type="text/plain">hello</script>\n',
        '<script type="text/plain">\n  hello;\n</script>\n',
        false,
      ],
      [
        '<script type="x-shader/x-vertex">attribute vec4 b;</script>\n',
        '<script type="x-shader/x-vertex">attribute vec4 b;</script>\n',
        null,
      ],
      [
        '<script type="speculationrules">{"prerender":[]}</script>\n',
        '<script type="speculationrules">{"prerender":[]}</script>\n',
        null,
      ],
      // These are code.
      ...[
        "",
        "module",
        "text/javascript",
        "TEXT/JavaScript",
        "text/javascript; charset=utf-8",
        " text/javascript1.5 ",
        "text/babel",
        "text/jsx",
        "application/javascript",
        "application/x-javascript",
        "application/ecmascript",
        "application/x-ecmascript",
        "text/ecmascript",
        "text/x-ecmascript",
        "text/x-javascript",
        "text/jscript",
        "text/livescript",
        "text/partytown",
        "application/x-typescript",
        "application/typescript",
        "Text/TypeScript",
        "TS",
        "text/ts; charset=utf-8",
        "js",
        "javascript",
        "jsx",
      ].map((type): [string, string, null] => [
        `<script type="${type}">let  b=1</script>\n`,
        `<script type="${type}">\n  let b = 1;\n</script>\n`,
        null,
      ]),
      // In whatever letters the name of the attribute is written, and as a string between braces.
      ...['TYPE="math/tex"', 'type={"math/tex"}'].flatMap((type): [string, string, string, false][] => [
        [
          `<script ${type}>x^2 + y^2</script>\n`,
          `<script ${type}>x^2 + y^2</script>\n`,
          `<script ${type}>\n  x ^ (2 + y) ^ 2;\n</script>\n`,
          false,
        ],
        [
          `<p><script ${type}>x^2 + y^2</script></p>\n`,
          `<p><script ${type}>x^2 + y^2</script></p>\n`,
          `<p>\n  <script ${type}>\n    x ^ (2 + y) ^ 2;\n  </script>\n</p>\n`,
          false,
        ],
      ]),
      // What another expression gives is not known.
      ...['TYPE="module"', 'type={"module"}', "type={kind}"].map((type): [string, string, null] => [
        `<p><script ${type}>let  b=1</script></p>\n`,
        `<p>\n  <script ${type}>\n    let b = 1;\n  </script>\n</p>\n`,
        null,
      ]),
      // A `lang` counts for more.
      [
        '<script type="math/tex" lang="js">let  b=1</script>\n',
        '<script type="math/tex" lang="js">\n  let b = 1;\n</script>\n',
        null,
      ],
      [
        '<script type="application/ld+json">{"a":1}</script>\n',
        '<script type="application/ld+json">\n  { "a": 1 }\n</script>\n',
        null,
      ],
    ],
    "a style sheet ends between two rules": [
      [
        '<style>p::after{content:"</style>"}</style>\n',
        '<style>\n  p::after {\n    content: "</style>";\n  }\n</style>\n',
        null,
      ],
      [
        "<style>/* </style> */p{margin:0}</style>\n",
        "<style>\n  /* </style> */\n  p {\n    margin: 0;\n  }\n</style>\n",
        null,
      ],
      [
        '<style>p[title="</style>"]{margin:0}</style>\n',
        '<style>\n  p[title="</style>"] {\n    margin: 0;\n  }\n</style>\n',
        null,
      ],
      ['<style>@import "</style>";</style>\n', '<style>\n  @import "</style>";\n</style>\n', null],
      [
        "<style>p{background:url(</style>)}</style>\n",
        "<style>\n  p {\n    background: url(</style>);\n  }\n</style>\n",
        null,
      ],
    ],
  };
  describe.each(Object.entries({ ...damaged, ...strict }))("%s", (_, rows) => {
    const names = rows.map((_, index) => `${index}.svelte`);
    const files = (which: 0 | 1) => Object.fromEntries(rows.map((it, index) => [names[index], it[which]]));

    test.each([[{}], [{ ".prettierrc": prettierrc }], [{ ".oxfmtrc.json": oxfmtrc }]])("%j", async config => {
      const expected = { stderr: "", files: rows.map(it => it[1]), exitCode: 0 };
      expect(await format({ ...config, ...files(0) }, names)).toMatchObject(expected);
      expect(await format({ ...config, ...files(1) }, names)).toMatchObject(expected);
      const checked = await format({ ...config, ...files(0) }, names, ["--debug-check"]);
      expect(checked).toMatchObject({ stderr: "", files: rows.map(it => it[0]), exitCode: 0 });
    });

    test.skipIf(!hasRunner)("--debug-check would not let the other pass", async () => {
      const seen = rows.filter(it => it[2] !== null && it[2] !== it[1]);
      using dir = tempDir("bun-format-svelte", {
        ...Object.fromEntries(
          seen.flatMap((it, index) => it.slice(0, 3).map((text, which) => [`${index}.${which}`, text])),
        ),
      });
      // Each with what Bun prints, then with what the plugin prints.
      const pairs = seen.flatMap((_, index) => [`${index}.0`, `${index}.1`, `${index}.0`, `${index}.2`]);
      await using proc = spawn({
        cmd: [bunExe(), "fmt", "--debug-check-svelte", ...pairs],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const expected = seen.map(it => `same\n${it[3] === false ? "same" : "different"}\n`).join("");
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
    });
  });

  describe("a comment that waits for the end of the line does not get out of its expression", () => {
    // The text, what becomes of it, what becomes of that, which stays, and what must not become of the text: the comment is
    // behind the `}` there. Once the parentheses are gone the comment is behind the expression and no longer breaks it, as
    // in a file of JavaScript. `null`: these were right before. `false`: `--debug-check` has nothing to say about that, where
    // it is a comment in the tag.
    const rows: [string, string, string, string | null, false?][] = [
      [
        "<button onclick={() => (\n  total += 1 // one more\n)}>+</button>\n",
        "<button\n  onclick={() =>\n    (total += 1) // one more\n  }>+</button\n>\n",
        "<button\n  onclick={() => (total += 1) // one more\n  }>+</button\n>\n",
        "<button\n  onclick={() =>\n    (total += 1)}>+</button // one more\n>\n",
      ],
      [
        "<button onclick={() => (\n  open = true\n  // and more\n)}>Open</button>\n",
        "<button\n  onclick={() =>\n    (open = true)\n  // and more\n  }>Open</button\n>\n",
        "<button\n  onclick={() => (open = true)\n  // and more\n  }>Open</button\n>\n",
        "<button\n  onclick={() => (open = true)}>Open</button\n  // and more\n>\n",
      ],
      [
        '{#each [\n  "x",\n  "y"\n  /* "z" */\n] as it}\n  <p>{it}</p>\n{/each}\n',
        '{#each ["x", "y"]\n  /* "z" */\n as it}\n  <p>{it}</p>\n{/each}\n',
        '{#each ["x", "y"]\n/* "z" */\n as it}\n  <p>{it}</p>\n{/each}\n',
        '{#each ["x", "y"] as it}\n  /* "z" */\n  <p>{it}</p>\n{/each}\n',
      ],
      [
        "{#if test(\n  b\n  /* , c */\n)}\n  <p>y</p>\n{/if}\n",
        "{#if test(b)\n  /* , c */\n}\n  <p>y</p>\n{/if}\n",
        "{#if test(b)\n/* , c */\n}\n  <p>y</p>\n{/if}\n",
        "{#if test(b)}\n  /* , c */\n  <p>y</p>\n{/if}\n",
      ],
      [
        "<p>\n  {ok ? b : (\n    c // or else\n  )}\n</p>\n",
        "<p>\n  {ok\n    ? b\n    : c // or else\n  }\n</p>\n",
        "<p>\n  {ok ? b : c // or else\n  }\n</p>\n",
        "<p>\n  {ok ? b : c} // or else\n</p>\n",
      ],
      [
        "<B value={ok ? b : (\n  c // or else\n)} />\n",
        "<B\n  value={ok\n    ? b\n    : c // or else\n  }\n/>\n",
        "<B\n  value={ok ? b : c // or else\n  }\n/>\n",
        "<B\n  value={ok ? b : c} // or else\n/>\n",
        false,
      ],
      [
        "{#each rows as row}\n  {@const sum = (\n    row.b * row.c // both\n  )}\n  <p>{sum}</p>\n{/each}\n",
        "{#each rows as row}\n  {@const sum =\n    row.b *\n    row.c // both\n  }\n  <p>{sum}</p>\n{/each}\n",
        "{#each rows as row}\n  {@const sum = row.b * row.c // both\n  }\n  <p>{sum}</p>\n{/each}\n",
        "{#each rows as row}\n  {@const sum =\n    row.b * row.c} // both\n  <p>{sum}</p>\n{/each}\n",
      ],
      [
        "{#if q}\n  {@const z = // why\n    b + c}\n  <p>{z}</p>\n{/if}\n",
        "{#if q}\n  {@const z = // why\n    b + c}\n  <p>{z}</p>\n{/if}\n",
        "{#if q}\n  {@const z = // why\n    b + c}\n  <p>{z}</p>\n{/if}\n",
        "{#if q}\n  {@const z = b + c} // why\n  <p>{z}</p>\n{/if}\n",
      ],
      [
        "<p>\n  {list[\n    0 // the first\n  ]}\n</p>\n",
        "<p>\n  {list[0] // the first\n  }\n</p>\n",
        "<p>\n  {list[0] // the first\n  }\n</p>\n",
        "<p>\n  {list[0]} // the first\n</p>\n",
      ],
      [
        "{#snippet f(// c\n b)}y{/snippet}\n",
        "{#snippet f( // c\n  b,\n)}y{/snippet}\n",
        "{#snippet f( // c\n  b,\n)}y{/snippet}\n",
        "{#snippet f(b)}y{/snippet} // c\n",
      ],
      [
        "{#await (\n  p // q\n) then v}y{/await}\n",
        "{#await p // q\n then v}y{/await}\n",
        "{#await p // q\n then v}y{/await}\n",
        null,
      ],
      [
        '<p title="y {(\n  b // c\n)} z">w</p>\n',
        '<p\n  title="y {b // c\n  } z"\n>\n  w\n</p>\n',
        '<p\n  title="y {b // c\n  } z"\n>\n  w\n</p>\n',
        null,
      ],
      ["<pre>{(\n  b // c\n)}</pre>\n", "<pre>{b // c\n  }</pre>\n", "<pre>{b // c\n  }</pre>\n", null],
    ];
    const names = rows.map((_, index) => `${index}.svelte`);
    const files = (which: 0 | 1 | 2) => Object.fromEntries(rows.map((it, index) => [names[index], it[which]]));

    test.each([[{}], [{ ".prettierrc": prettierrc }], [{ ".oxfmtrc.json": oxfmtrc }]])("%j", async config => {
      const printed = (which: 1 | 2) => ({ stderr: "", files: rows.map(it => it[which]), exitCode: 0 });
      expect(await format({ ...config, ...files(0) }, names)).toMatchObject(printed(1));
      expect(await format({ ...config, ...files(1) }, names)).toMatchObject(printed(2));
      expect(await format({ ...config, ...files(2) }, names)).toMatchObject(printed(2));
      const checked = await format({ ...config, ...files(0) }, names, ["--debug-check"]);
      expect(checked).toMatchObject({ stderr: "", files: rows.map(it => it[0]), exitCode: 0 });
    });

    test.skipIf(!hasRunner)("--debug-check would not let it out", async () => {
      const seen = rows.filter(it => it[3] !== null);
      using dir = tempDir("bun-format-svelte", {
        ...Object.fromEntries(
          seen.flatMap((it, index) => it.slice(0, 4).map((text, which) => [`${index}.${which}`, text])),
        ),
      });
      const pairs = seen.flatMap((_, index) => [
        `${index}.0`,
        `${index}.1`,
        `${index}.0`,
        `${index}.2`,
        `${index}.0`,
        `${index}.3`,
      ]);
      await using proc = spawn({
        cmd: [bunExe(), "fmt", "--debug-check-svelte", ...pairs],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const expected = seen.map(it => `same\nsame\n${it[4] === false ? "same" : "different"}\n`).join("");
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
    });
  });

  test("a style sheet ends at the first end tag with a `lang`, or if that is not in a string, a comment or `url()`", async () => {
    const refused: [string, string][] = [
      // A preprocessor cuts it out before Svelte reads it.
      [
        '<style lang="scss">b::after{content:"</style>"}</style>\n',
        '1 | <style lang="scss">b::after{content:"</style>"}</style>\n' +
          "                                                   ^\nerror: This end tag has no start tag\n    at 0.svelte:1:48\n\n",
      ],
      [
        "<style>b{margin:0}</style>\n<i>'</style>'</i>\n",
        "2 | <i>'</style>'</i>\n        ^\nerror: This end tag has no start tag\n    at 1.svelte:2:5\n\n",
      ],
      // To Svelte this is a comment, to who formats the style sheet it is a selector.
      [
        "<style><!-- </style> -->b{margin:0}</style>\n",
        "1 | <style><!-- </style> -->b{margin:0}</style>\n" +
          '                                    ^\nerror: Expected "}"\n    at 2.svelte:1:33\n\n',
      ],
      [
        "<style>b{c:</style>}</style>\n",
        "1 | <style>b{c:</style>}</style>\n                        ^\nerror: This end tag has no start tag\n    at 3.svelte:1:21\n\n",
      ],
      // To Svelte `--c:` is a selector that is not finished.
      [
        '<style>b{--c:{d:"</style>"}}</style>\n',
        '1 | <style>b{--c:{d:"</style>"}}</style>\n                                ^\nerror: This end tag has no start tag\n    at 4.svelte:1:29\n\n',
      ],
      // In a string `url(` starts nothing, and with a quote in it `url(..)` is written anew.
      [
        '<style>b{content:"url("}c{:</style>)}</style>\n',
        '1 | <style>b{content:"url("}c{:</style>)}</style>\n                                         ^\nerror: This end tag has no start tag\n    at 5.svelte:1:38\n\n',
      ],
      [
        '<style>b{c:url(d"e"</style>)}</style>\n',
        '1 | <style>b{c:url(d"e"</style>)}</style>\n                                 ^\nerror: This end tag has no start tag\n    at 6.svelte:1:30\n\n',
      ],
      // Neither is `url(..)`.
      [
        "<style>b{@url(</style>)}</style>\n",
        "1 | <style>b{@url(</style>)}</style>\n                            ^\nerror: This end tag has no start tag\n    at 7.svelte:1:25\n\n",
      ],
      [
        "<style>b{curl(</style>)}</style>\n",
        "1 | <style>b{curl(</style>)}</style>\n                            ^\nerror: This end tag has no start tag\n    at 8.svelte:1:25\n\n",
      ],
    ];
    const names = refused.map((_, index) => `${index}.svelte`);
    const files = Object.fromEntries(refused.map((it, index) => [names[index], it[0]]));
    expect(await format(files, names, ["--threads=1"])).toMatchObject({
      stderr: refused.map(it => it[1]).join(""),
      files: refused.map(it => it[0]),
      exitCode: 2,
    });

    const formatted: [string, string][] = [
      // The same as the first above, without the `lang`.
      [
        '<style>b::after{content:"</style>"}</style>\n',
        '<style>\n  b::after {\n    content: "</style>";\n  }\n</style>\n',
      ],
      // An apostrophe in a comment of SCSS starts nothing.
      [
        "<style lang=\"scss\">// don't\nb{margin:0}</style>\n<p>it's</p>\n",
        "<p>it's</p>\n\n<style lang=\"scss\">\n  // don't\n  b {\n    margin: 0;\n  }\n</style>\n",
      ],
      [
        "<style>@media (width<600px){b{margin:0}}</style>\n",
        "<style>\n  @media (width<600px) {\n    b {\n      margin: 0;\n    }\n  }\n</style>\n",
      ],
      // What cannot be read stays as it is, up to the first end tag.
      ["<style>b{margin:0</style>\n<p>y</p>\n", "<p>y</p>\n\n<style>\nb{margin:0\n</style>\n"],
      [
        "<style>b</style>\n<p>{c}</p>\n<svelte:head><style>d{margin:0}</style></svelte:head>\n",
        "<p>{c}</p>\n<svelte:head\n  ><style>\n    d {\n      margin: 0;\n    }\n  </style></svelte:head\n>\n\n<style>\nb\n</style>\n",
      ],
      // What is not closed does not go on in the markup, up to what closes it there and to the end of another style sheet.
      [
        "<style>\n  b { background: url(it's.png) }\n</style>\n<p>don't</p>\n<svg><style>c:d}</style></svg>\n",
        "<p>don't</p>\n<svg\n  ><style>\nc:d}\n  </style></svg\n>\n\n<style>\n  b {\n    background: url(it's.png);\n  }\n</style>\n",
      ],
      [
        "<style>\n  b { content: 'c }\n</style>\n<p>don't</p>\n<svg><style>d}</style></svg>\n",
        "<p>don't</p>\n<svg\n  ><style>\nd}\n  </style></svg\n>\n\n<style>\n  b { content: 'c }\n</style>\n",
      ],
      [
        "<style>\n  b { background: url(c\n</style>\n<p>y</p>\n<div><style>d) }</style></div>\n",
        "<p>y</p>\n<div>\n  <style>\nd) }\n  </style>\n</div>\n\n<style>\n  b { background: url(c\n</style>\n",
      ],
      [
        "<style>\n  /* b\n</style>\n<p>y</p>\n<svg><style>c */d{e:f}</style></svg>\n",
        "<p>y</p>\n<svg\n  ><style>\n    c */d {\n      e: f;\n    }\n  </style></svg\n>\n\n<style>\n  /* b\n</style>\n",
      ],
      ["<style>b{c:url( '</style>' )}</style>\n", '<style>\n  b {\n    c: url("</style>");\n  }\n</style>\n'],
      // A string goes on in the next line behind a backslash.
      [
        '<style>b{content:"c\\\nd </style>"}</style>\n',
        '<style>\n  b {\n    content: "c\\\nd </style>";\n  }\n</style>\n',
      ],
    ];
    const others = formatted.map((_, index) => `${index}.svelte`);
    const texts = Object.fromEntries(formatted.map((it, index) => [others[index], it[0]]));
    expect(await format(texts, others, ["--threads=1"])).toMatchObject({
      stderr:
        "1 | <style>b{margin:0</style>\n           ^\nwarn: Unclosed block\n   at 3.svelte:1:8\n\n" +
        "1 | <style>b</style>\n           ^\nwarn: Expected a declaration or a rule\n   at 4.svelte:1:8\n\n" +
        '5 | <svg><style>c:d}</style></svg>\n                   ^\nwarn: Unexpected "}"\n   at 5.svelte:5:16\n\n' +
        "2 |   b { content: 'c }\n                   ^\nwarn: Unclosed string\n   at 6.svelte:2:16\n\n" +
        "5 | <svg><style>d}</style></svg>\n                ^\nwarn: Expected a declaration or a rule\n   at 6.svelte:5:13\n\n" +
        "2 |   b { background: url(c\n                         ^\nwarn: Unclosed bracket\n   at 7.svelte:2:22\n\n" +
        "5 | <div><style>d) }</style></div>\n                ^\nwarn: Expected a declaration or a rule\n   at 7.svelte:5:13\n\n" +
        "2 |   /* b\n      ^\nwarn: Unclosed comment\n   at 8.svelte:2:3\n\n",
      files: formatted.map(it => it[1]),
      exitCode: 0,
    });
  });

  describe("every comment next to a value that is named like its attribute is kept", () => {
    const sites = [
      "<Row b={V} />",
      "<a b={V}>y</a>",
      '<a b="{V}">y</a>',
      "<input bind:b={V} />",
      "<a class:b={V}>y</a>",
      "<a style:b={V}>y</a>",
      '<a style:b="{V}">y</a>',
      "<Row let:b={V} />",
      "<svelte:element this={V}>y</svelte:element>",
      "<a on:b={V}>y</a>",
      "<a use:b={V}>y</a>",
    ];
    const forms = [
      "/* C1 */ b",
      "/* C1 */b",
      "/** C1 */ b",
      "// C1\nb",
      "\n// C1\nb\n",
      "/* C1 */\nb",
      "\n/* C1 */\nb",
      "b /* C1 */",
      "b/* C1 */",
      "b // C1\n",
      "b\n// C1\n",
      "b\n/* C1 */\n",
      "/* C1 */ (b)",
      "(/* C1 */ b)",
      "(b /* C1 */)",
      "(b) /* C1 */",
      "/* C1 */ b /* C2 */",
      "/* C1 *//* C2 */ b",
    ];
    const texts = sites.flatMap(site =>
      forms.map(form => site.replace("V", site.includes("this=") ? form.replace(/\bb\b/, '"b"') : form) + "\n"),
    );
    const names = texts.map((_, index) => `${index}.svelte`);
    const comments = (text: string) => text.match(/C\d/g)!.sort();

    test.each([true, false])("svelteAllowShorthand: %p", async svelteAllowShorthand => {
      using dir = tempDir("bun-format-svelte", {
        ".prettierrc": JSON.stringify({ plugins, svelteAllowShorthand }),
        ...Object.fromEntries(texts.map((text, index) => [names[index], text])),
      });
      let before = texts;
      for (const pass of [1, 2, 3]) {
        const result = await formatIn(String(dir), names);
        expect({ pass, stderr: result.stderr, exitCode: result.exitCode }).toEqual({ pass, stderr: "", exitCode: 0 });
        // What has lost or doubled one, with what it was.
        const wrong = result.files.flatMap((text, index) =>
          Bun.deepEquals(text.match(/C\d/g)?.sort(), comments(texts[index])) ? [] : [[pass, before[index], text]],
        );
        expect(wrong).toEqual([]);
        before = result.files;
      }
      // It has settled by then.
      expect((await formatIn(String(dir), names)).files).toEqual(before);
    });
  });

  describe("--debug-check", () => {
    // The text, what becomes of it, and what becomes of that, which stays.
    const right: [string, string, string?][] = [
      ["{#snippet row(b = // c\n  1)}y{/snippet}\n", "{#snippet row(\n  b = 1, // c\n)}y{/snippet}\n"],
      [
        "{#if b}{@const c = // d\n  class { e = 1 }}{c}{/if}\n",
        "{#if b}{@const c = class { // d\n    e = 1;\n  }}{c}{/if}\n",
        "{#if b}{@const c = class {\n    // d\n    e = 1;\n  }}{c}{/if}\n",
      ],
      ["{#each ( /* c */b + c ) * d, i}y{/each}\n", "{#each /* c */ (b + c) * d, i}y{/each}\n"],
      ["{#snippet f(b =\n/* c */\n`${d}`)}y{/snippet}\n", "{#snippet f(\n  /* c */\n  b = `${d}`,\n)}y{/snippet}\n"],
      // A name without its escape, modifiers in the usual order, a name that is written twice.
      [`${typescript}{b\\u{63}}\n`, `${typescript}{bc}\n`],
      [`${typescript}{class{static private b}}\n`, `${typescript}{class {\n  private static b;\n}}\n`],
      ["{#each b as { c = {d,e} }}y{/each}\n", "{#each b as { c = { d: d, e: e } }}y{/each}\n"],
      // The value of a `style:` directive is broken into lines like text.
      [
        '<p style:background="linear-gradient(red, orange, yellow, green, blue, indigo, violet, white)">y</p>\n',
        '<p\n  style:background="linear-gradient(red, orange, yellow, green, blue, indigo,\n  violet, white)"\n>\n  y\n</p>\n',
      ],
    ];
    test("says nothing about what is right", async () => {
      const names = right.map((_, index) => `${index}.svelte`);
      const files = (which: (row: (typeof right)[0]) => string) =>
        Object.fromEntries(right.map((it, index) => [names[index], which(it)]));
      const printed = (which: (row: (typeof right)[0]) => string) => ({
        stderr: "",
        files: right.map(which),
        exitCode: 0,
      });
      expect(
        await format(
          files(it => it[0]),
          names,
        ),
      ).toMatchObject(printed(it => it[1]));
      expect(
        await format(
          files(it => it[1]),
          names,
        ),
      ).toMatchObject(printed(it => it[2] ?? it[1]));
      expect(
        await format(
          files(it => it[0]),
          names,
          ["--debug-check"],
        ),
      ).toMatchObject(printed(it => it[0]));
      expect(
        await format(
          files(it => it[1]),
          names,
          ["--debug-check"],
        ),
      ).toMatchObject(printed(it => it[1]));
    });

    // What a word or a string is does not depend on the `,`, the `;` or the line break next to it, which change.
    const words = [
      "{x as { b: T, readonly [k: string]: U }}",
      "{x as { b: T\n readonly [k: string]: U }}",
      "{() => { interface A { b: T, readonly [k: string]: U } }}",
      "{class { b\nstatic [c] = 1 }}",
      "{class { b\nreadonly [c] = 1 }}",
      "{class { b\npublic [c] = 1 }}",
      "{class { b\naccessor [c] = 1 }}",
      "{class { b; static [c] = 1 }}",
      "{class { public\nb }}",
      "{class { readonly; b }}",
      "{() => { b\nstatic[0] }}",
      "{() => { enum A { 'b', c } }}",
      "{() => { enum A { 'b' } }}",
      "{() => { enum A { 'b-c', d } }}",
      '{x as { "b"; c }}',
      '{x as { "b" }}',
      '{x as { readonly "b" }}',
      '{() => { interface A { "b" } }}',
      '{class { accessor "b" }}',
      '{class { "b-c"; d }}',
      '{class { 1; "2" }}',
    ].map(code => `${typescript}${code}\n`);
    test.each([{}, { semi: false }, { quoteProps: "consistent" }])(
      "says nothing about words and keys: %j",
      async options => {
        const names = words.map((_, index) => `${index}.svelte`);
        const files = {
          ".prettierrc": JSON.stringify({ plugins, ...options }),
          ...Object.fromEntries(words.map((text, index) => [names[index], text])),
        };
        expect(await format(files, names, ["--debug-check"])).toMatchObject({ stderr: "", files: words, exitCode: 0 });
      },
    );

    const different: [string, string][] = [
      // Code that has become a comment.
      ["{@html raw + more}\n", "{@html raw // + more\n}\n"],
      ["{@html raw + more}\n", "{@html raw /* + more */}\n"],
      ["{#if q}{@const c = b + 1}{c}{/if}\n", "{#if q}{@const c = b /* + 1 */}{c}{/if}\n"],
      // A comment that is lost.
      ["{f(b /* c */)}\n", "{f(b)}\n"],
      // A string between brackets is a value.
      ['{{ ["b"]: 1 }}\n', "{{ [b]: 1 }}\n"],
      ["<Row item={/* c */ item} />\n", "<Row {item} />\n"],
      ["<input bind:value={/* c */ value} />\n", "<input bind:value />\n"],
      ["{#await b}wait{:then { c /* d */ }}{/await}\n", "{#await b}wait{/await}\n"],
      // A string is no name.
      ['{"name"}\n', "{name}\n"],
      ['{f("x")}\n', "{f(x)}\n"],
      ['{f(b, "x", c)}\n', "{f(b, x, c)}\n"],
      ['{b["c"]}\n', "{b[c]}\n"],
      ['{"1"}\n', "{1}\n"],
      ['{b ? "c" : d}\n', "{b ? c : d}\n"],
      ['<p b={"c"}>y</p>\n', "<p b={c}>y</p>\n"],
      ['<svelte:element this={"b"}>y</svelte:element>\n', "<svelte:element this={b}>y</svelte:element>\n"],
      ['<svelte:element this={ "b\\\\c" }>y</svelte:element>\n', '<svelte:element this="b\\\\c">y</svelte:element>\n'],
      // A template that is in no other language, whatever is before it.
      ["{() => { return `b  c` }}\n", "{() => { return `b c` }}\n"],
      ["{typeof `b  c`}\n", "{typeof `b c`}\n"],
      ["{b in `b  c`}\n", "{b in `b c`}\n"],
      ["{async () => await `b  c`}\n", "{async () => await `b c`}\n"],
      ["{() => { if (b) `b  c` }}\n", "{() => { if (b) `b c` }}\n"],
      ["{f`b  c`}\n", "{f`b c`}\n"],
      // A name that is spelled like a modifier.
      ["{f(public, b)}\n", "{f(b, public)}\n"],
      ["{static + b}\n", "{b + static}\n"],
      // What is no letter.
      ["{row(1, 2)}\n", "{row(1)}\n"],
      ["{b + 1}\n", "{b}\n"],
      ["{b + 1}\n", "{b - 1}\n"],
      ["{b + 1}\n", "{b + 2}\n"],
      ["{b | c}\n", "{b & c}\n"],
      ["{b.c}\n", "{b?.c}\n"],
      ["{#snippet f(b = 1)}y{/snippet}\n", "{#snippet f(b = 2)}y{/snippet}\n"],
      ["{#each b as { c = 1 }}y{/each}\n", "{#each b as { c = 2 }}y{/each}\n"],
      ["{const b = 1}\n", "{const b = 2}\n"],
      // The order.
      ["{x}{y}\n", "{y}{x}\n"],
      ["{b ? c : d}\n", "{b ? d : c}\n"],
      ["{#each b as c, i}y{/each}\n", "{#each b as i, c}y{/each}\n"],
      ["{@debug b, c}\n", "{@debug c, b}\n"],
      ["<p on:click={b} on:keyup={c}>y</p>\n", "<p on:click={c} on:keyup={b}>y</p>\n"],
      ['<p title="x y">z</p>\n', '<p title="y x">z</p>\n'],
      ['<p class="b c">y</p>\n', '<p class="c b">y</p>\n'],
      // White space that is not between two tokens.
      ['<p title="x  y">z</p>\n', '<p title="x y">z</p>\n'],
      ['{"b  c"}\n', '{"b c"}\n'],
      ["{`b\nc`}\n", "{`b c`}\n"],
    ];
    const same: [string, string][] = [
      ["{(b)}\n", "{b}\n"],
      ["{'b'}\n", '{"b"}\n'],
      ['{"b\\\'c"}\n', '{"b\'c"}\n'],
      ["{f(b,)}\n", "{f(b)}\n"],
      ["{0XAB + 1.50 + .5 + 1E5}\n", "{0xab + 1.5 + 0.5 + 1e5}\n"],
      ["{({'b': 1})}\n", "{{ b: 1 }}\n"],
      ["{(/b/ig).test(c)}\n", "{(/b/gi).test(c)}\n"],
      ["{new B}\n", "{new B()}\n"],
      ["{b => b}\n", "{(b) => b}\n"],
      ["{() => {b;c}}\n", "{() => {\n  b;\n  c;\n}}\n"],
      ["{css`b{}`}\n", "{css`\n  b {\n  }\n`}\n"],
      ["{/* HTML */ `<p   >b</p>`}\n", "{/* HTML */ `<p>b</p>`}\n"],
      ["{({'b': 1, 'c': 2})}\n", "{{ b: 1, c: 2 }}\n"],
      ["{({'1': b})}\n", "{{ 1: b }}\n"],
      ["{class{'b'(){}}}\n", "{class {\n  b() {}\n}}\n"],
      ["{#each b as {'c': d}}y{/each}\n", "{#each b as { c: d }}y{/each}\n"],
      [`${typescript}{b as {'c'?:D}}\n`, `${typescript}{b as { c?: D }}\n`],
      [`${typescript}{class{readonly static [b] = 1}}\n`, `${typescript}{class {\n  static readonly [b] = 1;\n}}\n`],
      ['<svelte:element this={ "b" }>y</svelte:element>\n', '<svelte:element this="b">y</svelte:element>\n'],
      ["{b ? c : (d // e\n)}\n", "{b ? c : d // e\n}\n"],
      ["{const b = 1;}\n", "{const b = 1}\n"],
      ["{#each b as { c: c }}y{/each}\n", "{#each b as { c }}y{/each}\n"],
      ["<p b={b}>y</p>\n", "<p {b}>y</p>\n"],
      ['<p class="b  c">y</p>\n', '<p class="b c">y</p>\n'],
      ['<p style:b="c d">y</p>\n', '<p style:b="c\n  d">y</p>\n'],
      [`${typescript}{b as | C | D}\n`, `${typescript}{b as C | D}\n`],
      [
        `${typescript}{#snippet f(b: C | D)}y{/snippet}\n`,
        `${typescript}{#snippet f(\n  b:\n    | C\n    | D,\n)}y{/snippet}\n`,
      ],
      // It does not tell these apart: a string that is no value could be a key, which can lose its quotes.
      [`${typescript}{b as "c"}\n`, `${typescript}{b as c}\n`],
      // Nor these: it looks at tokens, not at the tree, and at neither parentheses nor commas.
      ["{(b + c) * d}\n", "{b + c * d}\n"],
      ["{[b, , c]}\n", "{[b, c]}\n"],
    ];
    test.skipIf(!hasRunner)("tells what is something else from what is only written differently", async () => {
      const rows = [...different, ...same];
      using dir = tempDir(
        "bun-format-svelte",
        Object.fromEntries(rows.flatMap((it, index) => it.map((text, which) => [`${index}.${which}`, text]))),
      );
      await using proc = spawn({
        cmd: [bunExe(), "fmt", "--debug-check-svelte", ...rows.flatMap((_, index) => [`${index}.0`, `${index}.1`])],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const said = stdout.trimEnd().split("\n");
      expect(rows.map((it, index) => [...it, said[index]])).toEqual([
        ...different.map(it => [...it, "different"]),
        ...same.map(it => [...it, "same"]),
      ]);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    });
  });

  test("in <pre> a part of an await block that has white space in it has something in it", async () => {
    const rows = [
      "<pre>{#await b} {:then c} {:catch d} {/await}</pre>\n",
      "<pre>{#await b}\n{:then c}\n{:catch d}\n{/await}</pre>\n",
      "<pre>{#await b} {:then c}y{/await}</pre>\n",
      "<pre>{#await b then c} {/await}</pre>\n",
      "<pre>{#await b catch d} {/await}</pre>\n",
      "<pre><i>{#await b} {:then c} {/await}</i></pre>\n",
    ];
    const names = rows.map((_, index) => `${index}.svelte`);
    const files = Object.fromEntries(rows.map((it, index) => [names[index], it]));
    expect(await format(files, names)).toMatchObject({ stderr: "", files: rows, exitCode: 0 });
    // The control: elsewhere it is nothing.
    const outside = await format({ "a.svelte": "<p>{#await b} {:then c} {:catch d} {/await}</p>\n" }, ["a.svelte"]);
    expect(outside).toMatchObject({ stderr: "", files: ["<p>{#await b catch d}{/await}</p>\n"], exitCode: 0 });
  });

  test("a start tag that ends with a comment at the end of a line has its `>` on the next, with bracketSameLine too", async () => {
    const config = { ".prettierrc": JSON.stringify({ plugins, bracketSameLine: true }) };
    const rows = [
      ['<div b="c" // d\n>y</div>\n', '<div\n  b="c" // d\n>\n  y\n</div>\n'],
      ['<span b="c" // d\n>y</span>\n', '<span\n  b="c" // d\n>y</span>\n'],
      ['<B b="c" // d\n/>\n', '<B\n  b="c" // d\n/>\n'],
      ['<div\n  b="c"\n  /* d */>y</div>\n', '<div\n  b="c"\n  /* d */\n>\n  y\n</div>\n'],
      ['<span\n  b="c"\n  /* d */>y</span>\n', '<span\n  b="c"\n  /* d */\n>y</span>\n'],
      [
        '<div><script b="c" // d\n>let e</script></div>\n',
        '<div>\n  <script\n    b="c" // d\n  >\n    let e;\n  </script>\n</div>\n',
      ],
    ];
    const names = rows.map((_, index) => `${index}.svelte`);
    for (const which of [0, 1]) {
      const files = Object.fromEntries(rows.map((it, index) => [names[index], it[which]]));
      expect(await format({ ...config, ...files }, names)).toMatchObject({
        stderr: "",
        files: rows.map(it => it[1]),
        exitCode: 0,
      });
    }
  });

  test("white space that other options make text stays", async () => {
    const rows: [object, string, string][] = [
      // The plugin has a line in an element with nothing in it, which breaks with the start tag.
      [
        { bracketSameLine: true },
        "<pre>b<div {@attach () => { c; d }}></div>e</pre>\n",
        "<pre>b<div\n    {@attach () => {\n      c;\n      d;\n    }}></div>e</pre>\n",
      ],
      // The rows are as they are written: see "rows that are closed by the next".
      [{ htmlWhitespaceSensitivity: "strict" }, "<table><tr><td>b<tr>  </table>\n", "<table><tr><td>b<tr> </table>\n"],
    ];
    for (const [options, before, after] of rows) {
      const config = { ".prettierrc": JSON.stringify({ plugins, ...options }) };
      const result = await format({ ...config, "a.svelte": before, "b.svelte": after }, ["a.svelte", "b.svelte"]);
      expect(result).toMatchObject({ stderr: "", files: [after, after], exitCode: 0 });
      const checked = await format({ ...config, "a.svelte": before }, ["a.svelte"], ["--debug-check"]);
      expect(checked).toMatchObject({ stderr: "", files: [before], exitCode: 0 });
    }
  });

  // `regex_lang_attribute` of Svelte 5.57, which looks at the text before anything is parsed.
  describe("what says that the markup is TypeScript", () => {
    const [before, after] = ["{(e  as number)}\n", "{e as number}\n"];
    // What is before the markup, and what it is formatted to.
    test.each([
      ["lang in double quotes", '<script lang="ts"></script>\n', '<script lang="ts"></script>\n\n'],
      ["in single quotes", "<script lang='ts'></script>\n", '<script lang="ts"></script>\n\n'],
      ["without quotes", "<script lang=ts></script>\n", '<script lang="ts"></script>\n\n'],
      [
        "behind a value in double quotes with a > in it",
        '<script generics="T extends Map<string, unknown>" lang="ts"></script>\n',
        '<script generics="T extends Map<string, unknown>" lang="ts"></script>\n\n',
      ],
      [
        "before it",
        '<script lang="ts" generics="T extends Map<string, unknown>"></script>\n',
        '<script lang="ts" generics="T extends Map<string, unknown>"></script>\n\n',
      ],
      [
        "behind a value in single quotes with a > in it",
        "<script generics='T extends Array<string>' lang='ts'></script>\n",
        '<script generics="T extends Array<string>" lang="ts"></script>\n\n',
      ],
      [
        "behind a > alone",
        '<script data-b="c>d" lang="ts"></script>\n',
        '<script data-b="c>d" lang="ts"></script>\n\n',
      ],
      [
        "behind an attribute without a value and one with a >",
        '<script module data-b=">" lang="ts"></script>\n',
        '<script module data-b=">" lang="ts"></script>\n\n',
      ],
      [
        "on a line of its own",
        '<script\n  generics="T extends A<B>"\n  lang="ts"\n></script>\n',
        '<script generics="T extends A<B>" lang="ts"></script>\n\n',
      ],
      [
        "on the module",
        '<script module lang="ts"></script>\n<script></script>\n',
        '<script module lang="ts"></script>\n\n<script></script>\n\n',
      ],
      [
        "on the instance",
        '<script module></script>\n<script lang="ts"></script>\n',
        '<script module></script>\n\n<script lang="ts"></script>\n\n',
      ],
      // The first `lang` counts.
      [
        "on the first of two scripts that say something else",
        '<script lang="ts"></script>\n<script module lang="js"></script>\n',
        '<script module lang="js"></script>\n\n<script lang="ts"></script>\n\n',
      ],
      // Up to the first `>` Svelte looks for the letters, whatever they are in.
      [
        "in the value of another attribute",
        `<script data-b='lang="ts"'></script>\n`,
        `<script data-b='lang="ts"'></script>\n\n`,
      ],
      ["at the end of another name", '<script data-lang="ts"></script>\n', '<script data-lang="ts"></script>\n\n'],
      // In double quotes it would not say so any more.
      ["with a quote behind it", "<script lang=ts'></script>\n", "<script lang=ts'></script>\n\n"],
      // Not so another value.
      [
        "next to a value with a quote in it",
        "<script lang=ts b=c'd></script>\n",
        `<script lang="ts" b="c'd"></script>\n\n`,
      ],
    ])("%s", async (_, scripts, formatted) => {
      expect(await format({ "a.svelte": scripts + before }, ["a.svelte"])).toMatchObject({
        stderr: "",
        files: [formatted + after],
        exitCode: 0,
      });
    });

    test("a script behind the markup", async () => {
      const script = '<script generics="T extends A<B>" lang="ts"></script>\n';
      expect(await format({ "a.svelte": before + script }, ["a.svelte"])).toMatchObject({
        stderr: "",
        files: [`${script}\n${after}`],
        exitCode: 0,
      });
    });

    test.each([
      ["no lang", "<script></script>\n"],
      ["another language", '<script lang="typescript"></script>\n'],
      ["a blank behind the =", '<script lang= "ts"></script>\n'],
      ["a comment", '<!-- <script lang="ts"> -->\n'],
      [
        "the second of two scripts that say something else",
        '<script module lang="js"></script><script lang="ts"></script>\n',
      ],
      ["a lang behind a > that is in no quotes", '<script b={c>d} lang="ts"></script>\n'],
    ])("not %s", async (_, scripts) => {
      const result = await format({ "a.svelte": scripts + before }, ["a.svelte"]);
      expect(result).toMatchObject({
        stderr: `2 | {(e  as number)}\n         ^\nerror: This is TypeScript, which needs <script lang="ts">\n    at a.svelte:2:6\n\n`,
        files: [scripts + before],
        exitCode: 2,
      });
    });

    test("what is in a script is what its own lang says", async () => {
      const text = '<script lang= "ts">let b:  number</script>\n{b}\n';
      expect(await format({ "a.svelte": text }, ["a.svelte"])).toMatchObject({
        stderr: "",
        files: ['<script lang="ts">\n  let b: number;\n</script>\n\n{b}\n'],
        exitCode: 0,
      });
    });

    test("types in the markup of a component with generics", async () => {
      const text =
        '<script generics="T extends Map<string, unknown>" lang="ts">\n  let { b }: { b: T } = $props()\n</script>\n' +
        "{#snippet c(d:  T)}{d}{/snippet}\n<p on:click={(e:  Event) => e}>f</p>\n";
      expect(await format({ "a.svelte": text }, ["a.svelte"])).toMatchObject({
        stderr: "",
        files: [
          '<script generics="T extends Map<string, unknown>" lang="ts">\n  let { b }: { b: T } = $props();\n</script>\n\n' +
            "{#snippet c(d: T)}{d}{/snippet}\n<p on:click={(e: Event) => e}>f</p>\n",
        ],
        exitCode: 0,
      });
    });
  });

  // No expression ends with `as { b = c }`. Svelte hides what is from an `as` on, from the last to the first, until there is one.
  describe("where the expression of an each block ends", () => {
    const rows = [
      ["{#each a  as { b = c }}d{/each}", "{#each a as { b = c }}d{/each}"],
      ["{#each a  as [b = c]}d{/each}", "{#each a as [b = c]}d{/each}"],
      ["{#each a  as { b = c }, i (b)}d{/each}", "{#each a as { b = c }, i (b)}d{/each}"],
      ["{#each a.b(c)  as { b: { c = d } }}e{/each}", "{#each a.b(c) as { b: { c = d } }}e{/each}"],
      ["{#each a /* as */  as { b = c }}d{/each}", "{#each a /* as */ as { b = c }}d{/each}"],
      ["{#each assets  as { as = has }}d{/each}", "{#each assets as { as = has }}d{/each}"],
      ["{#each a ? as : b  as { c = d }}e{/each}", "{#each a ? as : b as { c = d }}e{/each}"],
      ["{#each [as, b]  as { c = d }}e{/each}", "{#each [as, b] as { c = d }}e{/each}"],
      ['{#each " as "  as { c = d }}e{/each}', '{#each " as " as { c = d }}e{/each}'],
    ];
    const typed = [
      ["{#each a  as b as c}d{/each}", "{#each a as b as c}d{/each}"],
      ["{#each a  as b as { c = d }}e{/each}", "{#each a as b as { c = d }}e{/each}"],
      ["{#each (a as b)  as { c = d }}e{/each}", "{#each a as b as { c = d }}e{/each}"],
      ["{#each f(a as b)  as { c = d }: T}e{/each}", "{#each f(a as b) as { c = d }: T}e{/each}"],
    ];

    test.each([
      ["JavaScript", "", rows],
      ["TypeScript", '<script lang="ts"></script>\n\n', [...rows, ...typed]],
    ])("%s", async (_, script, rows) => {
      const names = rows.map((_, index) => `${index}.svelte`);
      const files = Object.fromEntries(rows.map((it, index) => [names[index], `${script}${it[0]}\n`]));
      expect(await format(files, names)).toMatchObject({
        stderr: "",
        files: rows.map(it => `${script}${it[1]}\n`),
        exitCode: 0,
      });
    });

    test("nowhere, if it is in something that is not closed", async () => {
      const text = "{#each (a as b as c}d{/each}\n";
      const result = await format({ "a.svelte": text }, ["a.svelte"]);
      expect(result.stderr).toMatch(refusalOf("a.svelte"));
      expect(result).toMatchObject({ files: [text], exitCode: 2 });
    });
  });

  describe("what only TypeScript has", () => {
    // The text, the column of what is refused in a component without `lang="ts"`, and what the text is formatted to in one with it.
    const rows: [string, number, string][] = [
      ["{(a: number)  =>  a}", 6, "{(a: number) => a}"],
      ["{(a?)  => a}", 4, "{(a?) => a}"],
      ["{(a): number  => a}", 7, "{(a): number => a}"],
      ["{<T,>(a)  => a}", 3, "{<T,>(a) => a}"],
      ["{<T>a}", 2, "{<T>a}"],
      ["{function (this: A)  {}}", 12, "{function (this: A) {}}"],
      ["{class { private a }}", 10, "{class {\n  private a;\n}}"],
      ["{class A<T>  {}}", 10, "{class A<T> {}}"],
      ["{class A implements B  {}}", 10, "{class A implements B {}}"],
      ["{(a) => { let b: number; }}", 18, "{(a) => {\n  let b: number;\n}}"],
      ["{() => { type A = 1 }}", 15, "{() => {\n  type A = 1;\n}}"],
      ["{() => { enum A {} }}", 15, "{() => {\n  enum A {}\n}}"],
      // It is printed as an expression, which a declarator with a type is not: it stays as it is written.
      ["{@const a: number  =  1}", 10, "{@const a: number  =  1}"],
      ["{let a: number  =  1}", 9, "{let a: number = 1}"],
      ["{#each a  as b: number}c{/each}", 15, "{#each a as b: number}c{/each}"],
      ["{#snippet a(b: number,  c)}d{/snippet}", 16, "{#snippet a(b: number, c)}d{/snippet}"],
      ["<p on:click={(a: Event)  => a}>b</p>", 18, "<p on:click={(a: Event) => a}>b</p>"],
    ];
    const names = rows.map((_, index) => `${index}.svelte`);

    test("is an error in a component that is JavaScript, which says what it takes", async () => {
      const files = Object.fromEntries(rows.map(([text], index) => [names[index], `${text}\n`]));
      const result = await format(files, names);
      for (const [index, [text, column]] of rows.entries()) {
        expect({ text, stderr: result.stderr }).toEqual({
          text,
          stderr: expect.stringContaining(
            `error: This is TypeScript, which needs <script lang="ts">\n    at ${names[index]}:1:${column}\n`,
          ),
        });
      }
      expect(result).toMatchObject({ files: Object.values(files), exitCode: 2 });
    });

    test("is formatted in one that is TypeScript", async () => {
      const files = Object.fromEntries(
        rows.map(([text], index) => [names[index], `<script lang="ts"></script>\n\n${text}\n`]),
      );
      expect(await format(files, names)).toMatchObject({
        stderr: "",
        files: rows.map(it => `<script lang="ts"></script>\n\n${it[2]}\n`),
        exitCode: 0,
      });
    });

    test("ends an expression where acorn stops before it", async () => {
      expect(await format({ "a.svelte": "{#each a  as b}c{/each}\n" }, ["a.svelte"])).toMatchObject({
        stderr: "",
        files: ["{#each a as b}c{/each}\n"],
        exitCode: 0,
      });
    });
  });

  test("what is an expression to Svelte is one in a <textarea> and in the value of an attribute", async () => {
    // The plugin takes what is in a `<style>` out of the text wherever it finds the letters, so it does not see these.
    const files = {
      "a.svelte": "<textarea><style>b{c:d}</style></textarea>\n",
      "b.svelte": '<iframe srcdoc="<style>b{c:d}</style>" title="e"></iframe>\n',
    };
    const result = await format(files, Object.keys(files));
    expect(result.stderr).toContain('error: Expected "}"\n    at a.svelte:1:21\n');
    expect(result.stderr).toContain('error: Expected "}"\n    at b.svelte:1:27\n');
    expect(result).toMatchObject({ files: Object.values(files), exitCode: 2 });
  });

  test.each(["{:else}c", "{:else if d}c", "{:else if d}c{:else if e}f{:else}g"])(
    "a <title> behind a <svelte:head> is not in it, whatever the head has: {#if a}b%s{/if}",
    async rest => {
      const head = `<svelte:head\n  >{#if a}b${rest}{/if}</svelte:head\n>\n`;
      const result = await format({ "a.svelte": `${head}<title>  h  i  </title>\n` }, ["a.svelte"]);
      expect(result).toMatchObject({ stderr: "", files: [`${head}<title> h i </title>\n`], exitCode: 0 });
    },
  );

  test("a no-break space at the end of a component is nothing to Svelte, and would be text before a <style>", async () => {
    const result = await format({ "a.svelte": "<style></style>\n<p>b</p>\u00A0\n" }, ["a.svelte"]);
    expect(result).toMatchObject({ stderr: "", files: ["<p>b</p>\n\n<style></style>\n"], exitCode: 0 });
  });

  test("a range or a cursor is refused with the reason", async () => {
    for (const flag of ["--range-start=1", "--range-end=2", "--cursor-offset=1"]) {
      using dir = tempDir("bun-format-svelte", { "a.svelte": input });
      const result = await formatIn(String(dir), ["a.svelte"], [flag, "a.svelte"]);
      expect(result.stderr).toStartWith(
        `error: A range or a cursor offset cannot be used with a Svelte file: "${join(String(dir), "a.svelte")}".\n`,
      );
      expect(result).toMatchObject({ files: [input], exitCode: 2 });
    }
  });

  // The plugin writes the error to stderr too, and goes on.
  describe("what is in a script or a style sheet and cannot be parsed stays as it is, with a warning", () => {
    const warning = (message: string, [line, column, shown]: [number, number, string], name = "a.svelte") =>
      `${line} | ${shown}\n${Buffer.alloc(`${line} | `.length + column - 1, " ").toString()}^\n` +
      `warn: ${message}\n   at ${name}:${line}:${column}\n\n`;

    test.each<[string, string, string, string]>([
      [
        "a script",
        "<script>\n  let a = ;\n</script>\n\n<p   >{a}</p>\n",
        "<script>\n  let a = ;\n</script>\n\n<p>{a}</p>\n",
        warning("Expression expected.", [2, 11, "  let a = ;"]),
      ],
      [
        "a style sheet, behind the markup",
        "<p   >a</p>\n\n<style>\n  a { color: }}\n</style>\n",
        "<p>a</p>\n\n<style>\n  a { color: }}\n</style>\n",
        warning('Unexpected "}"', [4, 15, "  a { color: }}"]),
      ],
      [
        "both, in TypeScript and SCSS, with \\r\\n",
        '<style lang="scss">\r\n  a { b: {{ }\r\n</style>\r\n<script lang="ts">\r\n  let a: = 1;\r\n</script>\r\n<p   >a</p>\r\n',
        '<script lang="ts">\n  let a: = 1;\n</script>\n\n<p>a</p>\n\n<style lang="scss">\n  a { b: {{ }\n</style>\n',
        warning("Unclosed block", [2, 7, "  a { b: {{ }"]) + warning("Type expected.", [5, 10, "  let a: = 1;"]),
      ],
      [
        "JSON in an element",
        '<div   ><script type="application/json">{ "a": }</script></div>\n',
        '<div>\n  <script type="application/json">\n{ "a": }\n  </script>\n</div>\n',
        warning("Unexpected token", [1, 48, '<div   ><script type="application/json">{ "a": }</script></div>']),
      ],
      [
        "a script whose type is another name of JavaScript",
        '<script type="text/ecmascript">function (</script>\n',
        '<script type="text/ecmascript">\nfunction (\n</script>\n',
        warning("Identifier expected.", [1, 41, '<script type="text/ecmascript">function (</script>']),
      ],
      [
        "a script for Partytown",
        '<script type="text/partytown">let a = ;</script>\n',
        '<script type="text/partytown">\nlet a = ;\n</script>\n',
        warning("Expression expected.", [1, 39, '<script type="text/partytown">let a = ;</script>']),
      ],
      [
        "behind a byte order mark and letters of two bytes",
        '\uFEFF<script>let é = "é"; let b = ;</script>\n',
        '\uFEFF<script>\nlet é = "é"; let b = ;\n</script>\n',
        warning("Expression expected.", [1, 30, '<script>let é = "é"; let b = ;</script>']),
      ],
    ])("%s", async (_, before, after, stderr) => {
      for (const config of [{}, { ".prettierrc": prettierrc }, { ".oxfmtrc.json": oxfmtrc }]) {
        expect(await format({ ...config, "a.svelte": before }, ["a.svelte"])).toMatchObject({
          stderr,
          files: [after],
          exitCode: 0,
        });
      }
    });

    const [before, after] = [
      "<script>\n  let a = ;\n</script>\n\n<p   >{a}</p>\n",
      "<script>\n  let a = ;\n</script>\n\n<p>{a}</p>\n",
    ];
    const said = warning("Expression expected.", [2, 11, "  let a = ;"]);

    test("--check says it too, about a file that is formatted and about one that is not", async () => {
      const checked = await format({ "a.svelte": after }, ["a.svelte"], ["--check"]);
      expect(checked).toMatchObject({ stderr: said, files: [after], exitCode: 0 });
      const different = await format({ "a.svelte": before }, ["a.svelte"], ["--check"]);
      const summary = "1 file needs formatting. Run bun fmt to fix it.\n";
      expect(different).toMatchObject({ stdout: "a.svelte\n", stderr: said + summary, files: [before], exitCode: 1 });
    });

    test("a line is shown with the first warning that is about it", async () => {
      const text = "<div><script>let = </script><style>a{</style></div>\n<div><script>let = </script></div>\n";
      const result = await format({ "a.svelte": text }, ["a.svelte"], ["--check"]);
      expect(result.stderr).toStartWith(
        warning("Expression expected.", [1, 19, "<div><script>let = </script><style>a{</style></div>"]) +
          "warn: Unclosed block\n   at a.svelte:1:36\n\n" +
          warning("Expression expected.", [2, 19, "<div><script>let = </script></div>"]),
      );
    });

    test("--log-level=error does not", async () => {
      const result = await format({ "a.svelte": before }, ["a.svelte"], ["--log-level=error"]);
      expect(result).toMatchObject({ stderr: "", files: [after], exitCode: 0 });
    });

    test("from standard input", async () => {
      using dir = tempDir("bun-format-svelte", {});
      await using proc = spawn({
        cmd: [bunExe(), "fmt", "--stdin-filepath=b.svelte"],
        env: bunEnv,
        cwd: String(dir),
        stdin: Buffer.from(before),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const expected = warning("Expression expected.", [2, 11, "  let a = ;"], "b.svelte");
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: after, stderr: expected, exitCode: 0 });
    });
  });

  test("rows that are closed by the next stay as they are written", async () => {
    // To Svelte the second row ends the cell and is in the first row. The plugin gives every element its end tag, and
    // then the second row ends the first, whose end tag is left over.
    const text = "<table><tr><td>a<tr><td>b</table>\n";
    const result = await format({ ".prettierrc": prettierrc, "a.svelte": text }, ["a.svelte"]);
    expect(result).toMatchObject({ stderr: "", files: [text], exitCode: 0 });
    // Where the next element ends the one before it and nothing else, there is nothing to lose.
    const items = await format({ ".prettierrc": prettierrc, "a.svelte": "<ul><li>a<li>b</ul>\n" }, ["a.svelte"]);
    expect(items).toMatchObject({ stderr: "", files: ["<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>\n"], exitCode: 0 });
  });

  test.each<[string, string, string, [line: number, column: number, text: string]]>([
    ["in the markup", "<div>\n  <p>a</p>\n", "Unclosed element", [1, 1, "<div>"]],
    [
      "in an expression, behind a script and a style sheet",
      "<script>\n  let a;\n</script>\n<style>\n  a {\n  }\n</style>\n<p>{a +}</p>\n",
      "Unexpected token",
      [8, 8, "<p>{a +}</p>"],
    ],
    [
      "in a file with \\r\\n",
      "<script>\r\n  let a;\r\n</script>\r\n<p>{/if}</p>\r\n",
      "There is no open block to end here",
      [4, 5, "<p>{/if}</p>"],
    ],
    // To Svelte this is `t`, or all that is up to a quote further down.
    [
      "at a quote in a <script> tag that is not closed",
      '<script lang="ts>let a</script>\n',
      "Unclosed string",
      [1, 14, '<script lang="ts>let a</script>'],
    ],
  ])("a syntax error is shown where it is: %s", async (_, text, message, [line, column, shown]) => {
    const caret = Buffer.alloc(`${line} | `.length + column - 1, " ").toString() + "^";
    for (const config of [{}, { ".prettierrc": prettierrc }, { ".oxfmtrc.json": oxfmtrc }]) {
      const result = await format({ ...config, "a.svelte": text, "b.svelte": input }, ["a.svelte", "b.svelte"]);
      expect(result.stderr).toStartWith(
        `${line} | ${shown}\n${caret}\nerror: ${message}\n    at a.svelte:${line}:${column}\n\n`,
      );
      expect(result).toMatchObject({ files: [text, output], exitCode: 2 });
    }
  });

  test("--debug-check names a component that passes, and writes nothing", async () => {
    const result = await format({ "a.svelte": input }, ["a.svelte"], ["--log-level=log", "--debug-check"]);
    expect(result).toMatchObject({ stdout: "a.svelte\n", stderr: "", files: [input], exitCode: 0 });
  });

  test("--debug-check knows that a key can go that is the name behind it", async () => {
    const text = "{#each a as { b: b, c: { d: d } }}e{/each}\n";
    const checked = await format({ "a.svelte": text }, ["a.svelte"], ["--debug-check"]);
    expect(checked).toMatchObject({ stderr: "", files: [text], exitCode: 0 });
    expect((await format({ "a.svelte": text }, ["a.svelte"])).files).toEqual([
      "{#each a as { b, c: { d } }}e{/each}\n",
    ]);
  });

  test.skipIf(!hasRunner)("--debug-check does not take what looks like such a key for one", async () => {
    const each = (pattern: string) => `{#each b as ${pattern}}c{/each}\n`;
    const pairs = [
      [each("{ a: a }"), each("{ a }"), "same"],
      [each("{ d: { a: a }, e: [{ f: f }] }"), each("{ d: { a }, e: [{ f }] }"), "same"],
      // In a string.
      [each('{ "a:a": a }'), each('{ "a": a }'), "different"],
      // In a default.
      [each("{ x = c ? a : a }"), each("{ x = c ? a : 1 }"), "different"],
      [each("{ x = c ? a : a }"), each("{ x = c ? a }"), "different"],
      // In an object it is one: the second is printed as the first.
      [each("{ x = { a: a } }"), each("{ x = { a } }"), "same"],
      [each("{ x = { a: b } }"), each("{ x = { b } }"), "different"],
      [each("{ x = { [a]: a } }"), each("{ x = { a } }"), "different"],
      // A computed key.
      [each("{ [a]: a }"), each("{ a }"), "different"],
    ];
    using dir = tempDir("bun-format-svelte", {
      ...Object.fromEntries(
        pairs.flatMap((it, index) => it.slice(0, 2).map((text, which) => [`${index}.${which}`, text])),
      ),
    });
    await using proc = spawn({
      cmd: [bunExe(), "fmt", "--debug-check-svelte", ...pairs.flatMap((_, index) => [`${index}.0`, `${index}.1`])],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim().split("\n"), stderr, exitCode }).toEqual({
      stdout: pairs.map(it => it[2]),
      stderr: "",
      exitCode: 0,
    });
  });

  test("--debug-check does not take an expression that is spelled like the name of its directive for the name", async () => {
    const text = "<p class:a-b={a-b}>c</p>\n";
    const checked = await format({ "a.svelte": text }, ["a.svelte"], ["--debug-check"]);
    expect(checked).toMatchObject({ stderr: "", files: [text], exitCode: 0 });
    expect((await format({ "a.svelte": text }, ["a.svelte"])).files).toEqual(["<p class:a-b={a - b}>c</p>\n"]);
  });

  test("what is nested too deeply is left as it is, and that is said", async () => {
    const depth = isDebug || isASAN ? 10_000 : 100_000;
    const files = {
      "elements.svelte": `${Buffer.alloc(3 * depth, "<b>")}x${Buffer.alloc(4 * depth, "</b>")}\n`,
      "blocks.svelte": `${Buffer.alloc(7 * depth, "{#if a}")}x${Buffer.alloc(5 * depth, "{/if}")}\n`,
      "patterns.svelte": `{#each a as ${Buffer.alloc(depth, "[")}b${Buffer.alloc(depth, "]")}}{b}{/each}\n`,
      "expressions.svelte": `{${Buffer.alloc(depth, "(")}a${Buffer.alloc(depth, ")")}}\n`,
      "fine.svelte": input,
    };
    const result = await format(files, Object.keys(files), ["--threads=1"]);
    expect(result.files).toEqual([...Object.values(files).slice(0, 4), output]);
    expect(result.stderr).toContain("error: The code is nested too deeply\n    at expressions.svelte\n");
    expect(result.stderr).toContain("error: The code is nested too deeply\n    at elements.svelte\n");
    expect(result.stderr).toContain("error: The code is nested too deeply\n    at blocks.svelte\n");
    expect(result.stderr).toMatch(refusalOf("patterns.svelte"));
    expect(result.exitCode).toBe(2);
  });

  // Where something takes time in proportion to the square of this, it takes seconds.
  const n = isDebug || isASAN ? 400 : 24_000;

  /** Formats `shapes`, of which `refused` are refused, in little time. */
  async function expectToTakeLittleTime(shapes: Record<string, string>, refused: string[]) {
    using dir = tempDir("bun-format-svelte", {
      ".oxfmtrc.json": oxfmtrc,
      ...Object.fromEntries(Object.entries(shapes).map(([name, text]) => [`${name}.svelte`, text])),
    });
    await using proc = spawn({
      cmd: [bunExe(), "fmt", "--check", "--threads=1", "."],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
    expect(Array.from(stderr.matchAll(/^    at ([\w-]+)\.svelte\b/gm), it => it[1]).sort()).toEqual(refused);
    expect(exitCode).toBe(2);
    expect(Number(proc.resourceUsage()!.cpuTime.user) / 1e6).toBeLessThan(3);
  }

  test("texts that are made to take long do not", async () => {
    const depth = 100;
    const numbered = (text: (index: number) => string) =>
      Array.from({ length: n }, (_, index) => text(index)).join(" ");
    const shapes: Record<string, string> = {
      "paragraphs": repeated("<p>some words here</p>\n", n),
      "comments-not-closed": repeated("<!-- ", n),
      "scripts-not-closed": repeated("<script>", n),
      "styles-with-a-quote-not-closed": repeated('<style a="', n),
      "attributes-of-a-script": `<script ${repeated('a="b" ', n)}x`,
      "attributes-of-a-script-next-to-quotes": `<script ${repeated('a="b"c ', n)}>`,
      "ends-of-scripts": repeated("</script ", n),
      "less-than": repeated("<", n),
      "attributes": `<a ${numbered(index => `a${index}`)}></a>`,
      "attributes-with-values": `<a ${numbered(index => `a${index}="b c"`)}></a>`,
      "the-same-attribute": `<a ${repeated("b ", n)}>`,
      "elements-in-each-other": repeated("<b>", n),
      "elements-in-each-other-with-ends": repeated(`${repeated("<b>", depth)}x${repeated("</b>", depth)}\n`, n / 400),
      "inline-elements": repeated("<b>x</b> ", n),
      "blocks": repeated("<div>x</div>", n),
      "comments": repeated("<!-- a -->", n),
      "comments-before-a-script": `${repeated("<!-- a -->\n", n)}<script></script>`,
      "words": repeated("word ", 4 * n),
      "one-word": repeated("w", 8 * n),
      "line-breaks": repeated("\n", 8 * n),
      "pre": `<pre>${repeated("a\n", n)}</pre>`,
      "textarea": `<textarea>${repeated("a\n", n)}</textarea>`,
      "textareas-not-closed": repeated("<textarea>", n),
      "ignored": repeated("<!-- prettier-ignore -->\n<p   >a</p>\n", n),
      "an-ignored-range": `<!-- prettier-ignore-start -->\n${repeated("<p   >a</p>\n", n)}<!-- prettier-ignore-end -->`,
      "classes": `<p class="${repeated("a  b\n", n)}"></p>`,
      "the-mark-of-the-plugin": repeated('✂prettier:content✂="1">', n),
      "the-mark-of-the-plugin-in-elements": repeated('<a ✂prettier:content✂="1">', n),
      "paragraphs-not-closed": repeated("<p>", n),
      "items-not-closed": `<ul>${repeated("<li>a", n)}</ul>`,
      "void-elements": repeated("<br>", n),
      "entities": repeated("&amp;", n),
      "nul": repeated("\0", n),
      "end-tags": repeated("</a>", n),
      "starts-of-blocks": repeated("{#", n),
      "braces": repeated("{", n),
      "closing-braces": repeated("}", n),
      "tags": repeated("{a}", n),
      "tags-and-backslashes": repeated("\\{a}\n", n),
      "tags-and-comments": repeated("<!-- a -->{a}\n", n),
      "patterns": repeated("{#each a as { b }}{b}{/each}\n", n),
      "parentheses-in-a-tag": `{${repeated("(", n)}`,
      "blocks-in-each-other": repeated("{#if a}", n),
      "attributes-of-the-options": `<svelte:options ${repeated("a ", n)}/>`,
      "ends-of-regions": `<script></script>${repeated("<!-- #endregion -->", n)}`,
      "style-sheets": repeated("<style></style>", n),
      "scripts-in-an-element": `<div>${repeated("<script>a</script>", n / 10)}</div>`,
    };
    await expectToTakeLittleTime(shapes, [
      "attributes-of-a-script",
      "attributes-of-a-script-next-to-quotes",
      "attributes-of-the-options",
      "blocks-in-each-other",
      "braces",
      "comments-not-closed",
      "elements-in-each-other",
      "end-tags",
      "ends-of-scripts",
      "less-than",
      "paragraphs-not-closed",
      "parentheses-in-a-tag",
      "scripts-not-closed",
      "starts-of-blocks",
      "style-sheets",
      "styles-with-a-quote-not-closed",
      "textareas-not-closed",
      "the-mark-of-the-plugin-in-elements",
      "the-same-attribute",
    ]);
  });

  test("nothing is looked for, or parsed, again and again", async () => {
    const shapes: Record<string, string> = {
      "starts-of-scripts": repeated("<script ", 8 * n),
      "starts-of-scripts-with-an-attribute": repeated("<script a=", 8 * n),
      "starts-of-scripts-with-a-quote": repeated('<script a="', 8 * n),
      "scripts-with-a-value-that-ends-a-tag": repeated('<script a=">" ', 8 * n),
      "languages-behind-the-last-tag": `<script a=">" ${repeated("lang=b ", 8 * n)}`,
      "starts-of-scripts-before-one-end": `${repeated("<script ", 8 * n)}>`,
      "ends-of-a-textarea-not-closed": `<textarea>${repeated("</textarea ", 8 * n)}`,
      "titles-in-blocks": repeated("{#if a}", n) + repeated("<title>x</title>", n),
      "slots-in-elements": repeated("<div>", n) + repeated("<slot></slot>", n),
      // Every `as` is where Svelte tries to end the expression.
      "each-in-a-parenthesis-not-closed": `{#each (a${repeated(" as a", n)}}x{/each}`,
      "each-behind-operators": `{#each x${repeated(" + as", n)} + (}x{/each}`,
      "each-in-parentheses": `{#each f${repeated("(as)", n)}(}x{/each}`,
      "each-with-many-assertions": `<script lang="ts"></script>{#each a${repeated(" as a", n)} as { b = 1 }}x{/each}`,
      "each-with-defaults": repeated("{#each a as { b = 1 }}x{/each}\n", n / 4),
      // There is a warning about each.
      "scripts-with-errors": `<div>${repeated("<script>let = </script>\n", n / 4)}</div>`,
      "scripts-with-errors-and-returns": `<div>${repeated("<script>let = </script>\r\n", n / 4)}</div>`,
      "scripts-with-errors-on-one-line": `<div>${repeated("<script>let = </script>", n / 4)}</div>`,
    };
    await expectToTakeLittleTime(shapes, [
      "each-behind-operators",
      "each-in-a-parenthesis-not-closed",
      "each-in-parentheses",
      "ends-of-a-textarea-not-closed",
      "languages-behind-the-last-tag",
      "scripts-with-a-value-that-ends-a-tag",
      "slots-in-elements",
      "starts-of-scripts",
      "starts-of-scripts-before-one-end",
      "starts-of-scripts-with-a-quote",
      "starts-of-scripts-with-an-attribute",
      "titles-in-blocks",
    ]);
  });

  test("blocks of Svelte in Markdown are formatted where components are", async () => {
    const block = (text: string) => `# a\n\n\`\`\`svelte\n${text}\`\`\`\n`;
    for (const config of [{}, { ".prettierrc": prettierrc }, { ".oxfmtrc.json": oxfmtrc }]) {
      expect(await format({ ...config, "a.md": block(input) }, ["a.md"])).toMatchObject({
        stderr: "",
        files: [block(output)],
      });
      // One that is refused stays as it is.
      const refused = block("<p   >{a +}</p>\n");
      expect(await format({ ...config, "a.md": refused }, ["a.md"])).toMatchObject({ files: [refused], exitCode: 0 });
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

  test("the classes in an object are sorted too", async () => {
    // The plugin visits every string of the expression, whatever the expression is.
    const tailwind = {
      "node_modules/tailwindcss/package.json": '{ "name": "tailwindcss", "version": "4.0.0", "main": "index.js" }',
      "node_modules/tailwindcss/theme.css": "",
      "node_modules/tailwindcss/index.js": `const order = ["m-2", "p-4"];
exports.__unstable__loadDesignSystem = async () => ({
  getClassOrder: classes => classes.map(name => [name, order.includes(name) ? BigInt(order.indexOf(name)) : null]),
});
`,
    };
    const files = {
      ...tailwind,
      ".oxfmtrc.json": '{ "svelte": {}, "sortTailwindcss": {} }',
      "a.svelte": '<p class={{ "p-4 m-2": a }}>b</p>\n',
    };
    expect(await format(files, ["a.svelte"])).toMatchObject({
      stderr: "",
      files: ['<p class={{ "m-2 p-4": a }}>b</p>\n'],
      exitCode: 0,
    });
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
