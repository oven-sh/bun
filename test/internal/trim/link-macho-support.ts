import { trimExecutable } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect } from "bun:test";
import { isLinux, isMacOS, tempDir } from "harness";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FeatureName } from "../../../scripts/build/trim/features.ts";
import type { TrimTable } from "../../../scripts/build/trim/table.ts";
import type { BuiltinEntry } from "../../../scripts/build/trim/types.ts";
import {
  cleanExit,
  cxxFlags,
  embedderSource,
  entryPointsText,
  Extra,
  featureFlags,
  indexOf,
  inspect,
  linkArguments,
  model,
  plainSources,
  run,
  writeLinkInputs,
} from "./toy-program.ts";

export const tools = Object.fromEntries(["clang", "ld64.lld", "llvm-ar", "llvm-cxxfilt"].map(name => [name, Bun.which(name)]));
const nm = Bun.which("llvm-nm") ?? Bun.which("nm");
export const canLink = (isLinux || isMacOS) && nm !== null && Object.values(tools).every(path => path !== null);
export const linkSkipReason = "it needs clang, ld64.lld, llvm-ar, llvm-cxxfilt and llvm-nm or nm, on Linux or macOS";
const codesign = isMacOS && process.arch === "arm64" ? Bun.which("codesign") : null;

export interface Machine {
  name: "arm64" | "x86_64";
  target: string;
  isArm64: boolean;
  canRun: boolean;
}

const machines: Machine[] = [
  { name: "arm64", target: "arm64-apple-macos13", isArm64: true, canRun: codesign !== null },
  { name: "x86_64", target: "x86_64-apple-macos13", isArm64: false, canRun: false },
];

export const describeEachMachine = describe.concurrent.skipIf(!canLink).each(machines);

export const count = 700;

export const exits = (code: string) => `
  #ifdef __aarch64__
    register long code __asm__("x0") = ${code};
    register long number __asm__("x16") = 1;
    __asm__ volatile("svc #0x80" : : "r"(code), "r"(number));
  #endif
  __builtin_trap();
`;

export const sources = { ...plainSources("macho", count), "embedder.c": embedderSource("macho", { exit: exits }), "exported.txt": "_main\n" };

interface Section {
  name: string;
  address: number;
  size: number;
  offset: number;
}

function readMachO(file: Buffer) {
  const segments: Section[] = [];
  const sections: Section[] = [];
  const readOnlySegments: string[] = [];
  const addressOf = new Map<string, number>();
  let fixups = 0;
  let at = 32;
  for (let command = file.readUInt32LE(16); command > 0; command--) {
    const kind = file.readUInt32LE(at);
    const text = (offset: number) => file.toString("latin1", offset, offset + 16).replace(/\0.*$/, "");
    if (kind === 0x19) {
      segments.push({ name: text(at + 8), address: Number(file.readBigUInt64LE(at + 24)), size: Number(file.readBigUInt64LE(at + 48)), offset: Number(file.readBigUInt64LE(at + 40)) });
      if (file.readUInt32LE(at + 68) & 0x10) readOnlySegments.push(text(at + 8));
      for (let index = 0; index < file.readUInt32LE(at + 64); index++) {
        const section = at + 72 + index * 80;
        sections.push({
          name: `${text(section + 16)},${text(section)}`,
          address: Number(file.readBigUInt64LE(section + 32)),
          size: Number(file.readBigUInt64LE(section + 40)),
          offset: file.readUInt32LE(section + 48),
        });
      }
    } else if (kind === 2) {
      const strings = file.readUInt32LE(at + 16);
      for (let index = 0; index < file.readUInt32LE(at + 12); index++) {
        const entry = file.readUInt32LE(at + 8) + index * 16;
        if ((file[entry + 4]! & 0xee) !== 0x0e) continue;
        const name = strings + file.readUInt32LE(entry);
        addressOf.set(file.toString("latin1", name, file.indexOf(0, name)).replace(/^_/, ""), Number(file.readBigUInt64LE(entry + 8)));
      }
    } else if (kind === 0x80000034) fixups = file.readUInt32LE(at + 8);
    at += file.readUInt32LE(at + 4);
  }
  const holds = (address: number) => (part: Section) => part.address <= address && address < part.address + part.size;
  const segmentAt = (address: number) => segments.find(holds(address));
  const sectionAt = (address: number) => sections.find(section => section.offset > 0 && holds(address)(section));
  const offsetOf = (address: number) => segmentAt(address)!.offset + address - segmentAt(address)!.address;
  const section = (name: string) => sections.find(section => section.name === name);
  return { segments, readOnlySegments, sections, section, segmentAt, sectionAt, offsetOf, addressOf, fixups };
}

