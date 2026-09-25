// Compares Bun::LineIndex (src/jsc/bindings/LineIndex.cpp) with a table of every line.

import { lineIndexForTesting } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const BLOCK = 1024;

// Where each line starts: after a `\n`, and after a `\r` that no `\n` follows.
function lineStarts(text: Uint8Array): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === 10 || (text[i] === 13 && text[i + 1] !== 10)) starts.push(i + 1);
  }
  return starts;
}

function expectedPositions(text: Uint8Array, offsets: Uint32Array): number[] {
  const starts = lineStarts(text);
  const positions: number[] = [];
  for (const offset of offsets) {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle] <= offset) low = middle + 1;
      else high = middle;
    }
    positions.push(low - 1, offset - starts[low - 1]);
  }
  return positions;
}

function everyOffset(text: Uint8Array, past = 3): Uint32Array {
  return Uint32Array.from({ length: text.length + past }, (_, i) => i);
}

function check(text: Uint8Array, offsets = everyOffset(text)) {
  expect(Array.from(lineIndexForTesting(text, offsets))).toEqual(expectedPositions(text, offsets));
}

const latin1 = (text: string) => Uint8Array.from(text, character => character.charCodeAt(0));

describe("the line and the column of an offset", () => {
  test.each([
    ["an empty text", ""],
    ["one line", "let a = 1;"],
    ["\\n", "a\nbb\n\nccc\n"],
    ["\\r", "a\rbb\r\rccc\r"],
    ["\\r\\n", "a\r\nbb\r\n\r\nccc\r\n"],
    ["all three", "a\r\nb\rc\nd\n\re\r\r\nf"],
    ["a text that ends in \\r", "a\nb\r"],
    ["characters above 127", "\xe9\n\xff\xfe\r\n\xa0"],
  ])("%s", (_, text) => {
    check(latin1(text));
  });

  test("a terminator on each side of a block", () => {
    for (const terminator of ["\n", "\r", "\r\n"]) {
      for (let at = BLOCK - 3; at <= BLOCK + 1; at++) {
        const text = latin1("x".repeat(at) + terminator + "y".repeat(BLOCK) + terminator + "z".repeat(40));
        const near = [at - 1, at, at + 1, at + 2, at + 3, BLOCK - 1, BLOCK, BLOCK + 1, 2 * BLOCK, text.length];
        check(text, Uint32Array.from(near));
      }
    }
  });

  test("a text that ends where a block ends", () => {
    for (const length of [BLOCK, 2 * BLOCK]) {
      for (const last of ["x", "\n", "\r"]) {
        const text = latin1("ab\n" + "x".repeat(length - 4) + last);
        expect(text.length).toBe(length);
        check(text, Uint32Array.from([length - 2, length - 1, length, length + 1, length + BLOCK]));
      }
    }
  });

  test("a line that is longer than several blocks", () => {
    const text = latin1("a\n" + "x".repeat(5 * BLOCK + 7) + "\nb");
    check(text, Uint32Array.from([0, 1, 2, 3, BLOCK, 3 * BLOCK + 1, 5 * BLOCK + 8, 5 * BLOCK + 9, 5 * BLOCK + 10]));
  });

  test("text with many lines, with and without \\r", () => {
    let seed = 0x2545f491;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0x100000000;
    };
    for (const terminators of [["\n"], ["\r\n"], ["\n", "\r", "\r\n"]]) {
      const lines: string[] = [];
      for (let i = 0; i < 400; i++) {
        const terminator = terminators[Math.floor(random() * terminators.length)];
        lines.push("x".repeat(Math.floor(random() * 60)) + terminator);
      }
      check(latin1(lines.join("")));
    }
  });
});

describe("error.stack", () => {
  async function run(files: Record<string, string | Uint8Array>, entry: string) {
    using dir = tempDir("line-index", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), entry],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const makeError = `function makeError() {
  const error = new Error("x");
  globalThis.made = true;
  return error;
}`;
  const report = `
makeError().stack;
console.log(lineStartTableIsBuilt(makeError));
`;
  const imported = `import { lineStartTableIsBuilt } from "bun:internal-for-testing";\n`;
  const required = `const { lineStartTableIsBuilt } = require("bun:internal-for-testing");\n`;

  // JavaScriptCore builds its table of every line when a source gives a position that Bun's provider does not answer.
  test.each([
    ["a module", "index.mjs", imported + makeError + report, false],
    ["a CommonJS module", "index.cjs", required + makeError + report, false],
    ["a TypeScript module", "index.ts", imported + makeError + report, false],
    ["a module that Bun does not transpile", "index.mjs", "// @bun\n" + imported + makeError + report, false],
    [
      "a node:vm script",
      "index.mjs",
      imported +
        `import vm from "node:vm";\nconst makeError = vm.runInThisContext(${JSON.stringify("(" + makeError + ")")});` +
        report,
      true,
    ],
    [
      "new Function",
      "index.mjs",
      imported + `const makeError = new Function(${JSON.stringify(makeError + "\nreturn makeError();")});` + report,
      true,
    ],
  ])("the table of every line after a read, for %s", async (_, entry, source, tableIsBuilt) => {
    const { stdout, stderr, exitCode } = await run({ [entry]: source }, entry);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(String(tableIsBuilt));
    expect(exitCode).toBe(0);
  });

  test.each([
    ["\\n", "\n"],
    ["\\r\\n", "\r\n"],
    ["\\r", "\r"],
  ])("positions in a file that Bun does not transpile, with %s", async (_, terminator) => {
    const lines = [
      "// @bun",
      "let made = 0;",
      "function makeError() {",
      "  const error = new Error('x');",
      "  made++;",
      "  return error;",
      "}",
      "// " + "x".repeat(3 * BLOCK),
      "function later() {",
      "    const error = makeError();",
      "    made++;",
      "    return error;",
      "}",
      "console.log(later().stack.split('\\n').slice(1, 3).map(line => line.trim().replace(/\\(.*[\\\\/]/, '(')).join('|'));",
    ];
    const { stdout, stderr, exitCode } = await run({ "index.cjs": latin1(lines.join(terminator)) }, "index.cjs");
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("at makeError (index.cjs:4:26)|at later (index.cjs:10:28)");
    expect(exitCode).toBe(0);
  });
});
