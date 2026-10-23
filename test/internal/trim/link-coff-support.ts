import { readTrimTable, trimExecutable } from "bun:internal-for-testing";
import { describe, expect } from "bun:test";
import { isWindows, tempDir } from "harness";
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { detectWindowsSysroot } from "../../../scripts/build/config.ts";
import { coffRecordSectionName, namedBytesOfPe } from "../../../scripts/build/trim/coff-graph.ts";
import { CoffObject } from "../../../scripts/build/trim/coff-objects.ts";
import type { FeatureName } from "../../../scripts/build/trim/features.ts";
import { peImage } from "../../../scripts/build/trim/linked-image.ts";
import type { TrimTable } from "../../../scripts/build/trim/table.ts";
import type { BuiltinEntry } from "../../../scripts/build/trim/types.ts";
import {
  baseSources,
  cleanExit,
  cxxFlags,
  embedderSource,
  Extra,
  featureFlags,
  guardHeader,
  guardHeaderSkipReason,
  indexOf,
  linkArguments,
  model,
  Other,
  plainSources,
  run,
  writeLinkInputs,
} from "./toy-program.ts";

const tools = Object.fromEntries(["clang", "clang-cl", "lld-link", "llvm-lib", "llvm-cxxfilt", "llvm-undname"].map(name => [name, Bun.which(name)]));
export const nm = Bun.which("llvm-nm");
export const objcopy = Bun.which("llvm-objcopy");
export const rustc = Bun.which("rustc");
const sysroot = isWindows ? undefined : detectWindowsSysroot();

export type Machine = "x64" | "arm64";
export const triple = (machine: Machine) => (machine === "x64" ? "x86_64-pc-windows-msvc" : "aarch64-pc-windows-msvc");
const targetFlags = (machine: Machine) => ["--target=" + triple(machine), ...(sysroot ? ["-Xmicrosoft-windows-sys-root", sysroot] : [])];
export const canRun = (machine: Machine) => isWindows && process.arch === machine;

const childrenOf = (folder: string) => (existsSync(folder) ? readdirSync(folder).map(name => join(folder, name)) : []);

export function libraryFolders(machine: Machine) {
  if (sysroot === undefined) return (process.env.LIB ?? "").split(";").filter(folder => folder !== "");
  return [
    ...childrenOf(join(sysroot, "VC", "Tools", "MSVC")).map(version => join(version, "lib", machine)),
    ...childrenOf(join(sysroot, "Windows Kits", "10", "Lib")).flatMap(version => [join(version, "ucrt", machine), join(version, "um", machine)]),
  ];
}

export interface LinkOptions {
  machine?: Machine;
  objects?: string[];
  compileFlags?: Record<string, string[]>;
  linkFlags?: string[];
  archives?: Record<string, string[]>;
  inputs?: string[];
  minimums?: Record<FeatureName, number>;
  builtins?: BuiltinEntry[];
  isFreestanding?: boolean;
  afterCompile?(folder: string): void;
}

export const output = "program.exe";
export const defaultObjects = ["feature_code", "entry", "table", "embedder", "main"];
export const guardObjects = ["feature_code", "entry", "embedder", "main"];
export const moreObjects = ["feature_code", "entry", "more", "embedder", "main"];
export const thinLtoFlags = ["-flto=thin", "-O2"];
const fixedLinkFlags = ["/subsystem:console", "/opt:ref", "/opt:icf", "/Brepro"];
const runtimeLibraryFlags = ["/defaultlib:libcmt", "/defaultlib:oldnames"];
const freestandingLinkFlags = ["/nodefaultlib", "/entry:main"];
const freestandingCompileFlags = ["-ffreestanding", ...featureFlags];
export const printfLibrary = "/defaultlib:legacy_stdio_definitions";

function compile(folder: string, name: string, { machine = "x64", compileFlags = {}, isFreestanding = false }: LinkOptions) {
  const isCxx = existsSync(join(folder, `${name}.cpp`));
  const languageFlags = [...(isCxx ? cxxFlags : []), ...(isFreestanding ? freestandingCompileFlags : [])];
  const flags = ["-O1", "-ffunction-sections", "-fdata-sections", ...languageFlags, ...(compileFlags[name] ?? [])];
  return run([tools.clang!, ...targetFlags(machine), ...flags, "-c", `${name}.${isCxx ? "cpp" : "c"}`, "-o", `${name}.obj`], folder);
}

