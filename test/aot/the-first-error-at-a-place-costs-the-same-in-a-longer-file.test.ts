// The first error at a place costs the same however long the file around it is.
//
// The message of a TypeError quotes what failed. An executable keeps the text that may be quoted in pieces, and finds a place in
// them by its line and column, once for each place that throws. A search that follows the pieces of the file from the top takes
// as long as the file is: with 20,000 functions and statements in front of it, `try { none.x } catch {}` at the top level took
// fifteen times the instructions of the whole rest of the start.
//
// So the same forty places throw once each in a short file and in a long one, in three surroundings:
//
//   statements       each place is a statement of its own at the top level, behind many functions and statements
//   one statement    the places are cases of one `switch` at the top level, behind many other cases
//   one function     the same `switch` in a function
//
// and the long file comes as it is usually written, with carriage returns, and in one line, as a minifier leaves it. There each
// statement touches the next, and the `switch` and the function are as long as their line: what failed is looked for among the
// statements around the place, not in all of the line.
//
// Places all over the long file throw too, and every message is held against what `bun run` says: a search that goes straight to
// a part of the text has to land in the right one, behind types that were cut out and characters that take several bytes. That is
// also asked of the file in one line, as a minifier leaves it, where only the column tells the places apart.
//
// A compiled test run keeps no text. It reads the file, and finds the place in it by following the line up to the column. A line
// as long as the file is followed once, not once for each place, and a name that is read is looked for behind the place alone.
// There the long file in one line is held against the same file in many lines.
//
// The program measures itself with process.cpuUsage(), around the forty throws alone, so the test needs no counters and runs on
// every platform.
//
// A clock sees a cost only where it is dear. What `bun run` prints in place of pieces of the text is listed with the text, and
// that list is read once for a statement or a function, however many places in it throw: how much of it is read is counted.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { runtimeEnvironment } from "./harness/flags";
import { runsWholeGrids } from "./harness/ways";
import { describe, test } from "./measures";

const measuredPlaces = 40;
const surroundings = ["statements", "one statement", "one function"] as const;

// Every 97th filler is a place that throws. Some fillers have a type to cut out, some have characters of two, three and four bytes.
const throwsAmongFillers = (index: number) => index % 97 === 5;
const filler = (index: number, target: string) =>
  throwsAmongFillers(index)
    ? `(none as any).${target}${index}`
    : index % 11 === 3
      ? `held.${target} = ("é√😀" as string).length + ${index}`
      : `held.${target} = (held.${target} as number) + ${index}`;

function switchOver(name: string, fillers: number) {
  const cases = Array.from({ length: fillers }, (_, index) => `case ${index}: ${filler(index, name)}; break;`);
  const measured = Array.from(
    { length: measuredPlaces },
    (_, index) => `case ${fillers + index}: none.${name}Measured${index}; break;`,
  );
  const steps = Array.from({ length: fillers }, (_, index) => index).filter(throwsAmongFillers);
  return `for (const step of [${steps.join(", ")}, ${measured.map((_, index) => fillers + index).join(", ")}]) {
if (step === ${fillers}) start = process.cpuUsage();
try {
switch (step) {
${cases.join("\n")}
${measured.join("\n")}
}
} catch (error) {
messages.push((error as Error).message);
}
}
spend("${name}");`;
}

const program = (fillers: number) => `const none: any = (globalThis as any).nothingHere;
const held: Record<string, unknown> = { statement: 0, inStatement: 0, inFunction: 0 };
const messages: string[] = [];
const milliseconds: Record<string, number> = {};
let start = process.cpuUsage();
function spend(name: string) {
const spent = process.cpuUsage(start);
milliseconds[name] = (spent.user + spent.system) / 1000;
}
${Array.from({ length: fillers }, (_, index) =>
  throwsAmongFillers(index)
    ? `try { ${filler(index, "statement")}; } catch (error) { messages.push((error as Error).message); }`
    : `function f${index}(a: number): number { return a + ${index}; }\nheld.last = f${index};\n${filler(index, "statement")};`,
).join("\n")}
start = process.cpuUsage();
${Array.from(
  { length: measuredPlaces },
  (_, index) => `try { none.measured${index}; } catch (error) { messages.push((error as Error).message); }`,
).join("\n")}
spend("statement");
${switchOver("inStatement", fillers)}
function long() {
${switchOver("inFunction", fillers)}
}
long();
console.log(JSON.stringify({ messages, milliseconds, last: (held.last as (a: number) => number)(1) }));
`;

// Every line of the program ends in `;`, `{`, `}` or `:`, so nothing has to stand between two of them.
const inOneLine = (text: string) => text.replaceAll("\n", "");

const short = 20;
// Of the searches that this file is there for, the cheapest took seven times what is allowed at 12,000, and each grows with the file.
const long = runsWholeGrids ? 12_000 : 6_000;
const programs = {
  "short": program(short),
  "long": program(long),
  "long-with-carriage-returns": program(long).replaceAll("\n", "\r\n"),
  "short-in-one-line": inOneLine(program(short)),
  "long-in-one-line": inOneLine(program(long)),
};
type Program = keyof typeof programs;
const keyOf = { "statements": "statement", "one statement": "inStatement", "one function": "inFunction" } as const;

