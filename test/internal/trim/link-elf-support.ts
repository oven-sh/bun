import { trimExecutable } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect } from "bun:test";
import { bunEnv, isLinux, tempDir } from "harness";
import { closeSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openElf } from "../../../scripts/build/trim/elf-file.ts";
import { readFeatureModel, type FeatureName } from "../../../scripts/build/trim/features.ts";
import { createLinker, parseArguments } from "../../../scripts/build/trim/link.ts";
import { elf } from "../../../scripts/build/trim/linker-elf.ts";
import type { Link } from "../../../scripts/build/trim/linker.ts";
import type { BuiltinEntry } from "../../../scripts/build/trim/types.ts";
import {
  buildGuardCrate,
  cleanExit,
  cxxFlags,
  Extra,
  featureFlags,
  guardHeader,
  indexOf,
  inspect,
  linkArguments,
  mainGuardingBoth,
  plainSources,
  run,
  start,
  toyHeader,
  writeLinkInputs,
  type ProcessResult,
} from "./toy-program.ts";

const toolNames = ["clang", "ld.lld", "llvm-cxxfilt", "llvm-nm"];
export const tools = Object.fromEntries(toolNames.map(name => [name, Bun.which(name)]));
export const archiver = Bun.which("llvm-ar");
export const rustc = Bun.which("rustc");
export const canLink = isLinux && Object.values(tools).every(path => path !== null);
export const linkSkipReason = `it needs Linux with ${toolNames.join(", ")} on PATH`;
export const isX64 = process.arch === "x64";
export const hasCxxRuntime =
  canLink &&
  Bun.spawnSync({
    cmd: [tools.clang!, "-x", "c++", "-fuse-ld=lld", "-lstdc++", "-o", "/dev/null", "-"],
    stdin: Buffer.from("int main() { try { throw 1; } catch (int) {} }"),
    env: bunEnv,
  }).exitCode === 0;
export const canUseGuardHeader =
  canLink &&
  guardHeader !== undefined &&
  Bun.spawnSync({
    cmd: [tools.clang!, ...cxxFlags, "-fsyntax-only", "-"],
    stdin: Buffer.from(toyHeader),
    env: bunEnv,
  }).exitCode === 0;
const llvmMajorOf = (cmd: string[], version: RegExp) =>
  Number(version.exec(Bun.spawnSync({ cmd, env: bunEnv }).stdout.toString())?.[1]);
export const canLinkRustBitcode =
  canLink &&
  rustc !== null &&
  llvmMajorOf([rustc, "-vV"], /^LLVM version: (\d+)/m) <= llvmMajorOf([tools["ld.lld"]!, "--version"], /\bLLD (\d+)/);

export const describeLink = describe.concurrent.skipIf(!canLink);

const cuttableFunctionCount = 8000;
export const sources = plainSources("elf");
export const cuttableSources = plainSources("elf", cuttableFunctionCount);
export const defaultObjects = ["feature_code", "entry", "table", "embedder", "main"];
export const objectsWithoutTable = ["feature_code", "entry", "embedder", "main"];
export const objectsWithMore = ["feature_code", "entry", "more", "embedder", "main"];
const objectFlags = ["-O1", "-ffunction-sections", "-fdata-sections", "-fno-pic", ...featureFlags];
export const thinLtoFlags = ["-flto=thin", "-O2"];
export const cxx = ["-x", "c++", "-fno-exceptions", "-fno-rtti"];

export interface Program {
  objects?: string[];
  compileFlags?: Record<string, string[]>;
  compilesFeatureCode?: boolean;
  linkFlags?: string[];
  archived?: string[];
  inputs?: string[];
  minimums?: Record<FeatureName, number>;
  builtins?: BuiltinEntry[];
  removed?: FeatureName[];
}

export type LinkedProgram = Awaited<ReturnType<typeof inspectAndRun>>;

let shared: ReturnType<typeof tempDir> | undefined;
let featureCodeObject = "";
let guardCrate: Promise<string | undefined> | undefined;

export function compileFeatureCodeOnce(): void {
  beforeAll(async () => {
    if (!canLink) return;
    shared = tempDir("trim-elf-feature-code", { "feature_code.c": sources["feature_code.c"]! });
    const folder = String(shared);
    const command = [tools.clang!, ...objectFlags, "-c", "feature_code.c", "-o", "feature_code.o"];
    expect(await run(command, folder)).toEqual(cleanExit);
    featureCodeObject = join(folder, "feature_code.o");
  });
  afterAll(() => shared?.[Symbol.dispose]());
}

export const findGuardCrate = () => (guardCrate ??= buildGuardCrate(String(shared), rustc!));

const baseLinkFlags = (map: string) => [
  `--ld-path=${tools["ld.lld"]}`,
  "-no-pie",
  "-Wl,--gc-sections",
  "-Wl,--icf=all",
  `-Wl,-Map=${map}`,
];

async function compile(folder: string, name: string, flags: string[] = []) {
  const isCxx = existsSync(join(folder, `${name}.cpp`));
  const source = `${name}${isCxx ? ".cpp" : ".c"}`;
  const languageFlags = isCxx ? cxxFlags : [];
  const command = [tools.clang!, ...objectFlags, ...languageFlags, ...flags, "-c", source, "-o", `${name}.o`];
  expect(await run(command, folder)).toEqual(cleanExit);
}

const isSharedObject = (name: string, compilesFeatureCode: boolean) =>
  name === "feature_code" && !compilesFeatureCode;
export const objectPath = (folder: string, name: string, compilesFeatureCode = false) =>
  isSharedObject(name, compilesFeatureCode) ? featureCodeObject : join(folder, `${name}.o`);

