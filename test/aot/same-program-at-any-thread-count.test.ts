// Many files say the same of the types that they share, and the link keeps what the first of them says. The program that the
// front end emits does not depend on which thread gets where first: same bytes, whatever the number of threads.
import { expect, setDefaultTimeout } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(240_000);

const moduleCount = 48;
const typeModuleCount = 6;

function typeModule(index: number): string {
  const earlier =
    index > 0 ? `import type { Shared${index - 1}, Kind${index - 1} } from "./types${index - 1}.ts";\n` : "";
  const link = index > 0 ? `  earlier?: Shared${index - 1};\n  kinds: Kind${index - 1}[];\n` : "";
  const fields = Array.from(
    { length: 12 },
    (_, field) =>
      `  field${field}${field % 3 == 0 ? "?" : ""}: ${["number", "string", "string[]", "() => number", "Map<string, number>"][field % 5]};\n`,
  ).join("");
  return (
    earlier +
    `export interface Shared${index} {\n  id: number;\n  name: string;\n${fields}${link}  next?: Shared${index};\n}\n` +
    `export interface First${index} { kind: "first"; value: number; owner?: Shared${index} }\n` +
    `export interface Second${index} { kind: "second"; text: string; call(x: number): string }\n` +
    `export type Kind${index} = First${index} | Second${index};\n` +
    `export interface Box${index}<T> { value: T; items: T[]; owner?: Shared${index} }\n`
  );
}

function codeModule(index: number): string {
  const types = [index % typeModuleCount, (index * 5 + 1) % typeModuleCount].filter(
    (type, at, all) => all.indexOf(type) == at,
  );
  const next = [2 * index + 1, 2 * index + 2].filter(other => other < moduleCount);
  return (
    types.map(type => `import type { Shared${type}, Kind${type}, Box${type} } from "./types${type}.ts";\n`).join("") +
    next.map(other => `import { run${other} } from "./module${other}.ts";\n`).join("") +
    types
      .map(
        type =>
          `function read${type}(shared: Shared${type}, kind: Kind${type}, box: Box${type}<number>, texts: Box${type}<string>): number {\n` +
          `  let sum = shared.id + shared.name.length + box.value + texts.items.length;\n` +
          `  if (shared.next) sum += shared.next.id;\n` +
          `  if (shared.field${index % 12} != null) sum++;\n` +
          `  return kind.kind == "first" ? sum + kind.value : sum + kind.call(sum).length;\n}\n`,
      )
      .join("") +
    `export function run${index}(seed: number): number {\n  const readers = [${types.map(type => `read${type}`).join(", ")}];\n` +
    `  const local = { seed, label: "module ${index}", nested: { depth: ${index} } };\n` +
    `  return readers.length + local.nested.depth + local.label.length${next.map(other => ` + run${other}(seed + 1)`).join("")};\n}\n`
  );
}

function program(): Record<string, string> {
  const files: Record<string, string> = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "esnext",
        module: "esnext",
        moduleResolution: "bundler",
        allowImportingTsExtensions: true,
        noEmit: true,
        types: [],
      },
    }),
    "main.ts": `import { run0 } from "./module0.ts";\ndeclare const console: { log(...values: unknown[]): void };\nconsole.log(run0(1));\n`,
  };
  for (let index = 0; index < typeModuleCount; index++) files[`types${index}.ts`] = typeModule(index);
  for (let index = 0; index < moduleCount; index++) files[`module${index}.ts`] = codeModule(index);
  return files;
}

async function build(directory: string, threads: number, round: number) {
  const name = `threads-${threads}-${round}`;
  const { stderr, exitCode } = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `--aot-threads=${threads}`,
      `--aot-out=${name}.program`,
      "main.ts",
      "--outfile",
      "app",
    ],
    directory,
  );
  expect({ errors: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    errors: [],
    exitCode: 0,
  });
  return {
    program: Bun.hash(await Bun.file(join(directory, `${name}.program`)).bytes()),
    executable: Bun.hash(await Bun.file(join(directory, isWindows ? "app.exe" : "app")).bytes()),
  };
}

test("the number of threads changes neither the emitted program nor the executable", async () => {
  using dir = tempDir("aot-same-program", program());
  const first = await build(String(dir), 1, 0);
  for (const threads of [2, 8, 8, 16]) {
    expect({ threads, ...(await build(String(dir), threads, 1)) }).toEqual({ threads, ...first });
  }
});
