import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
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

const callX = `export declare function callX(): string;\n`;

const typedPackage = (name: string, type: "module" | "commonjs", typed: string, declarations = callX) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({
    name,
    version: "1.0.0",
    type,
    exports: { ".": { types: "./index.d.ts", aot: "./index.aot.ts", default: "./index.js" } },
  }),
  [`node_modules/${name}/index.js`]: typed
    .replace(/\((this: any)?\): string/g, "()")
    .replace(/^declare global {.*?^}\n/ms, ""),
  [`node_modules/${name}/index.aot.ts`]: typed,
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
};

async function expectSameOutput(files: Record<string, string>, entry: string) {
  using dir = tempDir("typed-package-commonjs", { ...shared, ...files });
  const root = String(dir);
  const report = join(root, "report.json");
  const built = await spawned([bunExe(), "compile", `./${entry}`, "--aot-report=" + report], root, env);
  const said = (built.stdout + built.stderr).split(/\r?\n/).filter(line => /^error|^warn/.test(line));
  const ran = await spawned([join(root, isWindows ? "app.exe" : "app")], root, env);
  const plain = await spawned([bunExe(), entry], root, env);
  // index.aot.ts is the one file of a package with the condition.
  const aotFiles = readBuildReport(report).statistics.TypedVersionsUsed;
  expect({ said, aotFiles, stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
    said: [],
    aotFiles: 1,
    stdout: plain.stdout,
    exitCode: 0,
  });
  expect(plain.stdout).toMatch(/x of|replaced/);
}

const importers = {
  names: `import { x, y } from "dep";\nexport function callX(): string {\n  return x() + " " + y;\n}\n`,
  default: `import dep from "dep";\nexport function callX(): string {\n  return dep.x() + " " + dep.y;\n}\n`,
  reexport: `export { x as callX } from "dep";\n`,
  indirect: `import { x, y } from "between";\nexport function callX(): string {\n  return x() + " " + y;\n}\n`,
  main: `declare global {\n  interface ImportMeta {\n    main: boolean;\n  }\n}\nimport { x } from "dep";\nexport function callX(): string {\n  return x() + " " + import.meta.main;\n}\n`,
};

const usesOfDependency = {
  "is not used": `console.log(callX());\n`,
  "has its keys listed": `console.log(callX(), Object.keys(require("dep")).join());\n`,
  "is assigned to": `const dep = require("dep");\ndep.y = 3;\nconsole.log(callX(), dep.y);\n`,
  "has a function replaced": `const dep = require("dep");\ndep.x = () => "replaced";\nconsole.log(callX(), dep.x());\n`,
  "is a default import": `import dep from "dep";\nconsole.log(callX(), Object.keys(dep).join());\n`,
  "is a namespace import": `import * as dep from "dep";\nconsole.log(callX(), Object.keys(dep).join());\n`,
  "is a dynamic import": `console.log(callX(), Object.keys(await import("dep")).join());\n`,
};

describe.concurrent("a typed ES package imports a CommonJS package that, in the application,", () => {
  for (const [name, typed] of Object.entries(importers)) {
    for (const [use, text] of Object.entries(usesOfDependency)) {
      test(
        `${use} (${name})`,
        () =>
          slot(() =>
            expectSameOutput(
              {
                ...typedPackage(name, "module", typed, name === "reexport" ? typed : callX),
                "app.ts": `import { callX } from "${name}";\n${text}`,
              },
              "app.ts",
            ),
          ),
        300_000,
      );
    }
  }
});

const commonjsPackages = {
  assignments: `exports.x = function x(): string {\n  return "x of assignments";\n};\nexports.y = 2;\n`,
  literal: `function x(): string {\n  return "x of literal";\n}\nconst y = 2;\nmodule.exports = { x, y };\n`,
  function: `function x(): string {\n  return "x of function";\n}\nx.x = x;\nx.y = 2;\nmodule.exports = x;\n`,
  marked: `Object.defineProperty(exports, "__esModule", { value: true });\nexports.x = function x(): string {\n  return "x of marked";\n};\nexports.y = 2;\nexports.default = { x: exports.x, y: 4 };\n`,
  aliases: `const dep = require("dep");\nexports.x = dep.x;\nexports.y = dep.y;\n`,
  forwarded: `module.exports = require("dep");\n`,
  cycle: `exports.y = 2;\nconst other = require("./other.js");\nexports.x = function x(): string {\n  return "x of cycle " + other.seen;\n};\n`,
  receiver: `exports.x = function x(this: any): string {\n  return "x of receiver " + typeof this?.y;\n};\nexports.y = 2;\n`,
  main: `exports.x = function x(): string {\n  return "x of main " + (require.main === module) + " " + module.loaded;\n};\nexports.y = 2;\n`,
};

const usesOfPackage = {
  "destructured require": `const { x, y } = require(P);\nconsole.log(x(), y);\n`,
  "members of require": `const p = require(P);\nconsole.log(p.x(), p.y);\n`,
  "keys listed": `console.log(Object.keys(require(P)).join(), require(P).x());\n`,
  "assigned to": `const p = require(P);\np.y = 3;\nconsole.log(p.x(), p.y, require(P).y);\n`,
  "function replaced": `const p = require(P);\np.x = () => "replaced";\nconsole.log(p.x(), require(P).x());\n`,
  "named imports": `import { x, y } from P;\nconsole.log(x(), y);\n`,
  "default import": `import p from P;\nconsole.log(p.x(), p.y, Object.keys(p).join());\n`,
  "namespace import": `import * as p from P;\nconsole.log(p.x(), p.y, Object.keys(p).join());\n`,
  "dynamic import": `const p = await import(P);\nconsole.log(p.x(), p.y, Object.keys(p).join());\n`,
  "require in a function": `function load() {\n  return require(P);\n}\nconsole.log(load().x(), load().y);\n`,
  "passed to a function": `function show(p) {\n  console.log(p.x(), p.y);\n}\nshow(require(P));\n`,
};

describe.concurrent("a typed CommonJS package", () => {
  for (const [name, typed] of Object.entries(commonjsPackages)) {
    for (const [use, text] of Object.entries(usesOfPackage)) {
      test(
        `${name}: ${use}`,
        () =>
          slot(() =>
            expectSameOutput(
              {
                ...typedPackage(name, "commonjs", typed),
                [`node_modules/${name}/other.js`]: `exports.seen = Object.keys(require("${name}")).join();\n`,
                "app.js": text.replaceAll("P", JSON.stringify(name)),
              },
              "app.js",
            ),
          ),
        300_000,
      );
    }
  }
});

test(
  "an import of a typed package that fails at run time throws its own error",
  () =>
    slot(() =>
      expectSameOutput(
        {
          ...typedPackage(
            "absent",
            "module",
            `import { second } from "dep";\nexport const value: string = "x of " + second;\n`.replace(": string", ""),
          ),
          "node_modules/absent/index.aot.ts": `import { second } from "dep";\nexport const value: string = "x of " + second;\n`,
          "node_modules/dep/index.d.ts": `export declare const first: number;\nexport declare const second: number;\n`,
          "late.js": `import { first } from "dep";\nconsole.log(first);\n`,
          "app.js": `for (const load of [() => import("./late.js"), () => import("absent")]) {
  try {
    await load();
  } catch (error) {
    console.log("x of", String(error).replace(/ in module.*/, ""));
  }
}
`,
        },
        "app.js",
      ),
    ),
  300_000,
);