export function mergedRanges(ranges: { start: number; end: number }[]) {
  const dead: { start: number; end: number }[] = [];
  for (const { start, end } of ranges) {
    if (dead.at(-1)?.end === start) dead.at(-1)!.end = end;
    else dead.push({ start, end });
  }
  return dead;
}

function pagesWithFixups(file: Buffer, { segments, fixups }: ReturnType<typeof readMachO>) {
  const pages: { start: number; end: number; chain: number }[] = [];
  if (fixups === 0) return pages;
  const starts = fixups + file.readUInt32LE(fixups + 4);
  for (let segment = 0; segment < file.readUInt32LE(starts); segment++) {
    const info = starts + file.readUInt32LE(starts + 4 + segment * 4);
    if (info === starts) continue;
    const size = file.readUInt16LE(info + 4);
    const first = segments.find(({ name }) => name === "__TEXT")!.address + Number(file.readBigUInt64LE(info + 8));
    for (let page = 0; page < file.readUInt16LE(info + 20); page++) pages.push({ start: first + page * size, end: first + (page + 1) * size, chain: info + 22 + page * 2 });
  }
  return pages;
}

function* chainedPointers(file: Buffer, image: ReturnType<typeof readMachO>): Generator<[address: number, pointer: bigint]> {
  for (const { start, chain } of pagesWithFixups(file, image)) {
    const first = file.readUInt16LE(chain);
    if (first === 0xffff) continue;
    for (let at = start + first; ; ) {
      const pointer = file.readBigUInt64LE(image.offsetOf(at));
      yield [at, pointer];
      const next = Number((pointer >> 51n) & 0xfffn) * 4;
      if (next === 0) break;
      at += next;
    }
  }
}

export const featureName = (index: number) => model.features.find(feature => feature.index === index)!.name;
export const sortedByIndex = (...features: FeatureName[]) => features.toSorted((a, b) => indexOf(a) - indexOf(b));

function rangesRemovedWith(table: TrimTable, removed: FeatureName[]) {
  const removedIndexes = new Set(removed.map(indexOf));
  return mergedRanges(table.ranges.filter(range => table.sets[range.set]!.every(feature => removedIndexes.has(feature))));
}

function danglingReferences(file: Buffer, image: ReturnType<typeof readMachO>, table: TrimTable, entryAddresses: Set<number>, isArm64: boolean, removed: FeatureName[]) {
  const dead = rangesRemovedWith(table, removed);
  const isDead = (address: number) => dead.some(({ start, end }) => start <= address && address < end);
  const names = [...image.addressOf].sort((a, b) => a[1] - b[1]);
  const found: string[] = [];
  const refersTo = (from: number, to: number) => {
    if (isDead(from) || !isDead(to) || entryAddresses.has(to)) return;
    const [holder] = names.findLast(([, address]) => address <= from) ?? [""];
    found.push(`${holder}: 0x${from.toString(16)} -> 0x${to.toString(16)}`);
  };
  const base = image.segments.find(({ name }) => name === "__TEXT")!.address;
  for (const [at, pointer] of chainedPointers(file, image)) if (pointer >> 63n === 0n) refersTo(at, Number(pointer & 0xfffffffffn));
  const beforeMain = image.section("__TEXT,__init_offsets");
  for (let at = 0; at < (beforeMain?.size ?? 0); at += 4) refersTo(beforeMain!.address + at, base + file.readUInt32LE(beforeMain!.offset + at));
  if (!isArm64) return found;
  const signed = (value: number, bits: number) => (value >= 2 ** (bits - 1) ? value - 2 ** bits : value);
  for (const { name, address, size, offset } of image.sections) {
    if (name !== "__TEXT,__text" && !name.startsWith("__TEXT,__jsc_")) continue;
    for (let at = 0; at < size; at += 4) {
      const word = file.readUInt32LE(offset + at);
      const distance21 = signed((((word >>> 5) & 0x7ffff) << 2) | ((word >>> 29) & 3), 21);
      if ((word & 0x7c000000) >>> 0 === 0x14000000) refersTo(address + at, address + at + signed(word & 0x3ffffff, 26) * 4);
      else if ((word & 0x9f000000) >>> 0 === 0x10000000) refersTo(address + at, address + at + distance21);
      else if ((word & 0x9f000000) >>> 0 === 0x90000000 && at + 4 < size) {
        const next = file.readUInt32LE(offset + at + 4);
        const isMatchingAdd = (next & 0xffc00000) >>> 0 === 0x91000000 && ((next >>> 5) & 31) === (word & 31);
        if (isMatchingAdd) refersTo(address + at, address + at - ((address + at) % 4096) + distance21 * 4096 + ((next >>> 10) & 0xfff));
      }
    }
  }
  return found;
}

