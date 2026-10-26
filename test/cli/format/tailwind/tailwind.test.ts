// Tests for oxfmt's `sortTailwindcss`. cases.json has the inputs from oxfmt's
// apps/oxfmt/test/api/sort_tailwindcss.test.ts (MIT: see LICENSE) plus some more, with oxfmt 0.72's output for them
// with tailwindcss 4.3.3. order.json has the classes in them that Tailwind knows, in Tailwind's order.
// test/cli/format/oracle/tailwind/make-fixtures.ts generates both.
//
// The order comes from the project's `tailwindcss` package. Here that's a stub that knows the classes in order.json.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../../children";
import cases from "./cases.json";
import order from "./order.json";

afterAll(endChildren);

const getClassOrder = `classes => classes.map(name => [name, order.includes(name) ? BigInt(sign * order.indexOf(name)) : null])`;
/** A stub of the parts of Tailwind CSS 4 that get called. A style sheet that contains `reversed` reverses the order. */
const version4 = {
  "node_modules/tailwindcss/package.json": JSON.stringify({ name: "tailwindcss", version: "4.0.0", main: "index.js" }),
  "node_modules/tailwindcss/theme.css": "",
  "node_modules/tailwindcss/index.js": `const order = ${JSON.stringify(order)};
exports.__unstable__loadDesignSystem = async css => {
  const sign = css.includes("reversed") ? -1 : 1;
  return { getClassOrder: ${getClassOrder} };
};
`,
};
/** A stub of Tailwind CSS 3. A configuration with `reversed` reverses the order, and classes in its `own` come last. */
const version3 = {
  "node_modules/tailwindcss/package.json": JSON.stringify({ name: "tailwindcss", version: "3.0.0", main: "index.js" }),
  "node_modules/tailwindcss/index.js": "",
  "node_modules/tailwindcss/resolveConfig.js": "module.exports = config => config;\n",
  "node_modules/tailwindcss/lib/lib/generateRules.js": "exports.generateRules = () => [];\n",
  "node_modules/tailwindcss/lib/lib/setupContextUtils.js": `const known = ${JSON.stringify(order)};
exports.createContext = config => {
  const [sign, order] = [config.reversed ? -1 : 1, [...known, ...(config.own ?? [])]];
  return { getClassOrder: ${getClassOrder} };
};
`,
};

