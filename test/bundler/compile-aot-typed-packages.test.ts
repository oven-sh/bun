import { afterAll, expect } from "bun:test";
import { createHash } from "crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { describe, test } from "../aot/supported";

const installed = {
  "package.json": JSON.stringify({
    name: "shapes",
    version: "1.2.3",
    type: "module",
    main: "index.js",
    types: "index.d.ts",
  }),
  "index.js": `export function area(w, h) {\n  const box = { w, h };\n  return box.w * box.h;\n}\nexport function where() {\n  return new Error("here").stack;\n}\n`,
  "index.d.ts": `export declare function area(w: number, h: number): number;\nexport declare function where(): string;\n`,
};
const typed = `interface Box { w: number; h: number }\nexport function area(w: number, h: number): number {\n  const box: Box = { w, h };\n  return box.w * box.h;\n}\nexport function where(): string {\n  return new Error("here").stack!;\n}\n`;
const typedWithOtherCode = typed.replace("box.w * box.h", "box.w + box.h");
const typedWithTypeError = typed.replace("h: number): number", "h: string): number");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const manifest = (more: object = {}) => ({
  format: 2,
  name: "shapes",
  version: "1.2.3",
  when: {},
  basis: {},
  lay: { "index.js": sha256(installed["index.js"]) },
  needs: [],
  ...more,
});

// The width is a string from the command line. The typed area() falls back to its slow path and multiplies it, as the installed one and `bun run` do.
// So the output is the same either way, and only what the build prints tells which text was compiled.
const app = (name = "shapes") => `import { area, where } from "${name}";
declare const process: { argv: string[] };
const width: any = process.argv[2];
let result: unknown;
try {
  result = area(width, 7);
} catch (error) {
  result = (error as Error).name;
}
console.log(result, /index(\\.aot)?\\.[jt]s/.exec(where())![0]);
`;
const output = "42 index.js\n";