function linkCommand({ machine = "x64", linkFlags = [], isFreestanding = false }: LinkOptions, pathOf: (name: string) => string) {
  const driverArguments = ["/nologo", "-fuse-ld=lld", "/clang:-B" + dirname(tools["lld-link"]!), "@" + pathOf("in.rsp"), "/Fe" + pathOf(output)];
  const libraryFolderFlags = sysroot ? ["/winsysroot:" + sysroot] : libraryFolders(machine).map(folder => "/libpath:" + folder);
  const libraryFlags = isFreestanding ? freestandingLinkFlags : [...libraryFolderFlags, ...runtimeLibraryFlags];
  const mapFlags = ["/lldmap:" + pathOf("program.lldmap"), "/map:" + pathOf("program.map")];
  return [tools["clang-cl"]!, ...driverArguments, "/link", "/machine:" + machine, ...libraryFlags, ...fixedLinkFlags, ...mapFlags, ...linkFlags];
}

async function prepareInputs(folder: string, options: LinkOptions, pathOf: (name: string) => string) {
  const { objects = defaultObjects, archives = {}, inputs = [] } = options;
  await Promise.all(objects.map(async name => expect(await compile(folder, name, options)).toEqual(cleanExit)));
  options.afterCompile?.(folder);
  for (const [archive, members] of Object.entries(archives)) {
    const archiveFolder = dirname(archive);
    const memberNames = members.map(name => relative(archiveFolder, `${name}.obj`));
    const archiveResult = await run([tools["llvm-lib"]!, "/nologo", `/out:${basename(archive)}`, ...memberNames], join(folder, archiveFolder));
    expect(archiveResult.exitCode).toBe(0);
    for (const name of members) rmSync(join(folder, `${name}.obj`));
  }
  const archived = Object.values(archives).flat();
  const linkedObjects = objects.filter(name => !archived.includes(name)).map(name => pathOf(`${name}.obj`));
  writeFileSync(join(folder, "in.rsp"), [...linkedObjects, ...inputs, ...Object.keys(archives).map(pathOf)].join("\n") + "\n");
}

export async function wrapped(folder: string, options: LinkOptions = {}) {
  await prepareInputs(folder, options, name => name);
  const { minimums, builtins } = options;
  const linkInputs = writeLinkInputs(folder, { minimums, builtins });
  return await run(linkArguments(linkInputs, linkCommand(options, name => name), { demangler: tools["llvm-cxxfilt"]! }), folder);
}

export async function plainLink(folder: string, options: LinkOptions = {}) {
  const pathOf = (name: string) => join(folder, name);
  await prepareInputs(folder, options, pathOf);
  const command = linkCommand(options, pathOf);
  expect((await run(command, folder)).exitCode).toBe(0);
  return command;
}

const missingTools = Object.keys(tools).filter(name => tools[name] === null);
const missingToolsReason = missingTools.length > 0 ? `${missingTools.join(", ")} not on PATH` : undefined;

async function findFreestandingFailure(machine: Machine): Promise<string | undefined> {
  if (missingToolsReason !== undefined) return missingToolsReason;
  using dir = tempDir("trim-coff-probe", { "probe.c": "int main(void) { return 0; }\n", "in.rsp": "probe.obj\n" });
  const folder = String(dir);
  const options: LinkOptions = { machine, isFreestanding: true };
  const compileResult = await compile(folder, "probe", options);
  if (compileResult.exitCode !== 0) return `clang does not compile for ${triple(machine)}: ${compileResult.stderr.split("\n")[0]}`;
  const linkResult = await run(linkCommand(options, name => name), folder);
  return linkResult.exitCode === 0 ? undefined : `an empty program does not link for ${triple(machine)}: ${linkResult.stderr.split("\n")[0]}`;
}

