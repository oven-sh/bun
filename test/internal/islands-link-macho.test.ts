import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, tempDir } from "harness";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeTable, placeKinds, type Place, type Table } from "../../scripts/build/islands-layout.ts";
import { shutDoors } from "./islands-shut-doors.ts";

const wrapper = join(import.meta.dir, "../../scripts/build/islands.ts");
const tools = Object.fromEntries(["clang", "ld64.lld", "llvm-ar", "llvm-cxxfilt"].map(name => [name, Bun.which(name)]));
const canLink = (isLinux || isMacOS) && Object.values(tools).every(path => path !== null);
const codesign = isMacOS && process.arch === "arm64" ? Bun.which("codesign") : null;

interface Machine {
  name: "arm64" | "x86_64";
  target: string;
  isArm64: boolean;
  canRun: boolean;
}

const machines: Machine[] = [
  { name: "arm64", target: "arm64-apple-macos13", isArm64: true, canRun: codesign !== null },
  { name: "x86_64", target: "x86_64-apple-macos13", isArm64: false, canRun: false },
];

const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const count = 700;
const manyFunctions = (prefix: string) =>
  Array.from(
    { length: count },
    (_, index) =>
      `__attribute__((noinline)) int ${prefix}${index}(int x) { for (int i = 0; i < ${index + 3}; i++) x = x * ${index + 7} + i; return x ^ ${index}; }`,
  ).join("\n");
const callAll = (prefix: string) => Array.from({ length: count }, (_, index) => `x += ${prefix}${index}(x);`).join(" ");

const exits = (code: string) => `
  #ifdef __aarch64__
    register long code __asm__("x0") = ${code};
    register long number __asm__("x16") = 1;
    __asm__ volatile("svc #0x80" : : "r"(code), "r"(number));
  #endif
  __builtin_trap();
`;

const sources = {
  "behind.c": `
    const char behind_table[62] = "${alphabet}";
    const int behind_numbers[8192] = { 1, 2, 3 };
    ${manyFunctions("behind_")}
    int behind(int x) { ${callAll("behind_")} return x + behind_table[x & 31] + behind_numbers[x & 8191]; }
  `,
  "door.c": `
    int behind(int);
    __attribute__((noinline)) int the_door(int x) { return behind(x) * 3 + behind(x + 1); }
  `,
  "table.c": `const char table_that_stays[62] = "${alphabet}";`,
  "main.c": `
    extern const char table_that_stays[62];
    int the_door(int);
    __attribute__((noinline)) void Bun__trimmedOut(int feature) { __builtin_trap(); }
    __attribute__((noinline)) int stays(int x) { return table_that_stays[x & 31]; }
    int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : stays(argc) == '1' ? 0 : 1; }
  `,
  "doors": `feature extra what lies behind the door\ndoor extra exit ^the_door$\n`,
  "exported.txt": "_main\n",
};

async function run(cmd: string[], cwd: string) {
  await using child = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

interface Section {
  name: string;
  address: number;
  size: number;
  offset: number;
}

function readMachO(file: Buffer) {
  const segments: Section[] = [];
  const sections: Section[] = [];
  const addressOf = new Map<string, number>();
  let fixups = 0;
  let at = 32;
  for (let command = file.readUInt32LE(16); command > 0; command--) {
    const kind = file.readUInt32LE(at);
    const text = (offset: number) => file.toString("latin1", offset, offset + 16).replace(/\0.*$/, "");
    if (kind === 0x19) {
      segments.push({
        name: text(at + 8),
        address: Number(file.readBigUInt64LE(at + 24)),
        size: Number(file.readBigUInt64LE(at + 48)),
        offset: Number(file.readBigUInt64LE(at + 40)),
      });
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
        addressOf.set(
          file.toString("latin1", name, file.indexOf(0, name)).replace(/^_/, ""),
          Number(file.readBigUInt64LE(entry + 8)),
        );
      }
    } else if (kind === 0x80000034) fixups = file.readUInt32LE(at + 8);
    at += file.readUInt32LE(at + 4);
  }
  const holds = (address: number) => (part: Section) => part.address <= address && address < part.address + part.size;
  const segmentAt = (address: number) => segments.find(holds(address));
  const sectionAt = (address: number) => sections.find(section => section.offset > 0 && holds(address)(section));
  const offsetOf = (address: number) => segmentAt(address)!.offset + address - segmentAt(address)!.address;
  const section = (name: string) => sections.find(section => section.name === name);
  return { segments, sections, section, segmentAt, sectionAt, offsetOf, addressOf, fixups };
}

function mergedRanges(islands: { start: number; end: number }[]) {
  const dead: { start: number; end: number }[] = [];
  for (const { start, end } of islands) {
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
    for (let page = 0; page < file.readUInt16LE(info + 20); page++)
      pages.push({ start: first + page * size, end: first + (page + 1) * size, chain: info + 22 + page * 2 });
  }
  return pages;
}

function danglingReferences(
  file: Buffer,
  image: ReturnType<typeof readMachO>,
  table: Table,
  plan: string,
  isArm64: boolean,
  excluded: string[],
) {
  const isOut = (features: string) => features.split(",").every(feature => excluded.includes(feature));
  const dead = mergedRanges(table.islands.filter(island => isOut(island.features)));
  const isDead = (address: number) => dead.some(({ start, end }) => start <= address && address < end);
  const rewritten = new Set(
    table.doors.filter(door => isOut(door.feature)).flatMap(door => (door.places ?? []).map(place => place.address)),
  );
  const shutInPlace = new Set(
    table.doors.filter(door => isOut(door.feature) && !door.places?.length).map(door => door.address),
  );
  const leftOutside = new Set<string>();
  let isOfAnIslandThatIsOut = false;
  for (const line of plan.split("\n")) {
    if (line.startsWith("island ")) isOfAnIslandThatIsOut = isOut(line.slice(7));
    else if (isOfAnIslandThatIsOut)
      leftOutside.add(
        line
          .replace(/^behind /, "")
          .replace(/^.*:/, "")
          .replace(/^_/, ""),
      );
  }
  const names = [...image.addressOf].sort((a, b) => a[1] - b[1]);
  const found: string[] = [];
  const refersTo = (from: number, to: number) => {
    if (isDead(from) || !isDead(to) || rewritten.has(from)) return;
    const [holder, start] = names.findLast(([, address]) => address <= from) ?? ["", 0];
    if (!leftOutside.has(holder) && !shutInPlace.has(start))
      found.push(`${holder}: 0x${from.toString(16)} -> 0x${to.toString(16)}`);
  };
  if (isDead(table.stub)) found.push(`every stub -> 0x${table.stub.toString(16)}`);
  const base = image.segments.find(({ name }) => name === "__TEXT")!.address;
  for (const { start, chain } of pagesWithFixups(file, image)) {
    const first = file.readUInt16LE(chain);
    if (first === 0xffff) continue;
    for (let at = start + first; ;) {
      const pointer = file.readBigUInt64LE(image.offsetOf(at));
      if (pointer >> 63n === 0n) refersTo(at, Number(pointer & 0xfffffffffn));
      const next = Number((pointer >> 51n) & 0xfffn) * 4;
      if (next === 0) break;
      at += next;
    }
  }
  const beforeMain = image.section("__TEXT,__init_offsets");
  for (let at = 0; at < (beforeMain?.size ?? 0); at += 4)
    refersTo(beforeMain!.address + at, base + file.readUInt32LE(beforeMain!.offset + at));
  if (!isArm64) return found;
  const signed = (value: number, bits: number) => (value >= 2 ** (bits - 1) ? value - 2 ** bits : value);
  for (const { name, address, size, offset } of image.sections) {
    if (name !== "__TEXT,__text" && !name.startsWith("__TEXT,__jsc_")) continue;
    for (let at = 0; at < size; at += 4) {
      const word = file.readUInt32LE(offset + at);
      const distance21 = signed((((word >>> 5) & 0x7ffff) << 2) | ((word >>> 29) & 3), 21);
      if ((word & 0x7c000000) >>> 0 === 0x14000000)
        refersTo(address + at, address + at + signed(word & 0x3ffffff, 26) * 4);
      else if ((word & 0x9f000000) >>> 0 === 0x10000000) refersTo(address + at, address + at + distance21);
      else if ((word & 0x9f000000) >>> 0 === 0x90000000 && at + 4 < size) {
        const next = file.readUInt32LE(offset + at + 4);
        const isAddToIt = (next & 0xffc00000) >>> 0 === 0x91000000 && ((next >>> 5) & 31) === (word & 31);
        if (isAddToIt)
          refersTo(address + at, address + at - ((address + at) % 4096) + distance21 * 4096 + ((next >>> 10) & 0xfff));
      }
    }
  }
  return found;
}

const subsetsOf = (features: string[]): string[][] =>
  features.reduce<string[][]>((subsets, feature) => [...subsets, ...subsets.map(subset => [...subset, feature])], [[]]);

interface Program {
  objects?: string[];
  compileFlags?: Record<string, string[]>;
  linkFlags?: string[];
  archived?: string[];
  plan?: string;
}

const behindObjects = new Map<string, string>();
let shared: ReturnType<typeof tempDir> | undefined;

async function compile(machine: Machine, folder: string, name: string, flags: string[] = []) {
  const source = [".c", ".S"].map(extension => name + extension).find(file => Bun.file(join(folder, file)).size > 0)!;
  const compiled = await run(
    [tools.clang!, `--target=${machine.target}`, "-O1", "-faddrsig", ...flags, "-c", source, "-o", `${name}.o`],
    folder,
  );
  expect(compiled).toEqual({ stdout: "", stderr: "", exitCode: 0 });
}

async function wrapped(
  machine: Machine,
  folder: string,
  {
    objects = ["behind", "door", "table", "main"],
    compileFlags = {},
    linkFlags = [],
    archived = [],
    plan = "none",
  }: Program,
) {
  for (const name of objects) if (name !== "behind") await compile(machine, folder, name, compileFlags[name]);
  if (archived.length > 0)
    expect(
      (await run([tools["llvm-ar"]!, "rcs", "lib.a", ...archived.map(name => `${name}.o`)], folder)).exitCode,
    ).toBe(0);
  const inputs = [
    ...objects
      .filter(name => !archived.includes(name))
      .map(name => (name === "behind" ? behindObjects.get(machine.name)! : `${name}.o`)),
    ...(archived.length > 0 ? ["lib.a"] : []),
  ];
  writeFileSync(join(folder, "in.rsp"), inputs.map(path => `${path}\n`).join(""));
  const flags = [
    `--target=${machine.target}`,
    "-mlinker-version=705",
    `--ld-path=${tools["ld64.lld"]}`,
    "-nostdlib",
    ...(machine.canRun ? ["-lSystem"] : []),
    "-Wl,-e,_main",
    "-dead_strip",
    "-Wl,--icf=safe",
    "-Wl,-map,program.map",
    "-exported_symbols_list",
    "exported.txt",
    ...linkFlags,
  ];
  return await run(
    [
      bunExe(),
      wrapper,
      "doors",
      tools["llvm-cxxfilt"]!,
      "work",
      plan,
      "program.plan",
      "--",
      tools.clang!,
      "@in.rsp",
      ...flags,
      "-o",
      "program",
    ],
    folder,
  );
}

async function signAndRun(folder: string, name: string, file: Buffer, args: string[] = []) {
  writeFileSync(join(folder, name), file);
  chmodSync(join(folder, name), 0o755);
  expect((await run([codesign!, "-s", "-", "-f", name], folder)).exitCode).toBe(0);
  return (await run([join(folder, name), ...args], folder)).exitCode;
}

