import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
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

const conditions = (stem: string) => ({ types: `./${stem}.d.ts`, default: `./${stem}.js` });

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
    expect(filesIn(dist)).toEqual(["LICENSE", "README.md", "area.d.ts", "index.d.ts", "index.js", "package.json"]);
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
      files: ["LICENSE", "README.md", "area.d.ts", "index.d.ts", "index.js"],
      sideEffects: false,
      engines: { node: ">=18" },
      dependencies: { "left-pad": "^1.3.0" },
      peerDependencies: { react: ">=18" },
      peerDependenciesMeta: { react: { optional: true } },
      publishConfig: { access: "public" },
    });
    expect(Object.keys(json(join(dist, "package.json")).exports["."])).toEqual(["types", "default"]);
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
      files: ["area.d.ts", "index.d.ts", "index.js"],
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
    expect(built.stderr).toBe("");
    expect(built.exitCode).toBe(0);
    expect(json(join(String(dir), "dist/package.json")).exports).toEqual({
      ".": conditions("index"),
      "./where": { browser: conditions("where/browser"), default: conditions("where/server") },
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
    expect(built.stderr).toBe("");
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
      ".": conditions("index"),
      "./area": conditions("area"),
      "./extra": conditions("extra"),
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
    expect(readFileSync(join(String(dir), `dist/${stem}.js`), "utf8")).toContain("var from = ");
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
