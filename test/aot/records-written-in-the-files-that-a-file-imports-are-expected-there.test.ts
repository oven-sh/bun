// checks.js of a package reads `parcel.faults` off a parameter; its own declaration file says that a Parcel comes. What may be expected at a function are the records written in its own file and in the files that it imports
// or requires: those it brings into the program itself. No other file has a say: beside each neighbor that the package never names, every unit of checks.js is walked and must read as it reads alone, with functions,
// files and layouts named by where they are written. The functions are kept under a name that only the run knows: the program does not see who calls them.
// A program is built, started and walked once, for all the tests that ask for it, and as many programs at once as there are processors.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { join } from "node:path";
import { run as runTestaot } from "./engine/testaot";
import { without } from "./harness/capabilities";
import { limitOfARun, limitWithASAN, slot } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "node_modules/parcels/package.json": `{ "name": "parcels", "version": "1.0.0", "type": "module" }`,
  "node_modules/parcels/shapes.js": `export function open(value) { return { value, faults: [] }; }
export function spoil(parcel, fault) { parcel.faults.push(fault); return parcel; }
`,
  "node_modules/parcels/shapes.d.ts": `export interface Parcel { value: unknown; faults: string[]; }
export declare function open(value: unknown): Parcel;
export declare function spoil(parcel: Parcel, fault: string): Parcel;
`,
  "node_modules/parcels/checks.js": `import "./shapes.js";
export function isClean(parcel) { return parcel.faults.length === 0; }
export function weigh(parcel) { let sum = parcel.value === undefined ? 0 : 1; for (let i = 0; i < parcel.faults.length; i++) sum += parcel.faults[i].length; return sum; }
`,
  "node_modules/parcels/checks.d.ts": `import type { Parcel } from "./shapes.js";
export declare function isClean(parcel: Parcel): boolean;
export declare function weigh(parcel: Parcel): number;
`,
  "alone.ts": `import { isClean, weigh } from "parcels/checks.js";
import { open, spoil } from "parcels/shapes.js";
const parcels = [open(JSON.parse("1")), spoil(open("two"), "wet")];
(globalThis as any)[process.argv[9] ?? "kept"] = [isClean, weigh, parcels];
console.log(parcels.map(one => isClean(one)).join(), parcels.map(one => weigh(one)).join());
`,
};
const neighbors: Record<string, string> = {
  "typed-as-the-package-types.ts": `import type { Parcel } from "parcels/shapes.js";
export const made: Parcel[] = [{ value: 1, faults: [] }, { value: 2, faults: [] }];
(globalThis as any).neighbor = made;
`,
  "calls-the-package.ts": `import { isClean } from "parcels/checks.js";
export const made = { value: 1, faults: [], extra: 7 };
(globalThis as any).neighbor = isClean(made as any);
`,
  "the-same-names.ts": `export const made = { value: 1, faults: [] as string[] };\n(globalThis as any).neighbor = made;\n`,
  "the-same-names.js": `export const made = { value: 1, faults: [] };\nglobalThis.neighbor = made;\n`,
  "one-more-name.ts": `export const made = { value: 1, faults: [] as string[], extra: 7 };\n(globalThis as any).neighbor = made;\n`,
  "one-more-name.js": `export const made = { value: 1, faults: [], extra: 7 };\nglobalThis.neighbor = made;\n`,
  "another-prototype.js": `export const made = { value: 1, faults: [] };\nObject.setPrototypeOf(made, { spoiled: true });\nglobalThis.neighbor = made;\n`,
};
const beside = (neighbor: string) => `beside-${neighbor}.ts`;

