import { spawn, spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("should work for static input", () => {
  const inputs = [
    "hello world",
    "hello world\n",
    "hello world\n\n",
    "hello world\n\n\n",
    "Hello\nWorld\n",
    "1",
    "💕 Red Heart ✨ Sparkles 🔥 Fire\n💕 Red Heart ✨ Sparkles\n💕 Red Heart\n💕\n\nnormal",
    "a\n§\nb",
    "first\n\uFEFFsecond\nthird\n",
  ];

  for (let input of inputs) {
    it(input.replaceAll("\n", "\\n"), () => {
      const { stdout } = spawnSync({
        cmd: [bunExe(), import.meta.dir + "/" + "console-iterator-run.ts"],
        stdin: Buffer.from(input),
        env: bunEnv,
      });
      expect(stdout.toString()).toBe(input.replaceAll("\n", ""));
    });
  }
});

describe("should work for streaming input", () => {
  const inputs = [
    "hello world",
    "hello world\n",
    "hello world\n\n",
    "hello world\n\n\n",
    "Hello\nWorld\n",
    "1",
    "💕 Red Heart ✨ Sparkles 🔥 Fire\n 💕 Red Heart ✨ Sparkles\n 💕 Red Heart\n 💕 \n\nnormal",
    "a\n§\nb",
    "first\n\uFEFFsecond\nthird\n",
  ];

  for (let input of inputs) {
    it(input.replaceAll("\n", "\\n"), async () => {
      const proc = spawn({
        cmd: [bunExe(), import.meta.dir + "/" + "console-iterator-run.ts"],
        stdin: "pipe",
        stdout: "pipe",
        env: bunEnv,
      });
      const { stdout, stdin } = proc;
      stdin.write(input.slice(0, (input.length / 2) | 0));
      stdin.flush();
      await new Promise(resolve => setTimeout(resolve, 1));
      stdin.write(input.slice((input.length / 2) | 0));
      await stdin.end();

      expect(await stdout.text()).toBe(input.replaceAll("\n", ""));
      proc.kill(0);
    });
  }
});

// Bytes below are strings with one character per byte. This is U+FEFF in UTF-8.
const BOM = "\xEF\xBB\xBF";

// Returns what console-iterator-lines-fixture.ts prints: the lines of each pass over `console`.
async function iterate(stdin: string | Blob, ...args: string[]) {
  await using proc = spawn({
    cmd: [bunExe(), import.meta.dir + "/" + "console-iterator-lines-fixture.ts", ...args],
    stdin: typeof stdin === "string" ? Buffer.from(stdin, "latin1") : stdin,
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const printed = (passes: string[][]) => ({ stdout: JSON.stringify(passes), stderr: "", exitCode: 0 });

// stdin is one UTF-8 stream, decoded as TextDecoderStream decodes it: a U+FEFF is a byte order mark
// only as its first character.
describe.concurrent("U+FEFF", () => {
  const fromStdin: [name: string, stdin: string, lines: string[]][] = [
    ["stays at the start of the second line", `first\n${BOM}second\nthird`, ["first", `${BOM}second`, "third"]],
    [
      "stays everywhere but at the start of stdin",
      `${BOM}first\n${BOM}second\n\n${BOM}fourth\nmid${BOM}dle\n${BOM}${BOM}double\n${BOM}`,
      ["first", `${BOM}second`, "", `${BOM}fourth`, `mid${BOM}dle`, `${BOM}${BOM}double`, BOM],
    ],
    ["stays after an empty first line", `\n${BOM}`, ["", BOM]],
    ["is removed only once at the start of stdin", `${BOM}${BOM}first`, [`${BOM}first`]],
    ["is removed when stdin has no newline", `${BOM}x`, ["x"]],
    ["is removed when it is the whole first line", `${BOM}\nx`, ["", "x"]],
    ["is not E1 BB BF", "\xE1\xBB\xBFx", ["\xE1\xBB\xBFx"]],
    ["is not EF BC BF", "\xEF\xBC\xBFx", ["\xEF\xBC\xBFx"]],
    ["is not EF BB BE", "\xEF\xBB\xBEx", ["\xEF\xBB\xBEx"]],
  ];

  it.each(fromStdin)("%s", async (_, stdin, lines) => {
    expect(await iterate(stdin)).toEqual(printed([lines]));
  });

  // These two do not say if a stdin with nothing after the mark gives one empty line or no line.
  const onlyTheMark: [name: string, args: [stdin: string, reads?: string]][] = [
    ["is removed when it is all of stdin", [BOM]],
    ["is removed when it is all of stdin, split across two reads", ["", JSON.stringify([["\xEF"], ["\xBB\xBF"]])]],
  ];

  it.each(onlyTheMark)("%s", async (_, args) => {
    const { stdout, stderr, exitCode } = await iterate(...args);
    expect({ text: (JSON.parse(stdout) as string[][]).flat().join("\n"), stderr, exitCode }).toEqual({
      text: "",
      stderr: "",
      exitCode: 0,
    });
  });

  it("stays at the start of the second line of a file", async () => {
    using dir = tempDir("console-iterator", {
      "input.txt": Buffer.from(`first\n${BOM}second\nthird`, "latin1"),
    });

    expect(await iterate(Bun.file(dir + "/input.txt"))).toEqual(printed([["first", `${BOM}second`, "third"]]));
  });

  // Each entry of `reads` is the list of chunks that the iterator gets from one read of stdin.
  const fromReads: [name: string, reads: string[][], passes: string[][]][] = [
    [
      "is removed when the first read ends after its first byte",
      [["\xEF"], [`\xBB\xBFa\n${BOM}b`]],
      [["a", `${BOM}b`]],
    ],
    [
      "is removed when the first read ends after its second byte",
      [["\xEF\xBB"], [`\xBFa\n${BOM}b`]],
      [["a", `${BOM}b`]],
    ],
    ["stays at the start of the second read", [["a\n"], [`${BOM}b`]], [["a", `${BOM}b`]]],
    ["stays at the start of the second read, after an empty line", [["\n"], [`${BOM}b`]], [["", `${BOM}b`]]],
    ["stays when two later reads split it", [["a\n\xEF"], ["\xBB\xBFb"]], [["a", `${BOM}b`]]],
    ["stays after a break", [[`a\nbreak\n${BOM}b\n`]], [["a"], [`${BOM}b`]]],
    [
      "stays after a break, in the next chunk of the same read",
      [["a\nbreak\n", `${BOM}b\n${BOM}c`]],
      [["a"], [`${BOM}b`, `${BOM}c`]],
    ],
    ["stays at the start of a read after a break", [["a\nbreak\n"], [`${BOM}b`]], [["a"], [`${BOM}b`]]],
    [
      "stays at the start of a read after a break, when stdin starts with one",
      [[`${BOM}a\nbreak\n`], [`${BOM}b`]],
      [["a"], [`${BOM}b`]],
    ],
  ];

  it.each(fromReads)("%s", async (_, reads, passes) => {
    expect(await iterate("", JSON.stringify(reads))).toEqual(printed(passes));
  });
});

describe.concurrent("decodes each line like TextDecoder", () => {
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  const decode = (bytes: string) => decoder.decode(Buffer.from(bytes, "latin1"));
  const encode = (text: string) => Buffer.from(text).toString("latin1");

  const lines = [
    "caf\xC3\xA9",
    "\xE2\x82\xAC",
    "\xF0\x9F\x92\x95",
    // A lead byte before the newline, and its continuation byte after it.
    "\xC3",
    "\xA9b",
    "\x80\xBF",
    // Overlong forms of "/".
    "\xC0\xAF",
    "\xE0\x80\xAF",
    // U+D800, a surrogate.
    "\xED\xA0\x80",
    // Above U+10FFFF.
    "\xF4\x90\x80\x80",
    "\xFF\xFE",
    "\xF0\x9F",
    "a\xE2\x82",
  ];
  const text = lines.join("\n");
  const decoded = lines.map(line => encode(decode(line)));

  it("from stdin", async () => {
    expect(await iterate(text)).toEqual(printed([decoded]));
  });

  const fromReads: [name: string, reads: string[][], passes: string[][]][] = [
    ["after a break", [[`x\nbreak\n${text}\n`]], [["x"], decoded]],
    ["after a break, in the next chunk of the same read", [["x\nbreak\n", text]], [["x"], decoded]],
    ["when two reads split a character", [["a\n\xE2\x82"], ["\xACb\nc"]], [["a", "\xE2\x82\xACb", "c"]]],
  ];

  it.each(fromReads)("%s", async (_, reads, passes) => {
    expect(await iterate("", JSON.stringify(reads))).toEqual(printed(passes));
  });

  // The lines are those of one decode of all the bytes, however the reads and their chunks cut them.
  it("for 200 seeded ways to cut stdin into reads", async () => {
    let seed = 0x9e3779b9;
    const random = (below: number) => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % below;
    };
    const pieces = [
      ...["a", "\n", "\n", Buffer.alloc(70, "x").toString()],
      ...[BOM, BOM, "\xEF", "\xEF\xBB", "\xBB\xBF", "\xBF"],
      ...["\xC3\xA9", "\xE2\x82\xAC", "\xF0\x9F\x92\x95"],
      ...["\xC3", "\xE2\x82", "\xF0\x9F\x92", "\x80", "\xFF"],
    ];

    const schedules: string[][][] = [];
    const expected: string[][][] = [];
    for (let schedule = 0; schedule < 200; schedule++) {
      // Ends without a newline: the line after a last newline is not what this test is about.
      let bytes = "";
      for (let count = 1 + random(10); count > 0; count--) bytes += pieces[random(pieces.length)];
      bytes += "z";

      const cuts = new Set([0]);
      for (let count = random(5); count > 0; count--) cuts.add(random(bytes.length));
      const starts = [...cuts].sort((a, b) => a - b);
      const reads: string[][] = [];
      starts.forEach((start, index) => {
        const chunk = bytes.slice(start, starts[index + 1]);
        if (index === 0 || random(3) === 0) reads.push([chunk]);
        else reads.at(-1)!.push(chunk);
      });
      schedules.push(reads);

      const decodedText = decode(bytes);
      const withoutMark = decodedText.startsWith("\uFEFF") ? decodedText.slice(1) : decodedText;
      expected.push([withoutMark.split("\n").map(encode)]);
    }

    // The schedules go in as ASCII JSON on the fixture's stdin.
    const json = JSON.stringify(schedules).replace(/[^\x00-\x7f]/g, c => "\\u00" + c.charCodeAt(0).toString(16));
    expect(await iterate(json, "--schedules")).toEqual({ stdout: JSON.stringify(expected), stderr: "", exitCode: 0 });
  });
});

// https://github.com/oven-sh/bun/issues/5175
it("can use the console iterator more than once", async () => {
  const proc = spawn({
    cmd: [bunExe(), import.meta.dir + "/" + "console-iterator-run-2.ts"],
    stdin: "pipe",
    stdout: "pipe",
    env: bunEnv,
  });
  const { stdout, stdin } = proc;
  stdin.write("hello\nworld\nbreak\nanother\nbreak\n");
  await stdin.end();

  expect(await stdout.text()).toBe('["hello","world"]["another"]');
  proc.kill(0);
});
