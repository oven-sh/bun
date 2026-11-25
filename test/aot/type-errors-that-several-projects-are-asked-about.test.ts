import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const config = (options: object) =>
  JSON.stringify({
    compilerOptions: {
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      typeRoots: [join(import.meta.dir, "..", "..", "packages")],
      types: ["bun-types"],
      noEmit: true,
      ...options,
    },
    include: ["src"],
  });
const testFile = (name: string, text: string) => `import { expect, test } from "bun:test";
import { area, find, type Shape } from "../../core/src/core";
${text}
test("${name}", () => {
  const shape: Shape = { width: 2, height: 3 };
  expect(area(shape)).toBe(6);
});
`;
const errors = (said: string) =>
  [...said.matchAll(/^(?:error|warn): (TS\d+):(?:.*\n)+?\s+at (\S+):(\d+):\d+$/gm)]
    .map(match => `${match[2].replaceAll("\\", "/").replace(/^.*\/(?=packages\/)/, "")}:${match[3]} ${match[1]}`)
    .sort();

test("each package of a workspace is asked about its own type errors", async () => {
  using dir = tempDir("type-errors-that-several-projects-are-asked-about", {
    "package.json": JSON.stringify({ name: "workspace", workspaces: ["packages/*"] }),
    "packages/core/package.json": JSON.stringify({ name: "core", version: "1.0.0" }),
    "packages/core/tsconfig.json": config({ strict: true, exactOptionalPropertyTypes: true }),
    "packages/core/src/core.ts": `export interface Shape {\n  width: number;\n  height: number;\n  note?: string;\n}\nexport const area = (shape: Shape) => shape.width * shape.height;\nexport function find(shapes: Shape[], width: number) {\n  return shapes.find(it => it.width === width);\n}\nexport const count: string = area({ width: 1, height: 1 });\n`,
    "packages/strict/package.json": JSON.stringify({ name: "strict", version: "1.0.0" }),
    "packages/strict/tsconfig.json": config({ strict: true, exactOptionalPropertyTypes: true }),
    "packages/strict/src/strict.test.ts": testFile(
      "strict",
      `export const first: Shape = find([], 1);\nexport const noted: Shape = { width: 1, height: 1, note: undefined };\nexport const wrong: number = "strict";`,
    ),
    "packages/views/package.json": JSON.stringify({ name: "views", version: "1.0.0" }),
    "packages/views/tsconfig.json": config({ strict: true, exactOptionalPropertyTypes: true, jsx: "react-jsx" }),
    "packages/views/src/views.test.ts": testFile(
      "views",
      `export const first: Shape = find([], 1);\nexport const noted: Shape = { width: 1, height: 1, note: undefined };\nexport const wrong: number = "views";`,
    ),
    "packages/members/src/globals.d.ts": `declare const flavor: string;\n`,
    "packages/members/package.json": JSON.stringify({ name: "members", version: "1.0.0" }),
    "packages/members/tsconfig.json": config({
      strict: true,
      exactOptionalPropertyTypes: true,
      experimentalDecorators: true,
    }),
    "packages/members/src/members.test.ts": testFile(
      "members",
      `const shapes: Shape[] = [];\nexport const first: number = typeof flavor === "string" ? flavor : 0;\nexport const noted: Shape = { width: 1, height: 1, note: undefined };\nexport const wrong: number = "members";`,
    ),
  });
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), "test", "--aot", "."], String(dir));
  expect(errors(stdout + stderr)).toEqual([
    "packages/core/src/core.ts:10 TS2322",
    "packages/members/src/members.test.ts:4 TS2322",
    "packages/members/src/members.test.ts:5 TS2375",
    "packages/members/src/members.test.ts:6 TS2322",
    "packages/strict/src/strict.test.ts:3 TS2322",
    "packages/strict/src/strict.test.ts:4 TS2375",
    "packages/strict/src/strict.test.ts:5 TS2322",
    "packages/views/src/views.test.ts:3 TS2322",
    "packages/views/src/views.test.ts:4 TS2375",
    "packages/views/src/views.test.ts:5 TS2322",
  ]);
  expect(exitCode).toBe(0);
}, 60_000);
