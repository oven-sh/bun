// oxfmt's `sortTailwindcss`. cases.json: the inputs of oxfmt's apps/oxfmt/test/api/sort_tailwindcss.test.ts (MIT: see LICENSE) and
// some more, with what oxfmt 0.72 prints for them with tailwindcss 4.3.3. order.json: the classes in them that Tailwind knows, in
// its order. Both are made by test/cli/format/oracle/tailwind/make-fixtures.ts.
//
// The order comes from the package `tailwindcss` of the project. Here that is a stand-in, which knows what is in order.json.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../../children";
import cases from "./cases.json";
import order from "./order.json";

afterAll(endChildren);

const getClassOrder = `classes => classes.map(name => [name, order.includes(name) ? BigInt(sign * order.indexOf(name)) : null])`;
/** Tailwind CSS 4, as far as it is asked. A style sheet with `reversed` in it turns the order around. */
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
/** Tailwind CSS 3. A configuration with `reversed` in it turns the order around, the classes in its `own` come last. */
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
    test(`as oxfmt: ${options}`, async () => {
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

  describe("Handlebars: classes that oxfmt joins with what is next to them, or loses", () => {
    // The template, what Bun makes of it, and what oxfmt 0.72 makes of it. It takes the blank at the end of a string away
    // whatever follows, moves a class that touches what is before or behind the mustache, and loses a no-break space.
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
      // With white space in between nothing touches.
      ['<a class="x {{if a "p-4 flex"}} y"></a>\n', `<a class="x {{if a 'flex p-4'}} y"></a>`, null],
    ] as const;
    const names = rows.map((_, index) => `${index}.hbs`);
    const files = Object.fromEntries(rows.map((row, index) => [names[index], row[0]]));
    const project = { ...version4, ".oxfmtrc.json": '{ "sortTailwindcss": {} }' };

    test("stay apart", async () => {
      for (const [, after, ofOxfmt] of rows) expect(after).not.toBe(ofOxfmt);
      const result = await format({ ...project, ...files }, names);
      expect(result.stderr).toBe("");
      expect(result.files).toEqual(rows.map(row => row[1]));
      expect(result.exitCode).toBe(0);
    });

    test("--debug-check compares what would be written, and has nothing to say about it", async () => {
      const result = await format({ ...project, ...files }, names, ["--debug-check"]);
      expect(result.stderr).toBe("");
      expect(result.files).toEqual(rows.map(row => row[0]));
      expect(result.exitCode).toBe(0);
    });
  });

  test("nothing is written into the project, not even while Tailwind is asked", async () => {
    // The stand-in looks around when it is loaded, and refuses to answer if there is a file that the test has not made.
    const looksAround = `const { readdirSync } = require("node:fs");
const now = readdirSync(require("node:path").join(__dirname, "../.."), { recursive: true, encoding: "utf8" }).sort();
const before = JSON.parse(process.env.FILES_OF_THE_TEST);
if (now.join() !== before.join()) throw new Error("There is " + now.filter(it => !before.includes(it)).join(", "));
`;
    using dir = tempDir("bun-format-tailwind", {
      ...version4,
      "node_modules/tailwindcss/index.js": looksAround + version4["node_modules/tailwindcss/index.js"],
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

  // Nix, a layer of an image that belongs to root, a sandbox. Nothing is closed to root.
  test.skipIf(isWindows || process.getuid?.() === 0)("the packages can be read-only", async () => {
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

  test("`stylesheet` is what Tailwind CSS 4 is loaded with, from the directory of the configuration file", async () => {
    const config = JSON.stringify({ sortTailwindcss: { stylesheet: "./css/app.css" } });
    const files = { ...version4, ".oxfmtrc.json": config, "css/app.css": "/* reversed */\n", "src/a.jsx": sorted };
    const result = await format(files, ["src/a.jsx"]);
    expect(result).toMatchObject({ stderr: "", files: [reversed], exitCode: 0 });
  });

  test("Tailwind CSS 3 is loaded with `config`, or with the nearest tailwind.config.*", async () => {
    const files = { ...version3, "other.js": "module.exports = { reversed: true };\n", "src/a.jsx": input };
    const nearest = { ".oxfmtrc.json": '{ "sortTailwindcss": true }', "tailwind.config.ts": "export default {};\n" };
    expect(await format({ ...files, ...nearest }, ["src/a.jsx"])).toMatchObject({ stderr: "", files: [sorted] });
    const named = { ".oxfmtrc.json": '{ "sortTailwindcss": { "config": "other.js" } }' };
    expect(await format({ ...files, ...named, "src/a.jsx": sorted }, ["src/a.jsx"])).toMatchObject({
      stderr: "",
      files: [reversed],
    });
  });

  // As for prettier-plugin-tailwindcss 0.8.1 with Prettier 3.9.9.
  test("`process.cwd()` in a tailwind.config.js is where the command runs", async () => {
    using dir = tempDir("bun-format-tailwind", {
      ...version3,
      ".oxfmtrc.json": '{ "sortTailwindcss": true }',
      "tailwind.config.js": `module.exports = { reversed: require("node:path").basename(process.cwd()) === "sub" };\n`,
      "sub/a.jsx": sorted,
      "sub/b.jsx": sorted,
    });
    const below = await formatIn(join(String(dir), "sub"), ["a.jsx"], ["a.jsx"]);
    const beside = await formatIn(String(dir), ["sub/b.jsx"], ["sub/b.jsx"]);
    expect([below, beside]).toMatchObject([
      { stderr: "", files: [reversed] },
      { stderr: "", files: [sorted] },
    ]);
  });

  test("each package of a workspace has its own Tailwind CSS", async () => {
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
    "a package that only another package of the workspace depends on is found in %s",
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

  test("without the package it is an error, and the files with classes are left as they are", async () => {
    const files = { ".oxfmtrc.json": '{ "sortTailwindcss": true }', "a.jsx": `${input}a  ;\n`, "b.js": "b  ;\n" };
    const result = await format(files, ["a.jsx", "b.js"]);
    expect(result.stderr).toContain("error: sortTailwindcss: the tailwindcss package was not found from ");
    expect(result.stderr).toContain("  Run bun add -d tailwindcss\n");
    expect(result.stderr).toContain(`error: a.jsx: ${unknown} It was not formatted.\n`);
    expect(result.files).toEqual([`${input}a  ;\n`, "b;\n"]);
    expect(result.exitCode).toBe(2);
    // The first directory in the order of the names, not the one whose file has come first.
    const many = Object.fromEntries(["z", "c", "x", "b", "y"].map(name => [`${name}/a.jsx`, input]));
    const inMany = await format({ ".oxfmtrc.json": files[".oxfmtrc.json"], ...many }, []);
    expect(inMany.stderr).toMatch(/was not found from \S*[\\/]b\n/);
    const allowed = await format(files, ["a.jsx", "b.js"], ["--allow-unsupported"]);
    expect(allowed.stderr).toContain("warn: sortTailwindcss: the tailwindcss package was not found from ");
    expect(allowed.files).toEqual([`${input}a;\n`, "b;\n"]);
    expect(allowed.exitCode).toBe(0);
  });

  // oxfmt 0.72 does not read such a file. The order is the one that it has for the same text in UTF-8.
  test("a file that is not UTF-8 is formatted as without the option: its bytes stay", async () => {
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

  test("a file with a class that Tailwind says nothing about is named, and left as it is", async () => {
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

  // There oxfmt 0.72 sorts in the order of the Tailwind CSS that it brings along, whatever that of the project says.
  test.skipIf(!isLinux)(
    "a Tailwind CSS in a directory whose name is not UTF-8 cannot be asked, and that is said",
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

  // An editor in a repository whose root has no packages.
  test("a text from stdin, for a file of a project below the working directory", async () => {
    const inWeb = Object.entries(version4).map(([name, text]) => [`web/${name}`, text]);
    const files = { "web/.oxfmtrc.json": '{ "sortTailwindcss": true }', ...Object.fromEntries(inWeb) };
    using dir = tempDir("bun-format-tailwind", files);
    const result = await formatIn(String(dir), [], ["--stdin-filepath", "web/a.jsx"], input);
    expect(result).toMatchObject({ stderr: "", stdout: sorted, exitCode: 0 });
  });

  // What an editor runs.
  test("without the package, a text from stdin: an error, and with --allow-unsupported a warning, as for a file", async () => {
    using dir = tempDir("bun-format-tailwind", { ".oxfmtrc.json": '{ "sortTailwindcss": true }' });
    const from = ["--stdin-filepath", "a.jsx"];
    const refused = await formatIn(String(dir), [], from, `${input}a  ;\n`);
    expect(refused.stderr).toContain("error: sortTailwindcss: the tailwindcss package was not found from ");
    expect(refused).toMatchObject({ stdout: "", exitCode: 2 });
    const allowed = await formatIn(String(dir), [], ["--allow-unsupported", ...from], `${input}a  ;\n`);
    expect(allowed.stderr).toContain("warn: sortTailwindcss: the tailwindcss package was not found from ");
    expect(allowed).toMatchObject({ stdout: `${input}a;\n`, exitCode: 0 });
  });

  test("every run that comes across classes asks Tailwind, once, and leaves nothing behind", async () => {
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
    // Nothing is asked for a file without classes.
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

  test("a Tailwind that cannot be asked takes only its own files with it, in the first run as in the next", async () => {
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
      // More of them. Nothing but the order of the classes could change in their files.
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

  test("nothing is run for files without classes", async () => {
    const files = { ".oxfmtrc.json": '{ "sortTailwindcss": true }', "a.jsx": '<a className="one" b="c d" />;\n' };
    expect(await format(files, ["a.jsx"])).toMatchObject({ stderr: "", exitCode: 0 });
  });

  // What is expected is what Prettier 3.9.9 does with prettier-plugin-tailwindcss 0.8.1 and tailwindcss 4.3.3.
  describe("prettier-plugin-tailwindcss in a Prettier config", () => {
    const plugin = "prettier-plugin-tailwindcss";
    /** The plugin as far as a configuration can look at it. Nothing of it runs. */
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
      ["--plugin beside a config", { ".prettierrc": "{}" }, [`--plugin=${plugin}`]],
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
    ])("is named by %s", async (_, files, flags = []) => {
      const result = await format({ ...project, ...files, "a.jsx": input }, ["a.jsx"], flags);
      expect(result).toMatchObject({ stderr: "", files: [sorted], exitCode: 0 });
    });

    test("counts for the files whose list of plugins has it", async () => {
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
      // No function takes classes unless the config says so.
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
    ])("has its options and its defaults: %j", async (options, before, after) => {
      const result = await format({ ...project, ...config(options), "a.jsx": before }, ["a.jsx"]);
      expect(result).toMatchObject({ stderr: "", files: [after || before], exitCode: 0 });
    });

    // The plugin says the same, behind the directory of the config and without the `warn:`.
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

    test.each(["tailwindStylesheet", "tailwindEntryPoint", "tailwindConfig"])("an empty %s is none", async name => {
      const result = await format({ ...project, ...config({ [name]: "" }), "a.jsx": input }, ["a.jsx"]);
      expect(result).toMatchObject({ stderr: "", files: [sorted], exitCode: 0 });
    });

    test("a path is relative to the working directory if the config is the one that --config names", async () => {
      const files = {
        "config/.prettierrc": config({ tailwindStylesheet: "./app.css" })[".prettierrc"],
        "a.jsx": sorted,
      };
      const flags = ["--config", "config/.prettierrc"];
      const beside = await format({ ...project, ...files, "app.css": "/* reversed */\n" }, ["a.jsx"], flags);
      expect(beside).toMatchObject({ stderr: "", files: [reversed], exitCode: 0 });
      const elsewhere = await format({ ...project, ...files, "config/app.css": "/* reversed */\n" }, ["a.jsx"], flags);
      expect(elsewhere).toMatchObject({ files: [sorted], exitCode: 2 });
      expect(elsewhere.stderr).toContain("app.css");
    });

    test("tailwindConfig is what Tailwind CSS 3 is loaded with", async () => {
      const files = { ...version3, ...installed, ...config({ tailwindConfig: "./other.js" }), "src/a.jsx": sorted };
      const result = await format({ ...files, "other.js": "module.exports = { reversed: true };\n" }, ["src/a.jsx"]);
      expect(result).toMatchObject({ stderr: "", files: [reversed], exitCode: 0 });
    });

    test("tailwindPackageName is what Tailwind CSS is called", async () => {
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
    ])("a value of the wrong type is refused: %j", async (options, refusal) => {
      const result = await format({ ...project, ...config(options), "a.jsx": input }, ["a.jsx"]);
      expect(result.stderr).toBe(`error: ${refusal}\n`);
      expect(result.files).toEqual([input]);
      expect(result.exitCode).not.toBe(0);
    });

    test("without it its options are unknown, and with it an option that it does not have is", async () => {
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

    test("another plugin beside it is still refused, by its name", async () => {
      const files = { ".prettierrc": JSON.stringify({ plugins: [plugin, "prettier-plugin-other"] }), "a.jsx": input };
      const result = await format({ ...project, ...files }, ["a.jsx"], ["--log-level=log", "--check"]);
      expect(result.stderr).toContain("plugins that bun fmt does not include: prettier-plugin-other\n");
      // That it has no effect is said in a run that goes on without it.
      expect(result.stderr).not.toContain("has no effect");
      // Nothing is said about files that have not been looked at.
      expect(result.stdout).toBe("Checking formatting...\n");
      expect(result.files).toEqual([input]);
      expect(result.exitCode).toBe(2);
    });

    const names = { tailwindFunctions: ["cn", "/^tw/"], tailwindAttributes: ["mine", "/^data-cls/"] };

    test("where classes are is what it says, not oxfmt", async () => {
      // The lines of a file, before and after.
      const rows: Record<string, [string, string][]> = {
        "a.jsx": [
          // However deep in an argument or in the value of an attribute.
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
          // To Babel a call in an optional chain is another kind of node.
          ['cn?.("p-4 flex");', ""],
          ['cn?.x.y("p-4 flex");', ""],
          // What is added to stays apart, up to the innermost function.
          ['cn(a + (b ? " p-4 flex " : c));', 'cn(a + (b ? " flex p-4" : c));'],
          ['cn("x " + cn(" p-4 flex "));', 'cn("x " + cn("flex p-4"));'],
          ['"x " + cn` p-4 flex ` + " y";', '"x " + cn` flex p-4 ` + " y";'],
          // Of the texts of a template it looks at the wrong ends, which leaves more blanks than are needed.
          ['cn(`x ${" p-4 flex "} y`);', 'cn(`x ${" flex p-4 "} y`);'],
          ['cn(`${" p-4 flex "}`);', 'cn(`${" flex p-4 "}`);'],
          ['cn(` ${" p-4 flex "} `);', 'cn(` ${"flex p-4"} `);'],
          ["cn(`p-4 flex${a}m-2 p-1`);", ""],
          ["cn(` p-4 flex ${a} p-1 m-2 `);", "cn(`flex p-4 ${a} m-2 p-1`);"],
          // A list that was on several lines does not keep the element open.
          ['<a\n  className="\n    p-4\n    flex\n  "\n/>;', '<a className="flex p-4" />;'],
        ],
        "a.tsx": [
          ['cn?.("p-4 flex");', 'cn?.("flex p-4");'],
          ['cn?.x.y("p-4 flex");', 'cn?.x.y("flex p-4");'],
          ['(cn?.x)("p-4 flex");', ""],
          ['cn!("p-4 flex");', ""],
          ['cn<string>("p-4 flex" as string);', 'cn<string>("flex p-4" as string);'],
          // In this tree it does not find the texts of a template.
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

    test("a class stays apart from the text of a template that it touches", async () => {
      // The code, what Bun makes of it, and what the plugin makes of it: one class of `x` and `flex`.
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

    test("with @prettier/plugin-oxc before it, it looks at the tree of that, and behind that it does nothing", async () => {
      const code = 'cn?.("p-4 flex");\ncn(`x ${" p-4 flex "} y`);\n';
      const sortedCode = 'cn?.("flex p-4");\ncn(`x ${" flex p-4 "} y`);\n';
      const inVue = (text: string, lang = "") => `<script${lang}>\n${text}</script>\n`;
      const files = { "a.js": code, "a.ts": code, "a.vue": inVue(code), "b.vue": inVue(code, ' lang="ts"') };
      const run = (plugins: string[]) =>
        format(
          { ...project, ".prettierrc": JSON.stringify({ plugins, tailwindFunctions: ["cn"] }), ...files },
          Object.keys(files),
        );
      // It does not read the JavaScript in HTML.
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

    test("in Angular it looks at the texts of a template as they are written", async () => {
      const before = "<a [ngClass]=\"`x${a ? ' p-4 flex' : ''}`\" [class]=\"`x ${a ? ' p-4 flex ' : ''} y`\"></a>\n";
      const after =
        "<a\n  [ngClass]=\"`x${a ? ' flex p-4' : ''}`\"\n  [class]=\"`x ${a ? ' flex p-4 ' : ''} y`\"\n></a>\n";
      const result = await format({ ...project, ...config({}), "a.component.html": before }, ["a.component.html"]);
      expect(result).toMatchObject({ stderr: "", files: [after], exitCode: 0 });
    });

    describe("the Tailwind CSS that it brings along", () => {
      /** Its `createSorter`, which knows what is in order.json. A file with `reversed` in it turns the order around. */
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
        ["there is no tailwindcss", config({}), sorted],
        [
          "there is no tailwindcss, with the nearest tailwind.config.js",
          { ...config({}), "tailwind.config.js": flipped },
          reversed,
        ],
        [
          "there is no tailwindcss, with a style sheet",
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
      ])("is asked if %s", async (_, files, expected) => {
        const before = '<a className="flex x p-4 m-2 x flex" />;\n';
        const result = await format({ ...withSorter, ...files, "src/a.jsx": before }, ["src/a.jsx"]);
        expect(result).toMatchObject({ stderr: "", files: [expected.replace('"', '"x x ')], exitCode: 0 });
      });

      test.each<[Record<string, string>, string[]]>([
        [config({}), ["the tailwindcss package was not found from ", "  Run bun add -d tailwindcss"]],
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
      ])("has to be installed for that: %#", async (files, said) => {
        const result = await format({ ...files, "a.jsx": input }, ["a.jsx"]);
        for (const line of said)
          expect(result.stderr).toContain(line.startsWith(" ") ? `\n${line}\n` : `error: sortTailwindcss: ${line}`);
        expect(result.files).toEqual([input]);
        expect(result.exitCode).toBe(2);
      });
    });

    // Each stream has what Prettier's has.
    test("--check says on standard output that an error occurred, and on standard error what it is", async () => {
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

    test("a flag or [fmt] counts for more", async () => {
      const files = { ...config({}), "bunfig.toml": '[fmt.sortTailwindcss]\nfunctions = ["mine"]\n' };
      const result = await format({ ...project, ...files, "a.jsx": 'mine("p-4 flex");\n' }, ["a.jsx"]);
      expect(result).toMatchObject({ stderr: "", files: ['mine("flex p-4");\n'], exitCode: 0 });
    });
  });
});
