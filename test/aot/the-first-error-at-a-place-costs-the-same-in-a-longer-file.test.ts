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
// and the long file comes as it is usually written and with carriage returns. In one line, as a minifier leaves it, each statement
// touches the next: there the statements of their own are measured.
//
// Places all over the long file throw too, and every message is held against what `bun run` says: a search that goes straight to
// a part of the text has to land in the right one, behind types that were cut out and characters that take several bytes. That is
// also asked of the file in one line, as a minifier leaves it, where only the column tells the places apart.
//
// The program measures itself with process.cpuUsage(), around the forty throws alone, so the test needs no counters and runs on
// every platform.
import { expect } from "bun:test";
import { afterAll } from "./harness/declare";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { describe, test } from "./supported";

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
const long = 12_000;
const programs = {
  "short": program(short),
  "long": program(long),
  "long-with-carriage-returns": program(long).replaceAll("\n", "\r\n"),
  "short-in-one-line": inOneLine(program(short)),
  "long-in-one-line": inOneLine(program(long)),
};
type Program = keyof typeof programs;
const keyOf = { "statements": "statement", "one statement": "inStatement", "one function": "inFunction" } as const;

const dir = tempDir(
  "aot-first-error-at-a-place",
  Object.fromEntries(Object.entries(programs).map(([name, text]) => [`${name}.ts`, text])),
);
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

describe.concurrent("the first error at a place costs in a long file what it costs in a short one", () => {
  for (const [grown, small, measured] of [
    ["long", "short", surroundings],
    ["long-with-carriage-returns", "short", surroundings],
    ["long-in-one-line", "short-in-one-line", ["statements"]],
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