export async function compileObjects(
  folder: string,
  objects: string[],
  compileFlags: Record<string, string[]> = {},
  compilesFeatureCode = false,
) {
  const compiled = objects.filter(name => !isSharedObject(name, compilesFeatureCode));
  await Promise.all(compiled.map(name => compile(folder, name, compileFlags[name])));
}

export async function wrapped(folder: string, program: Program = {}) {
  const { objects = defaultObjects, compileFlags = {}, linkFlags = [], archived = [], inputs = [] } = program;
  const { minimums, builtins } = program;
  const compilesFeatureCode = program.compilesFeatureCode ?? compileFlags.feature_code !== undefined;
  const pathOf = (name: string) => objectPath(folder, name, compilesFeatureCode);
  await compileObjects(folder, objects, compileFlags, compilesFeatureCode);
  if (archived.length > 0) {
    expect(await run([archiver!, "rcs", "libtoy.a", ...archived.map(pathOf)], folder)).toEqual(cleanExit);
  }
  const linkedObjects = objects.filter(name => !archived.includes(name)).map(pathOf);
  const archives = archived.length > 0 ? ["libtoy.a"] : [];
  writeFileSync(join(folder, "in.rsp"), [...linkedObjects, ...archives, ...inputs].join("\n") + "\n");
  const linkInputs = writeLinkInputs(folder, { minimums, builtins });
  const command = [tools.clang!, "@in.rsp", ...baseLinkFlags("program.map"), ...linkFlags, "-o", "program"];
  const options = { demangler: tools["llvm-cxxfilt"]! };
  return await run(linkArguments(linkInputs, command, options), folder);
}

export async function inspectAndRun(folder: string, linkResult: ProcessResult, removed: FeatureName[] = [Extra]) {
  expect({ stderr: linkResult.stderr, exitCode: linkResult.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const inspection = await inspect(join(folder, "program"), tools["llvm-nm"]!);
  const programResult = await run([join(folder, "program")], folder);
  const summary = trimExecutable(join(folder, "program"), join(folder, "trimmed"), removed);
  const trimmedResult = await run([join(folder, "trimmed")], folder);
  return { ...inspection, linkOutput: linkResult.stdout, summary, programResult, trimmedResult };
}

export async function linked(folder: string, program: Program = {}) {
  return await inspectAndRun(folder, await wrapped(folder, program), program.removed);
}

export function expectRetained({ featuresOf }: LinkedProgram, names: string[]) {
  expect(names.filter(name => featuresOf(name) !== undefined)).toEqual([]);
}

export const sortedByIndex = (...features: FeatureName[]) => features.toSorted((a, b) => indexOf(a) - indexOf(b));
export const countInTrimmed = (folder: string, texts: string[]) => {
  const trimmed = readFileSync(join(folder, "trimmed")).toString("latin1");
  return texts.map(text => trimmed.split(text).length - 1);
};
export const guardedArguments = ["a", "b", "c", "d", "e"];

export function addressInMap(folder: string, object: string, section: string) {
  const lines = readFileSync(join(folder, "program.map"), "latin1").split("\n");
  const line = lines.find(line => line.includes(`${object}:(${section})`))!;
  return parseInt(line.trim().split(/\s+/)[0]!, 16);
}

export function sectionOf(path: string, name: string) {
  const file = openElf(path, "r")!;
  closeSync(file.fd);
  return file.sections.find(section => section.name === name)!;
}

export const cxxStart = `
  #include "guard.h"
  extern "C" int entered(int);
`;
export const mainReturning = (unguarded: string) =>
  `int main(int argc, char **argv) { return argc > 5 ? GUARDED(Extra, entered, argc) & 63 : ${unguarded}; }`;
export const guardsBoth = mainGuardingBoth;
export const mainCallingFeatureCode5 = `
  ${start}
  int feature_code_5(int);
  ${mainReturning("feature_code_5(argc) != 0 ? 0 : 1")}
`;
export const switchFunction = (name: string) => `
  __attribute__((noinline)) int ${name}(int x) {
    switch (x) {
      case 0: return note(x + 5);
      case 1: return note(3) * note(4);
      case 2: return seen - 4;
      case 3: return note(seen) + note(x);
      case 4: seen = 9; return 2;
      case 5: return note(1) - note(seen + 2);
      case 6: return seen * seen;
      case 7: return note(note(note(x)));
      case 8: return 70 / (seen + 1);
      default: return -1;
    }
  }
`;

interface HandLink {
  name: Link["name"];
  output: string;
  objects: string[];
  linkFlags?: string[];
}

export async function linkByHand(folder: string, { name, output, objects, linkFlags = [] }: HandLink): Promise<Link> {
  const inputs = objects.map(object => objectPath(folder, object));
  writeFileSync(join(folder, `${output}.rsp`), inputs.join("\n") + "\n");
  const flags = [...baseLinkFlags(`${output}.map`), "-Wl,--print-icf-sections", ...linkFlags];
  const linkResult = await run([tools.clang!, `@${output}.rsp`, ...flags, "-o", output], folder);
  expect(linkResult.exitCode).toBe(0);
  const log = linkResult.stdout + linkResult.stderr;
  return { name, executable: join(folder, output), map: join(folder, `${output}.map`), log };
}

export function createElfFormat(folder: string, output: string) {
  const inputs = writeLinkInputs(folder);
  const features = readFeatureModel(inputs.features);
  const command = [tools.clang!, `-Wl,-Map=${join(folder, `${output}.map`)}`, "-o", join(folder, output)];
  const words = ["bun", "link.ts", join(folder, "work"), inputs.features, inputs.builtinUses, "--", ...command];
  return { features, format: elf(createLinker(parseArguments(words)).linker) };
}
