import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { raiseDefaultTimeout } from "../../aot/harness/default-timeout";

// Each test builds a package, and a debug build with a sanitizer takes seconds for one.
raiseDefaultTimeout(30_000);

async function bun(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const compilerOptions = { strict: true, lib: ["esnext"] };
const library = (files: Record<string, string | Buffer>) => ({
  "tsconfig.json": JSON.stringify({
    compilerOptions: { ...compilerOptions, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [] },
  }),
  "package.json": JSON.stringify({ name: "readings", version: "1.0.0", compilerOptions }),
  ...files,
});
// A file in an encoding of one byte for each character, which is not UTF-8 where a character is not ASCII.
const latin1 = (text: string) => Buffer.from(text, "latin1");
const typedFile = (dir: unknown, outdir = "dist") => readFileSync(join(String(dir), outdir, "index.aot.ts"), "utf8");
const LEFT_OUT = "the .aot.ts files that --aot compiles a package from are left out: ";
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The message names the file by its whole path.
const leftOutFor = (why: string) => new RegExp(`^(warn: )?${escaped(LEFT_OUT)}index\\.js: ${why}$`);

const reading = `export interface Reading { value: number; unit: string }
export function describe(r: Reading): string {
  return r.value + r.unit;
}
`;
// What `reading` gives, with or without a comment in ASCII.
const typedReading = `// src/index.ts
interface Reading { value: number; unit: string }
export type { Reading };
function describe(r: Reading): string {
  return r.value + r.unit;
}
export {
  describe
};
`;

describe.concurrent("the .aot.ts file of a source that is not UTF-8", () => {
  test.each([
    ["in the middle of a comment", "// caf\xE9 au lait\n" + reading],
    ["at the end of a comment", "// caf\xE9\n" + reading],
    ["that starts no sequence", "// 25\xB0C\n" + reading],
    ["on the line of a function", reading.replace("export function", "/* caf\xE9 */ export function")],
  ])("a byte %s: the file that a comment in ASCII gives", async (_, source) => {
    using dir = tempDir("library-not-utf8-comment", library({ "src/index.ts": latin1(source) }));
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built.stderr).toBe("");
    expect(typedFile(dir)).toBe(typedReading);
    expect(built.exitCode).toBe(0);
  });

  test("a comment of 60 such sequences above the name of a global type: the build ends", async () => {
    const comment = "// " + Buffer.alloc(180, "\xE9ab", "latin1").toString("latin1") + "\n";
    const source = "export function first(values: Array<number>): number {\n  return values[0];\n}\n";
    using dir = tempDir("library-not-utf8-global", library({ "src/index.ts": latin1(comment + source) }));
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built.stderr).toBe("");
    expect(typedFile(dir)).toBe(`// src/index.ts
function first(values: Array<number>): number {
  return values[0];
}
export {
  first
};
`);
    expect(built.exitCode).toBe(0);
  });

  test("a byte in a comment of a TypeScript package that is bundled: its types are there", async () => {
    using dir = tempDir("library-not-utf8-dependency", {
      ...library({
        "src/index.ts": `import { describe } from "units";
export function show(value: number): string {
  return describe({ value, unit: "g" });
}
`,
      }),
      "package.json": JSON.stringify({ name: "readings", version: "1.0.0", devDependencies: { units: "1.0.0" } }),
      "node_modules/units/package.json": JSON.stringify({ name: "units", version: "1.0.0", main: "index.ts" }),
      "node_modules/units/index.ts": latin1("// caf\xE9\n" + reading),
    });
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built.stderr).toBe("");
    expect(typedFile(dir)).toBe(`// node_modules/units/index.ts
interface Reading { value: number; unit: string }
function describe(r: Reading): string {
  return r.value + r.unit;
}

// src/index.ts
function show(value: number): string {
  return describe({ value, unit: "g" });
}
export {
  show
};
`);
    expect(built.exitCode).toBe(0);
  });

  test.each([
    [
      "a byte in a type that the file would hold",
      `export type Drink = "caf\xE9 au lait";
export function order(drink: Drink): Drink {
  return drink;
}
`,
    ],
    // The line table gives `r`, which the second lead byte of the comment announces, the column of `:`.
    [
      "a parameter whose column another byte has",
      `export interface Reading { value: number; unit: string }
export function describe(
// l\x92unit\xE9 du relev\xE9
r: Reading,
s: Reading,
): string {
  return r.value + s.unit;
}
`,
    ],
  ])("%s: a warning that names the source, and a package without the file", async (_, source) => {
    using dir = tempDir("library-not-utf8-left-out", library({ "src/index.ts": latin1(source) }));
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built.stderr).toMatch(leftOutFor(".*/src/index\\.ts is not UTF-8\\n"));
    expect(built.stderr.startsWith("warn: ")).toBe(true);
    expect(readdirSync(join(String(dir), "dist")).sort()).toEqual(["index.d.ts", "index.js", "package.json"]);
    expect(readFileSync(join(String(dir), "dist/package.json"), "utf8")).not.toContain('"aot"');
    expect(built.exitCode).toBe(0);
  });

  test("a byte that the bundle holds as the source has it: a warning, and a package without the file", async () => {
    using dir = tempDir(
      "library-not-utf8-bundle",
      library({
        "src/raw.js": latin1("export const tag = String.raw`caf\xE9\nx`;\n"),
        "src/raw.d.ts": "export declare const tag: string;\n",
        "src/index.ts": `import { tag } from "./raw.js";\n` + reading.replace("return r.value", "return tag + r.value"),
      }),
    );
    const built = await bun(String(dir), "compile", "--library", "src/index.ts");
    expect(built.stderr).toBe(`warn: ${LEFT_OUT}index.js: the JavaScript is not UTF-8\n`);
    expect(existsSync(join(String(dir), "dist/index.aot.ts"))).toBe(false);
    expect(built.exitCode).toBe(0);
  });

  test("bun build --dts: a build that leaves the file out removes the one of the build before", async () => {
    using dir = tempDir("build-dts-not-utf8-again", library({ "src/index.ts": reading }));
    const first = await bun(String(dir), "build", "./src/index.ts", "--dts", "--outdir", "out");
    expect(first.stderr).toBe("");
    expect(typedFile(dir, "out")).toBe(typedReading);
    writeFileSync(join(String(dir), "src/index.ts"), latin1(`export type Drink = "caf\xE9";\n` + reading));
    const second = await bun(String(dir), "build", "./src/index.ts", "--dts", "--outdir", "out");
    expect(second.stderr).toMatch(leftOutFor(".*/src/index\\.ts is not UTF-8\n"));
    expect(readdirSync(join(String(dir), "out")).sort()).toEqual(["index.d.ts", "index.js"]);
    expect(second.exitCode).toBe(0);
  });

  test("bun build --dts: the file that a comment in ASCII gives", async () => {
    using dir = tempDir("build-dts-not-utf8", library({ "src/index.ts": latin1("// caf\xE9\n" + reading) }));
    const built = await bun(String(dir), "build", "./src/index.ts", "--dts", "--outdir", "out");
    expect(built.stderr).toBe("");
    expect(typedFile(dir, "out")).toBe(typedReading);
    expect(built.exitCode).toBe(0);
  });
});

