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
// A build takes as long as its program has code, and the search goes over text. So two thirds of a file are comments, in each
// function and in front of each case of a switch: an executable keeps those with the text, and they take no time to compile.
//
// Places all over the long file throw too, and every message is held against what `bun run` says: a search that goes straight to
// a part of the text has to land in the right one, behind types that were cut out and characters that take several bytes. That is
// also asked of the file in one line, as a minifier leaves it, where only the column tells the places apart. A run that is
// measured is held to its messages too: an executable that quotes nothing has searched nothing.
//
// The program measures itself with process.cpuUsage(), around the forty throws alone, so the test needs no counters and runs on
// every platform.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { describe, test } from "./supported";

// A debug build takes a minute to build a long program and half a minute to run the one in one line, on a machine that does
// nothing else.
const limits: { test: number; build?: number; run?: number } = isDebug
  ? { test: 480_000, build: 400_000, run: 200_000 }
  : { test: 120_000 };
raiseDefaultTimeout(limits.test);

const measuredPlaces = 40;
const surroundings = ["statements", "one statement", "one function"] as const;
const keyOf = { "statements": "statement", "one statement": "inStatement", "one function": "inFunction" } as const;
// In the order in which a program comes to them.
const keys = surroundings.map(surrounding => keyOf[surrounding]);
type Milliseconds = Record<(typeof keys)[number], number>;

// Every 31st filler is a place that throws. Some fillers have a type to cut out, some have characters of two, three and four bytes.
const throwsAmongFillers = (index: number) => index % 31 === 5;
const thrownAmong = (fillers: number) =>
  Array.from({ length: fillers }, (_, index) => index).filter(throwsAmongFillers);
const hasLongCharacters = (index: number) => index % 11 === 3;
const filler = (index: number, target: string) =>
  throwsAmongFillers(index)
    ? `(none as any).${target}${index}`
    : hasLongCharacters(index)
      ? `held.${target} = ("é√😀" as string).length + ${index}`
      : `held.${target} = (held.${target} as number) + ${index}`;
// Text that an executable keeps and no build compiles.
const comment = (index: number, lines: number) =>
  `/* ${Array.from(
    { length: lines },
    (_, line) =>
      `Line ${line} of filler ${index} is here to be as long as a line usually is${hasLongCharacters(index) ? ": é√😀" : ""}.`,
  ).join("\n")} */`;

