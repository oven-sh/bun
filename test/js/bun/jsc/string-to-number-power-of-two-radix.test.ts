import { expect, test } from "bun:test";
import { bunEnv, bunExe, integersThatNeedRounding, tempDir } from "harness";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

// JSC turns a string of binary, base-4, octal, hex or base-32 digits into a number in one function,
// parseIntOverflow (oven-sh/WebKit#597). parseInt with such a radix, Number() of a "0x" / "0o" / "0b"
// string, and the literals JSC lexes itself (eval, new Function, node:vm) all end there. From 2^53 on
// the result must be the nearest double, ties to even. Number(BigInt) is the reference: a BigInt holds
// the digits exactly and its conversion rounds once. A literal in a file is read by the transpiler,
// whose half is in test/bundler/transpiler/transpiler.test.js. The transpiler also folds a string
// with unary + or - into a number, and asks the same JSC function for it.

const radixOfPrefix: Record<string, number> = { x: 16, o: 8, b: 2 };

test("parseInt, Number() and eval give the nearest double for the reported values", () => {
  const reported: [digits: string, radix: number, nearest: number][] = [
    ["97b89d834f82bbef", 16, 10932661282742122496],
    ["3f0b7020b1479907", 16, 4542847934848801280],
    ["1700774500551360345014", 8, 17311718268872018432],
    ["10100000000000000000000000000000000000000000000000000101", 2, 45035996273704968],
    ["2200000000000000000000000011", 4, 45035996273704968],
    ["1kqg9a599t95", 32, 59479501168768296],
  ];
  const prefixes: Record<number, string> = { 16: "0x", 8: "0o", 2: "0b" };
  for (const [digits, radix, nearest] of reported) {
    expect({ digits, value: parseInt(digits, radix) }).toEqual({ digits, value: nearest });
    if (!(radix in prefixes)) continue;
    const text = prefixes[radix] + digits;
    expect({ text, number: Number(text), eval: (0, eval)(text) }).toEqual({ text, number: nearest, eval: nearest });
  }
});

test("a literal in a file and the same text at run time are one number", () => {
  // The transpiler reads the literals of this file. JSC reads the strings.
  const literals: [text: string, inThisFile: number][] = [
    ["0x3f0b7020b1479907", 0x3f0b7020b1479907],
    ["0x97b89d834f82bbef", 0x97b89d834f82bbef],
    ["0x2f32df6d0cf0355a", 0x2f32df6d0cf0355a],
    ["0X16000000000000A", 0x16000000000000a],
    ["0o1700774500551360345014", 0o1700774500551360345014],
    [
      "0b10100000000000000000000000000000000000000000000000000101",
      0b10100000000000000000000000000000000000000000000000000101,
    ],
  ];
  for (const [text, inThisFile] of literals) {
    const radix = radixOfPrefix[text[1].toLowerCase()];
    expect({
      text,
      inThisFile,
      number: Number(text),
      parseInt: parseInt(text.slice(2), radix),
      eval: (0, eval)(text),
      newFunction: new Function("return " + text)(),
      vm: vm.runInThisContext(text),
    }).toEqual({
      text,
      inThisFile: Number(BigInt(text)),
      number: inThisFile,
      parseInt: inThisFile,
      eval: inThisFile,
      newFunction: inThisFile,
      vm: inThisFile,
    });
  }
});

