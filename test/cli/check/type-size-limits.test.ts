// The limits on the size of one type.
//
// A template literal type has the two limits of TypeScript 7.1 (microsoft/TypeScript#64194): 50,000,000 bytes of text
// and 100,000 placeholders. Over either, it's TS2589 and the error type. Without them, a conditional type that calls
// itself with `${S}_${S}` doubles the type on every turn until memory runs out, which is what tsc 7.0 does.
//
// A type over a size limit is reported once, at the node that's being checked when the type is made, as tsc reports
// it. That goes for a union (TS2590) and a tuple (TS2799) too.
//
// The projects load no library: a debug build takes seconds to read the library files.
import { afterAll, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { endChildren, longLimit, spawn } from "../children";
import { env } from "./differential";

afterAll(endChildren);

const globals = "Array<T> Boolean CallableFunction Function IArguments NewableFunction Number Object RegExp String"
  .split(" ")
  .map(name => `interface ${name} {}\n`)
  .join("");
const tsconfig = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, noLib: true, types: [] } });

/** The errors that `bun check` reports for the files. */
async function check(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("bun-check-size", { "tsconfig.json": tsconfig, "globals.d.ts": globals, ...files });
  await using proc = spawn({
    cmd: [bunExe(), "check", ...flags],
    cwd: String(dir),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const errors = stdout.split(/\r?\n/).filter(Boolean);
  // A crash, a sanitizer report or a timeout: the output says why.
  if (exitCode !== 0 && exitCode !== 1) return { errors, exitCode, signalCode: proc.signalCode, stderr };
  return { errors, exitCode };
}

const once = <T>(run: () => Promise<T>) => {
  let ran: Promise<T> | undefined;
  return () => (ran ??= run());
};
// `"".repeat` is slow in debug builds of JavaScriptCore.
const repeat = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();
const at = (file: string, line: number, column: number, error: string) => `${file}(${line},${column}): error ${error}`;
const ts2589 = "TS2589: Type instantiation is excessively deep and possibly infinite.";
const ts2590 = "TS2590: Expression produces a union type that is too complex to represent.";
const ts2799 = "TS2799: Type produces a tuple type that is too large to represent.";
const ts2322 =
  "TS2322: Type 'object' is not assignable to type 'string | number | bigint | boolean | null | undefined'.";

// `P1` has one placeholder. Each of `P2` to `P65536`, on lines 2 to 17, has twice as many as the one before it. The
// text keeps a type from being `string`.
let doubled = "type P1 = `a${string}`;\n";
for (let n = 2; n <= 65536; n *= 2) doubled += `type P${n} = \`\${P${n / 2}}\${P${n / 2}}\`;\n`;

// 65,536 + 32,768 + 1,024 + 512 + 128 + 32 placeholders, and then one more.
const placeholders = once(() =>
  check({
    "a.ts":
      doubled +
      "type AtTheLimit = `${P65536}${P32768}${P1024}${P512}${P128}${P32}`;\n" +
      "type OverTheLimit = `${AtTheLimit}${P1}`;\n",
  }),
);

// Twenty and thirty megabytes around a placeholder: neither text is over the limit, and together they are at it. Then
// one byte more.
const text = once(() =>
  check({
    "a.ts":
      `type M = "${repeat("a", 1_000_000)}";\n` +
      `type AtTheLimit = \`${repeat("${M}", 20)}\${string}${repeat("${M}", 30)}\`;\n` +
      "type OverTheLimit = `${AtTheLimit}a`;\n",
  }),
);

// These two programs end without the limits too, and then have no error.
//
// The tests aren't concurrent, because one check uses every core. Each has the long limit: for types of this size a
// debug build on a busy machine takes more than the five seconds of a test.
test(
  "reports TS2589 for a template literal type with more than 100,000 placeholders",
  async () => {
    expect(await placeholders()).toEqual({ errors: [at("a.ts", 19, 21, ts2589)], exitCode: 1 });
  },
  longLimit,
);

test(
  "reports TS2589 for a template literal type with more than 50,000,000 bytes of text",
  async () => {
    expect(await text()).toEqual({ errors: [at("a.ts", 3, 21, ts2589)], exitCode: 1 });
  },
  longLimit,
);

// With `object` in it a template literal type is `string`, whatever follows.
test(
  "tests the limits of a template literal type part by part, from the left",
  async () => {
    const source =
      doubled + "type Before = `${object}${P65536}${P65536}`;\n" + "type After = `${P65536}${P65536}${object}`;\n";
    expect(await check({ "a.ts": source })).toEqual({
      errors: [at("a.ts", 18, 18, ts2322), at("a.ts", 19, 14, ts2589), at("a.ts", 19, 35, ts2322)],
      exitCode: 1,
    });
  },
  longLimit,
);

// The test of microsoft/TypeScript#64194, templateLiteralTypeExcessiveLength.ts. `Dec<2>` is `any`, so `Recur` takes both
// branches and calls itself without end.
const recursive = `type Dec<N extends number> =
    N extends 5 ? 4 : N extends 4 ? 3 : N extends 3 ? 2 :
    N extends 2 ? any :
    N extends 1 ? 0 : 0;

type Recur<N extends number, S extends string> =
    N extends 0 ? S : Recur<Dec<N>, \`\${S}_\${S}\`>;

// The string literal doubles on every iteration.
type Explode = {
    [P in Recur<5, "a"> as \`\${P}_key\`]: any;
};

// The number of placeholders doubles on every iteration.
type ExplodeSpans = {
    [P in Recur<5, string> as \`\${P}_key\`]: any;
};

// Every text segment stays small, but the number of segments doubles on every iteration,
// so the combined text length grows without bound.
type A16 = "aaaaaaaaaaaaaaaa";
type A64 = \`\${A16}\${A16}\${A16}\${A16}\`;
type A256 = \`\${A64}\${A64}\${A64}\${A64}\`;
type A1024 = \`\${A256}\${A256}\${A256}\${A256}\`;

type RecurSegments<N extends number, S extends string> =
    N extends 0 ? S : RecurSegments<Dec<N>, \`\${S}\${string}\${S}\`>;

type ExplodeSegments = {
    [P in RecurSegments<5, A1024> as \`\${P}_key\`]: any;
};
`;

test(
  "reports TS2589 for a conditional type that doubles a template literal type on every turn",
  async () => {
    // Without the limits this program allocates until the system ends the process. So it starts only after the two
    // programs that end without them have shown both limits.
    const [ofPlaceholders, ofText] = await Promise.all([placeholders(), text()]);
    expect([ofPlaceholders.errors, ofText.errors]).toEqual([[at("a.ts", 19, 21, ts2589)], [at("a.ts", 3, 21, ts2589)]]);
    expect(await check({ "a.ts": recursive })).toEqual({
      errors: [at("a.ts", 11, 11, ts2589), at("a.ts", 16, 11, ts2589), at("a.ts", 30, 11, ts2589)],
      exitCode: 1,
    });
  },
  longLimit,
);

// The branch of `Wrap` doesn't depend on `T`, and tsc keeps its type with its node. So the error is at the use that tsc
// is checking when it makes the type, and the later uses have none. Each source ends with the declaration of `Wrap`.
const twoUses = "declare const first: Wrap<1>;\ndeclare const second: Wrap<2>;\n";
const digit = "type Digit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;\n";
const thousand =
  "type Ten<T extends unknown[]> = [...T, ...T, ...T, ...T, ...T, ...T, ...T, ...T, ...T, ...T];\n" +
  "type Thousand = Ten<Ten<Ten<[0]>>>;\n";
test.each([
  [
    "template literal type",
    doubled + twoUses + "type Wrap<T> = T extends unknown ? `${P65536}${P65536}` : never;\n",
    at("a.ts", 18, 22, ts2589),
  ],
  [
    "union type",
    twoUses + digit + "type Wrap<T> = T extends unknown ? `${Digit}${Digit}${Digit}${Digit}${Digit}` : never;\n",
    at("a.ts", 1, 22, ts2590),
  ],
  [
    "tuple type",
    twoUses + thousand + `type Wrap<T> = T extends unknown ? [${repeat("...Thousand, ", 10)}] : never;\n`,
    at("a.ts", 1, 22, ts2799),
  ],
])(
  "reports a %s that is too large once, not at every use of it",
  async (_, source, error) => {
    expect(await check({ "a.ts": source })).toEqual({ errors: [error], exitCode: 1 });
  },
  longLimit,
);

// tsc reports it in the first file that it checks. With more than one thread, the files that use the type are checked
// at the same time, and each of them makes it.
test(
  "reports a type that is too large in one of the files that use it, whatever the number of threads",
  async () => {
    const files = {
      "a.ts": "declare const a1: Wrap<1>;\ndeclare const a2: Wrap<2>;\n",
      "b.ts": "declare const b: Wrap<3>;\n",
      "c.ts": "declare const c: Wrap<4>;\n",
      "p.ts": doubled + "type Wrap<T> = T extends unknown ? `${P65536}${P65536}` : never;\n",
    };
    const expected = { errors: [at("a.ts", 1, 19, ts2589)], exitCode: 1 };
    expect(await check(files)).toEqual(expected);
    expect(await check(files, "--threads=1")).toEqual(expected);
  },
  longLimit,
);
