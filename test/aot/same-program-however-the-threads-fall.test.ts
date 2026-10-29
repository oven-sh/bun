// A build is a function of its sources and flags. The tsconfig.json here lists thousands of files by `include`, and threads read them
// while others follow the imports of the code; 40 of the listed folders have a tsconfig.json of their own that names `types`, and no code is in them.
import { expect, setDefaultTimeout } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { cpSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "./harness/run";
import { wanted } from "./harness/shares";
import { test } from "./supported";

setDefaultTimeout(600_000);

const chainLength = 120;
const sideProjects = 40;
const filesInSideProject = 10;
const compilerOptions = { strict: true, module: "esnext", moduleResolution: "bundler", noEmit: true };

function program(
  declarationOf: (project: number) => string,
  bodyOf: (index: number) => string,
): Record<string, string> {
  const files: Record<string, string> = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        ...compilerOptions,
        target: "esnext",
        allowImportingTsExtensions: true,
        types: [],
        skipLibCheck: true,
      },
      include: ["**/*.ts"],
    }),
  };
  for (let index = 0; index < chainLength; index++) {
    const next = index + 1 < chainLength;
    files[`chain/c${index}.ts`] =
      (next ? `import { run${index + 1} } from "./c${index + 1}.ts";\n` : "") +
      `function helper${index}(x: number): number { return ${bodyOf(index)}; }\n` +
      `export function run${index}(seed: number): number { return helper${index}(seed)${next ? ` + run${index + 1}(seed + 1)` : ""}; }\n`;
  }
  for (let project = 0; project < sideProjects; project++) {
    files[`side/p${project}/tsconfig.json`] = JSON.stringify({
      compilerOptions: { ...compilerOptions, types: [`t${project}`] },
    });
    for (let file = 0; file < filesInSideProject; file++)
      files[`side/p${project}/f${file}.ts`] =
        `export interface Side${file} { value: number }\nexport function side${file}(x: Side${file}): number { return x.value + ${file}; }\n`;
    files[`node_modules/@types/t${project}/package.json`] = JSON.stringify({
      name: `@types/t${project}`,
      version: "1.0.0",
      types: "index.d.ts",
    });
    files[`node_modules/@types/t${project}/index.d.ts`] = declarationOf(project);
  }
  return files;
}

const entryPoint = (modules: number, more = "") =>
  `import { run${chainLength - modules} as first } from "./chain/c${chainLength - modules}.ts";\n${more}` +
  `declare const console: { log(...values: unknown[]): void };\nconsole.log(first(1), first.name.length);\n`;

async function build(directory: string, entry: string, threads: number) {
  const { stderr, exitCode } = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `--aot-threads=${threads}`,
      "--aot-out=emitted.program",
      "--minify",
      entry,
      "--outfile",
      "app",
    ],
    directory,
  );
  const hashOf = async (name: string) => {
    const file = Bun.file(join(directory, name));
    return (await file.exists()) ? new Bun.CryptoHasher("sha256").update(await file.bytes()).digest("hex") : "";
  };
  const built = {
    exitCode,
    errors: stderr.split("\n").filter(line => line.startsWith("error")).length,
    program: await hashOf("emitted.program"),
    executable: await hashOf(isWindows ? "app.exe" : "app"),
  };
  await Promise.all(
    ["emitted.program", "app", "app.exe"].map(name =>
      Bun.file(join(directory, name))
        .delete()
        .catch(() => {}),
    ),
  );
  return built;
}

test("how many of the listed files are read by the time the code is loaded changes nothing", async () => {
  const lengths = [chainLength];
  using dir = tempDir("aot-threads-fall", {
    ...program(
      project => `declare const global${project}: number;\n`,
      index => `x * ${index + 1}`,
    ),
    ...Object.fromEntries(lengths.map(length => [`main${length}.ts`, entryPoint(length)])),
  });
  for (const length of lengths) {
    const first = await build(String(dir), `main${length}.ts`, 1);
    expect({ length, ...first }).toEqual({ length, ...first, exitCode: 0, errors: 0 });
    for (const threads of [4, 16])
      expect({ length, threads, ...(await build(String(dir), `main${length}.ts`, threads)) }).toEqual({
        length,
        threads,
        ...first,
      });
  }
});

test("what a folder without code names in `types` is not declared to the code, in any build", async () => {
  using dir = tempDir("aot-threads-fall-global", {
    ...program(
      project => `declare var shared: ${project % 2 ? "string" : "number"};\n`,
      () => `x + Number(shared)`,
    ),
    "main.ts": entryPoint(60),
  });
  for (const threads of [1, 16])
    expect(await build(String(dir), "main.ts", threads)).toEqual({
      exitCode: 1,
      errors: 60,
      program: "",
      executable: "",
    });
});

test("library modules lower the same at any thread count", async () => {
  using dir = tempDir("aot-threads-fall-library", {
    "main.js": `
      const modules = [
        require("node:http"),
        require("node:http2"),
        require("node:readline"),
        require("node:child_process"),
        require("node:zlib"),
      ];
      const server = modules[0].createServer(function listener(request, response) {
        response.end(request.url);
      });
      console.log(modules.length, typeof server.listen);
    `,
  });
  const first = await build(String(dir), "main.js", 1);
  expect(first).toEqual({ ...first, exitCode: 0, errors: 0 });
  for (const threads of [2, 4, 8, 16, 64])
    expect({ threads, ...(await build(String(dir), "main.js", threads)) }).toEqual({ threads, ...first });
});

// The typescript package is large enough for the flow analysis to split its work into batches, which the small programs above never do.
// One thread takes serial code paths that two or more threads skip. A debug or ASAN build of Bun takes an hour here.
test.skipIf(wanted === "quick")("a large untyped package builds the same at one thread", async () => {
  using dir = tempDir("aot-threads-fall-typescript", {});
  cpSync(join(import.meta.dir, "servers", "typescript-check.ts"), join(String(dir), "typescript-check.ts"));
  mkdirSync(join(String(dir), "node_modules"));
  symlinkSync(
    dirname(require.resolve("typescript/package.json")),
    join(String(dir), "node_modules", "typescript"),
    "junction",
  );
  const first = await build(String(dir), "typescript-check.ts", 1);
  expect(first).toEqual({ ...first, exitCode: 0, errors: 0 });
  expect({ threads: 4, ...(await build(String(dir), "typescript-check.ts", 4)) }).toEqual({ threads: 4, ...first });
});
