import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noImplicitAny: false,
    allowJs: true,
    checkJs: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
  },
});

function sources(depth: number) {
  const nested = (innermost: string) => `${"{ a: ".repeat(depth)}${innermost}${" }".repeat(depth)}`;
  const nestedInLists = (innermost: string) => `${"[{ a: ".repeat(depth)}${innermost}${" }]".repeat(depth)}`;
  const innermostOf = (outermost: string) => `${outermost}${".a".repeat(depth)}`;
  const innermostInListsOf = (outermost: string) => `${outermost}${"[0].a".repeat(depth)}`;
  return {
    "tsconfig.json": tsconfig,
    "typed.ts": `
declare function keep<const T>(value: T): T;
declare function same<T>(value: T): T;
declare function innermost<const T>(value: ${nested("T")}): T;
interface Level { a: Level | ((text: string) => number) }

const plain = ${nested(`[1, "x"]`)};
const ofPlain: never = ${innermostOf("plain")};

const constant = ${nested(`[1, "x"]`)} as const;
const ofConstant: never = ${innermostOf("constant")};

const constantInLists = ${nestedInLists(`[1, \`\${"x"}\`]`)} as const;
const ofConstantInLists: never = ${innermostInListsOf("constantInLists")};

const spread = ${nested(`[...[1, "x"]]`)} as const;
const ofSpread: never = ${innermostOf("spread")};

const ofKept: never = ${innermostOf(`keep(${nested(`[1, "x"]`)})`)};
const ofSame: never = ${innermostOf(`same(${nested(`[1, "x"]`)})`)};
const ofInnermost: never = innermost(${nested(`[1, "x"]`)});
const ofKeptInSame: never = ${innermostOf(`same(${nested(`keep([1, "x"])`)})`)};
const ofKeptBesideOthers: never = ${innermostOf(`keep(${nested(`[1, same({ b: ["y"] })]`)})`)};

const declared: Level = ${nested("text => text.length")};
const declaredWrongly: Level = ${nested("text => text.size")};

const ${nested("[first, second]")} = ${nested(`[1, "x"]`)};
const ofFirst: never = first;
const ofSecond: never = second;

const ${nested("{ absent = 1 }")} = ${nested("{}")};
const ofAbsent: never = absent;

let count: number, text: string, chosen: number;
(${nested("[count, text]")} = ${nested(`[1, "x"]`)});
(${nested("[text, count]")} = ${nested(`[1, "x"]`)});
(${nested("{ chosen = 1 }")} = ${nested("{}")});
(${nested("{ chosen }")} = ${nested("{}")});
for (${nested("count")} of [${nested(`"x"`)}]);
export {};
`,
    "untyped.js": `
/** @template T @param {T} value @returns {T} */
function same(value) { return value; }

const alone = ${nested("{}")};
${innermostOf("alone")}.absent;
/** @type {never} */
const ofAlone = ${innermostOf("alone")};

${innermostOf(`same(${nested("{}")})`)}.absent;

/** @type {${nested("{}")}} */
const declared = ${nested("{}")};
${innermostOf("declared")}.absent;
export {};
`,
  };
}

async function messages(depth: number) {
  using dir = tempDir("check-literals-nested-in-one-another", sources(depth));
  const { stdout, exitCode } = await run([bunExe(), "check"], String(dir));
  const errors = stdout
    .split("\n")
    .filter(line => line.includes("error TS"))
    .map(line => line.replace(/\(\d+,\d+\)/, ""));
  return { errors, exitCode };
}

test("literals nested 100 deep are what they are nested 2 deep", async () => {
  const [shallow, deep] = await Promise.all([messages(2), messages(100)]);
  expect(shallow.exitCode).toBe(1);
  expect(shallow.errors).toMatchInlineSnapshot(`
    [
      "typed.ts: error TS2322: Type '(string | number)[]' is not assignable to type 'never'.",
      "typed.ts: error TS2322: Type 'readonly [1, "x"]' is not assignable to type 'never'.",
      "typed.ts: error TS2322: Type 'readonly [1, "x"]' is not assignable to type 'never'.",
      "typed.ts: error TS2322: Type 'readonly [1, "x"]' is not assignable to type 'never'.",
      "typed.ts: error TS2322: Type 'readonly [1, "x"]' is not assignable to type 'never'.",
      "typed.ts: error TS2322: Type '(string | number)[]' is not assignable to type 'never'.",
      "typed.ts: error TS2322: Type '[1, "x"]' is not assignable to type 'never'.",
      "typed.ts: error TS2322: Type 'readonly [1, "x"]' is not assignable to type 'never'.",
      "typed.ts: error TS2322: Type 'readonly [1, { b: string[]; }]' is not assignable to type 'never'.",
      "typed.ts: error TS2339: Property 'size' does not exist on type 'string'.",
      "typed.ts: error TS2322: Type 'number' is not assignable to type 'never'.",
      "typed.ts: error TS2322: Type 'string' is not assignable to type 'never'.",
      "typed.ts: error TS2322: Type '1' is not assignable to type 'never'.",
      "typed.ts: error TS2322: Type 'number' is not assignable to type 'string'.",
      "typed.ts: error TS2322: Type 'string' is not assignable to type 'number'.",
      "typed.ts: error TS2339: Property 'chosen' does not exist on type '{}'.",
      "typed.ts: error TS2322: Type 'string' is not assignable to type 'number'.",
      "untyped.js: error TS2322: Type '{}' is not assignable to type 'never'.",
      "untyped.js: error TS2339: Property 'absent' does not exist on type '{}'.",
    ]
  `);
  expect(deep).toEqual(shallow);
});
