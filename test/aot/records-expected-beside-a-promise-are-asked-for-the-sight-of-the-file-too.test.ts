// settle() of a package hands a record that it writes itself to `source.run()` and reads `parcel.value` off what comes back, awaited where it is a promise.
// Its own declaration file says that a Parcel or a promise of one comes back. What the reader makes of that word is every layout of the program that meets Parcel by names, and Promise beside them.
// The records of an expectation stay only where they are written in sight of the asker's file. That was asked of a type that holds layouts alone: beside a built-in class it was passed over,
// and a checked file that the package never names, which writes a literal under the type Parcel and so makes the record with all its names, took the typed read out of settle().
// Beside each neighbor every unit of checks.js is walked and must read as it reads alone. Functions and files are named by where they are written, records by their names.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { run as runTestaot } from "./engine/testaot";
import { without } from "./harness/capabilities";
import { built, limitOfARun, limitWithASAN, slot } from "./harness/commands";
import { run } from "./harness/run";
import { test, testOneByOne } from "./supported";

const files = {
  "node_modules/parcels/package.json": `{ "name": "parcels", "version": "1.0.0", "type": "module" }`,
  "node_modules/parcels/shapes.d.ts": `export interface Parcel { value: unknown; faults: string[]; note?: string; }
`,
  "node_modules/parcels/checks.js": `export async function settle(source, value) {
  let parcel = source.run({ value, faults: [] });
  if (parcel instanceof Promise) parcel = await parcel;
  const { value: settled, faults } = parcel;
  return faults.length ? undefined : settled;
}
`,
  "node_modules/parcels/checks.d.ts": `import type { Parcel } from "./shapes.js";
export interface Source { run(parcel: Parcel): Parcel | Promise<Parcel>; }
export declare function settle(source: Source, value: unknown): Promise<unknown>;
`,
  "alone.ts": `import { settle } from "parcels/checks.js";
const source = { run(parcel: any) { return JSON.parse("1") ? parcel : Promise.resolve(parcel); } };
(globalThis as any)[JSON.parse('"kept"')] = [settle, source];
console.log(await settle(source, 5));
`,
};
const neighbors: Record<string, string> = {
  "typed-as-the-package-types.ts": `import type { Parcel } from "parcels/shapes.js";
export const made: Parcel[] = [{ value: 1, faults: [] }, { value: 2, faults: [] }];
(globalThis as any)[JSON.parse('"neighbor"')] = made;
`,
  "the-same-names.js": `export const made = { value: 1, faults: [] };\nglobalThis[JSON.parse('"neighbor"')] = made;\n`,
  "one-more-name.ts": `export const made = { value: 1, faults: [] as string[], extra: 7 };\n(globalThis as any)[JSON.parse('"neighbor"')] = made;\n`,
  "one-more-name.js": `export const made = { value: 1, faults: [], extra: 7 };\nglobalThis[JSON.parse('"neighbor"')] = made;\n`,
  "one-of-its-names-by-a-later-store.js": `export const made = { faults: [], extra: 7 };\nmade.value = 1;\nglobalThis[JSON.parse('"neighbor"')] = made;\n`,
  "the-same-names-under-another-prototype.js": `const base = { kind: "crate" };
export const made = { __proto__: base, value: 1, faults: [] };
globalThis[JSON.parse('"neighbor"')] = made;
`,
  "the-same-names-on-a-created-object.js": `export const made = Object.create({ kind: "crate" });
made.value = 1;
made.faults = [];
globalThis[JSON.parse('"neighbor"')] = made;
`,
  "the-optional-name.js": `export const made = { value: 1, faults: [], note: "late" };\nglobalThis[JSON.parse('"neighbor"')] = made;\n`,
  "a-type-of-the-same-names-that-requires-none.ts": `interface Loose { value?: unknown; faults?: string[]; note?: string; }
export const made: Loose = JSON.parse("{}");
(globalThis as any)[JSON.parse('"neighbor"')] = [made, made.value, made.faults, made.note];
`,
  "a-type-of-the-same-names-that-requires-all.ts": `interface Strict { value: unknown; faults: string[]; note: string; }
export const made: Strict = JSON.parse('{"value":1,"faults":[],"note":"late"}');
(globalThis as any)[JSON.parse('"neighbor"')] = [made, made.value, made.faults, made.note];
`,
  "the-optional-name.ts": `import type { Parcel } from "parcels/shapes.js";
export const made: Parcel = { value: 1, faults: [], note: "late" };
(globalThis as any)[JSON.parse('"neighbor"')] = made;
`,
};

// The programs are built, started and walked beside one another. Each command takes a slot, so that no more of them run at once than the machine has processors.
// A build or a start that hangs is killed at its limit and gives its slot back.
const limit = isDebug ? 600_000 : isASAN ? limitWithASAN : limitOfARun;
const inSlot = (command: string[], cwd: string) => slot(() => run(command, cwd, bunEnv, limit));

