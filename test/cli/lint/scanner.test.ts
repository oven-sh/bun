// The scanner that `bun lint`, `bun format` and `bun check` share reads the length of a name, of indentation and of a plain
// string from bitmaps that a SIMD kernel fills 64 bytes at a time, through a 64-bit window. These tests put the end of each kind
// of run on both sides of every boundary that involves: 8, 16, 32, 56, 57 and 64 bytes, and the end of the file.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

const env = { ...bunEnv, AGENT: "0", CLAUDECODE: undefined, NO_COLOR: "1" };
const LENGTHS = [1, 2, 7, 8, 9, 15, 16, 17, 31, 32, 33, 55, 56, 57, 58, 63, 64, 65, 112, 113, 127, 128, 129, 300];
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$";
const nameOf = (length: number) => ALPHABET.repeat(5).slice(0, length);

async function run(args: string[], files: Record<string, string | Buffer>) {
  using dir = tempDir("bun-scanner", files);
  await using proc = spawn({ cmd: [bunExe(), ...args], env, cwd: String(dir), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

type Found = { message: string; line: number; column: number; endColumn: number };

/** What `no-undef` says about each file: the names the scanner saw, and where. */
async function undefinedNames(files: Record<string, string | Buffer>): Promise<Record<string, Found[]>> {
  const { stdout } = await run(["lint", "--rule", "no-undef: error", "-f", "json", "."], files);
  const results: { filePath: string; messages: (Found & { ruleId: string | null })[] }[] = JSON.parse(stdout);
  return Object.fromEntries(
    results.map(({ filePath, messages }) => [
      filePath.replaceAll("\\", "/").split("/").pop()!,
      messages
        // A syntax error has no rule.
        .filter(({ ruleId }) => ruleId === "no-undef" || ruleId === null)
        .map(({ message, line, column, endColumn }) => ({ message, line, column, endColumn })),
    ]),
  );
}

const undefinedAt = (name: string, line: number, column: number): Found => ({
  message: `'${name}' is not defined.`,
  line,
  column,
  endColumn: column + name.length,
});

describe.concurrent("scanner", () => {
  test("names of every length, after every indentation, in one file", async () => {
    const lines: string[] = [];
    const expected: Found[] = [];
    for (const indentation of [0, ...LENGTHS]) {
      for (const length of LENGTHS) {
        for (const blank of [" ", "\t", " \t"]) {
          const name = nameOf(length);
          lines.push(blank.repeat(indentation).slice(0, indentation) + name + ";");
          expected.push(undefinedAt(name, lines.length, indentation + 1));
        }
      }
    }
    expect(await undefinedNames({ "a.js": lines.join("\n") })).toEqual({ "a.js": expected });
  });

  test("a name ends at the end of the file, at a byte that is not ASCII, and at an escape", async () => {
    const files: Record<string, string> = {};
    const expected: Record<string, Found[]> = {};
    for (const length of LENGTHS) {
      for (const pad of [0, 3, 61]) {
        for (const [kind, written, read] of [
          ["end", "", ""],
          ["dot", ".x", ""],
          ["latin", "é", "é"],
          ["cjk", "中x", "中x"],
          ["escape", "\\u0061b", "ab"],
          ["separator", " ", ""],
        ]) {
          const file = `${kind}-${length}-${pad}.js`;
          files[file] = " ".repeat(pad) + nameOf(length) + written;
          const writtenLength = length + (read ? written.length : 0);
          expected[file] = [{ ...undefinedAt(nameOf(length) + read, 1, pad + 1), endColumn: pad + 1 + writtenLength }];
        }
      }
    }
    expect(await undefinedNames(files)).toEqual(expected);
  });

  test("files with nothing in them, or nothing but blanks", async () => {
    const files = Object.fromEntries(
      ["", " ", "\n", "\t\t", "﻿", ...[63, 64, 65].flatMap(n => [" ".repeat(n), "\n" + " ".repeat(n)])].map(
        (text, i) => [`${i}.js`, text],
      ),
    );
    expect(await undefinedNames(files)).toEqual(Object.fromEntries(Object.keys(files).map(file => [file, []])));
  });

  test("strings, templates and comments of every length come out of the formatter whole", async () => {
    const input: string[] = [];
    const expected: string[] = [];
    const both = (line: string, formatted = line) => (input.push(line), expected.push(formatted));
    for (const length of [0, ...LENGTHS]) {
      const text = nameOf(length);
      both(`x = '${text}';`, `x = "${text}";`);
      both(`x = "${text}";`);
      both(`x = "${text}'";`);
      both(`x = "'${text}";`);
      both(`x = '${text}"';`);
      both(`x = "${text}\\n";`);
      both(`x = "\\\\${text}";`);
      both(`x = "${text}é";`);
      both(`x = "é${text}";`);
      both(`x = "${text}\x7F";`);
      both(`x = "${text}\t";`);
      both(`x = "${Array.from({ length: length % 40 }, (_, i) => nameOf(i % 19)).join("\\n")}";`);
      both("x = `" + text + "`;");
      both("x = `" + text + "$" + text + "`;");
      both("x = `" + text + "${y}" + text + "\\`" + text + "`;");
      both("x = `" + text + "é\"'" + text + "`;");
      both(`// ${text}.`);
      both(`// ${text} — ${text} → ${text}.`);
      both(`/* ${text} */`);
      both(`/* ${text}*${text} / ** ${text} **/`);
      both(`/* ${text} — ${text} */`);
      both(`/**\n * ${text}.\n * ${text}.\n */`);
    }
    // Not in the directory of the test run: this repository's .gitignore has `/a.js`, and an ignored file is printed as it is.
    using dir = tempDir("bun-scanner", {});
    await using proc = spawn({
      cmd: [bunExe(), "format", "--print-width", "100000", "--stdin-filepath", "a.js"],
      env,
      cwd: String(dir),
      stdin: Buffer.from(input.join("\n") + "\n"),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.split("\n")).toEqual([...expected.join("\n").split("\n"), ""]);
    expect(exitCode).toBe(0);
  });

  test("only a line break ends a line comment, or makes a block comment end a statement", async () => {
    const files: Record<string, string> = {};
    const expected: Record<string, Found[]> = {};
    for (const length of [0, ...LENGTHS]) {
      const text = nameOf(length);
      for (const [kind, lineBreak] of Object.entries({ lf: "\n", cr: "\r", ls: "\u2028", ps: "\u2029" })) {
        files[`line-${kind}-${length}.js`] = `a // ${text}${lineBreak}b`;
        expected[`line-${kind}-${length}.js`] = [undefinedAt("a", 1, 1), undefinedAt("b", 2, 1)];
        files[`block-${kind}-${length}.js`] = `a /*${text}${lineBreak}${text}*/ b`;
        expected[`block-${kind}-${length}.js`] = [undefinedAt("a", 1, 1), undefinedAt("b", 2, length + 4)];
      }
      // The first byte of each is the first byte of U+2028, and the second too but for the arrow.
      for (const [kind, other] of Object.entries({
        none: "",
        dash: "\u2014",
        before: "\u2027",
        after: "\u202A",
        arrow: "\u2192",
      })) {
        files[`line-${kind}-${length}.js`] = `a // ${text}${other}b`;
        expected[`line-${kind}-${length}.js`] = [undefinedAt("a", 1, 1)];
        files[`block-${kind}-${length}.js`] = `a /*${text}${other}${text}*/ + b`;
        expected[`block-${kind}-${length}.js`] = [
          undefinedAt("a", 1, 1),
          undefinedAt("b", 1, 2 * length + other.length + 10),
        ];
      }
    }
    expect(await undefinedNames(files)).toEqual(expected);
  });

  test("what has no end is an error at the end of the file", async () => {
    const files: Record<string, string> = {};
    const expected: Record<string, string[]> = {};
    for (const length of LENGTHS) {
      for (const [kind, open, message] of [
        ["string", '"', "Unterminated string constant"],
        ["template", "`", "Unterminated template"],
        ["comment", "/*", "Unterminated comment"],
        ["star", "/**", "Unterminated comment"],
      ]) {
        files[`${kind}-${length}.js`] = `x = ${open}${nameOf(length)}`;
        expected[`${kind}-${length}.js`] = [`Parsing error: ${message}`];
      }
    }
    const found = await undefinedNames(files);
    expect(Object.fromEntries(Object.entries(found).map(([file, all]) => [file, all.map(it => it.message)]))).toEqual(
      expected,
    );
  });

  test("zero bytes and invalid UTF-8 end a run", async () => {
    const files: Record<string, Buffer> = {};
    const expected: Record<string, Found[]> = {};
    const bytes = (...parts: (string | number)[]) =>
      Buffer.concat(parts.map(part => (typeof part === "string" ? Buffer.from(part) : Buffer.from([part]))));
    for (const length of LENGTHS) {
      const name = nameOf(length);
      files[`string-zero-${length}.js`] = bytes(`x = "${name}`, 0, `${name}"; ${name}`);
      expected[`string-zero-${length}.js`] = [undefinedAt("x", 1, 1), undefinedAt(name, 1, 2 * length + 10)];
      files[`string-invalid-${length}.js`] = bytes(`x = "${name}`, 0xff, `"; ${name}`);
      expected[`string-invalid-${length}.js`] = [undefinedAt("x", 1, 1), undefinedAt(name, 1, length + 10)];
      files[`comment-invalid-${length}.js`] = bytes(`// ${name}`, 0xe2, 0x80, `\n/* ${name}`, 0xe2, `*/ ${name}`);
      expected[`comment-invalid-${length}.js`] = [undefinedAt(name, 2, length + 8)];
      files[`name-zero-${length}.js`] = bytes(name, 0);
      expected[`name-zero-${length}.js`] = [
        { message: "Parsing error: Unexpected character '\0'", line: 1, column: length + 1, endColumn: undefined! },
      ];
    }
    expect(await undefinedNames(files)).toEqual(expected);
  });

  test("a directive counts on the last line of a block comment", async () => {
    const lines = ["export let x: number;"];
    const expected: string[] = [];
    for (const length of [0, ...LENGTHS]) {
      const text = nameOf(length);
      for (const lineBreak of ["\n", "\r\n"]) {
        lines.push(`/* ${text}${lineBreak} * @ts-expect-error ${text} */`, `x = "last line, ${length}";`);
        lines.push(`/* @ts-expect-error ${text}${lineBreak} ${text} */`, `x = "first line, ${length}";`);
        expected.push(
          `a.ts(${lines.join("\n").split("\n").length},1): error TS2322: Type 'string' is not assignable to type 'number'.`,
        );
      }
      lines.push(`// @ts-expect-error ${text}`, `x = "line comment, ${length}";`);
    }
    const { stdout, exitCode } = await run(["check", "--all", "a.ts"], {
      "a.ts": lines.join("\n") + "\n",
    });
    expect(stdout.split("\n").filter(line => line.includes("error TS"))).toEqual(expected);
    expect(exitCode).toBe(1);
  });
});
