import { describe, expect, setDefaultTimeout, test } from "bun:test";
import * as esbuild from "esbuild";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { dirname, join, posix } from "path";
import { slot, unsupported } from "../../aot/run-programs";

setDefaultTimeout(120_000);

async function run(cwd: string, cmd: string[], env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env: { ...bunEnv, NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const bun = (cwd: string, ...args: string[]) => run(cwd, [bunExe(), ...args]);
const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const slashes = (path: string) => path.replaceAll("\\", "/");
const filesIn = (folder: string) =>
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => slashes(join(entry.parentPath, entry.name).slice(folder.length + 1)))
    .sort();

const node = Bun.which("node");
const nodeSays = (expression: string) =>
  node
    ? Bun.spawnSync({ cmd: [node, "-p", expression], env: bunEnv })
        .stdout.toString()
        .trim()
    : "";
const nodeRequiresModules = nodeSays("process.features.require_module") === "true";

const compilerOptions = {
  strict: true,
  module: "esnext",
  moduleResolution: "bundler",
  target: "esnext",
  types: [],
  lib: ["esnext", "dom"],
  skipLibCheck: false,
  noEmit: true,
};

const library = {
  "library/tsconfig.json": JSON.stringify({ compilerOptions }),
  "library/package.json": JSON.stringify({
    name: "@acme/shapes",
    version: "1.2.3",
    license: "MIT",
    scripts: { build: "bun compile --library" },
  }),
  "library/README.md": "# Shapes\n",
  "library/src/index.ts": `import { area } from "./area";
import { origin } from "./point";
export interface Shape {
  kind: "circle" | "square";
  size: number;
}
export function total(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += area(shape);
  return sum;
}
export const start = origin;
export { area };
export * from "./tools";
`,
  "library/src/area.ts": `import type { Shape } from "./index";
export function area(shape: Shape): number {
  return shape.kind === "circle" ? 3 * shape.size ** 2 : shape.size ** 2;
}
`,
  "library/src/point.ts": `export interface Point {
  x: number;
  y: number;
}
export const origin: Point = { x: 0, y: 0 };
`,
  "library/src/tools/index.ts": `export type Size = import("../index").Shape["size"];
export const tool: string = "ruler";
`,
  "library/src/version.ts": `export const version: string = "1.2.3";\n`,
};

const program = (
  types: boolean,
) => `import { area, start, tool, total${types ? ", type Shape, type Size" : ""} } from "@acme/shapes";
import { version } from "@acme/shapes/version";
const size${types ? ": Size" : ""} = 2;
const shapes${types ? ": Shape[]" : ""} = [{ kind: "square", size }, { kind: "circle", size: 1 }];
console.log(total(shapes), area(shapes[0]${types ? "!" : ""}), tool, start.x, version);
`;
const printed = "7 4 ruler 0 1.2.3\n";

const consumer = {
  "app/package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
  "app/app.ts": program(true),
  "app/app.mjs": program(false),
  "app/app.cjs": `const { area, start, tool, total } = require("@acme/shapes");
const { version } = require("@acme/shapes/version");
const shapes = [{ kind: "square", size: 2 }, { kind: "circle", size: 1 }];
console.log(total(shapes), area(shapes[0]), tool, start.x, version);
`,
  // An export whose type got lost is `any`, and `any` is assignable to `boolean`.
  "app/wrong.ts": `import { area, start, tool, total, type Size } from "@acme/shapes";
import { version } from "@acme/shapes/version";
declare const size: Size;
export const wrong: boolean[] = [
  total([]),
  area({ kind: "square", size: 1 }),
  tool,
  start,
  size,
  version,
];
`,
};

const project = { ...library, ...consumer };

async function pack(dir: string, folder: string) {
  const packed = await bun(folder, "pm", "pack", "--quiet", "--destination", dir);
  expect(packed.stderr).toBe("");
  expect(packed.exitCode).toBe(0);
  return packed.stdout.trim();
}

async function add(dir: string, tarball: string) {
  const added = await run(join(dir, "app"), [bunExe(), "add", "--backend=copyfile", tarball], {
    BUN_INSTALL_CACHE_DIR: join(dir, "cache"),
  });
  expect(added.stderr).not.toContain("error");
  expect(added.exitCode).toBe(0);
}

const conditions = (stem: string) => ({
  types: `./${stem}.d.ts`,
  aot: `./${stem}.aot.ts`,
  default: `./${stem}.js`,
});

const makers = {
  "bun compile --library": {
    folder: "",
    async make(library: string) {
      const built = await bun(library, "compile", "--library", "src/index.ts", "src/version.ts");
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return join(library, "dist");
    },
  },
  "bun build --dts, with a package.json written by hand": {
    folder: "dist/",
    async make(library: string) {
      writeFileSync(
        join(library, "package.json"),
        JSON.stringify({
          name: "@acme/shapes",
          version: "1.2.3",
          license: "MIT",
          type: "module",
          main: "./dist/index.js",
          types: "./dist/index.d.ts",
          exports: {
            ".": conditions("dist/index"),
            "./version": conditions("dist/version"),
            "./package.json": "./package.json",
          },
          compilerOptions: { strict: true, lib: ["esnext", "dom"] },
          files: ["dist"],
        }),
      );
      const built = await bun(library, "build", "src/index.ts", "src/version.ts", "--outdir", "dist", "--dts");
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return library;
    },
  },
};
type Maker = (typeof makers)[keyof typeof makers];

async function install(dir: string, maker: Maker) {
  const made = await maker.make(join(dir, "library"));
  await add(dir, await pack(dir, made));
  return { made, app: join(dir, "app"), installed: join(dir, "app/node_modules/@acme/shapes") };
}

const JAVASCRIPT_CONDITIONS = ["import", "require", "node", "browser", "module", "default"];
const RELATIVE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bmodule\s+)(["'])(\.{1,2}(?:\/[^"']*)?)\1/g;
const DECLARATIONS_OF: Record<string, string> = { ".js": ".d.ts", ".mjs": ".d.mts", ".cjs": ".d.cts" };
const isTypeScriptSource = (target: unknown) =>
  typeof target === "string" && ((target.endsWith(".ts") && !target.endsWith(".d.ts")) || target.endsWith(".tsx"));

function problemsOf(folder: string) {
  const problems: string[] = [];
  const manifest = json(join(folder, "package.json"));
  const named: string[] = [];
  for (const field of ["main", "module", "types"]) if (manifest[field]) named.push(manifest[field]);
  for (const path of Object.values<string>(typeof manifest.bin === "string" ? [manifest.bin] : (manifest.bin ?? {})))
    named.push(path);
  const visit = (value: unknown, where: string) => {
    if (typeof value === "string") {
      if (!value.startsWith("./")) problems.push(`${where}: ${value} does not start with ./`);
      return void named.push(value);
    }
    const keys = Object.keys(value as object);
    // publint accepts a condition before "types" if it names a TypeScript source file.
    const beforeTypes = keys.slice(0, Math.max(keys.indexOf("types"), 0));
    if (beforeTypes.some(key => !isTypeScriptSource((value as Record<string, unknown>)[key])))
      problems.push(`${where}: "types" is not the first condition`);
    if (keys.includes("default") && keys.at(-1) !== "default")
      problems.push(`${where}: "default" is not the last condition`);
    const typed = keys.indexOf("aot");
    for (const key of typed < 0 ? [] : keys.slice(0, typed))
      if (JAVASCRIPT_CONDITIONS.includes(key)) problems.push(`${where}: "aot" comes after "${key}"`);
    for (const key of keys) visit((value as Record<string, unknown>)[key], `${where} > ${key}`);
  };
  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) visit(value, subpath);
  const listed: string[] = manifest.files ?? [];
  const isListed = (path: string) => listed.some(entry => path === entry || path.startsWith(entry + "/"));
  for (const path of new Set(named)) {
    if (!existsSync(join(folder, path))) problems.push(`${path} does not exist`);
    else if (manifest.files && path !== "./package.json" && !isListed(posix.normalize(path)))
      problems.push(`${path} is not in "files"`);
  }
  for (const path of listed)
    if (!existsSync(join(folder, path))) problems.push(`"files" lists ${path}, which does not exist`);
  for (const path of filesIn(folder)) {
    const text = readFileSync(join(folder, path), "utf8");
    if (path.endsWith(".js")) {
      const isModule = /^(import|export)\b/m.test(text);
      if (isModule !== (manifest.type === "module")) problems.push(`${path} is not what "type" says`);
    }
    if (!/\.d\.[cm]?ts$/.test(path)) continue;
    for (const [, , specifier] of text.matchAll(RELATIVE_SPECIFIER)) {
      const declarations = DECLARATIONS_OF[posix.extname(specifier)];
      if (!declarations) problems.push(`${path} imports ${specifier}, which has no file extension`);
      else if (
        !existsSync(join(folder, dirname(path), specifier.slice(0, -posix.extname(specifier).length) + declarations))
      )
        problems.push(`${path} imports ${specifier}, which has no declaration file`);
    }
  }
  return problems;
}

const webpackScript = (webpack: string) => `require(${JSON.stringify(webpack)})(
  { mode: "development", devtool: false, context: __dirname, entry: "./app.mjs", output: { path: __dirname + "/out", filename: "app.cjs" } },
  (error, stats) => {
    if (error) throw error;
    const { errors, warnings, modules } = stats.toJson({ all: false, errors: true, warnings: true, modules: true });
    console.log(JSON.stringify({ errors, warnings, modules: modules.map(module => module.name).filter(Boolean) }));
  },
);
`;

const javascriptOfPackage = (inputs: Iterable<string>) =>
  [...inputs]
    .map(slashes)
    .filter(path => path.includes("node_modules/"))
    .map(path => path.slice(path.lastIndexOf("node_modules/")))
    .sort();

const executable = (folder: string, name: string) => join(folder, process.platform === "win32" ? name + ".exe" : name);

async function compileAheadOfTime(app: string, entry: string) {
  const flags = ["--compile", "--aot", entry, "--outfile", "compiled", "--metafile=meta.json"];
  const built = await slot(() => bun(app, "build", ...flags));
  expect({ said: built.stderr.match(/^(?:warn|error): .*$/gm), exitCode: built.exitCode }).toEqual({
    said: null,
    exitCode: 0,
  });
  return {
    read: javascriptOfPackage(Object.keys(json(join(app, "meta.json")).inputs)),
    accessesOfPackages: built.stderr.match(/^Dependencies: .* of property accesses are one load: (.*) \(\d+\)$/m)?.[1],
    ran: await run(app, [executable(app, "compiled")]),
  };
}

test("the rules find what is wrong with a package", () => {
  using dir = tempDir("library-rules-fire", {
    "package.json": JSON.stringify({
      name: "wrong",
      version: "1.0.0",
      type: "commonjs",
      main: "./gone.js",
      exports: {
        ".": { default: "./index.js", aot: "./index.aot.ts", types: "./index.d.ts" },
        "./other": "other.js",
      },
      files: ["index.js", "index.d.ts", "other.js", "old.js"],
    }),
    "index.js": "export {};\n",
    "index.aot.ts": "export {};\n",
    "index.d.ts": `export * from "./other";\nexport type Gone = import("./gone.js").Gone;\n`,
    "other.js": "",
  });
  expect(problemsOf(String(dir))).toEqual([
    `.: "types" is not the first condition`,
    `.: "default" is not the last condition`,
    `.: "aot" comes after "default"`,
    `./other: other.js does not start with ./`,
    `./gone.js does not exist`,
    `./index.aot.ts is not in "files"`,
    `"files" lists old.js, which does not exist`,
    `index.d.ts imports ./other, which has no file extension`,
    `index.d.ts imports ./gone.js, which has no declaration file`,
    `index.js is not what "type" says`,
  ]);
});

const webpack = (() => {
  try {
    return require.resolve("webpack");
  } catch {}
})();

describe.each(Object.entries(makers))("a package from %s", (_, maker) => {
  const inPackage = (...paths: string[]) => paths.map(path => `node_modules/@acme/shapes/${maker.folder}${path}`);
  const readByBundlers = inPackage("index.js", "version.js");
  const written = [
    "area.d.ts",
    "index.d.ts",
    "index.aot.ts",
    "index.js",
    "point.d.ts",
    "tools/index.d.ts",
    "version.d.ts",
    "version.aot.ts",
    "version.js",
  ];
  const published = ["README.md", "package.json", ...written.map(path => maker.folder + path)].sort();

  describe.concurrent("", () => {
    test("the tarball holds every file that package.json names, and nothing else", async () => {
      using dir = tempDir("library-tarball", project);
      const { made, installed } = await install(String(dir), maker);
      expect(filesIn(installed).filter(path => path !== ".bun-tag")).toEqual(published);
      for (const path of published.filter(path => path !== "package.json"))
        expect(readFileSync(join(installed, path))).toEqual(readFileSync(join(made, path)));
      expect(json(join(installed, "package.json"))).toEqual(json(join(made, "package.json")));
    });

    test.skipIf(!Bun.which("npm"))("npm packs the same files", async () => {
      using dir = tempDir("library-npm-pack", project);
      const { made } = await install(String(dir), maker);
      const packed = await run(made, [Bun.which("npm")!, "pack", "--dry-run", "--json"], {
        npm_config_cache: join(String(dir), "npm-cache"),
        npm_config_update_notifier: "false",
      });
      // An npm that cannot pack any package says nothing about this one.
      if (packed.exitCode !== 0 && !packed.stdout.includes('"files"')) return;
      const [{ files }] = Object.values<{ files: { path: string }[] }>(JSON.parse(packed.stdout));
      expect(files.map(file => file.path).sort()).toEqual(published);
    });

    test("package.json and the declaration files pass the rules of publint and arethetypeswrong", async () => {
      using dir = tempDir("library-rules", project);
      const { installed } = await install(String(dir), maker);
      expect(problemsOf(installed)).toEqual([]);
      expect(json(join(installed, "package.json")).exports).toEqual({
        ".": conditions(maker.folder + "index"),
        "./version": conditions(maker.folder + "version"),
        "./package.json": "./package.json",
      });
    });

    test.skipIf(!node)("Node.js imports it, and requires it where Node.js can require an ES module", async () => {
      using dir = tempDir("library-node", project);
      const { app } = await install(String(dir), maker);
      expect(await run(app, [node!, "app.mjs"])).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
      if (nodeRequiresModules)
        expect(await run(app, [node!, "app.cjs"])).toMatchObject({ stdout: printed, exitCode: 0 });
      writeFileSync(
        join(app, "where.mjs"),
        `for (const name of ["@acme/shapes", "@acme/shapes/version"]) console.log(import.meta.resolve(name).split("/app/").pop());\n`,
      );
      expect(await run(app, [node!, "where.mjs"])).toEqual({
        stdout: readByBundlers.join("\n") + "\n",
        stderr: "",
        exitCode: 0,
      });
    });

    test("Bun runs it from TypeScript, an ES module and a CommonJS module", async () => {
      using dir = tempDir("library-bun", project);
      const { app } = await install(String(dir), maker);
      for (const entry of ["app.ts", "app.mjs", "app.cjs"])
        expect(await bun(app, entry)).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
    });

    test.each(["node16", "nodenext", "bundler"])(
      "tsc and bun check see the type of every export under moduleResolution %s",
      async moduleResolution => {
        using dir = tempDir("library-tsc", project);
        const { app } = await install(String(dir), maker);
        const module = moduleResolution === "bundler" ? "esnext" : moduleResolution;
        writeFileSync(
          join(app, "tsconfig.json"),
          JSON.stringify({
            compilerOptions: { ...compilerOptions, module, moduleResolution },
            files: ["app.ts", "wrong.ts"],
          }),
        );
        const errors = [5, 6, 7, 8, 9, 10].map(line => `wrong.ts(${line},3): error TS2322`);
        const tsc = require.resolve("typescript/bin/tsc");
        for (const check of [["check"], [tsc]]) {
          const { stdout, stderr } = await bun(app, ...check, "-p", "tsconfig.json", "--pretty", "false");
          expect((stdout + stderr).match(/^\S+\(\d+,\d+\): error TS\d+/gm)).toEqual(errors);
        }
        const listed = await bun(app, tsc, "-p", "tsconfig.json", "--listFilesOnly");
        expect(javascriptOfPackage(listed.stdout.split(/\r?\n/).filter(path => path.includes("shapes")))).toEqual(
          inPackage("area.d.ts", "index.d.ts", "point.d.ts", "tools/index.d.ts", "version.d.ts"),
        );
      },
    );

    test.each(["browser", "node", "bun"])("bun build --target %s bundles the JavaScript", async target => {
      using dir = tempDir("library-bun-build", project);
      const { app } = await install(String(dir), maker);
      const built = await bun(app, "build", "app.ts", "--target", target, "--outdir", "out", "--metafile=meta.json");
      expect(built.stderr).toBe("");
      expect(built.exitCode).toBe(0);
      expect(javascriptOfPackage(Object.keys(json(join(app, "meta.json")).inputs))).toEqual(readByBundlers);
      expect(await bun(app, "out/app.js")).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
    });

    test.skipIf(!!unsupported).each(["app.ts", "app.mjs", "app.cjs"])(
      "bun build --compile --aot %s compiles the .aot.ts files",
      async entry => {
        using dir = tempDir("library-aot", project);
        const { app } = await install(String(dir), maker);
        expect(await compileAheadOfTime(app, entry)).toEqual({
          read: inPackage("index.aot.ts", "version.aot.ts"),
          accessesOfPackages: "3 free, 0 tested, 0 by name",
          ran: { stdout: printed, stderr: "", exitCode: 0 },
        });
      },
    );

    test.skipIf(!!unsupported)("bun run --aot runs it", async () => {
      using dir = tempDir("library-run-aot", project);
      const { app } = await install(String(dir), maker);
      for (const entry of ["app.ts", "app.mjs", "app.cjs"])
        expect(await bun(app, "run", "--aot", entry)).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
    });

    test.each(["browser", "node", "neutral"] as const)(
      "esbuild --platform=%s bundles the JavaScript",
      async platform => {
        using dir = tempDir("library-esbuild", project);
        const { app } = await install(String(dir), maker);
        const built = await esbuild.build({
          absWorkingDir: app,
          entryPoints: ["app.ts"],
          bundle: true,
          platform,
          format: "esm",
          outfile: "out/app.js",
          metafile: true,
          logLevel: "silent",
        });
        expect({ errors: built.errors, warnings: built.warnings }).toEqual({ errors: [], warnings: [] });
        expect(javascriptOfPackage(Object.keys(built.metafile.inputs))).toEqual(readByBundlers);
        expect(await bun(app, "out/app.js")).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
      },
    );

    test.skipIf(!node || !webpack)("webpack bundles the JavaScript", async () => {
      using dir = tempDir("library-webpack", project);
      const { app } = await install(String(dir), maker);
      writeFileSync(join(app, "bundle.cjs"), webpackScript(webpack!));
      const built = await run(app, [node!, "bundle.cjs"]);
      expect(built.exitCode).toBe(0);
      const { errors, warnings, modules } = JSON.parse(built.stdout);
      expect({ errors, warnings }).toEqual({ errors: [], warnings: [] });
      expect(javascriptOfPackage(modules)).toEqual(readByBundlers);
      expect(await run(app, [node!, "out/app.cjs"])).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
    });
  });
});

describe.concurrent("a package with ES modules and CommonJS, from two runs of bun build --dts", () => {
  async function installDual(dir: string) {
    const library = join(dir, "library");
    writeFileSync(
      join(library, "package.json"),
      JSON.stringify({
        name: "@acme/shapes",
        version: "1.2.3",
        type: "module",
        main: "./dist/cjs/index.js",
        module: "./dist/esm/index.js",
        types: "./dist/cjs/index.d.ts",
        exports: {
          ".": {
            import: conditions("dist/esm/index"),
            require: { types: "./dist/cjs/index.d.ts", default: "./dist/cjs/index.js" },
          },
          "./version": {
            import: conditions("dist/esm/version"),
            require: { types: "./dist/cjs/version.d.ts", default: "./dist/cjs/version.js" },
          },
        },
        compilerOptions: { strict: true, lib: ["esnext", "dom"] },
        files: ["dist"],
      }),
    );
    const entryPoints = ["src/index.ts", "src/version.ts"];
    expect(await bun(library, "build", ...entryPoints, "--outdir", "dist/esm", "--dts")).toMatchObject({
      stderr: "",
      exitCode: 0,
    });
    expect(await bun(library, "build", ...entryPoints, "--outdir", "dist/cjs", "--dts", "--format=cjs")).toMatchObject({
      stderr:
        "warn: the .aot.ts files that --aot compiles a package from are left out: they do not support --format other than esm yet\n",
      exitCode: 0,
    });
    writeFileSync(join(library, "dist/cjs/package.json"), JSON.stringify({ type: "commonjs" }));
    await add(dir, await pack(dir, library));
    return { app: join(dir, "app"), installed: join(dir, "app/node_modules/@acme/shapes") };
  }
  const where = `console.log(require.resolve("@acme/shapes").replaceAll("\\\\", "/").split("/shapes/").pop());\n`;

  test("passes the rules", async () => {
    using dir = tempDir("library-dual-rules", project);
    const { installed } = await installDual(String(dir));
    expect(problemsOf(installed).filter(problem => !problem.startsWith("dist/cjs/"))).toEqual([]);
  });

  test.skipIf(!node)("Node.js imports the ES modules and requires the CommonJS", async () => {
    using dir = tempDir("library-dual-node", project);
    const { app } = await installDual(String(dir));
    writeFileSync(join(app, "where.cjs"), where);
    expect(await run(app, [node!, "app.mjs"])).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
    expect(await run(app, [node!, "app.cjs"])).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
    expect(await run(app, [node!, "where.cjs"])).toEqual({ stdout: "dist/cjs/index.js\n", stderr: "", exitCode: 0 });
  });

  test("Bun imports the ES modules and requires the CommonJS", async () => {
    using dir = tempDir("library-dual-bun", project);
    const { app } = await installDual(String(dir));
    writeFileSync(join(app, "where.cjs"), where);
    for (const entry of ["app.ts", "app.mjs", "app.cjs"])
      expect(await bun(app, entry)).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
    expect(await bun(app, "where.cjs")).toEqual({ stdout: "dist/cjs/index.js\n", stderr: "", exitCode: 0 });
  });

  test.skipIf(!!unsupported).each([
    ["app.ts", "the .aot.ts files under import", ["dist/esm/index.aot.ts", "dist/esm/version.aot.ts"]],
    ["app.mjs", "the .aot.ts files under import", ["dist/esm/index.aot.ts", "dist/esm/version.aot.ts"]],
    ["app.cjs", "the CommonJS under require, which has no aot condition", ["dist/cjs/index.js", "dist/cjs/version.js"]],
  ])("bun build --compile --aot %s compiles %s", async (entry, _, read) => {
    using dir = tempDir("library-dual-aot", project);
    const { app } = await installDual(String(dir));
    expect(await compileAheadOfTime(app, entry)).toMatchObject({
      read: read.map(path => "node_modules/@acme/shapes/" + path),
      ran: { stdout: printed, stderr: "", exitCode: 0 },
    });
  });

  test.each(["node16", "nodenext", "bundler"])(
    "tsc reads the declaration files of the format that the importing file has under moduleResolution %s",
    async moduleResolution => {
      using dir = tempDir("library-dual-tsc", project);
      const { app } = await installDual(String(dir));
      const module = moduleResolution === "bundler" ? "esnext" : moduleResolution;
      writeFileSync(join(app, "other.cts"), consumer["app/app.ts"]);
      const tsc = require.resolve("typescript/bin/tsc");
      for (const [file, format] of [
        ["app.ts", "esm"],
        ["other.cts", "cjs"],
      ]) {
        writeFileSync(
          join(app, "tsconfig.json"),
          JSON.stringify({ compilerOptions: { ...compilerOptions, module, moduleResolution }, files: [file] }),
        );
        const checked = await bun(app, tsc, "-p", "tsconfig.json", "--pretty", "false", "--listFiles");
        expect(checked.stdout.match(/error TS\d+.*/g)).toBeNull();
        const read = javascriptOfPackage(checked.stdout.split(/\r?\n/).filter(path => path.includes("shapes")));
        expect(read).toContain(`node_modules/@acme/shapes/dist/${format}/index.d.ts`);
        expect(read.filter(path => !path.includes(`/dist/${format}/`))).toEqual([]);
      }
    },
  );
});

describe.concurrent("a package from bun compile --library --format=cjs", () => {
  async function installCommonJS(dir: string) {
    const library = join(dir, "library");
    const built = await bun(library, "compile", "--library", "--format=cjs", "src/index.ts", "src/version.ts");
    expect(built.exitCode).toBe(0);
    await add(dir, await pack(dir, join(library, "dist")));
    return { app: join(dir, "app"), installed: join(dir, "app/node_modules/@acme/shapes") };
  }

  test("passes the rules", async () => {
    using dir = tempDir("library-cjs-rules", project);
    const { installed } = await installCommonJS(String(dir));
    expect(problemsOf(installed)).toEqual([]);
    expect(json(join(installed, "package.json")).type).toBe("commonjs");
  });

  test("Bun runs it from TypeScript, an ES module and a CommonJS module", async () => {
    using dir = tempDir("library-cjs-bun", project);
    const { app } = await installCommonJS(String(dir));
    for (const entry of ["app.ts", "app.mjs", "app.cjs"])
      expect(await bun(app, entry)).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
  });

  test.skipIf(!!unsupported)(
    "bun build --compile --aot compiles the JavaScript, because there is no aot condition",
    async () => {
      using dir = tempDir("library-cjs-aot", project);
      const { app } = await installCommonJS(String(dir));
      expect(await compileAheadOfTime(app, "app.ts")).toMatchObject({
        read: ["node_modules/@acme/shapes/index.js", "node_modules/@acme/shapes/version.js"],
        ran: { stdout: printed, stderr: "", exitCode: 0 },
      });
    },
  );

  test.skipIf(!node)("Node.js requires it, and imports it as a default export", async () => {
    using dir = tempDir("library-cjs-node", project);
    const { app } = await installCommonJS(String(dir));
    expect(await run(app, [node!, "app.cjs"])).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
    writeFileSync(
      join(app, "default.mjs"),
      `import shapes from "@acme/shapes";\nconsole.log(shapes.total([]), shapes.tool);\n`,
    );
    expect(await run(app, [node!, "default.mjs"])).toEqual({ stdout: "0 ruler\n", stderr: "", exitCode: 0 });
  });

  test.todoIf(!!node)("Node.js imports its exports by name", async () => {
    using dir = tempDir("library-cjs-node-names", project);
    const { app } = await installCommonJS(String(dir));
    expect(await run(app, [node!, "app.mjs"])).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
  });
});

describe.concurrent("a package from bun compile --library --splitting", () => {
  async function installSplit(dir: string) {
    const library = join(dir, "library");
    const entryPoints = ["src/index.ts", "src/version.ts", "src/area.ts"];
    const built = await bun(library, "compile", "--library", "--splitting", ...entryPoints);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    await add(dir, await pack(dir, join(library, "dist")));
    const installed = join(dir, "app/node_modules/@acme/shapes");
    const [chunk] = filesIn(installed).filter(path => /^index-\w+\.js$/.test(path));
    return { app: join(dir, "app"), installed, chunk: chunk.slice(0, -".js".length) };
  }

  test("passes the rules", async () => {
    using dir = tempDir("library-split-rules", project);
    const { installed, chunk } = await installSplit(String(dir));
    expect(problemsOf(installed)).toEqual([]);
    expect(readFileSync(join(installed, "index.js"), "utf8")).toContain(`from "./${chunk}.js"`);
    expect(readFileSync(join(installed, "index.aot.ts"), "utf8")).toContain(`from "./${chunk}.aot.ts"`);
  });

  test("Bun runs it from TypeScript, an ES module and a CommonJS module", async () => {
    using dir = tempDir("library-split-bun", project);
    const { app } = await installSplit(String(dir));
    for (const entry of ["app.ts", "app.mjs", "app.cjs"])
      expect(await bun(app, entry)).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
  });

  test.skipIf(!!unsupported)(
    "bun build --compile --aot compiles the .aot.ts file of the chunk that index.aot.ts imports",
    async () => {
      using dir = tempDir("library-split-aot", project);
      const { app, chunk } = await installSplit(String(dir));
      expect(await compileAheadOfTime(app, "app.ts")).toEqual({
        read: [chunk, "index", "version"].map(stem => `node_modules/@acme/shapes/${stem}.aot.ts`),
        accessesOfPackages: "3 free, 0 tested, 0 by name",
        ran: { stdout: printed, stderr: "", exitCode: 0 },
      });
    },
  );
});

describe.concurrent("the file under the aot condition", () => {
  const files = {
    "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
    "node_modules/tells/package.json": JSON.stringify({
      name: "tells",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./index.d.ts", aot: "./index.aot.ts", default: "./index.js" } },
    }),
    "node_modules/tells/index.js": `export const read = "index.js";\n`,
    "node_modules/tells/index.aot.ts": `export const read: string = "index.aot.ts";\n`,
    "node_modules/tells/index.d.ts": `export declare const read: string;\n`,
    "app.ts": `import { read } from "tells";\nconsole.log(read);\n`,
    "app.mjs": `import { read } from "tells";\nconsole.log(read);\n`,
    "app.cjs": `console.log(require("tells").read);\n`,
    "app.test.ts": `import { expect, test } from "bun:test";\nimport { read } from "tells";\ntest("read", () => expect(read).toBe("index.js"));\n`,
    "typed.test.ts": `import { expect, test } from "bun:test";\nimport { read } from "tells";\ntest("read", () => expect(read).toBe("index.aot.ts"));\n`,
  };
  const nested = { aot: "./index.aot.ts", default: "./index.js" };
  const javascript = { stdout: "index.js\n", stderr: "", exitCode: 0 };
  const typed = { stdout: "index.aot.ts\n", stderr: "", exitCode: 0 };

  test("is not what bun run, bun test and bun build read", async () => {
    using dir = tempDir("library-condition-bun", files);
    for (const entry of ["app.ts", "app.mjs", "app.cjs"]) expect(await bun(String(dir), entry)).toEqual(javascript);
    expect(await bun(String(dir), "test", "app.test.ts")).toMatchObject({ exitCode: 0 });
    expect(await bun(String(dir), "test", "typed.test.ts")).toMatchObject({ exitCode: 1 });
    for (const target of ["browser", "node", "bun"]) {
      expect(await bun(String(dir), "build", "app.ts", "--target", target, "--outfile", `${target}.js`)).toMatchObject({
        stderr: "",
        exitCode: 0,
      });
      expect(await bun(String(dir), `${target}.js`)).toEqual(javascript);
    }
  });

  test("is not what bun build --compile reads", async () => {
    using dir = tempDir("library-condition-compile", files);
    expect(await bun(String(dir), "build", "--compile", "app.ts", "--outfile", "plain")).toMatchObject({ exitCode: 0 });
    expect(await run(String(dir), [executable(String(dir), "plain")])).toEqual(javascript);
  });

  test.skipIf(!node)("is not what Node.js reads", async () => {
    using dir = tempDir("library-condition-node", files);
    expect(await run(String(dir), [node!, "app.mjs"])).toEqual(javascript);
    if (nodeRequiresModules) expect(await run(String(dir), [node!, "app.cjs"])).toMatchObject({ stdout: "index.js\n" });
  });

  test("is not what esbuild reads", async () => {
    using dir = tempDir("library-condition-esbuild", files);
    await esbuild.build({
      absWorkingDir: String(dir),
      entryPoints: ["app.ts"],
      bundle: true,
      format: "esm",
      outfile: "out.js",
      logLevel: "silent",
    });
    expect(await bun(String(dir), "out.js")).toEqual(javascript);
  });

  test("is what --conditions=aot asks for", async () => {
    using dir = tempDir("library-condition-asked-for", files);
    expect(await bun(String(dir), "--conditions=aot", "app.ts")).toEqual(typed);
  });

  test.skipIf(!!unsupported)("is what bun run --aot and bun test --aot read", async () => {
    using dir = tempDir("library-condition-run-aot", files);
    for (const entry of ["app.ts", "app.mjs", "app.cjs"]) {
      expect(await bun(String(dir), "run", "--aot", entry)).toEqual(typed);
      expect(await bun(String(dir), "--aot", entry)).toEqual(typed);
    }
    expect(await bun(String(dir), "test", "--aot", "typed.test.ts")).toMatchObject({ exitCode: 0 });
    expect(await bun(String(dir), "test", "--aot", "app.test.ts")).toMatchObject({ exitCode: 1 });
  });

  test.skipIf(!!unsupported).each(["app.ts", "app.mjs", "app.cjs"])(
    "is what bun build --compile --aot %s compiles",
    async entry => {
      using dir = tempDir("library-condition-compile-aot", files);
      expect(await compileAheadOfTime(String(dir), entry)).toEqual({
        read: ["node_modules/tells/index.aot.ts"],
        accessesOfPackages: undefined,
        ran: typed,
      });
    },
  );

  test.skipIf(!!unsupported)("is what bun compile compiles", async () => {
    using dir = tempDir("library-condition-bun-compile", files);
    expect(await bun(String(dir), "compile", "app.ts", "--outfile", "compiled")).toMatchObject({ exitCode: 0 });
    expect(await run(String(dir), [executable(String(dir), "compiled")])).toEqual(typed);
  });

  test.skipIf(!!unsupported).each([
    ["types before aot", { types: "./index.d.ts", aot: "./index.aot.ts", default: "./index.js" }],
    ["aot before types", { aot: "./index.aot.ts", types: "./index.d.ts", default: "./index.js" }],
    ["aot below import and require", { types: "./index.d.ts", import: nested, require: nested }],
  ])("is what the type checker reads under --aot, and the file under types is not: %s", async (_, conditions) => {
    using dir = tempDir("library-condition-types", {
      ...files,
      "tsconfig.json": JSON.stringify({ compilerOptions, files: ["app.ts"] }),
      "node_modules/tells/package.json": JSON.stringify({
        name: "tells",
        version: "1.0.0",
        type: "module",
        exports: { ".": conditions },
      }),
      "node_modules/tells/index.aot.ts": `export const read: "index.aot.ts" = "index.aot.ts";\n`,
      "node_modules/tells/index.d.ts": `export declare const read: "index.d.ts";\n`,
      "app.ts": `import { read } from "tells";\nconst text: "index.aot.ts" = read;\nconsole.log(text);\n`,
    });
    const mismatch = `app.ts(2,7): error TS2322: Type '"index.d.ts"' is not assignable to type '"index.aot.ts"'.`;
    for (const check of [["check"], [require.resolve("typescript/bin/tsc")]]) {
      const { stdout, stderr } = await bun(String(dir), ...check, "-p", "tsconfig.json", "--pretty", "false");
      expect((stdout + stderr).match(/^.*error TS.*$/gm)).toEqual([mismatch]);
    }
    expect(await bun(String(dir), "check", "--aot", "app.ts")).toMatchObject({ exitCode: 0 });
    expect(await bun(String(dir), "run", "--aot", "app.ts")).toEqual(typed);
    expect(await compileAheadOfTime(String(dir), "app.ts")).toEqual({
      read: ["node_modules/tells/index.aot.ts"],
      accessesOfPackages: undefined,
      ran: typed,
    });
  });
});