async function linked(machine: Machine, folder: string, program: Program = {}) {
  const said = await wrapped(machine, folder, program);
  expect({ stderr: said.stderr, exitCode: said.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const file = readFileSync(join(folder, "program"));
  const image = readMachO(file);
  const room = image.section("__TEXT,__bun_islands")!;
  const table = decodeTable(file.subarray(room.offset, room.offset + room.size));
  const addressOf = (name: string) => image.addressOf.get(name) ?? NaN;
  const canGoAt = (address: number) => table.islands.some(({ start, end }) => start <= address && address < end);
  const canGo = (name: string) => canGoAt(addressOf(name));
  const door = (name: string) => table.doors.find(door => door.address === addressOf(name));
  const strings = image.section("__TEXT,__cstring");
  const stringAt = (text: string) => {
    const bytes = file.subarray(strings!.offset, strings!.offset + strings!.size);
    const at = bytes.indexOf(Buffer.from(`${text}\0`, "latin1"));
    return at < 0 || (at > 0 && bytes[at - 1] !== 0) ? NaN : strings!.address + at;
  };
  const trimmed = Buffer.from(file);
  const fill = (start: number, end: number) =>
    void trimmed.fill(
      machine.isArm64 ? Buffer.from([0x20, 0x00, 0x20, 0xd4]) : 0xcc,
      image.offsetOf(start),
      image.offsetOf(start) + end - start,
    );
  for (const { start, end } of table.islands) if (image.segmentAt(start)!.name === "__TEXT") fill(start, end);
  for (const { start, end, chain } of pagesWithFixups(file, image)) {
    if (!mergedRanges(table.islands).some(run => run.start <= start && end <= run.end)) continue;
    trimmed.writeUInt16LE(0xffff, chain);
    fill(start, end);
  }
  const plan = readFileSync(join(folder, "program.plan"), "utf8");
  for (const excluded of subsetsOf(table.features))
    expect({ excluded, dangling: danglingReferences(file, image, table, plan, machine.isArm64, excluded) }).toEqual({
      excluded,
      dangling: [],
    });
  const exitCodes = machine.canRun
    ? { whole: await signAndRun(folder, "whole", file), trimmed: await signAndRun(folder, "trimmed", trimmed) }
    : { whole: 0, trimmed: 0 };
  return {
    said: said.stdout,
    file,
    ...image,
    table,
    addressOf,
    canGo,
    canGoAt,
    door,
    stringAt,
    exitCodes,
    whyFat: readFileSync(join(folder, "work/doors.txt"), "utf8"),
  };
}

const { add32, branch26, page21, low12, adr, pointer36, nop } = placeKinds;

function targetsOf(file: Buffer, offsetOf: (address: number) => number, places: Place[]): number[] {
  const signed = (value: number, bits: number) => (value >= 2 ** (bits - 1) ? value - 2 ** bits : value);
  const targets: number[] = [];
  let page: { register: number; address: number } | undefined;
  for (const { address, kind } of places) {
    const offset = offsetOf(address);
    const word = file.readUInt32LE(offset);
    const distance21 = signed((((word >>> 5) & 0x7ffff) << 2) | ((word >>> 29) & 3), 21);
    if (kind === pointer36) targets.push(Number(file.readBigUInt64LE(offset) & 0xfffffffffn));
    else if (kind === add32) targets.push(address + 4 + file.readInt32LE(offset));
    else if ((word & 0x7c000000) >>> 0 === 0x14000000) targets.push(address + signed(word & 0x3ffffff, 26) * 4);
    else if ((word & 0x9f000000) >>> 0 === 0x10000000) targets.push(address + distance21);
    else if ((word & 0x9f000000) >>> 0 === 0x90000000)
      page = { register: word & 31, address: address - (address % 4096) + distance21 * 4096 };
    else if ((word & 0xffc00000) >>> 0 === 0x91000000 && page !== undefined && ((word >>> 5) & 31) === page.register)
      targets.push(page.address + ((word >>> 10) & 0xfff));
    else if (word !== 0xd503201f) targets.push(NaN);
  }
  return targets;
}

const start = `
  int the_door(int);
  __attribute__((noinline)) void Bun__trimmedOut(int feature) { __builtin_trap(); }
`;
const doorTo = (name: string) => `
  int behind(int);
  int ${name}(int);
  __attribute__((noinline)) int the_door(int x) { return behind(x) * 3 + ${name}(x + 1); }
`;
const mixes = (name: string, by: number) =>
  `__attribute__((noinline)) int ${name}(int x) { for (int i = 0; i < 3; i++) x = x * ${by} + i; return x ^ ${by}; }`;

beforeAll(async () => {
  if (!canLink) return;
  shared = tempDir("islands-macho-behind", { "behind.c": sources["behind.c"] });
  for (const machine of machines) {
    const made = await run(
      [
        tools.clang!,
        `--target=${machine.target}`,
        "-O1",
        "-faddrsig",
        "-c",
        "behind.c",
        "-o",
        `behind-${machine.name}.o`,
      ],
      String(shared),
    );
    expect(made).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    behindObjects.set(machine.name, join(String(shared), `behind-${machine.name}.o`));
  }
});

afterAll(() => shared?.[Symbol.dispose]());

interface Road {
  more: string;
  main: string;
  stay: string[];
  go?: string[];
  files?: Record<string, string>;
  objects?: string[];
  compileFlags?: Record<string, string[]>;
  linkFlags?: string[];
  doors?: string;
  skipsWitnessCheck?: boolean;
  archived?: string[];
}

const cxx = ["-x", "c++", "-fno-exceptions", "-fno-rtti"];
const perMachine = (arm64: string, x86_64: string) => `\n#ifdef __aarch64__\n${arm64}\n#else\n${x86_64}\n#endif\n`;
const addOne = perMachine("add w0, w0, #1", "addl $1, %edi");
const jumpTo = (name: string) => perMachine(`b ${name}`, `jmp ${name}`);
const asCStrings = (assembly: string) =>
  assembly
    .split("\n")
    .map(line => (line.startsWith("#") ? `\n${line}\n` : JSON.stringify(line + "\n")))
    .join(" ");
const functionWithAltEntry = (piece: string, entry: string, target: string) =>
  `.text\n.globl ${piece}, ${entry}\n.p2align 2\n${piece}:\n${perMachine(`cbz w0, ${entry}`, `testl %edi, %edi\nje ${entry}`)}${addOne}\n.alt_entry ${entry}\n${entry}:\n${jumpTo(target)}\n`;
const twin = (name: string) =>
  `__attribute__((noinline)) int ${name}(int x) { for (int i = 0; i < 3; i++) x = x * 3 + i; return x ^ 77; }`;

const roads: Record<string, Road> = {
  "the name of a function in another input": {
    more: `${mixes("behind_target", 3)} int more(int x) { return behind_target(x); }`,
    main: `int behind_target(int); int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : behind_target(argc) == 35 ? 0 : 1; }`,
    stay: ["behind_target"],
  },
  "a function folded into an equal one behind the door": {
    more: `${twin("behind_twin")} int more(int x) { return behind_twin(x); }`,
    main: `${twin("stays_twin")} int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : stays_twin(argc) == 109 ? 0 : 1; }`,
    stay: ["stays_twin", "behind_twin"],
  },
  "a table of functions, known only inside their input, in constants that hold addresses": {
    more: `
      __attribute__((noinline)) static int first(int x) { return x + 10; }
      __attribute__((noinline)) static int second(int x) { return x + 20; }
      int (*const behind_handlers[2])(int) = { first, second };
      int more(int x) { return first(x) + second(x) + behind_handlers[x & 1](x); }
    `,
    main: `
      extern int (*const behind_handlers[2])(int);
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : behind_handlers[argc](argc) == 21 ? 0 : 1; }
    `,
    stay: ["first", "second", "behind_handlers"],
  },
  "an address taken through the table of global offsets": {
    more: `${mixes("behind_target", 3)} int more(int x) { return behind_target(x); }`,
    main: `
      int behind_target(int);
      int (*volatile pointer)(int);
      int main(int argc, char **argv) { pointer = behind_target; return argc > 5 ? the_door(argc) : pointer(argc) == 35 ? 0 : 1; }
    `,
    stay: ["behind_target"],
  },
  "a function that runs before main": {
    more: `
      int early_value;
      static volatile int seed = 5;
      __attribute__((noinline)) int behind_early(int x) { return x * 5 + 1; }
      __attribute__((constructor, noinline)) void early(void) { early_value = behind_early(seed); }
      int more(int x) { early(); return behind_early(x); }
    `,
    main: `extern int early_value; int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : early_value == 26 ? 0 : 1; }`,
    stay: ["early", "behind_early"],
  },
  "a function that runs before main because another input's list names it": {
    more: `
      int early_value;
      static volatile int seed = 5;
      __attribute__((noinline)) int behind_early(int x) { return x * 5 + 1; }
      __attribute__((noinline)) void early(void) { early_value = behind_early(seed); }
      int more(int x) { early(); return behind_early(x); }
    `,
    main: `
      extern int early_value;
      __asm__(".section __DATA,__mod_init_func,mod_init_funcs\\n.p2align 3\\n.quad _early\\n.text\\n");
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : early_value == 26 ? 0 : 1; }
    `,
    stay: ["early", "behind_early"],
  },
  "of two weak definitions the one the linker took": {
    more: `__attribute__((weak, noinline)) int weak_twin(int x) { return x + 100; } int more(int x) { return weak_twin(x); }`,
    main: `
      __attribute__((weak, noinline)) int weak_twin(int x) { return x + 100; }
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : weak_twin(argc) == 101 ? 0 : 1; }
    `,
    stay: ["weak_twin"],
  },
  "a weak table of functions, of which the linker took the copy behind the door, with the functions of that input": {
    more: `
      __attribute__((noinline)) static int first(int x) { return x + 10; }
      __attribute__((noinline)) static int second(int x) { return x + 20; }
      __attribute__((weak)) int (*const weak_handlers[2])(int) = { first, second };
      int more(int x) { return first(x) + second(x) + weak_handlers[x & 1](x); }
    `,
    main: `
      __attribute__((noinline)) static int first(int x) { return x + 10; }
      __attribute__((noinline)) static int second(int x) { return x + 20; }
      __attribute__((weak)) int (*const weak_handlers[2])(int) = { first, second };
      int main(int argc, char **argv) {
        int (*const *handlers)(int) = weak_handlers;
        __asm__ volatile("" : "+r"(handlers));
        return argc > 5 ? the_door(argc) : handlers[argc](argc) == 21 ? 0 : 1;
      }
    `,
    stay: ["weak_handlers", "first", "second"],
  },
  "a strong definition behind the door that replaces a weak one": {
    more: `__attribute__((noinline)) int replaced(int x) { return x + 2; } int more(int x) { return replaced(x); }`,
    main: `
      __attribute__((weak, noinline)) int replaced(int x) { return x + 1; }
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : replaced(argc) == 3 ? 0 : 1; }
    `,
    stay: ["replaced"],
  },
  "of two copies of an inline function the one the linker took": {
    more: `
      inline __attribute__((noinline)) int shared_inline(int x) { return x + 55; }
      extern "C" int more(int x) { return shared_inline(x); }
    `,
    main: `
      inline __attribute__((noinline)) int shared_inline(int x) { return x + 55; }
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : shared_inline(argc) == 56 ? 0 : 1; }
    `,
    stay: ["_Z13shared_inlinei"],
    compileFlags: { more: cxx, main: cxx },
  },
  "what a thread's variables start with, whoever names the variable": {
    more: `
      ${mixes("behind_hooked", 3)}
      ${mixes("behind_hooked_too", 5)}
      __thread int (*hook)(int) = behind_hooked;
      __thread int (*hook_that_only_the_feature_names)(int) = behind_hooked_too;
      int more(int x) { return behind_hooked(x) + behind_hooked_too(x) + hook(x) + hook_that_only_the_feature_names(x); }
    `,
    main: `
      void _tlv_bootstrap(void) {}
      extern __thread int (*hook)(int);
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : hook(argc) == 35 ? 0 : 1; }
    `,
    stay: ["behind_hooked", "behind_hooked_too"],
  },
  "falling from one name into the next, in an input whose sections are not cut at its names": {
    more: `int whole_second(int); ${mixes("behind_target", 3)} int more(int x) { return whole_second(x) + behind_target(x); }`,
    main: `int whole_first(int); int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : whole_first(argc) == 56 ? 0 : 1; }`,
    files: {
      "whole.S": `.text\n.globl _whole_first, _whole_second\n.p2align 2\n_whole_first:\n${addOne}\n_whole_second:\n${jumpTo("_behind_target")}\n`,
    },
    objects: ["behind", "door", "more", "whole", "main"],
    stay: ["whole_second", "behind_target"],
  },
  "falling from one piece of the interpreter's assembly into the next": {
    more: `
      int interpreter_second(int);
      ${mixes("behind_target", 3)}
      int more(int x) { return interpreter_second(x) + behind_target(x); }
    `,
    main: `
      int interpreter_first(int);
      __asm__(${asCStrings(`.section __TEXT,__jsc_int,regular,pure_instructions\n.globl _interpreter_first, _interpreter_second\n.p2align 2\n_interpreter_first:\n${addOne}\n_interpreter_second:\n${jumpTo("_behind_target")}\n.text\n`)});
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : interpreter_first(argc) == 56 ? 0 : 1; }
    `,
    stay: ["behind_target"],
  },
  "falling from one piece into the next, in a section of the interpreter's assembly that is one unit": {
    more: `
      int unit_second(int);
      ${mixes("behind_target", 3)}
      int more(int x) { return unit_second(x) + behind_target(x); }
    `,
    main: `
      int unit_first(int);
      __asm__(${asCStrings(`.section __TEXT,__jsc_wasm,regular,pure_instructions\n.globl _unit_first, _unit_second\n.p2align 2\n_unit_first:\n${addOne}\n_unit_second:\n${jumpTo("_behind_target")}\n.text\n`)});
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : unit_first(argc) == 56 ? 0 : 1; }
    `,
    stay: ["unit_second", "behind_target"],
  },
  "falling from a name into an alternative entry; one that nothing names goes with its piece": {
    more: `
      int entry_in_the_middle(int);
      int behind_piece(int);
      ${mixes("behind_target", 3)}
      __asm__(${asCStrings(functionWithAltEntry("_behind_piece", "_behind_entry", "_behind_target"))});
      int more(int x) { return entry_in_the_middle(x) + behind_piece(x) + behind_target(x); }
    `,
    main: `
      int piece(int);
      __asm__(${asCStrings(functionWithAltEntry("_piece", "_entry_in_the_middle", "_behind_target"))});
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : piece(argc) == 56 ? 0 : 1; }
    `,
    stay: ["piece", "entry_in_the_middle", "behind_target"],
    go: ["behind_piece", "behind_entry"],
  },
  "an alternative entry of a piece whose first name only the feature names": {
    more: `
      int piece(int);
      ${mixes("behind_target", 3)}
      int more(int x) { return piece(x) + behind_target(x); }
    `,
    main: `int entry_in_the_middle(int); int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : entry_in_the_middle(argc) == 35 ? 0 : 1; }`,
    files: {
      "piece.c": `__asm__(${asCStrings(functionWithAltEntry("_piece", "_entry_in_the_middle", "_behind_target"))});`,
    },
    objects: ["behind", "door", "more", "piece", "main"],
    stay: ["piece", "entry_in_the_middle", "behind_target"],
  },
  "an alternative entry that its own input names": {
    more: `
      int piece(int);
      ${mixes("behind_target", 3)}
      int more(int x) { return piece(x) + behind_target(x); }
    `,
    main: `
      int entry_in_the_middle(int);
      __asm__(${asCStrings(functionWithAltEntry("_piece", "_entry_in_the_middle", "_behind_target"))});
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : entry_in_the_middle(argc) == 35 ? 0 : 1; }
    `,
    stay: ["piece", "entry_in_the_middle", "behind_target"],
  },
  "a place inside a constant, written as an address or as a name and a distance": {
    more: `extern const long behind_constants[2]; extern const long more_behind_constants[2]; int more(int x) { return behind_constants[x & 1] + more_behind_constants[x & 1]; }`,
    main: `
      long stays_reader(void);
      extern const long *const stays_pointer;
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : stays_reader() == 2 && *stays_pointer == 4 ? 0 : 1; }
    `,
    files: {
      "inside.S": `
        .section __TEXT,__const
        .globl _behind_constants, _more_behind_constants
        .p2align 3
        _behind_constants: .quad 1
        Lsecond: .quad 2
        _more_behind_constants: .quad 3
        Lfourth: .quad 4
        .section __DATA,__const
        .globl _stays_pointer
        .p2align 3
        _stays_pointer: .quad Lfourth
        .text
        .globl _stays_reader
        .p2align 2
        _stays_reader:${perMachine("adrp x8, Lsecond@PAGE\nldr x0, [x8, Lsecond@PAGEOFF]", "movq Lsecond(%rip), %rax")}ret
        .subsections_via_symbols
      `,
    },
    objects: ["behind", "door", "more", "inside", "main"],
    stay: ["behind_constants", "more_behind_constants"],
  },
  "walking a section from its start to its end": {
    more: `
      ${mixes("member_one", 3)}
      ${mixes("member_two", 5)}
      __attribute__((used, section("__DATA,the_set"))) int (*const one)(int) = member_one;
      __attribute__((used, section("__DATA,the_set"))) int (*const two)(int) = member_two;
      int deeper(int);
      int more(int x) { return member_one(x) + member_two(x) + deeper(x); }
    `,
    files: {
      "deeper.c": `extern int (*const one)(int); extern int (*const two)(int); int deeper(int x) { return one(x) + two(x); }`,
    },
    objects: ["behind", "door", "more", "deeper", "main"],
    main: `
      extern int (*const first_of_the_set[])(int) __asm__("section$start$__DATA$the_set");
      extern int (*const end_of_the_set[])(int) __asm__("section$end$__DATA$the_set");
      int main(int argc, char **argv) {
        int sum = 0;
        for (int (*const *member)(int) = first_of_the_set; member < end_of_the_set; member++) sum += (*member)(argc);
        return argc > 5 ? the_door(argc) : sum == 35 + 129 ? 0 : 1;
      }
    `,
    stay: ["member_one", "member_two"],
    skipsWitnessCheck: true,
  },
  "a function in an archive, and a string that it names": {
    more: `
      ${mixes("behind_target", 3)}
      __attribute__((noinline)) const char *behind_words(void) { return "words that a member of an archive names too"; }
      int more(int x) { return behind_target(x) + behind_words()[x & 7]; }
    `,
    main: `int a_member_with_a_long_name(int); int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : a_member_with_a_long_name(argc) == 35 + 'o' ? 0 : 1; }`,
    files: {
      "a_member_with_a_long_name.c": `int behind_target(int); int a_member_with_a_long_name(int x) { return behind_target(x) + "words that a member of an archive names too"[x]; }`,
    },
    objects: ["behind", "door", "more", "a_member_with_a_long_name", "main"],
    archived: ["a_member_with_a_long_name"],
    stay: ["behind_target", "a_member_with_a_long_name"],
  },
  "a shut door's stub, which jumps to the function that says what was left out": {
    more: `void Bun__trimmedOut(int); int more(int x) { if (x == 12345) Bun__trimmedOut(x); return x; }`,
    main: `int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : 0; }`,
    stay: ["Bun__trimmedOut"],
  },
  "a section that says that nothing of it is ever stripped": {
    more: `
      extern int (*const never_stripped)(int);
      ${mixes("behind_target", 3)}
      __asm__(".section __DATA,__kept,regular,no_dead_strip\\n.globl _never_stripped\\n.p2align 3\\n_never_stripped:\\n.quad _behind_target\\n.text\\n");
      int more(int x) { return behind_target(x) + never_stripped(x); }
    `,
    main: `int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : 0; }`,
    stay: ["behind_target"],
  },
  "constants marked as used; a function marked so goes with what names it": {
    more: `
      ${mixes("only_the_marked_function_names", 5)}
      ${mixes("marked_constants_name", 7)}
      __attribute__((used, noinline)) int marked(int x) { return only_the_marked_function_names(x); }
      __attribute__((used)) int (*const marked_constants[1])(int) = { marked_constants_name };
      int more(int x) { return marked(x) + marked_constants_name(x) + (marked_constants[x] != 0); }
    `,
    main: `int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : 0; }`,
    stay: ["marked_constants", "marked_constants_name"],
    go: ["marked", "only_the_marked_function_names"],
  },
  "the name of a function in an input that the linker itself compiles": {
    more: `${mixes("behind_target", 3)} int more(int x) { return behind_target(x); }`,
    main: `int behind_target(int); int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : behind_target(argc) == 35 ? 0 : 1; }`,
    stay: ["behind_target"],
    compileFlags: { more: ["-flto"] },
  },
  "names in two inputs that the linker itself compiles, one with names of its own and one without": {
    more: `
      int behind_other(int);
      __attribute__((noinline)) static int known_only_here(int x) { for (int i = 0; i < 3; i++) x = x * 3 + i; return x ^ 3; }
      __attribute__((noinline)) int behind_target(int x) { return known_only_here(x) + 1; }
      int more(int x) { return behind_target(x) + behind_other(x); }
    `,
    main: `
      int behind_target(int);
      int behind_other(int);
      int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : behind_target(argc) == 36 && behind_other(argc) == 129 ? 0 : 1; }
    `,
    files: { "other.c": mixes("behind_other", 5) },
    objects: ["behind", "door", "more", "other", "main"],
    stay: ["behind_target", "known_only_here", "behind_other"],
    compileFlags: { more: ["-flto=thin"], other: ["-flto=thin"] },
  },
};

describe.concurrent.skipIf(!canLink).each(machines)("Mach-O $name", machine => {
  describe("a link with islands", () => {
    test("what only the door reaches can go, code and constants; what stays cannot", async () => {
      using dir = tempDir("islands-macho", sources);
      const { canGo, exitCodes } = await linked(machine, String(dir));
      expect(["behind", "behind_0", `behind_${count - 1}`, "behind_numbers"].map(canGo)).toEqual([
        true,
        true,
        true,
        true,
      ]);
      expect(["main", "stays", "Bun__trimmedOut", "table_that_stays"].map(canGo)).toEqual([false, false, false, false]);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });
  });

  describe("the link stops", () => {
    test("where no function matches a door", async () => {
      using dir = tempDir("islands-macho-stops", {
        ...sources,
        "doors": sources.doors + "door extra exit ^no_such_function$\n",
      });
      const said = await wrapped(machine, String(dir), {});
      expect(said.stderr).toContain("islands: no function matches the door ^no_such_function$");
      expect(said.exitCode).toBe(1);
    });

    test("where less can go with a feature than it is to be, and says who holds the rest", async () => {
      using dir = tempDir("islands-macho-stops", {
        ...sources,
        "main.c": `
          ${start}
          int behind_5(int);
          int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : behind_5(argc) != 0 ? 0 : 1; }
        `,
        "doors": sources.doors + "smallest extra 1000000\n",
      });
      const said = await wrapped(machine, String(dir), { objects: ["behind", "door", "main"] });
      expect(said.stderr).toMatch(
        /islands: 0\.\d+ MB can go with extra, which is to be at least 1\.00 MB: something that stays names the rest:/,
      );
      expect(said.stderr).toMatch(/behind_5 \(behind-\w+\.o, \d+ bytes\)\n\s+<- main \(main\.o, \d+ bytes\)/);
      expect(said.exitCode).toBe(1);
    });

    test("where an input cannot be read, so that what it names is not known", async () => {
      using dir = tempDir("islands-macho-stops", {
        ...sources,
        "one/member.c": `int behind_5(int); int first_member(int x) { return behind_5(x); }`,
        "two/member.c": `int behind_6(int); int second_member(int x) { return behind_6(x); }`,
        "main.c": `
          ${start}
          int first_member(int);
          int second_member(int);
          int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : first_member(argc) + second_member(argc) != 0 ? 0 : 1; }
        `,
      });
      const said = await wrapped(machine, String(dir), {
        objects: ["behind", "door", "one/member", "two/member", "main"],
        archived: ["one/member", "two/member"],
      });
      expect(said.stderr).toContain("inputs could not be read, so what they name is not known:\n  lib.a(member.o)");
      expect(said.exitCode).toBe(1);
    });

    test("where nothing lies behind the doors", async () => {
      using dir = tempDir("islands-macho-stops", {
        ...sources,
        "main.c": `
          ${start}
          int behind(int);
          int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : behind(argc) != 0 ? 0 : 1; }
        `,
      });
      const said = await wrapped(machine, String(dir), { objects: ["behind", "door", "main"] });
      expect(said.stderr).toContain("islands: nothing lies behind the 1 doors:");
      expect(said.exitCode).toBe(1);
    });
  });

  describe("what stays can reach what lies behind the door by", () => {
    for (const [name, road] of Object.entries(roads)) {
      test(name, async () => {
        using dir = tempDir("islands-macho-road", {
          ...sources,
          "door.c": doorTo("more"),
          "more.c": road.more,
          "main.c": (road.compileFlags?.main === cxx ? `extern "C" { ${start} }` : start) + road.main,
          "doors": sources.doors + (road.doors ?? ""),
          ...road.files,
        });
        const { said, canGo, exitCodes } = await linked(machine, String(dir), {
          archived: road.archived,
          objects: road.objects ?? ["behind", "door", "more", "main"],
          compileFlags: road.compileFlags,
          linkFlags: road.linkFlags,
        });
        expect(Object.fromEntries(road.stay.map(name => [name, canGo(name)]))).toEqual(
          Object.fromEntries(road.stay.map(name => [name, false])),
        );
        const go = ["behind", "behind_0", `behind_${count - 1}`, ...(road.go ?? [])];
        expect(Object.fromEntries(go.map(name => [name, canGo(name)]))).toEqual(
          Object.fromEntries(go.map(name => [name, true])),
        );
        if (!road.skipsWitnessCheck) expect(said).toContain("; 0 references lead where the names did not");
        expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
      });
    }
  });

  describe("a door", () => {
    const loops = (name: string, calls: string) =>
      `__attribute__((noinline)) int ${name}(int x) { for (int i = 0; i < 5; i++) x = x * 7 + i; return ${calls}(x) & 0xffff; }`;
    const folded = (doors: string) => ({
      ...sources,
      "deeper.c": mixes("behind_the_folded_door", 5),
      "more.c": `int behind_the_folded_door(int); ${loops("folded_door", "behind_the_folded_door")} int what_follows_the_door(int x) { return x; }`,
      "main.c": `
        ${start}
        int behind_the_folded_door(int);
        int folded_door(int);
        ${loops("equal_to_the_door", "behind_the_folded_door")}
        int main(int argc, char **argv) { return argc > 6 ? folded_door(argc) : argc > 5 ? the_door(argc) : equal_to_the_door(argc) < 0x10000 ? 0 : 1; }
      `,
      "doors": sources.doors + doors,
    });

    for (const objects of [
      ["behind", "door", "deeper", "more", "main"],
      ["behind", "door", "deeper", "main", "more"],
    ]) {
      test(`folded with a function that is no door stays open, whichever of the two the linker kept: ${objects.slice(3).join(", ")}`, async () => {
        using dir = tempDir("islands-macho-door", folded("door extra exit ^folded_door$\n"));
        const { said, addressOf, door, canGo, exitCodes } = await linked(machine, String(dir), { objects });
        expect(addressOf("folded_door")).toBe(addressOf("equal_to_the_door"));
        expect(door("folded_door")).toBeUndefined();
        expect(["folded_door", "behind_the_folded_door", "behind_0"].map(canGo)).toEqual([false, false, true]);
        if (objects[3] === "more") expect(said).toContain("1 doors were folded into other functions and stay open");
        expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
      });
    }

    test("folded only with a door of its own feature is thin, and the places that name it by either name are listed", async () => {
      using dir = tempDir("islands-macho-door", folded("door extra exit ^(folded_door|equal_to_the_door)$\n"));
      const { said, addressOf, door, canGo, file, offsetOf } = await linked(machine, String(dir), {
        objects: ["behind", "door", "deeper", "more", "main"],
      });
      expect(addressOf("folded_door")).toBe(addressOf("equal_to_the_door"));
      expect(said).not.toContain("stay open");
      expect(said).toContain("2 doors are thin");
      expect(["folded_door", "behind_the_folded_door"].map(canGo)).toEqual([true, true]);
      expect(door("folded_door")!.places!.map(place => place.kind)).toEqual(
        machine.isArm64 ? [branch26, branch26] : [add32, add32],
      );
      expect(targetsOf(file, offsetOf, door("folded_door")!.places!)).toEqual([
        addressOf("folded_door"),
        addressOf("folded_door"),
      ]);
    });

    test("folded with a door of its own feature that returns where it exits stays open", async () => {
      using dir = tempDir(
        "islands-macho-door",
        folded("door extra exit ^folded_door$\ndoor extra return ^equal_to_the_door$\n"),
      );
      const { said, addressOf, door, canGo, exitCodes } = await linked(machine, String(dir), {
        objects: ["behind", "door", "deeper", "more", "main"],
      });
      expect(addressOf("folded_door")).toBe(addressOf("equal_to_the_door"));
      expect(said).toContain("1 doors were folded into other functions and stay open");
      expect(door("folded_door")).toBeUndefined();
      expect(["folded_door", "behind_the_folded_door", "behind_0"].map(canGo)).toEqual([false, false, true]);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });

    test("is known by its own name in C++, not by the type it returns", async () => {
      const shared = `
        namespace gone { struct Thing { int value; }; }
        extern "C" int touched(int);
        template <typename By> __attribute__((noinline)) gone::Thing *moved(gone::Thing *thing, By by) { thing->value += touched(by); return thing; }
      `;
      using dir = tempDir("islands-macho-door", {
        ...sources,
        "door.c": doorTo("more"),
        "more.c": `
          ${shared}
          extern "C" int behind(int);
          extern "C" __attribute__((noinline)) int touched(int x) { for (int i = 0; i < 3; i++) x = x * 3 + i; return x % 7; }
          namespace gone { __attribute__((noinline)) int entered(int x) { Thing thing{x}; return moved(&thing, 2)->value + behind(x); } }
          extern "C" int more(int x) { return gone::entered(x); }
        `,
        "main.c": `
          ${shared}
          namespace gone { int entered(int); }
          extern "C" { ${start} }
          int main(int argc, char **argv) {
            gone::Thing thing{argc};
            return argc > 6 ? gone::entered(argc) : argc > 5 ? the_door(argc) : moved(&thing, 2)->value == 4 ? 0 : 1;
          }
        `,
        "doors": sources.doors + "door extra exit ^gone::\n",
      });
      const { door, canGo, exitCodes } = await linked(machine, String(dir), {
        objects: ["behind", "door", "more", "main"],
        compileFlags: { more: cxx, main: cxx },
      });
      expect({
        entered: door("_ZN4gone7enteredEi") !== undefined,
        moved: door("_Z5movedIiEPN4gone5ThingES2_T_") !== undefined,
      }).toEqual({ entered: true, moved: false });
      expect(["_Z5movedIiEPN4gone5ThingES2_T_", "touched"].map(canGo)).toEqual([false, false]);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });

    test("whose first byte has another name too stays open", async () => {
      using dir = tempDir("islands-macho-door", {
        ...sources,
        "more.c": `
          ${mixes("behind_the_shared_door", 5)}
          __asm__(${asCStrings(`.text\n.globl _shared_door, _another_name\n.p2align 2\n_shared_door:\n_another_name:\n${addOne}${addOne}${addOne}${addOne}${jumpTo("_behind_the_shared_door")}`)});
        `,
        "main.c": `
          ${start}
          int shared_door(int);
          int another_name(int);
          int main(int argc, char **argv) { return argc > 6 ? shared_door(argc) : argc > 5 ? the_door(argc) : another_name(argc) == 637 ? 0 : 1; }
        `,
        "doors": sources.doors + "door extra exit ^shared_door$\n",
      });
      const { said, door, canGo, exitCodes } = await linked(machine, String(dir), {
        objects: ["behind", "door", "more", "main"],
      });
      expect(said).toContain("1 doors were folded into other functions and stay open");
      expect(door("shared_door")).toBeUndefined();
      expect(["shared_door", "behind_the_shared_door", "behind_0"].map(canGo)).toEqual([false, false, true]);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });

    test("of a few instructions is shut where it stands", async () => {
      using dir = tempDir("islands-macho-door", {
        ...sources,
        "door.c": `__asm__(${asCStrings(`.text\n.globl _the_door\n.p2align 2\n_the_door:\n${addOne}${addOne}${addOne}${addOne}${jumpTo("_behind")}_what_follows_the_door:\nret\n`)});`,
        "main.c": `
          int the_door(int);
          __attribute__((noinline)) void Bun__trimmedOut(int feature) { ${exits("70")} }
          int main(int argc, char **argv) { return argc > 1 ? the_door(argc) & 63 : 0; }
        `,
      });
      const folder = String(dir);
      const { said, table, door, canGo, addressOf, whyFat, file, offsetOf } = await linked(machine, folder, {
        objects: ["behind", "door", "main"],
      });
      expect(said).toContain("0 doors are thin");
      expect(whyFat).toContain("the_door (fat: it is small)");
      expect(door("the_door")!.places ?? []).toEqual([]);
      expect(["the_door", "behind"].map(canGo)).toEqual([false, true]);
      const shut = shutDoors(file, table, ["extra"], machine.isArm64);
      const at = addressOf("the_door");
      expect(
        targetsOf(shut, offsetOf, [
          machine.isArm64 ? { address: at + 8, kind: branch26 } : { address: at + 6, kind: add32 },
        ]),
      ).toEqual([addressOf("Bun__trimmedOut")]);
      if (machine.canRun)
        expect([
          await signAndRun(folder, "shut", shut),
          await signAndRun(folder, "shut", shut, ["through the door"]),
        ]).toEqual([0, 70]);
    });

    test("that runs before main stays open, and what it names stays", async () => {
      using dir = tempDir("islands-macho-door", {
        ...sources,
        "door.c": doorTo("more"),
        "more.c": `
          int early_value;
          static volatile int seed = 5;
          ${mixes("behind_early", 5)}
          __attribute__((constructor, noinline)) void early(void) { for (int i = 0; i < 5; i++) early_value += behind_early(seed + i); }
          int more(int x) { return behind_early(x); }
        `,
        "main.c": `${start} extern int early_value; int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : early_value != 0 ? 0 : 1; }`,
        "doors": sources.doors + "door extra exit ^early$\n",
      });
      const { said, door, canGo, exitCodes } = await linked(machine, String(dir), {
        objects: ["behind", "door", "more", "main"],
      });
      expect(said).toContain(
        "1 functions that match a door run before main or after it, or have a second entry, and are no doors",
      );
      expect(door("early")).toBeUndefined();
      expect(["early", "behind_early", "behind_0"].map(canGo)).toEqual([false, false, true]);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });

    test("with an alternative entry that what stays calls stays open, and what the entry names stays", async () => {
      using dir = tempDir("islands-macho-door", {
        ...sources,
        "door.c": doorTo("more"),
        "more.c": `${mixes("behind_target", 3)} int more(int x) { return behind_target(x); }`,
        "piece.c": `__asm__(${asCStrings(`.text\n.globl _piece, _entry\n.p2align 2\n_piece:\n${addOne}${addOne}${addOne}${addOne}\n.alt_entry _entry\n_entry:\n${jumpTo("_behind_target")}\n`)});`,
        "main.c": `
          ${start}
          int piece(int);
          int entry(int);
          int main(int argc, char **argv) { return argc > 6 ? piece(argc) : argc > 5 ? the_door(argc) : entry(argc) == 35 ? 0 : 1; }
        `,
        "doors": sources.doors + "door extra exit ^piece$\n",
      });
      const { said, door, canGo, exitCodes } = await linked(machine, String(dir), {
        objects: ["behind", "door", "more", "piece", "main"],
      });
      expect(said).toContain(
        "1 functions that match a door run before main or after it, or have a second entry, and are no doors",
      );
      expect(door("piece")).toBeUndefined();
      expect(["piece", "entry", "behind_target", "behind_0"].map(canGo)).toEqual([false, false, false, true]);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });

    test("too small to be shut is no door, and what it names stays", async () => {
      using dir = tempDir("islands-macho-door", {
        ...sources,
        "more.c": `
          ${mixes("behind_the_small_door", 5)}
          __asm__(${asCStrings(`.text\n.globl _small_door\n.p2align 2\n_small_door:\n${jumpTo("_behind_the_small_door")}_what_follows_the_small_door:\nret\n`)});
        `,
        "main.c": `
          ${start}
          int small_door(int);
          int main(int argc, char **argv) { return argc > 6 ? small_door(argc) : argc > 5 ? the_door(argc) : 0; }
        `,
        "doors": sources.doors + "door extra exit ^small_door$\n",
      });
      const { said, canGo, exitCodes } = await linked(machine, String(dir), {
        objects: ["behind", "door", "more", "main"],
      });
      expect(said).toContain("1 functions that match a door are too small to be shut and are no doors");
      expect(["small_door", "behind_the_small_door", "behind_0"].map(canGo)).toEqual([false, false, true]);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });
  });

  describe("two equal doors of two features", () => {
    const long = (name: string) => `
      __attribute__((noinline)) int ${name}(int x) { __asm__ volatile(".rept 6000\\nnop\\n.endr"); for (int i = 0; i < 5; i++) x += behind(x + i) * 3 + behind(x ^ i); return x; }
    `;
    const twins = {
      ...sources,
      "more.c": `int behind(int); ${long("door_of_one")} ${long("door_of_another")} int what_follows_the_doors(int x) { return x; }`,
      "main.c": `
        int the_door(int);
        int door_of_one(int);
        int door_of_another(int);
        __attribute__((noinline)) void Bun__trimmedOut(int feature) { ${exits("70 + (feature & 255)")} }
        int main(int argc, char **argv) {
          if (argc == 2) return door_of_one(argc) & 63;
          if (argc == 3) return door_of_another(argc) & 63;
          return argc > 5 ? the_door(argc) : 0;
        }
      `,
      "doors":
        sources.doors +
        "feature one the first\nfeature another the second\ndoor one exit ^door_of_one$\ndoor another exit ^door_of_another$\n",
    };

    test("are one body, which goes when both are out and is shut only then", async () => {
      using dir = tempDir("islands-macho-twins", twins);
      const folder = String(dir);
      const { table, addressOf, door, file, offsetOf } = await linked(machine, folder, {
        objects: ["behind", "door", "table", "more", "main"],
      });
      expect(addressOf("door_of_one")).toBe(addressOf("door_of_another"));
      const { address, feature, places } = door("door_of_one")!;
      expect(feature).toBe("one,another");
      const body = table.islands.filter(island => island.start <= address && address < island.end);
      expect(body.map(island => island.features)).toEqual(["one,another"]);
      expect(places!.map(place => place.kind)).toEqual(machine.isArm64 ? [branch26, branch26] : [add32, add32]);
      const withoutOne = shutDoors(file, table, ["one"], machine.isArm64);
      const withoutBoth = shutDoors(file, table, ["one", "another"], machine.isArm64);
      expect(withoutOne.equals(file)).toBe(true);
      expect(targetsOf(withoutBoth, offsetOf, places!)).toEqual(Array(2).fill(Math.ceil(body[0]!.start / 4) * 4));
      if (!machine.canRun) return;
      const codes = async (name: string, program: Buffer) => [
        await signAndRun(folder, name, program, ["a"]),
        await signAndRun(folder, name, program, ["a", "b"]),
      ];
      expect(await codes("without-one", withoutOne)).toEqual(await codes("whole", file));
      expect(await codes("without-both", withoutBoth)).toEqual(Array(2).fill(70 + table.features.indexOf("one")));
    });
  });

  describe("code of one feature that names a door of another", () => {
    const naming = (conditions: string) => ({
      ...sources,
      "door.c": doorTo("more"),
      "more.c": `
        int door_of_another(int);
        int more(int x) { return door_of_another(x); }
      `,
      "another.c": `
        ${manyFunctions("another_")}
        __attribute__((noinline)) int door_of_another(int x) { ${callAll("another_")} return x; }
      `,
      "doors": sources.doors + "feature another something else\ndoor another exit ^door_of_another$\n" + conditions,
    });
    const pairs = async (conditions: string) => {
      using dir = tempDir("islands-macho-pairs", naming(conditions));
      await linked(machine, String(dir), { objects: ["behind", "door", "more", "another", "table", "main"] });
      return readFileSync(join(String(dir), "work/pairs.txt"), "utf8");
    };

    test.each([
      ["is listed", "", 0, "another <- extra: 1 references"],
      [
        "stops the link once pairs are argued and this one is not",
        "argued extra another the other way round\n",
        1,
        "another <- extra: 1 references",
      ],
      ["is argued", "argued another extra whoever gets there has asked for both\n", 0, ""],
      [
        "is kept with it by a condition",
        "argued extra another the other way round\nwhen another feature extra\n",
        0,
        "",
      ],
    ])("%s", async (_, lines, exitCode, listed) => {
      using dir = tempDir(
        "islands-macho-pairs",
        naming("when extra global Extra\nwhen another global Another\n" + lines),
      );
      const said = await wrapped(machine, String(dir), {
        objects: ["behind", "door", "more", "another", "table", "main"],
      });
      expect(said.exitCode).toBe(exitCode);
      if (exitCode !== 0) expect(said.stderr).toContain('no line "argued" says why');
      expect(readFileSync(join(String(dir), "work/pairs.txt"), "utf8").split("\n")[0]).toBe(listed);
    });

    test("is written down where no condition keeps the second with the first", async () => {
      expect(await pairs("when extra module extra\n")).toBe(
        "another <- extra: 1 references\n    door_of_another <- more\n",
      );
    });

    test("meets the stub while the first is kept and the second is out", async () => {
      using dir = tempDir("islands-macho-pairs", naming(""));
      const { table, door, file, offsetOf, addressOf, canGo } = await linked(machine, String(dir), {
        objects: ["behind", "door", "more", "another", "table", "main"],
      });
      expect(["more", "door_of_another"].map(canGo)).toEqual([true, true]);
      const { places, feature } = door("door_of_another")!;
      expect({ feature, kinds: places!.map(place => place.kind) }).toEqual({
        feature: "another",
        kinds: [machine.isArm64 ? branch26 : add32],
      });
      expect(targetsOf(file, offsetOf, places!)).toEqual([addressOf("door_of_another")]);
      const body = table.islands.find(island => island.features === "another")!;
      expect(targetsOf(shutDoors(file, table, ["another"], machine.isArm64), offsetOf, places!)).toEqual([
        Math.ceil(body.start / 4) * 4,
      ]);
      expect(targetsOf(shutDoors(file, table, ["extra"], machine.isArm64), offsetOf, places!)).not.toEqual([
        addressOf("door_of_another"),
      ]);
    });

    test("is not, where the second follows the first or is kept by the same facts", async () => {
      expect(await pairs("when extra module extra\nwhen another feature extra\n")).toBe("");
      expect(await pairs("when extra module extra\nwhen another module extra\n")).toBe("");
    });
  });

  describe("an operation that compiled code calls through the runtime table", () => {
    const operations = {
      ...sources,
      "door.c": `
        int behind(int);
        int stays(int);
        __attribute__((noinline)) int operationOnlyInTheTable(int x) { for (int i = 0; i < 5; i++) x += behind(x + i) * 3 + behind(x ^ i); return x; }
        __attribute__((noinline)) int operationCalledDirectlyToo(int x) { for (int i = 0; i < 5; i++) x += stays(x + i) * 3 + stays(x ^ i); return x; }
        __attribute__((noinline)) int operationOfAnotherFeature(int x) { for (int i = 0; i < 7; i++) x += stays(x + i) * 5 + stays(x ^ i); return x; }
      `,
      "main.c": `
        extern const char table_that_stays[62];
        int operationOnlyInTheTable(int);
        int operationCalledDirectlyToo(int);
        int operationOfAnotherFeature(int);
        __attribute__((noinline)) void Bun__trimmedOut(int feature) { ${exits("70")} }
        __attribute__((noinline)) int stays(int x) { return table_that_stays[x & 31]; }
        int (*volatile entries[3])(int);
        void fill(void) __asm__("__ZN3JSC3AOT12RuntimeTableC2ERNS_2VME");
        __attribute__((noinline)) void fill(void) { entries[0] = operationOnlyInTheTable; entries[1] = operationCalledDirectlyToo; entries[2] = operationOfAnotherFeature; }
        int main(int argc, char **argv) {
          fill();
          if (argc == 2) return entries[0](argc) & 63;
          if (argc == 3) return entries[1](argc) & 63;
          if (argc == 4) return operationCalledDirectlyToo(argc) & 63;
          if (argc == 5) return entries[2](argc) & 63;
          return 0;
        }
      `,
      "doors":
        "feature extra what lies behind the door\noperations extra ^operation(OnlyInTheTable|CalledDirectlyToo)$\n" +
        "feature other a feature with facts of its own\nwhen other global Other\ndoor other exit ^operationOfAnotherFeature$\n",
    };

    test("is a thin door with a condition of its own name, unless other code names it too; a plain door gets the condition as well", async () => {
      using dir = tempDir("islands-macho-operations", operations);
      const folder = String(dir);
      const { said, table, canGo, door, file } = await linked(machine, folder);
      expect(said).toContain(
        "1 operations are named by more than the table that compiled code calls them through and are no doors",
      );
      expect(said).toContain("2 doors are thin");
      expect(table.conditions).toEqual([
        { feature: "extra", kind: "operation", name: "operationOnlyInTheTable" },
        { feature: "other", kind: "global", name: "Other" },
        { feature: "other", kind: "operation", name: "operationOfAnotherFeature" },
      ]);
      expect({
        isDoor: door("operationOnlyInTheTable") !== undefined,
        canGo: canGo("operationOnlyInTheTable"),
      }).toEqual({ isDoor: true, canGo: true });
      expect({
        isDoor: door("operationCalledDirectlyToo") !== undefined,
        canGo: canGo("operationCalledDirectlyToo"),
      }).toEqual({ isDoor: false, canGo: false });
      if (!machine.canRun) return;
      const shut = shutDoors(file, table, ["extra"], machine.isArm64);
      const codes: number[] = [];
      for (const way of [
        [],
        ["through the table"],
        ["the", "other"],
        ["the", "other", "directly"],
        ["that", "of", "another", "feature"],
      ])
        codes.push(await signAndRun(folder, "shut", shut, way));
      expect(codes[0]).toBe(0);
      expect(codes[1]).toBe(70);
      expect(codes.slice(2)).not.toContain(70);
    });
  });

  describe("a thin door", () => {
    const thin = (far: boolean, throughTheTable = false) => ({
      ...sources,
      "door.c": `
        int behind(int);
        __attribute__((noinline)) int the_door(int x) { for (int i = 0; i < 5; i++) x += behind(x + i) * 3 + behind(x ^ i); return x; }
      `,
      "holders.c": `
        int the_door(int);
        int (*const handlers[2])(int) = { 0, the_door };
        int (*handlers_that_change[2])(int) = { 0, the_door };
        ${far ? `__asm__(".text\\n.globl _far_apart\\n.no_dead_strip _far_apart\\n_far_apart:\\n.space 0x200000\\n");` : ""}
      `,
      "main.c": `
        ${throughTheTable ? "" : `__attribute__((visibility("hidden")))`} int the_door(int);
        __attribute__((noinline)) void Bun__trimmedOut(int feature) { ${exits("70")} }
        extern int (*const handlers[2])(int);
        extern int (*handlers_that_change[2])(int);
        int (*volatile pointer)(int);
        __attribute__((noinline)) static int tail(int x) { return the_door(x + 1); }
        int main(int argc, char **argv) {
          if (argc == 2) return the_door(argc) & 63;
          if (argc == 3) return handlers[argc - 2](argc) & 63;
          if (argc == 4) { pointer = the_door; return pointer(argc) & 63; }
          if (argc == 5) return tail(argc) & 63;
          if (argc == 6) return handlers_that_change[argc - 5](argc) & 63;
          return 0;
        }
      `,
    });
    const objects = ["behind", "door", "holders", "main"];
    const ways = [
      [],
      ["call"],
      ["a", "table"],
      ["an", "address", "taken"],
      ["a", "jump", "at", "the end"],
      ["a", "table", "that", "can", "change"],
    ];
    const kindsOf = (places: Place[]) => places.map(place => place.kind).sort((a, b) => a - b);

    for (const [far, throughTheTable] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      test(`goes with its feature, and everybody who names it from ${far ? "far away" : "nearby"}${throughTheTable ? ", its address taken through the table of global offsets," : ""} meets the stub`, async () => {
        using dir = tempDir("islands-macho-thin", thin(far!, throughTheTable));
        const folder = String(dir);
        const { said, table, canGo, door, addressOf, file, offsetOf, sectionAt } = await linked(machine, folder, {
          objects,
        });
        expect(said).toContain("1 doors are thin");
        expect(canGo("the_door")).toBe(true);
        const places = door("the_door")!.places!;
        expect(kindsOf(places)).toEqual(
          !machine.isArm64
            ? [add32, add32, add32, pointer36, pointer36]
            : far
              ? [branch26, branch26, page21, low12, pointer36, pointer36]
              : [branch26, branch26, adr, pointer36, pointer36, nop],
        );
        expect(places.filter(place => place.kind === pointer36).map(place => sectionAt(place.address)!.name)).toEqual([
          "__DATA_CONST,__const",
          "__DATA,__data",
        ]);
        expect(places.filter(place => place.kind === pointer36).map(place => place.address)).toEqual([
          addressOf("handlers") + 8,
          addressOf("handlers_that_change") + 8,
        ]);
        expect(targetsOf(file, offsetOf, places)).toEqual(Array(5).fill(addressOf("the_door")));

        const shut = shutDoors(file, table, ["extra"], machine.isArm64);
        const stub = Math.ceil(table.islands[0]!.start / 4) * 4;
        expect(targetsOf(shut, offsetOf, places)).toEqual(Array(5).fill(stub));
        expect(table.stub).toBe(addressOf("Bun__trimmedOut"));
        expect(
          targetsOf(shut, offsetOf, [
            machine.isArm64 ? { address: stub + 8, kind: branch26 } : { address: stub + 6, kind: add32 },
          ]),
        ).toEqual([table.stub]);
        const changed = new Set<number>();
        for (let at = 0; at < file.length; at++) if (file[at] !== shut[at]) changed.add(at);
        for (const { start, end } of table.islands)
          for (let at = offsetOf(start); at < offsetOf(start) + end - start; at++) changed.delete(at);
        const fields = new Set(
          places.flatMap(place =>
            Array.from({ length: place.kind === pointer36 ? 8 : 4 }, (_, index) => offsetOf(place.address) + index),
          ),
        );
        expect([...changed].filter(at => !fields.has(at))).toEqual([]);

        if (!machine.canRun) return;
        const codes = { whole: [] as number[], shut: [] as number[] };
        for (const way of ways) codes.whole.push(await signAndRun(folder, "whole", file, way));
        for (const way of ways) codes.shut.push(await signAndRun(folder, "shut", shut, way));
        expect(codes.whole[0]).toBe(0);
        expect(codes.whole).not.toContain(70);
        expect(codes.shut).toEqual([0, 70, 70, 70, 70, 70]);
      });
    }

    test("that returns when it is shut shares one stub, behind the stubs of those that exit", async () => {
      const returning = (name: string, by: number) =>
        `__attribute__((noinline)) int ${name}(int x) { for (int i = 0; i < 5; i++) x += behind(x + i) * ${by} + behind(x ^ i); return x | 1; }`;
      using dir = tempDir("islands-macho-thin", {
        ...thin(false),
        "more.c": `int behind(int); ${returning("returns_nothing", 5)} ${returning("returns_nothing_too", 7)}`,
        "main.c": `
          int the_door(int);
          int returns_nothing(int);
          int returns_nothing_too(int);
          __attribute__((noinline)) void Bun__trimmedOut(int feature) { ${exits("70")} }
          int main(int argc, char **argv) { return argc == 2 ? the_door(argc) & 63 : argc == 3 ? returns_nothing(argc) & 63 : argc == 4 ? returns_nothing_too(argc) & 63 : 0; }
        `,
        "doors": sources.doors + "door extra return ^returns_nothing\n",
      });
      const folder = String(dir);
      const { said, table, door, file, offsetOf } = await linked(machine, folder, {
        objects: ["behind", "door", "more", "main"],
      });
      expect(said).toContain("3 doors are thin");
      expect(["the_door", "returns_nothing", "returns_nothing_too"].map(name => door(name)!.whenShut)).toEqual([
        "exit",
        "return",
        "return",
      ]);
      const shut = shutDoors(file, table, ["extra"], machine.isArm64);
      const strip = Math.ceil(table.islands[0]!.start / 4) * 4;
      const returnStub = strip + (machine.isArm64 ? 12 : 10);
      expect(
        ["the_door", "returns_nothing", "returns_nothing_too"].map(name =>
          targetsOf(shut, offsetOf, door(name)!.places!),
        ),
      ).toEqual([[strip], [returnStub], [returnStub]]);
      expect(
        shut.subarray(offsetOf(returnStub), offsetOf(returnStub) + (machine.isArm64 ? 8 : 3)).toString("hex"),
      ).toBe(machine.isArm64 ? "00008052c0035fd6" : "31c0c3");
      if (!machine.canRun) return;
      const codes: number[] = [];
      for (const way of [[], ["exits"], ["returns", "nothing"], ["returns", "nothing", "too"]])
        codes.push(await signAndRun(folder, "shut", shut, way));
      expect(codes).toEqual([0, 70, 0, 0]);
    });

    test.skipIf(machine.isArm64)(
      "called through its slot in the table of global offsets: the slot is the place",
      async () => {
        using dir = tempDir("islands-macho-thin", {
          ...thin(false),
          "main.c": `
          int the_door(int);
          __attribute__((noinline)) void Bun__trimmedOut(int feature) { __builtin_trap(); }
          __attribute__((noinline)) static int through_the_slot(int x) {
            int result;
            __asm__ volatile("callq *_the_door@GOTPCREL(%%rip)" : "=a"(result) : "D"(x) : "memory", "rcx", "rdx", "rsi", "r8", "r9", "r10", "r11");
            return result;
          }
          int main(int argc, char **argv) { return argc > 5 ? through_the_slot(argc) : 0; }
        `,
        });
        const { said, table, canGo, door, addressOf, file, offsetOf, sectionAt } = await linked(machine, String(dir), {
          objects: ["behind", "door", "main"],
        });
        expect(said).toContain("1 doors are thin");
        expect(canGo("the_door")).toBe(true);
        const places = door("the_door")!.places!;
        expect(places.map(place => [place.kind, sectionAt(place.address)!.name])).toEqual([
          [pointer36, "__DATA_CONST,__got"],
        ]);
        expect(targetsOf(file, offsetOf, places)).toEqual([addressOf("the_door")]);
        expect(targetsOf(shutDoors(file, table, ["extra"], false), offsetOf, places)).toEqual([
          Math.ceil(table.islands[0]!.start / 4) * 4,
        ]);
      },
    );

    test("goes though a constant that only it names holds its address and a distance, which cannot be rewritten", async () => {
      using dir = tempDir("islands-macho-thin", {
        ...thin(false),
        "door.c": `
          int behind(int);
          extern const char *const past_its_first_instruction;
          __attribute__((noinline)) int the_door(int x) { for (int i = 0; i < 5; i++) x += behind(x + i) * 3 + behind(x ^ i); return x + past_its_first_instruction[x & 1]; }
        `,
        "its_own.c": `int the_door(int); const char *const past_its_first_instruction = (const char *)the_door + 4;`,
      });
      const { said, canGo, door, file, offsetOf, addressOf } = await linked(machine, String(dir), {
        objects: [...objects, "its_own"],
      });
      expect(said).toContain("1 doors are thin");
      expect(canGo("the_door")).toBe(true);
      expect(targetsOf(file, offsetOf, door("the_door")!.places!)).toEqual(Array(5).fill(addressOf("the_door")));
    });

    test("that only its own feature names is not listed at all", async () => {
      using dir = tempDir("islands-macho-thin", {
        ...thin(false),
        "doors": sources.doors + "door extra exit ^behind$\n",
      });
      const { said, canGo, door, table } = await linked(machine, String(dir), { objects });
      expect(said).toContain("2 doors are thin");
      expect(["the_door", "behind"].map(canGo)).toEqual([true, true]);
      expect(door("behind")).toBeUndefined();
      expect(table.doors.length).toBe(1);
    });

    test("marked as used, as every host function is, goes all the same", async () => {
      using dir = tempDir("islands-macho-thin", {
        ...thin(false),
        "door.c": thin(false)["door.c"].replace("__attribute__((noinline))", "__attribute__((used, noinline))"),
      });
      const { said, canGo, door } = await linked(machine, String(dir), { objects });
      expect(said).toContain("1 doors are thin");
      expect(canGo("the_door")).toBe(true);
      expect(door("the_door")!.places!.length).toBeGreaterThanOrEqual(5);
    });

    test("stays fat when something that stays holds its address and a distance", async () => {
      using dir = tempDir("islands-macho-thin", {
        ...thin(false),
        "holders.c": `${thin(false)["holders.c"]} const char *const its_start_and_past_it[2] = { (const char *)the_door, (const char *)the_door + 4 };`,
        "main.c": thin(false)["main.c"].replace(
          "return 0;",
          "extern const char *const its_start_and_past_it[2]; return its_start_and_past_it[argc & 1][argc] == 1;",
        ),
      });
      const { said, canGo, door, whyFat } = await linked(machine, String(dir), { objects });
      expect(said).toContain("0 doors are thin");
      expect(canGo("the_door")).toBe(false);
      expect(door("the_door")!.places ?? []).toEqual([]);
      expect(whyFat).toMatch(
        /the_door \(fat: a reference in holders\.o:_its_start_and_past_it.* cannot be rewritten\)/,
      );
    });

    test("named by constants that nothing reads and that are marked as used: the place is listed", async () => {
      using dir = tempDir("islands-macho-thin", {
        ...thin(false),
        "holders.c": `${thin(false)["holders.c"]} __attribute__((used)) static int (*const kept_and_never_read)(int) = the_door;`,
      });
      const { said, canGo, door, addressOf, file, offsetOf } = await linked(machine, String(dir), { objects });
      expect(said).toContain("1 doors are thin");
      expect(canGo("the_door")).toBe(true);
      const places = door("the_door")!.places!;
      expect(places.filter(place => place.kind === pointer36).map(place => place.address)).toContain(
        addressOf("kept_and_never_read"),
      );
      expect(targetsOf(file, offsetOf, places)).toEqual(Array(6).fill(addressOf("the_door")));
    });

    test("that is weak and exported, so that it is called through a stub of the linker's, is shut where it stands", async () => {
      using dir = tempDir("islands-macho-thin", {
        ...thin(false),
        "door.c": thin(false)["door.c"].replace("__attribute__((noinline))", "__attribute__((weak, noinline))"),
        "main.c": thin(false, true)["main.c"],
        "exported.txt": "_main\n_the_door\n",
      });
      const folder = String(dir);
      const { said, table, canGo, door, section, addressOf, file, offsetOf } = await linked(machine, folder, {
        objects,
      });
      expect(section("__TEXT,__stubs")).toBeDefined();
      expect(said).toContain("0 doors are thin");
      expect(["the_door", "behind"].map(canGo)).toEqual([false, true]);
      expect(door("the_door")!.places ?? []).toEqual([]);
      const shut = shutDoors(file, table, ["extra"], machine.isArm64);
      const at = addressOf("the_door");
      expect(
        targetsOf(shut, offsetOf, [
          machine.isArm64 ? { address: at + 8, kind: branch26 } : { address: at + 6, kind: add32 },
        ]),
      ).toEqual([addressOf("Bun__trimmedOut")]);
      if (!machine.canRun) return;
      const codes: number[] = [];
      for (const way of ways) codes.push(await signAndRun(folder, "shut", shut, way));
      expect(codes).toEqual([0, 70, 70, 70, 70, 70]);
    });

    test("stays fat when the executable exports it, also where only its own feature loads what can call it", async () => {
      using dir = tempDir("islands-macho-thin", {
        ...thin(false),
        "exported.txt": "_main\n_the_door\n",
        "doors": sources.doors + "exported extra\n",
      });
      const { said, door, whyFat } = await linked(machine, String(dir), { objects });
      expect(said).toContain("0 doors are thin");
      expect(door("the_door")!.places ?? []).toEqual([]);
      expect(whyFat).toContain("the_door (fat: the executable exports it)");
    });

    test("stays fat when the executable exports it", async () => {
      using dir = tempDir("islands-macho-thin", { ...thin(false), "exported.txt": "_main\n_the_door\n" });
      const { said, canGo, door, whyFat } = await linked(machine, String(dir), { objects });
      expect(said).toContain("0 doors are thin");
      expect(canGo("the_door")).toBe(false);
      expect(door("the_door")!.places ?? []).toEqual([]);
      expect(whyFat).toContain("the_door (fat: it is a root)");
    });
  });

  describe("a string", () => {
    const word = (index: number) => `words that only the feature names, ${index}`;
    const words = `const char *const behind_words[${count}] = { ${Array.from({ length: count }, (_, index) => JSON.stringify(word(index))).join(", ")} };`;
    const says = (name: string, text: string, from = 0) =>
      `__attribute__((noinline)) const char *${name}(void) { return &${JSON.stringify(text)}[${from}]; }`;
    const inBoth = "the same words in both";
    const onlyBehind = "only the feature names these words";
    const twiceBehind = "equal words from two inputs behind the door";
    const endStays = "words of which what stays names the end";
    const endGoes = "words of which only the feature names the end";
    const strings = {
      ...sources,
      "door.c": doorTo("more"),
      "more.c": `
        ${words}
        int more_words(int);
        const char *behind_shared(void), *only_behind(void), *behind_equal(void), *behind_whole(void), *behind_end(void);
        int more(int x) { return behind_words[x % ${count}][x & 7] + behind_shared()[x & 7] + only_behind()[x & 7] + behind_equal()[x & 7] + behind_whole()[x & 7] + behind_end()[x & 3] + more_words(x); }
      `,
      "said_behind.c": `${says("behind_shared", inBoth)} ${says("only_behind", onlyBehind)} ${says("behind_equal", twiceBehind)} ${says("behind_whole", endStays)} ${says("behind_end", endGoes, 41)}`,
      "more_words.c": `${says("behind_equal_too", twiceBehind)} int more_words(int x) { return behind_equal_too()[x & 7]; }`,
      "said.c": `${says("stays_shared", inBoth)} ${says("stays_end", endStays, 36)}`,
      "main.c": `
        ${start}
        const char *stays_shared(void), *stays_end(void);
        int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : stays_shared()[argc + 3] == 's' && stays_end()[argc] == 'n' ? 0 : 1; }
      `,
    };
    const objects = ["behind", "door", "more", "said_behind", "more_words", "said", "main"];

    test("that only the feature names can go, from one input or two, by its start or its middle; one that what stays names too, by its start or its middle, stays", async () => {
      using dir = tempDir("islands-macho-strings", strings);
      const { said, stringAt, canGoAt, exitCodes } = await linked(machine, String(dir), { objects });
      expect(said).toContain(
        `${count + 5} strings are followed by their text; 0 more lie in an input in which nothing was seen to name them, and stay`,
      );
      const go = [word(1), word(count - 1), onlyBehind, twiceBehind, endGoes];
      expect(Object.fromEntries(go.map(text => [text, canGoAt(stringAt(text))]))).toEqual(
        Object.fromEntries(go.map(text => [text, true])),
      );
      expect(
        Object.fromEntries(
          [inBoth, endStays].map(text => [text, [Number.isNaN(stringAt(text)), canGoAt(stringAt(text))]]),
        ),
      ).toEqual({ [inBoth]: [false, false], [endStays]: [false, false] });
      expect(said).toContain("; 0 references lead where the names did not");
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });

    for (const inputs of [
      ["more", "kept"],
      ["kept", "more"],
    ]) {
      test(`that an input holds in which nothing is seen to name it stays: ${inputs.join(" ahead of ")}`, async () => {
        const alsoKept = "words that an input keeps and does not name";
        using dir = tempDir("islands-macho-strings", {
          ...strings,
          "more_words.c": `${says("behind_kept", alsoKept)} int more_words(int x) { return behind_kept()[x & 7]; }`,
          "kept.S": `.section __TEXT,__cstring,cstring_literals\nl_kept: .asciz ${JSON.stringify(alsoKept)}\n.no_dead_strip l_kept\n.subsections_via_symbols\n`,
        });
        const { said, stringAt, canGoAt, exitCodes } = await linked(machine, String(dir), {
          objects: [
            "behind",
            "door",
            "said",
            "main",
            ...inputs.flatMap(input => (input === "more" ? ["more", "said_behind", "more_words"] : [input])),
          ],
        });
        expect(said).toContain("1 more lie in an input in which nothing was seen to name them, and stay");
        expect([word(1), onlyBehind, alsoKept].map(text => canGoAt(stringAt(text)))).toEqual([true, true, false]);
        expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
      });
    }

    test("cannot go, none of them, once one reference leads to no string that the map holds", async () => {
      const lea = (name: string, to: string) =>
        `${name}:${perMachine(`adrp x0, ${to}@PAGE\nadd x0, x0, ${to}@PAGEOFF`, `leaq ${to}(%rip), %rax`)}ret\n`;
      using dir = tempDir("islands-macho-strings", {
        ...strings,
        "labels.S": `
          .section __TEXT,__cstring,cstring_literals
          l_first: .asciz "the first of two under one name"
          .asciz "the second, which is named by the first and a distance"
          .text
          .globl _stays_second
          .p2align 2\n${lea("_stays_second", "l_first+32")}.subsections_via_symbols
        `,
        "main.c": `
          ${start}
          const char *stays_second(void);
          int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : stays_second() != 0 ? 0 : 1; }
        `,
      });
      const { said, stringAt, canGoAt, canGo, exitCodes } = await linked(machine, String(dir), {
        objects: [...objects, "labels"],
      });
      expect(said).toMatch(
        /1 references to strings lead to none that the map holds and \d lead elsewhere by the bytes: no string can go/,
      );
      expect([word(1), word(count - 1), onlyBehind].map(text => canGoAt(stringAt(text)))).toEqual([
        false,
        false,
        false,
      ]);
      expect(canGo("behind_0")).toBe(true);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });

    test.skipIf(!machine.isArm64)(
      "cannot go, none of them, once the bytes lead to another string than the text",
      async () => {
        using dir = tempDir("islands-macho-strings", strings);
        const { said, stringAt, canGoAt, canGo, exitCodes } = await linked(machine, String(dir), {
          objects,
          linkFlags: ["-Wl,--no-deduplicate-strings"],
        });
        expect(said).toMatch(
          /0 references to strings lead to none that the map holds and [1-9] lead elsewhere by the bytes: no string can go/,
        );
        expect([word(1), word(count - 1), onlyBehind].map(text => canGoAt(stringAt(text)))).toEqual([
          false,
          false,
          false,
        ]);
        expect(canGo("behind_0")).toBe(true);
        expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
      },
    );
  });

  describe("the layout", () => {
    const word = (index: number) => `words that go with the feature, ${index}`;
    const everyKind = {
      ...sources,
      "door.c": doorTo("more"),
      "more.c": `
        extern const char builtins_text[20000];
        const char *const behind_words[${count * 3}] = { ${Array.from({ length: count * 3 }, (_, index) => JSON.stringify(word(index % count))).join(", ")} };
        int more(int x) { return behind_words[x % ${count * 3}][x & 7] + builtins_text[x % 20000]; }
      `,
      "builtins.S": `.section __TEXT,__bun_builtins,regular,no_dead_strip\n.globl _builtins_text\n.p2align 4\n_builtins_text:\n.fill 20000, 1, 0x61\n`,
      "main.c": `
        ${start}
        extern const char table_that_stays[62];
        extern const char Bun__trimmedFeatures[];
        volatile int changes = 1;
        const char *const words_that_stay[2] = { "words that stay", "more words that stay" };
        typedef double pair __attribute__((vector_size(16)));
        __attribute__((noinline)) pair scaled(pair x) { return x * (pair){ 1.000123, 2.000321 }; }
        int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : scaled((pair){ argc, argc })[1] > 2 && words_that_stay[argc][0] == 'm' && table_that_stays[argc] == '1' && Bun__trimmedFeatures[argc] == 'h' && changes == 1 ? 0 : 1; }
      `,
    };
    const objects = ["behind", "door", "table", "more", "main", "builtins"];

    const threeRuns = [
      "__TEXT,__text .. __TEXT,__text",
      "__TEXT,__cstring .. __TEXT,__const",
      "__DATA_CONST,__const .. the end of __DATA_CONST",
    ];
    const describeRange = (
      { sectionAt, segmentAt }: ReturnType<typeof readMachO>,
      { start, end }: { start: number; end: number },
    ) =>
      `${sectionAt(start)!.name} .. ${end === segmentAt(end - 1)!.address + segmentAt(end - 1)!.size ? `the end of ${segmentAt(end - 1)!.name}` : sectionAt(end - 1)!.name}`;
    const allWords = Array.from({ length: count - 1 }, (_, index) => word(index + 1));

    test("with the feature out what is dead is three runs: code; strings, the built-ins' text and constants; constants that hold addresses", async () => {
      using dir = tempDir("islands-macho-layout", everyKind);
      const image = await linked(machine, String(dir), { objects });
      const { table, sections, section, stringAt, canGoAt, canGo, addressOf, exitCodes } = image;
      const laid = ["__TEXT,__literals", "__TEXT,__cstring", "__TEXT,__bun_builtins", "__TEXT,__const"];
      expect(sections.map(({ name }) => name).filter(name => laid.includes(name))).toEqual(laid);
      const dead = mergedRanges(table.islands);
      expect(dead.map(run => describeRange(image, run))).toEqual(threeRuns);
      const builtins = section("__TEXT,__bun_builtins")!;
      expect(dead[1]!.start).toBeLessThan(builtins.address);
      expect(dead[1]!.end).toBeGreaterThan(builtins.address + builtins.size);
      expect(["words that stay", "more words that stay"].map(text => canGoAt(stringAt(text)))).toEqual([false, false]);
      expect(allWords.filter(text => !canGoAt(stringAt(text)))).toEqual([]);
      expect(Math.max(stringAt("words that stay"), stringAt("more words that stay"))).toBeLessThan(dead[1]!.start);
      expect(
        ["builtins_text", "behind_numbers", "behind_words", "table_that_stays", "words_that_stay"].map(canGo),
      ).toEqual([true, true, true, false, false]);
      expect(addressOf("table_that_stays")).toBeGreaterThanOrEqual(dead[1]!.end);
      expect(addressOf("words_that_stay")).toBeLessThan(dead[2]!.start);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });

    test("by its own plan it is laid the same way, and by that link's plan it does not change by a byte", async () => {
      using dir = tempDir("islands-macho-layout", everyKind);
      const folder = String(dir);
      await linked(machine, folder, { objects });
      writeFileSync(join(folder, "first.plan"), readFileSync(join(folder, "program.plan")));
      const once = await linked(machine, folder, { objects, plan: "first.plan" });
      expect(once.said).not.toContain("first link");
      expect(mergedRanges(once.table.islands).map(run => describeRange(once, run))).toEqual(threeRuns);
      expect([word(0), ...allWords].filter(text => !once.canGoAt(once.stringAt(text)))).toEqual([]);
      writeFileSync(join(folder, "second.plan"), readFileSync(join(folder, "program.plan")));
      const again = await linked(machine, folder, { objects, plan: "second.plan" });
      expect(again.table).toEqual(once.table);
      expect(again.file.equals(once.file)).toBe(true);
      expect(readFileSync(join(folder, "program.plan"), "utf8")).toBe(
        readFileSync(join(folder, "second.plan"), "utf8"),
      );
    });

    test("a string that stays is not laid among those that go because one of them has its hash", async () => {
      const [stays, goes] = ["words number 36578", "words number 85708"];
      expect(Bun.hash.xxHash3(stays) & 0x7fffffffn).toBe(Bun.hash.xxHash3(goes) & 0x7fffffffn);
      using dir = tempDir("islands-macho-layout", {
        ...everyKind,
        "more.c": everyKind["more.c"].replace(
          "int more(int x) { return ",
          `int more(int x) { return ${JSON.stringify(goes)}[x & 7] + `,
        ),
        "main.c": everyKind["main.c"].replace(`"words that stay"`, JSON.stringify(stays)),
      });
      const image = await linked(machine, String(dir), { objects });
      const { table, stringAt, canGoAt, exitCodes } = image;
      const dead = mergedRanges(table.islands);
      expect(dead.map(run => describeRange(image, run))).toEqual(threeRuns);
      expect(canGoAt(stringAt(stays))).toBe(false);
      expect(stringAt(stays)).toBeLessThan(dead[1]!.start);
      expect(allWords.filter(text => !canGoAt(stringAt(text)))).toEqual([]);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });

    test("the strings of each island lie together, behind those that stay, the last island's first", async () => {
      const says = (index: number) =>
        `__attribute__((noinline)) const char *says_${index}(void) { return ${JSON.stringify(`${word(index)}, which every second feature names`)}; }`;
      const sum = (parity: number) =>
        Array.from({ length: count }, (_, index) => index)
          .filter(index => index % 2 === parity)
          .map(index => `says_${index}()[x & 7]`)
          .join(" + ");
      using dir = tempDir("islands-macho-layout", {
        ...sources,
        "door.c": doorTo("more"),
        "more.c": `
          ${Array.from({ length: count }, (_, index) => says(index)).join("\n")}
          int more(int x) { return ${sum(0)}; }
          __attribute__((noinline)) int door_of_another(int x) { return ${sum(1)}; }
        `,
        "main.c": `
          ${start}
          int door_of_another(int);
          __attribute__((noinline)) const char *says_what_stays(void) { return "words that stay"; }
          int main(int argc, char **argv) {
            const char *said = says_what_stays();
            __asm__ volatile("" : "+r"(said));
            return argc > 6 ? door_of_another(argc) : argc > 5 ? the_door(argc) : said[argc] == 'o' ? 0 : 1;
          }
        `,
        "doors": sources.doors + "feature another something else\ndoor another exit ^door_of_another$\n",
      });
      const folder = String(dir);
      for (const plan of ["none", "earlier.plan"]) {
        const { said, table, section, stringAt, exitCodes } = await linked(machine, folder, {
          objects: ["behind", "door", "main", "more"],
          plan,
        });
        expect(said.includes("(laid out by an earlier build's plan)")).toBe(plan !== "none");
        const strings = section("__TEXT,__cstring")!;
        const inStrings = table.islands.filter(
          ({ start }) => strings.address <= start && start < strings.address + strings.size,
        );
        expect(inStrings.map(({ features }) => features)).toEqual(["another", "extra"]);
        expect(stringAt("words that stay")).toBeLessThan(inStrings[0]!.start);
        expect(inStrings[0]!.end).toBe(inStrings[1]!.start);
        expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
        writeFileSync(join(folder, "earlier.plan"), readFileSync(join(folder, "program.plan")));
      }
    });

    test("a section of the interpreter's assembly that is one unit goes whole with the feature that alone names it", async () => {
      using dir = tempDir("islands-macho-layout", {
        ...sources,
        "door.c": doorTo("more"),
        "more.c": `
          int unit_first(int);
          int unit_second(int);
          __asm__(${asCStrings(`.section __TEXT,__jsc_wasm,regular,pure_instructions\n.globl _unit_first, _unit_second\n.p2align 2\n_unit_first:\n${addOne}\n.space 20000\n_unit_second:\n${addOne}\nret\n.text\n`)});
          int more(int x) { return unit_first(x) + unit_second(x); }
        `,
        "main.c": `${start} int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : 0; }`,
      });
      const { canGo, exitCodes } = await linked(machine, String(dir), { objects: ["behind", "door", "more", "main"] });
      expect(["unit_first", "unit_second"].map(canGo)).toEqual([true, true]);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });
  });

  describe("what the executable exports", () => {
    const exporting = {
      ...sources,
      "more.c": `
        ${mixes("only_for_what_is_loaded", 3)}
        __attribute__((noinline)) int for_what_is_loaded(int x) { for (int i = 0; i < 5; i++) x = x * 7 + i; return only_for_what_is_loaded(x); }
        __attribute__((noinline)) int door_of_another(int x) { for (int i = 0; i < 5; i++) x = x * 11 + i; return x; }
      `,
      "doors": sources.doors + "feature other something else\ndoor other exit ^door_of_another$\n",
      "exported.txt": "_main\n_for_what_is_loaded\n_door_of_another\n",
    };
    const objects = ["behind", "door", "table", "more", "main"];
    const names = ["for_what_is_loaded", "only_for_what_is_loaded", "door_of_another", "behind_0"];

    test("stays, where nothing says who can call it", async () => {
      using dir = tempDir("islands-macho-exports", exporting);
      const { canGo, exitCodes } = await linked(machine, String(dir), { objects });
      expect(names.map(canGo)).toEqual([false, false, false, true]);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });

    test("goes with the features that alone can load what calls it; a door of another feature stays", async () => {
      using dir = tempDir("islands-macho-exports", { ...exporting, "doors": exporting.doors + "exported extra\n" });
      const { canGo, exitCodes } = await linked(machine, String(dir), { objects });
      expect(names.map(canGo)).toEqual([true, true, false, true]);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });
  });

  describe("a plan", () => {
    const names = ["behind", `behind_${count - 1}`, "behind_numbers", "table_that_stays", "stays"];

    test("of its own: it links once and lists the same", async () => {
      using dir = tempDir("islands-macho-plan", sources);
      const folder = String(dir);
      const twice = await linked(machine, folder);
      writeFileSync(join(folder, "earlier.plan"), readFileSync(join(folder, "program.plan")));
      const once = await linked(machine, folder, { plan: "earlier.plan" });
      expect(twice.said).toContain("first link");
      expect(once.said).not.toContain("first link");
      expect(once.said).toContain("link by an earlier build's plan");
      expect(once.said).toContain("(laid out by an earlier build's plan)");
      expect(once.table).toEqual(twice.table);
      expect(readFileSync(join(folder, "program.plan"), "utf8")).toBe(
        readFileSync(join(folder, "earlier.plan"), "utf8"),
      );
      expect(names.map(once.canGo)).toEqual([true, true, true, false, false]);
    });

    test("of an earlier build whose functions have since changed: what it misplaces stays or is left outside, and never goes while it is needed", async () => {
      const program = (more: string, main: string) => ({
        ...sources,
        "door.c": doorTo("more"),
        "more.c": more,
        "main.c": `${start} ${main}`,
      });
      const objects = ["behind", "door", "more", "main"];
      using dir = tempDir(
        "islands-macho-plan",
        program(
          `${mixes("now_needed", 3)} ${mixes("renamed", 5)} ${mixes("grown", 7)} int more(int x) { return now_needed(x) + renamed(x) + grown(x); }`,
          `int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : 0; }`,
        ),
      );
      const folder = String(dir);
      const earlier = await linked(machine, folder, { objects });
      expect(["now_needed", "renamed", "grown"].map(earlier.canGo)).toEqual([true, true, true]);
      writeFileSync(join(folder, "earlier.plan"), readFileSync(join(folder, "program.plan")));
      const changed = program(
        `
          ${mixes("now_needed", 3)} ${mixes("has_a_new_name", 5)}
          __attribute__((noinline)) int grown(int x) { for (int i = 0; i < 3; i++) x = x * 7 + i; for (int i = 0; i < 9; i++) x = x * 13 + i; return x ^ 7; }
          int more(int x) { return now_needed(x) + has_a_new_name(x) + grown(x); }
        `,
        `int now_needed(int); int main(int argc, char **argv) { return argc > 5 ? the_door(argc) : now_needed(argc) == 35 ? 0 : 1; }`,
      );
      for (const name of ["more.c", "main.c"] as const) writeFileSync(join(folder, name), changed[name]);
      const later = await linked(machine, folder, { objects, plan: "earlier.plan" });
      expect(later.said).not.toContain("first link");
      expect(later.said).toContain("(laid out by an earlier build's plan)");
      expect(["now_needed", "behind_0", `behind_${count - 1}`].map(later.canGo)).toEqual([false, true, true]);
      expect(later.exitCodes).toEqual({ whole: 0, trimmed: 0 });
      expect(readFileSync(join(folder, "program.plan"), "utf8").split("\n")).toContain("_has_a_new_name");
    });

    test("is the same, and so is every byte, when the same inputs are linked again", async () => {
      using dir = tempDir("islands-macho-plan", sources);
      const folder = String(dir);
      const first = await linked(machine, folder);
      const plan = readFileSync(join(folder, "program.plan"), "utf8");
      const second = await linked(machine, folder);
      expect(second.file.equals(first.file)).toBe(true);
      expect(readFileSync(join(folder, "program.plan"), "utf8")).toBe(plan);
    });

    test("made for other doors is not used", async () => {
      using dir = tempDir("islands-macho-plan", sources);
      const folder = String(dir);
      await linked(machine, folder);
      writeFileSync(join(folder, "earlier.plan"), readFileSync(join(folder, "program.plan")));
      writeFileSync(join(folder, "doors"), sources.doors + "feature other something else\n");
      const { said, canGo } = await linked(machine, folder, { plan: "earlier.plan" });
      expect(said).toContain("the earlier build's plan was made for other doors: this link makes its own");
      expect(said).toContain("first link");
      expect(names.map(canGo)).toEqual([true, true, true, false, false]);
    });

    test("whose table was smaller costs a link and nothing else", async () => {
      using dir = tempDir("islands-macho-plan", sources);
      const folder = String(dir);
      const own = await linked(machine, folder);
      expect(own.said).toMatch(/; the table takes \d+ of 1024 bytes: /);
      expect(own.said).not.toContain("linking again");
      const plan = readFileSync(join(folder, "program.plan"), "utf8");
      expect(plan).toMatch(/\ntable \d+\n/);
      writeFileSync(join(folder, "small.plan"), plan.replace(/\ntable \d+\n/, "\ntable 0\n"));
      const again = await linked(machine, folder, { plan: "small.plan" });
      expect(again.said).toMatch(/the table takes \d+ bytes and there is room for 0: linking again/);
      expect(again.said).toMatch(/; the table takes \d+ of 1024 bytes: /);
      expect(names.map(again.canGo)).toEqual([true, true, true, false, false]);
      expect(again.exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });

    test("that names what stays costs bytes and nothing else", async () => {
      using dir = tempDir("islands-macho-plan", sources);
      const folder = String(dir);
      await linked(machine, folder);
      const plan = readFileSync(join(folder, "program.plan"), "utf8").split("\n");
      plan.splice(plan.indexOf("_behind_5"), 0, "_stays", "_main");
      writeFileSync(join(folder, "wrong.plan"), plan.join("\n"));
      const { said, addressOf, canGo, exitCodes } = await linked(machine, folder, { plan: "wrong.plan" });
      expect(said).toContain("(laid out by an earlier build's plan)");
      expect(addressOf("stays")).toBeGreaterThan(addressOf("behind_4"));
      expect(addressOf("stays")).toBeLessThan(addressOf("behind_5"));
      expect(["stays", "main", "behind_4", "behind_5", `behind_${count - 1}`].map(canGo)).toEqual([
        false,
        false,
        false,
        true,
        true,
      ]);
      expect(exitCodes).toEqual({ whole: 0, trimmed: 0 });
    });
  });
});
