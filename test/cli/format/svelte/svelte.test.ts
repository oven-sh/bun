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
        '<div><script type = "y">let  b = 2</script></div>\n',
        '<div>\n  <script type="y">\n    let b = 2;\n  </script>\n</div>\n',
        '<div><script type="y"></script></div>\n',
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
      ["{`<script>y</script\n>`}\n", "{`<script>y</script\n>`}\n", "{`<script>y</script>`}\n", false],
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
  describe.each(Object.entries(damaged))("%s", (_, rows) => {
    const names = rows.map((_, index) => `${index}.svelte`);
    const files = (which: 0 | 1) => Object.fromEntries(rows.map((it, index) => [names[index], it[which]]));

    test.each([[{}], [{ ".prettierrc": prettierrc }], [{ ".oxfmtrc.json": oxfmtrc }]])("%j", async config => {
      const expected = { stderr: "", files: rows.map(it => it[1]), exitCode: 0 };
      expect(await format({ ...config, ...files(0) }, names)).toMatchObject(expected);
      expect(await format({ ...config, ...files(1) }, names)).toMatchObject(expected);
      const checked = await format({ ...config, ...files(0) }, names, ["--debug-check"]);
      expect(checked).toMatchObject({ stderr: "", files: rows.map(it => it[0]), exitCode: 0 });
    });

    test.skipIf(!hasRunner)("--debug-check would not let what the plugin prints pass", async () => {
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

  describe("what only TypeScript has", () => {
    // The text, and the column of what is refused in a component without `lang="ts"`.
    const rows: [string, number][] = [
      ["{(a: number) => a}", 6],
      ["{(a?) => a}", 4],
      ["{(a): number => a}", 7],
      ["{<T,>(a) => a}", 3],
      ["{<T>a}", 2],
      ["{function (this: A) {}}", 12],
      ["{class { private a }}", 10],
      ["{class A<T> {}}", 10],
      ["{class A implements B {}}", 10],
      ["{(a) => { let b: number; }}", 18],
      ["{() => { type A = 1 }}", 15],
      ["{() => { enum A {} }}", 15],
      ["{@const a: number = 1}", 10],
      ["{let a: number = 1}", 9],
      ["{#each a as b: number}c{/each}", 14],
      ["{#snippet a(b: number)}c{/snippet}", 16],
      ["<p on:click={(a: Event) => a}>b</p>", 18],
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
      expect(await format(files, names)).toMatchObject({ stderr: "", exitCode: 0 });
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

  test("texts that are made to take long do not", async () => {
    // Where something takes time in proportion to the square of this, it takes seconds.
    const n = isDebug || isASAN ? 400 : 24_000;
    const depth = 100;
    const numbered = (text: (index: number) => string) =>
      Array.from({ length: n }, (_, index) => text(index)).join(" ");
    const shapes: Record<string, string> = {
      "paragraphs": repeated("<p>some words here</p>\n", n),
      "comments-not-closed": repeated("<!-- ", n),
      "scripts-not-closed": repeated("<script>", n),
      "starts-of-scripts": repeated("<script ", 8 * n),
      "starts-of-scripts-with-an-attribute": repeated("<script a=", 8 * n),
      "starts-of-scripts-with-a-quote": repeated('<script a="', 8 * n),
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
    const refused = Array.from(stderr.matchAll(/^    at ([\w-]+)\.svelte\b/gm), it => it[1]);
    expect(refused.sort()).toEqual([
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
      "starts-of-scripts",
      "starts-of-scripts-with-a-quote",
      "starts-of-scripts-with-an-attribute",
      "style-sheets",
      "styles-with-a-quote-not-closed",
      "textareas-not-closed",
      "the-mark-of-the-plugin-in-elements",
      "the-same-attribute",
    ]);
    expect(exitCode).toBe(2);
    expect(Number(proc.resourceUsage()!.cpuTime.user) / 1e6).toBeLessThan(3);
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
