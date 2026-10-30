// Whether every source of ./fuzz makes a program, asked by the-fuzzer-judges-as-it-says.test.ts in a process of its own.
// The question loads every generator, and what they hold makes each collection of their process longer. Here that slows no other case, and the cases of the test file run beside it.
//
// It prints how many sources it asked, and then a line for each of them that made no program out of any of its seeds.
import { join } from "path";
import type { Bed } from "./fuzz/beds";
import { allSources, inSeveralFiles, writtenAgain } from "./fuzz/sources";

// A bed that builds nothing. A source asks a bed for its name, for what it accepts and allows, and for whether it takes several files.
const bed: Bed = {
  name: "product",
  binary: "stand-in",
  batch: 8,
  buildsAlone: true,
  takesSeveralFiles: true,
  accepts: () => true,
  allows: () => true,
  modes: () => [{ name: "default", flags: [] }],
  withoutFlowResults: [],
  disabling: () => [],
  switches: async () => ({ flowResults: [], passes: [] }),
  judge: async () => [],
};

const sources = await allSources(join(import.meta.dir, "parallel"), new Set(), true);
const startPython = ["by-python", "cases-written-by-scripts"];
const asked = Object.keys(sources).filter(
  name => !startPython.includes(name) && !name.endsWith(inSeveralFiles) && !name.endsWith(writtenAgain),
);
const seeds = Array.from({ length: 24 }, (_, seed) => seed);
console.log(`${asked.length} sources`);
for (const name of asked) if (!seeds.some(seed => sources[name](seed, bed))) console.log(`no program from ${name}`);