/** What `testaot` prints of a program. It ends well and says nothing else: a tool that crashed is not taken for a program that reads otherwise. */
async function asked(...command: string[]) {
  const { lines, stderr, exitCode } = await slot(() => runTestaot(...command));
  expect({ asked: command[0], stderr, exitCode }).toEqual({ asked: command[0], stderr: "", exitCode: 0 });
  return lines;
}

/** Of what `testaot print` says of a program: where each module, record and function is written, the units of checks.js, and the files of the project. */
function listedIn(printed: string[]) {
  const places = new Map<string, string>();
  const units: string[] = [];
  const ownFiles: string[] = [];
  for (const line of printed) {
    const module = /^module (m\d+) path="[^"]*?([^/"]+\/[^/"]+)"/.exec(line);
    if (module) places.set(module[1], module[2]);
    // A file of the project is shown by its path from the folder of the build. Bun's own modules are not.
    const ownFile = /^module m\d+ .*?\bdisplayPath="([^"/:][^":]*)"/.exec(line);
    if (ownFile) ownFiles.push(ownFile[1]);
  }
  for (const line of printed) {
    const record = /^layout (L\d+) (?!kind=)/.exec(line);
    if (record) places.set(record[1], `L<${[...line.matchAll(/\{key="([^"]*)"/g)].map(key => key[1]).join()}>`);
    const written = /^function (f\d+) .*?\bmodule=(m\d+)(?: position=(\d+))?/.exec(line);
    if (!written) continue;
    places.set(written[1], `f<${places.get(written[2])}:${written[3] ?? ""}>`);
    if (places.get(written[2]) !== "parcels/checks.js") continue;
    units.push(`${written[1]}:Body`);
    if (/ flags=\[[^\]]*\bIsAsync\b/.test(line)) units.push(`${written[1]}:CoroutineBody`);
  }
  return { places, units, ownFiles };
}

/** alone.ts, or an entry point that imports it and one neighbor: built, started and walked in a folder of its own, which is gone when the answer is there. */
async function walkChecks(neighbor?: string) {
  const entry = neighbor ? `beside-${neighbor}.ts` : "alone.ts";
  using dir = tempDir("aot-records-expected-beside-a-promise", {
    ...files,
    ...(neighbor && { [neighbor]: neighbors[neighbor], [entry]: `import "./alone.ts";\nimport "./${neighbor}";\n` }),
  });
  const cwd = String(dir);
  const [executable, wire] = [join(cwd, `${entry}.exe`), join(cwd, `${entry}.wire`)];
  built(
    await inSlot([bunExe(), "build", "--compile", "--aot", `--aot-out=${wire}`, entry, "--outfile", executable], cwd),
  );
  expect(await inSlot([executable], cwd)).toEqual({ stdout: "5\n", stderr: "", exitCode: 0 });
  const { places, units, ownFiles } = listedIn(await asked("print", wire));
  // The neighbor is a file of the program that is walked: one that the build left out would have no say either.
  expect(ownFiles.sort()).toEqual(
    ["alone.ts", "node_modules/parcels/checks.js", ...(neighbor ? [entry, neighbor] : [])].sort(),
  );
  const walked = await asked("walk", wire, ...units, "exclude=CodeOutsideImage");
  return walked.map(line =>
    line
      .replace(/ # .*| traits=\[[^\]]*\]/g, "")
      .replace(/\b[Lfmgd]\d+\b/g, number => places.get(number) ?? "#")
      .trimEnd(),
  );
}

// A debug build of Bun is 1.8 GB, and so is each executable that it writes: there one program follows another.
const declared = without("testaot") ? test.skip : isDebug ? testOneByOne : test.concurrent;
let walkOfAlone: Promise<string[]> | undefined;
/** The program without a neighbor is built once. The first test starts it, and every other one holds its own program against it. */
const walkedAlone = () => (walkOfAlone ??= walkChecks());

declared(
  "records expected beside a promise are asked for the sight of the file too: settle() reads both names off the record that it writes",
  async () => {
    const typedReads = (await walkedAlone()).flatMap(line => {
      const read = /= GetSlot \S+ key="([^"]*)" receivers=\[([^\]]*)\]/.exec(line);
      return read ? [`${read[1]} of ${read[2]}`] : [];
    });
    expect(typedReads).toEqual(["value of L<faults,value>", "faults of L<faults,value>"]);
  },
  600_000,
);

declared.each(Object.keys(neighbors))(
  "no neighbor has a say: beside %s every unit of checks.js reads as it reads alone",
  async neighbor => expect(await walkChecks(neighbor)).toEqual(await walkedAlone()),
  600_000,
);
