// For ./test-react-compiler-<part>.test.ts: one process took too much of what CI gives a file.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

export function reactCompiler(part: number) {
  // The rows of test/cli/test/bun-test.test.ts. That file tells a compiled component by the text of the function, which under `--aot` is the text as it is
  // written. Here a compiled component is one that asks the runtime for a cache.
  const component = (name: string, directive = "") => `
  export function ${name}({ items }) {
    ${directive}
    const doubled = items.map(item => item * 2);
    return <ul>{doubled.map(item => <li key={item}>{item}</li>)}</ul>;
  }`;
  const printCompiled = `
  for (const name in all) {
    globalThis.running = name;
    all[name](name.startsWith("use") ? [1, 2] : { items: [1, 2] });
  }
  console.log("compiled: " + (globalThis.caches ?? []).join(" "));`;
  const react = {
    "node_modules/react/package.json": JSON.stringify({
      name: "react",
      version: "19.0.0",
      exports: {
        ".": "./index.js",
        "./compiler-runtime": "./compiler-runtime.js",
        "./jsx-runtime": "./jsx.js",
        "./jsx-dev-runtime": "./jsx.js",
      },
    }),
    "node_modules/react/index.js": `export const useState = value => [value, () => {}];`,
    "node_modules/react/compiler-runtime.js": `
    export const c = size => {
      (globalThis.caches ??= []).push(globalThis.running);
      return Array(size).fill(Symbol.for("react.memo_cache_sentinel"));
    };`,
    "node_modules/react/jsx.js": `export const jsxDEV = (type, props) => ({ type, props }), jsx = jsxDEV, jsxs = jsxDEV;`,
  };
  const files = {
    ...react,
    "node_modules/library/package.json": JSON.stringify({ name: "library", main: "./index.jsx" }),
    "node_modules/library/index.jsx": component("Library"),
    "src/List.tsx": component("List"),
    "src/List.stories.tsx": component("Story"),
    "src/OptOut.tsx": component("OptOut", `"use no memo";`),
    "src/shared.test.tsx": component("InATestFile"),
    "src/useTotal.ts": `
    import { useState } from "react";
    export function useTotal(items: number[]) {
      const [factor] = useState(2);
      const scaled = items.map(item => item * factor);
      return { scaled, factor };
    }`,
    "other/Other.jsx": component("Other"),
    "setup.tsx": component("InAPreload") + `globalThis.InAPreload = InAPreload;`,
    "compiled.test.tsx": `
    import { expect, test } from "bun:test";
    import { Library } from "library";
    import { Other } from "./other/Other";
    import { List } from "./src/List";
    import { Story } from "./src/List.stories";
    import { OptOut } from "./src/OptOut";
    import { InATestFile } from "./src/shared.test";
    import { useTotal } from "./src/useTotal";
    ${component("InThisFile")}
    test("which are compiled", () => {
      const all = { List, useTotal, Story, Other, OptOut, Library, InATestFile, InThisFile, InAPreload: globalThis.InAPreload };
      ${printCompiled}
      expect(JSON.stringify(List({ items: [1, 2] }))).toBe(JSON.stringify(OptOut({ items: [1, 2] })));
      expect(useTotal([1, 2])).toEqual({ scaled: [2, 4], factor: 2 });
    });`,
  };

  const ways: [string, string[], string][] = [
    ["plain", [], ""],
    ["as one program", ["--aot"], "TestRunLayers:0"],
    ["over two layers", ["--aot"], "TestRunLayers:2,TestRunPartFiles:1"],
  ];

  async function compiled(cwd: string, args: string[], words: string) {
    const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...args], cwd, env);
    return { compiled: stdout.match(/compiled: (.*)/)?.[1] ?? stderr, exitCode };
  }

  // The first file: plain and as one program. The second: over two layers.
  const isOverLayers = ([, , words]: (typeof ways)[number]) => words.includes("TestRunLayers:2");
  describe.concurrent.each(ways.filter(way => isOverLayers(way) === (part === 2)))(
    "bun test --react-compiler, %s",
    (_, flags, words) => {
      const everything = "List useTotal Story Other";
      test.each([
        ["nothing without it", "", [], ""],
        ["the flag", "", ["--react-compiler"], everything],
        ["the flag, in workers", "", ["--react-compiler", "--parallel=2"], everything],
        ["the flag, with --isolate", "", ["--react-compiler", "--isolate"], everything],
        ["true", `reactCompiler = true`, [], everything],
        ["false", `reactCompiler = false`, [], ""],
        ["false, and the flag", `reactCompiler = false`, ["--react-compiler"], everything],
        ["folders", `reactCompiler = ["./src/"]`, [], "List useTotal Story"],
        ["a pattern", `reactCompiler = ["**/*.jsx"]`, [], "Other"],
        ["exclude alone", `reactCompiler = { exclude = "src" }`, [], "Other"],
        [
          "include and exclude",
          `reactCompiler = { include = ["src", "other"], exclude = ["**/*.stories.*", "other"] }`,
          [],
          "List useTotal",
        ],
        [
          "include and exclude, in workers",
          `reactCompiler = { include = ["src"], exclude = ["**/*.stories.*"] }`,
          ["--parallel=2"],
          "List useTotal",
        ],
      ])("%s", async (_, config, args, expected) => {
        using directory = tempDir("aot-test-react-compiler", { ...files, "bunfig.toml": `[test]\n${config}` });
        const all = [...flags, "--preload=./setup.tsx", ...args, "./compiled.test.tsx"];
        expect(await compiled(String(directory), all, words)).toEqual({ compiled: expected, exitCode: 0 });
      });

      describe("in a workspace, run from apps/web", () => {
        const workspace = {
          ...react,
          "apps/web/Root.tsx": component("Root"),
          "apps/web/src/Local.tsx": component("Local"),
          "apps/web/test/Helper.tsx": component("Helper"),
          "packages/ui/Ui.tsx": component("Ui"),
          "packages/ui2/Ui2.tsx": component("Ui2"),
          "packages/linked/package.json": JSON.stringify({ name: "linked", main: "./index.tsx" }),
          "packages/linked/index.tsx": component("Linked"),
          "apps/web/node_modules/.keep": "",
          "apps/web/where.test.tsx": `
        import { test } from "bun:test";
        import { Linked } from "linked";
        import { Ui } from "../../packages/ui/Ui";
        import { Ui2 } from "../../packages/ui2/Ui2";
        import { Root } from "./Root";
        import { Local } from "./src/Local";
        import { Helper } from "./test/Helper";
        test("which are compiled", () => {
          const all = { Root, Local, Helper, Ui, Ui2, Linked };
          ${printCompiled}
        });`,
        };
        const inWeb = "Root Local Helper";
        test.each([
          ["a package linked into node_modules is compiled", `true`, `${inWeb} Ui Ui2 Linked`],
          ["a linked package is included by its real path", `["../../packages/linked"]`, "Linked"],
          [`"." is the run directory`, `["."]`, inWeb],
          ["a path that goes up and back down into the run directory", `["../../apps/web/src/"]`, "Local"],
          ["a folder above the run directory includes it", `["../.."]`, `${inWeb} Ui Ui2 Linked`],
          ["an absolute path", `["<dir>/apps/web/src"]`, "Local"],
          [
            "exclude with a path that goes up and back down",
            `{ exclude = ["../../apps/web/test", "../../packages"] }`,
            "Root Local",
          ],
          ["a folder doesn't match a sibling whose name starts the same", `["../../packages/ui"]`, "Ui"],
          ["a pattern reaches outside the run directory", `{ exclude = ["**/U*.tsx"] }`, `${inWeb} Linked`],
        ])("%s", async (_, config, expected) => {
          using directory = tempDir("aot-test-react-compiler", workspace);
          const root = String(directory).replaceAll("\\", "/");
          symlinkSync(join(root, "packages/linked"), join(root, "apps/web/node_modules/linked"), "junction");
          await Bun.write(
            join(root, "apps/web/bunfig.toml"),
            `[test]\nreactCompiler = ${config.replace("<dir>", root)}`,
          );
          const all = [...flags, "./where.test.tsx"];
          expect(await compiled(join(root, "apps/web"), all, words)).toEqual({ compiled: expected, exitCode: 0 });
        });
      });
    },
  );
}
