import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { endChildren, spawn } from "../children";
import { collect, concatenate } from "./bundle.ts";

afterAll(endChildren);

// The tests of Prettier and of oxfmt, and inputs of our own, run on `bun fmt`. See the README.md of prettier, oxfmt and own.
// `src/format/conformance` runs them: it says what is checked, and what is left out and why.
//
// `<suite>/expected.txt` is what the runner printed when it was last written: the checks that fail, one per line, the totals, and what is
// not run and why.

// The runner is compiled into debug and canary builds only.
const hasRunner = isDebug || Bun.spawnSync({ cmd: [bunExe(), "--revision"], env: bunEnv }).stdout.includes("canary");

// A debug build is 10 to 100 times slower, so it runs a sample. It is always the same sample.
const every = isDebug || isASAN ? 20 : 1;

/** `own/cases`, in the form of oxfmt's tests. An input has `.input` after its name, so that nothing else takes it for code. */
function ownCases() {
  const found = new Map<string, Uint8Array>();
  collect(join(import.meta.dir, "own"), "cases", found, name => name.endsWith(".todo"));
  return concatenate(new Map([...found].map(([name, bytes]) => [name.replace(/\.input$/, ""), bytes])));
}

test.skipIf(!hasRunner).concurrent.each([
  ["prettier", "prettier", every],
  ["oxfmt", "oxfmt", every],
  ["own", "oxfmt", 1],
])(
  "%s",
  async (suite, runner, every) => {
    using dir = tempDir(`format-${suite}`, {});
    const bundle = join(String(dir), "bundle.txt");
    await Bun.write(
      bundle,
      suite === "own"
        ? ownCases()
        : Bun.zstdDecompressSync(await Bun.file(join(import.meta.dir, suite, "bundle.zst")).bytes()),
    );
    await using proc = spawn({
      timeout: 4 * 60_000,
      cmd: [bunExe(), "fmt", `--run-${runner}-tests`, bundle, `--every=${every}`],
      // Not in this repository, which has a `fmt` script.
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    // Of our own inputs none fails.
    const expected = suite === "own" ? "" : await Bun.file(join(import.meta.dir, suite, "expected.txt")).text();

    // Nothing fails that is not known to. What is known to fail and passes by now is no reason to be red: the list is written
    // again from time to time, not with every fix.
    const known = new Set(expected.split("\n"));
    const lines = stdout.split("\n");
    expect(lines.filter(line => line.startsWith("FAIL ") && !known.has(line))).toEqual([]);
    // Nothing more is left out than is said.
    const isNotRun = (line: string) => line.startsWith("not run: ");
    expect(lines.filter(isNotRun)).toEqual(expected.split("\n").filter(isNotRun));
    // And something has run.
    expect(stdout).toMatch(/^(?:format|as Prettier prints them): [1-9]/m);
    expect(exitCode).toBe(0);
  },
  5 * 60_000,
);

// `own/comment-owners.txt` has the node that Prettier attaches each comment of our own inputs to. `own/comment-owners.ts` writes it.
test.skipIf(!hasRunner)("comments are attached to the nodes that Prettier attaches them to", async () => {
  type Owner = { placement: string; type: string; start: number; end: number; rest: string };
  const parse = (fields: string[]): [number, Owner] => {
    const [commentStart, , placement, type, start, end, ...rest] = fields;
    return [Number(commentStart), { placement, type, start: Number(start), end: Number(end), rest: rest.join(" ") }];
  };
  const expected = new Map<string, Map<number, Owner>>();
  for (const line of (await Bun.file(join(import.meta.dir, "own/comment-owners.txt")).text()).split("\n")) {
    if (/^\d/.test(line)) [...expected.values()].at(-1)!.set(...parse(line.split(" ")));
    else if (line) expected.set(line, new Map());
  }

  const inputs = new Map<string, Buffer>();
  for (const name of expected.keys()) {
    inputs.set(name, Buffer.from(await Bun.file(join(import.meta.dir, "own/cases", `${name}.input`)).bytes()));
  }
  using dir = tempDir("comment-owners", Object.fromEntries(inputs));
  await using proc = spawn({
    cmd: [bunExe(), "fmt", "--debug-comments", "owners", ...inputs.keys()],
    cwd: String(dir),
    env: bunEnv,
    stdout: "inherit",
    stderr: "inherit",
  });
  expect(await proc.exited).toBe(0);

  // `bun fmt` gives a name no width, and a statement its `;`.
  const isSameOwner = (theirs: Owner, ours: Owner, text: Buffer) => {
    if (theirs.placement !== ours.placement || theirs.start !== ours.start || theirs.rest !== ours.rest) return false;
    if (theirs.end === ours.end || ours.type === "Name") return true;
    if (theirs.type !== ours.type) return false;
    const between = text.subarray(theirs.end, ours.end).toString();
    return between.replace(/\/\*.*?\*\/|\/\/[^\n]*/gs, "").trim() === ";";
  };
  const describe = (owner?: Owner) => (owner ? `${owner.placement} ${owner.type} ${owner.start}` : "none");
  const differences: string[] = [];
  for (const [name, comments] of expected) {
    const printed = await Bun.file(join(String(dir), "owners", `${name}.txt`)).text();
    const lines = printed.split("\n").filter(line => line.startsWith("C "));
    const ours = new Map(lines.map(line => parse(line.split(" ").slice(1))));
    for (const [start, owner] of comments) {
      if (!ours.has(start) || !isSameOwner(owner, ours.get(start)!, inputs.get(name)!)) {
        differences.push(`${name}:${start} Prettier: ${describe(owner)}, bun: ${describe(ours.get(start))}`);
      }
    }
  }
  expect(differences).toEqual(knownDifferences);
});

const knownDifferences = [
  // Prettier turns `a && (b && c)` into `(a && b) && c` before it attaches comments.
  "comments/before-the-parentheses-of-a-nested-chain.js:33 Prettier: T LogicalExpression 6, bun: T BinaryExpression 25",
  "comments/before-the-parentheses-of-a-nested-chain.js:50 Prettier: T BinaryExpression 42, bun: T LogicalExpression 25",
  "comments/before-the-parentheses-of-a-nested-chain.js:83 Prettier: T Identifier 81, bun: T LogicalExpression 76",
  "comments/before-the-parentheses-of-a-nested-chain.js:114 Prettier: T Identifier 112, bun: T LogicalExpression 107",
  "comments/before-the-parentheses-of-a-nested-chain.js:139 Prettier: T Identifier 137, bun: T LogicalExpression 132",
  // The `1` of the type `-1` is no node here.
  "comments/behind-a-negative-number-that-is-a-type.ts:71 Prettier: L Literal 79, bun: D TSLiteralType 69",
  // `a!!` is one node here. It prints the comment after the `!` that it comes after.
  "comments/between-three-non-null-marks.ts:7 Prettier: T TSNonNullExpression 4, bun: D TSNonNullExpression 4",
  "comments/between-three-non-null-marks.ts:25 Prettier: T TSNonNullExpression 4, bun: D TSNonNullExpression 4",
  "comments/between-three-non-null-marks.ts:53 Prettier: T TSNonNullExpression 49, bun: D TSNonNullExpression 49",
  "comments/between-three-non-null-marks.ts:80 Prettier: T TSNonNullExpression 77, bun: D TSNonNullExpression 77",
  "comments/between-three-non-null-marks.ts:98 Prettier: T TSNonNullExpression 77, bun: D TSNonNullExpression 77",
  "comments/between-three-non-null-marks.ts:116 Prettier: T TSNonNullExpression 77, bun: D TSNonNullExpression 77",
  "comments/between-two-non-null-marks.ts:7 Prettier: T TSNonNullExpression 4, bun: D TSNonNullExpression 4",
  "comments/between-two-non-null-marks.ts:25 Prettier: T TSNonNullExpression 22, bun: D TSNonNullExpression 22",
  "comments/between-two-non-null-marks.ts:33 Prettier: T TSNonNullExpression 22, bun: D TSNonNullExpression 22",
  "comments/between-two-non-null-marks.ts:51 Prettier: T TSNonNullExpression 48, bun: D TSNonNullExpression 48",
  "comments/between-two-non-null-marks.ts:71 Prettier: T TSNonNullExpression 68, bun: D TSNonNullExpression 68",
  "comments/between-two-non-null-marks.ts:109 Prettier: T TSNonNullExpression 98, bun: D TSNonNullExpression 98",
  // An `Identifier` includes its type annotation in ESTree.
  "ignore/comment-after-the-type-of-a-variable.ts:23 Prettier: T Identifier 4, bun: T BindingIdentifier 4",
  "ignore/comment-after-the-type-of-a-variable.ts:67 Prettier: T Identifier 54, bun: T BindingIdentifier 54",
  "ignore/comment-after-the-type-of-a-variable.ts:108 Prettier: T Identifier 98, bun: T BindingIdentifier 98",
  "ignore/comment-that-trails-on-its-own-line.ts:432 Prettier: T Identifier 418, bun: T BindingIdentifier 418",
  // The `<>` and the `</>` of a fragment are no nodes here. The fragment owns their comments.
  "ignore/ignore-comment-in-the-tag-of-a-fragment.jsx:12 Prettier: D JSXOpeningFragment 10, bun: D JSXFragment 10",
  "ignore/ignore-comment-in-the-tag-of-a-fragment.jsx:70 Prettier: D JSXClosingFragment 67, bun: D JSXFragment 58",
  "ignore/ignore-comment-in-the-tag-of-a-fragment.jsx:108 Prettier: D JSXOpeningFragment 106, bun: D JSXFragment 106",
  // The `a:b` of an attribute is no node here. What trails it trails the `b`.
  "jsx/comments-next-to-the-colon-of-a-namespaced-name.jsx:249 Prettier: T JSXNamespacedName 245, bun: T Name 247",
  // The `{ with: { .. } }` of an import type, its property and the `with` are no nodes here. The module specifier and the inner
  // object own their comments.
  "types/comments-in-the-options-of-an-import-type.ts:63 Prettier: T ObjectExpression 21, bun: T ObjectExpression 29",
  "types/comments-in-the-options-of-an-import-type.ts:137 Prettier: T Property 99, bun: T ObjectExpression 105",
  "types/comments-in-the-options-of-an-import-type.ts:432 Prettier: T Property 394, bun: T ObjectExpression 400",
  "types/comments-in-the-options-of-an-import-type.ts:544 Prettier: T Identifier 539, bun: T Name 532",
  "types/comments-in-the-options-of-an-import-type.ts:620 Prettier: L Property 615, bun: T Name 608",
  "types/comments-in-the-options-of-an-import-type.ts:767 Prettier: L Property 761, bun: T Name 754",
  "types/comments-in-the-options-of-an-import-type.ts:775 Prettier: L Property 761, bun: T Name 754",
  "types/line-comment-after-the-comma-of-an-import-type.ts:93 Prettier: L ObjectExpression 101, bun: L ObjectExpression 109",
  // The `1` of the type `-1` is no node here.
  "types/prettier-ignore-after-the-minus-of-a-number.ts:15 Prettier: L Literal 37, bun: D TSLiteralType 13",
  "types/prettier-ignore-after-the-minus-of-a-number.ts:55 Prettier: L Literal 74, bun: D TSLiteralType 53",
  // Nor is the `symbol` of `unique symbol`.
  "types/prettier-ignore-after-unique.ts:17 Prettier: L TSSymbolKeyword 39, bun: D TSTypeOperator 9",
  "types/prettier-ignore-after-unique.ts:63 Prettier: L TSSymbolKeyword 82, bun: D TSTypeOperator 56",
  // As in `types/comments-in-the-options-of-an-import-type.ts`. The import type after `typeof` is no node here either.
  "types/prettier-ignore-in-an-import-type.ts:117 Prettier: L TSImportType 139, bun: L Name 146",
  "types/prettier-ignore-in-an-import-type.ts:174 Prettier: L ObjectExpression 196, bun: T Name 169",
  "types/prettier-ignore-in-an-import-type.ts:249 Prettier: L Property 271, bun: T Name 242",
  "types/prettier-ignore-in-an-import-type.ts:469 Prettier: T Property 448, bun: T ObjectExpression 454",
  "types/prettier-ignore-in-an-import-type.ts:544 Prettier: T ObjectExpression 519, bun: T ObjectExpression 527",
  "types/prettier-ignore-in-an-import-type.ts:600 Prettier: T Identifier 595, bun: T Name 588",
];
