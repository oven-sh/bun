// JSON.parse and JSON.stringify used to abort the process, which no try / catch catches, when the
// allocator refused a buffer of theirs.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux } from "harness";

const MiB = 2 ** 20;
const outOfMemory = "RangeError: Out of memory";

// Runs `script` in a child and returns the object that it fills in as `results`.
async function resultsOf(cmd: string[], env: Record<string, string | undefined>, script: string) {
  await using proc = Bun.spawn({
    cmd: [
      ...cmd,
      bunExe(),
      "-e",
      `
      import { estimateShallowMemoryUsageOf } from "bun:jsc";
      const MiB = ${MiB};
      const results = {};
      const run = (label, fn) => {
        try { results[label] = fn(); } catch (e) { results[label] = String(e); }
      };
      const repeat = (text, count, encoding = "latin1") =>
        Buffer.alloc(text.length * count * (encoding === "latin1" ? 1 : 2), text, encoding).toString(encoding);
      ${script}
      console.log(JSON.stringify(results));
      `,
    ],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim() || stderr).toStartWith("{");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout);
}

// The lexer of JSON.parse gathers a string that has an escape in a buffer, which doubles as it grows.
// `texts(bytes)` has a JSON text for each kind of string in each place that goes to that lexer. The
// buffer has 1024 bytes after the first line of a string and a power of two from then on, so with more
// than `bytes` / 2 in it, it asks for `bytes` and the header of the string. No text is longer than that.
const kinds = ["8-bit", "16-bit", "16-bit from an 8-bit text"];
const places = ["alone", "value", "key", "with a reviver", "in JSON.rawJSON", "in Bun.JSONL.parse"];
const texts = `
  const places = {
    "alone": [string => string, text => JSON.parse(text).length],
    "value": [string => '{"a":[1,' + string + ']}', text => JSON.parse(text).a[1].length],
    "key": [string => '{' + string + ':1}', text => Object.keys(JSON.parse(text))[0].length],
    "with a reviver": [string => '[' + string + ']', text => JSON.parse(text, (key, value) => value)[0].length],
    "in JSON.rawJSON": [string => string, text => JSON.parse(JSON.rawJSON(text).rawJSON).length],
    "in Bun.JSONL.parse": [string => '1\\n' + string + '\\n', text => Bun.JSONL.parse(text)[1].length],
  };
  const texts = bytes => {
    const strings = {
      "8-bit": repeat("\\\\n" + repeat("a", 1023), bytes / 2 / 1024 + 8),
      "16-bit": repeat("\\\\n" + repeat("\\u3042", 511, "utf16le"), bytes / 2 / 1024 + 8, "utf16le"),
      // Appended in one piece, which has twice the bytes of the text.
      "16-bit from an 8-bit text": "\\\\u3042" + repeat("a", bytes / 2 + 8 * 1024 - 1),
    };
    const texts = [];
    for (const kind in strings) {
      for (const place in places) {
        const [wrap, parse] = places[place];
        const text = wrap('"' + strings[kind] + '"');
        texts.push([kind + " " + place, () => parse(text)]);
      }
      // The lexer goes on to the end of the string, so what is wrong inside it is still what is reported.
      const unterminated = '"' + strings[kind];
      texts.push([kind + " unterminated", () => JSON.parse(unterminated)]);
    }
    return texts;
  };
`;
function expected(prefix: string, result: (kind: string) => unknown) {
  const expected: Record<string, unknown> = {};
  for (const kind of kinds) {
    for (const place of places) expected[`${prefix}${kind} ${place}`] = result(kind);
    expected[`${prefix}${kind} unterminated`] = "SyntaxError: JSON Parse error: Unterminated string";
  }
  return expected;
}
const lengthOf = (bytes: number) => (kind: string) => (kind === "16-bit" ? bytes / 4 + 8 * 512 : bytes / 2 + 8 * 1024);

