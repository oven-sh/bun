import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

async function run(cwd: string, cmd: string[]) {
  await using proc = Bun.spawn({ cmd, cwd, env: { ...bunEnv, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const bun = (cwd: string, ...args: string[]) => run(cwd, [bunExe(), ...args]);
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const filesIn = (folder: string) =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry =>
      join(entry.parentPath, entry.name)
        .slice(folder.length + 1)
        .replaceAll("\\", "/"),
    )
    .sort();

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "esnext",
    types: [],
    lib: ["esnext"],
    skipLibCheck: false,
    noEmit: true,
  },
});

const sources = {
  "tsconfig.json": tsconfig,
  "src/index.ts": `import { area } from "./area";
export interface Shape {
  kind: "circle" | "square";
  size: number;
}
export class Canvas {
  #shapes: Shape[] = [];
  add(shape: Shape): this {
    this.#shapes.push(shape);
    return this;
  }
  total(): number {
    let sum = 0;
    for (const shape of this.#shapes) sum += area(shape);
    return sum;
  }
}
export { area };
`,
  "src/area.ts": `import type { Shape } from "./index";
export function area(shape: Shape): number {
  return shape.kind === "circle" ? Math.PI * shape.size ** 2 : shape.size ** 2;
}
`,
  "src/extra.ts": `import { area } from "./area";
export function double(size: number): number {
  return 2 * area({ kind: "square", size });
}
`,
};

const packageJson = {
  name: "@acme/shapes",
  version: "1.2.3",
  description: "Shapes",
  keywords: ["shape"],
  license: "MIT",
  author: { name: "Acme" },
  repository: { type: "git", url: "https://example.com/shapes.git" },
  private: true,
  type: "commonjs",
  main: "dist/index.js",
  types: "dist/index.d.ts",
  files: ["dist"],
  scripts: { build: "bun compile --library" },
  workspaces: ["packages/*"],
  sideEffects: false,
  engines: { node: ">=18" },
  dependencies: { "left-pad": "^1.3.0" },
  peerDependencies: { react: ">=18" },
  peerDependenciesMeta: { react: { optional: true } },
  devDependencies: { typescript: "^5" },
  publishConfig: { access: "public" },
};

const conditions = (stem: string) => ({
  aot: `./${stem}.aot.ts`,
  types: `./${stem}.d.ts`,
  default: `./${stem}.js`,
});
const untypedConditions = (stem: string) => ({ types: `./${stem}.d.ts`, default: `./${stem}.js` });
const NO_TYPED_FILES_WITHOUT_BUNDLING =
  "warn: the .aot.ts files that --aot compiles a package from are left out: they do not support --no-bundle yet\n";

