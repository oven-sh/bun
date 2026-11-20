// Programs about which `bun check` and `tsc` once said something else, with what `tsc` 7.0.2 prints for them.
// `differential-cases.json` has the same programs, and there `tsc` itself is the oracle. That needs the `typescript7`
// package, and a debug build runs one in forty of them.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { endChildren, longLimit, spawn } from "../children";
import { env as withoutAgents } from "./differential";

afterAll(endChildren);

const env = {
  ...withoutAgents,
  GITHUB_WORKSPACE: undefined,
  // Of the script that runs the tests.
  npm_lifecycle_event: undefined,
  npm_package_json: undefined,
  BUN_INTERNAL_SCRIPTS_OF_COMMANDS: undefined,
  BUN_INTERNAL_CHECK_SCRIPTS: undefined,
};

// A debug build reads and checks the library in seconds: the smallest one, and unchecked.
const options = {
  strict: true,
  noEmit: true,
  types: [],
  lib: ["es5"],
  skipLibCheck: true,
  module: "esnext",
  moduleResolution: "bundler",
};
const tsconfig = (more: object = {}) => JSON.stringify({ compilerOptions: { ...options, ...more } });

/** What `bun check` prints for a project of `files`, by line, and its exit code. */
async function check(files: Record<string, string>, args: string[] = []) {
  using dir = tempDir("bun-check", files);
  const cwd = String(dir);
  await using proc = spawn({
    cmd: [bunExe(), "check", ...args],
    cwd,
    env,
    timeout: longLimit,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // A crash, an assertion or a sanitizer report: the test that asserts the exit code says nothing about why.
  if (exitCode !== 0 && exitCode !== 1)
    console.error(`bun check ${args.join(" ")} exited with ${exitCode}:\n${stderr}`);
  const lines = stdout.replaceAll("\\", "/").replaceAll(cwd.replaceAll("\\", "/"), "<dir>").trimEnd().split("\n");
  return { lines, exitCode };
}

// A debug build that was just linked is read from the disk by the first process, and starts twenty processes together
// too slowly for the five seconds that a test has by default. So a hook with the limit of a process starts the first
// one, and the tests start one at a time.
beforeAll(async () => {
  await check({ "tsconfig.json": tsconfig(), "a.ts": `export {};\n` });
}, longLimit);

describe("bun check", () => {
  // `getTypeReferenceType`: an alias that `resolveSymbol` does not follow, because it is also a value or has exports
  // beside it, takes no type arguments. For `export =`, TypeScript 6 follows the alias to the class, as TypeScript 7
  // does in a type reference (microsoft/typescript-go#4038): this is what the version that `bun check` follows prints.
  describe("an `import()` type that names an alias", () => {
    // webpack: lib/Compiler.js(142,15). The member of the mapped type is not checked.
    test("2315 for its type arguments: `module.exports =` next to a `@typedef`, also where the name does not resolve", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig({ module: "commonjs", moduleResolution: undefined, allowJs: true, checkJs: true }),
          "map.js": `/**
 * @template T
 * @typedef {T extends ReadonlyArray<infer E> ? E : never} Element
 */
/**
 * @template K
 * @template V
 */
class TupleMap {
  constructor() {
    /** @type {Array<[K, V]>} */
    this.inner = [];
  }
}
module.exports = TupleMap;
`,
          "missing.js": `/** @typedef {number} Num */\nmodule.exports = Missing;\n`,
          "use.js": `/** @typedef {import("./map")<string, number>} Cache */
/** @typedef {import("./map")} Plain */
/** @typedef {import("./missing")<string>} Unresolved */
/** @typedef {{ [K in "a"]: 1; map: import("./map")<string, number>; none: import("./missing")<string> }} Unchecked */
/** @type {Cache | Plain | Unresolved | Unchecked | undefined} */
let cache;
module.exports = { cache };
`,
        }),
      ).toEqual({
        lines: [
          "missing.js(2,18): error TS2304: Cannot find name 'Missing'.",
          "use.js(1,15): error TS2315: Type 'export=' is not generic.",
          "use.js(3,15): error TS2315: Type 'export=' is not generic.",
          "use.js(4,32): error TS7061: A mapped type may not declare properties or methods.",
        ],
        exitCode: 1,
      });
    });

    test("2315 for its type arguments: an import that is merged with a value, and `export =` next to an exported type", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(),
          "box.ts": `export interface Box<T> { value: T }\n`,
          "m.ts": `import type { Box } from "./box";\nconst Box = 1;\nexport { Box };\n`,
          "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "types": "index.d.ts" }\n`,
          "node_modules/pkg/index.d.ts": `export = TupleMap;
export type Element<T> = T extends ReadonlyArray<infer E> ? E : never;
declare class TupleMap<K, V> {
    inner: Array<[K, V]>;
    constructor();
}
`,
          "use.ts": `type A = import("./m").Box<string>;
type B = import("./m").Box;
type Cache = import("pkg")<string, number>;
type Plain = import("pkg");
type El = import("pkg").Element<string[]>;
declare const a: A, b: B, cache: Cache | Plain, el: El;
const s: number = el;
export { a, b, cache, s };
type Unchecked = { [K in "a"]: 1; box: import("./m").Box<string>; map: import("pkg")<string, number> };
`,
        }),
      ).toEqual({
        lines: [
          "use.ts(1,10): error TS2315: Type 'Box' is not generic.",
          "use.ts(3,14): error TS2315: Type 'TupleMap' is not generic.",
          "use.ts(7,7): error TS2322: Type 'string' is not assignable to type 'number'.",
          "use.ts(9,35): error TS7061: A mapped type may not declare properties or methods.",
        ],
        exitCode: 1,
      });
    });

    // `tryGetDeclaredTypeOfSymbol`: the type is that of what the last alias names.
    test("its type through two aliases that are also values", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(),
          "box.ts": `export interface Box<T> { value: T }\n`,
          "m.ts": `import type { Box } from "./box";\nconst Box = 1;\nexport { Box };\n`,
          "ns.ts": `import type { Box } from "./m";\nnamespace Box { export type Key = string }\nexport { Box };\n`,
          "use.ts": `declare const b: import("./ns").Box;\nconst n: number = b;\nexport { n };\n`,
        }),
      ).toEqual({
        lines: ["use.ts(2,7): error TS2322: Type 'Box<T>' is not assignable to type 'number'."],
        exitCode: 1,
      });
    });

    // Not a type that is only unresolved: `never` would take that.
    test("the error type for an alias that names nothing", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(),
          "box.ts": `export interface Box<T> { value: T }\n`,
          "m.ts": `import type { Gone } from "./box";\nconst Gone = 1;\nexport { Gone };\n`,
          "use.ts": `declare const b: import("./m").Gone;\nconst n: never = b;\nexport { n };\n`,
        }),
      ).toEqual({
        lines: [
          `m.ts(1,15): error TS2305: Module '"./box"' has no exported member 'Gone'.`,
          "use.ts(2,7): error TS2322: Type 'any' is not assignable to type 'never'.",
        ],
        exitCode: 1,
      });
    });

    // The declared type is asked for before the type arguments are counted: that finds the circle.
    test("2456, and 2315 for its type arguments, inside the type alias that it names", async () => {
      const merged = (name: string) =>
        `import type { ${name} } from "./box";\nconst ${name} = 1;\nexport { ${name} };\n`;
      expect(
        await check({
          "tsconfig.json": tsconfig(),
          "box.ts": `export type AliasBox<T> = T | import("./m_alias").AliasBox<T>;
export type Plain = number | import("./m_plain").Plain;
export type Deep<T> = { value: T; next: import("./m_deep").Deep<T> };
`,
          "m_alias.ts": merged("AliasBox"),
          "m_deep.ts": merged("Deep"),
          "m_plain.ts": merged("Plain"),
          "use.ts": `import type { AliasBox, Plain, Deep } from "./box";\ndeclare const a: AliasBox<string>, p: Plain, d: Deep<string>;\nexport const all = [a, p, d.next];\n`,
        }),
      ).toEqual({
        lines: [
          "box.ts(1,13): error TS2456: Type alias 'AliasBox' circularly references itself.",
          "box.ts(1,31): error TS2315: Type 'AliasBox' is not generic.",
          "box.ts(2,13): error TS2456: Type alias 'Plain' circularly references itself.",
          "box.ts(3,41): error TS2315: Type 'Deep' is not generic.",
          "use.ts(2,18): error TS2315: Type 'AliasBox' is not generic.",
        ],
        exitCode: 1,
      });
    });
  });
});
