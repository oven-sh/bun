// Stored programs with a second name laid over their lists, their objects, their Maps and Sets (./harness/second-names.ts): the run acts on a spare one,
// so each prints what it printed before, and the compiler's own look at the end must find nothing to refuse.
// CI runs every fifth program, one road and act each. All of them, six each: BUN_AOT_WHOLE_SECOND_NAMES_SWEEP=1.
// On another compiler, or with more variants: ./tools/second-names-sweep.ts.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  built,
  slot,
  spawned,
  told,
  withoutCoreDump,
  withoutCrashReport,
  withoutDebugInformation,
} from "./harness/commands";
import { hashOf, variantsFor, withSecondNames, type Kind, type Options } from "./harness/second-names";
import { describe, test, unsupported } from "./supported";

const whole = !!process.env.BUN_AOT_WHOLE_SECOND_NAMES_SWEEP;
const root = join(import.meta.dir, "parallel");
const foldersOf: Record<Kind, string[]> = {
  list: [
    "arrays",
    "second-names",
    "untyped-loops",
    "loops-lists-changed",
    "loops-values-behind-tests",
    "one-loop-against-another",
  ],
  object: ["objects", "classes", "typed-objects", "calls-fast-paths", "escape-analysis", "classes-and-closures"],
  collection: ["builtins", "untyped-code", "objects", "objects-that-escape-on-one-path", "calls"],
};
const known = new Set(
  readFileSync(join(import.meta.dir, "second-names-sweep.known.txt"), "utf8")
    .split("\n")
    .filter(line => line && !line.startsWith("#")),
);

const cases = (Object.keys(foldersOf) as Kind[]).flatMap(kind =>
  foldersOf[kind]
    .flatMap(folder =>
      readdirSync(join(root, folder))
        .filter(name => /\.(js|mjs|cjs|ts)$/.test(name))
        .map(name => `${folder}/${name}`),
    )
    .filter(path => whole || hashOf(basename(path)) % 5 === 0)
    .flatMap(path => {
      const text = readFileSync(join(root, path), "utf8");
      return variantsFor(basename(path), kind, whole ? 6 : 1).flatMap(variant => {
        const laid = withSecondNames(path, text, variant);
        return laid ? [[`${path} ${kind} ${variant.road} ${variant.act}`, path, text, laid.text] as const] : [];
      });
    }),
);

const env = { ...bunEnv, ...withoutCrashReport, NO_COLOR: "1" };
const carrier = unsupported ? [] : withoutDebugInformation();

async function build(cwd: string, name: string, flags: string[]) {
  return spawned([bunExe(), "build", "--compile", "--aot", ...carrier, ...flags, name, "--outfile", "app"], cwd, {
    ...env,
    BUN_JSC_verifyAOTProgram: "1",
  });
}

let notJudged = 0;
describe.concurrent("a second name over what a stored program makes", () => {
  test.each(cases)(
    "%s",
    (title, path, stored, laid) =>
      slot(async () => {
        const name = basename(path);
        using dir = tempDir("second-names", { [name]: laid, stored: { [name]: stored } });
        const cwd = String(dir);
        const flags = /^\/\/ Flags: (.*)$/m.exec(stored)?.[1].split(/\s+/).filter(Boolean) ?? [];
        const plain = told(await spawned([bunExe(), "run", name], cwd, env));
        // A program that prints where in its text something stands is no judge.
        if (!Bun.deepEquals(plain, told(await spawned([bunExe(), "run", name], join(cwd, "stored"), env))))
          return void notJudged++;
        const made = await build(cwd, name, flags);
        if (known.has(title)) return void expect(made.exitCode).not.toBe(0);
        built(made);
        expect(told(await spawned(withoutCoreDump([join(cwd, "app")]), cwd, env))).toEqual(plain);
      }),
    600_000,
  );
});

test("nine in ten of them are judges", () => {
  expect(notJudged).toBeLessThan(cases.length / 10);
});

// Does the net hold? Plain programs, and for each the word that takes back the cure of a fault which it once brought out.
const sumsACopy = `function sum(list) {
  const copy = [...list];
  let total = 0;
  for (let i = 0; i < copy.length; i++) {
    total += copy[i];
  }
  return total;
}
console.log(sum([1, 2, 3, 4]) + "");
console.log(sum([4, 5, 6, 7]) + "");
`;
const doublesWhatItIsGiven = `const text = process.argv[2] ?? "1,2,3,4,5,6";
function total(src, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += src[i] * 2;
  }
  return sum;
}
console.log(total(text.split(","), 6) + "");
console.log(total([1.5, -1.5, 2.5, 3.5, 4.5, 6.5], 6) + "");
`;
const listsItsArrowFields = `class Panel {
  items: number[] = [];
  open = () => this.toggle(true);
  count = () => this.items.length;
  isOpen = false;
  toggle(open: boolean): boolean { return (this.isOpen = open); }
}
const show = (label: string, run: () => unknown): void => {
  try { console.log(label, String(run())); } catch (error) { console.log(label, "throws", (error as Error).name); }
};
show("entries", () => Object.entries(new Panel()).filter(([, value]) => typeof value === "function").map(([key, value]) => key + "=" + (value as Function).name).join());
show("read twice", () => { const fresh = new Panel(); const before = fresh.count; return typeof fresh.count + "|" + typeof before; });
`;
const controls: [string, string, string, Options, string][] = [
  [
    "ChangedKindsOfStorageKeepTheirProofs",
    "main.js",
    sumsACopy,
    { road: "either", act: "fraction" },
    "GuardNotAvailable",
  ],
  [
    "CopiedReadsKeepTheirProof",
    "main.js",
    doublesWhatItIsGiven,
    { road: "parameter", act: "nan" },
    "GuardNotAvailable",
  ],
  [
    "ClosuresMadeBehindAllocationsHaveEffects",
    "main.ts",
    listsItsArrowFields,
    { kind: "object", road: "variable", act: "fraction" },
    "VerificationFailedAtTheEnd",
  ],
];

describe("the net holds what it once caught", () => {
  test.each(controls)("%s", async (word, name, program, variant, stop) => {
    using dir = tempDir("second-names-control", { [name]: withSecondNames(name, program, variant)!.text });
    const cwd = String(dir);
    built(await build(cwd, name, []));
    const sabotaged = await build(cwd, name, [`--aot-sabotage=${word}`]);
    expect({ exitCode: sabotaged.exitCode, stderr: sabotaged.stderr }).toEqual({
      exitCode: 1,
      stderr: expect.stringContaining(stop),
    });
  });
});