describe.concurrent("bun compile --library", () => {
  test("writes JavaScript, declaration files and a package.json into dist", async () => {
    using dir = tempDir("library", {
      ...sources,
      "package.json": JSON.stringify(packageJson),
      "README.md": "# Shapes\n",
      "LICENSE": "MIT\n",
      "NOTES.md": "",
    });
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    const dist = join(String(dir), "dist");
    expect(filesIn(dist)).toEqual([
      "LICENSE",
      "README.md",
      "area.d.ts",
      "index.aot.ts",
      "index.d.ts",
      "index.js",
      "package.json",
    ]);
    const table = built.stdout.split("\n").filter(line => / \(.+\)$/.test(line));
    expect(table.map(line => line.trim().split(" ")[0]).sort()).toEqual(filesIn(dist));
    expect([...new Set(table.map(line => line.search(/\d/)))]).toHaveLength(1);
    expect(table.filter(line => line.endsWith("(declaration)")).map(line => line.trim().split(" ")[0])).toEqual([
      "area.d.ts",
      "index.d.ts",
    ]);
    expect(json(join(dist, "package.json"))).toEqual({
      name: "@acme/shapes",
      version: "1.2.3",
      description: "Shapes",
      keywords: ["shape"],
      license: "MIT",
      author: { name: "Acme" },
      repository: { type: "git", url: "https://example.com/shapes.git" },
      type: "module",
      main: "./index.js",
      module: "./index.js",
      types: "./index.d.ts",
      exports: { ".": conditions("index"), "./package.json": "./package.json" },
      compilerOptions: { strict: true, lib: ["esnext"] },
      files: ["LICENSE", "README.md", "area.d.ts", "index.aot.ts", "index.d.ts", "index.js"],
      sideEffects: false,
      engines: { node: ">=18" },
      dependencies: { "left-pad": "^1.3.0" },
      peerDependencies: { react: ">=18" },
      peerDependenciesMeta: { react: { optional: true } },
      publishConfig: { access: "public" },
    });
    expect(Object.keys(json(join(dist, "package.json")).exports["."])).toEqual(["aot", "types", "default"]);
    expect(json(join(String(dir), "package.json"))).toEqual(packageJson);
    expect(readFileSync(join(dist, "package.json"), "utf8")).toStartWith('{\n  "name": "@acme/shapes",\n');
    expect(readFileSync(join(dist, "package.json"), "utf8")).toEndWith("}\n");
    const packed = await bun(dist, "pm", "pack", "--dry-run");
    expect([...packed.stdout.matchAll(/^packed \S+ (.+)$/gm)].map(match => match[1]).sort()).toEqual(filesIn(dist));
  });

  test("without a package.json, the package is named after the folder", async () => {
    using dir = tempDir("library-unnamed", { "My Shapes!/x": "" });
    const project = join(String(dir), "My Shapes!");
    for (const [path, text] of Object.entries(sources)) await Bun.write(join(project, path), text);
    const built = await bun(project, "compile", "--library", "src/index.ts", "--outdir", "out");
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    expect(json(join(project, "out/package.json"))).toEqual({
      name: "my-shapes-",
      version: "0.0.0",
      type: "module",
      main: "./index.js",
      module: "./index.js",
      types: "./index.d.ts",
      exports: { ".": conditions("index"), "./package.json": "./package.json" },
      compilerOptions: { strict: true, lib: ["esnext"] },
      files: ["area.d.ts", "index.aot.ts", "index.d.ts", "index.js"],
    });
    expect(existsSync(join(project, "package.json"))).toBe(false);
  });

  test("one entry in exports for each entry point", async () => {
    using dir = tempDir("library-entry-points", {
      ...sources,
      "src/tools/index.ts": `export const tool: string = "hammer";\n`,
      "package.json": JSON.stringify({ name: "shapes", version: "1.0.0" }),
    });
    const built = await bun(String(dir), "compile", "--library", "src/index.ts", "src/extra.ts", "src/tools/index.ts");
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    const written = json(join(String(dir), "dist/package.json"));
    expect(written.exports).toEqual({
      ".": conditions("index"),
      "./extra": conditions("extra"),
      "./tools": conditions("tools/index"),
      "./package.json": "./package.json",
    });
    expect({ main: written.main, module: written.module, types: written.types }).toEqual({
      main: "./index.js",
      module: "./index.js",
      types: "./index.d.ts",
    });
  });

  const where = {
    "src/where/browser.ts": `export const where: string = "browser";\n`,
    "src/where/server.ts": `export const where: string = "server";\n`,
  };

  test("without an entry point, the TypeScript files that exports points at are built, under their names and conditions", async () => {
    using dir = tempDir("library-exports-of-sources", {
      ...sources,
      ...where,
      "package.json": JSON.stringify({
        name: "shapes",
        version: "1.0.0",
        exports: {
          ".": {
            bun: "./src/index.ts",
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
            require: "./dist/index.cjs",
          },
          "./more": "./src/extra.ts",
          "./where": {
            browser: "./src/where/browser.ts",
            worker: { import: "./lib/worker.mjs", require: "./lib/worker.cjs" },
            default: "./src/where/server.ts",
          },
          "./package.json": "./package.json",
        },
      }),
      "app/app.mjs": `import { where } from "shapes/where";\nimport { double } from "shapes/more";\nconsole.log(where, double(2));\n`,
    });
    const built = await bun(String(dir), "compile", "--library");
    expect(built.stderr.split("\n").filter(line => line !== "")).toEqual([
      `warn: dist/package.json has no "require" condition for ".", because this build doesn't write ./dist/index.cjs`,
      `warn: dist/package.json is missing 2 conditions for "./where" (the first is "worker" > "import"), because this build doesn't write ./lib/worker.mjs`,
    ]);
    expect(built.exitCode).toBe(0);
    const written = json(join(String(dir), "dist/package.json"));
    expect(written.exports).toEqual({
      ".": conditions("index"),
      "./more": conditions("extra"),
      "./where": { browser: conditions("where/browser"), default: conditions("where/server") },
      "./package.json": "./package.json",
    });
    expect({ main: written.main, module: written.module, types: written.types }).toEqual({
      main: "./index.js",
      module: "./index.js",
      types: "./index.d.ts",
    });
    cpSync(join(String(dir), "dist"), join(String(dir), "app/node_modules/shapes"), { recursive: true });
    expect(await bun(join(String(dir), "app"), "app.mjs")).toEqual({ stdout: "server 8\n", stderr: "", exitCode: 0 });
    expect(await bun(join(String(dir), "app"), "--conditions=browser", "app.mjs")).toEqual({
      stdout: "browser 8\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("exports that is one path", async () => {
    using dir = tempDir("library-exports-is-a-path", {
      ...sources,
      "package.json": JSON.stringify({ name: "shapes", version: "1.0.0", exports: "./src/extra.ts" }),
    });
    const built = await bun(String(dir), "compile", "--library");
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    expect(json(join(String(dir), "dist/package.json")).exports).toEqual({
      ".": conditions("extra"),
      "./package.json": "./package.json",
    });
  });

  test("--no-bundle: a package that imports itself by name finds the file that its own conditions choose", async () => {
    using dir = tempDir("library-imports-itself", {
      "tsconfig.json": tsconfig,
      ...where,
      "src/index.ts": `import { where } from "shapes/where";\nexport const place: string = "on the " + where;\n`,
      "package.json": JSON.stringify({
        name: "shapes",
        version: "1.0.0",
        exports: {
          ".": "./src/index.ts",
          "./where": { browser: "./src/where/browser.ts", default: "./src/where/server.ts" },
        },
      }),
      "app/app.mjs": `import { place } from "shapes";\nconsole.log(place);\n`,
    });
    const built = await bun(String(dir), "compile", "--library", "--no-bundle");
    expect(built.stderr).toBe(NO_TYPED_FILES_WITHOUT_BUNDLING);
    expect(built.exitCode).toBe(0);
    expect(json(join(String(dir), "dist/package.json")).exports).toEqual({
      ".": untypedConditions("index"),
      "./where": { browser: untypedConditions("where/browser"), default: untypedConditions("where/server") },
      "./package.json": "./package.json",
    });
    cpSync(join(String(dir), "dist"), join(String(dir), "app/node_modules/shapes"), { recursive: true });
    expect(await bun(join(String(dir), "app"), "app.mjs")).toEqual({
      stdout: "on the server\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await bun(join(String(dir), "app"), "--conditions=browser", "app.mjs")).toEqual({
      stdout: "on the browser\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("--no-bundle: every file is an entry point", async () => {
    using dir = tempDir("library-no-bundle", {
      ...sources,
      "package.json": JSON.stringify({ name: "shapes", version: "1.0.0" }),
    });
    const built = await bun(
      String(dir),
      "compile",
      "--library",
      "--no-bundle",
      "src/index.ts",
      "src/area.ts",
      "src/extra.ts",
    );
    expect(built.stderr).toBe(NO_TYPED_FILES_WITHOUT_BUNDLING);
    expect(built.exitCode).toBe(0);
    expect(filesIn(join(String(dir), "dist"))).toEqual([
      "area.d.ts",
      "area.js",
      "extra.d.ts",
      "extra.js",
      "index.d.ts",
      "index.js",
      "package.json",
    ]);
    const written = json(join(String(dir), "dist/package.json"));
    expect(written.exports).toEqual({
      ".": untypedConditions("index"),
      "./area": untypedConditions("area"),
      "./extra": untypedConditions("extra"),
      "./package.json": "./package.json",
    });
    expect(written.main).toBe("./index.js");
  });

  test("a source outside the root directory has no place for its declaration file", async () => {
    using dir = tempDir("library-outside-the-root", {
      "tsconfig.json": tsconfig,
      "package.json": JSON.stringify({ name: "shapes", version: "1.0.0" }),
      "src/index.ts": `export { shared } from "../shared/value";\n`,
      "shared/value.ts": `export const shared: number = 1;\n`,
    });
    const refused = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(refused.stderr).toBe(
      `error: cannot write a declaration file for ${join(String(dir), "shared/value.ts")} because it is outside the root directory ${join(String(dir), "src")}. Pass --root to change it\n`,
    );
    expect(refused.exitCode).toBe(1);
    const built = await bun(String(dir), "compile", "--library", "src/index.ts", "--root", ".");
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    expect(json(join(String(dir), "dist/package.json")).exports).toEqual({
      ".": conditions("src/index"),
      "./package.json": "./package.json",
    });
    expect(existsSync(join(String(dir), "dist/shared/value.d.ts"))).toBe(true);
  });

  test("dependencies and peerDependencies stay imports, devDependencies are bundled", async () => {
    using dir = tempDir("library-externals", {
      "tsconfig.json": tsconfig,
      "package.json": JSON.stringify({
        name: "uses",
        version: "1.0.0",
        dependencies: { dep: "1" },
        peerDependencies: { peer: "1" },
        optionalDependencies: { optional: "1" },
        devDependencies: { dev: "1" },
      }),
      "index.ts": `import { dep } from "dep";\nimport { inner } from "dep/inner";\nimport { peer } from "peer";\nimport { optional } from "optional";\nimport { dev } from "dev";\nexport const all: string[] = [dep, inner, peer, optional, dev];\n`,
      ...Object.fromEntries(
        ["dep", "peer", "optional", "dev"].flatMap(name => [
          [
            `node_modules/${name}/package.json`,
            JSON.stringify({ name, version: "1.0.0", type: "module", main: "index.js", types: "index.d.ts" }),
          ],
          [`node_modules/${name}/index.js`, `export const ${name} = "from ${name}";\n`],
          [`node_modules/${name}/index.d.ts`, `export declare const ${name}: string;\n`],
        ]),
      ),
      "node_modules/dep/inner.js": `export const inner = "from dep/inner";\n`,
      "node_modules/dep/inner.d.ts": `export declare const inner: string;\n`,
    });
    const built = await bun(String(dir), "compile", "--library");
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    const javascript = readFileSync(join(String(dir), "dist/index.js"), "utf8");
    expect([...javascript.matchAll(/from "([^"]+)"/g)].map(match => match[1]).sort()).toEqual([
      "dep",
      "dep/inner",
      "optional",
      "peer",
    ]);
    expect(javascript).toContain(`"from dev"`);
  });

  test("process.env.NODE_ENV and JSX are left for whoever uses the package", async () => {
    using dir = tempDir("library-neutral", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, jsx: "react-jsx" },
      }),
      "package.json": JSON.stringify({ name: "neutral", version: "1.0.0", peerDependencies: { react: "*" } }),
      "index.tsx": `declare const process: { env: Record<string, string | undefined> };\nexport const mode = process.env.NODE_ENV;\nexport const element = <div />;\n`,
      "node_modules/react/package.json": JSON.stringify({
        name: "react",
        version: "19.0.0",
        exports: {
          "./jsx-runtime": { types: "./jsx-runtime.d.ts", default: "./jsx-runtime.js" },
          "./jsx-dev-runtime": { types: "./jsx-runtime.d.ts", default: "./jsx-runtime.js" },
        },
      }),
      "node_modules/react/jsx-runtime.js": `export const jsx = () => null, jsxs = jsx, jsxDEV = jsx, Fragment = null;\n`,
      "node_modules/react/jsx-runtime.d.ts": `export declare function jsx(type: unknown, props: unknown): null;\nexport declare const jsxs: typeof jsx, jsxDEV: typeof jsx, Fragment: null;\nexport declare namespace JSX { type Element = null; interface IntrinsicElements { div: {} } }\n`,
    });
    const built = await bun(String(dir), "compile", "--library");
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    const javascript = readFileSync(join(String(dir), "dist/index.js"), "utf8");
    expect(javascript).toContain("process.env.NODE_ENV");
    expect(javascript).toContain(`from "react/jsx-runtime"`);
    expect(javascript).not.toContain("jsxDEV");
    expect(javascript).not.toStartWith("// @bun");
  });

  test("bin is kept where its file is written", async () => {
    using dir = tempDir("library-bin", {
      ...sources,
      "src/cli.ts": `#!/usr/bin/env node\ndeclare const console: { log(...values: unknown[]): void };\nconsole.log("cli");\n`,
      "package.json": JSON.stringify({
        name: "shapes",
        version: "1.0.0",
        bin: { shapes: "./src/cli.ts", built: "dist/cli.js", other: "./bin/other.js" },
      }),
    });
    const built = await bun(String(dir), "compile", "--library", "src/index.ts", "src/cli.ts");
    expect(built.stderr).toBe(
      `warn: dist/package.json has no "other" bin, because ./bin/other.js is not an entry point\n`,
    );
    expect(built.exitCode).toBe(0);
    expect(json(join(String(dir), "dist/package.json")).bin).toEqual({ shapes: "./cli.js", built: "./cli.js" });
  });

  test("warns about each entry of exports and bin that it leaves out", async () => {
    using dir = tempDir("library-left-out", {
      ...sources,
      "style.css": "a {}\n",
      "package.json": JSON.stringify({
        name: "shapes",
        version: "1.0.0",
        bin: "./src/cli.ts",
        exports: {
          ".": "./src/index.ts",
          "./extra": "./src/extra.ts",
          "./style.css": "./style.css",
          "./package.json": "./package.json",
        },
      }),
    });
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built.stderr.split("\n").filter(line => line !== "")).toEqual([
      `warn: dist/package.json has no "./extra" export, because no entry point builds it`,
      `warn: dist/package.json has no "./style.css" export, because no entry point builds it`,
      `warn: dist/package.json has no "shapes" bin, because ./src/cli.ts is not an entry point`,
    ]);
    expect(built.exitCode).toBe(0);
    expect(Object.keys(json(join(String(dir), "dist/package.json")).exports)).toEqual([".", "./package.json"]);
  });

  test("--outdir . without an entry point is refused for what it is", async () => {
    using dir = tempDir("library-outdir-is-the-project", {
      ...sources,
      "package.json": JSON.stringify({ name: "shapes", version: "1.0.0" }),
    });
    expect(await bun(String(dir), "compile", "--library", "--outdir", ".")).toEqual({
      stdout: "",
      stderr: `error: --library writes a package.json into --outdir, so --outdir can't be the project folder (${String(dir)}). Use a folder inside it, such as --outdir=dist\n`,
      exitCode: 1,
    });
  });

  test.each([
    [
      "module",
      { module: "lib/start.ts" },
      { "lib/start.ts": "export const from: string = 'module';\n", "index.ts": "export {};\n" },
      "start",
    ],
    [
      "index.ts",
      { main: "dist/index.js" },
      { "index.ts": "export const from: string = 'index';\n", "dist/index.js": "export {};\n" },
      "index",
    ],
    ["src/index.ts", { main: "dist/index.js" }, { "src/index.ts": "export const from: string = 'src';\n" }, "index"],
  ])("without an entry point: %s", async (_, fields, files, stem) => {
    using dir = tempDir("library-finds", {
      "tsconfig.json": tsconfig,
      "package.json": JSON.stringify({ name: "finds", version: "1.0.0", ...fields }),
      ...files,
    });
    const built = await bun(String(dir), "compile", "--library");
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    expect(readFileSync(join(String(dir), `dist/${stem}.js`), "utf8")).toContain("const from = ");
    expect(json(join(String(dir), "dist/package.json")).exports).toEqual({
      ".": conditions(stem),
      "./package.json": "./package.json",
    });
  });

  test.each([
    [
      ["--outdir", "."],
      (dir: string) =>
        `error: --library writes a package.json into --outdir, so --outdir can't be the project folder (${dir}). Use a folder inside it, such as --outdir=dist\n`,
    ],
    [
      ["--outdir", "src"],
      () =>
        "error: the entry point src/index.ts is inside --outdir, where it would be overwritten. Choose another --outdir\n",
    ],
    [["--outfile", "out.js"], () => "error: --library writes a folder. Use --outdir instead of --outfile\n"],
    [["--compile"], () => "error: --library cannot be used with --compile\n"],
    [["--aot"], () => "error: --library cannot be used with --aot\n"],
    [["--trim"], () => "error: --library cannot be used with --trim\n"],
    [["--format=iife"], () => "error: --library only supports --format=esm and --format=cjs\n"],
    [
      ["--target=bun-linux-x64"],
      () => "error: --library only supports --target=bun, --target=node and --target=browser\n",
    ],
  ])("%j is refused", async (flags, stderr) => {
    using dir = tempDir("library-refused", { ...sources, "package.json": JSON.stringify(packageJson) });
    expect(await bun(String(dir), "compile", "--library", "src/index.ts", ...flags)).toEqual({
      stdout: "",
      stderr: stderr(String(dir)),
      exitCode: 1,
    });
    expect(json(join(String(dir), "package.json"))).toEqual(packageJson);
  });

  test("is the command in a project that has a compile script", async () => {
    using dir = tempDir("library-script", {
      ...sources,
      "package.json": JSON.stringify({ name: "shapes", version: "1.0.0", scripts: { compile: "echo the script" } }),
    });
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built.stdout).not.toContain("the script");
    expect(built.exitCode).toBe(0);
    expect(existsSync(join(String(dir), "dist/package.json"))).toBe(true);
  });

  test("a type error fails the build", async () => {
    using dir = tempDir("library-type-error", {
      "tsconfig.json": tsconfig,
      "index.ts": `export const count: number = "one";\n`,
    });
    const built = await bun(String(dir), "compile", "--library");
    expect(built.stderr).toContain("TS2322");
    expect(built.exitCode).toBe(1);
    expect(existsSync(join(String(dir), "dist"))).toBe(false);
  });

  test("an export that a declaration file can't describe fails the build", async () => {
    using dir = tempDir("library-declaration-error", {
      "tsconfig.json": tsconfig,
      "index.ts": `export const Shape = class {\n  private size = 1;\n};\n`,
    });
    const built = await bun(String(dir), "compile", "--library");
    expect(built.stderr).toContain("TS4094");
    expect(built.exitCode).toBe(1);
    expect(existsSync(join(String(dir), "dist"))).toBe(false);
  });
});

