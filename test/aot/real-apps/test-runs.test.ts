import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "../harness/run";
import { test } from "../supported";

const options = {
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  noEmit: true,
  types: [] as string[],
};
const config = (more: object, rest: object = {}) =>
  JSON.stringify({ compilerOptions: { ...options, ...more }, ...rest });
const passing = (name: string, imports = "", body = "expect(1).toBe(1);") =>
  `import { expect, test } from "bun:test";\n${imports}\ntest(${JSON.stringify(name)}, () => { ${body} });\n`;

async function passed(dir: string, ...args: string[]) {
  const { stdout, stderr } = await run([bunExe(), "test", "--aot", ...args], dir);
  return [...(stdout + stderr).matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
}

test("a refused test file does not take a global declaration away from the others", async () => {
  using dir = tempDir("aot-real-apps-test-runs", {
    "tsconfig.json": config({ strict: true }),
    "augment.ts": `export {};\ndeclare global { var added: number | undefined; }\n`,
    "1-broken.test.ts": passing("never run", `import "./augment";\nconst n: number = "text";`, "expect(n).toBe(1);"),
    "2-uses.test.ts": passing("uses the global", "", `expect(typeof added).toBe("undefined");`),
    "3-fine.test.ts": passing("fine"),
  });
  expect(await passed(String(dir))).toEqual(["fine", "uses the global"]);
});

const monorepo = (integration: string) => ({
  "package.json": JSON.stringify({ name: "monorepo", workspaces: ["packages/*"] }),
  "tsconfig.json": config({ strict: true, strictPropertyInitialization: false }),
  "packages/lib/package.json": JSON.stringify({ name: "lib", version: "1.0.0", main: "index.ts" }),
  "packages/lib/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.json" }),
  "packages/lib/index.ts": `export class Box {\n  value: number;\n  set(value: number) { this.value = value; return this; }\n}\n`,
  "packages/lib/test/tsconfig.json": JSON.stringify({ extends: "../../../tsconfig.json" }),
  "packages/lib/test/lib.test.ts": passing(
    "unit",
    `import { Box } from "..";`,
    "expect(new Box().set(1).value).toBe(1);",
  ),
  [`${integration}/a/tsconfig.json`]: config({}, { include: ["test/**/*"] }),
  [`${integration}/a/test/a.test.ts`]: passing(
    "integration",
    `import { Box } from "../../../packages/lib/index";`,
    "expect(new Box().set(1).value).toBe(1);",
  ),
});

test("the name of a folder does not decide which tests run", async () => {
  using first = tempDir("aot-real-apps-test-runs", monorepo("integration"));
  using last = tempDir("aot-real-apps-test-runs", monorepo("zz-integration"));
  expect(await passed(String(first))).toEqual(await passed(String(last)));
});

test("a test file is treated alike alone and beside a file of another tsconfig.json", async () => {
  using dir = tempDir("aot-real-apps-test-runs", {
    "a/tsconfig.json": config({ strict: true }),
    "a/a.test.ts": passing("a"),
    "b/tsconfig.json": config({ strict: true }),
    "b/b.test.ts": passing("b", `const n: number = "text";`, `expect(n as unknown).toBe("text");`),
  });
  const together = await passed(String(dir));
  expect(together.filter(name => name === "b")).toEqual(await passed(String(dir), "./b/b.test.ts"));
});

const augmented = (augmentation: string) => ({
  "tsconfig.json": config({ strict: true, allowImportingTsExtensions: true }, { include: ["src", "test"] }),
  "src/types.ts": `export interface Rules { known?: number }\nexport function count(rules: Rules): number { return Object.keys(rules).length; }\n`,
  [augmentation]: `export {};\ndeclare module "../src/types.ts" {\n  interface Rules { custom?: unknown }\n}\n`,
  "test/one.test.ts": passing(
    "one",
    `import { count, type Rules } from "../src/types.ts";\nconst rules: Rules = { custom: 1 };`,
    "expect(count(rules)).toBe(1);",
  ),
});

test("a module augmentation in a declaration file that only the tsconfig includes is applied", async () => {
  using dir = tempDir("aot-real-apps-test-runs", augmented("test/_augment.d.ts"));
  expect(await passed(String(dir))).toEqual(["one"]);
});

test("and so is one in a TypeScript file that only the tsconfig includes", async () => {
  using dir = tempDir("aot-real-apps-test-runs", augmented("test/_augment.ts"));
  expect(await passed(String(dir))).toEqual(["one"]);
});
