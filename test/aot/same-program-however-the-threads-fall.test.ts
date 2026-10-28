// A build is a function of its sources and flags. The tsconfig.json here lists thousands of files by `include`, and threads read them
// while others follow the imports of the code; 200 of the listed folders have a tsconfig.json of their own that names `types`, and no code is in them.
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(600_000);

const chainLength = 500;
const sideProjects = 200;
const filesInSideProject = 20;
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

async function build(directory: string, entry: string) {
  const { stderr, exitCode } = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--aot-threads=16",
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
  const lengths = [60, 120, 250, chainLength];
  using dir = tempDir("aot-threads-fall", {
    ...program(
      project => `declare const global${project}: number;\n`,
      index => `x * ${index + 1}`,
    ),
    ...Object.fromEntries(lengths.map(length => [`main${length}.ts`, entryPoint(length)])),
  });
  for (const length of lengths) {
    const first = await build(String(dir), `main${length}.ts`);
    expect({ length, ...first }).toEqual({ length, ...first, exitCode: 0, errors: 0 });
    for (let round = 0; round < 3; round++)
      expect({ length, ...(await build(String(dir), `main${length}.ts`)) }).toEqual({ length, ...first });
  }
});

test("what a folder without code names in `types` is not declared to the code, in any build", async () => {
  using dir = tempDir("aot-threads-fall-global", {
    ...program(
      project => `declare var shared: ${project % 2 ? "string" : "number"};\n`,
      () => `x + Number(shared)`,
    ),
    "main.ts": entryPoint(250),
  });
  for (let round = 0; round < 6; round++)
    expect(await build(String(dir), "main.ts")).toEqual({ exitCode: 1, errors: 250, program: "", executable: "" });
});

test("three builds on a busy machine give one executable", async () => {
  const modules = [
    "assert",
    "child_process",
    "crypto",
    "events",
    "fs",
    "http",
    "https",
    "net",
    "path",
    "readline",
    "stream",
    "url",
    "util",
    "zlib",
  ];
  const more = modules.map((name, index) => `import * as module${index} from "node:${name}";\n`).join("");
  const used = `console.log([${modules.map((_, index) => `module${index}`).join(", ")}].map(it => Object.keys(it).length > 0).join());\n`;
  using dir = tempDir("aot-threads-fall-busy", {
    ...program(
      project => `declare const global${project}: number;\n`,
      index => `x * ${index + 1}`,
    ),
    "main.ts": entryPoint(250, more) + used,
  });
  const busy = Array.from({ length: Math.min(2 * availableParallelism(), 64) }, () =>
    Bun.spawn({ cmd: [bunExe(), "-e", "for (;;);"], env: bunEnv, stdout: "ignore", stderr: "ignore" }),
  );
  try {
    const first = await build(String(dir), "main.ts");
    expect(first).toEqual({ ...first, exitCode: 0, errors: 0 });
    expect([await build(String(dir), "main.ts"), await build(String(dir), "main.ts")]).toEqual([first, first]);
  } finally {
    for (const process of busy) process.kill("SIGKILL");
    await Promise.all(busy.map(process => process.exited));
  }
});