async function formatIn(cwd: string, names: string[], flags: string[] = ["."], stdin?: string) {
  await using proc = spawn({
    cmd: [bunExe(), "fmt", "--log-level=warn", ...flags],
    env: bunEnv,
    cwd,
    stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, files: names.map(name => readFileSync(join(cwd, name), "utf8")) };
}

async function format(files: Record<string, string>, names: string[], flags: string[] = []) {
  using dir = tempDir("bun-format-tailwind", files);
  return await formatIn(String(dir), names, [...flags, "."]);
}

describe.concurrent("sortTailwindcss", () => {
  // One run for all the cases with the same options.
  for (const [options, group] of Map.groupBy(cases, it => JSON.stringify(it.options))) {
    test(`matches oxfmt: ${options}`, async () => {
      const names = group.map((it, index) => `${index}/${it.filename}`);
      const files = Object.fromEntries(group.map((it, index) => [names[index], it.input]));
      const result = await format({ ...version4, ".oxfmtrc.json": options, ...files }, names);
      expect(result.stderr).toBe("");
      for (const [index, it] of group.entries()) {
        if ("todo" in it) continue;
        expect({ name: it.name, output: result.files[index] }).toEqual({ name: it.name, output: it.output });
      }
      expect(result.exitCode).toBe(0);
    });
  }

  const input = '<a className="p-4 flex m-2" />;\n';
  const [sorted, reversed] = ['<a className="m-2 flex p-4" />;\n', '<a className="p-4 flex m-2" />;\n'];

  const unknown = "sortTailwindcss could not find the order of some classes.";

  const listed = (root: string) => readdirSync(root, { recursive: true, encoding: "utf8" }).sort();

  describe("Handlebars: classes that oxfmt joins with adjacent text, or loses", () => {
    // Each row is the template, Bun's output and oxfmt 0.72's output. oxfmt removes the space at the end of a string
    // whatever follows, moves a class that touches the text before or after the mustache, and loses a no-break space.
    const rows = [
      [
        '<a class={{concat "p-4 flex" x " m-2 flex "}}></a>\n',
        '<a class={{concat "p-4 flex" x " m-2 flex"}}></a>',
        '<a class={{concat "flex p-4" x " m-2 flex"}}></a>',
      ],
      [
        '<a class={{concat "p-4 flex " x " m-2 flex"}}></a>\n',
        '<a class={{concat "flex p-4 " x " m-2 flex"}}></a>',
        '<a class={{concat "flex p-4" x " m-2 flex"}}></a>',
      ],
      [
        '<a class="{{if a "p-4 flex "}}x"></a>\n',
        `<a class="{{if a 'flex p-4 '}}x"></a>`,
        `<a class="{{if a 'flex p-4'}}x"></a>`,
      ],
      [
        '<a class="x{{if a "p-4 flex"}}"></a>\n',
        `<a class="x{{if a 'p-4 flex'}}"></a>`,
        `<a class="x{{if a 'flex p-4'}}"></a>`,
      ],
      [
        '<a class="{{if a "p-4 flex"}}x"></a>\n',
        `<a class="{{if a 'p-4 flex'}}x"></a>`,
        `<a class="{{if a 'flex p-4'}}x"></a>`,
      ],
      ['<a class="p-4 \u00a0 flex m-2"></a>\n', '<a class="\u00a0 m-2 flex p-4"></a>', '<a class="m-2 flex p-4"></a>'],
      // With whitespace in between, nothing touches.
      ['<a class="x {{if a "p-4 flex"}} y"></a>\n', `<a class="x {{if a 'flex p-4'}} y"></a>`, null],
    ] as const;
    const names = rows.map((_, index) => `${index}.hbs`);
    const files = Object.fromEntries(rows.map((row, index) => [names[index], row[0]]));
    const project = { ...version4, ".oxfmtrc.json": '{ "sortTailwindcss": {} }' };

    test("stay separate", async () => {
      for (const [, after, byOxfmt] of rows) expect(after).not.toBe(byOxfmt);
      const result = await format({ ...project, ...files }, names);
      expect(result.stderr).toBe("");
      expect(result.files).toEqual(rows.map(row => row[1]));
      expect(result.exitCode).toBe(0);
    });

    test("pass --debug-check, which compares what would be written", async () => {
      const result = await format({ ...project, ...files }, names, ["--debug-check"]);
      expect(result.stderr).toBe("");
      expect(result.files).toEqual(rows.map(row => row[0]));
      expect(result.exitCode).toBe(0);
    });
  });

  test("writes nothing into the project, not even while Tailwind is running", async () => {
    // When it's loaded, the stub lists the project and throws if there's a file that the test didn't create.
    const checkFiles = `const { readdirSync } = require("node:fs");
const now = readdirSync(require("node:path").join(__dirname, "../.."), { recursive: true, encoding: "utf8" }).sort();
const before = JSON.parse(process.env.FILES_OF_THE_TEST);
if (now.join() !== before.join()) throw new Error("There is " + now.filter(it => !before.includes(it)).join(", "));
`;
    using dir = tempDir("bun-format-tailwind", {
      ...version4,
      "node_modules/tailwindcss/index.js": checkFiles + version4["node_modules/tailwindcss/index.js"],
      ".oxfmtrc.json": '{ "sortTailwindcss": {} }\n',
      "a.jsx": input,
    });
    const before = listed(String(dir));
    await using proc = spawn({
      cmd: [bunExe(), "fmt", "--log-level=warn", "."],
      env: { ...bunEnv, FILES_OF_THE_TEST: JSON.stringify(before) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited, proc.stdout.text()]);
    expect(stderr).toBe("");
    expect(readFileSync(join(String(dir), "a.jsx"), "utf8")).toBe(sorted);
    expect(listed(String(dir))).toEqual(before);
    expect(exitCode).toBe(0);
  });

  // As with Nix, an image layer owned by root, or a sandbox. Skipped as root, which can write anywhere.
  test.skipIf(isWindows || process.getuid?.() === 0)("works with read-only packages", async () => {
    using dir = tempDir("bun-format-tailwind", {
      ...version4,
      ".oxfmtrc.json": '{ "sortTailwindcss": {} }\n',
      "a.jsx": input,
    });
    const directories = ["node_modules/tailwindcss", "node_modules"].map(it => join(String(dir), it));
    for (const it of directories) chmodSync(it, 0o555);
    try {
      expect(await formatIn(String(dir), ["a.jsx"])).toMatchObject({ stderr: "", files: [sorted], exitCode: 0 });
    } finally {
      for (const it of directories.reverse()) chmodSync(it, 0o755);
    }
  });

  test("loads Tailwind CSS 4 with `stylesheet`, relative to the configuration file's directory", async () => {
    const config = JSON.stringify({ sortTailwindcss: { stylesheet: "./css/app.css" } });
    const files = { ...version4, ".oxfmtrc.json": config, "css/app.css": "/* reversed */\n", "src/a.jsx": sorted };
    const result = await format(files, ["src/a.jsx"]);
    expect(result).toMatchObject({ stderr: "", files: [reversed], exitCode: 0 });
  });

  test("loads Tailwind CSS 3 with `config`, or with the nearest tailwind.config.*", async () => {
    const files = { ...version3, "other.js": "module.exports = { reversed: true };\n", "src/a.jsx": input };
    const nearest = { ".oxfmtrc.json": '{ "sortTailwindcss": true }', "tailwind.config.ts": "export default {};\n" };
    expect(await format({ ...files, ...nearest }, ["src/a.jsx"])).toMatchObject({ stderr: "", files: [sorted] });
    const explicit = { ".oxfmtrc.json": '{ "sortTailwindcss": { "config": "other.js" } }' };
    expect(await format({ ...files, ...explicit, "src/a.jsx": sorted }, ["src/a.jsx"])).toMatchObject({
      stderr: "",
      files: [reversed],
    });
  });

  // Same as prettier-plugin-tailwindcss 0.8.1 with Prettier 3.9.9.
  test("`process.cwd()` in a tailwind.config.js is the directory where the command runs", async () => {
    using dir = tempDir("bun-format-tailwind", {
      ...version3,
      ".oxfmtrc.json": '{ "sortTailwindcss": true }',
      "tailwind.config.js": `module.exports = { reversed: require("node:path").basename(process.cwd()) === "sub" };\n`,
      "sub/a.jsx": sorted,
      "sub/b.jsx": sorted,
    });
    const below = await formatIn(join(String(dir), "sub"), ["a.jsx"], ["a.jsx"]);
    const fromRoot = await formatIn(String(dir), ["sub/b.jsx"], ["sub/b.jsx"]);
    expect([below, fromRoot]).toMatchObject([
      { stderr: "", files: [reversed] },
      { stderr: "", files: [sorted] },
    ]);
  });

  test("each workspace package uses its own Tailwind CSS", async () => {
    const inPackage = (files: Record<string, string>, directory: string) =>
      Object.fromEntries(Object.entries(files).map(([name, text]) => [`${directory}/${name}`, text]));
    const result = await format(
      {
        ".oxfmtrc.json": '{ "sortTailwindcss": true }',
        ...inPackage({ ...version4, "a.jsx": input }, "packages/four"),
        ...inPackage(
          { ...version3, "tailwind.config.js": "module.exports = { reversed: true };\n", "a.jsx": sorted },
          "packages/three",
        ),
      },
      ["packages/four/a.jsx", "packages/three/a.jsx"],
    );
    expect(result).toMatchObject({ stderr: "", files: [sorted, reversed], exitCode: 0 });
  });

  test.each([".pnpm", ".bun"])(
    "finds the package in %s if only another package in the workspace depends on it",
    async store => {
      const hoisted = Object.fromEntries(
        Object.entries(version4).map(([name, text]) => [
          name.replace("node_modules/", `node_modules/${store}/node_modules/`),
          text,
        ]),
      );
      const files = { ".oxfmtrc.json": '{ "sortTailwindcss": true }', ...hoisted, "apps/desktop/a.jsx": input };
      expect(await format(files, ["apps/desktop/a.jsx"])).toMatchObject({ stderr: "", files: [sorted], exitCode: 0 });
    },
  );

  // oxfmt 0.72 sorts them in the order of its bundled Tailwind CSS.
  test("without the package, silently leaves the classes unsorted and formats the rest", async () => {
    using dir = tempDir("bun-format-tailwind", {
      "package.json": "{}",
      ".oxfmtrc.json": '{ "sortTailwindcss": {} }',
      "card.tsx": 'export const Card = ( ) => <div className="p-4 flex">hi</div>\n',
      "plain.tsx": 'export const Plain = ( ) => <div className="card">hi</div>\n',
      "done.tsx": 'export const Done = () => <div className="p-4 flex">hi</div>;\n',
    });
    const names = ["card.tsx", "plain.tsx", "done.tsx"];
    const list = ["--list-different", "--log-level=log", ...names];
    expect(await formatIn(String(dir), [], list)).toEqual({
      stdout: "card.tsx\nplain.tsx\n",
      stderr: "",
      exitCode: 1,
      files: [],
    });
    expect(await formatIn(String(dir), names, names)).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
      files: [
        'export const Card = () => <div className="p-4 flex">hi</div>;\n',
        'export const Plain = () => <div className="card">hi</div>;\n',
        'export const Done = () => <div className="p-4 flex">hi</div>;\n',
      ],
    });
    // The written files pass --check.
    expect(await formatIn(String(dir), [], list)).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
      files: [],
    });
    const checked = await formatIn(String(dir), [], ["--check", "--log-level=log", ...names]);
    expect(checked.stdout).toContain("All matched files use the correct format.\n");
    expect(checked).toMatchObject({ stderr: "", exitCode: 0 });
  });

  test("without the package: files in many directories and languages, with any flag", async () => {
    const files = {
      ".oxfmtrc.json": '{ "sortTailwindcss": { "stylesheet": "./app.css", "functions": ["cn"] } }',
      ...Object.fromEntries(["z", "c", "x", "b", "y"].map(name => [`${name}/a.jsx`, `${input}a  ;\n`])),
      "a.html": '<a   class="p-4 flex m-2">x</a>\n',
      "a.vue": '<template>\n  <a   class="p-4 flex m-2">x</a>\n</template>\n',
      "a.css": "a{\n  @apply p-4 flex m-2;\n}\n",
      "a.js": "cn('p-4 flex m-2')\n",
    };
    const names = ["z/a.jsx", "b/a.jsx", "a.html", "a.vue", "a.css", "a.js"];
    const expected = {
      stderr: "",
      files: [
        `${input}a;\n`,
        `${input}a;\n`,
        '<a class="p-4 flex m-2">x</a>\n',
        '<template>\n  <a class="p-4 flex m-2">x</a>\n</template>\n',
        "a {\n  @apply p-4 flex m-2;\n}\n",
        'cn("p-4 flex m-2");\n',
      ],
      exitCode: 0,
    };
    expect(await format(files, names)).toMatchObject(expected);
    expect(await format(files, names, ["--allow-unsupported"])).toMatchObject(expected);
    expect(await format(files, names, ["--threads=1"])).toMatchObject(expected);
    // Same as without the option.
    expect(await format({ ...files, ".oxfmtrc.json": "{}" }, names)).toMatchObject(expected);
  });

  test("a workspace without the package next to one that has it", async () => {
    const inWeb = Object.entries(version4).map(([name, text]) => [`web/${name}`, text]);
    const files = {
      ".oxfmtrc.json": '{ "sortTailwindcss": true }',
      ...Object.fromEntries(inWeb),
      "web/a.jsx": `${input}a  ;\n`,
      "api/a.jsx": `${input}a  ;\n`,
    };
    expect(await format(files, ["web/a.jsx", "api/a.jsx"])).toMatchObject({
      stderr: "",
      files: [`${sorted}a;\n`, `${input}a;\n`],
      exitCode: 0,
    });
  });

  // oxfmt 0.72 exits with 0. If the package can't be loaded, it falls back to its bundled Tailwind CSS. If a file is
  // missing, it leaves the classes unsorted, and only reports that for `config`.
  test.each<[string, Record<string, string>, RegExp]>([
    [
      "the package can't be loaded",
      { ...version4, "node_modules/tailwindcss/index.js": 'throw new Error("It is broken.");\n' },
      /^error: sortTailwindcss: \S+node_modules\/tailwindcss: It is broken\.$/m,
    ],
    [
      "`stylesheet` doesn't exist",
      { ...version4, ".oxfmtrc.json": '{ "sortTailwindcss": { "stylesheet": "./none.css" } }' },
      /^error: sortTailwindcss: \S+\/none\.css: ENOENT/m,
    ],
    [
      "`config` doesn't exist",
      { ...version3, ".oxfmtrc.json": '{ "sortTailwindcss": { "config": "./none.js" } }' },
      /^error: sortTailwindcss: \S+\/none\.js: Cannot find module/m,
    ],
    [
      "`config` is set and version 4 is installed",
      { ...version4, ".oxfmtrc.json": '{ "sortTailwindcss": { "config": "./a.js" } }', "a.js": "" },
      /^error: sortTailwindcss: \S+\/a\.js: `config` only works with Tailwind CSS 3, and \S+ is another version$/m,
    ],
  ])("with the package, it's still an error if %s", async (_, files, message) => {
    const all = { ".oxfmtrc.json": '{ "sortTailwindcss": true }', ...files, "a.jsx": `${input}a  ;\n` };
    const result = await format(all, ["a.jsx"]);
    expect(result.stderr).toMatch(message);
    expect(result.stderr).toContain(`error: a.jsx: ${unknown} It was not formatted.\n`);
    expect(result).toMatchObject({ files: [`${input}a  ;\n`], exitCode: 2 });
  });

  test("classes that Tailwind doesn't know come first, in their original order", async () => {
    const files = { ...version4, ".oxfmtrc.json": '{ "sortTailwindcss": true }' };
    const result = await format({ ...files, "a.jsx": '<a className="p-4 card flex big" />;\n' }, ["a.jsx"]);
    expect(result).toMatchObject({ stderr: "", files: ['<a className="card big flex p-4" />;\n'], exitCode: 0 });
  });

  // oxfmt 0.72 can't read such a file. The expected order is the one it produces for the same text in UTF-8.
  test("sorts classes in a file that isn't UTF-8 and preserves its bytes", async () => {
    const files = {
      "latin1.jsx": `<a className="p-4 content-['caf\xE9'] flex m-2"   />;\n`,
      "two.jsx": `<a className="p-4 content-['caf\xE8'] flex content-['caf\xE9'] m-2"   />;\n`,
      "lone.html": `<a class="p-4 content-['\x80'] flex m-2"   >x</a>\n`,
      "cut.css": "a {\n  @apply p-4 content-['\xE2\x82'] flex   m-2;\n}\n",
      "zero.jsx": `<a className="p-4 content-['\0'] flex m-2"   />;\n`,
      "outside.jsx": `// caf\xE9\n<a className="p-4 flex m-2" title="caf\xE9"   />;\n`,
    };
    const expected = {
      "latin1.jsx": `<a className="content-['caf\xE9'] m-2 flex p-4" />;\n`,
      "two.jsx": `<a className="content-['caf\xE8'] content-['caf\xE9'] m-2 flex p-4" />;\n`,
      "lone.html": `<a class="content-['\x80'] m-2 flex p-4">x</a>\n`,
      "cut.css": "a {\n  @apply content-['\xE2\x82'] m-2 flex p-4;\n}\n",
      "zero.jsx": `<a className="content-['\0'] m-2 flex p-4" />;\n`,
      "outside.jsx": `// caf\xE9\n<a className="m-2 flex p-4" title="caf\xE9" />;\n`,
    };
    using dir = tempDir("bun-format-tailwind", {
      ...version4,
      ".oxfmtrc.json": '{ "sortTailwindcss": true }',
      ...Object.fromEntries(Object.entries(files).map(([name, text]) => [name, Buffer.from(text, "latin1")])),
    });
    expect(await formatIn(String(dir), [])).toMatchObject({ stderr: "", exitCode: 0 });
    const read = (name: string) => readFileSync(join(String(dir), name), "latin1");
    expect(Object.fromEntries(Object.keys(files).map(name => [name, read(name)]))).toEqual(expected);

    await using proc = spawn({
      cmd: [bunExe(), "fmt", "--stdin-filepath", "a.jsx"],
      env: bunEnv,
      cwd: String(dir),
      stdin: Buffer.from(files["latin1.jsx"], "latin1"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
    expect({ stdout: Buffer.from(stdout).toString("latin1"), stderr }).toEqual({
      stdout: expected["latin1.jsx"],
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("reports a file with a class that Tailwind returns no answer for, and leaves it unchanged", async () => {
    const entry = "node_modules/tailwindcss/index.js";
    using dir = tempDir("bun-format-tailwind", {
      ...version4,
      [entry]: version4[entry].replace("classes.map(", 'classes.filter(name => name !== "odd").map('),
      ".oxfmtrc.json": '{ "sortTailwindcss": true }',
      "a.jsx": input,
      "b.jsx": '<a className="p-4 odd flex" />;\nb  ;\n',
      "c.jsx": '<a className="p-4 flex odd" />;\n',
    });
    const result = await formatIn(String(dir), ["a.jsx", "b.jsx", "c.jsx"]);
    expect(result.stderr.split("\n").filter(line => line.startsWith("error:"))).toEqual([
      `error: b.jsx: ${unknown} It was not formatted.`,
      `error: c.jsx: ${unknown} It was not formatted.`,
    ]);
    expect(result.files).toEqual([
      sorted,
      '<a className="p-4 odd flex" />;\nb  ;\n',
      '<a className="p-4 flex odd" />;\n',
    ]);
    expect(result.exitCode).toBe(2);
    const piped = await formatIn(String(dir), [], ["--stdin-filepath", "d.jsx"], '<a className="p-4 odd flex" />;\n');
    expect(piped).toMatchObject({ stdout: "", stderr: `error: d.jsx: ${unknown}\n`, exitCode: 2 });
  });

  // oxfmt 0.72 uses the order of its bundled Tailwind CSS there, regardless of the project's.
  test.skipIf(!isLinux)(
    "reports an error for a Tailwind CSS in a directory whose name isn't UTF-8, which can't be loaded",
    async () => {
      using dir = tempDir("bun-format-tailwind", {
        ...version4,
        ".oxfmtrc.json": '{ "sortTailwindcss": true }',
        "a.jsx": input,
      });
      const inside = (name: string) =>
        Buffer.concat([Buffer.from(join(String(dir), "caf")), Buffer.from([0xe9]), Buffer.from(name)]);
      mkdirSync(inside("/node_modules/tailwindcss"), { recursive: true });
      for (const [name, text] of Object.entries({ ...version4, "b.jsx": `${input}b  ;\n` }))
        writeFileSync(inside(`/${name}`), text);
      const result = await formatIn(String(dir), ["a.jsx"]);
      expect(result.stderr.split("\n").filter(line => /^error:|not formatted/.test(line))).toEqual([
        `error: caf\uFFFD/b.jsx: ${unknown} It was not formatted.`,
        `error: sortTailwindcss: ${String(dir)}/caf\uFFFD/node_modules/tailwindcss: cannot load Tailwind CSS from a path that is not UTF-8`,
        "1 file with classes was not formatted.",
      ]);
      expect(result.files).toEqual([sorted]);
      expect(readFileSync(inside("/b.jsx"), "utf8")).toBe(`${input}b  ;\n`);
      expect(result.exitCode).toBe(2);
    },
  );

  // This is what an editor does in a repository whose root has no packages.
  test("stdin for a file in a project below the working directory", async () => {
    const inWeb = Object.entries(version4).map(([name, text]) => [`web/${name}`, text]);
    const files = { "web/.oxfmtrc.json": '{ "sortTailwindcss": true }', ...Object.fromEntries(inWeb) };
    using dir = tempDir("bun-format-tailwind", files);
    const result = await formatIn(String(dir), [], ["--stdin-filepath", "web/a.jsx"], input);
    expect(result).toMatchObject({ stderr: "", stdout: sorted, exitCode: 0 });
  });

  // This is what an editor runs.
  test("without the package, stdin is formatted except for its classes, like a file", async () => {
    using dir = tempDir("bun-format-tailwind", { ".oxfmtrc.json": '{ "sortTailwindcss": true }' });
    const from = ["--stdin-filepath", "a.jsx"];
    expect(await formatIn(String(dir), [], from, `${input}a  ;\n`)).toMatchObject({
      stdout: `${input}a;\n`,
      stderr: "",
      exitCode: 0,
    });
    // oxfmt has no --check for stdin.
    using plain = tempDir("bun-format-tailwind", {});
    const check = ["--sort-tailwindcss", "--check", ...from];
    expect(await formatIn(String(plain), [], check, `${input}a;\n`)).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
  });

  test("every run that finds classes loads Tailwind once and leaves nothing behind", async () => {
    const entry = "node_modules/tailwindcss/index.js";
    const counts = `require("node:fs").appendFileSync(__dirname + "/loaded.txt", "x");\n`;
    using dir = tempDir("bun-format-tailwind", {
      ...version4,
      [entry]: counts + version4[entry],
      ".oxfmtrc.json": '{ "sortTailwindcss": { "stylesheet": "app.css" } }',
      "app.css": "",
      "a.jsx": input,
    });
    const write = (name: string, text: string) => writeFileSync(join(String(dir), name), text);
    const names = ["a.jsx", "node_modules/tailwindcss/loaded.txt"];
    expect(await formatIn(String(dir), names)).toMatchObject({ stderr: "", files: [sorted, "x"] });
    // The same classes in another order, in another file.
    write("b.jsx", '<a className="flex p-4 m-2 flex" />;\n');
    expect(await formatIn(String(dir), [...names, "b.jsx"])).toMatchObject({
      stderr: "",
      files: [sorted, "xx", sorted],
    });
    // Tailwind isn't loaded for a file without classes.
    write("c.js", "c  ;\n");
    expect(await formatIn(String(dir), ["c.js", names[1]], ["c.js"])).toMatchObject({
      stderr: "",
      files: ["c;\n", "xx"],
    });
    write("a.jsx", '<a className="m-1 p-4" />;\n');
    write("app.css", "/* reversed */\n");
    expect(await formatIn(String(dir), names)).toMatchObject({
      stderr: "",
      files: ['<a className="p-4 m-1" />;\n', "xxx"],
    });
    expect(readdirSync(join(String(dir), "node_modules"))).toEqual(["tailwindcss"]);
  });

  test("a Tailwind that can't be loaded only fails its own files, on the first run and on later ones", async () => {
    const files = {
      ...version3,
      ".oxfmtrc.json": '{ "sortTailwindcss": true }',
      "one/tailwind.config.js": 'module.exports = { own: ["mine"] };\n',
      "one/a.jsx": '<a className="mine p-4 flex" />;\n',
      "two/tailwind.config.js": "module.exports = { reversed: true };\n",
      "two/a.jsx": '<a className="flex mine p-4" />;\n',
      "three/tailwind.config.js": 'throw new Error("It has no such plugin.");\n',
      "three/a.jsx": '<a className="p-4 flex" />;\na  ;\n',
      "four/a.jsx": '<a className="p-4 flex" />;\n',
      // More configs that fail. Only the class order could change in their files.
      ...Object.fromEntries(
        ["z", "c", "x", "b", "y", "a"].flatMap(name => [
          [`${name}/tailwind.config.js`, 'throw new Error("Nor has it this one.");\n'],
          [`${name}/a.jsx`, '<a className="p-4 flex" />;\n'],
        ]),
      ),
    };
    const names = ["one/a.jsx", "two/a.jsx", "three/a.jsx", "four/a.jsx"];
    const expected = [
      '<a className="flex p-4 mine" />;\n',
      '<a className="mine p-4 flex" />;\n',
      files["three/a.jsx"],
      '<a className="flex p-4" />;\n',
    ];
    for (const allows of [false, true]) {
      using dir = tempDir("bun-format-tailwind", files);
      const flags = allows ? ["--allow-unsupported", "."] : ["."];
      const lists = [];
      for (let run = 0; run < 3; run++) {
        const list = ["--log-level=log", "--list-different", ...flags];
        const { stdout, stderr, exitCode } = await formatIn(String(dir), [], list);
        lists.push({ files: stdout.split("\n").filter(it => it.endsWith(".jsx")), stdout, stderr, exitCode });
      }
      expect(lists[0].files).toEqual(allows ? names.toSorted() : ["four/a.jsx", "one/a.jsx", "two/a.jsx"]);
      // One error, or one warning, for all of them.
      expect(lists[0].stderr).toContain(`${allows ? "warn:" : "error:"} sortTailwindcss: `);
      expect(lists[0].stderr).toContain(
        `\nsortTailwindcss: ${join(String(dir), "three/tailwind.config.js").replaceAll("\\", "/")}: It has no such plugin.\n`,
      );
      expect(lists[0].stderr).toContain(
        allows ? "Classes were not sorted in 7 files." : "7 files with classes were not formatted.",
      );
      expect(Array.from(lists[0].stderr.matchAll(/(\w+)\/tailwind\.config\.js: /g), it => it[1])).toEqual([
        "a",
        "b",
        "c",
        "three",
        "x",
        "y",
        "z",
      ]);
      expect(lists[1]).toEqual(lists[0]);
      expect(lists[2]).toEqual(lists[0]);
      const written = await formatIn(String(dir), names, flags);
      expect(written.files).toEqual(expected.with(2, allows ? '<a className="p-4 flex" />;\na;\n' : expected[2]));
      expect(written.exitCode).toBe(allows ? 0 : 2);
    }
  });

  test("doesn't run anything for files without classes", async () => {
    const files = { ".oxfmtrc.json": '{ "sortTailwindcss": true }', "a.jsx": '<a className="one" b="c d" />;\n' };
    expect(await format(files, ["a.jsx"])).toMatchObject({ stderr: "", exitCode: 0 });
  });

  // The expected results come from Prettier 3.9.9 with prettier-plugin-tailwindcss 0.8.1 and tailwindcss 4.3.3.
  describe("prettier-plugin-tailwindcss in a Prettier config", () => {
    const plugin = "prettier-plugin-tailwindcss";
    /** A stub of the parts of the plugin that a configuration can see. None of it runs. */
    const installed = {
      [`node_modules/${plugin}/package.json`]: JSON.stringify({ name: plugin, type: "module", exports: "./index.mjs" }),
      [`node_modules/${plugin}/index.mjs`]:
        'export const options = { tailwindConfig: { type: "string" } };\nexport const parsers = {};\n',
    };
    const project = { ...version4, ...installed };
    const config = (options: object) => ({ ".prettierrc": JSON.stringify({ plugins: [plugin], ...options }) });
    const shared = (main: string, text: string) => ({
      "node_modules/@acme/config/package.json": JSON.stringify({ name: "@acme/config", main }),
      [`node_modules/@acme/config/${main}`]: text,
    });

    test.each<[string, Record<string, string>, string[]?]>([
      ["its name", config({})],
      ["a path", { ".prettierrc": `{ "plugins": ["./node_modules/${plugin}/index.mjs"] }` }],
      ["require.resolve()", { "prettier.config.cjs": `module.exports = { plugins: [require.resolve("${plugin}")] };` }],
      [
        "import.meta.resolve()",
        { "prettier.config.mjs": `export default { plugins: [import.meta.resolve("${plugin}")] };` },
      ],
      ["a URL", { "prettier.config.mjs": `export default { plugins: [new URL(import.meta.resolve("${plugin}"))] };` }],
      ["the module", { "prettier.config.mjs": `import * as it from "${plugin}";\nexport default { plugins: [it] };` }],
      ["import()", { "prettier.config.mjs": `export default { plugins: [await import("${plugin}")] };` }],
      ["require()", { "prettier.config.cjs": `module.exports = { plugins: [require("${plugin}")] };` }],
      [
        "an override",
        { ".prettierrc": `{ "overrides": [{ "files": "*.jsx", "options": { "plugins": ["${plugin}"] } }] }` },
      ],
      ["--plugin", {}, ["--plugin", plugin]],
      ["--plugin next to a config", { ".prettierrc": "{}" }, [`--plugin=${plugin}`]],
      ["package.json", { "package.json": `{ "prettier": { "plugins": ["${plugin}"] } }` }],
      ["YAML", { ".prettierrc.yaml": `plugins:\n  - ${plugin}\n` }],
      ["TOML", { ".prettierrc.toml": `plugins = ["${plugin}"]\n` }],
      [
        "a shared config",
        { "package.json": '{ "prettier": "@acme/config" }', ...shared("a.json", `{ "plugins": ["${plugin}"] }`) },
      ],
      [
        "a shared config in JavaScript",
        {
          ".prettierrc": '"@acme/config"',
          ...shared("a.js", `module.exports = { plugins: [require.resolve("${plugin}")] };`),
        },
      ],
    ])("is recognized when it's specified by %s", async (_, files, flags = []) => {
      const result = await format({ ...project, ...files, "a.jsx": input }, ["a.jsx"], flags);
      expect(result).toMatchObject({ stderr: "", files: [sorted], exitCode: 0 });
    });

    test("applies to the files whose plugin list includes it", async () => {
      const overrides = [
        { files: "off/**", options: { plugins: [] } },
        { files: "*.tsx", options: { tailwindPreserveDuplicates: true } },
      ];
      const twice = '<a className="p-4 flex p-4" />;\n';
      const files = { ...config({ overrides }), "a.jsx": input, "off/a.jsx": input, "a.tsx": twice, "b.jsx": twice };
      const result = await format({ ...project, ...files }, ["a.jsx", "off/a.jsx", "a.tsx", "b.jsx"]);
      expect(result).toMatchObject({
        stderr: "",
        files: [sorted, input, '<a className="flex p-4 p-4" />;\n', '<a className="flex p-4" />;\n'],
        exitCode: 0,
      });
    });

    test.each<[object, string, string]>([
      // No function's arguments are sorted unless the config lists it.
      [{}, 'cn("p-4 flex");\nclsx("p-4 flex");\ntwMerge("p-4 flex");\ntw`p-4 flex`;\n', ""],
      [
        { tailwindFunctions: ["cn"] },
        'cn("p-4 flex");\nclsx("p-4 flex");\ncn`p-4 flex`;\n',
        'cn("flex p-4");\nclsx("p-4 flex");\ncn`flex p-4`;\n',
      ],
      [
        { tailwindFunctions: ["cn"], overrides: [{ files: "*.jsx", options: { tailwindFunctions: ["tw"] } }] },
        'cn("p-4 flex");\ntw("p-4 flex");\n',
        'cn("p-4 flex");\ntw("flex p-4");\n',
      ],
      [
        { tailwindAttributes: ["mine"] },
        '<a mine="p-4 flex" other="p-4 flex" class="p-4 flex" />;\n',
        '<a mine="flex p-4" other="p-4 flex" class="flex p-4" />;\n',
      ],
      [{}, '<a className="  p-4   flex  p-4 x x" />;\n', '<a className="x x flex p-4" />;\n'],
      [
        { tailwindPreserveWhitespace: true },
        '<a className="  p-4   flex  " />;\n',
        '<a className="  flex   p-4  " />;\n',
      ],
      [{ tailwindPreserveDuplicates: true }, '<a className="p-4 flex p-4" />;\n', '<a className="flex p-4 p-4" />;\n'],
    ])("supports its options and defaults: %j", async (options, before, after) => {
      const result = await format({ ...project, ...config(options), "a.jsx": before }, ["a.jsx"]);
      expect(result).toMatchObject({ stderr: "", files: [after || before], exitCode: 0 });
    });

    // The plugin prints the same text, after the config's directory and without the `warn:`.
    const deprecated = (name: string) =>
      `warn: Deprecated: Use the \`tailwindStylesheet\` option for v4 projects instead of \`${name}\`.\n`;
    const both =
      "warn: You have specified a Tailwind CSS stylesheet and a Tailwind CSS config at the same time. Use stylesheetPath unless you are using v3. Preferring the stylesheet.\n";
    test.each<[object, string]>([
      [{ tailwindStylesheet: "./css/app.css" }, ""],
      [{ tailwindStylesheet: "css/app.css" }, ""],
      [{ tailwindEntryPoint: "./css/app.css" }, deprecated("tailwindEntryPoint")],
      [{ tailwindConfig: "./css/app.css" }, deprecated("tailwindConfig")],
      [{ tailwindStylesheet: "./css/app.css", tailwindEntryPoint: "./none.css", tailwindConfig: "./none.js" }, both],
      [{ overrides: [{ files: "src/**", options: { tailwindStylesheet: "./css/app.css" } }] }, ""],
    ])("a path is relative to the config: %j", async (options, stderr) => {
      const files = { ...config(options), "css/app.css": "/* reversed */\n", "src/a.jsx": sorted };
      using dir = tempDir("bun-format-tailwind", { ...project, ...files });
      const result = await formatIn(join(String(dir), "src"), ["a.jsx"], ["a.jsx"]);
      expect(result).toMatchObject({ stderr, files: [reversed], exitCode: 0 });
    });

    test.each(["tailwindStylesheet", "tailwindEntryPoint", "tailwindConfig"])("an empty %s is ignored", async name => {
      const result = await format({ ...project, ...config({ [name]: "" }), "a.jsx": input }, ["a.jsx"]);
      expect(result).toMatchObject({ stderr: "", files: [sorted], exitCode: 0 });
    });

    test("a path is relative to the working directory if the config is passed to --config", async () => {
      const files = {
        "config/.prettierrc": config({ tailwindStylesheet: "./app.css" })[".prettierrc"],
        "a.jsx": sorted,
      };
      const flags = ["--config", "config/.prettierrc"];
      const inCwd = await format({ ...project, ...files, "app.css": "/* reversed */\n" }, ["a.jsx"], flags);
      expect(inCwd).toMatchObject({ stderr: "", files: [reversed], exitCode: 0 });
      const elsewhere = await format({ ...project, ...files, "config/app.css": "/* reversed */\n" }, ["a.jsx"], flags);
      expect(elsewhere).toMatchObject({ files: [sorted], exitCode: 2 });
      expect(elsewhere.stderr).toContain("app.css");
    });

    test("loads Tailwind CSS 3 with tailwindConfig", async () => {
      const files = { ...version3, ...installed, ...config({ tailwindConfig: "./other.js" }), "src/a.jsx": sorted };
      const result = await format({ ...files, "other.js": "module.exports = { reversed: true };\n" }, ["src/a.jsx"]);
      expect(result).toMatchObject({ stderr: "", files: [reversed], exitCode: 0 });
    });

    test("tailwindPackageName sets the Tailwind CSS package name", async () => {
      const renamed = Object.fromEntries(
        Object.entries(version4).map(([name, text]) => [name.replace("/tailwindcss/", "/@acme/tw/"), text]),
      );
      const files = { ...renamed, ...installed, ...config({ tailwindPackageName: "@acme/tw" }), "a.jsx": input };
      expect(await format(files, ["a.jsx"])).toMatchObject({ stderr: "", files: [sorted], exitCode: 0 });
    });

    test.each([
      [
        { tailwindFunctions: "cn" },
        'Invalid tailwindFunctions value. Expected an array of a string, but received "cn".',
      ],
      [
        { tailwindAttributes: [1] },
        "Invalid tailwindAttributes value. Expected an array of a string, but received [1].",
      ],
      [
        { tailwindPreserveWhitespace: "yes" },
        'Invalid tailwindPreserveWhitespace value. Expected true or false, but received "yes".',
      ],
      [{ tailwindStylesheet: 1 }, "Invalid tailwindStylesheet value. Expected a string, but received 1."],
      [{ tailwindStylesheet: null }, "Invalid tailwindStylesheet value. Expected a string, but received null."],
      [{ tailwindConfig: null }, "Invalid tailwindConfig value. Expected a string, but received null."],
      [{ tailwindEntryPoint: null }, "Invalid tailwindEntryPoint value. Expected a string, but received null."],
      [{ tailwindPackageName: null }, "Invalid tailwindPackageName value. Expected a string, but received null."],
      [
        { tailwindFunctions: null },
        "Invalid tailwindFunctions value. Expected an array of a string, but received null.",
      ],
      [
        { tailwindAttributes: null },
        "Invalid tailwindAttributes value. Expected an array of a string, but received null.",
      ],
      [
        { tailwindPreserveWhitespace: null },
        "Invalid tailwindPreserveWhitespace value. Expected true or false, but received null.",
      ],
      [
        { tailwindPreserveDuplicates: null },
        "Invalid tailwindPreserveDuplicates value. Expected true or false, but received null.",
      ],
    ])("rejects a value of the wrong type: %j", async (options, message) => {
      const result = await format({ ...project, ...config(options), "a.jsx": input }, ["a.jsx"]);
      expect(result.stderr).toBe(`error: ${message}\n`);
      expect(result.files).toEqual([input]);
      expect(result.exitCode).not.toBe(0);
    });

    test("without it its options are unknown, and with it so is an option it doesn't have", async () => {
      const options = { tailwindFunctions: ["cn"], tailwindConfig: "./x.js", tailwindPreserveWhitespace: true };
      const without = await format({ ...project, ".prettierrc": JSON.stringify(options), "a.jsx": input }, ["a.jsx"]);
      expect(without).toMatchObject({
        stderr:
          'warn: Ignored unknown option { tailwindFunctions: ["cn"] }.\n' +
          'warn: Ignored unknown option { tailwindConfig: "./x.js" }.\n' +
          "warn: Ignored unknown option { tailwindPreserveWhitespace: true }.\n",
        files: [input],
        exitCode: 0,
      });
      const unknown = await format({ ...project, ...config({ tailwindOther: 1 }), "a.jsx": input }, ["a.jsx"]);
      expect(unknown).toMatchObject({
        stderr: "warn: Ignored unknown option { tailwindOther: 1 }.\n",
        files: [sorted],
        exitCode: 0,
      });
    });

    test("another plugin next to it is still rejected by name", async () => {
      const files = { ".prettierrc": JSON.stringify({ plugins: [plugin, "prettier-plugin-other"] }), "a.jsx": input };
      const result = await format({ ...project, ...files }, ["a.jsx"], ["--log-level=log", "--check"]);
      expect(result.stderr).toContain("plugins that bun fmt does not include: prettier-plugin-other\n");
      // "has no effect" is only printed in a run that continues without the plugin.
      expect(result.stderr).not.toContain("has no effect");
      // Nothing is printed about files that weren't checked.
      expect(result.stdout).toBe("Checking formatting...\n");
      expect(result.files).toEqual([input]);
      expect(result.exitCode).toBe(2);
    });

    const names = { tailwindFunctions: ["cn", "/^tw/"], tailwindAttributes: ["mine", "/^data-cls/"] };

    test("finds classes where the plugin does, not where oxfmt does", async () => {
      // Each file's lines, before and after.
      const rows: Record<string, [string, string][]> = {
        "a.jsx": [
          // At any depth in an argument or an attribute value.
          ['cn(other("p-4 flex"));', 'cn(other("flex p-4"));'],
          ['<a className={other("p-4 flex")} />;', '<a className={other("flex p-4")} />;'],
          ['cn(a === "p-4 flex" && "flex m-2");', 'cn(a === "flex p-4" && "m-2 flex");'],
          ['cn(<b title={"p-4 flex"} />);', 'cn(<b title={"flex p-4"} />);'],
          ["cn(other`p-4 flex`);", "cn(other`flex p-4`);"],
          [
            'cn({ "p-4 flex": a, [`p-1 m-2`]: b, ["p-2 m-3"]: c });',
            'cn({ "flex p-4": a, [`m-2 p-1`]: b, ["m-3 p-2"]: c });',
          ],
          // In chains.
          ['cn("p-4 flex").b("p-4 flex");', 'cn("flex p-4").b("flex p-4");'],
          ['cn.a.b.c("p-4 flex").d("p-4 flex").e("p-4 flex");', 'cn.a.b.c("flex p-4").d("flex p-4").e("flex p-4");'],
          ['x.cn("p-4 flex");', ""],
          ['new cn("p-4 flex");', ""],
          // Patterns.
          ['twx("p-4 flex");', 'twx("flex p-4");'],
          [
            '<a data-cls-x="p-4 flex" mine="p-4 flex" a:className="p-4 flex" />;',
            '<a data-cls-x="flex p-4" mine="flex p-4" a:className="p-4 flex" />;',
          ],
          // In Babel's tree, a call in an optional chain is a different kind of node.
          ['cn?.("p-4 flex");', ""],
          ['cn?.x.y("p-4 flex");', ""],
          // An operand of `+` keeps the space that separates it from the other operand. The search for a `+` stops at
          // the innermost function.
          ['cn(a + (b ? " p-4 flex " : c));', 'cn(a + (b ? " flex p-4" : c));'],
          ['cn("x " + cn(" p-4 flex "));', 'cn("x " + cn("flex p-4"));'],
          ['"x " + cn` p-4 flex ` + " y";', '"x " + cn` flex p-4 ` + " y";'],
          // It looks at the wrong ends of a template's text parts, which leaves more spaces than needed.
          ['cn(`x ${" p-4 flex "} y`);', 'cn(`x ${" flex p-4 "} y`);'],
          ['cn(`${" p-4 flex "}`);', 'cn(`${" flex p-4 "}`);'],
          ['cn(` ${" p-4 flex "} `);', 'cn(` ${"flex p-4"} `);'],
          ["cn(`p-4 flex${a}m-2 p-1`);", ""],
          ["cn(` p-4 flex ${a} p-1 m-2 `);", "cn(`flex p-4 ${a} m-2 p-1`);"],
          // A class list that spanned several lines doesn't keep the element expanded.
          ['<a\n  className="\n    p-4\n    flex\n  "\n/>;', '<a className="flex p-4" />;'],
        ],
        "a.tsx": [
          ['cn?.("p-4 flex");', 'cn?.("flex p-4");'],
          ['cn?.x.y("p-4 flex");', 'cn?.x.y("flex p-4");'],
          ['(cn?.x)("p-4 flex");', ""],
          ['cn!("p-4 flex");', ""],
          ['cn<string>("p-4 flex" as string);', 'cn<string>("flex p-4" as string);'],
          // In this tree it doesn't find a template's text parts.
          ['cn(`x ${" p-4 flex "} y`);', 'cn(`x ${"flex p-4"} y`);'],
          ['cn(`${" p-4 flex "}`);', 'cn(`${"flex p-4"}`);'],
          ['cn(`x${`p-4 flex ${" p-1 m-2 "} p-2 m-3`}y`);', 'cn(`x${`flex p-4 ${"m-2 p-1"} m-3 p-2`}y`);'],
        ],
        "a.css": [["a {\n  @apply p-4 /* c */ flex;\n}", "a {\n  @apply /* c */ flex p-4;\n}"]],
        "a.html": [['<DIV CLASS="p-4 flex">x</DIV>', '<div class="flex p-4">x</div>']],
        "a.mdx": [
          ['<a className="p-4 flex" />\n', '<a className="flex p-4" />\n'],
          ['export const a = cn("p-4 flex");', 'export const a = cn("flex p-4");'],
        ],
        "lwc/a.html": [
          [
            '<template><a class="p-4 flex" onclick={b}>x</a></template>',
            '<template><a class="flex p-4" onclick={b}>x</a></template>',
          ],
        ],
        "a.vue": [
          [
            `<template>\n  <a #x="{ a = cn('p-4 flex') }" v-for="(a = cn('p-4 flex')) in b"></a>\n</template>`,
            `<template>\n  <a #x="{ a = cn('flex p-4') }" v-for="a = cn('flex p-4') in b"></a>\n</template>`,
          ],
        ],
      };
      const text = (at: 0 | 1) => (lines: [string, string][]) => lines.map(it => it[at] || it[0]).join("\n") + "\n";
      const options = { ...names, overrides: [{ files: "lwc/**", options: { parser: "lwc" } }] };
      const files = Object.fromEntries(Object.entries(rows).map(([name, lines]) => [name, text(0)(lines)]));
      const result = await format({ ...project, ...config(options), ...files }, Object.keys(rows));
      expect(result.stderr).toBe("");
      expect(Object.fromEntries(Object.keys(rows).map((name, index) => [name, result.files[index]]))).toEqual(
        Object.fromEntries(Object.entries(rows).map(([name, lines]) => [name, text(1)(lines)])),
      );
      expect(result.exitCode).toBe(0);
    });

    test("keeps a class separate from the template text next to it", async () => {
      // Each row is the code, Bun's output and the plugin's output, which joins `x` and `flex` into one class.
      const rows: Record<string, [string, string, string][]> = {
        "a.tsx": [
          [
            '<a className={`x${a ? " p-4 flex" : ""}`} />;',
            '<a className={`x${a ? " flex p-4" : ""}`} />;',
            '<a className={`x${a ? "flex p-4" : ""}`} />;',
          ],
          [
            '<a className={`${a ? "p-4 flex " : ""}x`} />;',
            '<a className={`${a ? "flex p-4 " : ""}x`} />;',
            '<a className={`${a ? "flex p-4" : ""}x`} />;',
          ],
          ['cn(`x${" p-4 flex "}y`);', 'cn(`x${" flex p-4 "}y`);', 'cn(`x${"flex p-4"}y`);'],
          ['cn(`${a}${" p-4 flex "}${b}`);', 'cn(`${a}${" flex p-4 "}${b}`);', 'cn(`${a}${"flex p-4"}${b}`);'],
          ["cn(`x${` p-4 flex `} e`);", "cn(`x${` flex p-4`} e`);", "cn(`x${`flex p-4`} e`);"],
        ],
        "a.jsx": [
          ['cn(`x ${a} b${" p-4 flex "} e`);', 'cn(`x ${a} b${" flex p-4 "} e`);', 'cn(`x ${a} b${"flex p-4 "} e`);'],
          ['cn(` x${" p-4 flex "} e`);', 'cn(` x${" flex p-4 "} e`);', 'cn(` x${"flex p-4 "} e`);'],
          ['cn(`x${ " p-4 flex "} e`);', 'cn(`x${" flex p-4 "} e`);', 'cn(`x${"flex p-4 "} e`);'],
        ],
        "a.vue": [
          [
            "<template>\n  <a :class=\"`x${a ? ' p-4 flex' : ''}`\"></a>\n</template>",
            "<template>\n  <a :class=\"`x${a ? ' flex p-4' : ''}`\"></a>\n</template>",
            "<template>\n  <a :class=\"`x${a ? 'flex p-4' : ''}`\"></a>\n</template>",
          ],
        ],
      };
      const text = (at: 0 | 1) => (lines: string[][]) => lines.map(it => it[at]).join("\n") + "\n";
      for (const lines of Object.values(rows)) for (const it of lines) expect(it[1]).not.toBe(it[2]);
      const files = Object.fromEntries(Object.entries(rows).map(([name, lines]) => [name, text(0)(lines)]));
      const result = await format({ ...project, ...config(names), ...files }, Object.keys(rows));
      expect(result.stderr).toBe("");
      expect(result.files).toEqual(Object.values(rows).map(text(1)));
      expect(result.exitCode).toBe(0);
    });

    test("listed after @prettier/plugin-oxc it uses that plugin's tree, and listed before it, it does nothing", async () => {
      const code = 'cn?.("p-4 flex");\ncn(`x ${" p-4 flex "} y`);\n';
      const sortedCode = 'cn?.("flex p-4");\ncn(`x ${" flex p-4 "} y`);\n';
      const inVue = (text: string, lang = "") => `<script${lang}>\n${text}</script>\n`;
      const files = { "a.js": code, "a.ts": code, "a.vue": inVue(code), "b.vue": inVue(code, ' lang="ts"') };
      const run = (plugins: string[]) =>
        format(
          { ...project, ".prettierrc": JSON.stringify({ plugins, tailwindFunctions: ["cn"] }), ...files },
          Object.keys(files),
        );
      // @prettier/plugin-oxc doesn't parse the JavaScript in HTML.
      const byBabel = inVue('cn?.("p-4 flex");\ncn(`x ${" flex p-4 "} y`);\n');
      expect(await run(["@prettier/plugin-oxc", plugin])).toMatchObject({
        stderr: "",
        files: [sortedCode, sortedCode, byBabel, inVue(sortedCode, ' lang="ts"')],
      });
      expect(await run([plugin, "@prettier/plugin-oxc"])).toMatchObject({
        stderr: "",
        files: [code, code, byBabel, inVue(code, ' lang="ts"')],
      });
    });

    test("in Angular it looks at a template's text parts as written", async () => {
      const before = "<a [ngClass]=\"`x${a ? ' p-4 flex' : ''}`\" [class]=\"`x ${a ? ' p-4 flex ' : ''} y`\"></a>\n";
      const after =
        "<a\n  [ngClass]=\"`x${a ? ' flex p-4' : ''}`\"\n  [class]=\"`x ${a ? ' flex p-4 ' : ''} y`\"\n></a>\n";
      const result = await format({ ...project, ...config({}), "a.component.html": before }, ["a.component.html"]);
      expect(result).toMatchObject({ stderr: "", files: [after], exitCode: 0 });
    });

    describe("its bundled Tailwind CSS", () => {
      /** A stub of its `createSorter` that knows the classes in order.json. A file with `reversed` reverses the order. */
      const withSorter = {
        ...installed,
        [`node_modules/${plugin}/package.json`]: JSON.stringify({
          name: plugin,
          type: "module",
          exports: { ".": "./index.mjs", "./sorter": "./sorter.mjs" },
        }),
        [`node_modules/${plugin}/sorter.mjs`]: `import { readFileSync } from "node:fs";
const order = ${JSON.stringify(order)};
export async function createSorter({ configPath, stylesheetPath }) {
  const files = [configPath, stylesheetPath].filter(Boolean).map(it => readFileSync(it, "utf8"));
  const sign = files.join().includes("reversed") ? -1 : 1;
  const at = name => (order.includes(name) ? sign * order.indexOf(name) : -Infinity);
  const sortClassLists = lists =>
    lists.map(list => list.toSorted((a, z) => at(a) - at(z)).filter((it, i, all) => !order.includes(it) || all.indexOf(it) === i));
  return { sortClassLists };
}
`,
      };
      const flipped = "module.exports = { reversed: true };\n";

      test.each<[string, Record<string, string>, string]>([
        ["tailwindcss isn't installed", config({}), sorted],
        [
          "tailwindcss isn't installed, with the nearest tailwind.config.js",
          { ...config({}), "tailwind.config.js": flipped },
          reversed,
        ],
        [
          "tailwindcss isn't installed, with a style sheet",
          { ...config({ tailwindStylesheet: "a.css" }), "a.css": "/* reversed */" },
          reversed,
        ],
        [
          "tailwindConfig is set and version 4 is installed",
          { ...version4, ...config({ tailwindConfig: "a.js" }), "a.js": flipped },
          reversed,
        ],
        [
          "tailwindStylesheet is set and version 3 is installed",
          { ...version3, ...config({ tailwindStylesheet: "a.css" }), "a.css": "/* reversed */" },
          reversed,
        ],
      ])("is used if %s", async (_, files, expected) => {
        const before = '<a className="flex x p-4 m-2 x flex" />;\n';
        const result = await format({ ...withSorter, ...files, "src/a.jsx": before }, ["src/a.jsx"]);
        expect(result).toMatchObject({ stderr: "", files: [expected.replace('"', '"x x ')], exitCode: 0 });
      });

      test.each([
        [config({})],
        [config({ tailwindStylesheet: "a.css" })],
        [config({ tailwindPackageName: "@acme/tw" })],
      ])("without it and without the package, classes stay unsorted: %#", async files => {
        const result = await format({ ...files, "a.jsx": `${input}a  ;\n` }, ["a.jsx"]);
        expect(result).toMatchObject({ stderr: "", files: [`${input}a;\n`], exitCode: 0 });
      });

      test.each<[Record<string, string>, string[]]>([
        [
          { ...version4, ...config({ tailwindConfig: "a.js" }), "a.js": flipped },
          [
            "tailwindConfig is for Tailwind CSS 3, and another version is in ",
            `  Run bun add -d ${plugin}, which brings its own`,
          ],
        ],
        [
          { ...version3, ...config({ tailwindStylesheet: "a.css" }), "a.css": "" },
          [
            "tailwindStylesheet is for Tailwind CSS 4, and another version is in ",
            `  Run bun add -d ${plugin}, which brings its own`,
          ],
        ],
      ])("has to be installed for a mismatched option and version: %#", async (files, lines) => {
        const result = await format({ ...files, "a.jsx": input }, ["a.jsx"]);
        for (const line of lines)
          expect(result.stderr).toContain(line.startsWith(" ") ? `\n${line}\n` : `error: sortTailwindcss: ${line}`);
        expect(result.files).toEqual([input]);
        expect(result.exitCode).toBe(2);
      });
    });

    // Each stream gets the same text as in Prettier.
    test("--check prints that an error occurred to stdout and the error itself to stderr", async () => {
      const files = { ...config({}), "tailwind.config.js": 'throw new Error("boom");\n', "a.jsx": input };
      using dir = tempDir("bun-format-tailwind", { ...version3, ...installed, ...files });
      const result = await formatIn(String(dir), [], ["--log-level=log", "--check", "a.jsx"]);
      expect(result.stdout).toBe(
        "Checking formatting...\nError occurred when checking code style in the above file.\n",
      );
      expect(result.stderr.split("\n")).toEqual([
        `error: a.jsx: ${unknown} It was not formatted.`,
        expect.stringMatching(/^error: sortTailwindcss: \S+tailwind\.config\.js: boom$/),
        "1 file with classes was not formatted.",
        "",
      ]);
      expect(result.exitCode).toBe(2);
    });

    test("a flag or [fmt] takes precedence", async () => {
      const files = { ...config({}), "bunfig.toml": '[fmt.sortTailwindcss]\nfunctions = ["mine"]\n' };
      const result = await format({ ...project, ...files, "a.jsx": 'mine("p-4 flex");\n' }, ["a.jsx"]);
      expect(result).toMatchObject({ stderr: "", files: ['mine("flex p-4");\n'], exitCode: 0 });
    });
  });
});
