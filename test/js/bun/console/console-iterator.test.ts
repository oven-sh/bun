import { spawn, spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

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

// A loop that is left ends its iterator. The next loop gets a new iterator, and that iterator
// continues at the byte where the last one stopped.
describe.concurrent("a new loop continues where the last loop stopped", () => {
  const takeOneLine = {
    "return": `for await (const line of console) return line; return null;`,
    "break": `let answer = null; for await (const line of console) { answer = line; break; } return answer;`,
    "throw": `let answer = null; try { for await (const line of console) { answer = line; throw new Error("stop"); } } catch {} return answer;`,
    "iterator.return()": `const lines = console[Symbol.asyncIterator](); const { value, done } = await lines.next(); await lines.return(); return done ? null : value;`,
    "iterator.throw()": `const lines = console[Symbol.asyncIterator](); const { value, done } = await lines.next(); await lines.throw(new Error("stop")).catch(() => {}); return done ? null : value;`,
  };

  // The child runs `asks` loops that take one line each, then `loops` loops that read to the end
  // of the input. It prints what each loop got, as JSON, when the loop ends: a line (`null` at
  // the end of the input), or the array of lines. The top-level await keeps the process alive
  // while a loop waits for input.
  const program = (asks: number, loops: number, leave: keyof typeof takeOneLine = "return") => `
    async function ask() { ${takeOneLine[leave]} }
    async function rest() { const lines = []; for await (const line of console) lines.push(line); return lines; }
    for (let n = 0; n < ${asks}; n++) console.log(JSON.stringify(await ask()));
    for (let n = 0; n < ${loops}; n++) console.log(JSON.stringify(await rest()));
  `;

  async function run(script: string, pieces: (string | Uint8Array)[], asks = 0) {
    await using proc = spawn({
      cmd: [bunExe(), "-e", script],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const stderr = proc.stderr.text();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    const printed = () => stdout.split("\n").length - 1;

    let lineFeeds = 0;
    for (const piece of pieces) {
      proc.stdin.write(piece);
      await proc.stdin.flush();
      // A loop that takes one line prints it at once. Wait for these lines before the next
      // write, so that the child reads each piece as a chunk of its own.
      lineFeeds += Buffer.from(piece).filter(byte => byte === 0x0a).length;
      while (printed() < Math.min(lineFeeds, asks)) {
        const { value, done } = await reader.read();
        if (done) break;
        stdout += decoder.decode(value, { stream: true });
      }
    }
    await proc.stdin.end();
    for (let { value, done } = await reader.read(); !done; { value, done } = await reader.read()) {
      stdout += decoder.decode(value, { stream: true });
    }

    const lines = stdout.split("\n").slice(0, -1);
    return { printed: lines.map(line => JSON.parse(line)), stderr: await stderr, exitCode: await proc.exited };
  }

  const section = Buffer.from("a\n§\n");

  const rows: [name: string, pieces: (string | Uint8Array)[], asks: number, loops: number, printed: unknown[]][] = [
    // The chunk that the first loop stops in ends in the middle of a line.
    ["the input ends with no line feed", ["a\nb"], 5, 0, ["a", "b", null, null, null]],
    ["three lines, the last with no line feed", ["a\nb\nc"], 5, 0, ["a", "b", "c", null, null]],
    ["a line comes in two pieces", ["a\nb", "c\n"], 5, 0, ["a", "bc", null, null, null]],
    [
      "a line comes in two pieces, more lines follow",
      ["a\nbbbb", "cccc\nd\n"],
      5,
      0,
      ["a", "bbbbcccc", "d", null, null],
    ],
    [
      "a character comes in two pieces",
      [section.subarray(0, 3), section.subarray(3)],
      5,
      0,
      ["a", "§", null, null, null],
    ],
    ["one line, then a loop to the end", ["a\nb\nc"], 1, 1, ["a", ["b", "c"]]],
    // Only one loop gets a last line that has no line feed.
    ["one line with no line feed", ["b"], 5, 0, ["b", null, null, null, null]],
    ["the last piece has no line feed", ["a\n", "b"], 5, 0, ["a", "b", null, null, null]],
    ["three loops to the end", ["a\nb"], 0, 3, [["a", "b"], [], []]],
    ["three loops to the end, the input ends with a line feed", ["a\nb\n"], 0, 3, [["a", "b", ""], [], []]],
    // Unchanged: a final line feed gives a last line "" only to a loop that reads the last chunk
    // from its start to the end of the input.
    ["whole lines in one piece", ["a\nb\n"], 5, 0, ["a", "b", null, null, null]],
    ["one whole line in each piece", ["a\n", "b\n", "c\n"], 5, 0, ["a", "b", "c", null, null]],
    ["one line, then a loop to the end of the same piece", ["a\nb\n"], 1, 1, ["a", ["b"]]],
    ["one line, then a loop to the end of the next piece", ["a\n", "b\n"], 1, 1, ["a", ["b", ""]]],
    ["no input", [], 5, 0, [null, null, null, null, null]],
    // Unchanged, and not a rule: one loop yields the text after the last line feed as a last line,
    // also when it is empty, and only Windows removes a "\r" before a line feed.
    ["one loop, the input ends with no line feed", ["a\nb"], 0, 1, [["a", "b"]]],
    ["one loop, the input ends with a line feed", ["a\nb\n"], 0, 1, [["a", "b", ""]]],
    ["one loop, the input is a line feed", ["\n"], 0, 1, [["", ""]]],
    ["one loop, no input", [], 0, 1, [[]]],
    ["one loop, \\r\\n", ["a\r\nb\r\n"], 0, 1, [isWindows ? ["a", "b", ""] : ["a\r", "b\r", ""]]],
    // A later loop takes the "\r" away, or keeps it, like the first loop.
    ["\\r\\n", ["a\r\nb\r\nc\r\n"], 3, 0, isWindows ? ["a", "b", "c"] : ["a\r", "b\r", "c\r"]],
  ];

  for (const [name, pieces, asks, loops, printed] of rows) {
    it(name, async () => {
      expect(await run(program(asks, loops), pieces, asks)).toEqual({ printed, stderr: "", exitCode: 0 });
    });
  }

  for (const leave of Object.keys(takeOneLine) as (keyof typeof takeOneLine)[]) {
    it(`the loop is left with ${leave}`, async () => {
      expect(await run(program(5, 0, leave), ["a\nb", "c\nd"], 5)).toEqual({
        printed: ["a", "bc", "d", null, null],
        stderr: "",
        exitCode: 0,
      });
    });
  }

  // A pipe does not give two chunks in one read on demand, so the child reads a stream of its own.
  it("two chunks come in one read", async () => {
    const script = `
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("a\\nb"));
          controller.enqueue(encoder.encode("c\\nd\\n"));
          controller.close();
        },
      });
      Bun.stdin.stream = () => stream;
      ${program(5, 0)}
    `;
    expect(await run(script, [])).toEqual({ printed: ["a", "bc", "d", null, null], stderr: "", exitCode: 0 });
  });

  it("a read fails after a loop stopped in a chunk", async () => {
    const script = `
      const encoder = new TextEncoder();
      const chunks = ["a\\nb", "c\\nd"];
      const stream = new ReadableStream(
        {
          pull(controller) {
            if (chunks.length) controller.enqueue(encoder.encode(chunks.shift()));
            else controller.error(new Error("the read failed"));
          },
        },
        { highWaterMark: 0 },
      );
      Bun.stdin.stream = () => stream;
      async function ask() {
        try {
          for await (const line of console) return line;
          return null;
        } catch (error) {
          return "threw: " + error.message;
        }
      }
      for (let n = 0; n < 5; n++) console.log(JSON.stringify(await ask()));
      console.log(JSON.stringify({ locked: stream.locked }));
    `;
    const threw = "threw: the read failed";
    expect(await run(script, [])).toEqual({
      printed: ["a", "bc", threw, threw, threw, { locked: false }],
      stderr: "",
      exitCode: 0,
    });
  });

  it("a line or a chunk that throws fails one loop, and the next loop continues after it", async () => {
    const script = `
      const encoder = new TextEncoder();
      const decode = TextDecoder.prototype.decode;
      TextDecoder.prototype.decode = function (bytes) {
        const text = decode.call(this, bytes);
        if (text === "bad line") throw new Error("this line cannot be decoded");
        return text;
      };
      const chunks = [
        encoder.encode("a\\nbad line\\nc\\n"),
        "not bytes",
        encoder.encode("bytes with no subarray()").buffer,
        encoder.encode("d\\ne"),
        "not bytes, with the rest of a line before it",
        encoder.encode("f\\n"),
      ];
      const stream = new ReadableStream(
        {
          pull(controller) {
            if (chunks.length) controller.enqueue(chunks.shift());
            else controller.close();
          },
        },
        { highWaterMark: 0 },
      );
      Bun.stdin.stream = () => stream;
      async function ask() {
        try {
          for await (const line of console) return line;
          return null;
        } catch {
          return "threw";
        }
      }
      for (let n = 0; n < 9; n++) console.log(JSON.stringify(await ask()));
    `;
    expect(await run(script, [])).toEqual({
      printed: ["a", "threw", "c", "threw", "threw", "d", "threw", "ef", null],
      stderr: "",
      exitCode: 0,
    });
  });

  it("an iterator that cannot start leaves the running iterator as it is", async () => {
    const script = `
      const running = console[Symbol.asyncIterator]();
      const printed = [(await running.next()).value];
      await console[Symbol.asyncIterator]().next().catch(() => {});
      for (let step = await running.next(); !step.done; step = await running.next()) printed.push(step.value);
      console.log(JSON.stringify(printed));
    `;
    expect(await run(script, ["a\n"])).toEqual({ printed: [["a", ""]], stderr: "", exitCode: 0 });
  });
});
