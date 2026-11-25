import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const tsconfig = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["*.ts"] });
const size = 700;
const numbers = Array.from({ length: size }, (_, index) => index);
const interfaces = (prefix: string) =>
  numbers.map(i => `interface ${prefix}${i} { kind: "k${i}"; v${i}: number }\n`).join("");
const union = (name: string, members: string[]) => `type ${name} = ${members.join(" | ")};\n`;
const all =
  interfaces("T") +
  union(
    "All",
    numbers.map(i => `T${i}`),
  );
const third = numbers.filter(i => i % 3 === 0).map(i => `T${i}`);
const related = "declare const some: Some; export const all: All = some;\n";

async function check(source: string) {
  using dir = tempDir("check-members-of-large-unions", { "tsconfig.json": tsconfig, "a.ts": source });
  await using proc = spawn({
    cmd: [bunExe(), "check", "--no-pretty"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = (stdout + stderr).split("\n");
  const errors = lines.filter(line => line.includes("error TS") || /^  Type /.test(line));
  return { errors: errors.map(line => line.replace(/^a\.ts\(\d+,\d+\): /, "").trim()), exitCode };
}

test.concurrent.each([
  ["every third member", union("Some", third) + related],
  [
    "members of the same shapes",
    interfaces("U") +
      union(
        "Some",
        numbers.map(i => `U${i}`),
      ) +
      related,
  ],
  [
    "members of the same shapes among its own",
    interfaces("U") +
      union(
        "Some",
        numbers.map(i => (i % 5 ? `T${i}` : `U${i}`)),
      ) +
      related,
  ],
  [
    "what Exclude leaves of it",
    "declare const some: Exclude<All, T3 | T9>; export const all: All = some; export const more: Exclude<All, T3> = some;\n",
  ],
  [
    "what a chain of type guards leaves of it",
    "const is = <T extends All>(t: All, kind: T['kind']): t is T => t.kind === kind;\n" +
      "declare function take(t: All): void;\nexport function f(t: All) {\n" +
      numbers
        .slice(0, 40)
        .map(i => `  if (is<T${i}>(t, "k${i}")) return t.v${i};\n  take(t);\n`)
        .join("") +
      "  return -1;\n}\n",
  ],
])("a large union takes %s", async (_, source) => {
  expect(await check(all + source)).toEqual({ errors: [], exitCode: 0 });
});

test.concurrent.each([
  [
    "a type that it has not, behind its own members",
    `interface Other { kind: "other"; weight: string }\n` + union("Some", [...third, "Other"]) + related,
    ["error TS2322: Type 'Some' is not assignable to type 'All'.", "Type 'Other' is not assignable to type 'All'."],
  ],
  [
    "undefined, in front of its own members",
    union("Some", ["undefined", ...third.toReversed()]) + related,
    ["error TS2322: Type 'Some' is not assignable to type 'All'.", "Type 'undefined' is not assignable to type 'All'."],
  ],
  [
    "a primitive",
    union("Some", [...numbers.map(i => `T${i}`), "string"]) + related,
    ["error TS2322: Type 'Some' is not assignable to type 'All'.", "Type 'string' is not assignable to type 'All'."],
  ],
  [
    "a literal with a property more",
    `export const all: All = Math.random() > 0.5 ? { kind: "k1", v1: 2 } : { kind: "k2", v2: 2, extra: 1 };\n`,
    ["error TS2353: Object literal may only specify known properties, and 'extra' does not exist in type 'T2'."],
  ],
])("a large union does not take %s", async (_, source, errors) => {
  expect(await check(all + source)).toEqual({ errors, exitCode: 1 });
});
