// oxfmt's `sortTailwindcss`, and `prettier-plugin-tailwindcss`. cases.json: the inputs of oxfmt's apps/oxfmt/test/api/sort_tailwindcss.test.ts (MIT: see LICENSE) and
// some more, with what oxfmt 0.72 prints for them with tailwindcss 4.3.3. order.json: the classes in them that Tailwind knows, in
// its order. Both are made by test/cli/format/oracle/tailwind/make-fixtures.ts.
//
// The order comes from the package `tailwindcss` of the project. Here that is a stand-in, which knows what is in order.json.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../../children";
import cases from "./cases.json";
import { forPrettier } from "./for-prettier";
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

  const forPlugin = cases.flatMap(it => {
    const options = forPrettier(it.options);
    return options && "prettier" in it ? [{ ...it, options, output: it.prettier }] : [];
  });
  for (const [options, group] of Map.groupBy(forPlugin, it => JSON.stringify(it.options))) {
    test(`as prettier-plugin-tailwindcss: ${options}`, async () => {
      const names = group.map((it, index) => `${index}/${it.filename}`);
      const files = Object.fromEntries(group.map((it, index) => [names[index], it.input]));
      const result = await format({ ...version4, ".prettierrc": options, ...files }, names);
      expect(result.stderr).toBe("");
      for (const [index, it] of group.entries()) {
        expect({ name: it.name, output: result.files[index] }).toEqual({ name: it.name, output: it.output });
      }
      expect(result.exitCode).toBe(0);
    });
  }

  const input = '<a className="p-4 flex m-2" />;\n';
  const [sorted, reversed] = ['<a className="m-2 flex p-4" />;\n', '<a className="p-4 flex m-2" />;\n'];

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

  test("each package of a workspace has its own Tailwind CSS", async () => {
    const inPackage = (files: Record<string, string>, directory: string) =>
      Object.fromEntries(Object.entries(files).map(([name, text]) => [`${directory}/${name}`, text]));
    const result = await format(
      {
        ".oxfmtrc.json": '{ "sortTailwindcss": true }',
        "node_modules/.keep": "",
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

  test("before 0.7.0 the plugin of Prettier looked from the configuration file of Prettier, not from the file", async () => {
    const files = {
      ...version3,
      ".prettierrc": '{ "plugins": ["prettier-plugin-tailwindcss"] }',
      "docs/tailwind.config.js": "module.exports = { reversed: true };\n",
      "docs/a.jsx": sorted,
    };
    const plugin = (version: string) => ({
      "node_modules/prettier-plugin-tailwindcss/package.json": JSON.stringify({ version }),
    });
    for (const version of ["0.6.6", "0.6.14", "0.5.0"]) {
      expect(await format({ ...files, ...plugin(version) }, ["docs/a.jsx"])).toMatchObject({
        stderr: "",
        files: [sorted],
      });
    }
    for (const version of ["0.7.0", "0.8.1", "1.0.0"]) {
      expect(await format({ ...files, ...plugin(version) }, ["docs/a.jsx"])).toMatchObject({
        stderr: "",
        files: [reversed],
      });
    }
    expect(await format(files, ["docs/a.jsx"])).toMatchObject({ stderr: "", files: [reversed] });
    // Nor did it look at a call on what a call returns, or at the quotes of these.
    const more = {
      ...files,
      ".prettierrc": '{ "plugins": ["prettier-plugin-tailwindcss"], "tailwindFunctions": ["cn"] }',
      "a.js": 'cn("p-4 flex").b("p-4 flex");\ncn.c("p-4 flex");\n',
      "a.css": "@plugin 'a';\n@config 'b';\n@source 'c';\n",
    };
    expect((await format({ ...more, ...plugin("0.6.14") }, ["a.js", "a.css"])).files).toEqual([
      'cn("flex p-4").b("p-4 flex");\ncn.c("flex p-4");\n',
      more["a.css"],
    ]);
    expect((await format({ ...more, ...plugin("0.7.0") }, ["a.js", "a.css"])).files).toEqual([
      'cn("flex p-4").b("flex p-4");\ncn.c("flex p-4");\n',
      '@plugin "a";\n@config "b";\n@source "c";\n',
    ]);
    // Before 0.6.0 it did nothing but sort.
    const twice = { ...files, "a.jsx": '<a className="p-4  flex   p-4" />;\n' };
    expect((await format({ ...twice, ...plugin("0.5.14") }, ["a.jsx"])).files).toEqual([
      '<a className="flex  p-4   p-4" />;\n',
    ]);
    expect((await format({ ...twice, ...plugin("0.6.0") }, ["a.jsx"])).files).toEqual([
      '<a className="flex p-4" />;\n',
    ]);
    // That of the directory of the configuration file counts, and so does its Tailwind.
    const nearer = { "docs/.prettierrc": files[".prettierrc"], ...plugin("0.6.6") };
    expect(await format({ ...files, ...nearer }, ["docs/a.jsx"])).toMatchObject({ stderr: "", files: [reversed] });
  });

  test("the options of the plugin of Prettier count if it is among the plugins", async () => {
    const plugins = ["prettier-plugin-tailwindcss"];
    const files = { ...version4, "css/app.css": "/* reversed */\n", "src/a.js": 'tw("flex p-4 m-2");\n' };
    const options = { tailwindStylesheet: "./css/app.css", tailwindFunctions: ["tw"] };
    const withIt = await format({ ...files, ".prettierrc": JSON.stringify({ plugins, ...options }) }, ["src/a.js"]);
    expect(withIt).toMatchObject({ stderr: "", files: ['tw("p-4 flex m-2");\n'], exitCode: 0 });
    const without = await format({ ...files, ".prettierrc": JSON.stringify(options) }, ["src/a.js"]);
    expect(without.stderr).toContain('[warn] Ignored unknown option { tailwindStylesheet: "./css/app.css" }.');
    expect(without.files).toEqual(['tw("flex p-4 m-2");\n']);
    const alone = await format({ ".prettierrc": JSON.stringify({ plugins }), "a.jsx": input }, ["a.jsx"]);
    expect(alone.stderr).toContain("[error] prettier-plugin-tailwindcss: It needs the package tailwindcss");
    expect(alone.exitCode).toBe(2);
  });

  test("nothing is run for files without classes", async () => {
    const files = { ".oxfmtrc.json": '{ "sortTailwindcss": true }', "a.jsx": '<a className="one" b="c d" />;\n' };
    expect(await format(files, ["a.jsx"])).toMatchObject({ stderr: "", exitCode: 0 });
  });
});