// The one record of the package and the body of a function of checks.js, named as a walk is made to name them: by where they are written.
const record = `L<parcels/shapes.js:${files["node_modules/parcels/shapes.js"].indexOf("{ value, faults: [] }")}>`;
const unitOf = (name: string) =>
  `f<parcels/checks.js:${files["node_modules/parcels/checks.js"].indexOf(`export function ${name}(`)}>:Body`;

let dir: ReturnType<typeof tempDir> | undefined;
afterAll(() => dir?.[Symbol.dispose]());
const folder = () =>
  String(
    (dir ??= tempDir("aot-records-written-in-the-files-that-a-file-imports", {
      ...files,
      ...neighbors,
      ...Object.fromEntries(
        Object.keys(neighbors).map(name => [beside(name), `import "./alone.ts";\nimport "./${name}";\n`]),
      ),
    })),
  );

// bun:test ends the commands of a test whose time is up only where no other test runs beside it. A build or a program that hangs is ended here, and fails its test.
const limit = isASAN ? limitWithASAN : limitOfARun;

async function walkChecks(cwd: string, entry: string) {
  const [executable, wire] = [join(cwd, `${entry}.exe`), join(cwd, `${entry}.wire`)];
  const build = [bunExe(), "build", "--compile", "--aot", `--aot-out=${wire}`, entry, "--outfile", executable];
  const built = await run(build, cwd, bunEnv, limit);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run([executable], cwd, bunEnv, limit)).toEqual({ stdout: "true,false 1,4\n", stderr: "", exitCode: 0 });
  const printed = await runTestaot("print", wire);
  expect({ stderr: printed.stderr, exitCode: printed.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const places = new Map<string, string>();
  const program: string[] = [];
  for (const line of printed.lines) {
    const module = /^module (m\d+) path="[^"]*?([^/"]+\/[^/"]+)"/.exec(line);
    if (module) places.set(module[1], module[2]);
    // A module of Bun has a kind or is a library.
    const own = /^module m\d+ path="[^"]*" displayPath="([^"]*)"(?! kind=| flags=\[[^\]]*\bIsLibrary\b)/.exec(line);
    if (own) program.push(own[1]);
  }
  const units: string[] = [];
  const stated: [name: string, parameters: string][] = [];
  for (const line of printed.lines) {
    const written = /^(?:function|layout) ([fL]\d+) .*?\bmodule=(m\d+)(?: position=(\d+))?/.exec(line);
    if (!written) continue;
    places.set(written[1], `${written[1][0]}<${places.get(written[2])}:${written[3] ?? ""}>`);
    if (written[1][0] !== "f" || places.get(written[2]) !== "parcels/checks.js") continue;
    units.push(`${written[1]}:Body`);
    const named = / name="([^"]*)" .*? parameters=\[(.*?)\] results=/.exec(line);
    if (named) stated.push([named[1], named[2]]);
  }
  const placed = (text: string) => text.replace(/\b[Lfmgd]\d+\b/g, number => places.get(number) ?? "#");
  const walked = await runTestaot("walk", wire, ...units, "exclude=CodeOutsideImage");
  expect({ stderr: walked.stderr, exitCode: walked.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return {
    /** The files of the program, without those of Bun. */
    program: program.sort(),
    /** What the program states of the parameters of each function of checks.js. */
    parameters: Object.fromEntries(stated.map(([name, parameters]) => [name, placed(parameters)])),
    /** Every unit of checks.js as the compiler leaves it. */
    code: walked.lines.map(line => placed(line.replace(/ # .*| traits=\[[^\]]*\]/g, "")).trimEnd()),
  };
}

const walks = new Map<string, ReturnType<typeof walkChecks>>();
const walkOf = (entry: string) => walks.getOrInsertComputed(entry, () => slot(() => walkChecks(folder(), entry)));

/** Both, when both have ended: a test that fails on the one leaves no commands of the other behind. */
async function both<One, Other>(one: Promise<One>, other: Promise<Other>): Promise<[One, Other]> {
  await Promise.allSettled([one, other]);
  return [await one, await other];
}

const declared = without("testaot") ? test.skip : test.concurrent;

declared("records written in the files that a file imports are expected there", async () => {
  const alone = await walkOf("alone.ts");
  // The records off which each unit reads `faults` as a slot.
  const read: Record<string, string[]> = {};
  let unit = "";
  for (const line of alone.code) {
    unit = /^code (\S+) \{/.exec(line)?.[1] ?? unit;
    const receivers = / = GetSlot .* key="faults" receivers=\[([^\]]*)\]/.exec(line)?.[1];
    if (receivers !== undefined && !(read[unit] ??= []).includes(receivers)) read[unit].push(receivers);
  }
  const aParcel = `{type=undefined|null|${record} flags=[IsExpected]}`;
  expect({ program: alone.program, parameters: alone.parameters, read }).toEqual({
    program: ["alone.ts", "node_modules/parcels/checks.js", "node_modules/parcels/shapes.js"],
    parameters: { isClean: aParcel, weigh: aParcel },
    read: { [unitOf("isClean")]: [record], [unitOf("weigh")]: [record] },
  });
});

declared.each(Object.keys(neighbors))("beside %s every unit of checks.js reads as it reads alone", async name => {
  const [alone, walked] = await both(walkOf("alone.ts"), walkOf(beside(name)));
  expect(walked).toEqual({
    program: [...alone.program, beside(name), name].sort(),
    parameters: alone.parameters,
    code: alone.code,
  });
});
