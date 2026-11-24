// A package without types writes no record itself. isClean(parcel): the package's own declaration file says Parcel { value, faults, note? }.
// What is expected of a parameter there goes by the type that a declaration writes for it: the one made record whose written names are exactly the names written without `?`: { faults, value }, whoever writes it.
// The guess is tested at the run. Where nobody makes such a record, nothing is expected.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runTestaot } from "./engine/testaot";
import { without } from "./harness/capabilities";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "node_modules/parcels/package.json": `{ "name": "parcels", "version": "1.0.0", "type": "module" }`,
  "node_modules/parcels/shapes.d.ts": `export interface Parcel { value: unknown; faults: string[]; note?: string; }
`,
  "node_modules/parcels/checks.js": `export function isClean(parcel) { return parcel.faults.length === 0; }
export function weigh(crate, load) { return load * crate.scale + crate.bias; }
`,
  "node_modules/parcels/checks.d.ts": `import type { Parcel } from "./shapes.js";
export declare function isClean(parcel: Parcel): boolean;
`,
  "made.ts": `import * as checks from "parcels/checks.js";
const { isClean, weigh } = checks as any;
const parcels = [{ value: JSON.parse("1"), faults: [] as string[] }, { value: "two", faults: ["wet"] }];
const crates = [{ scale: 3, bias: 1 }, { scale: 2, bias: 5 }];
(globalThis as any).kept = [isClean, weigh, parcels, crates];
console.log(parcels.map(one => isClean(one)).join(), crates.map(one => weigh(one, 2)).join());
`,
  "unmade.ts": `import * as checks from "parcels/checks.js";
const { isClean, weigh } = checks as any;
(globalThis as any).kept = [isClean, weigh];
const read = (text: string) => JSON.parse(text);
console.log([read('{"value":1,"faults":[]}'), read('{"value":"two","faults":["wet"]}')].map(one => isClean(one)).join(), [read('{"scale":3,"bias":1}'), read('{"scale":2,"bias":5}')].map(one => weigh(one, 2)).join());
`,
};

async function walkChecks(cwd: string, entry: string) {
  const [executable, wire] = [join(cwd, `${entry}.exe`), join(cwd, `${entry}.wire`)];
  const build = [bunExe(), "build", "--compile", "--aot", `--aot-out=${wire}`, entry, "--outfile", executable];
  expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
  expect((await run([executable], cwd, bunEnv)).stdout.trim()).toBe("true,false 7,9");
  const places = new Map<string, string>();
  const units: string[] = [];
  const printed = (await runTestaot("print", wire)).lines;
  for (const line of printed) {
    const module = /^module (m\d+) path="[^"]*?([^/"]+\/[^/"]+)"/.exec(line);
    if (module) places.set(module[1], module[2]);
  }
  for (const line of printed) {
    const record = /^layout (L\d+) (?!kind=)/.exec(line);
    if (record) places.set(record[1], `L<${[...line.matchAll(/\{key="([^"]*)"/g)].map(key => key[1]).join()}>`);
    const written = /^function (f\d+) .*?\bmodule=(m\d+)(?: position=(\d+))?/.exec(line);
    if (!written) continue;
    places.set(written[1], `f<${places.get(written[2])}:${written[3] ?? ""}>`);
    if (places.get(written[2]) === "parcels/checks.js") units.push(`${written[1]}:Body`);
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
  "where nothing else is expected of a parameter the names of its type name the record",
  async () => {
    using dir = tempDir("aot-names-of-the-type-of-a-parameter", files);
    const cwd = String(dir);
    const typed = (lines: string[]) => ({
      declared: lines.filter(line => /GetSlot .* key="faults" receivers=\[L<faults,value>\]/.test(line)).length,
    });
    expect({
      made: typed(await walkChecks(cwd, "made.ts")),
      unmade: typed(await walkChecks(cwd, "unmade.ts")),
    }).toEqual({
      made: { declared: 1 },
      unmade: { declared: 0 },
    });
  },
  600_000,
);
