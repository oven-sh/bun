// `require.resolve(name, { paths: [module.path] })` asks from the folder of the asking file. In an executable that is a folder of the executable.
// What the program holds is found there, as for a file that imports it, whatever of the same name lies in or below the working directory.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const packageOf = (whose: string) => ({
  "package.json": JSON.stringify({ name: "made-up-held", version: "1.0.0", main: "index.js" }),
  "index.js": `exports.held = ${JSON.stringify(whose)};`,
});

test("a name made at run time is answered alike from every working directory", async () => {
  using dir = tempDir("require-resolve-from-a-folder-of-the-executable", {
    tool: {
      "main.cjs": `
        require("./held.cjs"), require("made-up-held");
        const isAs = (written, made, options) => {
          try { return require.resolve(made, options) === require.resolve(written); } catch (error) { return error.code; }
        };
        const tail = JSON.parse('"held"');
        for (const [written, made] of [["./held.cjs", "./" + tail + ".cjs"], ["made-up-held", "made-up-" + tail]])
          console.log(written, isAs(written, made), isAs(written, made, { paths: [module.path] }), isAs(written, made, { paths: ["/nowhere-at-all", module.path] }));`,
      "held.cjs": `exports.held = "of the program";`,
      node_modules: { "made-up-held": packageOf("of the program") },
    },
    elsewhere: {
      "held.cjs": `exports.held = "of the working directory";`,
      node_modules: { "made-up-held": packageOf("of the working directory") },
    },
    empty: { "nothing.txt": "" },
  });
  const at = (...parts: string[]) => join(String(dir), ...parts);
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", at("program")],
    at("tool"),
  );
  expect(built.exitCode).toBe(0);
  renameSync(at("tool"), at("tool-moved-away"));
  const said = { elsewhere: "", empty: "" };
  for (const folder of ["elsewhere", "empty"] as const) said[folder] = (await run([at("program")], at(folder))).stdout;
  const alike = "./held.cjs true true true\nmade-up-held true true true\n";
  expect(said).toEqual({ elsewhere: alike, empty: alike });
});

// With --compile-autoload-package-json the program reads package.json on disk, so a copy on disk can refuse a file in its "exports".
// Node throws there. The program holds the copy of the root, which has that file, and must not answer with it for a relative entry.
test("a refusal by the exports of the copy on disk stands for a relative entry, whatever the program holds", async () => {
  using dir = tempDir("require-resolve-refused-on-disk", {
    "package.json": JSON.stringify({ name: "tool" }),
    "main.cjs": `
      require("./plugins/local.cjs"), require("sealed/private.js");
      const codeOf = paths => {
        try { return require.resolve("sealed/private.js", { paths }); } catch (error) { return error.code; }
      };
      console.log(codeOf(["plugins"]), codeOf(["./plugins"]), codeOf(["plugins", "."]));`,
    node_modules: { sealed: { "private.js": `exports.copy = "of the program";` } },
    plugins: {
      "local.cjs": `exports.local = true;`,
      node_modules: {
        sealed: {
          "package.json": JSON.stringify({ name: "sealed", exports: "./index.js" }),
          "index.js": "",
          "private.js": `exports.copy = "under plugins";`,
        },
      },
    },
  });
  const program = join(String(dir), "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "--compile-autoload-package-json", "./main.cjs", "--outfile", program],
    String(dir),
  );
  expect(built.exitCode).toBe(0);
  expect((await run([program], String(dir))).stdout).toBe("MODULE_NOT_FOUND MODULE_NOT_FOUND MODULE_NOT_FOUND\n");
});
