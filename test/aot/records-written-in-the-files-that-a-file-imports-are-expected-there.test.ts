// checks.js of a package reads `parcel.faults` off a parameter; its own declaration file says that a Parcel comes. What may be expected at a function are the records written in its own file and in the files that it imports
// or requires: those it brings into the program itself. No other file has a say: beside each neighbor that the package never names, every unit of checks.js is walked and must read as it reads alone, with functions,
// files and layouts named by where they are written. The functions are kept under a name that only the run knows: the program does not see who calls them.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runTestaot } from "./engine/testaot";
import { without } from "./harness/capabilities";
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

async function walkChecks(cwd: string, entry: string, said = "true,false 1,4") {
  const [executable, wire] = [join(cwd, `${entry}.exe`), join(cwd, `${entry}.wire`)];
  const build = [bunExe(), "build", "--compile", "--aot", `--aot-out=${wire}`, entry, "--outfile", executable];
  expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
  expect((await run([executable], cwd, bunEnv)).stdout.trim()).toBe(said);
  const places = new Map<string, string>();
  const units: string[] = [];
  const printed = (await runTestaot("print", wire)).lines;
  for (const line of printed) {
    const module = /^module (m\d+) path="[^"]*?([^/"]+\/[^/"]+)"/.exec(line);
    if (module) places.set(module[1], module[2]);
  }
  for (const line of printed) {
    const written = /^(?:function|layout) ([fL]\d+) .*?\bmodule=(m\d+)(?: position=(\d+))?/.exec(line);
    if (!written) continue;
    places.set(written[1], `${written[1][0]}<${places.get(written[2])}:${written[3] ?? ""}>`);
    if (written[1][0] === "f" && places.get(written[2]) === "parcels/checks.js") units.push(`${written[1]}:Body`);
  }
  const walked = (await runTestaot("walk", wire, ...units, "exclude=CodeOutsideImage")).lines;
  return walked.map(line =>
    line
      .replace(/ # .*| traits=\[[^\]]*\]/g, "")
      .replace(/\b[Lfmgd]\d+\b/g, number => places.get(number) ?? "#")
      .trimEnd(),
  );
}

test.skipIf(!!without("testaot"))(
  "records written in the files that a file imports are expected there, and no neighbor has a say",
  async () => {
    const entries = Object.keys(neighbors).map(name => [
      `beside-${name}.ts`,
      `import "./alone.ts";\nimport "./${name}";\n`,
    ]);
    using dir = tempDir("aot-records-written-in-the-files-that-a-file-imports", {
      ...files,
      ...neighbors,
      ...Object.fromEntries(entries),
    });
    const cwd = String(dir);
    const alone = await walkChecks(cwd, "alone.ts");
    expect(
      alone.filter(line => /GetSlot .* key="faults" receivers=\[L<parcels\/shapes\.js:\d+>\]/.test(line)).length,
    ).toBeGreaterThan(1);
    for (const [entry] of entries)
      expect({ entry, walked: await walkChecks(cwd, entry) }).toEqual({ entry, walked: alone });
  },
  600_000,
);
