import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { tempDir } from "harness";
import { join } from "path";

const project = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [] },
  }),
  "src/index.ts": `import { join } from "./join";
export interface Options {
  name: string;
  times: number;
}
export function greet(options: Options): string {
  return join("hello", options.name).repeat(options.times);
}
export { join };
`,
  "src/join.ts": `export function join(first: string, second: string): string {
  return first + " " + second;
}
`,
};

const WRITTEN = ["index.aot.ts", "index.d.ts", "index.js", "join.d.ts"];
const filesIn = (folder: string) => readdirSync(folder, { recursive: true }).map(String).sort();
const described = (root: string, outputs: Bun.BuildArtifact[]) =>
  outputs
    .map(({ path, kind, loader }) => [path.replace(root, "").replaceAll("\\", "/").replace(/^\.\//, ""), kind, loader])
    .sort();

describe("Bun.build({ dts: true })", () => {
  test("writes the bundle, its declaration files and the bundle with its types kept to outdir", async () => {
    using dir = tempDir("build-api-dts", project);
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(filesIn(join(root, "out"))).toEqual(WRITTEN);
    expect(described(root, built.outputs)).toEqual([
      ["/out/index.aot.ts", "asset", "ts"],
      ["/out/index.d.ts", "asset", "ts"],
      ["/out/index.js", "entry-point", "ts"],
      ["/out/join.d.ts", "asset", "ts"],
    ]);
    for (const output of built.outputs) expect(await output.text()).toBe(readFileSync(output.path, "utf8"));
    const read = (name: string) => readFileSync(join(root, "out", name), "utf8");
    expect(read("index.d.ts")).toBe(`import { join } from "./join.js";
export interface Options {
    name: string;
    times: number;
}
export declare function greet(options: Options): string;
export { join };
`);
    expect(read("index.aot.ts")).toContain("function greet(options: Options): string {");
    expect(read("index.aot.ts")).toContain("function join(first: string, second: string): string {");
    expect(read("index.js")).toContain("function greet(options) {");
    expect(read("index.js")).not.toContain("debugId");
    const plain = await Bun.build({ entrypoints: [join(root, "src/index.ts")], tsconfig: join(root, "tsconfig.json") });
    expect(read("index.js")).toBe(await plain.outputs[0].text());
  });

  test("without outdir, the files are in outputs and nothing is written", async () => {
    using dir = tempDir("build-api-dts-memory", project);
    const root = String(dir);
    const before = filesIn(root);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(described(root, built.outputs)).toEqual([
      ["index.aot.ts", "asset", "ts"],
      ["index.d.ts", "asset", "ts"],
      ["index.js", "entry-point", "ts"],
      ["join.d.ts", "asset", "ts"],
    ]);
    const typed = built.outputs.find(output => output.path.endsWith("index.aot.ts"))!;
    expect(await typed.text()).toContain("function greet(options: Options): string {");
    expect(filesIn(root)).toEqual(before);
  });

  test("a source map that was asked for is kept", async () => {
    using dir = tempDir("build-api-dts-sourcemap", project);
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      sourcemap: "external",
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(filesIn(join(root, "out"))).toEqual([...WRITTEN, "index.js.map"].sort());
  });

  test("a type error fails the build", async () => {
    using dir = tempDir("build-api-dts-error", {
      ...project,
      "src/join.ts": project["src/join.ts"].replace("): string", "): number"),
    });
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
      throw: false,
    });
    expect(built.success).toBe(false);
    expect(built.logs.map(log => log.message).join("\n")).toContain("TS2322");
    expect(filesIn(root)).not.toContain("out");
  });

  test("minify: the declaration files, and a warning about the rest", async () => {
    using dir = tempDir("build-api-dts-minify", project);
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      minify: true,
      dts: true,
    });
    expect(built.logs.map(log => [log.level, log.message])).toEqual([
      [
        "warn",
        "the .aot.ts files that --aot compiles a package from are left out: they do not support minify.identifiers yet",
      ],
    ]);
    expect(filesIn(join(root, "out"))).toEqual(["index.d.ts", "index.js", "join.d.ts"]);
  });

  test("minify.syntax and minify.whitespace: every file", async () => {
    using dir = tempDir("build-api-dts-minify-syntax", project);
    const root = String(dir);
    const built = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "out"),
      tsconfig: join(root, "tsconfig.json"),
      minify: { syntax: true, whitespace: true },
      dts: true,
    });
    expect(built.logs).toEqual([]);
    expect(filesIn(join(root, "out"))).toContain("index.aot.ts");
  });

  test("two builds at once keep their files apart", async () => {
    using dir = tempDir("build-api-dts-twice", {
      ...Object.fromEntries(Object.entries(project).map(([path, text]) => ["a/" + path, text])),
      "b/tsconfig.json": project["tsconfig.json"],
      "b/src/index.ts": `export const other: number = 1;\n`,
    });
    const root = String(dir);
    const build = (name: string) =>
      Bun.build({
        entrypoints: [join(root, name, "src/index.ts")],
        outdir: join(root, name, "out"),
        tsconfig: join(root, name, "tsconfig.json"),
        dts: true,
      });
    const [a, b] = await Promise.all([build("a"), build("b")]);
    expect([a.logs, b.logs]).toEqual([[], []]);
    expect(filesIn(join(root, "a/out"))).toEqual(WRITTEN);
    expect(filesIn(join(root, "b/out"))).toEqual(WRITTEN.filter(path => path !== "join.d.ts"));
    expect(readFileSync(join(root, "b/out/index.d.ts"), "utf8")).toBe("export declare const other: number;\n");
  });

  test("cannot be used with compile", () => {
    expect(() => Bun.build({ entrypoints: ["./index.ts"], compile: true, dts: true })).toThrow(
      "dts cannot be used with compile",
    );
  });

  // A bundle for Bun starts with the line `// @bun`: Bun then runs the file as it is written, as an ES module.
  // An .aot.ts file is TypeScript, which Bun has to transpile.
  describe("the .aot.ts file of a bundle that starts with // @bun", () => {
    const build = async (root: string, options: Partial<Bun.BuildConfig>) => {
      const built = await Bun.build({
        entrypoints: [join(root, "src/index.ts")],
        outdir: join(root, "out"),
        tsconfig: join(root, "tsconfig.json"),
        target: "bun",
        dts: true,
        ...options,
      });
      expect(built.logs).toEqual([]);
      return built.outputs;
    };
    const lines = async (outputs: Bun.BuildArtifact[], name: string) =>
      (await outputs.find(output => output.path.endsWith(name))!.text()).split("\n");
    const greeting = async (root: string) => {
      const { greet } = await import(join(root, "out/index.aot.ts"));
      return greet({ name: "you", times: 1 });
    };
    const code = (lines: string[], loader: "ts" | "js") =>
      new Bun.Transpiler({ loader, target: "bun" })
        .transformSync(lines.join("\n"))
        .replace(/\/\/.*$/gm, "")
        .replace(/\s+/g, "");

    test("has an empty line in place of that line, and Bun runs it", async () => {
      using dir = tempDir("build-api-dts-target-bun", project);
      const root = String(dir);
      const outputs = await build(root, {});
      const [javascript, typed] = [await lines(outputs, "index.js"), await lines(outputs, "index.aot.ts")];
      expect(javascript[0]).toBe("// @bun");
      expect(typed.slice(0, 2)).toEqual(["", javascript[1]]);
      expect(code(typed, "ts")).toBe(code(javascript, "js"));
      expect(await greeting(root)).toBe("hello you");
    });

    test("without outdir: has the empty line in outputs too", async () => {
      using dir = tempDir("build-api-dts-target-bun-memory", project);
      const outputs = await build(String(dir), { outdir: undefined });
      const [javascript, typed] = [await lines(outputs, "index.js"), await lines(outputs, "index.aot.ts")];
      expect(javascript[0]).toBe("// @bun");
      expect(typed.slice(0, 2)).toEqual(["", javascript[1]]);
    });

    test("splitting: the .aot.ts file of a chunk has the empty line too", async () => {
      using dir = tempDir("build-api-dts-target-bun-chunks", {
        ...project,
        "src/other.ts": `import { join } from "./join";\nexport const other: string = join("an", "other");\n`,
      });
      const root = String(dir);
      const entrypoints = [join(root, "src/index.ts"), join(root, "src/other.ts")];
      const outputs = await build(root, { entrypoints, splitting: true });
      const texts = (extension: string) =>
        Promise.all(outputs.filter(output => output.path.endsWith(extension)).map(output => output.text()));
      expect((await texts(".js")).map(text => text.startsWith("// @bun\n"))).toEqual([true, true, true]);
      expect((await texts(".aot.ts")).map(text => text.startsWith("\n") && !text.includes("// @bun"))).toEqual([
        true,
        true,
        true,
      ]);
      expect(await greeting(root)).toBe("hello you");
    });

    test("splitting: a chunk without an export ends with export {} too", async () => {
      using dir = tempDir("build-api-dts-target-bun-chunk-no-export", {
        ...project,
        "src/setup.ts": `import { join } from "./join";\njoin("set", "up");\n`,
        "src/first.ts": `import "./setup";\nexport const first: number = 1;\n`,
        "src/second.ts": `import "./setup";\nexport const second: number = 2;\n`,
      });
      const root = String(dir);
      const entrypoints = [join(root, "src/first.ts"), join(root, "src/second.ts")];
      const outputs = await build(root, { entrypoints, splitting: true });
      const chunk = outputs.find(output => output.kind === "chunk")!;
      const javascript = (await chunk.text()).split("\n");
      expect([javascript[0], javascript.some(line => line.startsWith("export"))]).toEqual(["// @bun", false]);
      const typed = await lines(outputs, chunk.path.replace(/\.js$/, ".aot.ts"));
      expect([typed[0], ...typed.slice(-2)]).toEqual(["", "export {};", ""]);
    });

    test("a banner that begins like the line stays on the line below", async () => {
      using dir = tempDir("build-api-dts-banner", project);
      const root = String(dir);
      const outputs = await build(root, { banner: "// @bundled by acme" });
      expect((await lines(outputs, "index.js")).slice(0, 2)).toEqual(["// @bun", "// @bundled by acme"]);
      expect((await lines(outputs, "index.aot.ts")).slice(0, 2)).toEqual(["", "// @bundled by acme"]);
      expect(await greeting(root)).toBe("hello you");
    });

    test("a bundle without an export, of TypeScript or of JavaScript: ends with export {}, and is an ES module as the bundle is", async () => {
      using dir = tempDir("build-api-dts-no-export", {
        ...project,
        "package.json": JSON.stringify({ name: "greeter", type: "commonjs" }),
        "src/cli.ts": `#!/usr/bin/env bun\nimport "./setup";\nimport { join } from "./join";\njoin("greeter", "cli");\n`,
        // A file without import and export declares its names for every file. No file here reads `order` as a global.
        "src/setup.ts": `var order = [1, 2].reverse();\n`,
        "src/tool.js": `import { join } from "./join";\njoin("greeter", "tool");\n`,
      });
      const root = String(dir);
      const outputs = await build(root, { entrypoints: [join(root, "src/cli.ts"), join(root, "src/tool.js")] });
      const [javascript, typed] = [await lines(outputs, "cli.js"), await lines(outputs, "cli.aot.ts")];
      expect(javascript.slice(0, 2)).toEqual(["#!/usr/bin/env bun", "// @bun"]);
      expect(typed.slice(0, 2)).toEqual(["#!/usr/bin/env bun", ""]);
      expect(typed.slice(-2)).toEqual(["export {};", ""]);
      expect((await lines(outputs, "tool.aot.ts")).slice(-2)).toEqual(["export {};", ""]);
      // What Bun takes for CommonJS has one export, "default": its module.exports.
      for (const name of ["cli.js", "cli.aot.ts", "tool.js", "tool.aot.ts"])
        expect(Object.keys(await import(join(root, "out", name)))).toEqual([]);
    });

    test("a bundle for another target does not start with that line, and nothing is added", async () => {
      using dir = tempDir("build-api-dts-other-target", {
        ...project,
        "src/cli.ts": `import { join } from "./join";\njoin("greeter", "cli");\n`,
      });
      const root = String(dir);
      const outputs = await build(root, { target: "node", entrypoints: [join(root, "src/cli.ts")] });
      const [javascript, typed] = [await lines(outputs, "cli.js"), await lines(outputs, "cli.aot.ts")];
      expect(javascript).not.toContain("// @bun");
      expect([typed[0], typed.at(-2)]).toEqual([javascript[0], javascript.at(-2)]);
    });

    test("a script whose names other code reads as globals: the files are written without export {}", async () => {
      using dir = tempDir("build-api-dts-script", {
        ...project,
        // In a script this adds to the interface of `window`. In a module it declares another interface,
        // and `window.greeter` is then an error in the .aot.ts file.
        "src/polyfill.ts": `interface Window {\n  greeter: string;\n}\nwindow.greeter = "hello";\n`,
        "src/cli.ts": `import "./polyfill";\nconsole.log(window.greeter);\n`,
      });
      const root = String(dir);
      const outputs = await build(root, { entrypoints: [join(root, "src/cli.ts"), join(root, "src/index.ts")] });
      for (const name of ["cli", "index"]) {
        const [javascript, typed] = [await lines(outputs, name + ".js"), await lines(outputs, name + ".aot.ts")];
        expect(typed[0]).toBe("");
        expect(typed.at(-2)).toBe(javascript.at(-2));
      }
    });

    test("a script var that other code reads through globalThis: the file keeps its types, without export {}", async () => {
      using dir = tempDir("build-api-dts-global-this", {
        ...project,
        // In a script `list` is a property of globalThis. In a module `globalThis.list` is any, and then `n` is too.
        "src/cli.ts": `var list: number[] = [1, 2];\nconsole.log(list.length, globalThis.list.map(n => n + 1));\n`,
      });
      const root = String(dir);
      const outputs = await build(root, { entrypoints: [join(root, "src/cli.ts")] });
      const [javascript, typed] = [await lines(outputs, "cli.js"), await lines(outputs, "cli.aot.ts")];
      expect(javascript.at(-2)).toContain("globalThis.list.map(");
      expect([typed[0], typed.at(-2)]).toEqual(["", javascript.at(-2)]);
    });

    test("a type error that the file has with and without export {}: export {} stays", async () => {
      using dir = tempDir("build-api-dts-same-error", {
        ...project,
        // The .aot.ts file has no such reference: `globalThis.build` is an error there, with and without export {}.
        "src/globals.d.ts": `declare var build: { id: string };\n`,
        "src/cli.ts": `/// <reference path="./globals.d.ts" />\nimport { join } from "./join";\njoin("build", globalThis.build.id);\n`,
      });
      const root = String(dir);
      const outputs = await build(root, { entrypoints: [join(root, "src/cli.ts")] });
      expect((await lines(outputs, "cli.aot.ts")).slice(-2)).toEqual(["export {};", ""]);
    });

    test("a file that type checks only with export {}: export {} stays, with the any that it costs", async () => {
      using dir = tempDir("build-api-dts-only-with-export", {
        ...project,
        // Without export {} the .aot.ts file is a script, and a top-level await is an error there.
        // With it `list` is no property of globalThis: `globalThis.list` is any, and then `n` is too.
        "src/list.ts": `var list: number[] = [1, 2];\nconsole.log(list.length);\n`,
        "src/cli.ts": `import "./list";\nconst text: string = await Promise.resolve("x");\nconsole.log(text, globalThis.list.map(n => n + 1));\n`,
      });
      const root = String(dir);
      const outputs = await build(root, { entrypoints: [join(root, "src/cli.ts")] });
      expect((await lines(outputs, "cli.aot.ts")).slice(-3)).toEqual([
        "console.log(text, globalThis.list.map((n: any) => n + 1));",
        "export {};",
        "",
      ]);
    });

    test("a file with a type error with export {} and another without it: the warning names the one without it", async () => {
      using dir = tempDir("build-api-dts-fails-both-ways", {
        ...project,
        // With export {} the interface is local, and `window.greeter` is an error. Without it the top-level await is one.
        "src/polyfill.ts": `interface Window {\n  greeter: string;\n}\nwindow.greeter = "hello";\n`,
        "src/cli.ts": `import "./polyfill";\nconst text: string = await Promise.resolve(window.greeter);\nconsole.log(text);\n`,
      });
      const root = String(dir);
      const built = await Bun.build({
        entrypoints: [join(root, "src/cli.ts")],
        outdir: join(root, "out"),
        tsconfig: join(root, "tsconfig.json"),
        target: "bun",
        dts: true,
      });
      expect(built.logs.map(log => [log.level, log.message])).toEqual([
        [
          "warn",
          expect.stringMatching(/ are left out: they have type errors, the first at cli\.aot\.ts:\d+:\d+: TS1375: /),
        ],
      ]);
      expect(filesIn(join(root, "out")).filter(name => name.endsWith(".aot.ts"))).toEqual([]);
    });

    test("a module that declares a global under declare global: ends with export {}", async () => {
      using dir = tempDir("build-api-dts-declare-global", {
        ...project,
        "src/polyfill.ts": `declare global {\n  interface Window {\n    greeter: string;\n  }\n}\nwindow.greeter = "hello";\nexport {};\n`,
        "src/cli.ts": `import "./polyfill";\nconsole.log(window.greeter);\n`,
      });
      const root = String(dir);
      const outputs = await build(root, { entrypoints: [join(root, "src/cli.ts")] });
      const typed = await lines(outputs, "cli.aot.ts");
      expect([typed[0], ...typed.slice(-2)]).toEqual(["", "export {};", ""]);
      expect(typed).toContain("declare global {");
    });
  });
});
