// settle() of a package hands a record that it writes itself to `source.run()` and reads `parcel.value` off what comes back, awaited where it is a promise.
// Its own declaration file says that a Parcel or a promise of one comes back. What the reader makes of that word is every layout of the program that meets Parcel by names, and Promise beside them.
// The records of an expectation stay only where they are written in sight of the asker's file. That was asked of a type that holds layouts alone: beside a built-in class it was passed over,
// and a checked file that the package never names, which writes a literal under the type Parcel and so makes the record with all its names, took the typed read out of settle().
// Beside each neighbor every unit of checks.js is walked and must read as it reads alone. Functions and files are named by where they are written, records by their names.
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
  "node_modules/parcels/checks.js": `export async function settle(source, value) {
  let parcel = source.run({ value, faults: [] });
  if (parcel instanceof Promise) parcel = await parcel;
  return parcel.faults.length ? undefined : parcel.value;
}
`,
  "node_modules/parcels/checks.d.ts": `import type { Parcel } from "./shapes.js";
export interface Source { run(parcel: Parcel): Parcel | Promise<Parcel>; }
export declare function settle(source: Source, value: unknown): Promise<unknown>;
`,
  "alone.ts": `import { settle } from "parcels/checks.js";
const source = { run(parcel: any) { return JSON.parse("1") ? parcel : Promise.resolve(parcel); } };
(globalThis as any).kept = [settle, source];
console.log(await settle(source, 5));
`,
};
const neighbors: Record<string, string> = {
  "typed-as-the-package-types.ts": `import type { Parcel } from "parcels/shapes.js";
export const made: Parcel[] = [{ value: 1, faults: [] }, { value: 2, faults: [] }];
(globalThis as any).neighbor = made;
`,
  "the-same-names.js": `export const made = { value: 1, faults: [] };\nglobalThis.neighbor = made;\n`,
  "one-more-name.ts": `export const made = { value: 1, faults: [] as string[], extra: 7 };\n(globalThis as any).neighbor = made;\n`,
  "one-more-name.js": `export const made = { value: 1, faults: [], extra: 7 };\nglobalThis.neighbor = made;\n`,
  "one-of-its-names-by-a-later-store.js": `export const made = { faults: [], extra: 7 };\nmade.value = 1;\nglobalThis.neighbor = made;\n`,
  "the-same-names-under-another-prototype.js": `const base = { kind: "crate" };
export const made = { __proto__: base, value: 1, faults: [] };
globalThis.neighbor = made;
`,
  "the-same-names-on-a-created-object.js": `export const made = Object.create({ kind: "crate" });
made.value = 1;
made.faults = [];
globalThis.neighbor = made;
`,
  "the-optional-name.js": `export const made = { value: 1, faults: [], note: "late" };\nglobalThis.neighbor = made;\n`,
  "a-type-of-the-same-names-that-requires-none.ts": `interface Loose { value?: unknown; faults?: string[]; note?: string; }
export const made: Loose = JSON.parse("{}");
(globalThis as any).neighbor = [made, made.value, made.faults, made.note];
`,
  "a-type-of-the-same-names-that-requires-all.ts": `interface Strict { value: unknown; faults: string[]; note: string; }
export const made: Strict = JSON.parse('{"value":1,"faults":[],"note":"late"}');
(globalThis as any).neighbor = [made, made.value, made.faults, made.note];
`,
  "the-optional-name.ts": `import type { Parcel } from "parcels/shapes.js";
export const made: Parcel = { value: 1, faults: [], note: "late" };
(globalThis as any).neighbor = made;
`,
};

async function walkChecks(cwd: string, entry: string) {
  const [executable, wire] = [join(cwd, `${entry}.exe`), join(cwd, `${entry}.wire`)];
  const build = [bunExe(), "build", "--compile", "--aot", `--aot-out=${wire}`, entry, "--outfile", executable];
  expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
  expect((await run([executable], cwd, bunEnv)).stdout.trim()).toBe("5");
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
    if (places.get(written[2]) !== "parcels/checks.js") continue;
    units.push(`${written[1]}:Body`);
    if (/ flags=\[[^\]]*\bIsAsync\b/.test(line)) units.push(`${written[1]}:CoroutineBody`);
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
  "records expected beside a promise are asked for the sight of the file too, and no neighbor has a say",
  async () => {
    const entries = Object.keys(neighbors).map(name => [
      `beside-${name}.ts`,
      `import "./alone.ts";\nimport "./${name}";\n`,
    ]);
    using dir = tempDir("aot-records-expected-beside-a-promise", {
      ...files,
      ...neighbors,
      ...Object.fromEntries(entries),
    });
    const cwd = String(dir);
    const alone = await walkChecks(cwd, "alone.ts");
    expect(
      alone.filter(line => /GetSlot .* key="value" receivers=\[L<faults,value>\]/.test(line)).length,
    ).toBeGreaterThan(0);
    for (const [entry] of entries)
      expect({ entry, walked: await walkChecks(cwd, entry) }).toEqual({ entry, walked: alone });
  },
  600_000,
);