// `BUN_JSC_maxSingleAllocationSize` makes every WTF `try*` allocation above the limit return null. It
// exists in debug WTF only, and the limit of ASAN's allocator does not reach WTF's.
describe.skipIf(!isDebug)("with a limit on the size of one allocation", () => {
  test("JSON.parse throws when the buffer for a string with escapes cannot grow", async () => {
    const limit = 4 * MiB;
    const results = await resultsOf(
      [],
      { ...bunEnv, BUN_JSC_maxSingleAllocationSize: String(limit) },
      `
      ${texts}
      for (const [label, parse] of texts(${limit})) run(label, parse);
      for (const [label, parse] of texts(${limit / 4})) run("shorter " + label, parse);
      `,
    );
    expect(results).toEqual({ ...expected("", () => outOfMemory), ...expected("shorter ", lengthOf(limit / 4)) });
  });
});

// ASAN builds can't start under a limit on the address space. macOS does not enforce one, and Windows has none.
describe.concurrent.skipIf(isASAN || !isLinux)("with a limit on the address space", () => {
  const underLimit = ["/bin/sh", "-c", `ulimit -c 0 && ulimit -v ${2 * 1024 * 1024} && exec "$0" "$@"`];
  // An ArrayBuffer takes address space and, as long as nothing is written to it, no memory.
  const fill = `
    const filling = [];
    const fill = () => {
      for (let size = 64 * MiB; size >= MiB; size /= 2) {
        for (;;) { try { filling.push(new ArrayBuffer(size)); } catch { break; } }
      }
    };
    const empty = () => {
      filling.length = 0;
      Bun.gc(true);
    };
  `;

  test("JSON.parse throws when the buffer for a string with escapes cannot grow", async () => {
    const bytes = 8 * MiB;
    const results = await resultsOf(
      underLimit,
      bunEnv,
      `
      ${fill}
      ${texts}
      const all = texts(${bytes});
      // Besides showing that the texts are right, this makes one piece of each: that needs memory too.
      for (const [label, parse] of all) run("before " + label, parse);
      Bun.gc(true);
      fill();
      for (const [label, parse] of all) run("full " + label, parse);
      empty();
      for (const [label, parse] of all) run("after " + label, parse);
      `,
    );
    expect(results).toEqual({
      ...expected("before ", lengthOf(bytes)),
      ...expected("full ", () => outOfMemory),
      ...expected("after ", lengthOf(bytes)),
    });
  });

  test("JSON.stringify returns its result when the buffer cannot be given its final size", async () => {
    const results = await resultsOf(
      underLimit,
      bunEnv,
      `
      ${fill}
      const length = 16 * MiB;
      // With a replacer the text is built in a StringBuilder, which reserves 6 * length + 2 for a string
      // and, once the text is complete, asks for a buffer of the size of the text.
      const replacer = (key, value) => value;
      const value = { text: repeat("a", length) };
      JSON.stringify({ text: "a" }, replacer);
      Object.assign(results, { wrong: [], refused: 0, keptTheBuffer: 0, gotTheFinalSize: 0 });
      // From no room for the first of the two to room for both.
      for (let room = 5.5; room <= 9; room += 0.25) {
        let space = new ArrayBuffer(room * length);
        fill();
        space = null;
        Bun.gc(true);
        let text;
        try {
          text = JSON.stringify(value, replacer);
          if (text.length !== length + 11 || text.slice(0, 10) !== '{"text":"a' || text.slice(-3) !== 'a"}')
            results.wrong.push([room, text.length, text.slice(0, 10), text.slice(-3)]);
          else if (estimateShallowMemoryUsageOf(text) > 2 * length) results.keptTheBuffer++;
          else results.gotTheFinalSize++;
        } catch (e) {
          if (String(e) === ${JSON.stringify(outOfMemory)}) results.refused++;
          else results.wrong.push([room, String(e)]);
        }
        text = undefined;
        empty();
      }
      `,
    );
    expect(results.wrong).toEqual([]);
    // Without this the test would pass with nothing refused where it matters.
    expect(results.keptTheBuffer).toBePositive();
  });
});