test("parseInt, Number() and the literals JSC lexes round to the nearest double", () => {
  const cases = integersThatNeedRounding();
  const wrong: object[] = [];
  const check = (form: string, text: string, value: unknown, nearest: number) => {
    if (!Object.is(value, nearest)) wrong.push({ form, text, value, nearest });
  };

  const source = "[" + cases.map(([text]) => text).join(", ") + "]";
  const lexed: Record<string, number[]> = {
    "eval": (0, eval)(source),
    "eval, 16-bit source": (0, eval)("'\u3000', " + source),
    "new Function": new Function("return " + source)(),
    "vm.runInThisContext": vm.runInThisContext(source),
  };

  cases.forEach(([text, exact], i) => {
    const nearest = Number(exact);
    for (const form in lexed) check(form, text, lexed[form][i], nearest);
    // Only a literal takes separators.
    if (text.includes("_")) return;

    const digits = text.slice(2);
    const radix = radixOfPrefix[text[1].toLowerCase()];
    check("Number", text, Number(text), nearest);
    check("Number, 16-bit string", text, Number("\u3000" + text), nearest);
    check("parseInt", text, parseInt(digits, radix), nearest);
    check("parseInt, negative", text, parseInt("-" + digits, radix), -nearest);
    check("parseInt, 16-bit string", text, parseInt(digits + "\u{1F600}", radix), nearest);
    if (radix === 16) check("parseInt, 0x prefix", text, parseInt(text), nearest);
    check("parseInt, radix 4", text, parseInt(exact.toString(4), 4), nearest);
    check("parseInt, radix 32", text, parseInt(exact.toString(32), 32), nearest);
  });
  expect(wrong).toEqual([]);
});

test("parseInt gives the nearest double in a hot loop", () => {
  const parse = (digits: string, radix: number) => parseInt(digits, radix);
  const inputs: [digits: string, radix: number][] = [
    ["97b89d834f82bbef", 16],
    ["1700774500551360345014", 8],
    ["1kqg9a599t95", 32],
    ["zz", 36],
  ];
  const nearest = [10932661282742122496, 17311718268872018432, 59479501168768296, 1295];
  let wrong = 0;
  for (let i = 0; i < 20_000; i++) {
    const [digits, radix] = inputs[i % inputs.length];
    if (parse(digits, radix) !== nearest[i % inputs.length]) wrong++;
  }
  expect(wrong).toBe(0);
});

test("the transpiler folds a string of long hex, octal or binary digits to the nearest double", () => {
  expect(+"0x97b89d834f82bbef").toBe(10932661282742122496);
  expect(-"0b10100000000000000000000000000000000000000000000000000101").toBe(-45035996273704968);

  const transpiler = new Bun.Transpiler();
  const wrong: object[] = [];
  for (const [text, exact] of integersThatNeedRounding()) {
    // Number() of a string takes no separators.
    if (text.includes("_")) continue;
    const printed = transpiler.transformSync(`x = +"${text}";`).trim();
    const value = printed === "x = 1 / 0;" ? Infinity : Number(printed.slice("x = ".length, -1));
    if (!Object.is(value, Number(exact))) wrong.push({ text, printed, nearest: Number(exact) });
  }
  expect(wrong).toEqual([]);
});

test("a transpiler cache entry from before that fold changed is not restored", async () => {
  // The fold above is in the transpiler's output, and the runtime transpiler cache keeps that output
  // on disk. An entry of version 36 can hold the number that the engine gave before.
  const padding = Array.from({ length: 400 }, (_, i) => `const pad_${i} = ${i};`).join("\n");
  using dir = tempDir("pow2-radix-cache", {
    "fold.js": `console.log(+"0x97b89d834f82bbef");\n${padding}\n`,
  });
  const cachePath = join(String(dir), ".bun-cache");
  const run = async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fold.js"],
      env: {
        ...bunEnv,
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: cachePath,
        BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };
  const versions = () =>
    readdirSync(cachePath)
      .filter(name => name.endsWith(".pile"))
      .map(name => readFileSync(join(cachePath, name)).readUInt32LE(0));

  expect(await run()).toEqual({ stdout: "10932661282742122000\n", stderr: "", exitCode: 0 });
  const written = versions();
  expect(written.length).toBeGreaterThan(0);
  for (const version of written) expect(version).toBeGreaterThan(36);

  // Make every entry look like one of version 36. The next run must translate the file again
  // and write the entry again, not restore it.
  for (const name of readdirSync(cachePath).filter(name => name.endsWith(".pile"))) {
    const bytes = readFileSync(join(cachePath, name));
    bytes.writeUInt32LE(36, 0);
    writeFileSync(join(cachePath, name), bytes);
  }
  expect(await run()).toEqual({ stdout: "10932661282742122000\n", stderr: "", exitCode: 0 });
  expect(versions()).toEqual(written);
});
