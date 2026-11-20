import { expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, tempDir } from "harness";
import { join } from "path";
test.concurrent("empty jsonc - package.json", async () => {
  await using dir = tempDir("jsonc", {
    "package.json": ``,
    "index.ts": `
    import pkg from './package.json';
    if (JSON.stringify(pkg) !== '{}') throw new Error('package.json should be empty');
    `,
  });
  expect(await bunRun(join(dir, "index.ts"))).toSpawn();
});

test.concurrent("empty jsonc - tsconfig.json", async () => {
  await using dir = tempDir("jsonc", {
    "tsconfig.json": ``,
    "index.ts": `
    import tsconfig from './tsconfig.json';
    if (JSON.stringify(tsconfig) !== '{}') throw new Error('tsconfig.json should be empty');
    `,
  });
  expect(await bunRun(join(dir, "index.ts"))).toSpawn();
});

test.concurrent("import anything.jsonc as json", async () => {
  const jsoncFile = `{
    // comment
    "trailingComma": 0,
  }`;
  await using dir = tempDir("jsonc", {
    "anything.jsonc": jsoncFile,
    "index.ts": `
    import file from './anything.jsonc';
    const _file = ${jsoncFile}
    if (!Bun.deepEquals(file, _file)) throw new Error('anything.jsonc wasnt imported as jsonc');
    `,
  });
  expect(await bunRun(join(dir, "index.ts"))).toSpawn();
});

test.concurrent("imported JSON strings match JSON.parse exactly (escapes, lone surrogates, non-ASCII)", async () => {
  const json = `{"lone":"\\ud800","pair":"\\ud83d\\ude00","mix":"a\\udfffz","e":"caf\\u00e9\\ud800x","lit":"é🚀","esc\\nkey":"a\\n\\"b\\""}`;
  await using dir = tempDir("jsonc", {
    "weird.json": json,
    "weird.jsonc": json,
    "index.ts": `
    import w from "./weird.json";
    import c from "./weird.jsonc";
    const file = await Bun.file(import.meta.dir + "/weird.json").text();
    const expected = JSON.parse(file);
    const units = (o: any) => JSON.stringify(Object.entries(o).map(([k, v]) => [...(k + v as string)].map(s => s.codePointAt(0))));
    if (units(w) !== units(expected)) throw new Error("json import != JSON.parse: " + units(w) + " vs " + units(expected));
    if (units(c) !== units(expected)) throw new Error("jsonc import != JSON.parse");
    if (units(Bun.JSONC.parse(file)) !== units(expected)) throw new Error("Bun.JSONC.parse != JSON.parse");
    `,
  });
  expect(await bunRun(join(dir, "index.ts"))).toSpawn();
});

test.concurrent("a .jsonc import repairs bytes that are not UTF-8 in a string with an escape", async () => {
  // A string with an escape is decoded. One that is not UTF-8 is decoded one code point at a time, and repaired.
  const escaped = (bytes: number[]) => Buffer.concat([Buffer.from("a\\n"), Buffer.from(bytes), Buffer.from("z\\t")]);
  const decoded = (codePoints: number[]) => [0x61, 0x0a, ...codePoints, 0x7a, 0x09];
  const cases: Record<string, [body: Buffer, codePoints: number[]]> = {
    // A byte that starts no sequence is taken as its code point.
    continuation: [escaped([0x80]), decoded([0x80])],
    lastContinuation: [escaped([0xbf]), decoded([0xbf])],
    notALead: [escaped([0xff]), decoded([0xff])],
    // A sequence that is cut short, or overlong, is U+FFFD for its first byte.
    leadThenAscii: [escaped([0xc3]), decoded([0xfffd])],
    cutSequence: [escaped([0xe6, 0x97]), decoded([0xfffd, 0x97])],
    overlong: [escaped([0xc0, 0x80]), decoded([0xfffd, 0x80])],
    // Half of a surrogate pair stays as it is.
    surrogateHalf: [escaped([0xed, 0xa0, 0xbd]), decoded([0xd83d])],
    // One byte that is not UTF-8 changes nothing in the characters around it.
    twoStretches: [escaped([0xc3, 0xa9, 0x20, 0xff, 0xc3, 0xa9]), decoded([0xe9, 0x20, 0xff, 0xe9])],
    wellFormed: [escaped([0xc3, 0xa9, 0xf0, 0x9f, 0x9a, 0x80]), decoded([0xe9, 0x1f680])],
    // A string that is longer than a buffer of the parser, with the byte between two runs of text.
    long: [
      Buffer.concat([
        Buffer.alloc(5000, "p"),
        Buffer.from([0xff, 0xc3, 0xa9]),
        Buffer.alloc(5000, "q"),
        Buffer.from("\\n"),
      ]),
      [...Array(5000).fill(0x70), 0xff, 0xe9, ...Array(5000).fill(0x71), 0x0a],
    ],
    // Text that is longer after the repair: each byte becomes a character of two bytes.
    grows: [Buffer.concat([Buffer.alloc(5000, 0xff), Buffer.from("\\n")]), [...Array(5000).fill(0xff), 0x0a]],
  };
  // The parser finds the next escape by a branch, by a word of 8 bytes, and by a vector. The byte is behind each.
  for (const distance of [1, 3, 4, 7, 11, 12, 19, 35, 67, 131]) {
    const text = Array(distance).fill(0x62);
    cases["after" + distance] = [escaped([...text, 0xe9, ...text]), decoded([...text, 0xfffd, ...text])];
  }
  const parts = [Buffer.from("{")];
  for (const [name, [body]] of Object.entries(cases)) {
    parts.push(Buffer.from(`"${name}":"`), body, Buffer.from(`",`));
  }
  parts.push(Buffer.from(`}`));
  using dir = tempDir("jsonc-not-utf8", {
    "weird.jsonc": Buffer.concat(parts),
    "index.ts": `
      import file from "./weird.jsonc";
      const codePoints = (text: string) => Array.from(text, c => c.codePointAt(0));
      console.log(JSON.stringify(Object.entries(file).map(([name, text]) => [name, codePoints(text as string)])));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual(Object.entries(cases).map(([name, [, codePoints]]) => [name, codePoints]));
  expect(exitCode).toBe(0);
});