test("characters that are not ASCII, a byte order mark and CRLF keep each type at its name", async () => {
  const source =
    "\uFEFF/* caf\u00E9 \u{1F600} */ export interface Reading { value: number; unit: string }\r\n" +
    '/* \u00E9\u{1F600} */ export function describe(/* \u{1F600} */ r: Reading, /* \u00E9 */ s: "\u00E9\u{1F600}"): string {\r\n' +
    "  return r.value + r.unit + s;\r\n}\r\n";
  using dir = tempDir("library-utf8", library({ "src/index.ts": source }));
  const built = await bun(String(dir), "compile", "--library", "src/index.ts");
  expect(built.stderr).toBe("");
  expect(typedFile(dir)).toBe(`// src/index.ts
interface Reading { value: number; unit: string }
export type { Reading };
function describe(r: Reading, s: "\u00E9\u{1F600}"): string {
  return r.value + r.unit + s;
}
export {
  describe
};
`);
  expect(built.exitCode).toBe(0);
});

// A build that aborts takes the process that called it along, so each build is in a process of its own.
describe.concurrent("Bun.build({ dts: true })", () => {
  const build = (options: string) => `import { join } from "node:path";
const entry = join(import.meta.dir, "src/index.ts");
const built = await Bun.build({
  entrypoints: [entry],
  tsconfig: join(import.meta.dir, "tsconfig.json"),
  dts: true,
  throw: false,
  ${options}
});
const typed = built.outputs.find(output => output.path.endsWith("index.aot.ts"));
console.log(JSON.stringify({
  success: built.success,
  logs: built.logs.map(log => [log.level, log.message]),
  typed: typed ? await typed.text() : null,
}));
`;
  async function built(dir: unknown) {
    const { stdout, stderr, exitCode } = await bun(String(dir), "build.ts");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout) as { success: boolean; logs: [string, string][]; typed: string | null };
  }

  test.each([
    ["puts a line before", `"// made by a plugin\\n" + text`],
    ["takes the first line of", `text.slice(text.indexOf("\\n") + 1)`],
  ])("a plugin that %s a file on disk: a warning that names the file, and no .aot.ts file", async (_, changed) => {
    using dir = tempDir(
      "build-api-dts-plugin",
      library({
        "src/index.ts": "// a line that a plugin can take away\n" + reading,
        "build.ts": build(`plugins: [
    {
      name: "changes the text",
      setup(build) {
        build.onLoad({ filter: /index\\.ts$/ }, async ({ path }) => {
          const text = await Bun.file(path).text();
          return { contents: ${changed}, loader: "ts" };
        });
      },
    },
  ],`),
      }),
    );
    const { success, logs, typed } = await built(dir);
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toBe("warn");
    expect(logs[0][1]).toMatch(
      leftOutFor("the bundled text of .*/src/index\\.ts is not the text that was type checked"),
    );
    expect({ success, typed }).toEqual({ success: true, typed: null });
  });

  test("a text of `files` that starts with a byte order mark: the file that the text without it gives", async () => {
    using dir = tempDir(
      "build-api-dts-files",
      library({
        "src/index.ts": "export {};\n",
        "build.ts": build(`files: { [entry]: "\\uFEFF// a comment\\n" + ${JSON.stringify(reading)} },`),
      }),
    );
    expect(await built(dir)).toEqual({ success: true, logs: [], typed: typedReading });
  });

  test("a module that only a plugin has, with a byte that is not UTF-8 in a comment: its types are there", async () => {
    using dir = tempDir(
      "build-api-dts-namespace",
      library({
        "src/index.ts": `import { describe } from "made:reading.ts";
export function show(value: number): string {
  return describe({ value, unit: "g" });
}
`,
        "src/made.d.ts": `declare module "made:reading.ts" {
  export interface Reading { value: number; unit: string }
  export function describe(r: Reading): string;
}
`,
        "build.ts": build(`plugins: [
    {
      name: "makes a module",
      setup(build) {
        build.onResolve({ filter: /^made:/ }, ({ path }) => ({ path: path.slice(5), namespace: "made" }));
        build.onLoad({ filter: /.*/, namespace: "made" }, () => ({
          contents: Buffer.from("// caf\\xE9\\n" + ${JSON.stringify(reading)}, "latin1"),
          loader: "ts",
        }));
      },
    },
  ],`),
      }),
    );
    expect(await built(dir)).toEqual({
      success: true,
      logs: [],
      typed: `// made:reading.ts
interface Reading { value: number; unit: string }
function describe(r: Reading): string {
  return r.value + r.unit;
}

// src/index.ts
function show(value: number): string {
  return describe({ value, unit: "g" });
}
export {
  show
};
`,
    });
  });
});
