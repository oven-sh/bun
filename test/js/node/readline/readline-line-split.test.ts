import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import readline from "node:readline";

class FakeInput extends EventEmitter {
  resume() {}
  pause() {}
  write() {}
  end() {}
}

// The line-ending grammar from Node's readline: "\r\n", "\n", a lone "\r",
// "\u2028" or "\u2029". With crlfDelay: Infinity a "\r" at the end of one
// chunk and a "\n" at the start of the next one count as one "\r\n".
function referenceSplit(chunks: string[]): string[] {
  const lineEnding = /\r?\n|\r(?!\n)|\u2028|\u2029/g;
  const out: string[] = [];
  let buffer = "";
  let sawReturn = false;
  for (let string of chunks) {
    if (sawReturn) {
      if (string.codePointAt(0) === 10) string = string.slice(1);
      sawReturn = false;
    }
    lineEnding.lastIndex = 0;
    let match = lineEnding.exec(string);
    if (match !== null) {
      if (buffer) {
        string = buffer + string;
        buffer = "";
        lineEnding.lastIndex = 0;
        match = lineEnding.exec(string);
      }
      sawReturn = string.endsWith("\r");
      const indexes = [0, match!.index, lineEnding.lastIndex];
      let next;
      while ((next = lineEnding.exec(string)) !== null) {
        indexes.push(next.index, lineEnding.lastIndex);
      }
      const last = indexes.length - 1;
      buffer = string.slice(indexes[last]);
      for (let i = 1; i < last; i += 2) {
        out.push(string.slice(indexes[i - 1], indexes[i]));
      }
    } else {
      buffer += string;
    }
  }
  if (buffer) out.push(buffer);
  return out;
}

function interfaceSplit(chunks: string[]): string[] {
  const input = new FakeInput();
  const rl = readline.createInterface({ input, terminal: false, crlfDelay: Infinity });
  const out: string[] = [];
  rl.on("line", line => out.push(line));
  for (const chunk of chunks) input.emit("data", Buffer.from(chunk));
  input.emit("end");
  return out;
}

describe("readline line splitting", () => {
  test.each([
    [["a\nb\nc\n"]],
    [["a\nb\nc"]],
    [["\n\n\n"]],
    [["abc", "\ndef\n"]],
    [["abc", "def", "\n"]],
    [["abc", "def", "gh\nij"]],
    [["a\r", "\nb\n"]],
    [["a\r", "b\n"]],
    [["a\r\nb\rc\n"]],
    [["a\u2028b\u2029c\n"]],
    [["ab", "\u2028c\n"]],
    [["a\nb", "\u2029c"]],
    [["a\n", "", "b\n"]],
    [["\u00e9\n\u00e9", "\n"]],
  ])("splits %j like the reference", chunks => {
    expect(interfaceSplit(chunks)).toEqual(referenceSplit(chunks));
  });

  test("random chunk sequences match the reference", () => {
    const alphabet = ["a", "b", "\n", "\n", "\r", "\r\n", "\u2028", "\u2029", ""];
    let seed = 0x9e3779b9;
    const random = (n: number) => {
      seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x1b873593) >>> 0;
      return seed % n;
    };
    for (let t = 0; t < 3000; t++) {
      const chunks: string[] = [];
      const count = 1 + random(4);
      for (let c = 0; c < count; c++) {
        let s = "";
        const len = random(7);
        for (let i = 0; i < len; i++) s += alphabet[random(alphabet.length)];
        chunks.push(s);
      }
      expect(interfaceSplit(chunks)).toEqual(referenceSplit(chunks));
    }
  });

  test("a line listener that writes more input keeps the order", () => {
    const input = new FakeInput();
    const rl = readline.createInterface({ input, terminal: false });
    const out: string[] = [];
    rl.on("line", line => {
      out.push(line);
      if (line === "a") rl.write("x\ny");
    });
    input.emit("data", Buffer.from("a\nb\nc"));
    input.emit("end");
    expect(out).toEqual(["a", "cx", "b", "y"]);
  });

  test.concurrent.each([1, 2, 3, 7, 64, 65536])("reads a file through createReadStream with highWaterMark %d", async hwm => {
    const lines = Array.from({ length: 30 }, (_, i) => `line${i}`);
    using dir = tempDir("readline-split", { "lines.txt": lines.join("\n") + "\n" });
    const stream = fs.createReadStream(`${dir}/lines.txt`, { highWaterMark: hwm });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const out: string[] = [];
    for await (const line of rl) out.push(line);
    expect(out).toEqual(lines);
  });

  test("splitting a chunk of newline-terminated lines does not allocate an array per line", async () => {
    // The split used one RegExp match array and one rest-args array per line.
    // Count live arrays with the GC off. The "line" event still allocates one
    // arguments array per emit, so the bound is well under two per line.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { heapStats } = require("bun:jsc");
        const readline = require("node:readline");
        const { EventEmitter } = require("node:events");
        const input = new EventEmitter();
        input.resume = input.pause = () => {};
        const rl = readline.createInterface({ input, terminal: false });
        let lines = 0;
        rl.on("line", () => { lines++; });
        const chunk = Buffer.from("abcdefghij\\n".repeat(5000));
        for (let i = 0; i < 5; i++) input.emit("data", chunk);
        const warm = lines;
        const before = heapStats().objectTypeCounts.Array ?? 0;
        for (let i = 0; i < 10; i++) input.emit("data", chunk);
        const after = heapStats().objectTypeCounts.Array ?? 0;
        console.log(JSON.stringify({ lines: lines - warm, arrays: after - before }));
        `,
      ],
      env: { ...bunEnv, BUN_JSC_useGC: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { lines, arrays } = JSON.parse(stdout);
    expect(lines).toBe(50000);
    expect(arrays).toBeLessThan(lines * 2);
    expect(exitCode).toBe(0);
  });
});