describe.concurrent("the .aot.ts file that bun compile --library writes", () => {
  const library = (files: Record<string, string>) => ({
    "tsconfig.json": tsconfig,
    "package.json": JSON.stringify({ name: "shapes", version: "1.0.0" }),
    ...files,
  });
  const typedFile = (dir: unknown) => readFileSync(join(String(dir), "dist/index.aot.ts"), "utf8");

  test("is the bundle with the types of its sources", async () => {
    using dir = tempDir("library-typed-file", library(sources));
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(built.stdout).toMatch(/index\.aot\.ts .*\(aot source\)/);
    const typed = typedFile(dir);
    expect(typed).toContain("function area(shape: Shape): number {");
    expect(typed).toContain("interface Shape {");
    expect(typed).toContain("#shapes: Shape[] = [];");
    const javascript = readFileSync(join(String(dir), "dist/index.js"), "utf8");
    expect(javascript).not.toContain("debugId");
    expect(typed).not.toContain("debugId");
    expect(filesIn(join(String(dir), "dist")).filter(path => path.endsWith(".map"))).toEqual([]);
    const transpiled = new Bun.Transpiler({ loader: "ts", target: "node" }).transformSync(typed);
    const code = (text: string) => text.replace(/\/\/.*$/gm, "").replace(/\s+/g, "");
    expect(code(transpiled)).toBe(code(new Bun.Transpiler({ loader: "js", target: "node" }).transformSync(javascript)));
  });

  test.each([
    ["strict", { strict: true }, { strict: true }],
    ["nothing", {}, { strict: true }],
    ["a flag of strict off", { strict: true, strictNullChecks: false }, { strict: true, strictNullChecks: false }],
    ["strict off", { strict: false }, { strict: false }],
    [
      "strict off, a flag of it on",
      { strict: false, noImplicitAny: true },
      {
        strict: true,
        strictNullChecks: false,
        noImplicitThis: false,
        strictFunctionTypes: false,
        strictBindCallApply: false,
        strictBuiltinIteratorReturn: false,
        strictPropertyInitialization: false,
        useUnknownInCatchVariables: false,
      },
    ],
    [
      "flags beyond strict",
      { noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noImplicitReturns: true },
      { strict: true, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true },
    ],
    ["a lib", { lib: ["ES2022", "DOM"] }, { strict: true, lib: ["es2022", "dom"] }],
    [
      "how classes and JSX are written",
      { jsx: "react-jsx", experimentalDecorators: true, useDefineForClassFields: false },
      { strict: true, jsx: "react-jsx", experimentalDecorators: true, useDefineForClassFields: false },
    ],
    ["what the reader decides", { target: "es2022", module: "esnext", skipLibCheck: false }, { strict: true }],
  ])("compilerOptions in the package.json say how strict the sources are: %s", async (_, stated, written) => {
    using dir = tempDir("library-typed-file-options", {
      ...library(sources),
      "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "bundler", types: [], ...stated } }),
    });
    const built = await bun(String(dir), "compile", "--library", "src/index.ts", "src/extra.ts");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(json(join(String(dir), "dist/package.json")).compilerOptions).toEqual(written);
    expect(filesIn(join(String(dir), "dist")).filter(path => path.includes("tsconfig"))).toEqual([]);
  });

  test("a tsconfig.json above the package is another project's", async () => {
    using dir = tempDir("library-typed-file-config-above", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: false, lib: ["es5"], types: ["not-installed"] } }),
      "packages/links/package.json": JSON.stringify({ name: "links", version: "1.0.0" }),
      "packages/links/src/index.ts": `export function host(link: string, fallback?: string): string {
  const text: string = fallback ?? atob(btoa(link));
  return new URL(text).host;
}
`,
    });
    const built = await bun(join(String(dir), "packages/links"), "compile", "--library", "src/index.ts");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(json(join(String(dir), "packages/links/dist/package.json")).compilerOptions).toEqual({ strict: true });
    expect(filesIn(join(String(dir), "packages/links/dist"))).toContain("index.aot.ts");
  });

  test("keeps the source maps that the build asks for", async () => {
    using dir = tempDir("library-typed-file-maps", library(sources));
    const built = await bun(String(dir), "compile", "--library", "src/index.ts", "--sourcemap=external");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(filesIn(join(String(dir), "dist"))).toContain("index.js.map");
    expect(filesIn(join(String(dir), "dist"))).toContain("index.aot.ts");
  });

  test("a constant that is a unique symbol keeps its type", async () => {
    using dir = tempDir(
      "library-typed-file-symbols",
      library({
        "src/index.ts": `export const written: unique symbol = Symbol();
export const inferred = Symbol("inferred");
export interface Keyed {
  [written]: number;
  [inferred]: string;
}
export function read(keyed: Keyed): string {
  return keyed[inferred] + keyed[written];
}
`,
      }),
    );
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(typedFile(dir)).toContain("const written: unique symbol = Symbol();");
    expect(typedFile(dir)).toContain('const inferred = Symbol("inferred");');
  });

  test("a constant keeps the literal type that was inferred for it", async () => {
    using dir = tempDir(
      "library-typed-file-literals",
      library({
        "src/index.ts": `export const kind = "circle";
export const sides = 0;
export function same(value: typeof kind): "circle" {
  return value;
}
`,
      }),
    );
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(typedFile(dir)).toContain('const kind = "circle";');
    expect(typedFile(dir)).toContain("const sides = 0;");
  });

  test("a variable that starts as a constant keeps the wider type that was inferred for it", async () => {
    using dir = tempDir(
      "library-typed-file-widened",
      library({
        "src/index.ts": `const none = "none";
const few = 3;
export function pick(names: string[], most = few): string {
  let found = none;
  for (const name of names.slice(0, Math.max(most, names.length - 1))) found = name;
  most = names.length;
  return found + most;
}
`,
      }),
    );
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(typedFile(dir)).toContain('const none = "none";');
    expect(typedFile(dir)).toContain("let found = none;");
  });

  test("a cast of a call of new that is printed without parentheses", async () => {
    using dir = tempDir(
      "library-typed-file-bare-new",
      library({
        "src/index.ts": `export interface Counts extends Map<string, number[]> {
  total?: number;
}
export function counts(): Counts {
  const made = new Map<string, number[]>() as Counts;
  made.total = 0;
  return made;
}
`,
      }),
    );
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(typedFile(dir)).toContain("new Map<string, number[]> as Counts");
  });

  test("an entry point that is a script is not met twice when the .aot.ts files are type checked", async () => {
    using dir = tempDir(
      "library-typed-file-script",
      library({
        ...sources,
        "src/cli.ts": `declare const console: { log(...values: unknown[]): void };\nconsole.log("cli");\n`,
      }),
    );
    const built = await bun(String(dir), "compile", "--library", "src/index.ts", "src/cli.ts");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(filesIn(join(String(dir), "dist"))).toContain("cli.aot.ts");
  });

  const development = {
    "src/index.ts": `import { warn } from "./warn";
declare const __DEV__: boolean;
export function greet(name: string, times: number): string {
  if (__DEV__ && name.length === 0) throw new Error("a name is needed");
  if (__DEV__) {
    warn("one");
  } else {
    times += 1;
  }
  if (!__DEV__) times += 2;
  if (!__DEV__) {
    const twice: number = times * 2;
    times = twice;
  }
  __DEV__ && warn("two");
  const word: string = __DEV__ ? "debug" : "hello";
  if (name) {
    if (__DEV__) warn("three");
  }
  if (times > 3) if (__DEV__) warn("four");
  for (const letter of name) {
    if (__DEV__) warn(letter);
    else continue;
  }
  switch (times) {
    case 0:
      return "";
      times += 3;
    case 1:
      break;
      times += 4;
  }
  {
  }
  return later(word + " " + name);
  times += 5;
  function later(text: string): string {
    return text.repeat(times);
  }
  var hoisted = 1;
}
`,
    "src/warn.ts": `declare const __DEV__: boolean;
declare const console: { warn(text: string): void };
export function warn(text: string): void {
  if (__DEV__) console.warn(text);
}
`,
  };

  test("removes dead statements from the bundle and the .aot.ts file", async () => {
    using dir = tempDir("library-typed-file-dead", library(development));
    const built = await bun(String(dir), "compile", "--library", "src/index.ts", "--define", "__DEV__=false");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "dist/index.js"), "utf8")).toBe(`// src/index.ts
function greet(name, times) {
  times += 1;
  times += 2;
  {
    const twice = times * 2;
    times = twice;
  }
  const word = "hello";
  if (times > 3) {}
  for (const letter of name) {
    continue;
  }
  switch (times) {
    case 0:
      return "";
    case 1:
      break;
  }
  return later(word + " " + name);
  function later(text) {
    return text.repeat(times);
  }
  var hoisted;
}
export {
  greet
};
`);
    expect(typedFile(dir)).toBe(`// src/index.ts
function greet(name: string, times: number): string {
  times += 1;
  times += 2;
  {
    const twice: number = times * 2;
    times = twice;
  }
  const word: string = "hello";
  if (times > 3) {}
  for (const letter of name) {
    continue;
  }
  switch (times) {
    case 0:
      return "";
    case 1:
      break;
  }
  return later(word + " " + name);
  function later(text: string): string {
    return text.repeat(times);
  }
  var hoisted;
}
export {
  greet
};
`);
  });

  test("keeps a declare that code or a type still references", async () => {
    using dir = tempDir(
      "library-typed-file-declared",
      library({
        "src/index.ts": `declare const __DEV__: boolean;
declare const __MODE__: "fast" | "slow";
declare const __LEFT__: number;
export type Mode = typeof __MODE__;
export function mode(): Mode {
  return __DEV__ ? "slow" : __MODE__;
}
export const left: number = __LEFT__;
`,
      }),
    );
    const flags = ["--define", "__DEV__=false", "--define", '__MODE__="fast"'];
    const built = await bun(String(dir), "compile", "--library", "src/index.ts", ...flags);
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(typedFile(dir).match(/^declare .*$/gm)).toEqual([
      'declare const __MODE__: "fast" | "slow";',
      "declare const __LEFT__: number;",
    ]);
  });

  const rewritten = {
    "src/index.ts": `let notes = 0;
const note = (): void => void notes++;
export class Box {
  private hidden = 1;
  [key: string]: unknown;
}
export const special: ReadonlySet<string> = new Set(["Ada"]);
export function privateMember(box: Box): unknown {
  return box["hidden"];
}
export function declaredType(maker: object): unknown {
  const Made: any = maker.constructor;
  return new Made();
}
export function narrowedBehindACall(text?: string): number {
  note();
  if (!text) return 0;
  return text.length;
}
export class Chain {
  private later: Promise<Chain>[] = [];
  use(next?: Promise<Chain>) {
    if (next) {
      this.later.push(next.then(other => other.use()));
      return this;
    }
    return this;
  }
}
export function emptyBody(count: number): void {
  if (count > 3) {
    // Nothing yet.
  }
}
export function missing(value?: { size: number }): number {
  return typeof value === "undefined" ? 0 : value.size;
}
export function literal(which: "plain" | "loud"): { done: true } {
  const kind = "plain";
  const answer = { done: true as const };
  return which === kind ? answer : literal(kind);
}
`,
  };

  test.each([["--minify-syntax"], ["--minify-whitespace"], ["--minify-syntax", "--minify-whitespace"]])(
    "%s %s keeps the .aot.ts file",
    async (...flags) => {
      using dir = tempDir("library-typed-file-minified", library(rewritten));
      const built = await bun(String(dir), "compile", "--library", "src/index.ts", ...flags.filter(Boolean));
      expect(built).toMatchObject({ stderr: "", exitCode: 0 });
      expect(filesIn(join(String(dir), "dist"))).toContain("index.aot.ts");
      const javascript = readFileSync(join(String(dir), "dist/index.js"), "utf8");
      expect(javascript.match(/\b(let|var) \w+/g)).toEqual(["var notes"]);
      const code = (text: string) => text.replace(/\s+/g, "");
      const erased = new Bun.Transpiler({ loader: "ts", target: "node" }).transformSync(typedFile(dir));
      expect(code(erased)).toBe(code(new Bun.Transpiler({ loader: "js", target: "node" }).transformSync(javascript)));
    },
  );

  test("--minify-whitespace puts each statement of the .aot.ts file on its own line", async () => {
    using dir = tempDir(
      "library-typed-file-lines",
      library({
        "src/index.ts": `export function first(): number {
  // @ts-ignore
  const wrong: number = "one";
  return wrong;
}
export function second(): string {
  return "two";
}
`,
      }),
    );
    const built = await bun(String(dir), "compile", "--library", "src/index.ts", "--minify-whitespace");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(readFileSync(join(String(dir), "dist/index.js"), "utf8")).toBe(
      'function first(){const wrong="one";return wrong}function second(){return"two"}export{first,second};\n',
    );
    expect(typedFile(dir)).toBe(`// @ts-ignore
function first(): number{const wrong: number="one";
return wrong}
function second(): string{return"two"}
export{first,second};
`);
  });

  test.each([
    ["--minify", "--minify-identifiers"],
    ["--minify-identifiers", "--minify-identifiers"],
    ["--format=cjs", "--format other than esm"],
    ["--no-bundle", "--no-bundle"],
  ])("%s: a warning, and a package without it", async (flag, named) => {
    using dir = tempDir("library-typed-file-skipped", library(sources));
    const built = await bun(String(dir), "compile", "--library", "src/index.ts", flag);
    expect(built.stderr).toBe(
      `warn: the .aot.ts files that --aot compiles a package from are left out: they do not support ${named} yet\n`,
    );
    expect(built.exitCode).toBe(0);
    expect(filesIn(join(String(dir), "dist")).filter(path => /\.aot\.|tsconfig/.test(path))).toEqual([]);
    expect(JSON.stringify(json(join(String(dir), "dist/package.json")))).not.toContain('"aot"');
  });

  // A `declare namespace` makes no statement of the bundle. Where it holds a value, that value is there when the
  // program runs, under the name that the source has for it, and the JavaScript of the module reads that name. The
  // .aot.ts file is that JavaScript with types. So a namespace that holds a value keeps its name where the JavaScript
  // of its own module reads it. Every other namespace can get a number.
  const hosted = `declare namespace Host {
  const version: number;
}
export function version() {
  return Host.version;
}
`;
  const hostedTyped = `// src/index.ts
declare namespace Host {
  const version: number;
}
function version() {
  return Host.version;
}
export {
  version
};
`;

  // What bun check says of a file that assigns each export of the package to a type that nothing fits, in two
  // programs. One has the sources. The other is a folder of its own with the .aot.ts files alone. Each message names
  // the type of an export, so the two say the same where the .aot.ts file types each export as the sources do. A
  // number at the end of a name is left out: the .aot.ts file gives one to a name that it has twice.
  // `typedFile`: what the check says of the .aot.ts files themselves.
  async function callers(dir: unknown, entry = "src/index.ts") {
    const root = String(dir);
    const exported = [...readFileSync(join(root, "dist/index.js"), "utf8").matchAll(/export\s*\{([^}]*)\}/g)]
      .flatMap(found => found[1].split(","))
      .map(name =>
        name
          .trim()
          .split(/\s+as\s+/)
          .at(-1)!,
      )
      .filter(name => name !== "");
    const caller =
      `import * as library from "LIBRARY";\ntype Probe = { probe: true };\n` +
      exported.map((name, index) => `export const value${index}: Probe = library.${name};\n`).join("");
    using installed = tempDir("library-typed-file-installed", {
      "tsconfig.json": readFileSync(join(root, "tsconfig.json"), "utf8"),
      "by-typed-file.ts": caller.replace("LIBRARY", "./index.aot"),
    });
    for (const path of filesIn(join(root, "dist")).filter(path => path.endsWith(".aot.ts"))) {
      cpSync(join(root, "dist", path), join(String(installed), path));
    }
    if (existsSync(join(root, "node_modules"))) {
      cpSync(join(root, "node_modules"), join(String(installed), "node_modules"), { recursive: true });
    }
    writeFileSync(join(root, "by-sources.ts"), caller.replace("LIBRARY", "./" + entry.replace(/\.tsx?$/, "")));
    const said = async (cwd: string, file: string) => {
      const { stdout } = await bun(cwd, "check", "--no-pretty", file);
      const found = [...stdout.replaceAll("\\", "/").matchAll(/^(.+?)(\(\d+,\d+\)): error (TS\d+): (.*)$/gm)];
      const withoutNumbers = (message: string) => message.replace(/(?<=[A-Za-z_$])\d+\b/g, "");
      return {
        ofCaller: found.filter(one => one[1] === file).map(one => `${one[2]}: ${one[3]}: ${withoutNumbers(one[4])}`),
        ofOthers: found.filter(one => one[1] !== file).map(one => one[0]),
      };
    };
    const [bySources, byTypedFile] = await Promise.all([
      said(root, "by-sources.ts"),
      said(String(installed), "by-typed-file.ts"),
    ]);
    return { typedFile: byTypedFile.ofOthers, bySources: bySources.ofCaller, byTypedFile: byTypedFile.ofCaller };
  }
  const ofVersion = ["(3,14): TS2322: Type '() => number' is not assignable to type 'Probe'."];

  test("a declared namespace that the code reads keeps its name", async () => {
    using dir = tempDir("library-typed-file-namespace", library({ "src/index.ts": hosted }));
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(typedFile(dir)).toBe(hostedTyped);
    expect(await callers(dir)).toEqual({ typedFile: [], bySources: ofVersion, byTypedFile: ofVersion });
  });

  test("bun build --dts and Bun.build({ dts: true }) write a declared namespace under its name too", async () => {
    const stated = { strict: true, lib: ["esnext"] };
    using dir = tempDir("library-typed-file-namespace-entry-points", {
      ...library({ "src/index.ts": hosted }),
      "package.json": JSON.stringify({ name: "shapes", version: "1.0.0", compilerOptions: stated }),
    });
    const root = String(dir);
    const built = await bun(root, "build", "./src/index.ts", "--outdir", "by-command", "--dts");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    // The first line names the source by its path from where the build was started.
    const withoutSource = (text: string) => text.slice(text.indexOf("\n") + 1);
    expect(readFileSync(join(root, "by-command/index.aot.ts"), "utf8")).toBe(hostedTyped);
    const build = await Bun.build({
      entrypoints: [join(root, "src/index.ts")],
      outdir: join(root, "by-api"),
      tsconfig: join(root, "tsconfig.json"),
      dts: true,
    });
    expect(build.logs).toEqual([]);
    expect(withoutSource(readFileSync(join(root, "by-api/index.aot.ts"), "utf8"))).toBe(withoutSource(hostedTyped));
  });

  test("a declared namespace keeps its name whatever holds its value and wherever it is declared", async () => {
    using dir = tempDir(
      "library-typed-file-namespaces",
      library({
        "src/index.ts": `declare namespace Levels {
  const enum Level {
    Low = 1,
    High = 2,
  }
}
declare namespace Outer.Inner {
  const depth: number;
}
declare namespace Members {
  function read(): number;
  class Reader {
    size: number;
  }
  enum Mode {
    On,
    Off,
  }
  let count: number;
  var total: number;
}
export function read(merged: Merged) {
  const reader = new Members.Reader();
  const members = [Members.read(), reader.size, Members.Mode.On, Members.count, Members.total];
  return [Levels.Level.High, Outer.Inner.depth, Later.value, Twice.first + Twice.second, Merged.size + merged.size, ...members];
}
declare namespace Later {
  const value: number;
}
declare namespace Twice {
  const first: number;
}
declare namespace Twice {
  const second: number;
}
interface Merged {
  size: number;
}
declare namespace Merged {
  const size: number;
}
`,
      }),
    );
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(typedFile(dir)).toBe(`// src/index.ts
declare namespace Levels {
  const enum Level {
    Low = 1,
    High = 2,
  }
}
declare namespace Outer.Inner {
  const depth: number;
}
declare namespace Members {
  function read(): number;
  class Reader {
    size: number;
  }
  enum Mode {
    On,
    Off,
  }
  let count: number;
  var total: number;
}
declare namespace Later {
  const value: number;
}
declare namespace Twice {
  const first: number;
}
declare namespace Twice {
  const second: number;
}
interface Merged {
  size: number;
}
declare namespace Merged {
  const size: number;
}
function read(merged: Merged) {
  const reader = new Members.Reader;
  const members = [Members.read(), reader.size, Members.Mode.On, Members.count, Members.total];
  return [Levels.Level.High, Outer.Inner.depth, Later.value, Twice.first + Twice.second, Merged.size + merged.size, ...members];
}
export {
  read
};
`);
    const { typedFile: inTypedFile, bySources, byTypedFile } = await callers(dir);
    expect(bySources).toEqual([
      "(3,14): TS2322: Type '(merged: Merged) => (number | Mode)[]' is not assignable to type 'Probe'.",
    ]);
    expect({ inTypedFile, byTypedFile }).toEqual({ inTypedFile: [], byTypedFile: bySources });
  });

  // The build finds the module that reads a name through the source map of the bundle. Here three modules read what
  // they declare in each way, and each way has a name of its own: a read that the build gave to no module, or to
  // another module, would leave that name with a number.
  const reads: [name: string, read: (name: string) => string][] = [
    ["Started", name => name + ".tag`text`;"],
    ["Member", name => `export const member = ${name}.value;`],
    ["Argument", name => `export const argument = String(${name}.value);`],
    ["Shorthand", name => `export const shorthand = { ${name} };`],
    ["Template", name => "export const template = `${" + name + ".value}`;"],
    ["TypeOf", name => `export const typeOf = typeof ${name};`],
    ["Made", name => `export const made = new ${name}.Box();`],
    ["Chained", name => `export const chained = ${name}?.value;`],
    ["Indexed", name => `export const indexed = ${name}["value"];`],
    ["Spread", name => `export const spread = [...${name}.list];`],
    ["Default", name => `export function byDefault(value = ${name}.value) {\n  return value;\n}`],
    ["Extended", name => `export class Extension extends ${name}.Box {}`],
    ["Tagged", name => "export function tagged() {\n  return " + name + ".tag`text`;\n}"],
    ["Exported", name => `export default ${name}.value;`],
  ];
  const moduleThatReads = (module: string) =>
    reads
      .map(
        ([name]) => `declare namespace ${name + module} {
  const value: number;
  const list: number[];
  class Box {}
  function tag(strings: TemplateStringsArray): string;
}
`,
      )
      .join("") + reads.map(([name, read]) => read(name + module) + "\n").join("");

  test.each([
    ["nothing minified", []],
    ["--minify-syntax", ["--minify-syntax"]],
    ["--minify-whitespace", ["--minify-whitespace"]],
    ["--minify-syntax --minify-whitespace", ["--minify-syntax", "--minify-whitespace"]],
  ])("a declared namespace keeps its name however the code of its module reads it: %s", async (_, flags) => {
    using dir = tempDir(
      "library-typed-file-declared-reads",
      library({
        "src/first.ts": moduleThatReads("First"),
        "src/second.ts": moduleThatReads("Second"),
        "src/index.ts": `import first, * as First from "./first";
import second, * as Second from "./second";
${moduleThatReads("Entry")}globalThis.String([first, second, First, Second]);
`,
      }),
    );
    const built = await bun(String(dir), "compile", "--library", "src/index.ts", ...flags);
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(
      typedFile(dir)
        .match(/^declare namespace \w+/gm)
        ?.sort(),
    ).toEqual(
      ["First", "Second", "Entry"]
        .flatMap(module => reads.map(([name]) => `declare namespace ${name + module}`))
        .sort(),
    );
    const { typedFile: inTypedFile, bySources, byTypedFile } = await callers(dir);
    expect(bySources).toHaveLength(reads.length - 1);
    expect({ inTypedFile, byTypedFile }).toEqual({ inTypedFile: [], byTypedFile: bySources });
  });

  // `lines`: the lines of the .aot.ts file that have `name`, or `name` with the number that sets another declaration
  // of it apart. A file that assigns each export to a type that nothing fits gets the same errors from bun check
  // through the sources and through the .aot.ts file, and the .aot.ts file has none. `unchecked`: the .aot.ts
  // file of that one reads a name that it does not declare.
  type Named = {
    title: string;
    name: string;
    files: Record<string, string>;
    lines: string[];
    flags?: string[];
    unchecked?: true;
  };
  const withOptions = (options: object) =>
    JSON.stringify({ compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, ...options } });
  const names: Named[] = [
    {
      title: "two modules declare the namespace that both read: it is written once",
      name: "Host",
      files: {
        "src/index.ts": `import { other } from "./other";
declare namespace Host {
  const version: number;
}
export function version() {
  return Host.version + other();
}
`,
        "src/other.ts": `declare namespace Host {
  const version: number;
}
export function other() {
  return Host.version;
}
`,
      },
      lines: ["declare namespace Host {", "return Host.version;", "return Host.version + other();"],
    },
    {
      title: "a namespace that shares its name with a type that the module imports",
      name: "Host",
      files: {
        "src/index.ts": `import type { Host } from "./types";
declare namespace Host {
  const version: number;
}
export function version(host?: Host) {
  return Host.version;
}
`,
        "src/types.ts": `export interface Host {
  id: string;
}
`,
      },
      lines: [
        "declare namespace Host {",
        "interface Host2 {",
        "function version(host?: Host2) {",
        "return Host.version;",
      ],
    },
    {
      title: "a namespace that shares its name with a type of a package, which another module imports too",
      name: "Host",
      files: {
        "node_modules/ext/package.json": JSON.stringify({ name: "ext", version: "1.0.0", types: "index.d.ts" }),
        "node_modules/ext/index.js": "export {};\n",
        "node_modules/ext/index.d.ts": "export interface Host {\n  id: string;\n}\n",
        "src/index.ts": `import type { Host } from "ext";
import { length } from "./length";
declare namespace Host {
  const version: number;
}
export function version(host: Host) {
  return Host.version + length(host);
}
`,
        "src/length.ts": `import type { Host } from "ext";
export function length(host: Host) {
  return host.id.length;
}
`,
      },
      lines: [
        'import type { Host as Host2 } from "ext";',
        'import type { Host } from "ext";',
        "function length(host: Host2) {",
        "declare namespace Host {",
        "function version(host: Host) {",
        "return Host.version + length(host);",
      ],
    },
    {
      title: "a namespace that the code reads only where JSX is written",
      name: "Dom",
      files: {
        "tsconfig.json": withOptions({ jsx: "react", jsxFactory: "Dom.h" }),
        "src/index.tsx": `declare namespace Dom {
  function h(tag: unknown, props: unknown, ...children: unknown[]): JSX.Element;
}
declare global {
  namespace JSX {
    interface IntrinsicElements {
      div: {};
    }
    interface Element {
      tag: unknown;
    }
  }
}
export function view() {
  return <div />;
}
`,
      },
      lines: ["declare namespace Dom {", 'return /* @__PURE__ */ Dom.h("div", null);'],
    },
    {
      title: "a namespace beside a parameter of its name, in a function that calls eval",
      name: "Host",
      files: {
        "src/index.ts": `declare namespace Host {
  const version: number;
}
export function version(code: string) {
  const run = (Host: string): unknown => eval(code + Host);
  return [Host.version, run("1")] as const;
}
`,
      },
      lines: [
        "declare namespace Host {",
        "const run = (Host: string): unknown => eval(code + Host);",
        'return [Host.version, run("1")] as const;',
      ],
    },
    {
      title: "a namespace beside a parameter of its name, which the bundle gives a number",
      name: "Host",
      files: {
        "src/index.ts": `declare namespace Host {
  const version: number;
}
export function length(Host: string) {
  return Host.length;
}
export function version() {
  return Host.version;
}
`,
      },
      lines: [
        "declare namespace Host {",
        "function length(Host2: string) {",
        "return Host2.length;",
        "return Host.version;",
      ],
    },
    {
      title: "a type of another module that names a global of the name: globalThis",
      name: "Intl",
      files: {
        "src/index.ts": `import { styleOf } from "./style";
declare namespace Intl {
  const extra: number;
}
export function version() {
  return Intl.extra;
}
export { styleOf };
`,
        "src/style.ts": `export function styleOf(options: Intl.NumberFormatOptions) {
  return options.style;
}
`,
      },
      lines: [
        "function styleOf(options: globalThis.Intl.NumberFormatOptions) {",
        "declare namespace Intl {",
        "return Intl.extra;",
      ],
    },
    {
      title: "a dependency that is bundled declares the namespace alike: it is written once",
      name: "Host",
      files: {
        "package.json": JSON.stringify({ name: "shapes", version: "1.0.0", devDependencies: { dep: "1.0.0" } }),
        "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main: "./index.ts" }),
        "node_modules/dep/index.ts": `declare namespace Host {
  const version: number;
}
export function fromDependency(): typeof Host.version {
  return 1;
}
`,
        "src/index.ts": `import { fromDependency } from "dep";
declare namespace Host {
  const version: number;
}
export function version() {
  return Host.version + fromDependency();
}
`,
      },
      lines: [
        "declare namespace Host {",
        "function fromDependency(): typeof Host.version {",
        "return Host.version + fromDependency();",
      ],
    },
    {
      title: "a namespace of a file without import or export, where the project makes that file a module",
      name: "Host",
      files: {
        "tsconfig.json": withOptions({ moduleDetection: "force" }),
        "src/index.ts": `import "./held";
export function one() {
  return 1;
}
`,
        "src/held.ts": `declare namespace Host {
  const version: number;
}
globalThis.String(Host.version);
`,
      },
      lines: ["declare namespace Host {", "globalThis.String(Host.version);"],
    },
    {
      title: "a namespace with a name that the bundle for Bun writes with escapes",
      name: /Gr(?:ö|\\u\{f6\})(?:ß|\\u\{df\})e/.source,
      flags: ["--target=bun"],
      files: {
        "src/index.ts": `declare namespace Größe {
  const version: number;
}
export function length(Größe: string) {
  return Größe.length;
}
export function version() {
  return Größe.version;
}
`,
      },
      lines: [
        "declare namespace Größe {",
        "function length(Gr\\u{f6}\\u{df}e2: string) {",
        "return Gr\\u{f6}\\u{df}e2.length;",
        "return Gr\\u{f6}\\u{df}e.version;",
      ],
    },
    {
      title: "a namespace of a module that the bundle starts when it is imported",
      name: "Host",
      files: {
        "src/index.ts": `export async function version() {
  const lazy = await import("./lazy");
  return lazy.version();
}
`,
        "src/lazy.ts": `declare namespace Host {
  const version: number;
}
export const started = Host.version;
export function version() {
  return Host.version;
}
`,
      },
      lines: ["return Host.version;", "declare namespace Host {", "started = Host.version;"],
    },
    {
      title: "a namespace beside an import of its name in another module: the import gets the number",
      name: "Host",
      files: {
        "package.json": JSON.stringify({ name: "shapes", version: "1.0.0", dependencies: { ext: "1.0.0" } }),
        "node_modules/ext/package.json": JSON.stringify({ name: "ext", version: "1.0.0", types: "index.d.ts" }),
        "node_modules/ext/index.js": "export const Host = { y: 1 };\n",
        "node_modules/ext/index.d.ts": "export declare const Host: { y: number };\n",
        "src/other.ts": `import { Host } from "ext";
export function y(): number {
  return Host.y;
}
`,
        "src/index.ts": `import { y } from "./other";
declare namespace Host {
  const version: number;
}
export function version() {
  return Host.version + y();
}
`,
      },
      lines: [
        'import { Host as Host2 } from "ext";',
        "return Host2.y;",
        "declare namespace Host {",
        "return Host.version + y();",
      ],
    },
    {
      title: "a namespace beside a constant whose type the build writes in a second pass",
      name: "Host",
      files: {
        "src/index.ts": `declare namespace Host {
  const version: number;
}
const secret = { a: 1, b: "x" };
export type Secret = typeof secret;
export function version() {
  return Host.version;
}
`,
      },
      lines: ["declare namespace Host {", "return Host.version;"],
    },
    {
      title: "two modules declare the namespace beside a type of a package with its name: each is written once",
      name: "Host",
      files: {
        "node_modules/ext/package.json": JSON.stringify({ name: "ext", version: "1.0.0", types: "index.d.ts" }),
        "node_modules/ext/index.js": "export {};\n",
        "node_modules/ext/index.d.ts": "export interface Host {\n  id: string;\n}\n",
        "src/index.ts": `import type { Host } from "ext";
import { other } from "./other";
declare namespace Host {
  const version: number;
}
export function version(host: Host) {
  return Host.version + other(host);
}
`,
        "src/other.ts": `import type { Host } from "ext";
declare namespace Host {
  const version: number;
}
export function other(host: Host) {
  return Host.version + host.id.length;
}
`,
      },
      lines: [
        "declare namespace Host {",
        'import type { Host } from "ext";',
        "function other(host: Host) {",
        "return Host.version + host.id.length;",
        "function version(host: Host) {",
        "return Host.version + other(host);",
      ],
    },
    {
      title: "a namespace gets a number beside a bundled dependency that declares it in other words",
      name: "Host",
      files: {
        "package.json": JSON.stringify({ name: "shapes", version: "1.0.0", devDependencies: { dep: "1.0.0" } }),
        "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main: "./index.ts" }),
        "node_modules/dep/index.ts": `declare namespace Host { const version: number; }
export function fromDependency(): number {
  return Host.version;
}
`,
        "src/index.ts": `import { fromDependency } from "dep";
declare namespace Host {
  const version: number;
}
export function version() {
  return Host.version + fromDependency();
}
`,
      },
      lines: [
        "declare namespace Host { const version: number; }",
        "return Host.version;",
        "declare namespace Host3 {",
        "return Host.version + fromDependency();",
      ],
    },
    {
      title: "a namespace of a script that reads it gets a number, as before: a script declares a global",
      name: "Host",
      files: {
        "src/index.ts": `import "./globals";
export function one() {
  return 1;
}
`,
        "src/globals.ts": `declare namespace Host {
  const version: number;
}
globalThis.String(Host.version);
`,
      },
      lines: ["declare namespace Host2 {", "globalThis.String(Host.version);"],
      unchecked: true,
    },
    {
      title: "a namespace of types gets a number beside a constant of another module",
      name: "Host",
      files: {
        "src/index.ts": `import { hostVersion } from "./other";
declare namespace Host {
  type Version = number;
}
export function version(): Host.Version {
  return hostVersion();
}
`,
        "src/other.ts": `const Host = { version: 1 };
export function hostVersion(): number {
  return Host.version;
}
`,
      },
      lines: [
        "const Host = { version: 1 };",
        "return Host.version;",
        "declare namespace Host2 {",
        "function version(): Host2.Version {",
      ],
    },
    {
      title: "a namespace of types gets a number where the code reads a global of its name",
      name: "Intl",
      files: {
        "src/index.ts": `declare namespace Intl {
  interface Extra {
    digits: number;
  }
}
export function version(n: number, extra: Intl.Extra) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: extra.digits }).format(n).length;
}
`,
      },
      lines: [
        "declare namespace Intl2 {",
        "function version(n: number, extra: Intl2.Extra) {",
        "return new Intl.NumberFormat(undefined, { minimumFractionDigits: extra.digits }).format(n).length;",
      ],
    },
    {
      title: "a namespace that only a type reads gets a number beside a global that another module reads",
      name: "Math",
      files: {
        "src/index.ts": `import { floor } from "./other";
declare namespace Math {
  const extra: number;
}
export function extra(): typeof Math.extra {
  return floor(1.5);
}
`,
        "src/other.ts": `export function floor(n: number): number {
  return Math.floor(n);
}
`,
      },
      lines: ["return Math.floor(n);", "declare namespace Math2 {", "function extra(): typeof Math2.extra {"],
    },
    {
      title: "a namespace that only a type reads gets a number beside the code that the build adds",
      name: "Object",
      files: {
        "src/index.ts": `import * as other from "./other";
declare namespace Object {
  const marker: number;
}
export function marker(): typeof Object.marker {
  return Reflect.ownKeys(other).length;
}
`,
        "src/other.ts": `export function one(): number {
  return 1;
}
`,
      },
      lines: [
        "var __defProp = Object.defineProperty;",
        "declare namespace Object2 {",
        "function marker(): typeof Object2.marker {",
      ],
    },
    {
      title: "a namespace that only a type reads gets a number beside a banner that reads its name",
      name: "Host",
      flags: ["--banner", "var seen = typeof Host;"],
      files: {
        "src/index.ts": `declare namespace Host {
  const version: number;
}
export function version(): typeof Host.version {
  return 1;
}
`,
      },
      lines: ["var seen = typeof Host;", "declare namespace Host2 {", "function version(): typeof Host2.version {"],
      unchecked: true,
    },
    {
      title: "a namespace gets a number where only a parameter has its name",
      name: "Intl",
      files: {
        "src/index.ts": `declare namespace Intl {
  const extra: number;
}
export type Extra = typeof Intl.extra;
export function version(Intl: { pi: number }, r: number) {
  return Intl.pi * r * r;
}
`,
      },
      lines: [
        "declare namespace Intl2 {",
        "type Extra = typeof Intl2.extra;",
        "function version(Intl: { pi: number }, r: number) {",
        "return Intl.pi * r * r;",
      ],
    },
    {
      title: "a namespace of a script gets a number: the file has no scope for what a script adds to a global",
      name: "Intl",
      files: {
        "src/index.ts": `import "./globals";
export function format(n: number) {
  return new Intl.NumberFormat().format(n);
}
`,
        "src/globals.ts": `declare namespace Intl {
  const extra: number;
}
globalThis.String("loaded");
`,
      },
      lines: ["declare namespace Intl2 {", "return new Intl.NumberFormat().format(n);"],
    },
  ];

  test.each(names.map(named => [named.title, named] as const))("a declared namespace: %s", async (_, named) => {
    using dir = tempDir("library-typed-file-declared-names", library(named.files));
    const entry = "src/index.tsx" in named.files ? "src/index.tsx" : "src/index.ts";
    const built = await bun(String(dir), "compile", "--library", entry, ...(named.flags ?? []));
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    const hasName = new RegExp(`(?<![\\w$])${named.name}\\d*(?![\\w$])`);
    const found = typedFile(dir)
      .split(/\r?\n/)
      .filter(line => hasName.test(line));
    expect(found.map(line => line.trim())).toEqual(named.lines);
    if (named.unchecked) return;
    const { typedFile: inTypedFile, bySources, byTypedFile } = await callers(dir, entry);
    expect(bySources).not.toEqual([]);
    expect({ inTypedFile, byTypedFile }).toEqual({ inTypedFile: [], byTypedFile: bySources });
  });

  test("--splitting: a declared namespace keeps its name in the chunk that reads it", async () => {
    using dir = tempDir(
      "library-typed-file-declared-chunks",
      library({
        "src/index.ts": `import { shared } from "./shared";\nexport function one() {\n  return shared() + 1;\n}\n`,
        "src/extra.ts": `import { shared } from "./shared";\nexport function two() {\n  return shared() + 2;\n}\n`,
        "src/shared.ts": `declare namespace Host {
  const version: number;
}
export function shared() {
  return Host.version;
}
`,
      }),
    );
    const built = await bun(String(dir), "compile", "--library", "src/index.ts", "src/extra.ts", "--splitting");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    const dist = join(String(dir), "dist");
    const typed = filesIn(dist).filter(path => path.endsWith(".aot.ts"));
    const naming = typed.map(path => readFileSync(join(dist, path), "utf8").match(/^.*\bHost\d*\b.*$/gm));
    expect(typed).toHaveLength(3);
    expect(naming.filter(lines => lines !== null)).toEqual([["declare namespace Host {", "  return Host.version;"]]);
    const { bySources, byTypedFile } = await callers(dir);
    expect({ bySources, byTypedFile }).toEqual({ bySources: ofVersion, byTypedFile: ofVersion });
  });

  // One file cannot give one name two meanings, and the JavaScript cannot take another name. `means`: the file
  // where the name is something else, or the words for code that is of no file.
  type Refused = { title: string; name: string; files: Record<string, string>; means: string; flags?: string[] };
  const twoMeanings: Refused[] = [
    {
      title: "hides a global that another module reads",
      name: "Intl",
      files: {
        "src/index.ts": `import { format } from "./format";
declare namespace Intl {
  function supportedValuesOf(key: string): number;
}
export function count() {
  return Intl.supportedValuesOf("timeZone");
}
export { format };
`,
        "src/format.ts": `export function format(n: number): string {
  return new Intl.NumberFormat().format(n);
}
`,
      },
      means: "src/format.ts",
    },
    {
      title: "hides a global that another module reads, in a package that exports nothing",
      name: "Intl",
      files: {
        "src/index.ts": `import { format } from "./format";
declare namespace Intl {
  function supportedValuesOf(key: string): number;
}
globalThis.String(Intl.supportedValuesOf("timeZone") + format(1));
`,
        "src/format.ts": `export function format(n: number): string {
  return new Intl.NumberFormat().format(n);
}
`,
      },
      means: "src/format.ts",
    },
    {
      title: "has a member of another type in another module that reads it",
      name: "Host",
      files: {
        "src/index.ts": `import { other } from "./other";
declare namespace Host {
  function version(): number;
}
export function version() {
  return Host.version() + other().length;
}
`,
        "src/other.ts": `declare namespace Host {
  function version(): string;
}
export function other() {
  return Host.version();
}
`,
      },
      means: "src/index.ts",
    },
    {
      title: "is a constant that another module declares and reads",
      name: "Host",
      files: {
        "src/index.ts": `import { other } from "./other";
declare namespace Host {
  const version: number;
}
export function version() {
  return Host.version + other().length;
}
`,
        "src/other.ts": `declare const Host: { version: string };
export function other() {
  return Host.version;
}
`,
      },
      means: "src/other.ts",
    },
    {
      title: "is a global namespace that another module opens and names in a type",
      name: "Host",
      files: {
        "src/index.ts": `import { idOf } from "./other";
declare namespace Host {
  const version: number;
}
export function version() {
  return Host.version;
}
export { idOf };
`,
        "src/other.ts": `declare global {
  namespace Host {
    interface Shape {
      id: string;
    }
  }
}
export function idOf(shape: Host.Shape) {
  return shape.id;
}
`,
      },
      means: "src/other.ts",
    },
    {
      title: "is a global that a bundled dependency names in a type",
      name: "Intl",
      files: {
        "package.json": JSON.stringify({ name: "shapes", version: "1.0.0", devDependencies: { dep: "1.0.0" } }),
        "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main: "./index.ts" }),
        "node_modules/dep/index.ts": `export function styleOf(options: Intl.NumberFormatOptions) {
  return options.style;
}
`,
        "src/index.ts": `import { styleOf } from "dep";
declare namespace Intl {
  const extra: number;
}
export function version() {
  return Intl.extra;
}
export { styleOf };
`,
      },
      means: "node_modules/dep/index.ts",
    },
    {
      title: "is a name that a banner reads",
      name: "Host",
      flags: ["--banner", "var seen = typeof Host;"],
      files: { "src/index.ts": hosted },
      means: "code that the build adds",
    },
  ];

  test.each(twoMeanings.map(refused => [refused.title, refused] as const))(
    "a declared namespace that the code reads costs the .aot.ts file where its name %s",
    async (_, { name, files, means, flags }) => {
      using dir = tempDir("library-typed-file-two-meanings", library(files));
      const built = await bun(String(dir), "compile", "--library", "src/index.ts", ...(flags ?? []));
      const [declares, other] = [means === "src/index.ts" ? "src/other.ts" : "src/index.ts", means].map(path =>
        path.includes("/") ? `\\S*/${path.replaceAll(".", "\\.")}` : path,
      );
      expect(built.stderr.replaceAll("\\", "/")).toMatch(
        new RegExp(
          `^warn: the \\.aot\\.ts files that --aot compiles a package from are left out: index\\.js: ${declares} declares "${name}" and reads it, and ${other} means another "${name}"\n$`,
        ),
      );
      expect(built.exitCode).toBe(0);
      expect(filesIn(join(String(dir), "dist")).filter(path => /\.aot\.|tsconfig/.test(path))).toEqual([]);
    },
  );

  // What the .aot.ts file does not say yet. The JavaScript of each reads a value that the sources declare, and a
  // caller is checked as the sources say only where the .aot.ts file declares that value under the same name.
  test.todo.each([
    [
      "a namespace of a script that declares and has no JavaScript",
      {
        "src/index.ts": `import "./globals";\n${hosted.slice(hosted.indexOf("export"))}`,
        "src/globals.ts": hosted.slice(0, hosted.indexOf("export")),
      },
    ],
    [
      "a namespace of a declaration file of the project",
      {
        "src/index.ts": hosted.slice(hosted.indexOf("export")),
        "src/globals.d.ts": hosted.slice(0, hosted.indexOf("export")),
      },
    ],
    [
      "a namespace of a script, which the script and another module read",
      {
        "src/index.ts": `import "./globals";\n${hosted.slice(hosted.indexOf("export"))}`,
        "src/globals.ts": `${hosted.slice(0, hosted.indexOf("export"))}globalThis.String(Host.version);\n`,
      },
    ],
    [
      "the declared members of a namespace that the bundle keeps",
      {
        "src/index.ts": `namespace Host {\n  export declare const version: number;\n}\n${hosted.slice(hosted.indexOf("export"))}`,
      },
    ],
  ])("a declared value that the .aot.ts file does not type yet: %s", async (_, files) => {
    using dir = tempDir("library-typed-file-declared-elsewhere", library(files));
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    expect(await callers(dir)).toEqual({ typedFile: [], bySources: ofVersion, byTypedFile: ofVersion });
  });

  test("--splitting: an .aot.ts file imports the .aot.ts file of each chunk that its JavaScript imports", async () => {
    using dir = tempDir("library-typed-file-chunks", library(sources));
    const built = await bun(String(dir), "compile", "--library", "src/index.ts", "src/extra.ts", "--splitting");
    expect(built).toMatchObject({ stderr: "", exitCode: 0 });
    const dist = join(String(dir), "dist");
    const typedName = (path: string) => path.replace(/\.js$/, ".aot.ts");
    const imported = (path: string) =>
      [...readFileSync(join(dist, path), "utf8").matchAll(/ from "(\.[^"]+)"/g)].map(match => match[1]);
    const javascript = filesIn(dist).filter(path => path.endsWith(".js"));
    const chunk = javascript.find(path => path !== "index.js" && path !== "extra.js");
    expect(javascript).toHaveLength(3);
    expect(javascript.map(imported)).toEqual(javascript.map(path => (path === chunk ? [] : ["./" + chunk])));
    expect(javascript.map(path => imported(typedName(path)))).toEqual(
      javascript.map(path => imported(path).map(typedName)),
    );
    expect(json(join(dist, "package.json")).files).toContain(typedName(chunk!));
  });

  // index.aot.ts imports make.aot.ts, so the two are type checked together before they are written.
  // TODO: on Windows the build says nothing.
  test.todoIf(isWindows)(
    "--splitting: .aot.ts files that do not fit each other are a warning for whoever builds the package",
    async () => {
      using dir = tempDir(
        "library-typed-files-that-do-not-fit",
        library({
          "src/token.ts": `export class Token {
  private secret: number;
  constructor(secret: number) {
    this.secret = secret;
  }
  reveal(): number {
    return this.secret;
  }
}
`,
          "src/make.ts": `import { Token } from "./token";
export function make(secret: number): Token {
  return new Token(secret);
}
`,
          "src/index.ts": `import { make } from "./make";
import type { Token } from "./token";
export function read(token: Token): number {
  return token.reveal();
}
export function one(): number {
  return read(make(1));
}
`,
        }),
      );
      const built = await bun(String(dir), "compile", "--library", "src/index.ts", "src/make.ts", "--splitting");
      expect(built.stderr).toMatch(
        /^warn: the \.aot\.ts files that --aot compiles a package from are left out: they have type errors, the first at index\.aot\.ts:\d+:\d+: TS2345: Argument of type 'Token' is not assignable to parameter of type 'Token'\.\n$/,
      );
      expect(built.exitCode).toBe(0);
      expect(filesIn(join(String(dir), "dist")).filter(path => /\.aot\.|tsconfig/.test(path))).toEqual([]);
      expect(JSON.stringify(json(join(String(dir), "dist/package.json")))).not.toContain('"aot"');
    },
  );
});

