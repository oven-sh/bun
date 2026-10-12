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
    cmd: [bunExe(), "format", "--log-level=warn", ...flags],
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

  const unknown = "sortTailwindcss: The order of some classes cannot be found.";

  const listed = (root: string) => readdirSync(root, { recursive: true, encoding: "utf8" }).sort();

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
      cmd: [bunExe(), "format", "--log-level=warn", "."],
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
    expect(result.stderr).toContain("[error] sortTailwindcss: It needs the package tailwindcss");
    expect(result.stderr).toContain(`[error] a.jsx: ${unknown} It is left as it is.\n`);
    expect(result.files).toEqual([`${input}a  ;\n`, "b;\n"]);
    expect(result.exitCode).toBe(2);
    // The first directory in the order of the names, not the one whose file has come first.
    const many = Object.fromEntries(["z", "c", "x", "b", "y"].map(name => [`${name}/a.jsx`, input]));
    const inMany = await format({ ".oxfmtrc.json": files[".oxfmtrc.json"], ...many }, []);
    expect(inMany.stderr).toMatch(/which cannot be found from \S*[\\/]b\. Install it\./);
    const allowed = await format(files, ["a.jsx", "b.js"], ["--allow-unsupported"]);
    expect(allowed.stderr).toContain("[warn] sortTailwindcss: It needs the package tailwindcss");
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
      "nul.jsx": `<a className="p-4 content-['\0'] flex m-2"   />;\n`,
      "outside.jsx": `// caf\xE9\n<a className="p-4 flex m-2" title="caf\xE9"   />;\n`,
    };
    const expected = {
      "latin1.jsx": `<a className="content-['caf\xE9'] m-2 flex p-4" />;\n`,
      "two.jsx": `<a className="content-['caf\xE8'] content-['caf\xE9'] m-2 flex p-4" />;\n`,
      "lone.html": `<a class="content-['\x80'] m-2 flex p-4">x</a>\n`,
      "cut.css": "a {\n  @apply content-['\xE2\x82'] m-2 flex p-4;\n}\n",
      "nul.jsx": `<a className="content-['\0'] m-2 flex p-4" />;\n`,
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
      cmd: [bunExe(), "format", "--stdin-filepath", "a.jsx"],
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
    expect(result.stderr.split("\n").filter(line => line.startsWith("[error]"))).toEqual([
      `[error] b.jsx: ${unknown} It is left as it is.`,
      `[error] c.jsx: ${unknown} It is left as it is.`,
    ]);
    expect(result.files).toEqual([
      sorted,
      '<a className="p-4 odd flex" />;\nb  ;\n',
      '<a className="p-4 flex odd" />;\n',
    ]);
    expect(result.exitCode).toBe(2);
    const piped = await formatIn(String(dir), [], ["--stdin-filepath", "d.jsx"], '<a className="p-4 odd flex" />;\n');
    expect(piped).toMatchObject({ stdout: "", stderr: `[error] d.jsx: ${unknown}\n`, exitCode: 2 });
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
      expect(result.stderr.split("\n").filter(line => line.startsWith("[error]"))).toEqual([
        `[error] caf\uFFFD/b.jsx: ${unknown} It is left as it is.`,
        `[error] sortTailwindcss: ${String(dir)}/caf\uFFFD/node_modules/tailwindcss: It cannot be loaded from a path that is not UTF-8.`,
        "[error] Left as it is: 1 file.",
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
    expect(refused.stderr).toContain("[error] sortTailwindcss: It needs the package tailwindcss");
    expect(refused).toMatchObject({ stdout: "", exitCode: 2 });
    const allowed = await formatIn(String(dir), [], ["--allow-unsupported", ...from], `${input}a  ;\n`);
    expect(allowed.stderr).toContain("[warn] sortTailwindcss: It needs the package tailwindcss");
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
      expect(lists[0].stderr).toContain(
        `[${allows ? "warn" : "error"}] sortTailwindcss: ${join(String(dir), "three/tailwind.config.js").replaceAll("\\", "/")}: It has no such plugin.`,
      );
      expect(lists[0].stderr).toContain(
        allows ? "The classes are not sorted in 7 files." : "Left as they are: 7 files.",
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
});
