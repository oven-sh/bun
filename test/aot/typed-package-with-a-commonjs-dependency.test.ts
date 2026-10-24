import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "esnext",
    types: [],
    lib: ["esnext", "dom"],
    skipLibCheck: true,
  },
});

const typedPackage = (name: string, code: string, typed: string, declarations: string) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({
    name,
    version: "1.0.0",
    type: "module",
    exports: { ".": { types: "./index.d.ts", "full-types": "./index.full.ts", default: "./index.js" } },
  }),
  [`node_modules/${name}/index.js`]: code,
  [`node_modules/${name}/index.full.ts`]: typed,
  [`node_modules/${name}/index.d.ts`]: declarations,
});

const shared = {
  "tsconfig.json": tsconfig,
  "package.json": JSON.stringify({ name: "app", private: true, type: "module" }),
  "node_modules/dep/package.json": JSON.stringify({
    name: "dep",
    version: "1.0.0",
    main: "./index.js",
    types: "./index.d.ts",
  }),
  "node_modules/dep/index.js": `exports.x = function x() {\n  return "x of dep";\n};\nexports.y = 2;\n`,
  "node_modules/dep/index.d.ts": `export declare function x(): string;\nexport declare let y: number;\n`,
  "node_modules/between/package.json": JSON.stringify({
    name: "between",
    version: "1.0.0",
    type: "module",
    main: "./index.js",
    types: "./index.d.ts",
  }),
  "node_modules/between/index.js": `export { x, y } from "dep";\n`,
  "node_modules/between/index.d.ts": `export { x, y } from "dep";\n`,
  ...typedPackage(
    "names",
    `import { x, y } from "dep";\nexport function callX() {\n  return x() + " " + y;\n}\n`,
    `import { x, y } from "dep";\nexport function callX(): string {\n  return x() + " " + y;\n}\n`,
    `export declare function callX(): string;\n`,
  ),
  ...typedPackage(
    "whole",
    `import dep from "dep";\nexport function callX() {\n  return dep.x() + " " + dep.y;\n}\n`,
    `import dep from "dep";\nexport function callX(): string {\n  return dep.x() + " " + dep.y;\n}\n`,
    `export declare function callX(): string;\n`,
  ),
  ...typedPackage(
    "handed-on",
    `export { x as callX } from "dep";\n`,
    `export { x as callX } from "dep";\n`,
    `export { x as callX } from "dep";\n`,
  ),
  ...typedPackage(
    "indirect",
    `import { x, y } from "between";\nexport function callX() {\n  return x() + " " + y;\n}\n`,
    `import { x, y } from "between";\nexport function callX(): string {\n  return x() + " " + y;\n}\n`,
    `export declare function callX(): string;\n`,
  ),
};

const uses = {
  "does not use": `console.log(callX());\n`,
  "lists the names of": `console.log(callX(), Object.keys(require("dep")).join());\n`,
  "stores a name of": `const dep = require("dep");\ndep.y = 3;\nconsole.log(callX(), dep.y);\n`,
  "replaces a function of": `const dep = require("dep");\ndep.x = () => "replaced";\nconsole.log(callX(), dep.x());\n`,
  "imports the default export of": `import dep from "dep";\nconsole.log(callX(), Object.keys(dep).join());\n`,
  "hands on the namespace of": `import * as dep from "dep";\nconsole.log(callX(), Object.keys(dep).join());\n`,
  "imports, when it is called,": `console.log(callX(), Object.keys(await import("dep")).join());\n`,
};

describe.concurrent("a typed package answers as under plain Bun", () => {
  for (const name of ["names", "whole", "handed-on", "indirect"]) {
    for (const [use, text] of Object.entries(uses)) {
      test(
        `"${name}", where the application ${use} the CommonJS package that it imports`,
        () =>
          slot(async () => {
            using dir = tempDir("typed-package-commonjs", {
              ...shared,
              "app.ts": `import { callX } from "${name}";\n${text}`,
            });
            const root = String(dir);
            const built = await spawned([bunExe(), "compile", "./app.ts"], root, env);
            const said = (built.stdout + built.stderr)
              .split(/\r?\n/)
              .filter(line => /full types|^error|^warn/.test(line));
            const ran = await spawned([join(root, isWindows ? "app.exe" : "app")], root, env);
            const plain = await spawned([bunExe(), "app.ts"], root, env);
            expect({ said, stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
              said: [`note: "${name}" 1.0.0 is compiled from its full types in node_modules/${name}`],
              stdout: plain.stdout,
              exitCode: 0,
            });
            expect(plain.stdout).toMatch(/^(x of dep|replaced)/);
          }),
        300_000,
      );
    }
  }
});

test(
  "import.meta.main is false in a typed package",
  () =>
    slot(async () => {
      const code = `export function isMain() {\n  return import.meta.main;\n}\nif (import.meta.main) console.log("main");\n`;
      using dir = tempDir("typed-package-main", {
        ...shared,
        ...typedPackage(
          "tool",
          code,
          `declare global {\n  interface ImportMeta {\n    main: boolean;\n  }\n}\n${code.replace("()", "(): boolean")}`,
          `export declare function isMain(): boolean;\n`,
        ),
        "app.ts": `import { isMain } from "tool";\nconsole.log(isMain(), import.meta.main);\n`,
      });
      const root = String(dir);
      const built = await spawned([bunExe(), "compile", "./app.ts"], root, env);
      const said = (built.stdout + built.stderr).split(/\r?\n/).filter(line => /full types|^error|^warn/.test(line));
      const ran = await spawned([join(root, isWindows ? "app.exe" : "app")], root, env);
      expect({ said, stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
        said: [`note: "tool" 1.0.0 is compiled from its full types in node_modules/tool`],
        stdout: "false true\n",
        exitCode: 0,
      });
    }),
  300_000,
);
