// A build reports a type error only where `bun check` reports one too. `bun check` knows no type of a package that offers only its source to a
// build, nor of the module "bun" where Bun's types aren't installed, so a wrong use of one is the build's alone to report.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const source = `export function ok(): number {
  return 3;
}
export interface Shape {
  side: number;
}
export class Box {
  size: number = 1;
}
`;
const javaScript = `export function ok() {
  return 3;
}
export class Box {
  size = 1;
}
`;
const declarations = `export declare function ok(): string;
export interface Shape {
  side: string;
}
export declare class Box {
  size: string;
}
`;
const usesOfPackage = `import { Box, ok, type Shape } from "clean-lib";
const n: string = ok();
const s: Shape = { side: "wide" };
const b: string = new Box().size;
console.log(n, s, b);
`;
const strict = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    lib: ["esnext", "dom"],
    types: [],
  },
});
const notStrict = JSON.stringify({ compilerOptions: { ...JSON.parse(strict).compilerOptions, strict: false } });
const manifest = (exports: object) =>
  JSON.stringify({ name: "clean-lib", version: "1.0.0", type: "module", exports: { ".": exports } });
const packageWithSource = {
  "node_modules/clean-lib/package.json": manifest({ aot: "./index.aot.ts", default: "./index.js" }),
  "node_modules/clean-lib/index.aot.ts": source,
  "node_modules/clean-lib/index.js": javaScript,
};

const errorsOfPackage = ["main.ts(2,7): TS2322", "main.ts(3,20): TS2322", "main.ts(4,7): TS2322"];
const programs: Record<string, { files: Record<string, string>; errors: string[] }> = {
  "a package that offers only its source": {
    files: { ...packageWithSource, "main.ts": usesOfPackage },
    errors: errorsOfPackage,
  },
  "the same under a strict tsconfig.json": {
    files: { ...packageWithSource, "main.ts": usesOfPackage, "tsconfig.json": strict },
    errors: errorsOfPackage,
  },
  "the same where an untyped import is no error": {
    files: { ...packageWithSource, "main.ts": usesOfPackage, "tsconfig.json": notStrict },
    errors: errorsOfPackage,
  },
  "wrong calls and members of such a package": {
    files: {
      ...packageWithSource,
      "main.ts": `import { ok } from "clean-lib";\nok(1, 2, 3);\nok.nothing;\nok().length;\n`,
    },
    errors: ["main.ts(2,4): TS2554", "main.ts(3,4): TS2339", "main.ts(4,6): TS2339"],
  },
  "a type of such a package, through another file": {
    files: {
      ...packageWithSource,
      "shapes.ts": `export type { Shape } from "clean-lib";\n`,
      "main.ts": `import type { Shape } from "./shapes";\nconst s: Shape = { side: "wide" };\nconsole.log(s);\n`,
    },
    errors: ["main.ts(2,20): TS2322"],
  },
  "a package whose declarations differ from its source": {
    files: {
      ...packageWithSource,
      "node_modules/clean-lib/package.json": manifest({
        aot: "./index.aot.ts",
        types: "./index.d.ts",
        default: "./index.js",
      }),
      "node_modules/clean-lib/index.d.ts": declarations,
      "main.ts": usesOfPackage,
    },
    errors: [],
  },
  "an int32 without Bun's types": {
    files: {
      "main.ts": `import type { int32 } from "bun";\nclass Cursor {\n  column: int32 = "zero";\n}\nconsole.log(new Cursor().column);\n`,
    },
    errors: ["main.ts(3,3): TS2322"],
  },
  "an int32 without Bun's types, through another file": {
    files: {
      "row.ts": `import type { int32 } from "bun";\nexport interface Row {\n  column: int32;\n}\n`,
      "main.ts": `import type { Row } from "./row";\nconst row: Row = { column: "zero" };\nconsole.log(row);\n`,
    },
    errors: ["main.ts(2,20): TS2322"],
  },
  "a type that the module bun does not have": {
    files: { "main.ts": `import type { Nothing } from "bun";\nconst n: Nothing = 1;\nconsole.log(n);\n` },
    errors: ["main.ts(1,15): TS2305"],
  },
  "what only Bun's types would tell": {
    files: {
      "main.ts": `import { file, version } from "bun";
const v: number = version;
const timer: number = setTimeout(() => {}, 1);
clearTimeout(timer);
console.log(v, file("x").name);
`,
    },
    errors: [],
  },
};

async function run(files: Record<string, string>, ...args: string[]) {
  using dir = tempDir("aot-untyped-imports", { "package.json": `{ "name": "app", "type": "module" }`, ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { said: stdout + stderr, exitCode };
}

for (const [what, { files, errors }] of Object.entries(programs)) {
  test.concurrent(what, async () => {
    const [checked, built] = await Promise.all([
      run(files, "check", "--aot", "--no-pretty", "./main.ts"),
      run(files, "build", "--compile", "--aot", "./main.ts", "--outfile", "app"),
    ]);
    const found = [...checked.said.matchAll(/^(\S+\(\d+,\d+\)): error (TS\d+)/gm)];
    expect(found.map(([, place, code]) => `${place}: ${code}`)).toEqual(errors);
    expect(checked.exitCode).toBe(errors.length > 0 ? 1 : 0);
    expect({ what, said: built.said, exitCode: built.exitCode }).toMatchObject({
      exitCode: errors.length > 0 ? 1 : 0,
    });
  });
}
