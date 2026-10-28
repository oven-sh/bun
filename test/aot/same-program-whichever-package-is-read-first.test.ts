// A build is a function of its sources and flags. Two folders of installed packages lie outside the project, so no tsconfig.json
// governs them, and each holds typings of its own under the name that the project lists in `types`. Threads read the packages of
// both folders in an order that differs from run to run.
import { expect, setDefaultTimeout } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(600_000);

const packagesInFolder = 4;
const folders = ["far", "near"];

function typings(folder: string, version: string): Record<string, string> {
  return {
    [`${folder}/node_modules/@types/listed/package.json`]: JSON.stringify({
      name: "@types/listed",
      version,
      types: "index.d.ts",
    }),
    [`${folder}/node_modules/@types/listed/index.d.ts`]:
      `export interface Listed { each(visit: (value: number) => number): number; last(pick: (text: string) => string): string }\n` +
      `declare global { var declaredIn_${folder}: number; }\n`,
  };
}

function installed(folder: string, index: number, importsTypings: boolean): Record<string, string> {
  const name = `${folder}${index}`;
  const listed = importsTypings ? "Listed" : "{ each(visit: (value: number) => number): number }";
  return {
    [`${folder}/node_modules/${name}/package.json`]: JSON.stringify({
      name,
      version: "1.0.0",
      main: "index.js",
      types: "index.d.ts",
    }),
    [`${folder}/node_modules/${name}/index.js`]: `export function ${name}(listed, own) { return listed.each(value => value + ${index}) + own.twice(value => value * 2); }\n`,
    [`${folder}/node_modules/${name}/index.d.ts`]:
      (importsTypings ? `import type { Listed } from "listed";\n` : "") +
      `export interface Own { twice(change: (value: number) => number): number }\n` +
      `export declare function ${name}(listed: ${listed}, own: Own): number;\n`,
  };
}

function importer(folder: string): string {
  const names = Array.from({ length: packagesInFolder }, (_, index) => `${folder}${index}`);
  return (
    names.map(name => `import { ${name} } from "../${folder}/node_modules/${name}/index.js";\n`).join("") +
    `import type { Listed } from "listed";\n` +
    `export function ${folder}(listed: Listed, own: { twice(change: (value: number) => number): number }): number {\n` +
    `  return ${names.map(name => `${name}(listed, own)`).join(" + ")};\n}\n`
  );
}

function program(importsTypings: boolean, printed: string): Record<string, string> {
  const files: Record<string, string> = {
    "app/tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "esnext",
        module: "esnext",
        moduleResolution: "bundler",
        allowJs: true,
        noEmit: true,
        skipLibCheck: true,
        types: ["listed"],
      },
      include: ["*.ts"],
    }),
    "app/main.ts":
      folders.map(folder => `import { ${folder} } from "./${folder}";\n`).join("") +
      `import type { Listed } from "listed";\n` +
      `declare const console: { log(...values: unknown[]): void };\n` +
      `const listed: Listed = { each: visit => visit(1), last: pick => pick("last") };\n` +
      `const own = { twice: (change: (value: number) => number) => change(change(1)) };\n` +
      `console.log(${folders.map(folder => `${folder}(listed, own)`).join(" + ")}, listed.last(text => text + "!"), ${printed});\n`,
    ...typings("app", "1.0.0"),
  };
  for (const [position, folder] of folders.entries()) {
    files[`app/${folder}.ts`] = importer(folder);
    Object.assign(files, typings(folder, `1.0.${position + 1}`));
    for (let index = 0; index < packagesInFolder; index++)
      Object.assign(files, installed(folder, index, importsTypings));
  }
  return files;
}

async function build(directory: string, threads: number) {
  const { stderr, exitCode } = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `--aot-threads=${threads}`,
      "--aot-out=emitted.program",
      "main.ts",
      "--outfile",
      "app",
    ],
    directory,
  );
  const hashOf = async (name: string) => {
    const file = Bun.file(join(directory, name));
    if (!(await file.exists())) return "";
    const hash = new Bun.CryptoHasher("sha256").update(await file.bytes()).digest("hex");
    await file.delete();
    return hash;
  };
  return {
    exitCode,
    errors: stderr.split("\n").filter(line => line.startsWith("error")).length,
    program: await hashOf("emitted.program"),
    executable: await hashOf(isWindows ? "app.exe" : "app"),
  };
}

const threadCounts = [2, 2, 4, 8, 16, 16];

test("`types` names what the folder of the project holds, and not what lies beside a package", async () => {
  using dir = tempDir(
    "aot-packages-read-first-types",
    program(false, "declaredIn_app, declaredIn_far, declaredIn_near"),
  );
  for (const threads of [1, ...threadCounts])
    expect({ threads, ...(await build(join(String(dir), "app"), threads)) }).toEqual({
      threads,
      exitCode: 1,
      errors: 2,
      program: "",
      executable: "",
    });
});

test("which folder of packages is read first changes neither the emitted program nor the executable", async () => {
  using dir = tempDir("aot-packages-read-first", program(true, "declaredIn_app"));
  const first = await build(join(String(dir), "app"), 1);
  expect(first).toEqual({ ...first, exitCode: 0, errors: 0 });
  for (const threads of threadCounts)
    expect({ threads, ...(await build(join(String(dir), "app"), threads)) }).toEqual({ threads, ...first });
});
