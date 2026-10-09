// oxfmt's `sortTailwindcss`, and `prettier-plugin-tailwindcss`. cases.json: the inputs of oxfmt's apps/oxfmt/test/api/sort_tailwindcss.test.ts (MIT: see LICENSE) and
// some more, with what oxfmt 0.72 prints for them with tailwindcss 4.3.3. order.json: the classes in them that Tailwind knows, in
// its order. Both are made by test/cli/format/oracle/tailwind/make-fixtures.ts.
//
// The order comes from the package `tailwindcss` of the project. Here that is a stand-in, which knows what is in order.json.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, utimesSync, writeFileSync } from "node:fs";
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
/** Tailwind CSS 3. A configuration with `reversed` in it turns the order around. */
const version3 = {
  "node_modules/tailwindcss/package.json": JSON.stringify({ name: "tailwindcss", version: "3.0.0", main: "index.js" }),
  "node_modules/tailwindcss/index.js": "",
  "node_modules/tailwindcss/resolveConfig.js": "module.exports = config => config;\n",
  "node_modules/tailwindcss/lib/lib/generateRules.js": "exports.generateRules = () => [];\n",
  "node_modules/tailwindcss/lib/lib/setupContextUtils.js": `const order = ${JSON.stringify(order)};
exports.createContext = config => {
  const sign = config.reversed ? -1 : 1;
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

  test("without the package it is an error, and the files with classes are left as they are", async () => {
    const files = { ".oxfmtrc.json": '{ "sortTailwindcss": true }', "a.jsx": `${input}a  ;\n`, "b.js": "b  ;\n" };
    const result = await format(files, ["a.jsx", "b.js"]);
    expect(result.stderr).toContain("[error] sortTailwindcss: It needs the package tailwindcss");
    expect(result.files).toEqual([`${input}a  ;\n`, "b;\n"]);
    expect(result.exitCode).toBe(2);
    const allowed = await format(files, ["a.jsx", "b.js"], ["--allow-unsupported"]);
    expect(allowed.stderr).toContain("[warn] sortTailwindcss: It needs the package tailwindcss");
    expect(allowed.files).toEqual([`${input}a;\n`, "b;\n"]);
    expect(allowed.exitCode).toBe(0);
  });

  test("what Tailwind has said is kept until something that it has loaded changes", async () => {
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
    // Nothing is kept that depends on a file that has just been written.
    const age = (name: string, seconds: number) => {
      const time = new Date(Date.now() - seconds * 1000);
      utimesSync(join(String(dir), name), time, time);
    };
    age("app.css", 60);
    age("node_modules/tailwindcss/package.json", 60);
    const names = ["a.jsx", "node_modules/tailwindcss/loaded.txt"];
    expect(await formatIn(String(dir), names)).toMatchObject({ stderr: "", files: [sorted, "x"] });
    // The same classes in another order, in another file.
    write("b.jsx", '<a className="flex p-4 m-2 flex" />;\n');
    expect(await formatIn(String(dir), [...names, "b.jsx"])).toMatchObject({
      stderr: "",
      files: [sorted, "x", sorted],
    });
    // A class that has not been asked about.
    write("a.jsx", '<a className="p-4 m-1" />;\n');
    expect(await formatIn(String(dir), names)).toMatchObject({
      stderr: "",
      files: ['<a className="m-1 p-4" />;\n', "xx"],
    });
    write("app.css", "/* reversed */\n");
    age("app.css", 30);
    // Nothing is asked for a file without classes.
    write("c.js", "c  ;\n");
    expect(await formatIn(String(dir), ["c.js", names[1]], ["c.js"])).toMatchObject({
      stderr: "",
      files: ["c;\n", "xx"],
    });
    expect(await formatIn(String(dir), names)).toMatchObject({
      stderr: "",
      files: ['<a className="p-4 m-1" />;\n', "xxx"],
    });
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
