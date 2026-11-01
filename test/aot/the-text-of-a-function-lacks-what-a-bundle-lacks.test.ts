// The text that an executable built with --aot keeps for a function, for toString() and for what an error quotes, lacks the branches that
// `bun build --compile` removes, and holds the values that --define puts in the place of names.
// What only the compiler knows never to run, behind a constant of another file or a value that is always an object, stays as it stays there.
// Its layout is the source's own and not the printer's, so the texts are compared without their white space.
import { expect } from "bun:test";
import { afterAll } from "./harness/declare";
import { rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { withoutDebugInformation } from "./harness/without-debug-information";
import { describe, test } from "./supported";

const sources = {
  "flags.ts": `export const importedFlag = false;\n`,
  "main.ts": `
import { importedFlag } from "./flags";

declare const DEFINED_AS_FALSE: boolean;
declare const DEFINED_AS_TRUE: boolean;
declare const DEFINED_AS_A_NUMBER: number;
declare const DEFINED_AS_A_STRING: string;
declare const SHORT: string;
declare const CONFIG: { a: number; "b-c": string[]; d: { e: null }; f: {}; g: [] };
declare const LIST: number[];
declare const BOTH_QUOTES: string;
declare const DOUBLE_QUOTES: string;
declare const ONE_OF_EACH: string;
declare const FRACTION: number;
declare const NEGATIVE: number;
declare const RENAMED: (x: number) => number;
declare const ACCENTS: string;

function dead(): any {
  return 1;
}

const holder = {};

function statements(o: any): unknown {
  if (false) dead();
  if (false) {
    dead();
    dead();
  }
  if (false) dead();
  else o.a;
  if (true) o.b;
  else dead();
  if (DEFINED_AS_FALSE) {
    dead();
  } else {
    o.c;
  }
  if (DEFINED_AS_TRUE) {
    o.d;
  } else {
    dead();
  }
  if (!DEFINED_AS_TRUE) dead();
  if (importedFlag) dead();
  if (o.e) {
    if (DEFINED_AS_FALSE) dead();
    return o.f;
  }
  while (DEFINED_AS_FALSE) dead();
  return o.g;
}

function expressions(o: any): unknown {
  const a = false && dead();
  const b = true || dead();
  const c = true ? o.a : dead();
  const d = DEFINED_AS_FALSE ? dead() : o.b;
  const e = DEFINED_AS_TRUE ? o.c : dead();
  const f = DEFINED_AS_FALSE && dead();
  const g = DEFINED_AS_TRUE || dead();
  const h = true && o.d;
  const i = false || o.e;
  const j = DEFINED_AS_TRUE && o.f;
  const k = !DEFINED_AS_TRUE || o.g;
  const l = holder ? o.h : dead();
  return [a, b, c, d, e, f, g, h, i, j, k, l];
}

function values(): unknown {
  return [
    DEFINED_AS_FALSE,
    !DEFINED_AS_FALSE,
    !!DEFINED_AS_FALSE,
    DEFINED_AS_A_NUMBER,
    DEFINED_AS_A_STRING,
    process.env.NODE_ENV
  ];
}

function valuesLongerThanWhatIsWritten(o: any): unknown {
  return [SHORT, SHORT.length, !SHORT, { DEFINED_AS_FALSE }, { DEFINED_AS_A_STRING, a: o.a, SHORT }, true && SHORT];
}

function valuesOfOtherKinds(): unknown {
  return [CONFIG, CONFIG.a, { CONFIG }, LIST, BOTH_QUOTES, DOUBLE_QUOTES, ONE_OF_EACH, FRACTION, NEGATIVE, RENAMED(1.5), { RENAMED }, ACCENTS];
}

class Holder {
  method(o: any): unknown {
    if (DEFINED_AS_FALSE) dead();
    return DEFINED_AS_TRUE ? o.a : dead();
  }
}

const arrow = (o: any): unknown => DEFINED_AS_FALSE ? dead() : o.a;

function quotesBehindWhatIsRemoved(o: any): unknown {
  if (DEFINED_AS_FALSE) dead(); return (DEFINED_AS_FALSE ? dead() : o.a).b.c;
}

function quotesBehindAValue(o: any): unknown {
  return [DEFINED_AS_A_STRING, DEFINED_AS_FALSE, o.a.b.c];
}

function quotesBehindALongerValue(o: any): unknown {
  return [SHORT, { DEFINED_AS_FALSE }, o.a.b.c];
}

function quotesBetweenLongerValues(o: any): unknown {
  return [SHORT, o.a.b.c, SHORT]; }

for (const shown of [
  statements,
  expressions,
  values,
  valuesLongerThanWhatIsWritten,
  valuesOfOtherKinds,
  Holder.prototype.method,
  arrow,
]) {
  console.log(shown.toString());
}
// A function that is sent elsewhere as text finds no define there.
for (const sent of [values, valuesLongerThanWhatIsWritten, valuesOfOtherKinds]) {
  console.log(JSON.stringify((0, eval)("(" + sent.toString() + ")")({})));
}
for (const thrower of [quotesBehindWhatIsRemoved, quotesBehindAValue, quotesBehindALongerValue, quotesBetweenLongerValues]) {
  try {
    thrower({ a: {} });
  } catch (error) {
    console.log((error as Error).message);
  }
}
console.log(JSON.stringify([statements({}), expressions({}), values()]));

// At the top level of the file, each in a variable that is read once: there the build once followed a piece that copied itself, without end.
const chosenByADefine = DEFINED_AS_FALSE ? "dropped" : "kept";
console.log(chosenByADefine);
const chosenByTheOther = DEFINED_AS_TRUE ? 1 : 2;
console.log(chosenByTheOther);
const chosenByANegation = !DEFINED_AS_TRUE ? dead() : \`kept \${1 + 1}\`;
console.log(chosenByANegation);
const nestedChoices = DEFINED_AS_TRUE ? (DEFINED_AS_FALSE ? "a" : "b") : "c";
console.log(nestedChoices);
const behindAnd = DEFINED_AS_TRUE && "kept";
console.log(behindAnd);
const behindOr = DEFINED_AS_FALSE || "kept";
console.log(behindOr);
const aValue = DEFINED_AS_A_STRING;
console.log(aValue);
const aLongerValue = SHORT;
console.log(aLongerValue);
const anObject = CONFIG;
console.log(JSON.stringify(anObject));
const chosenBetweenValues = DEFINED_AS_FALSE ? SHORT : DEFINED_AS_A_NUMBER;
console.log(chosenBetweenValues);
`,
};

const defines = [
  "DEFINED_AS_FALSE=false",
  "DEFINED_AS_TRUE=true",
  "DEFINED_AS_A_NUMBER=12",
  'DEFINED_AS_A_STRING="text"',
  'SHORT="a value that is longer than its name"',
  'CONFIG={"a":1,"b-c":["x"],"d":{"e":null},"f":{},"g":[]}',
  "LIST=[1,2]",
  "BOTH_QUOTES=" + JSON.stringify(`it's "so" \\ \${x}`),
  "DOUBLE_QUOTES=" + JSON.stringify(`say "so"`),
  "ONE_OF_EACH=" + JSON.stringify("' \" `"),
  "FRACTION=0.25",
  "NEGATIVE=-3",
  "RENAMED=Math.floor",
  "ACCENTS=" + JSON.stringify("café 中 \u{1f600}"),
  'process.env.NODE_ENV="production"',
].flatMap(define => ["--define", define]);

describe("compile/aot/the text of a function lacks what a bundle lacks", () => {
  const folder = String(tempDir("aot-text-of-a-function-and-a-bundle", sources));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  const printedBy = async (name: string, command: readonly string[]) => {
    const executable = join(folder, isWindows ? `${name}.exe` : name);
    built(
      await spawned(
        [bunExe(), ...command, ...withoutDebugInformation, ...defines, "./main.ts", "--outfile", executable],
        folder,
        bunEnv,
      ),
    );
    const run = await spawned([executable], folder, bunEnv);
    return { stdout: run.stdout.replace(/\s+/g, ""), stderr: run.stderr, exitCode: run.exitCode };
  };

  test("toString() and errors show what an executable built without --aot shows", async () => {
    const plain = await printedBy("plain", ["build", "--compile"]);
    expect(plain.stdout).not.toContain("SHORT,");
    expect(plain.stdout).toContain("production");
    expect(await printedBy("compiled", compileCommand)).toEqual(plain);
  }, 300_000);
});