const dir = tempDir("aot-first-error-at-a-place", {
  ...Object.fromEntries(Object.entries(programs).map(([name, text]) => [`${name}.ts`, text])),
  ...Object.fromEntries(
    Object.keys(programs).map(name => [
      `${name}.test.ts`,
      `import { test } from "bun:test";\ntest("runs", async () => {\n  await import("./${name}.ts");\n});\n`,
    ]),
  ),
});
afterAll(() => dir[Symbol.dispose]());
const folder = String(dir);
const pathOf = (name: Program) => join(folder, isWindows ? `${name}.exe` : name);

type Measured = { messages: string[]; milliseconds: Record<string, number>; last: number };
const whenMeasured: Partial<Record<Program, Promise<Measured>>> = {};
const measure = (name: Program) =>
  (whenMeasured[name] ??= (async () => {
    built(
      await spawned(
        [bunExe(), "build", "--compile", "--aot", `./${name}.ts`, "--outfile", pathOf(name)],
        folder,
        bunEnv,
        400_000,
      ),
    );
    let least: Measured | undefined;
    for (let run = 0; run < 4; run++) {
      const ran = await spawned([pathOf(name)], folder, bunEnv, 200_000);
      expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const measured: Measured = JSON.parse(ran.stdout);
      for (const key in measured.milliseconds)
        measured.milliseconds[key] = Math.min(measured.milliseconds[key], least?.milliseconds[key] ?? Infinity);
      least = measured;
    }
    return least!;
  })());

const whenMeasuredInTestRun: Partial<Record<Program, Promise<Measured>>> = {};
const measureInTestRun = (name: Program) =>
  (whenMeasuredInTestRun[name] ??= (async () => {
    const ran = await spawned([bunExe(), "test", "--aot", `./${name}.test.ts`], folder, bunEnv, 400_000);
    const printed = ran.stdout.split("\n").find(line => line.startsWith(`{"messages"`));
    expect({ printed: printed !== undefined, stderr: printed ? "" : ran.stderr, exitCode: ran.exitCode }).toEqual({
      printed: true,
      stderr: "",
      exitCode: 0,
    });
    return JSON.parse(printed!) as Measured;
  })());

describe.concurrent("in a compiled test run too", () => {
  test("long-in-one-line: every message is what bun run says", async () => {
    const plain = await spawned([bunExe(), "./long-in-one-line.ts"], folder, bunEnv, 200_000);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const expected: Measured = JSON.parse(plain.stdout);
    const { messages, last } = await measureInTestRun("long-in-one-line");
    expect({ messages, last }).toEqual({ messages: expected.messages, last: expected.last });
  }, 480_000);

  for (const surrounding of surroundings) {
    test(`long-in-one-line: ${surrounding}`, async () => {
      const [inLines, inOneLine] = await Promise.all([measureInTestRun("long"), measureInTestRun("long-in-one-line")]);
      const [lines, oneLine] = [inLines, inOneLine].map(measured => measured.milliseconds[keyOf[surrounding]]);
      console.error(
        `FIRST ERRORS IN A TEST RUN, ${surrounding}: ${lines.toFixed(2)} ms for ${measuredPlaces} places in long | ${oneLine.toFixed(2)} ms in long-in-one-line`,
      );
      expect(oneLine).toBeLessThan(3 * lines + 25);
    }, 480_000);
  }
});

describe.concurrent("the first error at a place costs in a long file what it costs in a short one", () => {
  test("long: what is printed in place of the text is read once, not once for each place", async () => {
    await measure("long");
    const counts = join(folder, "counts-of-long");
    const ran = await spawned(
      [pathOf("long")],
      folder,
      { ...bunEnv, [runtimeEnvironment.countsPath]: counts },
      200_000,
    );
    expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const line = readFileSync(counts, "utf8")
      .split("\n")
      .find(line => line.endsWith("\tdecoded:TextPrintedInPlace"));
    const read = Number(line?.split("\t")[0]);
    console.error(`FIRST ERRORS: ${read} pieces of text printed in place were read in long`);
    expect(read).toBeGreaterThan(0);
    // One filler in eleven has such a piece, in each of the three surroundings.
    expect(read).toBeLessThan(long);
  }, 480_000);

  for (const [grown, small, measured] of [
    ["long", "short", surroundings],
    ["long-with-carriage-returns", "short", surroundings],
    ["long-in-one-line", "short-in-one-line", surroundings],
  ] as const) {
    test(`${grown}: every message is what bun run says`, async () => {
      const plain = await spawned([bunExe(), `./${grown}.ts`], folder, bunEnv, 200_000);
      expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const expected: Measured = JSON.parse(plain.stdout);
      expect(expected.messages.length).toBe(3 * (measuredPlaces + Math.ceil((long - 5) / 97)));
      expect(expected.messages.at(-1)).toBe(
        `undefined is not an object (evaluating 'none.inFunctionMeasured${measuredPlaces - 1}')`,
      );
      const { messages, last } = await measure(grown);
      expect({ messages, last }).toEqual({ messages: expected.messages, last: expected.last });
    }, 480_000);

    for (const surrounding of measured) {
      test(`${grown}: ${surrounding}`, async () => {
        const [inSmall, inGrown] = await Promise.all([measure(small), measure(grown)]);
        const [few, many] = [inSmall, inGrown].map(measured => measured.milliseconds[keyOf[surrounding]]);
        console.error(
          `FIRST ERRORS, ${surrounding}: ${few.toFixed(2)} ms for ${measuredPlaces} places in ${small} | ${many.toFixed(2)} ms in ${grown}`,
        );
        expect(many).toBeLessThan(3 * few + 25);
      }, 480_000);
    }
  }
});
