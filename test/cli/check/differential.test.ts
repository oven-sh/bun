import { afterAll, expect, test } from "bun:test";
import { bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { endChildren, longLimit, spawn } from "../children";
import { env, inBatches, linesOf, modulesInCycles, tsc, writtenCases } from "./differential";
import { hasRunner } from "./typescript-go/conformance";

afterAll(endChildren);

// Small programs generated as cross products and checked by both `bun check` and TypeScript 7, which have to agree. No
// expected output is stored, because TypeScript is the oracle. Each program is one function on one line, so a line
// number identifies a combination.
//
// These found a bug that TypeScript's own tests and hundreds of open source projects didn't: `bun check` reported
// nothing in a third of the loops in which TypeScript finds a circular reference.

// A debug build is 10 to 100 times slower, so it checks a sample, always the same one.
const every = isDebug || isASAN ? 25 : 1;

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
    skipLibCheck: true,
  },
});

test.concurrent.skipIf(!tsc)("matches `tsc --singleThreaded` on one thread for modules in cycles", async () => {
  using dir = tempDir("bun-check-differential", {
    "tsconfig.json": tsconfig,
    // With 52 or 60 modules TypeScript 7.0 reports TS2321 in every file and 7.1 in none. Up to 48 they agree.
    ...modulesInCycles(isDebug || isASAN ? 24 : 48),
  });
  const root = String(dir);
  const [theirs, ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false", "--singleThreaded"], root, root),
    linesOf([bunExe(), "check", "--threads=1"], root, root),
  ]);
  expect(theirs.length).toBeGreaterThan(100);
  expect(ours).toEqual(theirs);
});