async function findCompileFailure(machine: Machine): Promise<string | undefined> {
  if (missingToolsReason !== undefined) return missingToolsReason;
  if (guardHeader === undefined) return guardHeaderSkipReason;
  if (!isWindows && sysroot === undefined) return "detectWindowsSysroot() finds no headers and libraries of MSVC and the Windows SDK";
  using dir = tempDir("trim-coff-probe", { "probe.cpp": `#include <type_traits>\n#include "AOTRemovableFeature.h"\nint main() { }\n`, "in.rsp": "probe.obj\n" });
  const folder = String(dir);
  const options: LinkOptions = { machine };
  const compileResult = await compile(folder, "probe", options);
  if (compileResult.exitCode !== 0) return `the engine's header does not compile for ${triple(machine)}: ${compileResult.stderr.split("\n")[0]}`;
  const linkResult = await run(linkCommand(options, name => name), folder);
  return linkResult.exitCode === 0 ? undefined : `an empty program does not link for ${triple(machine)}: ${linkResult.stderr.split("\n")[0]}`;
}

export const linkSkipReason = await findCompileFailure("x64");
export const canLink = linkSkipReason === undefined;
export const arm64SkipReason = canLink ? await findCompileFailure("arm64") : linkSkipReason;

export const freestandingSkipReasons: Record<Machine, string | undefined> = {
  x64: await findFreestandingFailure("x64"),
  arm64: await findFreestandingFailure("arm64"),
};

export const describeLink = describe.concurrent.skipIf(!canLink);

export const baseRelocationDirectory = 5;
const debugDirectory = 6;
const debugEntryBytes = 28;
const codeViewDebugType = 2;
const accessRightsMask = 0xe000_0000;
const maxSectionCount = 96;
const cutSectionName = ".trimmed";
const x64Trap = 0xcc;
const arm64Trap = [0x00, 0x00, 0x20, 0xd4];
export const stateBytes = 536;
const coffRelocationBytes = 10;
export const pointerRelocationType = { x64: 1, arm64: 14 };
export const bigObjectMagic = [0x00, 0x00, 0xff, 0xff];

interface PeSection {
  name: string;
  virtualSize: number;
  address: number;
  rawSize: number;
  rawPointer: number;
  characteristics: number;
}

export function readPe(path: string) {
  const file = readFileSync(path);
  const peHeader = file.readUInt32LE(0x3c);
  const optionalHeader = peHeader + 24;
  const sectionTable = optionalHeader + file.readUInt16LE(peHeader + 20);
  const sections: PeSection[] = Array.from({ length: file.readUInt16LE(peHeader + 6) }, (_, index) => {
    const at = sectionTable + 40 * index;
    return {
      name: file.toString("latin1", at, at + 8).replace(/\0+$/, ""),
      virtualSize: file.readUInt32LE(at + 8),
      address: file.readUInt32LE(at + 12),
      rawSize: file.readUInt32LE(at + 16),
      rawPointer: file.readUInt32LE(at + 20),
      characteristics: file.readUInt32LE(at + 36),
    };
  });
  return {
    file,
    sections,
    entryPoint: file.readUInt32LE(optionalHeader + 16),
    sectionAlignment: file.readUInt32LE(optionalHeader + 32),
    fileAlignment: file.readUInt32LE(optionalHeader + 36),
    sizeOfImage: file.readUInt32LE(optionalHeader + 56),
    sizeOfHeaders: file.readUInt32LE(optionalHeader + 60),
    directoryBytes(index: number) {
      const address = file.readUInt32LE(optionalHeader + 112 + 8 * index);
      const size = file.readUInt32LE(optionalHeader + 116 + 8 * index);
      if (size === 0) return Buffer.alloc(0);
      const section = sections.find(({ address: start, rawSize }) => start <= address && address + size <= start + rawSize);
      if (section === undefined) throw new Error(`data directory ${index} of ${path} has no bytes in the file`);
      const offset = section.rawPointer + address - section.address;
      return file.subarray(offset, offset + size);
    },
  };
}

type PeFile = ReturnType<typeof readPe>;

const alignUp = (value: number, alignment: number) => Math.ceil(value / alignment) * alignment;
const virtualExtentOf = (section: PeSection) => Math.max(section.virtualSize || section.rawSize, 1);
const contains = (section: PeSection, address: number) => section.address <= address && address < section.address + virtualExtentOf(section);
const isCut = (section: PeSection) => section.name === cutSectionName;

