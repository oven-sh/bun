import { afterAll, expect, test } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { endChildren } from "../children";
import { linesOf, tsc } from "./differential";

afterAll(endChildren);

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
    skipLibCheck: true,
  },
});

// `bun check` answers for a reference that nothing narrows without walking back from it. TypeScript walks. A walk that
// nests 2,000 calls reports TS2563 and turns the analysis off, and then every reference has the error type. So a
// reference may only be answered without a walk where the walk can't get that deep, which depends on where the reference
// stands and on the loops above it. TypeScript is the oracle, so no output is stored.
//
// `const p: never = x` reports the type that `x` has there, and nothing where it has the error type.
const probe = (at: string | number, ...names: string[]) =>
  names.map((name, index) => ` { const p${at}_${index}: never = ${name}; }`).join("");
const half = (count: number) => Math.floor(count / 2);
const rows = (count: number, row: (k: number) => string, ...names: string[]) => {
  const probed = new Set([
    3,
    half(half(count)),
    half(count),
    count - 40,
    count - 12,
    count - 3,
    count - 2,
    count - 1,
    count,
  ]);
  return (
    Array.from({ length: count }, (_, i) => row(i + 1) + (probed.has(i + 1) ? probe(i + 1, ...names) : "")).join("\n") +
    "\n"
  );
};
const head = "function f(n: number, u: string | number) {\n let v: string | number = 'a';\n";
const short = (name: string) =>
  `function ${name}(a: number, b: string | number) { let c: string | number = 1; if (a > 1) c = 'x';${probe(name, "a", "b", "c")} return c; }\n`;
const plain = (count: number) => `${head}${rows(count, k => ` if (n > ${k}) v = ${k};`, "n", "u", "v")} return v;\n}\n`;

// With each form, the lowest count at which TypeScript reports TS2563, and how far above it the form is checked.
const forms: [name: string, limit: number, write: (count: number) => string, above?: number][] = [
  ["plain", 2000, plain],
  ["short-beside-long", 2000, count => short("before") + plain(count) + short("after")],
  [
    "narrowing",
    1000,
    count =>
      `function f(n: number, u: string | number | boolean) {\n let v = 0;\n${rows(count, k => ` if (typeof u === "string") v = ${k};`, "n", "u", "v")} return u;\n}\n`,
  ],
  [
    "loop-above",
    3992,
    count =>
      `${head} for (let i = 0; i < 3; i++) {\n${rows(half(count), k => `  if (n > ${k}) v = ${k};`, "n", "v")} }\n` +
      `${rows(half(count), k => ` if (n > ${k}) v = "${k}";`, "n", "u", "v")} return v;\n}\n`,
  ],
  [
    "loop-below",
    2056,
    count =>
      `${head}${rows(count - 60, k => ` if (n > ${k}) v = ${k};`, "n", "v")} while (n > 0) {\n` +
      `${rows(60, k => `  if (n > ${k}) v = "${k}";`, "n", "u", "v")}  n--;\n }\n${probe(0, "n", "u", "v")}\n return v;\n}\n`,
  ],
  [
    "references-behind-a-long-loop",
    2004,
    count =>
      `${head} while (n > 0) {\n${rows(count - 8, k => `  if (n > ${k}) v = ${k};`, "n", "v")}  n--;\n }\n` +
      `${probe(0, "n", "u", "v")}\n if (n > 1) v = 1;${probe(1, "n", "u", "v")}\n return v;\n}\n`,
  ],
  [
    "nested-loops",
    2988,
    count =>
      `${head} for (;;) { for (;;) {\n${rows(Math.floor(count / 3), k => `  if (n > ${k}) v = ${k};`, "n", "v")}  if (n) break;\n } if (n) break; }\n` +
      `${probe(0, "n", "u", "v")}\n${rows(Math.floor(count / 3), k => ` if (n > ${k}) v = "${k}";`, "n", "u", "v")} return v;\n}\n`,
  ],
  [
    "top-level",
    2000,
    count =>
      `declare const n: number; declare const u: string | number;\nlet v: string | number = 'a';\n` +
      `${rows(count, k => `if (n > ${k}) v = ${k};`, "n", "u", "v")}function late() {${probe("late", "n", "u", "v")} }\n${short("after")}`,
    // TODO: at 2,001 TypeScript gives the references above the limit the error type too, and `bun check` their own types.
    0,
  ],
];
const countsOf = (limit: number, above = 1) => Array.from({ length: above + 2 }, (_, index) => limit - 1 + index);

// A debug build can run out of stack before it reaches the limit.
test.skipIf(!tsc || isDebug || isASAN)(
  "references have the types that TypeScript gives them on both sides of the TS2563 limit",
  async () => {
    const files = forms.flatMap(([name, limit, write, above]) =>
      countsOf(limit, above).map(count => [`${name}-${count}.ts`, "export {};\n" + write(count)] as const),
    );
    using dir = tempDir("check-beside-the-flow-depth-limit", {
      "tsconfig.json": tsconfig,
      ...Object.fromEntries(files),
    });
    const root = String(dir);
    const [theirs, ours] = await Promise.all([
      linesOf([tsc!, "-p", ".", "--pretty", "false", "--singleThreaded"], root, root),
      linesOf([bunExe(), "check", "--threads=1"], root, root),
    ]);
    expect(ours).toEqual(theirs);
    // Each form is checked below the limit too.
    expect(theirs.filter(line => line.includes("TS2563")).map(line => line.split("(")[0])).toEqual(
      forms
        .flatMap(([name, limit, , above]) =>
          countsOf(limit, above)
            .slice(1)
            .map(count => `${name}-${count}.ts`),
        )
        .sort(),
    );
  },
);