const subsetsOf = (features: FeatureName[]): FeatureName[][] => features.reduce<FeatureName[][]>((subsets, feature) => [...subsets, ...subsets.map(subset => [...subset, feature])], [[]]);

const withoutChainLink = (pointer: bigint) => pointer & ~(0xfffn << 51n);

function lostFixups(whole: Buffer, trimmed: Buffer, removedRanges: { start: number; end: number }[]) {
  const remaining = new Map(chainedPointers(trimmed, readMachO(trimmed)));
  const lost: string[] = [];
  for (const [address, pointer] of chainedPointers(whole, readMachO(whole))) {
    if (removedRanges.some(({ start, end }) => start <= address && address < end)) continue;
    const found = remaining.get(address);
    if (found === undefined || withoutChainLink(found) !== withoutChainLink(pointer)) lost.push(`0x${address.toString(16)}`);
  }
  return lost;
}

export function recordRelocationKinds(object: Buffer) {
  const kinds = new Set<"symbol" | "section">();
  let at = 32;
  for (let command = object.readUInt32LE(16); command > 0; command--) {
    const sectionCount = object.readUInt32LE(at) === 0x19 ? object.readUInt32LE(at + 64) : 0;
    for (let index = 0; index < sectionCount; index++) {
      const section = at + 72 + index * 80;
      if (object.toString("latin1", section, section + 16).replace(/\0.*$/, "") !== "__bun_entries") continue;
      const relocations = object.readUInt32LE(section + 56);
      for (let entry = 0; entry < object.readUInt32LE(section + 60); entry++) kinds.add((object.readUInt32LE(relocations + entry * 8 + 4) >>> 27) & 1 ? "symbol" : "section");
    }
    at += object.readUInt32LE(at + 4);
  }
  return [...kinds].sort();
}

export interface Program {
  objects?: string[];
  compileFlags?: Record<string, string[]>;
  linkFlags?: string[];
  archived?: string[];
  inputs?: string[];
  minimums?: Record<FeatureName, number>;
  builtins?: BuiltinEntry[];
  removed?: FeatureName[];
}

const featureCodeObjects = new Map<string, string>();
let shared: ReturnType<typeof tempDir> | undefined;

export async function compile(machine: Machine, folder: string, name: string, flags: string[] = []) {
  const source = [".c", ".cpp", ".S"].map(extension => name + extension).find(file => Bun.file(join(folder, file)).size > 0)!;
  const languageFlags = source.endsWith(".cpp") ? cxxFlags : [];
  const compiled = await run([tools.clang!, `--target=${machine.target}`, "-O1", "-faddrsig", ...featureFlags, ...languageFlags, ...flags, "-c", source, "-o", `${name}.o`], folder);
  expect(compiled).toEqual(cleanExit);
}

const baseLinkFlags = (machine: Machine, map: string) => [
  `--target=${machine.target}`,
  "-mlinker-version=705",
  `--ld-path=${tools["ld64.lld"]}`,
  "-nostdlib",
  ...(machine.canRun ? ["-lSystem"] : []),
  "-Wl,-e,_main",
  "-dead_strip",
  "-Wl,--icf=safe",
  `-Wl,-map,${map}`,
  "-exported_symbols_list",
  "exported.txt",
];

const isSharedObject = (name: string) => name === "feature_code";

async function compileObjects(machine: Machine, folder: string, objects: string[], compileFlags: Record<string, string[]> = {}) {
  for (const name of objects) if (!isSharedObject(name)) await compile(machine, folder, name, compileFlags[name]);
}