function write(folder: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
}
function typedVersion(folder: string, more: object = {}) {
  write(folder, { "full-types.json": JSON.stringify(manifest(more)), "lay/index.js": typed });
}
const folders: string[] = [];
afterAll(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })));
function project(name: string) {
  const folder = String(tempDir(name, {}));
  folders.push(folder);
  write(folder, {
    "app.ts": app(),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "esnext",
        moduleResolution: "bundler",
        target: "esnext",
        types: [],
        lib: ["esnext", "dom"],
      },
    }),
    "package.json": JSON.stringify({ name: "app" }),
  });
  write(join(folder, "node_modules", "shapes"), installed);
  return folder;
}
async function spawned(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
const compiled = (folder: string, flags: string[] = ["--aot"]) =>
  spawned([bunExe(), "build", "--compile", ...flags, "app.ts", "--outfile", "app"], folder);
const ran = (folder: string) => spawned([join(folder, "app"), "6"], folder);
async function built(folder: string, flags?: string[]) {
  const build = await compiled(folder, flags);
  const said = (build.stdout + build.stderr)
    .split("\n")
    .filter(line => /full types/.test(line) && !/ full types, and /.test(line));
  expect(build.stderr).not.toContain("error");
  expect(build.exitCode).toBe(0);
  const run = await ran(folder);
  return { said, stdout: run.stdout, exitCode: run.exitCode };
}
const used = (directory: string) => [`note: "shapes" 1.2.3 is compiled from its full types in ${directory}`];
const counted = (used: 0 | 1) => `note: 1 package has full types, and ${used ? "1 is" : "none are"} compiled from them`;
const unused = (directory: string, why: string) => [
  `warn: TS100056: The full types of "shapes" in ${directory} can't be used: ${why}`,
];
async function builtWithout(folder: string, flags?: string[]) {
  const build = await compiled(folder, flags);
  const said = (build.stdout + build.stderr)
    .split("\n")
    .filter(line => /full types/.test(line) && !/ full types, and /.test(line));
  return { said, exitCode: build.exitCode, wroteExecutable: existsSync(join(folder, isWindows ? "app.exe" : "app")) };
}
// Full types are only used if everything matches. Otherwise the build goes on as if it were not there, and says what did not match.
const warned = (directory: string, why: string, alsoSaid: string[] = []) => ({
  said: [...unused(directory, why), ...alsoSaid],
  exitCode: 0,
  wroteExecutable: true,
});
const shippedUnused = (why: string) => [
  `warn: "shapes" is compiled without types, because its full types in node_modules/shapes can't be used: ${why}`,
];

describe("compile/aot/TypedPackages", () => {
  test("without full types the package is compiled as installed", async () => {
    expect(await built(project("aot-typed-none"))).toEqual({ said: [], stdout: output, exitCode: 0 });
  });

  test("the project's own folder", async () => {
    const folder = project("aot-typed-own");
    typedVersion(join(folder, ".full-types", "shapes"));
    expect(await built(folder)).toEqual({ said: used(".full-types/shapes"), stdout: output, exitCode: 0 });
    expect(await Bun.file(join(folder, "node_modules", "shapes", "index.js")).text()).toBe(installed["index.js"]);
    expect(readdirSync(join(folder, "node_modules", "shapes")).sort()).toEqual(Object.keys(installed).sort());
  });

  test("builds without --aot ignore it", async () => {
    const folder = project("aot-typed-no-aot");
    typedVersion(join(folder, ".full-types", "shapes"));
    expect(await spawned([bunExe(), "build", "app.ts", "--target=bun", "--outfile", "app.js"], folder)).toMatchObject({
      stderr: "",
      exitCode: 0,
    });
    const bundle = await Bun.file(join(folder, "app.js")).text();
    expect(bundle).toContain("node_modules/shapes/index.js");
    expect(bundle).not.toContain(".full-types");
  });

  test("a package named @oven/full-types-<name> is read, whether the project lists it or not", async () => {
    const folder = project("aot-typed-scope");
    typedVersion(join(folder, "node_modules", "@oven", "full-types-shapes"));
    const usesInstalled = { said: used("node_modules/@oven/full-types-shapes"), stdout: output, exitCode: 0 };
    expect(await built(folder)).toEqual(usesInstalled);
    write(folder, {
      "package.json": JSON.stringify({ name: "app", devDependencies: { "@oven/full-types-shapes": "1.2.3" } }),
    });
    expect(await built(folder)).toEqual(usesInstalled);
    expect(await Bun.file(join(folder, "node_modules", "shapes", "index.js")).text()).toBe(installed["index.js"]);
  });

  test("builds without --aot ignore a package named @oven/full-types-<name>", async () => {
    const folder = project("aot-typed-scope-no-aot");
    typedVersion(join(folder, "node_modules", "@oven", "full-types-shapes"));
    expect(await spawned([bunExe(), "build", "app.ts", "--target=bun", "--outfile", "app.js"], folder)).toMatchObject({
      stderr: "",
      exitCode: 0,
    });
    const bundle = await Bun.file(join(folder, "app.js")).text();
    expect(bundle).toContain("node_modules/shapes/index.js");
    expect(bundle).not.toContain("full-types-shapes");
  });

  test("a package under another scope of node_modules is never read", async () => {
    const folder = project("aot-typed-other-scope");
    typedVersion(join(folder, "node_modules", "@types", "shapes"));
    typedVersion(join(folder, "node_modules", "full-types", "shapes"));
    typedVersion(join(folder, "node_modules", "@oven", "shapes"));
    const said = [
      "warn: TS100067: bun compile doesn't read node_modules/@oven/shapes: a package that holds full types is named @oven/full-types-<name>",
    ];
    expect(await built(folder)).toEqual({ said, stdout: output, exitCode: 0 });
  });

  const withCondition = (typedFile: string | null = "./index.full.ts", folder = ".") =>
    JSON.stringify({
      name: "shapes",
      version: "1.2.3",
      type: "module",
      exports: { ".": { types: `${folder}/index.d.ts`, "full-types": typedFile, default: `${folder}/index.js` } },
    });
  function shipped(folder: string, packageJson = withCondition()) {
    write(join(folder, "node_modules", "shapes"), { "package.json": packageJson, "index.full.ts": typed });
  }

  test("the full types that the package ships", async () => {
    const folder = project("aot-typed-shipped");
    shipped(folder);
    expect(await built(folder)).toEqual({ said: used("node_modules/shapes"), stdout: output, exitCode: 0 });
    expect(await Bun.file(join(folder, "node_modules", "shapes", "index.js")).text()).toBe(installed["index.js"]);
  });

  test("the program takes the types of the package from its declaration file, as tsc does", async () => {
    const folder = project("aot-typed-shipped-types");
    shipped(folder);
    write(join(folder, "node_modules", "shapes"), {
      "index.d.ts": installed["index.d.ts"].replace("w: number, h: number", "w: string, h: string"),
    });
    const build = await compiled(folder);
    expect(build.stdout + build.stderr).toContain(
      "TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
    );
    expect(build.exitCode).toBe(1);
  });

  test("a full-types file that has no type for one of its exports: the program keeps the declaration file", async () => {
    const folder = project("aot-typed-shipped-untyped-export");
    const javascript =
      installed["index.js"] +
      "var tools = {};\ntools.each = (list, callback) => list.map(callback);\nexport { tools };\n";
    write(join(folder, "node_modules", "shapes"), {
      "package.json": withCondition(),
      "index.js": javascript,
      "index.d.ts":
        installed["index.d.ts"] +
        "export declare const tools: { each(list: number[], callback: (n: number) => number): number[] };\n",
      "index.full.ts":
        typed +
        "var tools: any = {};\ntools.each = (list: number[], callback: (n: number) => number): number[] => list.map(callback);\nexport { tools };\n",
    });
    write(folder, {
      "app.ts": `import { area, tools, where } from "shapes";\nconsole.log(tools.each([area(6, 7) - 1], n => n + 1)[0], /index(\\.aot)?\\.[jt]s/.exec(where())![0]);\n`,
    });
    expect(await built(folder)).toEqual({ said: used("node_modules/shapes"), stdout: "42 index.js\n", exitCode: 0 });
  });

  test("the project's own folder wins over what the package ships", async () => {
    const folder = project("aot-typed-order");
    shipped(folder);
    expect(await built(folder)).toEqual({ said: used("node_modules/shapes"), stdout: output, exitCode: 0 });
    typedVersion(join(folder, ".full-types", "shapes"));
    expect(await built(folder)).toEqual({ said: used(".full-types/shapes"), stdout: output, exitCode: 0 });
  });

  test("a broken full types in the project is as if it were not there: what the package ships is used", async () => {
    const folder = project("aot-typed-fallback");
    shipped(folder);
    write(join(folder, ".full-types", "shapes"), { "full-types.json": "{" });
    expect(await builtWithout(folder)).toEqual(
      warned(".full-types/shapes", "full-types.json is not valid JSON", used("node_modules/shapes")),
    );
  });

  test.each([
    ["its own package.json", { "package.json": withCondition("./dist/index.full.ts", "./dist") }],
    [
      "the package.json beside what main names",
      {
        "package.json": JSON.stringify({
          name: "shapes",
          version: "1.2.3",
          type: "module",
          main: "dist/index.js",
          types: "dist/index.d.ts",
        }),
        "dist/package.json": withCondition(),
      },
    ],
    [
      "the package.json beside what exports names",
      {
        "package.json": JSON.stringify({
          name: "shapes",
          version: "1.2.3",
          type: "module",
          exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
        }),
        "dist/package.json": withCondition(),
      },
    ],
  ])("the full-types file may lie in a folder, and %s names it", async (_, packageJsons) => {
    const folder = project("aot-typed-shipped-folder");
    const at = join(folder, "node_modules", "shapes");
    rmSync(join(at, "index.js"));
    rmSync(join(at, "index.d.ts"));
    write(at, {
      ...packageJsons,
      "dist/index.js": installed["index.js"],
      "dist/index.d.ts": installed["index.d.ts"],
      "dist/index.full.ts": typed,
    });
    expect(await built(folder)).toEqual({ said: used("node_modules/shapes/dist"), stdout: output, exitCode: 0 });
  });

  const unnamedTypedFiles: [string, (folder: string) => void][] = [
    ["no package.json has the condition", folder => shipped(folder, installed["package.json"])],
    ["the condition is null", folder => shipped(folder, withCondition(null))],
  ];
  test.each(unnamedTypedFiles)(
    "no shipped version: %s: the package is compiled as installed, and the build says that nothing leads to the file",
    async (_, change) => {
      const folder = project("aot-typed-shipped-unnamed");
      change(folder);
      const why =
        'index.full.ts is beside index.js, but no "full-types" condition in the "exports" of package.json points at it';
      expect(await built(folder)).toEqual({ said: shippedUnused(why), stdout: output, exitCode: 0 });
    },
  );

  test("a default export goes through", async () => {
    const folder = project("aot-typed-shipped-default");
    const javascript = installed["index.js"] + "export default function twice(n) {\n  return n * 2;\n}\n";
    write(join(folder, "node_modules", "shapes"), {
      "package.json": withCondition(),
      "index.js": javascript,
      "index.d.ts": installed["index.d.ts"] + "export default function twice(n: number): number;\n",
      "index.full.ts": typed + "export default function twice(n: number): number {\n  return n * 2;\n}\n",
    });
    write(folder, {
      "app.ts": `import twice, { area, where } from "shapes";\nconsole.log(twice(area(3, 7)), /index(\\.aot)?\\.[jt]s/.exec(where())![0]);\n`,
    });
    expect(await built(folder)).toEqual({ said: used("node_modules/shapes"), stdout: "42 index.js\n", exitCode: 0 });
  });

  const shippedMismatches: [string, (folder: string) => void, string][] = [
    [
      "the JavaScript has different code",
      folder => appendFileSync(join(folder, "node_modules", "shapes", "index.js"), "export const patched = true;\n"),
      "index.full.ts without its types doesn't match index.js. Was the package patched?",
    ],
    [
      "the full-types file has different code",
      folder => write(join(folder, "node_modules", "shapes"), { "index.full.ts": typedWithOtherCode }),
      "index.full.ts without its types doesn't match index.js. Was the package patched?",
    ],
    [
      "the full-types file has syntax that emits code",
      folder => write(join(folder, "node_modules", "shapes"), { "index.full.ts": typed + "enum Kind { A }\n" }),
      "in index.full.ts, TypeScript syntax that emits code can't be erased",
    ],
    [
      "the file that the condition names is missing",
      folder => shipped(folder, withCondition("./other.full.ts")),
      "other.full.ts is missing",
    ],
  ];
  test.each(shippedMismatches)(
    "rejected shipped version: %s: one warning, and the package is compiled as installed",
    async (_, change, why) => {
      const folder = project("aot-typed-shipped-mismatch");
      shipped(folder);
      change(folder);
      expect(await built(folder)).toEqual({ said: shippedUnused(why), stdout: output, exitCode: 0 });
    },
  );

  test("the warning for a rejected shipped version points at the first difference in the JavaScript", async () => {
    const folder = project("aot-typed-shipped-position");
    const castBefore = "function read() {\n  return 1;\n}\nexport const first = /** @type {number} */ (read());\n";
    write(join(folder, "node_modules", "shapes"), {
      "package.json": withCondition(),
      "index.js": castBefore + installed["index.js"],
      "index.full.ts": castBefore + typedWithOtherCode,
    });
    const build = await compiled(folder);
    expect(build.stdout + build.stderr).toMatch(
      /Was the package patched\?\n +at \S*node_modules[\\/]shapes[\\/]index\.js:7:10$/m,
    );
    expect(build.exitCode).toBe(0);
  });

  test("a type error in what the package ships is a warning, and the package is compiled without types", async () => {
    const folder = project("aot-typed-shipped-lie");
    shipped(folder);
    write(join(folder, "node_modules", "shapes"), { "index.full.ts": typedWithTypeError });
    const build = await compiled(folder);
    const said = build.stdout + build.stderr;
    expect(said).toMatch(
      /TS100009: 'shapes' has 1 type error \(the first at \S*node_modules[\\/]shapes[\\/]index\.full\.ts:\d+:\d+\), so \d+ of its \d+ files are compiled without their types\./,
    );
    expect(said).not.toContain("is compiled from its full types");
    expect(said).not.toContain("TS100021");
    expect(said).not.toContain("error:");
    expect(build.exitCode).toBe(0);
    expect(await ran(folder)).toEqual({ stdout: output, stderr: "", exitCode: 0 });
  });

  test("a symlinked package", async () => {
    const folder = project("aot-typed-symlink");
    typedVersion(join(folder, ".full-types", "linked"), { name: "linked" });
    const store = join(folder, "node_modules", ".store", "linked@1.2.3", "node_modules", "linked");
    write(store, {
      ...installed,
      "package.json": JSON.stringify({
        name: "linked",
        version: "1.2.3",
        type: "module",
        main: "index.js",
        types: "index.d.ts",
      }),
    });
    symlinkSync(join(".store", "linked@1.2.3", "node_modules", "linked"), join(folder, "node_modules", "linked"));
    write(folder, { "app.ts": app("linked") });
    expect(await built(folder)).toEqual({
      said: [`note: "linked" 1.2.3 is compiled from its full types in .full-types/linked`],
      stdout: output,
      exitCode: 0,
    });
  });

  const mismatches: [string, (folder: string) => void, string][] = [
    [
      "another version is installed",
      folder =>
        write(join(folder, "node_modules", "shapes"), {
          "package.json": installed["package.json"].replace("1.2.3", "1.2.4"),
        }),
      "they are for version 1.2.3, but 1.2.4 is installed. Replace them with the full types for 1.2.4, or remove them",
    ],
    [
      "it adds a file",
      folder => typedVersion(join(folder, ".full-types", "shapes"), { lay: { ...manifest().lay, "more.ts": "new" } }),
      "they add more.ts, and full types can only replace installed files",
    ],
    [
      "a path leaves the package",
      folder => typedVersion(join(folder, ".full-types", "shapes"), { lay: { "../other/index.js": "new" } }),
      `"../other/index.js" in full-types.json is not a path inside the package`,
    ],
    [
      "package.json cannot be replaced",
      folder =>
        typedVersion(join(folder, ".full-types", "shapes"), {
          lay: { "package.json": sha256(installed["package.json"]) },
        }),
      `"package.json" in full-types.json is not a path inside the package`,
    ],
    [
      "a replacement is missing",
      folder => rmSync(join(folder, ".full-types", "shapes", "lay", "index.js")),
      "lay/index.js is missing",
    ],
    [
      "a replacement has different code",
      folder => write(join(folder, ".full-types", "shapes", "lay"), { "index.js": typedWithOtherCode }),
      "lay/index.js without its types doesn't match index.js. Was the package patched?",
    ],
    [
      "nothing is replaced",
      folder => typedVersion(join(folder, ".full-types", "shapes"), { lay: {} }),
      `"lay" in full-types.json is empty`,
    ],
    [
      "the build does not define what it is for",
      folder => typedVersion(join(folder, ".full-types", "shapes"), { when: { "process.env.NODE_ENV": "production" } }),
      `they need process.env.NODE_ENV to be defined as "production". Pass --define 'process.env.NODE_ENV="production"'`,
    ],
    [
      "a needed full types are not in use",
      folder => typedVersion(join(folder, ".full-types", "shapes"), { needs: ["other"] }),
      `they need the full types of "other", which are not used`,
    ],
    [
      "what it needs is no package",
      folder => typedVersion(join(folder, ".full-types", "shapes"), { needs: ["../x"] }),
      `"needs" in full-types.json must be a list of package names`,
    ],
    [
      "format 1",
      folder => typedVersion(join(folder, ".full-types", "shapes"), { format: 1 }),
      `this version of Bun doesn't support the "format" in full-types.json`,
    ],
    [
      "an unknown format",
      folder => typedVersion(join(folder, ".full-types", "shapes"), { format: 99 }),
      `this version of Bun doesn't support the "format" in full-types.json`,
    ],
    [
      "a manifest that is not JSON",
      folder => write(join(folder, ".full-types", "shapes"), { "full-types.json": "{" }),
      "full-types.json is not valid JSON",
    ],
  ];
  test.each(mismatches)("%s: the build warns and goes on without it", async (_, change, why) => {
    const folder = project("aot-typed-mismatch");
    typedVersion(join(folder, ".full-types", "shapes"));
    change(folder);
    expect(await builtWithout(folder)).toEqual(warned(".full-types/shapes", why));
  });

  test("what the build defines", async () => {
    const folder = project("aot-typed-when");
    typedVersion(join(folder, ".full-types", "shapes"), { when: { "process.env.NODE_ENV": "production" } });
    expect(await built(folder, ["--aot", "--define", `process.env.NODE_ENV="production"`])).toEqual({
      said: used(".full-types/shapes"),
      stdout: output,
      exitCode: 0,
    });
  });

  test("control characters in the manifest do not reach the terminal", async () => {
    const folder = project("aot-typed-control");
    typedVersion(join(folder, ".full-types", "shapes"), { version: "1.2\u001b[31m.3" });
    expect((await builtWithout(folder)).said).toEqual(
      unused(
        ".full-types/shapes",
        "they are for version 1.2?[31m.3, but 1.2.3 is installed. Replace them with the full types for 1.2.3, or remove them",
      ),
    );
  });

  test("full types that do not type check: the package is compiled without its types, and the build warns with the first error", async () => {
    const folder = project("aot-typed-lie");
    typedVersion(join(folder, ".full-types", "shapes"));
    write(join(folder, ".full-types", "shapes", "lay"), { "index.js": typedWithTypeError });
    const build = await compiled(folder);
    const said = build.stdout + build.stderr;
    expect(said).toContain("warn: TS100009: 'shapes' has 1 type error (the first at ");
    expect(said).toContain("TS2322: Type 'string' is not assignable to type 'number'.");
    expect(said).toMatch(/lay[\\/]index\.js:3:\d+/);
    expect(said).not.toContain("error: ");
    expect(build.exitCode).toBe(0);
    expect(await ran(folder)).toEqual({ stdout: output, stderr: "", exitCode: 0 });
    write(folder, {
      "build.ts": `const result = await Bun.build({ entrypoints: ["app.ts"], compile: { outfile: "./app", aot: true }, throw: false });\nconsole.log(result.success, result.logs.filter(log => log.message.includes("TS100009")).map(log => log.level + ": " + log.message.slice(0, 35)));\n`,
    });
    expect(await spawned([bunExe(), "build.ts"], folder)).toEqual({
      stdout: `true [ "warn: TS100009: 'shapes' has 1 type error" ]\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("the host's lib, target and types do not count against it", async () => {
    const folder = project("aot-typed-host");
    const withNewerLibrary = (text: string, assertion: string) =>
      text.replace(
        "return box.w * box.h;",
        `return [box.w * box.h].at(-1)${assertion} + (typeof Temporal === typeof WeakRef ? 0 : 0);`,
      );
    const javascript = withNewerLibrary(installed["index.js"], "");
    write(join(folder, "node_modules", "shapes"), { "index.js": javascript });
    typedVersion(join(folder, ".full-types", "shapes"), { lay: { "index.js": sha256(javascript) } });
    write(join(folder, ".full-types", "shapes", "lay"), { "index.js": withNewerLibrary(typed, "!") });
    write(folder, {
      "app.ts": `declare const console: { log(...all: unknown[]): void };\n` + app(),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "bundler",
          target: "es2017",
          lib: ["es2017"],
          types: [],
          verbatimModuleSyntax: true,
          noUncheckedIndexedAccess: true,
        },
      }),
    });
    const build = await compiled(folder);
    expect(build.stdout + build.stderr).not.toContain("TS100009");
    expect(build.stdout + build.stderr).toContain(used(".full-types/shapes")[0]);
    expect(build.exitCode).toBe(0);
    expect(await ran(folder)).toEqual({ stdout: output, stderr: "", exitCode: 0 });
  });

  test("Bun.build has the note and the warning in its logs", async () => {
    const folder = project("aot-typed-api");
    typedVersion(join(folder, ".full-types", "shapes"));
    write(folder, {
      "build.ts": `const result = await Bun.build({ entrypoints: ["app.ts"], compile: { outfile: "./app", aot: true }, throw: false });\nconsole.log(JSON.stringify(result.logs.map(log => log.level + ": " + log.message)));\n`,
    });
    expect(await spawned([bunExe(), "build.ts"], folder)).toEqual({
      stdout: JSON.stringify([...used(".full-types/shapes"), counted(1)]) + "\n",
      stderr: "",
      exitCode: 0,
    });
    expect((await ran(folder)).stdout).toBe(output);
    write(join(folder, "node_modules", "shapes"), {
      "package.json": installed["package.json"].replace("1.2.3", "1.2.4"),
    });
    expect(await spawned([bunExe(), "build.ts"], folder)).toEqual({
      stdout:
        JSON.stringify([
          ...unused(
            ".full-types/shapes",
            "they are for version 1.2.3, but 1.2.4 is installed. Replace them with the full types for 1.2.4, or remove them",
          ),
          counted(0),
        ]) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("an onResolve plugin that returns nothing is skipped", async () => {
    const folder = project("aot-typed-plugin");
    typedVersion(join(folder, ".full-types", "shapes"));
    write(folder, {
      "build.ts": `const result = await Bun.build({ entrypoints: ["app.ts"], compile: { outfile: "./app", aot: true }, plugins: [{ name: "asks", setup(build) { build.onResolve({ filter: /.*/ }, () => undefined); } }] });\nconsole.log(JSON.stringify(result.logs.map(log => log.level + ": " + log.message)));\n`,
    });
    expect(await spawned([bunExe(), "build.ts"], folder)).toEqual({
      stdout: JSON.stringify([...used(".full-types/shapes"), counted(1)]) + "\n",
      stderr: "",
      exitCode: 0,
    });
    expect((await ran(folder)).stdout).toBe(output);
  });

  test("bun run --aot prints neither", async () => {
    const folder = project("aot-typed-run");
    typedVersion(join(folder, ".full-types", "shapes"));
    expect(await spawned([bunExe(), "run", "--debug-aot", "app.ts", "6"], folder)).toEqual({
      stdout: output,
      stderr: "",
      exitCode: 0,
    });
    appendFileSync(join(folder, "node_modules", "shapes", "index.js"), "export const patched = true;\n");
    expect(await spawned([bunExe(), "run", "--debug-aot", "app.ts", "6"], folder)).toEqual({
      stdout: output,
      stderr: "",
      exitCode: 0,
    });
  });
});