function expectContiguousSections(pe: PeFile) {
  let nextAddress = pe.sections[0]!.address;
  let nextRawPointer = pe.sizeOfHeaders;
  for (const section of pe.sections) {
    expect(section.address).toBe(nextAddress);
    nextAddress = alignUp(section.address + virtualExtentOf(section), pe.sectionAlignment);
    if (section.rawSize === 0) continue;
    expect(section.rawPointer % pe.fileAlignment).toBe(0);
    expect(section.rawPointer).toBeGreaterThanOrEqual(nextRawPointer);
    nextRawPointer = section.rawPointer + section.rawSize;
  }
  expect(nextAddress).toBe(pe.sizeOfImage);
  expect(nextRawPointer).toBe(pe.file.length);
}

function expectSectionCharacteristics(trimmed: PeFile, original: PeFile) {
  for (const section of trimmed.sections) {
    if (isCut(section)) {
      const { rawSize, rawPointer, characteristics } = section;
      expect({ rawSize, rawPointer, accessRights: (characteristics & accessRightsMask) >>> 0 }).toEqual({ rawSize: 0, rawPointer: 0, accessRights: 0 });
      continue;
    }
    const source = original.sections.find(candidate => contains(candidate, section.address))!;
    expect((source.characteristics & ~section.characteristics) >>> 0).toBe(0);
  }
}

function expectNoRelocationIn(cutSections: PeSection[], pe: PeFile) {
  const blocks = pe.directoryBytes(baseRelocationDirectory);
  for (let at = 0; at < blocks.length; ) {
    const page = blocks.readUInt32LE(at);
    const blockBytes = blocks.readUInt32LE(at + 4);
    expect(blockBytes).toBeGreaterThanOrEqual(8);
    expect(cutSections.filter(section => contains(section, page))).toEqual([]);
    at += blockBytes;
  }
}

function expectCodeViewEntries(pe: PeFile) {
  const entries = pe.directoryBytes(debugDirectory);
  let count = 0;
  for (let at = 0; at < entries.length; at += debugEntryBytes) {
    if (entries.readUInt32LE(at + 12) !== codeViewDebugType) continue;
    const pointer = entries.readUInt32LE(at + 24);
    expect(pe.file.toString("latin1", pointer, pointer + 4)).toBe("RSDS");
    count++;
  }
  return count;
}

function expectFilledBytes(pe: PeFile, range: TrimTable["ranges"][number], isArm64: boolean) {
  const fillAt = (address: number) => (!range.isCode ? 0 : isArm64 ? arm64Trap[address & 3]! : x64Trap);
  let filledBytes = 0;
  for (const section of pe.sections) {
    const start = Math.max(range.start, section.address);
    const end = Math.min(range.end, section.address + Math.min(section.rawSize, virtualExtentOf(section)));
    for (let address = start; address < end; address++) {
      if (pe.file[section.rawPointer + address - section.address] === fillAt(address)) continue;
      throw new Error(`the byte at RVA 0x${address.toString(16)} lies in a removed range and is not fill`);
    }
    filledBytes += Math.max(0, end - start);
  }
  return filledBytes;
}

interface TrimmedProgram {
  folder: string;
  table: TrimTable;
  removed: FeatureName[];
  retainedAddresses: number[];
  trimmedName?: string;
}

export function expectSoundPe({ folder, table, removed, retainedAddresses, trimmedName = "trimmed.exe" }: TrimmedProgram) {
  const original = readPe(join(folder, output));
  const trimmed = readPe(join(folder, trimmedName));
  expect({ entryPoint: trimmed.entryPoint, sizeOfImage: trimmed.sizeOfImage }).toEqual({ entryPoint: original.entryPoint, sizeOfImage: original.sizeOfImage });
  expect(trimmed.sections.length).toBeLessThanOrEqual(maxSectionCount);
  expectContiguousSections(trimmed);
  expectSectionCharacteristics(trimmed, original);
  const cutSections = trimmed.sections.filter(isCut);
  expectNoRelocationIn(cutSections, trimmed);
  const codeViewEntries = expectCodeViewEntries(trimmed);

  const originalImage = peImage(join(folder, output));
  const trimmedImage = peImage(join(folder, trimmedName));
  const expectUnchanged = (start: number, length: number) => expect(trimmedImage.bytes(start, length)).toEqual(originalImage.bytes(start, length));
  const removedIndexes = new Set(removed.map(indexOf));
  let filledBytes = 0;
  for (const range of table.ranges) {
    if (table.sets[range.set]!.every(feature => removedIndexes.has(feature))) filledBytes += expectFilledBytes(trimmed, range, originalImage.isArm64);
    else expectUnchanged(range.start, range.end - range.start);
  }
  for (const address of retainedAddresses) expectUnchanged(address, 16);
  return { cutSectionCount: cutSections.length, codeViewEntries, filledBytes };
}