export async function wrapped(machine: Machine, folder: string, program: Program) {
  const { objects = ["feature_code", "entry", "table", "embedder", "main"], compileFlags, linkFlags = [], archived = [], inputs = [], minimums, builtins } = program;
  await compileObjects(machine, folder, objects, compileFlags);
  if (archived.length > 0) expect((await run([tools["llvm-ar"]!, "rcs", "lib.a", ...archived.map(name => `${name}.o`)], folder)).exitCode).toBe(0);
  const linkedObjects = objects.filter(name => !archived.includes(name)).map(name => (isSharedObject(name) ? featureCodeObjects.get(machine.name)! : `${name}.o`));
  const linkInputs = [...linkedObjects, ...(archived.length > 0 ? ["lib.a"] : []), ...inputs];
  writeFileSync(join(folder, "in.rsp"), linkInputs.map(path => `${path}\n`).join(""));
  const command = [tools.clang!, "@in.rsp", ...baseLinkFlags(machine, "program.map"), ...linkFlags, "-o", "program"];
  return await run(linkArguments(writeLinkInputs(folder, { minimums, builtins }), command, { demangler: tools["llvm-cxxfilt"]! }), folder);
}

export async function linkByHand(machine: Machine, folder: string, objects: string[]) {
  await compileObjects(machine, folder, objects);
  const inputs = objects.map(name => (isSharedObject(name) ? featureCodeObjects.get(machine.name)! : join(folder, `${name}.o`)));
  const [executable, map] = [join(folder, "hand"), join(folder, "hand.map")];
  expect((await run([tools.clang!, ...inputs, ...baseLinkFlags(machine, map), "-o", executable], folder)).exitCode).toBe(0);
  return { executable, map, exportedSymbols: join(folder, "exported.txt") };
}

async function signAndRun(folder: string, name: string, file: Buffer) {
  writeFileSync(join(folder, name), file);
  chmodSync(join(folder, name), 0o755);
  expect((await run([codesign!, "-s", "-", "-f", name], folder)).exitCode).toBe(0);
  return await run([join(folder, name)], folder);
}

export const guardedArguments = ["a", "b", "c", "d", "e"];

const entryLine = /^\S+ \S+ \d+ (.*?) \(\S+, \d+ bytes\) <- /;

async function entryAddressesOf(folder: string, addressOf: Map<string, number>) {
  const mangled = [...addressOf.keys()].filter(name => name.startsWith("_Z") || name.startsWith("_R"));
  const demangled = mangled.length > 0 ? (await run([tools["llvm-cxxfilt"]!, "--no-strip-underscore", ...mangled], folder)).stdout.split("\n") : [];
  const addressByPlainName = new Map(addressOf);
  mangled.forEach((name, index) => addressByPlainName.set(demangled[index]!, addressOf.get(name)!));
  const entries = entryPointsText(folder, "program").split("\n").flatMap(line => entryLine.exec(line)?.[1] ?? []);
  return new Set(
    entries.map(name => {
      const address = addressByPlainName.get(name) ?? addressByPlainName.get(name.replace(/^_/, ""));
      if (address === undefined) throw new Error(`program has no symbol ${name}, which entry-points.txt lists`);
      return address;
    }),
  );
}

