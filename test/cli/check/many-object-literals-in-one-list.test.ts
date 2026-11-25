// The type of a list of object literals is a union without subtypes. TypeScript holds each literal against each other one, counts the pairs, and calls the union too
// complex to represent where it expects more than a million of them. The checker holds a literal only against the literals that require no name that it lacks. It
// counts all the pairs that TypeScript counts, so the error comes at the same number of literals, and it removes the same literals.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "../../aot/harness/run";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noErrorTruncation: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    types: [],
  },
});

const list = (size: number, literal: (index: number) => string) =>
  `const list = [\n${Array.from({ length: size }, (_, index) => `  ${literal(index)},\n`).join("")}];\n`;

async function errorsOf(source: string) {
  using dir = tempDir("check-many-object-literals", { "tsconfig.json": tsconfig, "list.ts": source });
  const { stdout, stderr } = await run([bunExe(), "check"], String(dir), bunEnv);
  return (stdout + stderr).split("\n").filter(line => /error TS|^error:/.test(line));
}

const tooComplex = "list.ts(1,14): error TS2590: Expression produces a union type that is too complex to represent.";

test.concurrent.each([
  ["a name of its own in each", 1001, (index: number) => `{ n${index}: ${index}, shared: ${index} }`],
  ["two of each shape, of which one goes", 1020, (index: number) => `{ n${index >> 1}: ${index} }`],
  [
    "a class instance at every 25th place",
    1001,
    (index: number) => (index % 25 ? `{ n${index}: ${index}, shared: ${index} }` : `new (class { c${index} = 1 })()`),
  ],
] as const)("the union is too complex from the same size on: %s", async (_, most, literal) => {
  expect({ most: await errorsOf(list(most, literal)), oneMore: await errorsOf(list(most + 1, literal)) }).toEqual({
    most: [],
    oneMore: [tooComplex],
  });
});

test("the same literals go", async () => {
  const source =
    list(
      12,
      index =>
        [
          `{ a: ${index} }`,
          `{ a: ${index}, b: "b" }`,
          `{ own${index}: 1 }`,
          `{ toString() { return "t"; } }`,
          `{}`,
          `{ a: "text", own${index}: 1 }`,
        ][index % 6],
    ) + "const shown: never = list;\n";
  // One of each two of one shape is left, and `{}` is gone.
  const left = [
    "{ a: number; b?: undefined; own2?: undefined; toString?: undefined; own5?: undefined; own8?: undefined; own11?: undefined; }",
    "{ a: number; b: string; own2?: undefined; toString?: undefined; own5?: undefined; own8?: undefined; own11?: undefined; }",
    "{ b?: undefined; own2: number; toString?: undefined; own5?: undefined; own8?: undefined; a?: undefined; own11?: undefined; }",
    "{ b?: undefined; own2?: undefined; toString(): string; own5?: undefined; own8?: undefined; a?: undefined; own11?: undefined; }",
    "{ b?: undefined; own2?: undefined; toString?: undefined; a: string; own5: number; own8?: undefined; own11?: undefined; }",
    "{ b?: undefined; own2?: undefined; toString?: undefined; own5?: undefined; own8: number; a?: undefined; own11?: undefined; }",
    "{ b?: undefined; own2?: undefined; toString?: undefined; own5?: undefined; own8?: undefined; a: string; own11: number; }",
  ];
  expect(await errorsOf(source)).toEqual([
    `list.ts(15,7): error TS2322: Type '(${left.join(" | ")})[]' is not assignable to type 'never'.`,
  ]);
});