function switchOver(name: string, fillers: number) {
  const cases = Array.from(
    { length: fillers },
    (_, index) => `${comment(index, 2)}\ncase ${index}: ${filler(index, name)}; break;`,
  );
  const measured = Array.from(
    { length: measuredPlaces },
    (_, index) => `case ${fillers + index}: none.${name}Measured${index}; break;`,
  );
  return `for (const step of [${thrownAmong(fillers).join(", ")}, ${measured.map((_, index) => fillers + index).join(", ")}]) {
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
    : `function f${index}(a: number): number {\n${comment(index, 4)}\nreturn a + ${index}; }\nheld.last = f${index};\n${filler(index, "statement")};`,
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

// What a program prints beside its times. The message of a place quotes the read as the file spells it, without the cast.
const quoting = (read: string) => `undefined is not an object (evaluating 'none.${read}')`;
const written = (fillers: number) => ({
  messages: keys.flatMap(key => [
    ...thrownAmong(fillers).map(index => quoting(`${key}${index}`)),
    ...Array.from({ length: measuredPlaces }, (_, index) =>
      quoting(`${key === "statement" ? "measured" : `${key}Measured`}${index}`),
    ),
  ]),
  // The last function that a filler declares adds its index to 1.
  last: 1 + Array.from({ length: fillers }, (_, index) => index).findLast(index => !throwsAmongFillers(index))!,
});

// Every line of code ends in `;`, `{`, `}` or `:` and a comment in its `*/`, so nothing has to stand between two of them.
const inOneLine = (text: string) => text.replaceAll("\n", "");

const short = 20;
const long = 4_000;
// The long ones first: a test of one of them waits for a build of seconds.
const programs = {
  "long": { fillers: long, text: program(long) },
  "long-with-carriage-returns": { fillers: long, text: program(long).replaceAll("\n", "\r\n") },
  "long-in-one-line": { fillers: long, text: inOneLine(program(long)) },
  "short": { fillers: short, text: program(short) },
  "short-in-one-line": { fillers: short, text: inOneLine(program(short)) },
};
type Program = keyof typeof programs;
const names = Object.keys(programs) as Program[];

// What the forty first errors of a long file may take over three times those of the short one, in milliseconds. A long statement
// or function is kept in parts, and a place is found by following the text of its part character by character. The short file
// has no part of that length: the forty places take 1 ms for it in a release build and 80 ms in a debug build.
const slack = isDebug ? 250 : 25;

const dir = tempDir(
  "aot-first-error-at-a-place",
  Object.fromEntries(names.map(name => [`${name}.ts`, programs[name].text])),
);
afterAll(() => dir[Symbol.dispose]());
const folder = String(dir);
const pathOf = (name: Program) => join(folder, isWindows ? `${name}.exe` : name);

/** What a command printed, when it ended with 0 and with nothing on stderr. */
function printed(ran: { stdout: string; stderr: string; exitCode: number }) {
  expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const { messages, last, milliseconds } = JSON.parse(ran.stdout);
  return { said: { messages, last } as ReturnType<typeof written>, milliseconds: milliseconds as Milliseconds };
}

const whenBuilt: Partial<Record<Program, Promise<void>>> = {};
const build = (name: Program) =>
  (whenBuilt[name] ??= spawned(
    [bunExe(), "build", "--compile", "--aot", `./${name}.ts`, "--outfile", pathOf(name)],
    folder,
    bunEnv,
    limits.build,
  ).then(built));

// The runs of an executable, which all its tests share. The next one starts when a test asks for it.
const whenRun: Partial<Record<Program, Promise<Milliseconds>[]>> = {};
const run = (name: Program, index: number) =>
  ((whenRun[name] ??= [])[index] ??= (async () => {
    await build(name);
    const { said, milliseconds } = printed(await spawned([pathOf(name)], folder, bunEnv, limits.run));
    // A run that quotes something else has measured another search, or none.
    expect(said).toEqual(written(programs[name].fillers));
    return milliseconds;
  })());

const runsAtMost = 4;
// Other work on the machine only adds to a time.
async function leastOfAllRuns(name: Program) {
  const least = { ...(await run(name, 0)) };
  for (let index = 1; index < runsAtMost; index++) {
    const again = await run(name, index);
    for (const key of keys) least[key] = Math.min(least[key], again[key]);
  }
  return least;
}

describe.concurrent("the first error at a place costs in a long file what it costs in a short one", () => {
  for (const name of names) {
    test(`${name}: every message is what bun run says`, async () => {
      const plain = printed(await spawned([bunExe(), `./${name}.ts`], folder, bunEnv, limits.run));
      expect(plain.said).toEqual(written(programs[name].fillers));
      // run() holds the executable to the same.
      await run(name, 0);
    });
  }

  for (const [grown, small, measured] of [
    ["long", "short", surroundings],
    ["long-with-carriage-returns", "short", surroundings],
    ["long-in-one-line", "short-in-one-line", ["statements"]],
  ] as const) {
    for (const surrounding of measured) {
      test(`${grown}: ${surrounding}`, async () => {
        const key = keyOf[surrounding];
        const [inSmall, inGrown] = await Promise.all([leastOfAllRuns(small), run(grown, 0)]);
        const few = inSmall[key];
        const bound = 3 * few + slack;
        // Code that costs more does so in every run: the long file runs again only while its least time is over the bound.
        let many = inGrown[key];
        for (let index = 1; index < runsAtMost && !(many < bound); index++)
          many = Math.min(many, (await run(grown, index))[key]);
        console.error(
          `FIRST ERRORS, ${surrounding}: ${few.toFixed(2)} ms for ${measuredPlaces} places in ${small} | ${many.toFixed(2)} ms in ${grown}`,
        );
        expect(many).toBeLessThan(bound);
      });
    }
  }
});