describe.concurrent("a package built with bun compile --library", () => {
  async function install(dir: string) {
    const built = await bun(
      join(dir, "library"),
      "compile",
      "--library",
      "src/index.ts",
      "src/extra.ts",
      "--outdir",
      "../app/node_modules/@acme/shapes",
    );
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    return join(dir, "app");
  }

  const project = {
    ...Object.fromEntries(Object.entries(sources).map(([path, text]) => ["library/" + path, text])),
    "library/package.json": JSON.stringify({ name: "@acme/shapes", version: "1.2.3" }),
    "app/tsconfig.json": tsconfig,
    "app/package.json": JSON.stringify({ name: "app", type: "module", dependencies: { "@acme/shapes": "1.2.3" } }),
    "app/app.ts": `import { Canvas, type Shape } from "@acme/shapes";
import { double } from "@acme/shapes/extra";
declare const console: { log(...values: unknown[]): void };
const square: Shape = { kind: "square", size: 3 };
console.log(new Canvas().add(square).add(square).total(), double(2));
`,
    "app/wrong.ts": `import { double } from "@acme/shapes/extra";\nexport const wrong: string = double(2);\n`,
  };

  test("is accepted by bun check and by tsc, with skipLibCheck off", async () => {
    using dir = tempDir("library-checked", project);
    const app = await install(String(dir));
    const tsc = require.resolve("typescript/bin/tsc");
    for (const check of [["check"], [tsc]]) {
      const { stdout, stderr, exitCode } = await bun(app, ...check, "-p", "tsconfig.json");
      expect({ said: (stdout + stderr).match(/TS\d+/g), failed: exitCode !== 0 }).toEqual({
        said: ["TS2322"],
        failed: true,
      });
    }
    writeFileSync(join(app, "wrong.ts"), "export {};\n");
    for (const check of [["check"], [tsc]]) {
      const { stdout, stderr, exitCode } = await bun(app, ...check, "-p", "tsconfig.json");
      expect({ said: (stdout + stderr).match(/TS\d+/g), exitCode }).toEqual({ said: null, exitCode: 0 });
    }
    // tsc runs twice.
  }, 60_000);

  test("runs in Bun, and in Node.js where it is installed", async () => {
    using dir = tempDir("library-runs", project);
    const app = await install(String(dir));
    expect(await bun(app, "app.ts")).toEqual({ stdout: "18 8\n", stderr: "", exitCode: 0 });
    const node = Bun.which("node");
    if (!node) return;
    writeFileSync(
      join(app, "app.mjs"),
      `import { Canvas } from "@acme/shapes";\nimport { double } from "@acme/shapes/extra";\nconsole.log(new Canvas().add({ kind: "square", size: 3 }).total(), double(2));\n`,
    );
    expect(await run(app, [node, "app.mjs"])).toEqual({ stdout: "9 8\n", stderr: "", exitCode: 0 });
  });
});