export async function linked(machine: Machine, folder: string, program: Program = {}) {
  const linkResult = await wrapped(machine, folder, program);
  expect({ stderr: linkResult.stderr, exitCode: linkResult.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const file = readFileSync(join(folder, "program"));
  const image = readMachO(file);
  const { table, featuresAt } = await inspect(join(folder, "program"), nm!);
  const addressOf = (name: string) => {
    const address = image.addressOf.get(name);
    if (address === undefined) throw new Error(`program has no symbol ${name}`);
    return address;
  };
  const featuresOf = (name: string) => featuresAt(addressOf(name));
  const isRemovableAt = (address: number) => featuresAt(address) !== undefined;
  const strings = image.section("__TEXT,__cstring");
  const stringAt = (text: string) => {
    const bytes = file.subarray(strings!.offset, strings!.offset + strings!.size);
    const at = bytes.indexOf(Buffer.from(`${text}\0`, "latin1"));
    if (at < 0 || (at > 0 && bytes[at - 1] !== 0)) throw new Error(`program has no string ${JSON.stringify(text)} in __TEXT,__cstring`);
    return strings!.address + at;
  };
  const entryAddresses = await entryAddressesOf(folder, image.addressOf);
  const features = [...new Set(table.sets.flat())].sort((a, b) => a - b).map(featureName);
  for (const removed of subsetsOf(features)) expect({ removed, dangling: danglingReferences(file, image, table, entryAddresses, machine.isArm64, removed) }).toEqual({ removed, dangling: [] });
  const trim = (name: string, removed: FeatureName[]) => {
    const summary = trimExecutable(join(folder, "program"), join(folder, name), removed);
    expect({ removed, lost: lostFixups(file, readFileSync(join(folder, name)), rangesRemovedWith(table, removed)) }).toEqual({ removed, lost: [] });
    return summary;
  };
  const summary = trim("trimmed", program.removed ?? [Extra]);
  const programResult = machine.canRun ? await signAndRun(folder, "whole", file) : undefined;
  const trimmedResult = machine.canRun ? await run([join(folder, "trimmed")], folder) : undefined;
  return { file, ...image, linkOutput: linkResult.stdout, table, addressOf, featuresAt, featuresOf, isRemovableAt, stringAt, entryAddresses, trim, summary, programResult, trimmedResult };
}

export type LinkedProgram = Awaited<ReturnType<typeof linked>>;

export const statisticOf = (linkOutput: string, name: string) => Number(new RegExp(`^graph: .*\\b${name} (\\d+)`, "m").exec(linkOutput)?.[1]);

export async function expectTrimmedImage(machine: Machine, folder: string) {
  const { segments, readOnlySegments } = readMachO(readFileSync(join(folder, "trimmed")));
  expect(segments.filter(({ name }) => name === "__TEXT").map(({ offset }) => offset)).toEqual([0]);
  expect(readOnlySegments.length).toBeLessThanOrEqual(1);
  const mapped = segments.filter(({ size }) => size > 0);
  const overlapping = mapped.flatMap((first, index) =>
    mapped.slice(index + 1).flatMap(second => {
      const overlapsAddress = first.address < second.address + second.size && second.address < first.address + first.size;
      const overlapsFile = first.offset < second.offset + second.size && second.offset < first.offset + first.size;
      return overlapsAddress || overlapsFile ? [`${first.name} ${second.name}`] : [];
    }),
  );
  expect(overlapping).toEqual([]);
  if (machine.canRun) expect((await run([codesign!, "-v", "trimmed"], folder)).exitCode).toBe(0);
  expect(() => trimExecutable(join(folder, "trimmed"), join(folder, "trimmed-again"), [Extra])).toThrow("(AlreadyTrimmed)");
}

export function compileFeatureCodeOnce(): void {
  beforeAll(async () => {
    if (!canLink) return;
    shared = tempDir("trim-macho-feature-code", { "feature_code.c": sources["feature_code.c"]! });
    for (const machine of machines) {
      const compiled = await run([tools.clang!, `--target=${machine.target}`, "-O1", "-faddrsig", "-c", "feature_code.c", "-o", `feature_code-${machine.name}.o`], String(shared));
      expect(compiled).toEqual(cleanExit);
      featureCodeObjects.set(machine.name, join(String(shared), `feature_code-${machine.name}.o`));
    }
  });
  afterAll(() => shared?.[Symbol.dispose]());
}

export const cxx = ["-x", "c++", "-fno-exceptions", "-fno-rtti"];
export const foldsEntryPoints = ["-Wl,--icf=all"];
export const perMachine = (arm64: string, x86_64: string) => `\n#ifdef __aarch64__\n${arm64}\n#else\n${x86_64}\n#endif\n`;
export const addOne = perMachine("add w0, w0, #1", "addl $1, %edi");
export const jumpTo = (name: string) => perMachine(`b ${name}`, `jmp ${name}`);
export const asCStrings = (assembly: string) =>
  assembly
    .split("\n")
    .map(line => (line.startsWith("#") ? `\n${line}\n` : JSON.stringify(line + "\n")))
    .join(" ");
export const functionWithAltEntry = (piece: string, entry: string, target: string) =>
  `.text\n.globl ${piece}, ${entry}\n.p2align 2\n${piece}:\n${perMachine(`cbz w0, ${entry}`, `testl %edi, %edi\nje ${entry}`)}${addOne}\n.alt_entry ${entry}\n${entry}:\n${jumpTo(target)}\n`;