// Which files share a task depends on their cost and on which thread is free. A task checks at least 1/128 of a program,
// so in a small program no two files share one, and nothing shows what a file finds of an earlier file in the task's
// checker. The runner forces the extremes: one task for all files, the last file first, every file checked twice.
test.concurrent.skipIf(!tsc || !hasRunner)("reports the same whichever files share a task", async () => {
  using dir = tempDir("bun-check-task-groupings", {});
  const root = String(dir);
  const isSource = (path: string) => /\.[cm]?[jt]sx?$/.test(path) && !path.includes("node_modules/");
  let programs = 0;
  const cases = await writtenCases(
    root,
    it => !it.build && Object.keys(it.files).filter(isSource).length > 1 && programs++ % (2 * every) === 0,
  );
  await using proc = spawn({
    timeout: longLimit,
    cmd: [
      bunExe(),
      "check",
      "--run-typescript-tests",
      "--task-groupings",
      `--lib=${dirname(tsc!)}`,
      `--root=${root}`,
      `--threads=${availableParallelism()}`,
      ...cases.map(([name]) => name),
    ],
    env,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  const lines = stdout.split(/\r?\n/).filter(line => line);
  const counts = Object.fromEntries(
    lines
      .splice(-6)
      .map(line => /^(.+): (\d+) tasks, (\d+) files$/.exec(line)!)
      .map(([, grouping, tasks, files]) => [grouping, { tasks: +tasks, files: +files }]),
  );
  expect(lines).toEqual([]);
  expect(counts["by cost"].tasks).toBeGreaterThan(2 * cases.length);
  // A program needs more than one task if a task is discarded, because another one rechecks its files.
  expect(counts["one task"].tasks).toBeLessThan(counts["by cost"].tasks / 4);
  expect(counts["last file first"].tasks).toBeGreaterThanOrEqual(counts["last file first"].files);
  expect(counts["each file twice"].tasks).toBeGreaterThan(counts["each file twice"].files);
  expect(exitCode).toBe(0);
});

/**
 * Each group contains a cycle. The property `span` has no annotation. The call in its initializer needs `K`'s
 * constraint, which needs the members of `Tags`. One of them has a name of type `string`, so they get an index
 * signature, whose type is a union. Reducing that union compares the classes, which needs the type of `span`.
 * TypeScript reports a circular reference if it reaches the property, the constraint or the return type first, and none
 * if it reaches the interface first, because a request for members that are being resolved gets the ones already in
 * place. A group has three files, which declare the interface, declare the property, and only call the function, in one
 * of the six orders.
 */
function cyclesEnteredFromThreeSides(groups: number) {
  const files: Record<string, string> = {};
  const orders = ["abc", "bac", "cab", "bca", "acb", "cba"];
  for (let g = 0; g < groups; g++) {
    const [tags, time, use] = [...orders[g % 6]].map(it => `g${g}${it}.ts`);
    files[tags] = `export class Popover${g} { static readonly tag: string = "popover"; }
declare global {
  interface Span${g} { hidden: boolean }
  interface Tags${g} { span: Span${g}; [Popover${g}.tag]: Popover${g} }
  function create${g}<K extends keyof Tags${g}>(tag: K): Tags${g}[K];
}
`;
    files[time] = `export class Time${g} { static readonly tag = "time"; readonly span = create${g}("span"); }
declare global { interface Tags${g} { [Time${g}.tag]: Time${g} } }
`;
    // Assigning to `never` makes the messages print the types.
    files[use] = `const other${g}: never = create${g}("other" as string);
const key${g}: never = null! as keyof Tags${g};
export {};
`;
  }
  return files;
}

// The types in a cycle depend on where it's entered. That has to be the first file in program order that leads there,
// whichever thread gets there first.
test.concurrent.skipIf(!tsc)("enters a cycle where `tsc --singleThreaded` does on any thread count", async () => {
  using dir = tempDir("bun-check-differential", {
    "tsconfig.json": tsconfig,
    ...cyclesEnteredFromThreeSides(isDebug || isASAN ? 6 : 24),
  });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false", "--singleThreaded"], root, root),
    ...[1, 2, 3, 8, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  for (const code of ["TS2313", "TS2345", "TS2577", "TS7022"]) expect(theirs.join("\n")).toContain(code);
  for (const lines of ours) expect(lines).toEqual(theirs);
});

// `Box`'s base type is a mapped type over `Box`, so its members are resolved once without the base type and once with
// it. A request in between gets the first result.
test.concurrent.skipIf(!tsc)(
  "matches tsc on any thread count for an interface whose base type maps over the interface",
  async () => {
    const files: Record<string, string> = {
      "tsconfig.json": tsconfig,
      "box.d.ts": `type WithIntrinsics<T> = { [K in keyof T as T[K] extends Function ? \`$\${K & string}\` : never]: T[K] };
declare interface Box<T> { then(x: T): T; catch(): void; finally(): void; value: T }
declare interface Box<T> extends WithIntrinsics<Box<T>> {}
declare function makeBox<T>(): { box: Box<T>; done: (v: T) => void };
`,
    };
    for (let i = 0; i < (isDebug || isASAN ? 16 : 64); i++) {
      const use = `declare const q${i}: Box<R${i}>; q${i}.$then;\n`;
      const body = `interface W${i} { box: Box<R${i}> & { child?: number }; done: (v: R${i}) => void }
const { box: c${i}, done: a${i} }: W${i} = makeBox();\n`;
      files[`f${i}.ts`] =
        `interface R${i} { n${i}: ${i} }\n${[body, use + body, body + use][i % 3]}const planted${i}: 1 = 2;\nexport {};\n`;
    }
    using dir = tempDir("bun-check-differential", files);
    const root = String(dir);
    const [theirs, ...ours] = await Promise.all([
      linesOf([tsc!, "-p", ".", "--pretty", "false", "--singleThreaded"], root, root),
      ...[1, 8, 32].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
    ]);
    expect(theirs.length).toBe(isDebug || isASAN ? 16 : 64);
    for (const lines of ours) expect(lines).toEqual(theirs);
  },
);

// `b.ts` reaches a cycle while `a.ts` is being checked, so it's rechecked later. By then it has published its results
// for its first lines. The unresolved names there still have to be reported.
test.concurrent.skipIf(!tsc)("a rechecked file still reports the unresolved names from its first check", async () => {
  const lines = (count: number, line: (i: number) => string) => Array.from({ length: count }, (_, i) => line(i) + "\n");
  using dir = tempDir("bun-check-differential", {
    "tsconfig.json": tsconfig,
    "a.ts": lines(300, i => `export const a${i} = [${i}, "${i}"].map(it => [it]);`).join(""),
    "b.ts": [
      ...lines(300, i => `const b${i} = missing${i}.alloc(0);`),
      `export const ring = turn();\nexport function turn() { return [ring]; }\n`,
    ].join(""),
    "c.ts": `import { ring } from "./b";\nexport const c: never = ring;\n`,
  });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false", "--singleThreaded"], root, root),
    ...[1, 2, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  expect(theirs.filter(line => line.includes("TS2304")).length).toBe(300);
  for (const lines of ours) expect(lines).toEqual(theirs);
});

// The same for names in types, heritage clauses, property and enum member initializers, and for unused declarations.
test.concurrent.skipIf(!tsc)("a rechecked file still reports the errors in its declarations", async () => {
  const count = 300;
  const numbers = Array.from({ length: count }, (_, i) => i);
  const kinds: ((i: number) => string)[] = [
    i => `const b${i}: Missing${i} = null!;`,
    i => `type L${i} = A${i}; function f${i}(x: L${i}): Gone${i} { return x; }`,
    i => `interface I${i} extends Absent${i} { a: A${i} }`,
    i => `class C${i}<T extends A${i}> { p!: T; q = lost${i}; }`,
    i => `enum E${i} { X = nowhere${i}, Y = 1 } let e${i}: E${i}.Z;`,
    i => `let g${i} = (y: A${i}) => y.b; namespace N${i} { export type Q = Void${i}; }`,
  ];
  const options = { ...JSON.parse(tsconfig).compilerOptions, noUnusedLocals: true, noUnusedParameters: true };
  using dir = tempDir("bun-check-differential", {
    "tsconfig.json": JSON.stringify({ compilerOptions: options }),
    "a.ts": numbers
      .map(i => `export const a${i} = [${i}, "${i}"].map(it => [it]);\nexport interface A${i} { a: ${i} }\n`)
      .join(""),
    "b.ts": [
      `import type { ${numbers.map(i => `A${i}`).join(", ")} } from "./a";`,
      ...numbers.map(i => kinds[i % kinds.length](i)),
      `export const ring = turn();\nexport function turn() { return [ring]; }\n`,
    ].join("\n"),
    "c.ts": `import { ring } from "./b";\nexport const c: never = ring;\n`,
  });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false", "--singleThreaded"], root, root),
    ...[1, 2, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  for (const code of ["TS2304", "TS2339", "TS2694", "TS6133", "TS6196"]) expect(theirs.join("\n")).toContain(code);
  for (const lines of ours) expect(lines).toEqual(theirs);
});

/**
 * `depth` layers of `width` modules. Each re-exports two modules of the layer below with `export *`, and imports a name
 * and a namespace from them. The first 8 modules of a layer form cycles of two, with a circular alias. Some export a
 * default that doesn't exist, which the module above imports. The lowest layer imports from an ambient module.
 */
function modulesInLayers(width: number, depth: number) {
  const files: Record<string, string> = {
    "ambient.d.ts": `declare module "hub" { export { spoke as viaHub } from "spoke"; export * from "spoke"; }\ndeclare module "spoke" { export const spoke: "spoke"; export default missingInSpoke; }\n`,
  };
  for (let level = 0; level < depth; level++) {
    for (let i = 0; i < width; i++) {
      const name = `l${level}_${i}`;
      const [below, other, partner] = [`l${level - 1}_${i}`, `l${level - 1}_${(i * 7 + level) % width}`, i ^ 1];
      const lines = [`export const ${name} = "${name}" as const;`, `export type L${level}_${i} = ${level};`];
      const read = [name];
      // Every other layer declares its own `shared`, which shadows those of the two modules below.
      if (level % 2 === 0) lines.push(`export const shared = "shared by ${name}" as const;`);
      if (level > 0) {
        lines.push(`export * from "./${below}";`, `export * from "./${other}";`);
        lines.push(`import { ${below} as below, l0_${i} as lowest, type L0_${i} } from "./${below}";`);
        lines.push(`import * as ns from "./${other}";`);
        read.push("below", "lowest", `null! as L0_${i}`, "ns.shared", `ns.${other}`);
      } else {
        lines.push(`import { viaHub, spoke } from "hub";`);
        read.push("viaHub", "spoke");
      }
      if (i < 8) {
        lines.push(`import { l${level}_${partner} as partner } from "./l${level}_${partner}";`);
        lines.push(`export { ring${level}_${partner} as ring${level}_${i} } from "./l${level}_${partner}";`);
        read.push("partner");
      }
      if (i % 9 === 4) lines.push(`export default missing${level}_${i};`);
      if (i % 9 === 4 && level > 0) {
        lines.push(`import fromBelow from "./${below}";`);
        read.push("fromBelow");
      }
      // Assigning to `never` makes the messages print the types.
      lines.push(`export const read${level}_${i}: never[] = [${read.join(", ")}];`);
      files[`${name}.ts`] = lines.join("\n") + "\n";
    }
  }
  return files;
}

// Aliases and `export *` are resolved before the first file is checked, on all threads. A cycle of modules is resolved
// as a unit, once everything it imports is resolved. A layer here has 68 such units.
test.concurrent.skipIf(!tsc)("matches tsc on any thread count for aliases through layers of modules", async () => {
  using dir = tempDir("bun-check-differential", {
    "tsconfig.json": tsconfig,
    ...modulesInLayers(72, isDebug || isASAN ? 3 : 5),
  });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    ...[1, 2, 3, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  for (const code of ["TS2303", "TS2304", "TS2308", "TS2322"]) expect(theirs.join("\n")).toContain(code);
  for (const lines of ours) expect(lines).toEqual(theirs);
});

/**
 * `chains` chains of modules, each one longer than the previous. A module re-exports the one before it in its chain.
 * Everything else it reads doesn't come from a file it imports: ambient modules that refer to each other, in a cycle
 * and through a package and back, a UMD global, `import a = b.c` in scripts, and another module's augmentations of a
 * module and of the globals.
 */
function modulesReadingUnimportedFiles(chains: number, length: number) {
  const files: Record<string, string> = {
    "globals.ts": `declare namespace G { const g: "g"; namespace Inner { type T = "T of Inner"; const v: "v of Inner"; } }
import GI = G.Inner;
import Ring1 = Ring2;
declare module "amb-a" { export { b as a } from "amb-b"; export import I = G.Inner; export default GI; export { u as viaUmd } from "./umd"; }
`,
    "other.ts": `import Ring2 = Ring1;
declare module "amb-b" { export const b: "b"; export { a as back } from "amb-a"; export * from "amb-c"; }
declare module "amb-c" { import { back } from "amb-b"; export const c: typeof back; export { round } from "amb-d"; export default missingInC; }
declare module "amb-d" { export { round } from "amb-c"; export { t as viaFile } from "pkg"; }
`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "types": "index.d.ts" }`,
    "node_modules/pkg/index.d.ts": `export declare const t: "t of pkg";\nexport { c as fromAmbient, viaFile as roundTrip } from "amb-all";\n`,
    "all.ts": `declare module "amb-all" { export * from "amb-a"; export * from "amb-b"; export * from "amb-d"; }\n`,
    "umd.d.ts": `export as namespace Umd;\nexport declare const u: "u";\nexport { a as viaAmbient } from "amb-a";\n`,
    "target.ts": `export const t = "t" as const;\nexport { b } from "amb-b";\n`,
    "aug.ts": `import { t } from "./target";
declare module "./target" { export const added: typeof import("amb-a").a; }
declare module "amb-b" { export const addedToB: typeof t; }
declare global { const fromAug: "fromAug"; namespace G { const more: "more"; } }
`,
  };
  for (let chain = 0; chain < chains; chain++) {
    for (let i = 0; i < length + chain; i++) {
      const name = `c${chain}_${i}`;
      const lines = [`export const ${name} = "${name}" as const;`];
      const read = [name];
      if (i > 0) {
        lines.push(`export * from "./c${chain}_${i - 1}";`);
        lines.push(`import { c${chain}_0 as first } from "./c${chain}_${i - 1}";`);
        read.push("first");
      }
      switch ((chain + i) % 5) {
        case 0:
          lines.push(`import def, { a, I, viaUmd } from "amb-a";`);
          read.push("def.v", "a", "I.v", "null! as I.T", "viaUmd");
          break;
        case 1:
          lines.push(`import { b, back, c, round, addedToB } from "amb-b";`, `import defaultOfC from "amb-c";`);
          read.push("b", "back", "c", "round", "addedToB", "defaultOfC");
          break;
        case 2:
          lines.push(`import * as all from "amb-all";`, `import { fromAmbient, roundTrip } from "pkg";`);
          read.push("all.a", "all.b", "all.viaFile", "all.c", "fromAmbient", "roundTrip");
          break;
        case 3:
          lines.push(`import { added, b as viaTarget } from "./target";`);
          read.push("added", "viaTarget", "Umd.u", "Umd.viaAmbient", "fromAug", "G.more");
          break;
        default:
          lines.push(`import Local = G.Inner;`, `export import Again = GI;`);
          read.push("Local.v", "Again.v", "GI.v", "null! as Ring1");
      }
      // Assigning to `never` makes the messages print the types.
      lines.push(`export const read${chain}_${i}: never[] = [${read.join(", ")}];`);
      files[`${name}.ts`] = lines.join("\n") + "\n";
    }
  }
  return files;
}

// A module is linked as soon as its imports are. What it reads from a file it doesn't import must not depend on how far
// that file's linking has progressed.
test.concurrent.skipIf(!tsc)(
  "matches tsc on any thread count for aliases that lead to files their own file doesn't import",
  async () => {
    using dir = tempDir("bun-check-differential", {
      "tsconfig.json": tsconfig,
      ...modulesReadingUnimportedFiles(6, isDebug || isASAN ? 2 : 4),
    });
    const root = String(dir);
    const [theirs, ...ours] = await Promise.all([
      linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
      ...[1, 2, 3, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
    ]);
    for (const code of ["TS2303", "TS2304", "TS2322", "TS2439", "TS2686"]) expect(theirs.join("\n")).toContain(code);
    for (const lines of ours) expect(lines).toEqual(theirs);
  },
);

/** Cycles of aliases in which one link isn't an import but a reference to a module's UMD global. */
function aliasCyclesThroughGlobals() {
  const files: Record<string, string> = {};
  for (const n of [2, 3, 5]) {
    for (let i = 0; i < n; i++) {
      const next = (i + 1) % n;
      // Every other link is an import.
      files[`half${n}/u${i}.d.ts`] =
        `export as namespace Half${n}U${i};\n` +
        (i % 2 ? `export { a } from "./u${next}";\n` : `export import a = Half${n}U${next}.a;\n`);
      // Ambient modules, the last of which refers to the UMD global of the module that imports the first.
      const link = i === n - 1 ? `export import a = Ambient${n}U.a;` : `export { a } from "ambient${n}v${i + 1}";`;
      files[`ambient${n}/d${i}.d.ts`] = `declare module "ambient${n}v${i}" { ${link} }\n`;
    }
    files[`half${n}/main.ts`] =
      `import { a } from "./u0";\nimport { a as b } from "./u1";\nexport const read: never[] = [a, b];\n`;
    files[`ambient${n}/u.d.ts`] = `export as namespace Ambient${n}U;\nexport { a } from "ambient${n}v0";\n`;
    files[`ambient${n}/main.ts`] = `import { a } from "./u";\nexport const read: never[] = [a];\n`;
  }
  // The lowest module refers to the highest one's UMD global.
  files["levels/l0.d.ts"] = `export import a = Levels.a;\nexport declare const real: 1;\n`;
  files["levels/l1.d.ts"] = `export { a, real } from "./l0";\n`;
  files["levels/l2.d.ts"] = `export as namespace Levels;\nexport { a, real } from "./l1";\n`;
  files["levels/main.ts"] =
    `import { a, real } from "./l2";\nimport { a as b } from "./l0";\nexport const read: never[] = [a, b, real];\n`;
  return files;
}

// Every alias in a cycle is circular (TS2303), including one in a module that's linked after another part of the cycle.
test.concurrent.skipIf(!tsc)("reports TS2303 for alias cycles through UMD globals on any thread count", async () => {
  const options = { ...JSON.parse(tsconfig).compilerOptions, lib: ["es5"], skipLibCheck: false };
  using dir = tempDir("bun-check-differential", {
    "tsconfig.json": JSON.stringify({ compilerOptions: options }),
    ...aliasCyclesThroughGlobals(),
  });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    ...[1, 2, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  expect(theirs.filter(line => line.includes("TS2303")).length).toBe(26);
  for (const lines of ours) expect(lines).toEqual(theirs);
});

/**
 * A chain of `length` modules, each of which imports from the previous one and re-exports a name. Some export a default
 * that doesn't exist, which the next one imports. Next to it are `sideCount` modules, in cycles of two with a circular
 * alias, each of which imports from somewhere in the chain.
 */
function chainWithSideModules(length: number, sideCount: number) {
  const files: Record<string, string> = {};
  for (let i = 0; i < length; i++) {
    const lines = [`export const c${i} = "c${i}" as const;`];
    const read = [`c${i}`];
    if (i > 0) {
      lines.push(`export { first } from "./c${i - 1}";`, `import { first, c${i - 1} as below } from "./c${i - 1}";`);
      read.push("first", "below");
    } else {
      lines.push(`export const first = "first" as const;`);
    }
    if (i % 100 === 50) lines.push(`export default missing${i};`);
    if (i % 100 === 51) {
      lines.push(`import fromBelow from "./c${i - 1}";`);
      read.push("fromBelow");
    }
    // Assigning to `never` makes the messages print the types.
    lines.push(`export const read${i}: never[] = [${read.join(", ")}];`);
    files[`c${i}.ts`] = lines.join("\n") + "\n";
  }
  for (let i = 0; i < sideCount; i++) {
    const [at, partner] = [(i * 37) % length, i ^ 1];
    files[`w${i}.ts`] = [
      `import { first, c${at} as fromTheChain } from "./c${at}";`,
      `import { w${partner} as partner } from "./w${partner}";`,
      `export { ring${partner} as ring${i} } from "./w${partner}";`,
      `export const w${i} = "w${i}" as const;`,
      `export const read: never[] = [first, fromTheChain, partner];`,
      ``,
    ].join("\n");
  }
  return files;
}

// Only one module of a chain can be linked at a time, so all threads but one are idle. They exit or sleep, and have to
// be back for the modules next to the chain.
test.concurrent.skipIf(!tsc)("matches tsc on any thread count for a long module chain with side modules", async () => {
  using dir = tempDir("bun-check-differential", {
    "tsconfig.json": tsconfig,
    ...(isDebug || isASAN ? chainWithSideModules(152, 40) : chainWithSideModules(1000, 200)),
  });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    ...[1, 2, 8, 64].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  for (const code of ["TS2303", "TS2304", "TS2322"]) expect(theirs.join("\n")).toContain(code);
  for (const lines of ours) expect(lines).toEqual(theirs);
});

/**
 * `n` modules of components. Each calls and renders the `Outer` component of three earlier modules, so checking a
 * module evaluates parts of those. The tag that a module's check reaches first isn't the first one in its text.
 */
function modulesOfComponents(n: number) {
  const files: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    const used = [i - 1, i - 5, i - 11].filter(j => j >= 0);
    const own = [
      // The bodies of both are deferred.
      [`const Inner = () => <i>inner</i>;`, `export const Outer${i} = () => <b><Inner /></b>;`],
      // A declaration's body isn't.
      [`const Inner = () => <i>inner</i>;`, `export function Outer${i}() { return <b><Inner /></b>; }`],
      [`const Inner = () => <>inner</>;`, `export const Outer${i} = () => <><Inner /></>;`],
      [
        `const inner = { get a() { return <i>a</i>; }, b() { return <i>b</i>; } };`,
        `export class Outer${i} { render() { return <b>{inner.a}{inner.b()}</b>; } }`,
      ],
      // An element's children are deferred, a fragment's aren't.
      [
        `export function Outer${i}() {`,
        `  const item = () => <li>item</li>;`,
        `  return <ul><>{item}</></ul>;`,
        `}`,
        `export const last = <></>;`,
      ],
      [
        `const Inner = class { render() { return <i>inner</i>; } };`,
        `export const Outer${i} = function () { return <b><Inner /></b>; };`,
      ],
      // A function expression's return type is requested before its body is checked.
      [`export const Outer${i} = () => {`, `  const a = <a>a</a>;`, `  return <b>{a}</b>;`, `};`],
      // So is a declaration's, at its first `return`.
      [
        `export function Outer${i}(x?: number) {`,
        `  if (x) return null;`,
        `  const a = <a>a</a>;`,
        `  return <b>{a}</b>;`,
        `}`,
      ],
      // Checked immediately if the function has a contextual signature.
      [
        `const table: { render: () => unknown }[] = [{ render: () => <i>i</i> }];`,
        `export function Outer${i}() { return <b>{table.length}</b>; }`,
      ],
      [
        `export function Outer${i}() {`,
        `  const items = [1].map(n => <li>{n}</li>);`,
        `  return <ul>{items}</ul>;`,
        `}`,
      ],
      [
        `declare const memo: any;`,
        `const Inner = memo(() => <i>i</i>);`,
        `export function Outer${i}() { return <b><Inner /></b>; }`,
      ],
      // Its parameters aren't deferred.
      [`export const Outer${i} = ({ icon = <i>i</i> }: { icon?: unknown } = {}) => <b>{icon}</b>;`],
      // A call requests the function's return type, and a name requests the variable's initializer.
      [
        `export function Outer${i}() {`,
        `  const inner = content();`,
        `  return <b>{inner}</b>;`,
        `}`,
        `function content() { return <i>i</i>; }`,
      ],
      [
        `export const Outer${i} = (x?: number) => {`,
        `  const a = <a>a</a>;`,
        `  if (x) return a;`,
        `  return <b>b</b>;`,
        `};`,
      ],
    ];
    const isClass = (j: number) => j % own.length === 3;
    files[`c${i}.tsx`] = [
      ...used.map(j => `import { Outer${j} } from "./c${j}";`),
      ...own[i % own.length],
      ...used.map(j => `export const used${j} = ${isClass(j) ? `new Outer${j}().render()` : `Outer${j}()`};`),
      `export const Last = () => <p>${used.map(j => `<Outer${j} />`).join("")}</p>;`,
      ``,
    ].join("\n");
  }
  return files;
}

// Without React in scope, a file with a fragment gets one TS2879, at the fragment its own check reaches first. What
// another file's check evaluated in it earlier doesn't move the error.
test.concurrent.skipIf(!tsc)("reports TS2879 at the first fragment checked, on any thread count", async () => {
  using dir = tempDir("bun-check-differential", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, jsx: "react" } }),
    ...modulesOfComponents(isDebug || isASAN ? 28 : 56),
  });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    ...[1, 2, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  expect(theirs.join("\n")).toContain("TS2879");
  for (const lines of ours) expect(lines).toEqual(theirs);
});

// Without React's types, a file gets one TS2875. TypeScript 7.0 reports it at the tag a checker reaches first, which
// depends on what else that checker has checked. TypeScript 7.1 reports it at the first tag in the text, and so does
// `bun check`. These are the positions TypeScript 7.1 reports for `modulesOfComponents(56)`, module by module.
const firstTags = `
  c0.tsx(1,21) c1.tsx(2,21) c2.tsx(2,21) c3.tsx(2,34) c4.tsx(3,22) c5.tsx(3,41) c6.tsx(4,13)
  c7.tsx(5,13) c8.tsx(3,61) c9.tsx(4,30) c10.tsx(4,26) c11.tsx(4,34) c12.tsx(6,10) c13.tsx(5,13)
  c14.tsx(4,21) c15.tsx(4,21) c16.tsx(4,21) c17.tsx(4,34) c18.tsx(5,22) c19.tsx(4,41) c20.tsx(5,13)
  c21.tsx(6,13) c22.tsx(4,61) c23.tsx(5,30) c24.tsx(5,26) c25.tsx(4,34) c26.tsx(6,10) c27.tsx(5,13)
  c28.tsx(4,21) c29.tsx(4,21) c30.tsx(4,21) c31.tsx(4,34) c32.tsx(5,22) c33.tsx(4,41) c34.tsx(5,13)
  c35.tsx(6,13) c36.tsx(4,61) c37.tsx(5,30) c38.tsx(5,26) c39.tsx(4,34) c40.tsx(6,10) c41.tsx(5,13)
  c42.tsx(4,21) c43.tsx(4,21) c44.tsx(4,21) c45.tsx(4,34) c46.tsx(5,22) c47.tsx(4,41) c48.tsx(5,13)
  c49.tsx(6,13) c50.tsx(4,61) c51.tsx(5,30) c52.tsx(5,26) c53.tsx(4,34) c54.tsx(6,10) c55.tsx(5,13)
`
  .trim()
  .split(/\s+/);
const isJsxRuntimeError = (line: string) => line.includes("error TS2875:");
const jsxRuntimeErrorPositions = (lines: string[]) => lines.filter(isJsxRuntimeError).map(line => line.split(":")[0]);

test.concurrent.skipIf(!tsc)("reports TS2875 at the file's first tag on any thread count", async () => {
  const modules = isDebug || isASAN ? 28 : 56;
  using dir = tempDir("bun-check-differential", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, jsx: "react-jsx" } }),
    ...modulesOfComponents(modules),
  });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    ...[1, 2, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  for (const lines of ours) {
    expect(jsxRuntimeErrorPositions(lines).sort()).toEqual(firstTags.slice(0, modules).sort());
    expect(lines.filter(line => !isJsxRuntimeError(line))).toEqual(theirs.filter(line => !isJsxRuntimeError(line)));
  }
});

// The first tag counts even if it's never checked, like the second class in `extends` or the body of `with`. A file in
// which no tag is checked has no error. The positions are TypeScript 7.1's.
test.concurrent("reports TS2875 at the file's first tag, whether that tag is checked or not", async () => {
  using dir = tempDir("bun-check-differential", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, jsx: "react-jsx" } }),
    "deferred.tsx": `const later = () => <b />;\nexport function f() { return <i />; }\n`,
    "fragment.tsx": `const later = () => <><b /></>;\nexport function f() { return <i />; }\n`,
    "extends.tsx": `class A extends Object, (<a />) {}\nexport const x = <b />;\n`,
    "extends-only.tsx": `export class A extends Object, (<a />) {}\n`,
    "with.tsx": `declare const o: any;\nwith (o) { <a />; }\nconst x = <b />;\n`,
    "with-only.tsx": `declare const o: any;\nwith (o) { <a />; }\n`,
  });
  const root = String(dir);
  const ours = await Promise.all(
    [1, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  );
  for (const lines of ours) {
    expect(jsxRuntimeErrorPositions(lines)).toEqual([
      "deferred.tsx(1,21)",
      "extends.tsx(1,26)",
      "fragment.tsx(1,21)",
      "with.tsx(2,12)",
    ]);
  }
});

// Likewise for TS2354, when `tslib` is missing. Here the first syntax checked that needs a helper is `this.#x`, which
// the `return` in the first line leads to. The modules that import `first` trigger the same check.
test.concurrent.skipIf(!tsc)("reports TS2354 at the first helper syntax checked, on any thread count", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < (isDebug || isASAN ? 16 : 48); i++) {
    const used = [i - 1, i - 5, i - 11].filter(j => j >= 0);
    files[`m${i}.ts`] = [
      ...used.map(j => `import { first${j} } from "./m${j}";`),
      `export function first${i}() { return make().get(); }`,
      `export async function next() {}`,
      `function make() { return new C(); }`,
      `class C { #x = 1; get() { return this.#x; } }`,
      ...used.map(j => `export const used${j} = first${j}();`),
      ``,
    ].join("\n");
  }
  const compilerOptions = { ...JSON.parse(tsconfig).compilerOptions, target: "es2015", importHelpers: true };
  using dir = tempDir("bun-check-differential", { "tsconfig.json": JSON.stringify({ compilerOptions }), ...files });
  const root = String(dir);
  const [theirs, ...ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    ...[1, 2, 8].map(threads => linesOf([bunExe(), "check", "--threads", String(threads)], root, root)),
  ]);
  expect(theirs.join("\n")).toContain("TS2354");
  for (const lines of ours) expect(lines).toEqual(theirs);
});

/** Error lines printed by `cmd`, in `tsc --pretty false` format, grouped by line of `a.ts`. */
async function errorsOf(cmd: string[], cwd: string) {
  await using proc = spawn({ timeout: longLimit, cmd, cwd, env, stdout: "pipe", stderr: "ignore" });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
  const byLine = new Map<number, string[]>();
  for (const text of stdout.split("\n")) {
    const line = /^a\.ts\((\d+),\d+\): error TS\d+: /.exec(text)?.[1];
    if (line) byLine.set(+line, [...(byLine.get(+line) ?? []), text].sort());
  }
  return byLine;
}

async function checkBoth(declarations: string[], functions: string[]) {
  const sample = functions.filter((_, index) => index % every === 0);
  const source = [...declarations, ...sample.map((body, index) => `export async function f${index}${body}`)];
  using dir = tempDir("bun-check-differential", { "tsconfig.json": tsconfig, "a.ts": source.join("\n") + "\n" });
  const [theirs, ours] = await Promise.all([
    errorsOf([tsc!, "-p", ".", "--pretty", "false"], String(dir)),
    errorsOf([bunExe(), "check"], String(dir)),
  ]);
  // A syntax error would end both before anything is checked.
  expect(theirs.size).toBeGreaterThan(sample.length / 4);
  const only = (a: typeof ours, b: typeof ours) => [...a.keys()].filter(line => !b.has(line)).map(l => source[l - 1]);
  return { theirs, ours, onlyTypeScriptReports: only(theirs, ours), onlyBunReports: only(ours, theirs) };
}

/** Replaces every whole-word `R` in `text` with `reference`. */
const withReference = (text: string, reference: string) => text.replace(/\bR\b/g, () => reference);

function* product<T extends unknown[][]>(...lists: T): Generator<{ [K in keyof T]: T[K][number] }> {
  if (lists.length === 0) return yield [] as never;
  const [first, ...rest] = lists;
  for (const item of first) for (const others of product(...rest)) yield [item, ...others] as never;
}

const differential = test.concurrent.skipIf(!tsc);

// `while (s) { const cur = INITIALIZER; s = ASSIGNED; }`: the type of `cur` needs the type of `s`, which needs what the
// back edge of the loop assigns.
const loopDeclarations = [
  `interface S { nxt: S | null; id: string; n: number; kids: S[]; gen<T>(x: T): T; over(a: string): S; over(a: number): S | null; p: Promise<S | null>; get(): S | null }`,
  `declare function mk(id?: string): S; declare function mkN(s: S | null): S | null; declare function idf<T>(x: T): T; declare const c: boolean; declare class G<T> { constructor(x: T); v: T } declare class H { constructor(x: S | null); v: S | null } declare function tg<T>(s: TemplateStringsArray, x: T): T; declare function ov(a: S): S | null; declare function ov(a: null): null; declare function pr(s: S | null): Promise<S | null>;`,
];
// The initializer, and an expression of type `S | null` made from `cur`.
const loopInitializers = [
  ["await s.p", "cur"],
  ["`${s.id}`", "mk(cur)"],
  ["new G(s)", "cur.v"],
  ["tg`${s}`", "cur"],
  ["s.n + 1", "cur ? s.nxt : null"],
  ["-s.n", "cur ? s.nxt : null"],
  ["!s.nxt", "cur ? null : s.nxt"],
  ["typeof s.nxt", "cur ? s.nxt : null"],
  ["void s", "cur ?? null"],
  ["(s, s.nxt)", "cur"],
  ["s.nxt && s.nxt.nxt", "cur"],
  ["s.nxt || null", "cur"],
  ["[...s.kids]", "cur[0]"],
  ["{ ...s }", "cur.nxt"],
  ["s.nxt satisfies S | null", "cur"],
  ["<S | null>s.nxt", "cur"],
  ["s.nxt!", "cur"],
  ["s?.nxt", "cur"],
  ["s.kids?.[0]", "cur"],
  ["ov(s)", "cur"],
  ["s.over(1)", "cur"],
  ["idf(s.nxt)", "cur"],
  ["s.gen(s.nxt)", "cur"],
  ["(() => s.nxt)()", "cur"],
  ["(function () { return s; })()", "cur"],
  ["s.n++", "cur ? s.nxt : null"],
  ["s.id in s", "cur ? s.nxt : null"],
  ["s instanceof Object", "cur ? s.nxt : null"],
  ["s.n === 1", "cur ? s.nxt : null"],
  ["class { static v = s }", "cur.v"],
  ["{ get v() { return s; } }", "cur.v"],
  ["{ v() { return s; } }", "cur.v()"],
  ["[s] as const", "cur[0]"],
  ["{ v: s } as const", "cur.v"],
  ["c ? { v: s } : { v: null }", "cur.v"],
  ["[{ v: s }]", "cur[0].v"],
  ["idf({ v: s })", "cur.v"],
  ["{ v: s }.v", "cur"],
  // `getQuickTypeOfExpression`
  ["s.get()", "cur"],
  ["s.get()!", "cur"],
  ["(s.get())", "cur"],
  ["mkN(s)", "cur"],
  ["new H(s)", "cur.v"],
  ["await pr(s)", "cur"],
  ["s.nxt", "cur"],
  ["s", "cur"],
];
const loopAssignments = [
  "R",
  "R!",
  "(R)",
  "R as S",
  "R satisfies S | null",
  "<S>R",
  "R ?? null",
  "R || null",
  "R && R.nxt",
  "c ? R : null",
  "R ? R.nxt : null",
  "R?.nxt ?? null",
  "mkN(R)",
  "idf(R)",
  "await pr(R)",
  "await R",
  "new G(R).v",
  "new H(R).v",
  "tg`${R}`",
  "{ v: R }.v",
  "[R][0]",
  "(() => R)()",
  "R === null ? null : R",
  "(R, null)",
  "mk(R?.id)",
  "mk(`${R}`)",
  "R?.get() ?? null",
  "R?.gen(R) ?? null",
  "R?.over(1) ?? null",
  "R?.kids[0] ?? null",
  "R?.kids.find(k => k.id) ?? null",
  "[R].find(k => k) ?? null",
  "Object.assign({}, R)",
  "{ ...mk(), nxt: R }",
  "mkN(mkN(R))",
  'typeof R === "object" ? null : mk()',
];
const loopShapes = [
  "while (s) { const cur = I; s = A; }",
  "do { const cur = I; s = A; } while (s);",
  "for (;;) { if (!s) break; const cur = I; s = A; }",
  "for (; s; ) { const cur = I; s = A; }",
  "while (s) { let cur = I; s = A; }",
  "while (s) { const { cur } = { cur: I }; s = A; }",
  "while (s) { const [cur] = [I]; s = A; }",
  "while (s) { const cur = I; const nx = A; s = nx; }",
  "while (s) { while (c) { const cur = I; s = A; if (!s) return; } }",
  "while (s) { const cur = I; if (c) continue; s = A; }",
  "while (s) { try { const cur = I; s = A; } finally { c; } }",
  "while (s) { const cur = I; switch (c) { case true: s = A; break; default: s = null; } }",
];

differential.each(loopShapes)("matches tsc for a variable in a loop that's assigned back: %s", async shape => {
  const functions = [...product(loopInitializers, loopAssignments)].map(([[initializer, read], assigned]) => {
    const body = shape.replace("I", () => initializer).replace("A", () => withReference(assigned, `(${read})`));
    return `() { let s: S | null = mk(); ${body} }`;
  });
  const { onlyTypeScriptReports, onlyBunReports } = await checkBoth(loopDeclarations, functions);
  expect(onlyTypeScriptReports).toEqual([]);
  expect(onlyBunReports).toEqual([]);
});

// A walk that gets 2,000 levels deep fails with TS2563. A statement in a loop can be on the stack one more time for
// each enclosing loop. A debug build can run out of stack before it hits the limit.
test.concurrent.skipIf(!tsc || isDebug || isASAN)(
  "hits the control flow limit at the same size as tsc, inside and after loops",
  async () => {
    const declarations = `declare const c: boolean, b: number; declare function must(v: unknown): asserts v;`;
    const many = (n: number) => Buffer.alloc(9 * n, "must(b); ").toString();
    // `x` has to be narrower than its declared type. Otherwise no walk continues from the start of a loop to its end.
    const x = `let x: string | number | undefined = 0;`;
    // Each shape comes with the smallest number of statements at which TypeScript gives up.
    const shapes: [number, (n: number) => string][] = [
      [997, n => `${x} while (b) { if (c) { x = "s"; } ${many(n)}x; }`],
      [663, n => `${x} while (b) { if (c) { x = "s"; } ${many(n)}while (c) { ${many(n)}x; } }`],
      [
        495,
        n =>
          `${x} p: while (b) { if (c) { x = "s"; } q: while (c) { while (c) { ${many(n)}x; if (c) continue p; if (b) continue q; } } }`,
      ],
      [998, n => `${x} while (b) { if (c) { x = "s"; } ${many(n)}} ${many(n)}x;`],
      [1996, n => `let x = null! as string | number | undefined; while (b) { if (c) { x = "s"; } ${many(n)}x; }`],
      [
        499,
        n =>
          `while (b) { function g() { ${x} while (b) { if (c) { x = "s"; } ${many(n)}} ${many(3 * n)}x; } must(b); }`,
      ],
    ];
    // One file per case, because the maximum depth of a walk is computed per file.
    const sizes = shapes.flatMap(([limit, shape], index) =>
      [limit - 1, limit].map(n => [`${index}-${n}.ts`, shape(n)]),
    );
    using dir = tempDir("bun-check-differential", {
      "tsconfig.json": tsconfig,
      ...Object.fromEntries(sizes.map(([name, body]) => [name, `${declarations}\nexport function f() { ${body} }\n`])),
    });
    const root = String(dir);
    const [theirs, ours] = await Promise.all([
      linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
      linesOf([bunExe(), "check"], root, root),
    ]);
    expect(theirs.map(line => line.replace(/\(.*(TS\d+).*/, " $1")).sort()).toEqual(
      shapes.map(([limit], index) => `${index}-${limit}.ts TS2563`),
    );
    expect(ours.sort()).toEqual(theirs.sort());
  },
);

differential(
  "matches tsc on narrowing for every reference, guard, surrounding control flow and statement before the use",
  async () => {
    const declarations = [
      `type U = { k: "a"; a: number; n?: U } | { k: "b"; b: string; n?: U } | string | number | null | undefined | string[] | (() => void) | Date;`,
      `interface W { p: U; q: { p: U }; readonly r: U; [i: number]: U; m(): U } declare function isStr(v: unknown): v is string; declare function f(): void; declare const c: boolean; declare const cx: U; declare const key: "p"; declare const i: number;`,
    ];
    const references = [
      ...["x", "cx", "w.p", "w.q.p", "w.r", "w[0]", 'w["p"]', "w?.p", "w!.p", "arr[0]", "arr[i]", "tup[0]", "w[key]"],
      ...["cw.p", "cw.q.p", "(x)", 'w.q["p"]', "d"],
    ];
    const guards = [
      'typeof R === "string"',
      'typeof R !== "object"',
      "R === null",
      "R == null",
      "R != undefined",
      "R",
      "!R",
      "R instanceof Date",
      "Array.isArray(R)",
      "isStr(R)",
      'typeof R === "function"',
      'typeof R === "object" && R !== null && "k" in R',
      'R === "lit"',
      "R === cx",
      'typeof R === "object" && R && !Array.isArray(R) && !(R instanceof Date) && R.k === "a"',
      'typeof R === "number" || typeof R === "string"',
      '"string" === typeof R',
      "R !== undefined && R !== null",
      'typeof R === "undefined"',
      'R?.toString() === "a"',
    ];
    const flows = [
      "if (G) { M USE }",
      "if (G) { c; } else { M USE }",
      "if (!(G)) return; M USE",
      "if (G) { M (() => { USE })(); }",
      "while (G) { M USE break; }",
      "switch (true) { case G: M USE break; }",
      "for (; G; ) { M USE break; }",
      "do { if (G) break; M USE } while (c);",
      "try { if (!(G)) throw 0; M USE } catch { c; }",
      "if (G || c) { M USE }",
      "if (G && c) { M USE }",
      "const g = G; if (g) { M USE }",
      "if (G) { M } USE",
      "if (c) { if (!(G)) return; } M USE",
      "L: { if (!(G)) break L; M USE }",
      "(G) && f(); M USE",
    ];
    const between = [
      ...["", "f();", "await 0;", "x = x;", "w = w;", "w.p = w.p;", "w.q = w.q;", "for (const e of [1]) { e; }"],
    ];
    const functions = [...product(references, guards, flows, between)].map(([reference, guard, flow, statement]) => {
      // The message prints the narrowed type.
      const body = flow
        .replace("G", () => withReference(guard, reference))
        .replace("USE", () => `const r: never = ${reference};`)
        .replace("M", () => statement);
      return `(x: U, w: W, arr: U[], tup: [U, U], cw: Readonly<W>, { d }: { d: U }) { ${body} }`;
    });
    const { theirs, ours } = await checkBoth(declarations, functions);
    expect([...ours]).toEqual([...theirs]);
  },
);

differential(
  "matches tsc for an unannotated variable with every declaration, write, surrounding control flow and read",
  async () => {
    const declarations = [
      `declare const c: boolean; declare function mk(): { k: 1 } | null; declare function idf<T>(v: T): T;`,
    ];
    const variables = [
      ...["let x;", "let x = null;", "let x = undefined;", "let x = [];", "var x;", "let x, y = 1;"],
      ...["let x = c ? null : undefined;", "const x = [];", "let x = [], z = x;"],
    ];
    const writes = [
      ...["x = 1;", 'x = "a";', "x = mk();", 'x = x ? 1 : "a";', "x = [1];", "x.push(1);", "x[0] = 1;", "x ??= 1;"],
      ...["x = x + 1;", "({ x } = { x: 1 });", "[x] = [1];", "for (x of [1]) { c; }", "for (x in {}) { c; }"],
      ...["x = null;", "x = undefined;", 'x = []; x.push("a");', "x = idf(x);", "x = { v: x };", "x = () => x;"],
      ...["x.push(x);", "x = [x];", "x.length = 0;", "x = c ? [] : null;", "x++;", 'x += "a";', ""],
    ];
    const flows = [
      "W",
      "if (c) { W }",
      "if (c) { W } else { x = true; }",
      "while (c) { W }",
      "do { W } while (c);",
      "for (const i of [1]) { W }",
      "try { W } catch { c; }",
      "try { c; } finally { W }",
      "switch (c) { case true: W break; }",
      "(() => { W })();",
      "function inner() { W } inner();",
      "L: { if (c) break L; W }",
      "while (c) { if (c) continue; W }",
      "if (c) return; W",
    ];
    const reads = [
      ...["const r: never = x;", "x.foo;", "const f = () => x; f;", "return x;", "x();", "const [a] = x; a;"],
      ...["for (const e of x) { e; }", "x satisfies never;", 'typeof x === "string" && x.foo;'],
    ];
    const functions = [...product(variables, writes, flows, reads)].map(
      ([variable, write, flow, read]) => `() { ${variable} ${flow.replace("W", () => write)} ${read} }`,
    );
    const { theirs, ours } = await checkBoth(declarations, functions);
    expect([...ours]).toEqual([...theirs]);
  },
);

const cycleDeclarations = [
  `declare const c: boolean; declare function idf<T>(v: T): T; declare function one(v: unknown): number; declare class G<T> { constructor(v: T); v: T } declare function ov(v: string): string; declare function ov(v: unknown): number;`,
];
// The declaration of `N` with the expression `E`, and how to refer to it.
const cycleDeclared = [
  ["const N = E;", "N"],
  ["let N = E;", "N"],
  ["var N = E;", "N"],
  ["const { N } = { N: E };", "N"],
  ["const [N] = [E];", "N"],
  ["function N() { return E; }", "N()"],
  ["const N = () => E;", "N()"],
  ["const N = function () { return E; };", "N()"],
  ["class CN { static p = E; }", "CN.p"],
  ["class CN { p = E; }", "new CN().p"],
  ["const oN = { p: E };", "oN.p"],
  ["const oN = { get p() { return E; } };", "oN.p"],
  ["const oN = { p() { return E; } };", "oN.p()"],
  ["async function N() { return E; }", "N()"],
  ["function* N() { yield E; }", "N()"],
  ["const N = (x = E) => x;", "N()"],
  ["function N(x = E) { return x; }", "N()"],
  ["class CN { m() { return E; } }", "new CN().m()"],
  ["class CN { get p() { return E; } }", "new CN().p"],
  ["const N = { v: E }.v;", "N"],
  ["const N = [E][0];", "N"],
  ["const N = c ? E : 1;", "N"],
];
const cycleReferences = [
  "R",
  "idf(R)",
  "[R]",
  "{ v: R }",
  "() => R",
  "(() => R)()",
  "typeof R",
  "R as any",
  "R!",
  "R ?? 1",
  "c ? R : 1",
  "one(R)",
  "new G(R)",
  "`${R}`",
  "R.x",
  "R?.x",
  "void R",
  "[...R]",
  "{ ...R }",
  "idf(() => R)",
  "[1].map(() => R)",
  "[1].map(x => R)",
  "Promise.resolve(R)",
  "R satisfies unknown",
  "ov(R)",
  "R + 1",
  "!R",
  "(R, 1)",
  "R && 1",
  "function () { return R; }",
  "class { static q = R }",
  "{ get g() { return R; } }",
  "[1].find(x => R)",
  "new Promise(r => r(R))",
  "idf(idf)(R)",
  "<any>R",
  "R as const",
  "{ m() { return R; } }",
];

differential(
  "matches tsc on circular references for every declaration and every way its initializer or body refers back",
  async () => {
    const functions = [...product(cycleDeclared, cycleReferences)].map(([[declaration, name], reference]) => {
      const expression = `(${withReference(reference, name.replaceAll("N", "a"))})`;
      return `() { ${declaration.replaceAll("N", "a").replace("E", () => expression)} }`;
    });
    const { theirs, ours } = await checkBoth(cycleDeclarations, functions);
    expect([...ours]).toEqual([...theirs]);
  },
);

differential("matches tsc on circular references through a second declaration", async () => {
  const second = [0, 3, 5, 6, 8, 9, 10, 11, 15, 17].map(index => cycleDeclared[index]);
  const functions = [...product(cycleDeclared, cycleReferences, second)].map(
    ([[declaration, name], reference, [otherDeclaration, otherName]]) => {
      const expression = `(${withReference(reference, otherName.replaceAll("N", "b"))})`;
      const first = declaration.replaceAll("N", "a").replace("E", () => expression);
      const other = otherDeclaration.replaceAll("N", "b").replace("E", () => name.replaceAll("N", "a"));
      return `() { ${first} ${other} }`;
    },
  );
  const { theirs, ours } = await checkBoth(cycleDeclarations, functions);
  expect([...ours]).toEqual([...theirs]);
});

differential("matches tsc on callbacks for every callee, callback form and call context", async () => {
  // `const p: never = x` and `const r: never = CALL` make the messages print the parameter's contextual type and the
  // call's inferred type.
  const declarations = [
    "declare const c: boolean; declare function idf<T>(v: T): T; declare const pn: Promise<number>; declare const an: number[]; declare const mp: Map<string, number>;",
    "declare function k1(cb: (x: number) => string): void; declare function k2(cb: (x: number, y: string) => void): void; declare function k3<T>(v: T, cb: (x: T) => void): T; declare function k4<T>(cb: (x: number) => T): T;",
    "declare function k5<T, U>(v: T, f: (x: T) => U, g: (y: U) => void): U; declare function k6(cb: (x: number) => void): 1; declare function k6(cb: (x: string, y: number) => void): 2; declare function k7(cb?: (x: number) => void): void;",
    "declare function k8(cb: ((x: number) => void) | ((x: string) => void)): void; declare function k9(cb: ((x: number) => void) | null): void; declare function k10(...cbs: ((x: number) => void)[]): void;",
    "declare function k11(o: { cb(x: number): void; n: number }): void; declare function k12<T>(o: { v: T; cb: (x: T) => void }): T; declare function k13(cb: (this: Date, x: number) => void): void;",
    "declare function k14(cb: (...a: [number, string]) => void): void; declare function k15<A extends unknown[]>(cb: (...a: A) => void, ...a: A): A; declare function k16(cb: (x: { a: number; b?: string }) => void): void;",
    "declare function k17<T extends string>(v: T, cb: (x: T) => void): T; declare function k18<T>(cb: (x: T) => void, v: T): T; declare function k19<T>(a: T[], cb: (x: T) => boolean): T; declare class K20<T> { constructor(v: T, cb: (x: T) => void); v: T }",
  ];
  const callees = [
    "k1(CB)",
    "k2(CB)",
    "k3(1, CB)",
    "k4(CB)",
    "k5(1, CB, y => { const q: never = y; })",
    "k6(CB)",
    "k7(CB)",
    "k8(CB)",
    "k9(CB)",
    "k10(CB, CB)",
    "k11({ cb: CB, n: 1 })",
    "k12({ v: 1, cb: CB })",
    "k13(CB)",
    "k14(CB)",
    'k15(CB, 1, "a")',
    "k16(CB)",
    'k17("a", CB)',
    "k18(CB, 1)",
    'k19([1, "a"], CB)',
    "new K20(1, CB)",
    "pn.then(CB)",
    "an.map(CB)",
    "an.filter(CB)",
    'an.reduce(CB, "")',
    "mp.forEach(CB)",
    "an.find(CB)",
    "an.sort(CB)",
    'k3(c ? 1 : "a", CB)',
    "k12({ cb: CB, v: 1 })",
    "k3(null, CB)",
    "k3([], CB)",
    "k3({ a: 1 }, CB)",
  ];
  const callbacks = [
    "x => { const p: never = x; }",
    "(x) => { const p: never = x; }",
    "(x, y) => { const p: never = y; }",
    "function (x) { const p: never = x; }",
    "async x => { const p: never = x; }",
    "function* (x) { const p: never = x; }",
    "(x = 1) => { const p: never = x; }",
    "({ a }) => { const p: never = a; }",
    "([a]) => { const p: never = a; }",
    "(...x) => { const p: never = x; }",
    "(x?) => { const p: never = x; }",
    "(x: any) => { const p: never = x; }",
    "c ? x => { const p: never = x; } : x => { const p: never = x; }",
    "(x => { const p: never = x; })",
    "idf(x => { const p: never = x; })",
    "x => x",
    "() => 1",
    "x => { return x; }",
    "function (x) { const p: never = this; }",
    "x => y => { const p: never = x; }",
    "x => ({ v: x })",
    "x => [x]",
    "(x, ...r) => { const p: never = r; }",
    "x => { if (c) return x; return 1; }",
    "async function (x) { return x; }",
    "x => x as const",
  ];
  const contexts = [
    "const r: never = CALL;",
    "CALL;",
    "return CALL;",
    "const r = CALL; const s: never = r;",
    "const r: never = idf(CALL);",
    "const r: never = [CALL];",
    "const r: never = { v: CALL };",
    "while (c) { const r: never = CALL; }",
    "const r: never = c ? CALL : 1;",
    "const f = () => CALL; const r: never = f();",
    "const r: never = await CALL;",
    "class Q { p = CALL; } const r: never = new Q().p;",
  ];
  const functions = [...product(callees, callbacks, contexts)].map(([callee, callback, context]) => {
    const call = callee.replace(/\bCB\b/g, () => callback);
    return `() { ${context.replace(/\bCALL\b/g, () => call)} }`;
  });
  const { theirs, ours } = await checkBoth(declarations, functions);
  expect([...ours]).toEqual([...theirs]);
});

/** Groups `cmd`'s output by line of `a.ts`. A continuation line belongs to the error above it. */
async function messagesOf(cmd: string[], cwd: string) {
  await using proc = spawn({ timeout: longLimit, cmd, cwd, env, stdout: "pipe", stderr: "ignore" });
  const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
  const byLine = new Map<number, string[]>();
  let line = 0;
  for (const text of stdout.split(/\r?\n/)) {
    line = +(/^a\.ts\((\d+),\d+\): error TS\d+: /.exec(text)?.[1] ?? line);
    if (line && text.trim()) byLine.set(line, [...(byLine.get(line) ?? []), text]);
  }
  return byLine;
}

/**
 * Checks one program with a case on each line. Returns the cases for which the two print different messages.
 * `step`: a debug build checks every `step`th case. `files`: the program's other files.
 */
async function casesThatDiffer(
  options: object,
  declarations: string[],
  cases: string[],
  step = every,
  files: Record<string, string> = {},
) {
  // Nothing is type checked after a syntax error. The error in the last line proves that the check ran.
  const source = [...declarations, ...cases.filter((_, index) => index % step === 0), `const checked: number = "";`];
  const compilerOptions = { ...JSON.parse(tsconfig).compilerOptions, ...options };
  using dir = tempDir("bun-check-differential", {
    ...files,
    "tsconfig.json": JSON.stringify({ compilerOptions }),
    "a.ts": source.join("\n") + "\n",
  });
  const [theirs, ours] = await Promise.all([
    messagesOf([tsc!, "-p", ".", "--pretty", "false"], String(dir)),
    messagesOf([bunExe(), "check"], String(dir)),
  ]);
  expect(theirs.get(source.length)?.[0]).toContain("error TS2322");
  return source.flatMap((text, index) => {
    const [typescript, bun] = [theirs.get(index + 1) ?? [], ours.get(index + 1) ?? []];
    return Bun.deepEquals(typescript, bun) ? [] : [{ text, tsc: typescript, bun }];
  });
}

// `string` is applicable to the key `string & {}`, but it isn't that key.
const indexKeys = [
  "string",
  "number",
  "symbol",
  "string & {}",
  "number & {}",
  "symbol & {}",
  "`a${string}`",
  "`${number}`",
  "`a${string}` & {}",
  "(string & {}) | `a${string}`",
  "(string & {}) | number",
  "string | (number & {})",
  "(string & {}) | (number & {}) | (symbol & {})",
  "string & { brand: 1 }",
];
const indexDeclarations = [
  "declare const u: unique symbol; declare const str: string; declare const num: number; declare const sym: symbol;",
  "declare const tpl: `a${string}`; declare const nstr: `${number}`;",
  "declare const bstr: string & {}; declare const bnum: number & {}; declare const bsym: symbol & {};",
  `declare const zero: 0; declare const szero: "0"; declare enum E { A = 0 }`,
];
const indexedBy = [
  "0",
  `"a"`,
  `"ab"`,
  `"0"`,
  "Symbol.iterator",
  "u",
  "str",
  "num",
  "sym",
  "tpl",
  "nstr",
  "bstr",
  "bnum",
  "bsym",
];
const indexUses = [
  "s[I];",
  `s[I] = "x";`,
  "const k: keyof typeof s = I;",
  "type T = (typeof s)[TYPE]; const t: T = 1;",
  "const { [I]: v } = s; const n: never = v;",
  "delete s[I];",
  "I in s;",
];
const namedUses = [
  "s.a;",
  "s.ab;",
  "s.a = 1;",
  "const { a } = s; const n: never = a;",
  "const { ab, ...rest } = s; const n: never = rest;",
];
// A name written as a number is a number, and an index signature for `string & {}` doesn't apply to it.
const literalNames = [
  "0",
  `"0"`,
  `"a"`,
  "a",
  "1.0",
  "0x1",
  "1e3",
  ".5",
  "[0]",
  `["0"]`,
  "[1.0]",
  "[-1]",
  `["-1"]`,
  `["a"]`,
  "[(0)]",
  "[0n]",
  // Late-bound: the name comes from the value, and its type is the expression's type.
  "[zero]",
  "[szero]",
  "[E.A]",
  "[u]",
];
const destructurings = [
  "const { L: v } = s; const n: never = v;",
  "let v; ({ L: v } = s); const n: never = v;",
  "const { L: v, ...rest } = s; const n: never = rest;",
  "let v, rest; ({ L: v, ...rest } = s); const n: never = rest;",
  "function f({ L: v }: typeof s) { const n: never = v; }",
  "const { L: v = 1 } = s; const n: never = v;",
  "let v; ({ L: v = 1 } = s); const n: never = v;",
  "for (const { L: v } of [s]) { const n: never = v; }",
];
// A name written as a string is a string, even if it looks like a number.
const literalsWithNames = [
  "const o = { L: 1 }; const t: typeof s = o;",
  "const t: typeof s = { L: 1 };",
  "const t: { [K in keyof typeof s]: (x: string) => void } = { L: x => x.nope };",
];
const isKeyOfIndexSignature = (key: string) => /^(string|number|symbol|`[^`]*`)$/.test(key);
const withIndex = (key: string, value: string) =>
  isKeyOfIndexSignature(key) ? `{ [k: ${key}]: ${value} }` : `{ [K in ${key}]: ${value} }`;
const literalsWithKeys = [
  `{ a: "" }`,
  `{ ab: "" }`,
  `{ 0: "" }`,
  `{ [u]: "" }`,
  `{ [str]: "" }`,
  `{ [num]: "" }`,
  `{ [sym]: "" }`,
  `{ [tpl]: "" }`,
  `{ [bstr]: "" }`,
];
const indexSources = [
  ...indexKeys.map(key => `null! as ${withIndex(key, "string")}`),
  ...[
    "{ a: string }",
    "{ ab: string }",
    "{ 0: string }",
    `{ "0": string }`,
    "{ [u]: string }",
    "{ ab: string; 1: string; [u]: string }",
    "{ a?: string }",
    "{ [k: string]: string; [k: number]: string }",
    "{ [k: `a${string}`]: string; ab: string }",
  ].map(type => `null! as ${type}`),
  ...literalsWithKeys,
];
const indexAccesses = [
  ...[...product(indexKeys, indexedBy, indexUses)].map(
    ([key, index, use]) =>
      `{ const s = null! as { [K in ${key}]: string }; ${use
        .replace(/\bI\b/g, () => index)
        // A literal is its own type.
        .replace("TYPE", () => (/^[a-z]/i.test(index) ? `typeof ${index}` : index))} }`,
  ),
  ...[...product(indexKeys, namedUses)].map(([key, use]) => `{ const s = null! as { [K in ${key}]: string }; ${use} }`),
  ...[...product(indexKeys, literalNames, destructurings)].map(
    ([key, name, use]) => `{ const s = null! as { [K in ${key}]: string }; ${use.replace(/\bL\b/g, () => name)} }`,
  ),
  ...[...product(indexKeys, literalNames, literalsWithNames)].map(
    ([key, name, use]) => `{ const s = null! as { [K in ${key}]: string }; ${use.replace(/\bL\b/g, () => name)} }`,
  ),
];
const indexRelations = [
  ...[...product(indexSources, indexKeys)].flatMap(([source, key]) => [
    `{ const s = ${source}; const t: ${withIndex(key, "number")} = s; }`,
    `{ const s = ${source}; const i = null! as <V>(o: ${withIndex(key, "V")}) => V; const r: never = i(s); }`,
  ]),
  ...[...product(literalsWithKeys, indexKeys)].map(([it, key]) => `{ const t: ${withIndex(key, "number")} = ${it}; }`),
  ...[...product(indexKeys, indexKeys)].map(
    ([a, b]) => `{ var v: ${withIndex(a, "string")}; var v: ${withIndex(b, "string")}; }`,
  ),
  ...[
    ...product(indexKeys.filter(isKeyOfIndexSignature), [
      "a: number = 1;",
      "ab: number = 1;",
      "0: number = 1;",
      "[u]: number = 1;",
      "[k: `ab${string}`]: number;",
      "[k: number]: number;",
    ]),
  ].map(([key, member]) => `{ class C { [k: ${key}]: string; ${member} } }`),
];

differential("matches tsc on index signatures for every key type and every index", async () =>
  expect(await casesThatDiffer({}, indexDeclarations, indexAccesses, 1)).toEqual([]),
);
differential("matches tsc on index signatures for every key type and index, with strict index options", async () => {
  const options = { noPropertyAccessFromIndexSignature: true, noUncheckedIndexedAccess: true };
  expect(await casesThatDiffer(options, indexDeclarations, indexAccesses, 1)).toEqual([]);
});
differential("matches tsc on assignability between index signatures for every pair of key types", async () =>
  expect(await casesThatDiffer({}, indexDeclarations, indexRelations, 1)).toEqual([]),
);

// Results computed while a circular reference is being resolved are recomputed afterwards. A call's arguments are
// checked once per overload, and the last check gives a callback's parameters their types.
const overloadDeclarations = [
  "declare function g<T>(cb: () => T): T; declare function h(cb: () => unknown): unknown;",
  "declare class G<T> { constructor(cb: () => T); value: T }",
  "declare function f2(o: { t: 1; m(c: string): void }): void; declare function f2(o: { t: 2; m(c: number): void }): void;",
  "declare function f2g(o: { t: 1; m(c: string): void }): void; declare function f2g<R>(o: { t: 2; m(c: R[]): void }): void;",
  "declare function fg2<R>(o: { t: 1; m(c: R[]): void }): void; declare function fg2(o: { t: 2; m(c: number): void }): void;",
  "declare function f1(o: { t: 1; m(c: string): void }): void;",
  "declare function f1g<R>(o: { t: 1; r?: R; m(c: R[]): void }): void;",
  "declare function f3(o: { t: 1; m(c: string): void }): void; declare function f3(o: { t: 2; m(c: number): void }): void; declare function f3(o: { t: 4; m(c: boolean): void }): void;",
  "declare function a2(o: [1, (c: string) => void]): void; declare function a2(o: [2, (c: number) => void]): void;",
  "declare function n2(o: { t: 1; o: { m(c: string): void } }): void; declare function n2(o: { t: 2; o: { m(c: number): void } }): void;",
  "declare function p2(t: 1, m: (c: string) => void): void; declare function p2(t: 2, m: (c: number) => void): void;",
];
const overloadedCalls = [
  ...[
    ...product(
      ["f2", "f2g", "fg2", "f1", "f1g", "f3"],
      ["1", "2", "3"],
      [
        "{ t: T, m(c) { c.nope; } }",
        "{ t: T, m: c => c.nope }",
        "{ t: T, m: function (c) { c.nope; } }",
        "{ m(c) { c.nope; }, t: T }",
      ],
    ),
  ].map(([callee, t, argument]) => `${callee}(${argument.replace("T", t)})`),
  ...["1", "2", "3"].flatMap(t => [
    `a2([${t}, c => c.nope])`,
    `n2({ t: ${t}, o: { m(c) { c.nope; } } })`,
    `p2(${t}, c => c.nope)`,
  ]),
];
// `R`: the reference back. `C`: the call.
const callContexts = ["R, C", "C, R", "C", "R, C, C"];
// `X`: the name. `B`: one of `callContexts`.
const circularDeclarations: [reference: string, declaration: string][] = [
  ["X", "const X = g(() => [B]);"],
  ["X", "const X = h(() => [B]);"],
  ["X", "const X = g(function () { return [B]; });"],
  ["X", "const X = new G(() => [B]);"],
  ["X", "const X = { p: g(() => [B]) };"],
  ["X", "const X = g(() => g(() => [B]));"],
  ["X", "const X = [B];"],
  ["X()", "function X() { return g(() => [B]); }"],
  ["X()", "function X() { return [B]; }"],
  ["X()", "const X = () => g(() => [B]);"],
  ["this.p", "class X { p = g(() => [B]); }"],
  ["this.p()", "class X { p() { return g(() => [B]); } }"],
];
const callsAfterCircularReferences = [...product(circularDeclarations, callContexts, overloadedCalls)].map(
  ([[reference, declaration], callContext, call], index) =>
    declaration
      .replace("B", () => callContext.replace(/\bR\b/g, () => reference).replace(/\bC\b/g, () => call))
      .replace(/\bX\b/g, () => `x${index}`),
);

for (const noImplicitAny of [true, false]) {
  differential(
    `matches tsc on a circular reference around an overloaded call with a callback, noImplicitAny: ${noImplicitAny}`,
    async () =>
      expect(await casesThatDiffer({ noImplicitAny }, overloadDeclarations, callsAfterCircularReferences)).toEqual([]),
  );
}

// `getGenericObjectFlags`: a generic mapped type or tuple is a generic object type but not a generic index type, `keyof
// T` and a template literal type are the reverse, and each place tests for one, the other, or either.
differential(
  "matches tsc wherever it matters whether a type is generic as an object, as an index, as both or as neither",
  async () => {
    const types = [
      ...["O", "T", "keyof O", "`a${T}`", "Uppercase<T>", "{ [P in keyof O]: 1 }", "[...U]", "O['x' & keyof O]"],
      ...["T extends 'a' ? 1 : 2", "'a' & { [P in keyof O]: 1 }", "T | 'a'", "{ a: O }", "[O]"],
    ];
    const positions = [
      "{ [K in 'a' | 'b' as K & X]: 1 }",
      "{ [K in ('a' & X) | 'b']: 1 }",
      "{ [K in X & string]: 1 }",
      "{ a: 1 }[X & 'a']",
      "{ a: 1 }[Y]",
      "`p${X & string}`",
      "Uppercase<X & string>",
      "keyof X",
      "X extends 'a' ? 1 : 2",
      "[X] extends ['a'] ? 1 : 2",
      "Omit<X, 'a'>",
    ];
    const cases = [...product(types, positions)].map(
      ([type, position], i) =>
        `function f${i}<T extends string, U extends unknown[], O>(v: ${position.replace(/\bX\b/g, () => `(${type})`).replace(/\bY\b/g, () => type)}) { const n: never = v; }`,
    );
    const rest = types.map(
      (type, i) =>
        `function r${i}<T extends string, U extends unknown[], O>(v: ${type}, k: T) { const { a, [k]: b, ...r } = v as (${type}) & { a: 1 }; const n: never = r; }`,
    );
    expect(await casesThatDiffer({}, [], [...cases, ...rest])).toEqual([]);
  },
);

// If no property declares the name in `a.name`, it resolves to the index signature's symbol, if there is one.
differential("matches tsc on an uncalled function from an index signature used as a condition", async () => {
  const declarations = [
    "type F = () => void;",
    "declare const mapped: Record<string, F>; declare const declared: { [k: string]: F }; declare const other: { [k: string]: F };",
    "declare const either: { [k: string]: F } | { [k: string]: () => number };",
    "declare const both: { f: F; [k: string]: F }; declare const nested: { a: { [k: string]: F } };",
    "declare const several: { [k: `a${string}`]: F; [k: `${string}z`]: F }; declare const literal: Record<'foo' | 'bar', F>;",
    "interface I { [k: string]: F } declare const inherited: I & { x: 1 };",
    "declare class K { [k: string]: F } declare const instance: K;",
  ];
  const receivers = [
    ...["mapped", "declared", "either", "both", "nested.a", "several", "literal", "inherited", "instance"],
    ...["(declared)", "declared!"],
  ];
  const tests = [
    "if (R.foo) {}",
    "if (R.foo) { R.foo(); }",
    "if (R.foo) { R.bar(); }",
    "if (R.foo) { other.foo(); }",
    "if (R.f) { R.foo(); }",
    "if (R.foo) { R.f(); }",
    "if (R.abz) { R.acz(); }",
    "R.foo && R.bar();",
    "R.foo ? 1 : 2;",
    "R.foo ? R.bar() : 2;",
    "function f<T extends typeof R>(t: T) { if (t.foo) {} if (t.foo) { t.bar(); } }",
  ];
  const cases = [...product(receivers, tests)]
    // `typeof (a)` and `typeof a!` aren't types.
    .filter(([receiver, test]) => !test.includes("typeof") || /^[\w.]+$/.test(receiver))
    .map(([receiver, test]) => `{ ${test.replace(/\bR\b/g, () => receiver)} }`);
  expect(await casesThatDiffer({}, declarations, cases)).toEqual([]);
});

// If a generator's contextual signature is its own signature, its yields and returns have no contextual type.
differential("matches tsc on a generator that yields literals where any type is expected", async () => {
  const declarations = [
    "declare function id<T>(x: T): T; declare function fn<T extends Function>(x: T): T; declare const n: number;",
    "declare function callable<T extends (...a: any[]) => any>(x: T): T; declare class Box<T> { constructor(x: T); x: T }",
    "declare function expects(x: () => Generator<1, 'a', 2>): void;",
  ];
  const contexts = [
    ...["id(G)", "fn(G)", "callable(G)", "Object.freeze(G)", "Promise.resolve(G)", "[1].map(() => G)", "new Box(G)"],
    ...["new Map([['a', G]])", "id({ m: G })", "id([G])", "id(id(G))", "(G)", "expects(G)", "id(n ? G : undefined)"],
  ];
  const generators = [
    "function* () { yield 1; }",
    "function* () { return 'a'; }",
    "function* () { yield 1; return 'a'; }",
    "function* () { yield; }",
    "function* () { const x: 2 = yield n; }",
    "function* () { yield n; }",
    "function* () { yield* [1]; }",
    "function* () {}",
    "async function* () { yield 1; return 'a'; }",
    "function* named() { yield true; }",
  ];
  const cases = [...product(contexts, generators)].map(
    ([context, generator]) => `{ const v: 1 = ${context.replace(/\bG\b/g, () => generator)}; }`,
  );
  expect(await casesThatDiffer({}, declarations, cases)).toEqual([]);
});

// `this` is a type parameter, so a conditional type distributes over it and a mapped type over its keys is homomorphic.
differential("matches tsc on a conditional or mapped type over `this`", async () => {
  const types = [
    "this extends { a: 1 } ? 'yes' : 'no'",
    "this extends { a: 1 } ? 1 : this extends { b: 1 } ? 2 : 3",
    "[this] extends [{ a: 1 }] ? 'yes' : 'no'",
    "this extends infer U ? U[] : never",
    "{ [K in keyof this]: this[K] }",
    "{ readonly [K in keyof this]?: K }",
    "{ [K in keyof this as `get${K & string}`]: this[K] }",
    "Partial<this>",
    "keyof this",
  ];
  const declarations = types.flatMap((type, i) => [
    `interface I${i} { m(): ${type}; p: ${type} } interface A${i} extends I${i} { a: 1 } interface B${i} extends I${i} { b: 1 }`,
    `declare class C${i} { m(): ${type}; p: ${type} } declare class D${i} extends C${i} { a: 1 } declare class E${i} extends C${i} { b?: 1 }`,
    `declare function call${i}<T extends I${i}>(x: T): ReturnType<T["m"]>; declare function get${i}<T extends C${i}>(x: T): T["p"];`,
  ]);
  const uses = [
    "null! as A#",
    "null! as B#",
    "null! as A# | B#",
    "null! as I#",
    "null! as D#",
    "null! as E#",
    "null! as D# | E#",
  ].flatMap(value => [`(${value}).m()`, `(${value}).p`, `call#(${value})`, `get#(${value})`]);
  const cases = [...product(types.keys().toArray(), uses)].map(
    ([i, use]) => `{ const v: never = ${use.replaceAll("#", String(i))}; }`,
  );
  expect(await casesThatDiffer({}, declarations, cases)).toEqual([]);
});

// A pattern has no name, so its symbol is the one used for a missing name.
differential("matches tsc on an unread parameter property that's a binding pattern", async () => {
  const modifiers = ["private", "public", "protected", "readonly", "private readonly"];
  const patterns = ["[a]: number[]", "{ a }: { a: number }", "[a] = [1]", "{ a: [b] }: { a: number[] }", "[]: []"];
  const cases = [...product(modifiers, patterns)].map(
    ([modifier, pattern]) => `(class { constructor(x: number, ${modifier} ${pattern}, private y = x) {} });`,
  );
  for (const options of [{ noUnusedLocals: true }, { noUnusedParameters: true }, {}]) {
    expect(await casesThatDiffer(options, [], cases, 1)).toEqual([]);
  }
});

// The target of `export =`, merged with what `declare module "m"` adds, is printed with the name of the file it's in.
// `@types/react-dom` augments "react" like this.
differential("prints a module with `export =` like tsc, for every augmentation and kind of import", async () => {
  const exported = {
    namespace: "declare namespace N { const a: number; }",
    class: "declare class N { static a: number; } declare namespace N { interface I {} }",
    function: "declare function N(): void; declare namespace N { const a: number; }",
    variable: "declare const N: { a: number };",
  };
  const added = {
    nothing: "",
    value: "const added: number;",
    type: "interface Added {}",
    both: "const b: 1; type B = 1;",
  };
  const files: Record<string, string> = {};
  const declarations: string[] = [];
  const cases: string[] = [];
  for (const [[kind, text], [what, more]] of product(Object.entries(exported), Object.entries(added))) {
    const [name, id] = [`${kind}-${what}`, `${kind}_${what}`];
    files[`node_modules/${name}/package.json`] = JSON.stringify({ name, version: "1.0.0", types: "index.d.ts" });
    files[`node_modules/${name}/index.d.ts`] = `${text}\nexport = N;\n`;
    if (more) files[`${name}.d.ts`] = `import "${name}";\ndeclare module "${name}" { ${more} }\n`;
    declarations.push(`import ${id}_default from "${name}"; import * as ${id}_star from "${name}";`);
    for (const value of [`${id}_default`, `${id}_star`, `(null! as typeof import("${name}"))`]) {
      cases.push(`${value}.missing;`, `{ const v: 1 = ${value}; }`, `{ const v: { missing: 1 } = ${value}; }`);
    }
  }
  const options = { module: "esnext", moduleResolution: "bundler", skipLibCheck: true };
  expect(await casesThatDiffer(options, declarations, cases, 1, files)).toEqual([]);
});

// `resolveSymbol` doesn't follow an alias that is also a value. typescript-go takes the declared type through every
// alias of the chain (`tryGetDeclaredTypeOfSymbol`), and only then rejects type arguments (`checkNoTypeArguments`).
differential(
  "matches tsc on an `import()` type of an alias that is also a value, with and without type arguments",
  async () => {
    // `Gone` is no export of `box.ts`. The type of an alias that names nothing is the error type, which `never` does
    // not take.
    const targets = { Iface: "export interface Iface<T> { value: T }", Enm: "export enum Enm { A }", Gone: "" };
    const merges = { const: (n: string) => `const ${n} = 1;`, function: (n: string) => `function ${n}() {}` };
    const files: Record<string, string> = { "box.ts": Object.values(targets).join("\n") + "\n" };
    const cases: string[] = [];
    // `m1` merges the import with a value, `m2` imports that and merges it again, `m3` exports it under two names.
    const chain = (stem: string, name: string, box: string, merge: (n: string) => string) => {
      files[`m1_${stem}.ts`] = `import type { ${name} } from "./${box}";\n${merge(name)}\nexport { ${name} };\n`;
      files[`m2_${stem}.ts`] =
        `import type { ${name} } from "./m1_${stem}";\nnamespace ${name} { export type Y = 2 }\nexport { ${name} };\n`;
      files[`m3_${stem}.ts`] = `export { ${name} as Re } from "./m2_${stem}";\nexport * as all from "./m2_${stem}";\n`;
      return [
        `"./m1_${stem}").${name}`,
        `"./m2_${stem}").${name}`,
        `"./m3_${stem}").Re`,
        `"./m3_${stem}").all.${name}`,
      ];
    };
    for (const [target, [kind, merge]] of product(Object.keys(targets), Object.entries(merges))) {
      for (const [named, args] of product(chain(`${target}_${kind}`, target, "box", merge), ["", "<string>"])) {
        cases.push(`{ const v: never = null! as import(${named}${args}; }`);
      }
    }
    // Inside the declaration that it names.
    for (const [index, [hop, args]] of [...product([0, 1], ["", "<T>"])].entries()) {
      const name = `U${index}`;
      const named = chain(name, name, `box_${name}`, merges.const)[hop];
      files[`box_${name}.ts`] = `export type ${name}<T> = T | import(${named}${args};\n`;
      cases.push(`{ const v: never = null! as import("./box_${name}").${name}<string>; }`);
    }
    expect(await casesThatDiffer({}, [], cases, 1, files)).toEqual([]);
  },
);

// `false | true` is `boolean` whether or not the two are fresh, and the elaboration doesn't single out one of them.
differential("matches tsc on booleans for every source, target and kind of assignment", async () => {
  const declarations = [
    "declare const n: number; declare const b: boolean;",
    "const one = (a: number) => { if (a) { return false } return true };",
    "const returned = one(1); let widened = one(1);",
  ];
  const booleans = [
    "one(1)",
    "returned",
    "widened",
    "((a: number) => a ? false : true)(1)",
    "(function (a: number) { if (a) return true; return false })(1)",
    "(() => { try { return true } catch { return false } })()",
    "(n ? false : true)",
    "(n ? true : one(1))",
    "b",
    "(n === 1)",
    "(b as false | true)",
    "[true, false][0]",
    "({ p: n ? true : false }).p",
  ];
  const targets = [
    ...["string", "string | number", "{ a: 1 }", "1", "false", "true", "[string]", "never", "null", "undefined"],
    ...["symbol", "object", "() => void", "`${number}`", "false | 1", "{}[]"],
  ];
  const contexts = [
    "const v: T = V;",
    "((v: T) => {})(V);",
    "(): T => V;",
    "(function (): T { return V });",
    "const v: { p: T } = { p: V };",
    "const v: T[] = [V];",
    "let v: T = null!; v = V;",
    "V satisfies T;",
  ];
  const cases = [...product(booleans, targets, contexts)].map(
    ([value, target, context]) => `{ ${context.replace(/\bT\b/g, () => target).replace(/\bV\b/g, () => value)} }`,
  );
  expect(await casesThatDiffer({}, declarations, cases)).toEqual([]);
});

// In the true branch of `[a, p] extends [A[], B[]] ? .. : ..`, `[a, p]` is also `[A[], B[]]`. A conditional type there
// that checks `[a, p]` again is still deferred, so nothing is inferred for its `infer` type parameters. They're
// `unknown`, not what `A` and `B` would give.
const narrowedCheckTypes = [
  ["[a, p]", "[readonly A[], readonly B[]]", "[I, J]"],
  ["[a]", "[readonly A[]]", "[I]"],
  ["a", "readonly A[]", "I"],
  ["[a, p, a]", "[readonly A[], readonly B[], unknown]", "[I, J, unknown]"],
  ["{ k: a; l: p }", "{ k: readonly A[]; l: readonly B[] }", "{ k: I; l: J }"],
];
const narrowedTo = [
  ["any", "any"],
  ["string", "number"],
  ["string", "string"],
  ["{ q: 1 }", "never"],
];
const inferredFromThem = [
  ["readonly (infer x)[]", "readonly (infer y)[]"],
  ["readonly [infer x, ...any[]]", "readonly [infer y, ...any[]]"],
  ["infer x", "infer y"],
  ["readonly (infer x extends string)[]", "readonly (infer y)[]"],
];
const assignedTo = [
  "{ x: string }",
  "{ x: string | number }",
  "{ x: unknown }",
  "{ x: any[] }",
  "{ x: { q: 1 } }",
  "never",
];

differential("matches tsc on a conditional type whose check type an enclosing conditional type narrows", async () => {
  const cases = [...product(narrowedCheckTypes, narrowedTo, inferredFromThem, assignedTo)].map(
    ([[check, outer, inner], [A, B], [I, J], target], index) => {
      const result = inner.includes("J") ? "{ x: x; y: y }" : "{ x: x }";
      const inside = `${check} extends ${inner.replace("I", I).replace("J", J)} ? ${result} : never`;
      const type = `${check} extends ${outer.replace("A", A).replace("B", B)} ? (${inside}) : never`;
      return `type C${index}<a, p> = ${type}; function f${index}<a, p>(g: C${index}<a, p>) { const v: ${target} = g; }`;
    },
  );
  expect(await casesThatDiffer({}, [], cases, 1)).toEqual([]);
});

// `interface D extends M<D>`, where `M<D>`'s members depend on `D`'s, is an error (TS2310). In a declaration file
// hidden by `skipLibCheck`, only its consequences show. src/js/builtins.d.ts declares `promise.$then` like that. `M<D>`
// gets its members from what `D` itself declares and, where `keyof D` is evaluated immediately, from `D`'s base types
// that are resolved before it.
const selfReferentialBases = {
  renamed: "{ [K in keyof T as `$${K & string}`]: T[K] }",
  filtered: "{ [K in keyof T as T[K] extends Function ? `$${K & string}` : never]: T[K] }",
  unconstrained: "{ [K in keyof T as T[K] extends Function ? `$${K}` : never]: T[K] }",
  plus: "{ [K in keyof T]: T[K] } & { extra: 1 }",
  getters: "{ readonly [K in keyof T as `get${Capitalize<K & string>}`]: () => T[K] }",
  record: "Partial<Record<`$${keyof T & string}`, 1>>",
  omitted: "Omit<T, 'm'> & { extra: 1 }",
  // Without `as`, the keys of a mapped type are its constraint type, which is the error type here.
  identity: "{ [K in keyof T]: T[K] }",
  partial: "Partial<T>",
  frozen: "Readonly<T>",
  required: "Required<T>",
  boxed: "{ [K in keyof T]: { value: T[K] } }",
  picked: "Pick<T, 'm'>",
};
// Returns `D`'s declaration with the base type `M<D>`, and a type that refers to `D`.
type Extending = (D: string, M: string) => [string, string];
const beforeAnotherBase: Extending = (D, M) => [`interface ${D} extends ${M}<${D}>, Other { m(): void; n: number }`, D];
const selfExtendingDeclarations: Extending[] = [
  (D, M) => [`interface ${D} extends ${M}<${D}> { m(): void; n: number }`, D],
  (D, M) => [`interface ${D}<X> extends ${M}<${D}<X>> { m(): X; n: number }`, `${D}<string>`],
  (D, M) => [`interface ${D} { m(): void } interface ${D} extends ${M}<${D}> { n: number }`, D],
  (D, M) => [`interface ${D} extends ${M}<${D}> { n: number } interface ${D} { m(): void }`, D],
  (D, M) => [`interface ${D} extends Other, ${M}<${D}> { m(): void; n: number }`, D],
  beforeAnotherBase,
  (D, M) => [`interface ${D} extends Other { m(): void; n: number } interface ${D} extends ${M}<${D}> {}`, D],
  (D, M) => [`declare class ${D} { m(): void; n: number } interface ${D} extends ${M}<${D}> {}`, D],
  (D, M) => [`interface ${D} extends ${M}<${D}> { (): void; m(): void; n: number }`, D],
];
const usesOfInterface = [
  ...["$m", "$$m", "$n", "$b", "extra", "getM", "m", "anything"].map(name => `const v: 1 = d.${name};`),
  ...["$m", "m", "$$m", "$b", "b", "extra", "getM", "anything"].map(name => `const v: 1 = null! as Has<"${name}", D>;`),
  "const v: { $m(): void } = d;",
  "const v: { m(): void } = d;",
  "const v: D = { m() {}, n: 1 } as any as { m(): any; n: number };",
  "const v: Record<string, unknown> = d;",
];
const isBaseAssignable = "const v: 1 = null! as (M extends D ? true : false);";
// `M<D>` is requested before `D`, which then ends up without `M<D>`'s members.
const usesOfBase = [
  ...["$m", "m", "$$m", "$b", "b", "extra", "getM", "anything"].map(name => `const v: 1 = null! as Has<"${name}", M>;`),
  "const v: M = d;",
  "const v: D = null! as M;",
  isBaseAssignable,
  "const v: 1 = null! as (D extends M ? true : false);",
  "type First = keyof M; const v: 1 = d.$m;",
  "type First = keyof M; const f: First = null!; const v: 1 = d.$m;",
  "const f: M = null!; f; const v: 1 = d.$m;",
  "const f: M = null!; f.$m; const v: 1 = d.$m;",
];
const sharedDeclarations = [
  "type Has<K, T> = K extends keyof T ? true : false;",
  "interface Other { b(): void; [Symbol.iterator](): void }",
  ...Object.entries(selfReferentialBases).map(([name, type]) => `type ${name}<T> = ${type};`),
];
const everyThird = isDebug || isASAN ? 3 : 1;
// In typescript-go the result depends on what's requested first, so every use gets its own interface. Each entry is the
// declaration and the use.
const extendedAndUsed = [
  ...product(Object.keys(selfReferentialBases), selfExtendingDeclarations, [...usesOfInterface, ...usesOfBase]),
].map(([base, extending, use], index) => {
  const [declaration, type] = extending(`D${index}`, base);
  const used = use.replace(/\b[DM]\b/g, (name: string) => (name === "D" ? type : `${base}<${type}>`));
  return [declaration, `{ const d = null! as ${type}; ${used} }`];
});

differential(
  "matches tsc on an interface that extends a type built from its own members, in an unchecked declaration file",
  async () => {
    const declarations = [...sharedDeclarations, ...extendedAndUsed.map(([declaration]) => declaration)];
    const files = { "declarations.d.ts": declarations.join("\n") + "\n" };
    const cases = extendedAndUsed.map(([, use]) => use);
    expect(await casesThatDiffer({}, [], cases, everyThird, files)).toEqual([]);
  },
);

differential("matches tsc on an interface extending a type built from its own members, in a checked file", async () => {
  const dollar = "type Dollar<T> = { [K in keyof T as `$${K & string}`]: T[K] };";
  const programs = [
    [dollar, "interface Foo extends Dollar<Foo> { m(): void }", "const k: 1 = null! as keyof Foo;"],
    [
      "type Plus<T> = { [K in keyof T]: T[K] } & { extra: 1 };",
      "interface Foo extends Plus<Foo> { m(): void }",
      "const k: 1 = null! as keyof Foo;",
    ],
    [
      dollar,
      "interface Fn extends Dollar<Fn> {}",
      "interface Fn { (): void }",
      "const is: 1 = null! as ((() => void) extends Fn ? true : false);",
    ],
    [
      dollar,
      "interface Foo extends Dollar<Foo> { m(): void }",
      "declare const foo: Foo;",
      "foo.$m;",
      "foo.$$m;",
      "const keysOfBase: 1 = null! as keyof Dollar<Foo>;",
      "const keys: 1 = null! as keyof Foo;",
      "const base: Dollar<Foo> = foo;",
      "const other: { $m: 1 } = foo;",
    ],
  ];
  const different = await Promise.all(programs.map(lines => casesThatDiffer({}, [], lines, 1)));
  expect(different).toEqual([[], [], [], []]);
});

differential(
  "matches tsc on an interface that extends a type built from its own members, declared right before its use",
  async () => {
    const cases = extendedAndUsed.map(([declaration, use]) => `${declaration} ${use}`);
    expect(await casesThatDiffer({}, sharedDeclarations, cases, everyThird)).toEqual([]);
  },
);

differential("matches tsc on lib interfaces that extend a type built from their own members", async () => {
  const files = {
    "declarations.d.ts": `
        type Has<K, T> = K extends keyof T ? true : false;
        type ClassWithIntrinsics<T> = { [K in keyof T as T[K] extends Function ? \`$\${K}\` : never]: T[K] };
        declare interface Map<K, V> extends ClassWithIntrinsics<Map<K, V>> {}
        declare interface CallableFunction extends ClassWithIntrinsics<CallableFunction> {}
        declare interface Promise<T> extends ClassWithIntrinsics<Promise<T>> {}
        declare interface ArrayBufferConstructor extends ClassWithIntrinsics<ArrayBufferConstructor> {}
        declare interface PromiseConstructor extends ClassWithIntrinsics<PromiseConstructor> {}
      `,
  };
  const declarations = [
    "declare const f: () => void; declare const p: Promise<number>; declare const m: Map<string, number>;",
  ];
  const cases = [
    "null! as ((() => void) extends CallableFunction ? true : false)",
    ...["f.$call", "f.$$call", "p.$then", "p.$$then", `m.$get("a")`, "m.$size", "m.$$get"],
    ...["Promise.$resolve(1)", "Promise.$$resolve", "ArrayBuffer.$isView", "ArrayBuffer.$$isView"],
    ...product(
      ["$apply", "apply", "toString", "$toString", "$then", "$get", "$all", "all", "anything"],
      ["CallableFunction", "Promise<number>", "Map<string, number>", "PromiseConstructor", "ArrayBufferConstructor"],
    ).map(([name, type]) => `null! as Has<"${name}", ${type}>`),
    `null! as Exclude<keyof CallableFunction, "apply" | "call" | "bind">`,
    "null! as Exclude<keyof PromiseConstructor, string>",
    "(<T extends (...args: any[]) => any>(fn: T): ReturnType<T> => fn.$call(undefined))(() => 2)",
  ].map(value => `{ const v: 1 = ${value}; }`);
  cases.push("{ const v: CallableFunction = f; }", "{ const v: ClassWithIntrinsics<CallableFunction> = f; }");
  expect(await casesThatDiffer({}, declarations, cases, 1, files)).toEqual([]);
});

// typescript-go records the specifier of `import()` and `require()` once for each `import` and `require` in the call's
// text, and prints why a file is in the program if there's more than one reason.
differential("lists the same reasons as tsc for why a dynamically imported file is in the program", async () => {
  const typescript = [
    `import("./import");`,
    `import("./x");`,
    `import("./import-import");`,
    `import(/* import */ "./x");`,
    `import("./x" /* require */);`,
    `/* import */ import("./x");`,
    `// import\nimport("./x");`,
    `import("./x", { with: { import: "import" } });`,
    `import("./x", /* import */ { with: {} });`,
    `import("./x", { with: {} } /* import */);`,
    `import("./x", imported);\ndeclare const imported: ImportCallOptions;`,
    `import("./x", (imported));\ndeclare const imported: ImportCallOptions;`,
    `import("./x", "import" as any);`,
    `const a = /* import */ import("./x");`,
    `async function f() { await /* require */ import("./x"); }`,
    `import("./x").then(m => "import");`,
    `import("./require");`,
    `import("./x"); import("./x");`,
    `import("./x"); /* import */`,
    "import(`./import`);",
    `import("./x",);`,
    `import("./x", /* import */);`,
    `[import("./import"), import("./x")];`,
    `import ( "./x" ) ;`,
    `import("./reimported");`,
    `import("./iimport");`,
    `import("./importimport");`,
    `import("./rrequire");`,
    `type T = typeof import("./import");`,
    `type T = import("./import").T;`,
    `import "./import";`,
    `import * as i from "./import"; i;`,
  ];
  const javascript = [
    `require("./require");`,
    `require("./x");`,
    `require(/* require */ "./x");`,
    `const a = require("./import");`,
    `import("./import");`,
    `/** import */ import("./x");`,
    `/** import */ /* import */ // import\nimport("./x");`,
    `/**/ import("./x");`,
    `x = /** import */ import("./x");`,
    `/** require */\nconst a = require("./x");`,
    `require("./x"); // require`,
    `module.exports = require("./require-import");`,
  ];
  const imported = [
    "import",
    "x",
    "import-import",
    "require",
    "reimported",
    "iimport",
    "importimport",
    "rrequire",
    "require-import",
  ];
  const cases = [
    ...typescript.map(text => ["ts", text, "export type T = 1;\n"]),
    ...javascript.map(text => ["js", text, "module.exports = 1;\n"]),
  ];
  using dir = tempDir("bun-check-differential", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { composite: true, noEmit: true, types: [], allowJs: true, skipLibCheck: true },
      files: cases.map(([extension], i) => `c${i}/a.${extension}`),
    }),
    ...Object.fromEntries(
      cases.flatMap(([extension, text, other], i) => [
        [`c${i}/a.${extension}`, text + "\n"],
        ...imported.map(name => [`c${i}/${name}.${extension}`, other]),
      ]),
    ),
  });
  const root = String(dir);
  const [bun, theirs] = await Promise.all([
    linesOf([bunExe(), "check"], root, root),
    linesOf([tsc!, "--pretty", "false", "--tsBuildInfoFile", join(root, "out.tsbuildinfo")], root, root),
  ]);
  expect(theirs.filter(line => line.includes("The file is in the program because:")).length).toBeGreaterThan(20);
  expect(bun).toEqual(theirs);
});

const swapCase = (text: string) =>
  text.replace(/[a-z]/gi, c => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
// A debug build checks a sample of the projects that take a process each.
const everyProject = isDebug || isASAN ? 4 : 1;
// The same for tsconfig files that each take two processes.
const everyConfiguration = isDebug || isASAN ? 8 * everyProject : 1;

differential("matches tsc on valid and invalid values of tsconfig.json options", async () => {
  // Valid, formerly valid, misspelled, empty and of the wrong type.
  const values: Record<string, unknown[]> = {
    target: ["es3", "ES3", "es5", "es6", "ES2015", "es2025", "es2026", "esnext", "latest", "foo", "", 5, true, null],
    module: [
      "none",
      "amd",
      "umd",
      "system",
      "commonjs",
      "es6",
      "es2022",
      "node16",
      "NodeNext",
      "preserve",
      "foo",
      "",
      1,
    ],
    moduleResolution: ["classic", "node", "node10", "node16", "nodenext", "bundler", "foo", ""],
    jsx: ["preserve", "react", "react-jsx", "react-jsxdev", "react-native", "foo", false],
    moduleDetection: ["auto", "legacy", "force", "foo"],
    newLine: ["crlf", "lf", "foo", 1],
    lib: [
      ["es3"],
      ["es5"],
      ["foo"],
      ["es5", "foo"],
      ["foo", "es5", "bar"],
      ["ES2025"],
      ["esnext.foo"],
      ["es5", 1],
      ["es5", null],
      ["es5", ""],
      [],
      "es5",
      1,
    ],
    types: ["node", [1], [null], [""], [1, "missing", 2]],
    moduleSuffixes: [[""], [1, ".ios"], ".ios"],
    rootDirs: [[1], ["."], "."],
    typeRoots: [[1], [null]],
    plugins: [[1], [{}], {}],
    customConditions: [[1], ["a"], "a"],
    paths: [1, [], { "a": 1 }, { "a": ["./a"] }],
    strict: ["true", 1, null, false],
    maxNodeModuleJsDepth: ["1", 1],
    ignoreDeprecations: ["5.0", "6.0", "7.0", "foo", 6],
  };
  // Top-level properties, next to `compilerOptions`.
  const others: Record<string, unknown[]> = {
    files: [[1], ["a.ts", 1], ["missing.ts"], [null], [""], [], "a.ts", 1, {}, null],
    include: [[1], [1, "x"], [{}], ["*.ts", true], [null], [""], [], "*.ts", null],
    exclude: [[1], ["a.ts"], [null], "a.ts", null],
    references: [[1], [{}], [{ path: 1 }], [{ path: "" }], [null], [], {}, null],
    extends: [1, true, {}, [1], [[]], [null], [""], "", [], ["./missing"], "./missing", null],
    compileOnSave: [1, "true", true, null],
    typeAcquisition: [1, {}],
    watchOptions: [1],
    buildOptions: [1],
    unknown: [1],
  };
  const cases: { compilerOptions?: object }[] = [
    ...Object.entries(values).flatMap(([name, all]) => all.map(value => ({ compilerOptions: { [name]: value } }))),
    ...Object.entries(others).flatMap(([name, all]) => all.map(value => ({ [name]: value }))),
  ].filter((_, i) => i % everyConfiguration === 0);
  using dir = tempDir(
    "bun-check-differential",
    Object.fromEntries(
      cases.flatMap((options, i) => [
        [
          `c${i}/tsconfig.json`,
          JSON.stringify({
            ...options,
            compilerOptions: { noEmit: true, skipLibCheck: true, ...options.compilerOptions },
          }),
        ],
        [`c${i}/a.ts`, `export {};\n`],
      ]),
    ),
  );
  const root = String(dir);
  const results: { options: object; bun: string[]; tsc: string[] }[] = [];
  await inBatches([...cases.entries()], async ([i, options]) => {
    const [bun, typescript] = await Promise.all([
      linesOf([bunExe(), "check", "-p", `c${i}`], root, root),
      linesOf([tsc!, "-p", `c${i}`, "--pretty", "false"], root, root),
    ]);
    results.push({ options, bun, tsc: typescript });
  });
  expect(results.filter(it => !Bun.deepEquals(it.bun, it.tsc))).toEqual([]);
});

// Every kind of value that isn't valid JSON, and arrays containing `null`, in every kind of position.
differential("matches tsc on values that aren't valid JSON in tsconfig.json", async () => {
  const values = [
    "tru",
    "undefined",
    "`es5`",
    "true + 1",
    "f()",
    "-x",
    "+1",
    "-1",
    "'single'",
    "1n",
    "/re/",
    "NaN",
    "(1)",
    "new X",
    "a.b",
    "!0",
    "void 0",
    "x => x",
    "[tru]",
    "{ a }",
    "[,]",
    "[1, tru, 'q']",
    `{ "a": tru }`,
    "null",
    "[null]",
    `[null, "q"]`,
    `["q", null, 1]`,
    "[]",
  ];
  // A reference's `path` is left out, because TypeScript 7.0.2 crashes unless it's a string.
  const positions: ((value: string) => string)[] = [
    value => `{ "compilerOptions": { "strict": ${value} } }`,
    value => `{ "compilerOptions": { "target": ${value} } }`,
    value => `{ "compilerOptions": { "outDir": ${value} } }`,
    value => `{ "compilerOptions": { "maxNodeModuleJsDepth": ${value} } }`,
    value => `{ "compilerOptions": { "lib": ${value} } }`,
    value => `{ "compilerOptions": { "types": ${value} } }`,
    value => `{ "compilerOptions": { "lib": ["es5", ${value}] } }`,
    value => `{ "compilerOptions": { "types": [${value}] } }`,
    value => `{ "compilerOptions": { "paths": ${value} } }`,
    value => `{ "compilerOptions": { "paths": { "a": ${value} } } }`,
    value => `{ "compilerOptions": { "paths": { "a": [${value}] } } }`,
    value => `{ "compilerOptions": { "qqqqqq": ${value} } }`,
    value => `{ "compilerOptions": ${value} }`,
    value => `{ "typeAcquisition": { "enable": ${value}, "include": [${value}] } }`,
    value => `{ "typeAcquisition": { "qqqqqq": ${value}, "Enable": ${value}, "exclude": ${value} } }`,
    value => `{ "typingOptions": { "enable": ${value} } }`,
    value => `{ "include": ${value} }`,
    value => `{ "include": ["a.ts", ${value}] }`,
    value => `{ "files": ${value} }`,
    value => `{ "files": ["a.ts", ${value}] }`,
    value => `{ "extends": ${value} }`,
    value => `{ "extends": [${value}] }`,
    value => `{ "references": ${value} }`,
    value => `{ "references": [${value}] }`,
    value => `{ "compileOnSave": ${value} }`,
    value => `{ "qqqqqq": ${value} }`,
    // After a comment and a line break, because an error is reported at the end of the token before the value.
    value => `{\n  "compilerOptions": {\n    "strict": // why\n      /* so */ ${value}\n  }\n}`,
    value =>
      `{ "compilerOptions": { "target": /* a */ /* b */${value} , "lib": [ /* c */ ${value} /* d */ , // e\n ${value} ] } }`,
    value => `{\r\n  "compilerOptions": {\r\n    "strict":\r\n\t${value}\r\n  }\r\n}`,
    value => value,
  ];
  // Each case takes two processes, so only the diagonals are sampled. That still covers every position and every value,
  // except in a debug build.
  const step = isDebug || isASAN ? 280 : 12;
  const cases = positions.flatMap((position, i) => values.filter((_, j) => (i + j) % step === 0).map(position));
  // The root is an array. TypeScript 7.0.2 uses the first object in it as the configuration, and only reports the array
  // (TS5092) if it contains no object.
  const implicit = (value: boolean) => `{ "compilerOptions": { "noImplicitAny": ${value} } }`;
  cases.push(
    `[${implicit(true)}]`,
    `[${implicit(false)}]`,
    `[${implicit(true)}, ${implicit(false)}]`,
    `[${implicit(false)}, ${implicit(true)}]`,
    `[1, ${implicit(false)}]`,
    `[[${implicit(false)}]]`,
    `[{ "compilerOptions": { "noImplicitAny": tru } }]`,
    `[{ "files": ["nowhere.ts"] }]`,
    `[{}]`,
  );
  using dir = tempDir(
    "bun-check-differential",
    Object.fromEntries(
      cases.flatMap((text, i) => [
        [`c${i}/tsconfig.json`, text + "\n"],
        // Whether `x` is reported shows which options are in effect.
        [`c${i}/a.ts`, `export function f(x) {\n  return x;\n}\n`],
      ]),
    ),
  );
  const root = String(dir);
  const results: { text: string; bun: string[]; tsc: string[] }[] = [];
  await inBatches([...cases.entries()], async ([i, text]) => {
    // `tsc -b` rejects `--skipLibCheck`.
    const build = text.includes(`"references"`);
    const project = [build ? "-b" : "-p", `c${i}`];
    const [bun, typescript] = await Promise.all([
      linesOf([bunExe(), "check", ...project, "--skipLibCheck"], root, root),
      linesOf([tsc!, ...project, ...(build ? [] : ["--skipLibCheck"]), "--noEmit", "--pretty", "false"], root, root),
    ]);
    results.push({ text, bun, tsc: typescript });
  });
  expect(results.filter(it => !Bun.deepEquals(it.bun, it.tsc))).toEqual([]);
});

// `tsc -b` reports project by project, in build order. A file that two projects include is reported for each.
differential("reports a build's errors project by project like `tsc -b`", async () => {
  const orders = [
    ["a", "b", "c"],
    ["a", "c", "b"],
    ["b", "a", "c"],
    ["b", "c", "a"],
    ["c", "a", "b"],
    ["c", "b", "a"],
    // The root doesn't reference all of them.
    ["c"],
    ["b", "a"],
    // This project doesn't exist, but it still has a position in the build order.
    ["b", "nowhere", "a", "c"],
  ];
  const referencing: Record<string, string[]>[] = [
    {},
    { a: ["b"] },
    { b: ["a"] },
    { a: ["c"], b: ["c"] },
    { a: ["b"], b: ["c"] },
    { c: ["b", "a"] },
    // The missing project is reported once.
    { a: ["nowhere"], c: ["b", "nowhere"] },
  ];
  // The projects whose `types` lists a missing package, which is an error without a file.
  const withoutTypes = [[], ["a", "c"], ["a", "b", "c"]];
  const combinations = [...product(orders, referencing, withoutTypes)].filter((_, i) => i % everyConfiguration === 0);
  const files: Record<string, string> = {};
  combinations.forEach(([order, references, missing], index) => {
    files[`${index}/tsconfig.json`] = JSON.stringify({ files: [], references: order.map(it => ({ path: `./${it}` })) });
    files[`${index}/shared/s.ts`] = `export const s: number = "";\n`;
    files[`${index}/shared/z.ts`] = `export const z: number = "";\nexport const y: string = 1;\n`;
    for (const name of ["a", "b", "c"]) {
      files[`${index}/${name}/tsconfig.json`] = JSON.stringify({
        compilerOptions: {
          ...{ composite: true, emitDeclarationOnly: true, outDir: "out", rootDir: "..", strict: true },
          ...{ lib: ["es2020"], skipLibCheck: true, types: missing.includes(name) ? ["missing"] : [] },
        },
        include: ["*.ts", "../shared/*.ts"],
        references: (references[name] ?? []).map(it => ({ path: `../${it}` })),
      });
      files[`${index}/${name}/${name}.ts`] = `export const ${name}: number = "";\n`;
    }
  });
  using dir = tempDir("bun-check-differential", files);
  const root = String(dir);
  const different: Record<string, object> = {};
  await inBatches([...combinations.keys()], async index => {
    const cwd = join(root, String(index));
    // `bun check` runs first, because `tsc -b` writes files.
    const ours = await linesOf([bunExe(), "check", "-b"], cwd, root);
    const theirs = await linesOf([tsc!, "-b", ".", "--pretty", "false", "--singleThreaded"], cwd, root);
    expect(theirs.length).toBeGreaterThan(0);
    if (!Bun.deepEquals(theirs, ours)) different[JSON.stringify(combinations[index])] = { theirs, ours };
  });
  expect(different).toEqual({});
});

// With four threads, each one gets a project that it loads and checks by itself. Threads that run out of projects help
// with the last ones and with the large one. A project reads what its references emitted, so the order still matters.
differential("matches `tsc -b` on a build of many small projects and a large one", async () => {
  const files: Record<string, string> = {};
  const names: string[] = [];
  const options = { composite: true, emitDeclarationOnly: true, outDir: "out", rootDir: "src", strict: true };
  for (let layer = 0; layer < 3; layer++) {
    for (let i = 0; i < 8; i++) {
      const name = `p${layer}_${i}`;
      names.push(name);
      const below = layer === 0 ? [] : [`p${layer - 1}_${i}`, `p${layer - 1}_${(i + 1) % 8}`];
      files[`${name}/tsconfig.json`] = JSON.stringify({
        compilerOptions: { ...options, lib: ["es2020"], skipLibCheck: true, types: [] },
        include: ["src"],
        references: below.map(it => ({ path: `../${it}` })),
      });
      const imports = below.map((it, k) => `import { value as v${k} } from "../../${it}/src/index";\n`).join("");
      // Every third project has its own error, and every project above the first layer has one that depends on its
      // references' declarations.
      files[`${name}/src/index.ts`] =
        imports +
        `export const value: ${i % 3 === 0 ? "number" : "string"} = "${name}";\n` +
        below.map((_, k) => `export const fromBelow${k}: boolean = v${k};\n`).join("");
      files[`${name}/src/other.ts`] = `import { value } from "./index";\nexport const length: number = value.length;\n`;
    }
  }
  names.push("large");
  files["large/tsconfig.json"] = JSON.stringify({
    compilerOptions: { ...options, lib: ["es2020"], skipLibCheck: true, types: [] },
    include: ["src"],
    references: [{ path: "../p2_0" }],
  });
  for (let i = 0; i < 70; i++) {
    files[`large/src/f${i}.ts`] =
      (i === 0 ? `import { value } from "../../p2_0/src/index";\nexport const top: boolean = value;\n` : "") +
      `export const f${i}: ${i % 10 === 0 ? "number" : "string"} = "${i}";\n`;
  }
  files["tsconfig.json"] = JSON.stringify({ files: [], references: names.map(it => ({ path: `./${it}` })) });
  using dir = tempDir("bun-check-differential", files);
  const root = String(dir);
  // `bun check` runs first, because `tsc -b` writes files.
  const ours = await linesOf([bunExe(), "check", "-b"], root, root);
  const oneThread = await linesOf([bunExe(), "check", "-b", "--threads=1"], root, root);
  const fourThreads = await linesOf([bunExe(), "check", "-b", "--threads=4"], root, root);
  const theirs = await linesOf([tsc!, "-b", ".", "--pretty", "false", "--singleThreaded"], root, root);
  expect(theirs.length).toBeGreaterThan(30);
  expect({ ours, oneThread, fourThreads }).toEqual({ ours: theirs, oneThread: theirs, fourThreads: theirs });
});

// Three projects can be built at a time, so with more threads than that several threads work on each project, and how
// many changes while it's built. `late` references nothing, so it starts with the first projects, and it reads what one
// of them emits.
differential("matches `tsc -b` on any thread count for a build with many layers of a few projects", async () => {
  const files: Record<string, string> = {};
  const names: string[] = [];
  const options = { composite: true, emitDeclarationOnly: true, outDir: "out", rootDir: "src", strict: true };
  const compilerOptions = { ...options, lib: ["es2020"], skipLibCheck: true, types: [] };
  for (let layer = 0; layer < 5; layer++) {
    for (let i = 0; i < 3; i++) {
      const name = `p${layer}_${i}`;
      names.push(name);
      const below = layer === 0 ? [] : [`p${layer - 1}_${i}`, `p${layer - 1}_${(i + 1) % 3}`];
      files[`${name}/tsconfig.json`] = JSON.stringify({
        compilerOptions,
        include: ["src"],
        references: below.map(it => ({ path: `../${it}` })),
      });
      // A project's type contains the types of all the layers below it.
      files[`${name}/src/index.ts`] =
        below.map((it, k) => `import type { Top as Below${k} } from "../../${it}/src/index";\n`).join("") +
        `import { f0 } from "./f0";\n` +
        `export interface Top { name: "${name}"; f: typeof f0; ${below.map((_, k) => `below${k}: Below${k}; `).join("")}}\n` +
        `export declare const top: Top;\n` +
        `export const wrong: ${"Top" + `["below0"]`.repeat(layer)}["name"] = "${name}";\n`;
      for (let file = 0; file < 6; file++) {
        files[`${name}/src/f${file}.ts`] =
          (file < 5 ? `import { f${file + 1} } from "./f${file + 1}";\n` : "") +
          `export const f${file}: ${file % 4 === i ? "number" : "string"} = \`${file}\`${file < 5 ? ` + f${file + 1}` : ""};\n`;
      }
    }
  }
  names.push("late");
  files["late/tsconfig.json"] = JSON.stringify({ compilerOptions, include: ["src"] });
  files["late/src/index.ts"] = `import { top } from "../../p0_2/out/index";\nexport const name: "late" = top.name;\n`;
  files["tsconfig.json"] = JSON.stringify({ files: [], references: names.map(it => ({ path: `./${it}` })) });
  using dir = tempDir("bun-check-differential", files);
  const root = String(dir);
  // `bun check` runs first, because `tsc -b` writes files.
  const ours: Record<string, string[]> = {};
  for (const threads of ["1", "2", "4", "7", "16"]) {
    ours[threads] = await linesOf([bunExe(), "check", "-b", `--threads=${threads}`], root, root);
  }
  const theirs = await linesOf([tsc!, "-b", ".", "--pretty", "false", "--singleThreaded"], root, root);
  expect(theirs.length).toBeGreaterThan(30);
  expect(ours).toEqual({ 1: theirs, 2: theirs, 4: theirs, 7: theirs, 16: theirs });
});

// Projects with the same lib files, the same options and no global declarations of their own share one check of the lib
// files, from the third such project on. A project that augments the lib files, clashes with them, or uses different
// ones must still get its own errors, and only those.
differential("reports each project's own errors in lib files like `tsc -b`", async () => {
  const base = { composite: true, emitDeclarationOnly: true, outDir: "out", strict: true, types: [], lib: ["es5"] };
  const uses =
    `export const n: string = [1, 2].length;\n` +
    `export const d: number = new Date().toISOString();\n` +
    `export const p: PromiseLike<string> = null! as PromiseLike<number>;\n`;
  const usesMore = uses + `export const q: Promise<string> = Promise.resolve(1);\n`;
  const usesPage = usesMore + `export const title: number = document.title;\nexport const last: string = [1].at(0);\n`;
  const smallest = "Array<T> Boolean CallableFunction Function IArguments NewableFunction Number Object RegExp String";
  const outside = { rootDir: ".." };
  type Project = { options?: object; listed?: string[]; files: Record<string, string> };
  const projects: Record<string, Project> = {
    // These two stop before they check the lib files. Projects waiting for a shared result must not wait for them
    // forever.
    syntaxError: { files: { "index.ts": `export const x = ;\n` + uses } },
    wrongOption: { options: { moduleResolution: "classic" }, files: { "index.ts": uses } },
    plain1: { files: { "index.ts": uses } },
    augments: {
      files: {
        "index.ts":
          `declare global {\n  interface Array<T> { extra(): T }\n  interface Date { mine: 1 }\n}\n` +
          `export const a: string = [1].extra();\nexport const w: 2 = new Date().mine;\n`,
      },
    },
    plain2: { files: { "index.ts": uses + `export const a = [1].extra();\nexport const w = new Date().mine;\n` } },
    newGlobals: {
      files: {
        "globals.ts": `declare var mine: Mine;\ninterface Mine { a: 1 }\n`,
        "index.ts": uses + `export const m: 2 = mine.a;\n`,
      },
    },
    clashVar: { files: { "globals.ts": `declare var JSON: number;\n`, "index.ts": uses } },
    clashConst: { files: { "globals.ts": `declare const Array: number;\n`, "index.ts": uses } },
    clashInterface: {
      files: {
        "globals.ts": `interface Error { message: number }\ninterface PromiseLike<T> { then: T }\n`,
        "index.ts": uses,
      },
    },
    clashInModule: {
      files: { "index.ts": `declare global {\n  var Math: number;\n  interface RegExp { source: number }\n}\n` + uses },
    },
    clashTypeParameters: { files: { "globals.d.ts": `interface Array<T, U> { two: U }\n`, "index.ts": uses } },
    plain3: { files: { "index.ts": uses + `export const m = mine;\n` } },
    noLib: { options: { noLib: true }, files: { "index.ts": `export const x: string = 1;\n` } },
    noLibOwn: {
      options: { noLib: true },
      files: {
        "lib.d.ts": smallest
          .split(" ")
          .map(it => `interface ${it} {}\n`)
          .join(""),
        "index.ts": `export const x: string = 1;\nexport const y = [1].length;\n`,
      },
    },
    more: { options: { lib: ["es5", "es2015.promise"] }, files: { "index.ts": usesMore } },
    less: { files: { "index.ts": usesMore } },
    reference1: { files: { "index.ts": `/// <reference lib="es2015.promise" />\n` + usesMore } },
    reference2: { files: { "index.ts": `/// <reference lib="es2015.promise" />\n` + usesMore } },
    reference3: { files: { "index.ts": `/// <reference lib="es2015.promise" />\n` + usesMore } },
    referenceInLibrary: { files: { "globals.d.ts": `/// <reference lib="es2015.promise" />\n`, "index.ts": usesMore } },
    page1: { options: { lib: undefined, target: "es2022" }, files: { "index.ts": usesPage } },
    page2: { options: { lib: undefined, target: "es2022" }, files: { "index.ts": usesPage } },
    page3: { options: { lib: undefined, target: "es2022" }, files: { "index.ts": usesPage } },
    olderPage: { options: { lib: undefined, target: "es2015" }, files: { "index.ts": usesPage } },
    otherTarget: { options: { target: "esnext" }, files: { "index.ts": uses } },
    loose1: { options: { strict: false }, files: { "index.ts": uses + `export const nothing: string = null;\n` } },
    loose2: { options: { strict: false }, files: { "index.ts": uses + `export const nothing: string = null;\n` } },
    loose3: { options: { strict: false }, files: { "index.ts": uses + `export const nothing: string = null;\n` } },
    exact: {
      options: { exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true },
      files: { "index.ts": uses + `export const first: number = [1][0];\n` },
    },
    sharedGlobal1: {
      options: outside,
      listed: ["index.ts", "../shared/globals.d.ts"],
      files: { "index.ts": uses + `export const s: 2 = shared.a;\n` },
    },
    sharedGlobal2: {
      options: outside,
      listed: ["../shared/globals.d.ts", "index.ts"],
      files: { "index.ts": uses + `export const s: 3 = shared.a;\n` },
    },
    sharedGlobal3: {
      options: outside,
      listed: ["../shared/globals.d.ts", "index.ts"],
      files: { "index.ts": uses + `export const s: 4 = shared.a;\n` },
    },
    sharedGlobal4: {
      options: outside,
      listed: ["../shared/globals.d.ts", "index.ts"],
      files: { "index.ts": uses + `export const s: 5 = shared.a;\n` },
    },
    brokenGlobal1: { options: outside, listed: ["../shared/broken.d.ts", "index.ts"], files: { "index.ts": uses } },
    brokenGlobal2: { options: outside, listed: ["../shared/broken.d.ts", "index.ts"], files: { "index.ts": uses } },
    brokenGlobal3: { options: outside, listed: ["../shared/broken.d.ts", "index.ts"], files: { "index.ts": uses } },
    skips: {
      options: { ...outside, skipLibCheck: true },
      listed: ["../shared/broken.d.ts", "index.ts"],
      files: { "index.ts": uses },
    },
    skipsDefault: {
      options: { ...outside, skipDefaultLibCheck: true },
      listed: ["../shared/broken.d.ts", "index.ts"],
      files: { "index.ts": uses },
    },
    globalName: { files: { "lib.d.ts": `export as namespace JSON;\nexport const v: 1;\n`, "index.ts": uses } },
    ambient: {
      files: {
        "virtual.d.ts": `declare module "virtual" {\n  export const v: Array<Missing>;\n}\n`,
        "index.ts": `import { v } from "virtual";\nexport const w: 1 = v;\n` + uses,
      },
    },
    plain4: { files: { "index.ts": uses } },
  };
  // lib.dom.d.ts takes too long in a debug build.
  if (isDebug || isASAN) for (const name of ["page1", "page2", "page3", "olderPage"]) delete projects[name];
  // A global file with no errors unless one of these options is on. Each option finds a different error in it.
  const sensitive = { ...outside, strict: false };
  const oneByOne: Record<string, object> = {
    // By the time a project with one of the options is checked, the file is known to have no errors without them.
    none1: {},
    none2: {},
    noImplicitAny: { noImplicitAny: true },
    strictNullChecks: { strictNullChecks: true },
    strictFunctionTypes: { strictFunctionTypes: true },
    exactOptionalPropertyTypes: { strictNullChecks: true, exactOptionalPropertyTypes: true },
    none3: {},
  };
  for (const [name, options] of Object.entries(oneByOne)) {
    projects[name] = {
      options: { ...sensitive, ...options },
      listed: ["../shared/sensitive.d.ts", "index.ts"],
      files: { "index.ts": uses },
    };
  }
  const files: Record<string, string> = {
    "shared/globals.d.ts": `declare const shared: Shared;\ninterface Shared { a: 1 }\n`,
    "shared/broken.d.ts": `declare const broken: Missing;\ninterface Array<T> { length: string }\n`,
    "shared/sensitive.d.ts":
      `declare function implicit(x);\n` +
      `interface Base { a: string; f: (x: string | number) => void; o?: number }\n` +
      `interface Nullable extends Base { a: string | null }\n` +
      `interface Narrower extends Base { f: (x: string) => void }\n` +
      `interface Exact extends Base { o?: number | undefined }\n`,
    "tsconfig.json": JSON.stringify({ files: [], references: Object.keys(projects).map(it => ({ path: `./${it}` })) }),
  };
  for (const [name, { options, listed, files: own }] of Object.entries(projects)) {
    const which = listed ? { files: listed } : { include: ["*.ts"] };
    files[`${name}/tsconfig.json`] = JSON.stringify({ compilerOptions: { ...base, ...options }, ...which });
    for (const file in own) files[`${name}/${file}`] = own[file];
  }
  using dir = tempDir("bun-check-differential", files);
  const root = String(dir);
  // bun and tsc keep their lib files in different directories, and a project's errors are sorted by path. So errors in
  // lib files are compared separately from the others, without their directory, as a sorted list.
  const report = async (cmd: string[]) => {
    const [own, inLibraries]: string[][] = [[], []];
    let last = own;
    for (const line of await linesOf(cmd, root, root)) {
      const name = /^[^\s(]*[\\/](lib\.[\w.]+\.d\.ts\(.*)$/.exec(line);
      // An indented line continues the error above it.
      if (!line.startsWith(" ")) last = name ? inLibraries : own;
      last.push(name ? name[1] : line);
    }
    return { own, inLibraries: inLibraries.sort() };
  };
  // `bun check` runs first, because `tsc -b` writes files.
  const ours: Record<string, object> = {};
  for (const threads of ["1", "2", "16"])
    ours[threads] = await report([bunExe(), "check", "-b", `--threads=${threads}`]);
  const theirs = await report([tsc!, "-b", ".", "--pretty", "false", "--singleThreaded"]);
  expect(theirs.inLibraries.length).toBeGreaterThan(20);
  expect(ours).toEqual({ 1: theirs, 2: theirs, 16: theirs });
});

// TypeScript caches the variances it measures while another measurement is still in progress, so they depend on which
// type of a cycle is compared first. Here the global file compares them first, in `Used`, and without that there's no
// error in model.ts. The projects that skip the global file's check have to get the same variances.
differential("reports an error that depends on variances measured by a shared global file's check", async () => {
  const names = ["a", "b", "c", "d", "e"];
  const compilerOptions = { composite: true, emitDeclarationOnly: true, outDir: "out", rootDir: "..", strict: true };
  const files: Record<string, string> = {
    "tsconfig.json": JSON.stringify({ files: [], references: names.map(it => ({ path: `./${it}` })) }),
    "shared/directives.d.ts": `
interface Binding<Value = any, Modifiers extends string = string> {
  value: Value;
  modifiers: Partial<Record<Modifiers, boolean>>;
  dir: ObjectDirective<any, Value, Modifiers>;
}
type Hook<Host = any, Value = any, Modifiers extends string = string> = (
  el: Host,
  binding: Binding<Value, Modifiers>,
) => void;
type SSRHook<Value = any, Modifiers extends string = string> = (
  binding: Binding<Value, Modifiers>,
) => object | undefined;
interface ObjectDirective<Host = any, Value = any, Modifiers extends string = string> {
  __mod?: Modifiers;
  created?: Hook<Host, Value, Modifiers>;
  getSSRProps?: SSRHook<Value, Modifiers>;
}
type FunctionDirective<Host = any, Value = any, Modifiers extends string = string> = Hook<Host, Value, Modifiers>;
type Directive<Host = any, Value = any, Modifiers extends string = string> =
  | ObjectDirective<Host, Value, Modifiers>
  | FunctionDirective<Host, Value, Modifiers>;
type Registered<D extends Directive> = D;
type Used<T> = Registered<Directive<T, number>>;
`,
  };
  for (const name of names) {
    files[`${name}/tsconfig.json`] = JSON.stringify({
      compilerOptions: { ...compilerOptions, lib: ["es5"], types: [] },
      files: ["../shared/directives.d.ts", "model.ts"],
    });
    files[`${name}/model.ts`] = `
declare const select: ObjectDirective<{ s: 1 }, any, "number">;
declare const checkbox: ObjectDirective<{ c: 1 }>;
function pick(tag: string) {
  return tag === "SELECT" ? select : checkbox;
}
export const dynamic: ObjectDirective<{ s: 1 } | { c: 1 }> = {};
dynamic.getSSRProps = binding => {
  const model = pick("a");
  return model.getSSRProps ? model.getSSRProps(binding) : undefined;
};
`;
  }
  using dir = tempDir("bun-check-differential", files);
  const root = String(dir);
  // `bun check` runs first, because `tsc -b` writes files.
  const ours: Record<string, string[]> = {};
  for (const threads of ["1", "2", "16"]) {
    ours[threads] = await linesOf([bunExe(), "check", "-b", `--threads=${threads}`], root, root);
  }
  const theirs = await linesOf([tsc!, "-b", ".", "--pretty", "false", "--singleThreaded"], root, root);
  expect(theirs.filter(line => line.includes("error TS2345"))).toHaveLength(names.length);
  expect(ours).toEqual({ 1: theirs, 2: theirs, 16: theirs });
});

// A referenced project emits its own sources. Every other file that a project imports belongs to that project.
differential("matches `tsc -b` on which files a project with references may import", async () => {
  // What `src/a.ts` imports.
  const imported = {
    "a source of the referenced project": `import "../lib/l";`,
    "a file that nothing lists": `import "../other/o";`,
    "a file that only the referenced project imports": `import "../lib/inner/i";`,
    "a JSON file": `import j from "../data.json"; j;`,
    "all of them": `import "../lib/l"; import "../other/o"; import "../lib/inner/i"; import j from "../data.json"; j;`,
  };
  const options = [
    { composite: true },
    { composite: true, rootDir: "src" },
    { rootDir: "src", outDir: "out" },
    { outDir: "out" },
    { composite: true, outDir: "out", resolveJsonModule: false },
  ];
  const references = [[], ["./lib"], ["./lib", "./unrelated"]];
  const combinations = [...product(Object.keys(imported) as (keyof typeof imported)[], options, references)];
  const base = { strict: true, lib: ["es2020"], types: [], module: "esnext", moduleResolution: "bundler" };
  const files: Record<string, string> = {};
  combinations.forEach(([what, compilerOptions, referenced], index) => {
    files[`${index}/tsconfig.json`] = JSON.stringify({
      compilerOptions: { ...base, resolveJsonModule: true, ...compilerOptions },
      include: ["src"],
      references: referenced.map(path => ({ path })),
    });
    files[`${index}/src/a.ts`] = `${imported[what]}\nexport const checked: number = "";\n`;
    files[`${index}/other/o.ts`] = `export const o = 1;\n`;
    files[`${index}/data.json`] = `{ "a": 1 }\n`;
    files[`${index}/lib/tsconfig.json`] = JSON.stringify({
      compilerOptions: { ...base, composite: true },
      files: ["l.ts"],
    });
    files[`${index}/lib/l.ts`] = `import "./inner/i";\nexport const l = 1;\n`;
    files[`${index}/lib/inner/i.ts`] = `export const i = 1;\n`;
    files[`${index}/unrelated/tsconfig.json`] = JSON.stringify({ compilerOptions: { ...base, composite: true } });
    files[`${index}/unrelated/u.ts`] = `export const u = 1;\n`;
  });
  using dir = tempDir("bun-check-differential", files);
  const root = String(dir);
  const different: Record<string, object> = {};
  await inBatches(
    [...combinations.keys()].filter(index => index % everyConfiguration === 0),
    async index => {
      const cwd = join(root, String(index));
      // `bun check` runs first, because `tsc -b` writes files.
      const ours = await linesOf([bunExe(), "check", "-b"], cwd, root);
      const theirs = await linesOf([tsc!, "-b", ".", "--pretty", "false", "--singleThreaded"], cwd, root);
      expect(theirs.length).toBeGreaterThan(0);
      if (!Bun.deepEquals(theirs, ours)) different[JSON.stringify(combinations[index])] = { theirs, ours };
    },
  );
  expect(different).toEqual({});
});

// A relative path is relative to the file it's written in.
differential("matches tsc on paths in an extended tsconfig file", async () => {
  const paths = [
    "*.ts",
    "./*.ts",
    "../*.ts",
    "/nowhere/*.ts",
    "C:/nowhere/*.ts",
    "c:\\nowhere\\*.ts",
    "\\\\server\\share\\*.ts",
    "C:nowhere/*.ts",
    "${configDir}/*.ts",
  ];
  // A drive letter or a server name starts a path only on Windows. Elsewhere neither tool finds such a file, but
  // TypeScript prints its name as on Windows.
  const isWindowsPath = (path: string) => /^([a-z]:[\\/]|\\\\)/i.test(path);
  const cases = ["include", "exclude", "files"]
    .flatMap(name => paths.map(path => [name, path]))
    .filter(([name, path]) => isWindows || name !== "files" || !isWindowsPath(path))
    .filter((_, index) => index % everyProject === 0)
    .map(([name, path]) => ({ [name]: [path] }));
  using dir = tempDir(
    "bun-check-differential",
    Object.fromEntries(
      cases.flatMap((base, i) => [
        [
          `c${i}/base/tsconfig.json`,
          JSON.stringify({ compilerOptions: { noEmit: true, skipLibCheck: true }, ...base }),
        ],
        [`c${i}/project/tsconfig.json`, JSON.stringify({ extends: "../base/tsconfig.json" })],
        [`c${i}/project/a.ts`, `export const a: number = "1";\n`],
        [`c${i}/base/b.ts`, `export const b: number = "1";\n`],
      ]),
    ),
  );
  const root = String(dir);
  const results: { base: object; bun: string[]; tsc: string[] }[] = [];
  await inBatches([...cases.entries()], async ([i, base]) => {
    const [bun, typescript] = await Promise.all([
      linesOf([bunExe(), "check", "-p", `c${i}/project`], root, root),
      linesOf([tsc!, "-p", `c${i}/project`, "--pretty", "false"], root, root),
    ]);
    results.push({ base, bun, tsc: typescript });
  });
  expect(results.filter(it => !Bun.deepEquals(it.bun, it.tsc))).toEqual([]);
});

// File names that differ only in case. On a case-insensitive file system, `import "./Button"` finds `button.ts`. It's
// one file, under the name the program reaches it by first, and every other spelling is an error (TS1149, TS1261). On a
// case-sensitive file system two files can have such names, which is an error too.
//
// Every case is a directory. Most are in one project, so that together they take only two processes. An error without a
// file suppresses the other errors of its project, so a case that can have one gets its own project.
const casingOptions = { ...JSON.parse(tsconfig).compilerOptions };
const casingConfig = (more: object, top: object = {}) =>
  JSON.stringify({ compilerOptions: { ...casingOptions, ...more }, exclude: ["**/hidden"], ...top });
// The tsconfig file's name, and `forceConsistentCasingInFileNames`.
const casingSettings: [string, object][] = [
  ["tsconfig.json", {}],
  ["tsconfig.off.json", { forceConsistentCasingInFileNames: false }],
  ["tsconfig.on.json", { forceConsistentCasingInFileNames: true }],
];
const isCasingError = (line: string) => /error TS(1149|1261):/.test(line);

const isCaseSensitive = (() => {
  using probe = tempDir("bun-check-differential", { "probe": "" });
  return !existsSync(join(String(probe), "PROBE"));
})();
// TypeScript assumes every file system has the case sensitivity of the one its executable is on. `bun check` probes the
// project's.
const casingTest = test.concurrent.skipIf(!tsc || isCaseSensitive !== !existsSync(swapCase(tsc)));

casingTest("matches tsc on file names that differ only in case", async () => {
  const target = `export class T { private secret = 1; }\nexport const wrong: number = "1";\n`;
  // How a file refers to `S`, a specifier without an extension. `I` makes its names unique.
  const forms: Record<string, string> = {
    import: `import { T as TI } from "S"; export const vI: TI | undefined = undefined;`,
    type: `import type { T as TI } from "S"; export const vI: TI | undefined = undefined;`,
    export: `export { T as TI } from "S";`,
    star: `export * as nI from "S";`,
    call: `export const vI = import("S");`,
    typeof: `export const vI: import("S").T | undefined = undefined;`,
    side: `import "S";`,
    path: `/// <reference path="S.ts" />`,
  };
  const refer = (form: string, specifiers: string[]) =>
    specifiers.map((it, i) => forms[form].replaceAll("S", () => it).replace(/I\b/g, () => String(i))).join("\n") + "\n";
  const spellings = { right: "./button", wrong: "./Button", other: "./BUTTON" };
  type Spelling = keyof typeof spellings;
  const orders: Spelling[][] = [
    ["wrong"],
    ["right", "wrong"],
    ["wrong", "right"],
    ["wrong", "other"],
    ["wrong", "wrong"],
    ["right", "wrong", "other"],
  ];

  const shared: Record<string, Record<string, string>> = {};
  const separateProjects: Record<string, { files: Record<string, string>; top?: object }> = {};
  // The referring file comes before or after it among the root files.
  for (const [form, from, order] of product(Object.keys(forms), ["App", "zapp"], orders)) {
    shared[`one-${form}-${from}-${order.join("-")}`] = {
      [`${from}.ts`]:
        refer(
          form,
          order.map(it => spellings[it]),
        ) + "export {};\n",
      "button.ts": target,
    };
  }
  // It isn't a root file.
  for (const [form, order] of product(["import", "path", "call"], orders.slice(0, 4))) {
    shared[`hidden-${form}-${order.join("-")}`] = {
      "App.ts":
        refer(
          form,
          order.map(it => spellings[it].replace("./", "./hidden/")),
        ) + "export {};\n",
      "hidden/button.ts": target,
    };
  }
  // Two files refer to it.
  for (const [a, b, first] of product(["right", "wrong"] as Spelling[], Object.keys(spellings) as Spelling[], [
    "App",
    "zapp",
  ])) {
    shared[`two-${a}-${b}-${first}`] = {
      [`${first}.ts`]: refer("import", [spellings[a]]),
      [`${first === "App" ? "Bpp" : "zbpp"}.ts`]: refer("import", [spellings[b]]),
      "button.ts": target,
    };
  }
  // The directory is spelled differently, and the file imports another.
  const inDirectories = [
    ["./Dir/leaf"],
    ["./dir/leaf", "./Dir/leaf"],
    ["./Dir/leaf", "./dir/leaf"],
    ["./Dir/leaf", "./DIR/Leaf"],
  ];
  for (const [specifiers, from] of product(inDirectories, ["App", "zapp"])) {
    shared[`directory-${from}-${inDirectories.indexOf(specifiers)}`] = {
      [`${from}.ts`]: refer("import", specifiers),
      "dir/leaf.ts": `export { T } from "./deeper";\n`,
      "dir/deeper.ts": target,
    };
  }
  shared["meet"] = {
    "App.ts": `import { T } from "./Button";\nimport { T as Same } from "./button";\nexport const a: Same = new T();\n`,
    "button.ts": target,
  };
  shared["itself"] = {
    "button.ts": `import { T as Me } from "./Button";\nexport class T { private secret = 1; }\nexport const me: Me = new T();\n`,
  };
  shared["itself-by-path"] = { "button.ts": `/// <reference path="./Button.ts" />\nexport const b = 1;\n` };
  shared["cycle"] = {
    "App.ts": `import "./Button";\nexport const a = 1;\n`,
    "button.ts": `import "./app";\nexport const b = 1;\n`,
  };
  // A package with a copy in each of these directories.
  const inPackages = [
    ["pkg"],
    ["Pkg"],
    ["pkg", "Pkg"],
    ["Pkg", "pkg"],
    ["pkg/sub", "pkg/Sub"],
    ["pkg/Sub", "pkg/sub"],
    ["pkg/Sub"],
    ["Pkg/Sub", "pkg/sub", "pkg"],
  ];
  for (const specifiers of inPackages) {
    shared[`package-${inPackages.indexOf(specifiers)}`] = {
      "App.ts": refer("import", specifiers),
      "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", version: "1.0.0", types: "index.d.ts" }),
      "node_modules/pkg/index.d.ts": `export declare class T { private secret; }\n`,
      "node_modules/pkg/sub.d.ts": `export declare class T { private secret; }\n`,
    };
  }
  // `files` lists a file under two spellings, under a spelling the directory doesn't have, or lists a file that doesn't
  // exist.
  const lists = [
    ["button.ts", "Button.ts"],
    ["Button.ts", "button.ts"],
    ["Button.ts"],
    ["Button.ts", "App.ts"],
    ["App.ts", "Button.ts"],
    ["App.ts", "button.ts", "BUTTON.ts"],
    ["none.ts", "None.ts"],
    ["None.ts", "none.ts", "NONE.ts", "App.ts"],
    ["App.ts", "none.ts", "none.ts"],
    ["button.js", "Button.js"],
  ];
  for (const files of lists) {
    separateProjects[`listed-${lists.indexOf(files)}`] = {
      files: { "App.ts": refer("import", ["./button"]), "button.ts": target },
      top: { files },
    };
  }

  if (isCaseSensitive) {
    // Two files.
    const some: Spelling[][] = [["right"], ["wrong"], ["right", "wrong"], ["wrong", "right"]];
    for (const [form, from, order] of product(["import", "path"], ["App", "zapp"], some)) {
      separateProjects[`both-${form}-${from}-${order.join("-")}`] = {
        files: {
          [`${from}.ts`]:
            refer(
              form,
              order.map(it => spellings[it]),
            ) + "export {};\n",
          "button.ts": target,
          "Button.ts": target,
        },
      };
    }
    separateProjects["both"] = { files: { "button.ts": target, "Button.ts": target } };
  }

  const files: Record<string, string> = {};
  for (const [config, more] of casingSettings) files[`shared/${config}`] = casingConfig(more);
  for (const [name, of] of Object.entries(shared)) {
    for (const [path, text] of Object.entries(of)) files[`shared/${name}/${path}`] = text;
  }
  const projects = Object.keys(separateProjects).filter((_, index) => index % everyProject === 0);
  for (const name of projects) {
    for (const [config, more] of casingSettings)
      files[`alone/${name}/${config}`] = casingConfig(more, separateProjects[name].top);
    for (const [path, text] of Object.entries(separateProjects[name].files)) files[`alone/${name}/${path}`] = text;
  }
  using dir = tempDir("bun-check-differential", files);
  const root = String(dir);

  // Which package id a path gets, and so which copy of a package file is kept, is a race between TypeScript's threads.
  const runBoth = async (directory: string, config: string) => {
    const [theirs, ours] = await Promise.all([
      linesOf([tsc!, "-p", config, "--pretty", "false", "--singleThreaded"], join(root, directory), root),
      linesOf([bunExe(), "check", "-p", config], join(root, directory), root),
    ]);
    return { theirs, ours };
  };
  const different: Record<string, object> = {};
  let casingErrorCount = 0;
  await inBatches(
    [
      ...product(
        ["shared", ...projects.map(it => `alone/${it}`)],
        casingSettings.map(it => it[0]),
      ),
    ],
    async ([directory, config]) => {
      const { theirs, ours } = await runBoth(directory, config);
      casingErrorCount += theirs.filter(isCasingError).length;
      // Only the differences, because the lists are long.
      const only = (a: string[], b: string[]) => a.filter(line => !b.includes(line));
      if (!Bun.deepEquals(theirs, ours)) {
        different[`${directory} ${config}`] = { onlyTypeScript: only(theirs, ours), onlyBun: only(ours, theirs) };
      }
      expect(theirs.length).toBeGreaterThan(0);
    },
  );
  expect(different).toEqual({});
  // Makes sure the oracle reports casing errors at all.
  expect(casingErrorCount).toBeGreaterThan(isCaseSensitive ? 4 : 200);
});

// A project referenced under a spelling the directory doesn't have, or under two spellings, is one project, named as in
// the last reference. `tsc -b` is the oracle.
casingTest("matches `tsc -b` on project references that differ only in case", async () => {
  const options = { ...casingOptions, noEmit: false, composite: true, outDir: "out", rootDir: "." };
  const config = (top: object = {}) => JSON.stringify({ compilerOptions: options, ...top });
  const combinations = [
    ...product(
      ["../core", "../Core", "../CORE/tsconfig.json"],
      [undefined, "../core", "../Core"],
      ["../core/x", "../Core/x", "../core/X"],
    ),
  ].filter((_, index) => index % everyProject === 0);
  const files: Record<string, string> = {};
  combinations.forEach(([first, second, imported], index) => {
    const references = [first, second].filter(it => it !== undefined).map(path => ({ path }));
    files[`${index}/core/tsconfig.json`] = config();
    files[`${index}/core/x.ts`] = `export class T { private secret = 1; }\nexport const wrong: number = "1";\n`;
    files[`${index}/app/tsconfig.json`] = config({ references });
    files[`${index}/app/a.ts`] =
      `import { T } from "${imported}";\nexport const t: T = new T();\nexport const bad: string = 1;\n`;
  });
  using dir = tempDir("bun-check-differential", files);
  const root = String(dir);
  const different: Record<string, object> = {};
  await inBatches([...combinations.keys()], async index => {
    const cwd = join(root, String(index), "app");
    // `bun check` runs first, because `tsc -b` writes files.
    const ours = await linesOf([bunExe(), "check", "-b"], cwd, root);
    const theirs = await linesOf([tsc!, "-b", ".", "--pretty", "false", "--singleThreaded"], cwd, root);
    expect(theirs.length).toBeGreaterThan(0);
    if (!Bun.deepEquals(theirs, ours)) different[combinations[index].join(" ")] = { theirs, ours };
  });
  expect(different).toEqual({});
});

// `bun check` can replace `tsc` in a script: with the same arguments, in the same directory, it checks the same files.
// Where tsc checks nothing at all (it prints its help, or TS5112, TS6231 or TS6504 for a path next to a tsconfig.json,
// or the project has no files of its own), `bun check` is free to be more useful.
differential("checks the same files as tsc for every project layout and command line", async () => {
  const options = `"strict": true, "types": [], "lib": ["es2022"], "skipLibCheck": true`;
  const config = (more: string, rest = "") => `{ "compilerOptions": { ${options}${more} }${rest} }\n`;
  const wrong = (name: string) => `export const ${name}: number = "";\n`;
  const library = {
    "lib/tsconfig.json": config(`, "composite": true, "outDir": "dist"`, `, "include": ["src"]`),
    "lib/src/index.ts": `export const one = 1;\n`,
    "lib/src/index.test.ts": wrong("inTheLibrary"),
    "app/tsconfig.json": config(`, "noEmit": true`, `, "include": ["src"], "references": [{ "path": "../lib" }]`),
    "app/src/main.ts": `import { one } from "../../lib/src/index";\nexport const two: string = one;\n`,
  };
  // The directory to run in, a file in it, what is built first, and the files.
  const layouts: Record<string, [string, string, string[], Record<string, string>]> = {
    "a tsconfig.json": [
      ".",
      "a.ts",
      [],
      { "tsconfig.json": config(`, "noEmit": true`), "a.ts": wrong("a"), "sub/b.ts": wrong("b") },
    ],
    "include and exclude": [
      ".",
      "src/a.ts",
      [],
      {
        "tsconfig.json": config(`, "noEmit": true`, `, "include": ["src"], "exclude": ["**/*.test.ts"]`),
        "src/a.ts": wrong("a"),
        "src/a.test.ts": wrong("excluded"),
        "tools/c.ts": wrong("notIncluded"),
      },
    ],
    "extends": [
      ".",
      "src/a.ts",
      [],
      {
        "base.json": config(`, "noEmit": true`),
        "tsconfig.json": `{ "extends": "./base.json", "include": ["src"] }\n`,
        "src/a.ts": wrong("a"),
      },
    ],
    "another tsconfig.json in a subdirectory": [
      ".",
      "src/a.ts",
      [],
      {
        "tsconfig.json": config(`, "noEmit": true`, `, "include": ["src"]`),
        "src/a.ts": wrong("a"),
        "pkg/tsconfig.json": config(`, "noEmit": true`),
        "pkg/p.ts": wrong("p"),
      },
    ],
    "references that are built": ["app", "src/main.ts", ["-b", "../lib"], library],
    "a missing reference": [
      "app",
      "src/main.ts",
      [],
      { "app/tsconfig.json": library["app/tsconfig.json"], "app/src/main.ts": wrong("main") },
    ],
    "no tsconfig.json": [".", "a.ts", [], { "a.ts": wrong("a") }],
    "tsconfig.json files in subdirectories only": [
      ".",
      "packages/a/a.ts",
      [],
      {
        "packages/a/tsconfig.json": config(`, "noEmit": true`),
        "packages/a/a.ts": wrong("a"),
        "packages/b/tsconfig.json": config(`, "noEmit": true`),
        "packages/b/b.ts": wrong("b"),
      },
    ],
  };
  const commandLines = [[], ["-p", "."], ["-p", "tsconfig.json"], ["--noEmit"], ["-b"], ["-b", "."], ["FILE"], ["."]];
  const cells = Object.entries(layouts).flatMap(([layout, it]) => commandLines.map(args => ({ layout, it, args })));
  const files: Record<string, string> = {};
  // Each cell gets its own copy, because a build writes files.
  for (const [index, { it }] of cells.entries())
    for (const side of ["theirs", "ours"]) for (const path in it[3]) files[`${index}/${side}/${path}`] = it[3][path];
  using dir = tempDir("bun-check-contract", files);
  const outcomeOf = async (cmd: string[], cwd: string, root: string) => {
    await using proc = spawn({ timeout: longLimit, cmd, cwd, env, stdout: "pipe", stderr: "ignore" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const lines = stdout.replaceAll("\\", "/").replaceAll(root.replaceAll("\\", "/"), "").split(/\r?\n/);
    // tsc exits with 2 if it wrote files despite errors.
    return { lines: lines.filter(line => line.trim()), fails: exitCode !== 0 };
  };
  const different: Record<string, object> = {};
  let compared = 0;
  await inBatches([...cells.entries()], async ([index, { layout, it, args }]) => {
    const [directory, file, before] = it;
    const given = args.map(arg => (arg === "FILE" ? file : arg));
    const [theirRoot, ourRoot] = ["theirs", "ours"].map(side => join(String(dir), `${index}`, side));
    for (const root of before.length ? [theirRoot, ourRoot] : [])
      await outcomeOf([tsc!, ...before], join(root, directory), root);
    const theirs = await outcomeOf([tsc!, ...given, "--pretty", "false"], join(theirRoot, directory), theirRoot);
    if (/^Version |error TS(5112|6231|6504):/.test(theirs.lines[0] ?? "")) return;
    compared++;
    const ours = await outcomeOf([bunExe(), "check", ...given], join(ourRoot, directory), ourRoot);
    if (!Bun.deepEquals(theirs, ours)) different[`${layout}: ${args.join(" ")}`] = { theirs, ours };
  });
  expect(different).toEqual({});
  // Makes sure most cells were actually compared.
  expect(compared).toBeGreaterThan(cells.length / 2);
});

/** Returns what the two print for a project in which each of `cases` is its own module. */
async function checkModules(cases: string[]) {
  const name = (index: number) => `c${String(index).padStart(2, "0")}.ts`;
  using dir = tempDir("bun-check-differential", {
    "tsconfig.json": tsconfig,
    ...Object.fromEntries(cases.map((text, index) => [name(index), `${text}\nexport {};\n`])),
  });
  const root = String(dir);
  const [theirs, ours] = await Promise.all([
    linesOf([tsc!, "-p", ".", "--pretty", "false"], root, root),
    linesOf([bunExe(), "check"], root, root),
  ]);
  return { theirs, ours };
}

// TypeScript first parses a top-level statement of a module with `await` as a name. It parses the statement again, with
// `await` as the operator, only if the first parse found a reference to `await`. A parameter, property or declaration
// name isn't one, and neither is anything in a function body.
differential("parses a top-level arrow function whose first parameter is `await` only once, like tsc", async () => {
  const { theirs, ours } = await checkModules([
    "var f = (await) => {};",
    "var f = (await: number) => {};",
    "declare function g(x: unknown): void; g((await: number) => {});",
    "var f = (await, b) => {};",
    "var f = (await?) => {};",
    "var f = (await?: number) => {};",
    "var f = (await = 1) => {};",
    "var f = (await): void => {};",
    "var f = async (await) => {};",
    "var f = async (await: number) => {};",
    "var f = { a: (await: number) => {} };",
    "var f = (await: number) => { return await; };",
    "var f = (await: number) => {}, g = await 1;",
    "var f = (await: number) => (await: number) => {};",
    "var f = (await: number, b = await 1) => {};",
    "(await) => {};",
    "(await: number) => {};",
    "var f = true ? (await) => {} : 1;",
    "for (const x of [(await: number) => {}]) {}",
    "if (true) { var f = (await: number) => {}; }",
    "export const f = (await: number) => {};",
    "var f = (public await: number) => {};",
    "var f = (await\n) => {};",
    "var f = (await)\n=> {};",
    "var f = (await) => {}, { [await]: x } = {};",
    "var f = (await, ...b) => {};",
    "var f = (await, { b }) => {};",
    "@((await: number) => {}) class C {}",
    "class C extends ((await: number) => {}) {}",
    "var f = (await: number) => {}, g = { await: 1 };",
    "var f = (await: number) => {}, g = function await() {};",
    "var f = (await: number) => {}, g = class await {};",
    "var f = (await: number) => {}, g = (x: { await: 1 }) => {};",
    "var f = { await }, g = function () { return await; };",
  ]);
  // Nothing is type checked after a syntax error.
  expect(theirs.join("\n")).toContain("error TS7006");
  expect(ours).toEqual(theirs);
});

// In the second parse `(await` doesn't start an arrow function and `{ await }` isn't a shorthand property. A default
// export, `export =` and an exported class are parsed that way the first time.
differential("matches tsc on a name `await` in a statement reparsed with `await` as the operator", async () => {
  const { theirs, ours } = await checkModules([
    "var f = (await: number) => await + 1;",
    "var g = await (1), f = (await: number) => {};",
    "var f = (await: number, b = await) => {};",
    "var f = (await: number, b = () => await) => {};",
    "var f = (await: await) => {};",
    "export default (await: number) => {};",
    "export = (await: number) => {};",
    "export class C extends ((await: number) => {}) {}",
    "export default class C extends ((await: number) => {}) {}",
    "var f = (await);",
    "var f = (await, 1);",
    "var f = (await = 1);",
    "var f = true ? (await) : 1;",
    "var f = true ? (await) : (await) => {};",
    "var f = (await.x) => {};",
    "var f = (await x) => {};",
    "var f = (await) { };",
    "var f = (await): number { return 1 };",
    "var f = { await }, g = (x: number) => await;",
    "var f = { await }, g = (x = await) => 1;",
    "var f = { await }, g: await = 1;",
    "var f = { await }, g = class { x = await };",
    "var f = { await }, g = f.await;",
    "export default { await };",
    "export default { [await]: 1 };",
    "export class C { [await] = 1 }",
    "export default class C { [await] = 1 }",
  ]);
  expect(theirs.length).toBeGreaterThan(27);
  expect(ours).toEqual(theirs);
});

differential("matches tsc on an initializer in an interface or a type literal", async () => {
  const { theirs, ours } = await checkModules([
    "declare const e: unique symbol; interface C { [e] = 1 }",
    "declare const e: unique symbol; interface C { readonly [e] = 1 }",
    "declare const e: unique symbol; interface C { [e]? = 1 }",
    "declare const e: unique symbol; type C = { [e] = 1 };",
    'interface C { ["x"] = 1; b: string }',
    "interface C { get = 1 }",
    "interface C { set = 1 }",
    "interface C { a: number = 1 }",
    '{ interface C { static ["x"] = @dec class {} } }',
  ]);
  expect(theirs.join("\n")).toContain("error TS1246");
  expect(ours).toEqual(theirs);
});

// A build that isn't optimized runs out of stack at a smaller depth.
test.concurrent.skipIf(!tsc || isDebug || isASAN)("matches tsc on expressions nested over 1,000 deep", async () => {
  const { theirs, ours } = await checkModules([
    `declare const c: boolean; export const x: string = ${"c ? 1 : ".repeat(1_200)}2;`,
    `declare const c: boolean; export const x: string = ${"c || (".repeat(1_500)}1${")".repeat(1_500)};`,
    `export const x: string = ${"!".repeat(1_200)}1;`,
  ]);
  expect(theirs.filter(line => line.includes("error TS2322"))).toHaveLength(3);
  expect(ours).toEqual(theirs);
});