const featureNames = new Map(model.features.map(feature => [feature.index, feature.name]));
export const byIndex = (...features: FeatureName[]) => features.toSorted((a, b) => indexOf(a) - indexOf(b));

export async function linked(folder: string, options: LinkOptions & { removed?: FeatureName[] } = {}) {
  const { removed = [Extra], machine = "x64" } = options;
  const linkResult = await wrapped(folder, options);
  expect({ stderr: linkResult.stderr, exitCode: linkResult.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const executable = join(folder, output);
  const trimmedExecutable = join(folder, "trimmed.exe");
  const table = readTrimTable(executable);
  const { symbols } = namedBytesOfPe(executable, join(folder, "program.map"));
  const addressOf = (name: string) => (symbols.find(([symbol]) => symbol === name) ?? symbols.find(([symbol]) => symbol.startsWith(`?${name}@@`)))?.[1] ?? NaN;
  const featuresAt = (address: number) => {
    const range = table.ranges.find(({ start, end }) => start <= address && address < end);
    return range && table.sets[range.set]!.map(feature => featureNames.get(feature)!);
  };
  const featuresOf = (name: string) => {
    const address = addressOf(name);
    if (Number.isNaN(address)) throw new Error(`program.map lists no symbol ${name}`);
    return featuresAt(address);
  };
  const summary = trimExecutable(executable, trimmedExecutable, removed);
  const retainedAddresses = ["retained", "main"].map(addressOf).filter(address => !Number.isNaN(address));
  const soundness = expectSoundPe({ folder, table, removed, retainedAddresses });
  const runs = canRun(machine) && !options.isFreestanding;
  const programResult = runs ? await run([executable], folder) : undefined;
  const trimmedResult = runs ? await run([trimmedExecutable], folder) : undefined;
  return { executable, trimmedExecutable, table, symbols, addressOf, featuresAt, featuresOf, retainedAddresses, summary, soundness, programResult, trimmedResult };
}

export type LinkedProgram = Awaited<ReturnType<typeof linked>>;

export const guardedPathArguments = ["a", "b", "c", "d", "e"];

export function recordRelocationTypes(objectPath: string) {
  const fd = openSync(objectPath, "r");
  try {
    const object = CoffObject.open(fd, 0, fstatSync(fd).size)!;
    const relocations = object.relocationsOf(object.sections.find(({ name }) => name === coffRecordSectionName)!);
    return Array.from({ length: relocations.length / coffRelocationBytes }, (_, index) => relocations.readUInt16LE(index * coffRelocationBytes + 8));
  } finally {
    closeSync(fd);
  }
}

export const guard = (feature: FeatureName, stub: string, entry: string) => `JSC::callRemovable<JSC::RemovableFeature::${feature}, JSC::RemovedFeatureStub::${stub}, ${entry}>`;
export const mainSource = (declarations: string, result: string, cxxDeclarations = "") => `#include "toy.h"
${cxxDeclarations}
extern "C" {
int entered(int);
${declarations}
}
int main(int argc, char**) { return argc > 5 ? ${guard(Extra, "Abort", "entered")}(argc) & 63 : ${result}; }
`;
export const targetSource = `__attribute__((noinline)) int feature_target(int x) { return x * 3 + 4; } int more(int x) { return feature_target(x); }`;
export const exportedSource = `int exported_function(int x) { for (int i = 0; i < 5; i++) x = x * 7 + i; return x; }`;
export const guardsBoth = mainSource("int entry_of_other(int);", `argc > 4 ? ${guard(Other, "Abort", "entry_of_other")}(argc) & 63 : 0`);
export const mainCallingFeatureCode5 = mainSource("int feature_code_5(int);", "feature_code_5(argc) & 0");

export const freestandingSources = (count?: number): Record<string, string> => ({
  ...plainSources("coff", count),
  "embedder.c": embedderSource("coff", { exit: () => "__builtin_trap();" }),
});

export const sources = baseSources("coff");
export const largeSources = baseSources("coff", 4000);
