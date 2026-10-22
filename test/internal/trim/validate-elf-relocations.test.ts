import { describe, expect, spyOn, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

import { BuildError } from "../../../scripts/build/error.ts";
import { createSectionGraph, findEdge } from "../../../scripts/build/trim/graph.ts";
import type { Link, LinkName } from "../../../scripts/build/trim/linker.ts";
import { EdgeKind, type Partition } from "../../../scripts/build/trim/partition.ts";
import type { RemovableRange } from "../../../scripts/build/trim/ranges.ts";
import type { EdgeStrength, FeatureEdge } from "../../../scripts/build/trim/types.ts";
import {
  checkElfRelocations,
  ReferenceClassifier,
  validateElfRelocations,
  type ReferenceVerdict,
  type RelocationCheck,
  type RelocationFailure,
  type RelocationInput,
} from "../../../scripts/build/trim/validate-elf-relocations.ts";

const placedSections = [
  { name: "guard", address: 0x1000, size: 0x800, output: ".text" },
  { name: "caller", address: 0x1800, size: 0x800, output: ".text" },
  { name: "entry", address: 0x2000, size: 0x40, output: ".text" },
  { name: "body", address: 0x2040, size: 0xfb0, output: ".text" },
  { name: "other", address: 0x3000, size: 0x1000, output: ".text" },
  { name: "table", address: 0x5000, size: 0x40, output: ".rodata" },
];
const [guard, caller, entry, body, other, table] = [0, 1, 2, 3, 4, 5];

const successors: Set<number>[] = placedSections.map(() => new Set());
successors[guard]!.add(entry);
successors[caller]!.add(body);
successors[table]!.add(entry);

const graph = createSectionGraph({
  format: "elf",
  isArm64: false,
  placedCount: placedSections.length,
  address: placedSections.map(section => section.address),
  size: placedSections.map(section => section.size),
  alignment: placedSections.map(() => 16),
  output: placedSections.map(section => section.output),
  object: placedSections.map(() => "toy.o"),
  section: placedSections.map(section => `${section.output}.${section.name}`),
  successors,
  roots: new Set(),
  exported: new Set(),
  liveWithoutReference: new Set(),
  names: placedSections.map(section => [section.name]),
  aliases: new Map(),
  externalNames: new Set(),
  stringHash: new Map(),
});

const [A, B, C, Bit31, Tools, Unrelated] = [0, 1, 2, 31, 128, 200];
const [rangeSet, referrerSet, joinedSet] = [1, 2, 3];

interface FeatureSets {
  range?: number[];
  referrer?: number[];
  requires?: [feature: number, required: number][];
  guards?: [feature: number, entered: number, strength: Exclude<EdgeStrength, "Reference">, isFollowed: boolean][];
  tableEdge?: number;
}

function partitionOf({ range = [A], referrer = [B], requires = [], guards = [], tableEdge = EdgeKind.Ordinary }: FeatureSets = {}): Partition {
  const edgeKind = new Uint8Array(graph.successors.length);
  edgeKind[findEdge(graph, guard, entry)] = EdgeKind.Guarded;
  edgeKind[findEdge(graph, table, entry)] = tableEdge;
  const edges: FeatureEdge[] = [
    ...requires.map(([from, to]): FeatureEdge => ({ from, to, strength: "Reference", isFollowed: true })),
    ...guards.map(([from, to, strength, isFollowed]): FeatureEdge => ({ from, to, strength, isFollowed })),
  ];
  return {
    isRetained: Uint8Array.of(1, 1, 0, 0, 0, 1),
    exactSetOf: Uint32Array.of(0, 0, rangeSet, rangeSet, referrerSet, 0),
    setOf: Uint32Array.of(0, 0, rangeSet, rangeSet, joinedSet, 0),
    sets: [[], range, referrer, [...referrer, Unrelated]],
    edgeKind,
    edges,
  } as Partition;
}

const rangeOf = (start: number, end: number, set: number): RemovableRange => ({
  start,
  end,
  set,
  isCode: true,
  canBeCut: true,
  canBeFilled: true,
});
const entryAndBody = rangeOf(0x2000, 0x3000, rangeSet);
const otherRange = rangeOf(0x3000, 0x4000, referrerSet);

const classifierOf = (sets: FeatureSets = {}, ranges: RemovableRange[] = [entryAndBody]) =>
  new ReferenceClassifier({ graph, partition: partitionOf(sets), ranges });

type IntervalCase = [name: string, first: number, last: number, isSectionSymbol: boolean, verdict: ReferenceVerdict];

describe("a reference from retained code", () => {
  const cases: IntervalCase[] = [
    ["to a named symbol on a range's first byte", 0x2000, 0x2000, false, "Illegal"],
    ["to a section symbol plus addend on a range's first byte", 0x2000, 0x2000, true, "Ambiguous"],
    ["to a range's second byte", 0x2001, 0x2001, true, "Illegal"],
    ["to a range's last byte", 0x2fff, 0x2fff, true, "Illegal"],
    ["to an interval inside a range", 0x2800, 0x2804, true, "Illegal"],
    ["to an interval across a range's start", 0x1ffe, 0x2002, true, "Ambiguous"],
    ["to an interval across a range's end", 0x2ffc, 0x3000, true, "Ambiguous"],
    ["to an interval that contains a range", 0x1000, 0x4000, true, "Ambiguous"],
    ["to an interval that ends before a range", 0x1ff8, 0x1fff, true, "Legal"],
    ["to an interval that starts at a range's end", 0x3000, 0x3004, true, "Legal"],
  ];
  test.each(cases)("%s", (_, first, last, isSectionSymbol, verdict) => {
    expect(classifierOf().classify(caller, first, last, isSectionSymbol)).toBe(verdict);
  });

  test("is illegal even when the graph has an ordinary edge for it", () => {
    expect(findEdge(graph, caller, body)).toBeGreaterThanOrEqual(0);
    expect(classifierOf().classify(caller, 0x2040, 0x2040, false)).toBe("Illegal");
  });

  test("is legal when there are no ranges", () => {
    const classifier = classifierOf({}, []);
    expect(classifier.overlapsRange(0, 0x10000)).toBe(false);
    expect(classifier.classify(caller, 0x2800, 0x2804, true)).toBe("Legal");
  });
});

describe("a guard's reference to its entry point", () => {
  const cases: IntervalCase[] = [
    ["by name", 0x2000, 0x2000, false, "Legal"],
    ["by section symbol", 0x2000, 0x2004, true, "Legal"],
    ["from before the range", 0x1ffe, 0x2002, true, "Legal"],
    ["up to the entry point's last byte", 0x203c, 0x203f, true, "Legal"],
    ["across the entry point's end", 0x203e, 0x2042, true, "Ambiguous"],
    ["past the entry point's end", 0x2040, 0x2044, true, "Illegal"],
  ];
  test.each(cases)("%s", (_, first, last, isSectionSymbol, verdict) => {
    expect(classifierOf().classify(guard, first, last, isSectionSymbol)).toBe(verdict);
  });

  test("permits no other referrer", () => {
    const classifier = classifierOf();
    expect(classifier.classify(caller, 0x2000, 0x2000, false)).toBe("Illegal");
    expect(classifier.classify(caller, 0x203c, 0x203f, true)).toBe("Illegal");
    expect(classifier.classify(caller, 0x203e, 0x2042, true)).toBe("Illegal");
  });
});

describe("the address of a function in a static table", () => {
  const withSoftEdge = () => classifierOf({ tableEdge: EdgeKind.Soft });
  const cases: IntervalCase[] = [
    ["by name", 0x2000, 0x2000, false, "Legal"],
    ["by section symbol", 0x2000, 0x2000, true, "Legal"],
    ["up to the function's last byte", 0x203c, 0x203f, true, "Legal"],
    ["across the function's end", 0x203e, 0x2042, true, "Ambiguous"],
    ["past the function's end", 0x2040, 0x2044, true, "Illegal"],
  ];
  test.each(cases)("%s", (_, first, last, isSectionSymbol, verdict) => {
    expect(withSoftEdge().classify(table, first, last, isSectionSymbol)).toBe(verdict);
  });

  test("permits no other referrer", () => {
    expect(withSoftEdge().classify(caller, 0x2000, 0x2000, false)).toBe("Illegal");
    expect(withSoftEdge().classify(other, 0x2000, 0x2000, false)).toBe("Illegal");
  });

  test("is illegal while the edge is an ordinary one", () => {
    expect(classifierOf().classify(table, 0x2000, 0x2000, false)).toBe("Illegal");
    expect(classifierOf({ tableEdge: EdgeKind.Unguarded }).classify(table, 0x2000, 0x2000, false)).toBe("Illegal");
  });
});

describe("a reference from removable code", () => {
  const cases: [name: string, sets: FeatureSets, verdict: ReferenceVerdict][] = [
    ["of the range's feature", { referrer: [A] }, "Legal"],
    ["whose feature requires the range's", { requires: [[B, A]] }, "Legal"],
    [
      "whose feature requires the range's through another",
      {
        requires: [
          [B, C],
          [C, A],
        ],
      },
      "Legal",
    ],
    ["whose feature requires one of the range's two", { range: [A, C], requires: [[B, C]] }, "Legal"],
    [
      "whose features all require the range's",
      {
        referrer: [B, C],
        requires: [
          [B, A],
          [C, A],
        ],
      },
      "Legal",
    ],
    ["that no feature retains", { referrer: [] }, "Legal"],
    ["whose feature requires bit 31 of a word", { range: [Bit31], requires: [[B, Bit31]] }, "Legal"],
    [
      "whose feature requires one in another word",
      {
        range: [Tools],
        requires: [
          [B, Bit31],
          [Bit31, Tools],
        ],
      },
      "Legal",
    ],
    ["whose feature requires nothing", {}, "Illegal"],
    ["whose feature enters the range's through a guard that aborts", { guards: [[B, A, "AbortingGuard", true]] }, "Illegal"],
    ["whose feature enters the range's through a guard that recovers", { guards: [[B, A, "RecoverableGuard", true]] }, "Illegal"],
    ["whose feature enters the range's through a guard that is not followed", { guards: [[B, A, "RecoverableGuard", false]] }, "Illegal"],
    ["whose feature requires one that only enters the range's through a guard", { requires: [[B, C]], guards: [[C, A, "AbortingGuard", true]] }, "Illegal"],
    ["whose feature is required by the range's", { requires: [[A, B]] }, "Illegal"],
    ["with one feature that does not require the range's", { referrer: [B, C], requires: [[B, A]] }, "Illegal"],
    [
      "whose features require only each other",
      {
        requires: [
          [B, C],
          [C, B],
        ],
      },
      "Illegal",
    ],
  ];
  test.each(cases)("%s", (_, sets, verdict) => {
    expect(classifierOf(sets).classify(other, 0x2800, 0x2804, true)).toBe(verdict);
  });
});

describe("an interval over two ranges", () => {
  const ranges = [entryAndBody, otherRange];

  test("is legal when it is legal in both", () => {
    expect(classifierOf({ requires: [[B, A]] }, ranges).classify(other, 0x2ffc, 0x3004, true)).toBe("Legal");
  });

  test("is ambiguous when it is illegal in either", () => {
    expect(classifierOf({}, ranges).classify(other, 0x2ffc, 0x3004, true)).toBe("Ambiguous");
    expect(classifierOf({}, ranges).classify(caller, 0x2ffc, 0x3004, true)).toBe("Ambiguous");
  });
});

describe("the range list", () => {
  test("has exclusive ends", () => {
    const classifier = classifierOf();
    const found = [0x1fff, 0x2000, 0x2fff, 0x3000].map(address => classifier.rangeAt(address));
    expect(found).toEqual([undefined, entryAndBody, entryAndBody, undefined]);
    expect(classifier.overlapsRange(0x1ff0, 0x1fff)).toBe(false);
    expect(classifier.overlapsRange(0x1ff0, 0x2000)).toBe(true);
    expect(classifier.overlapsRange(0x2fff, 0x3010)).toBe(true);
    expect(classifier.overlapsRange(0x3000, 0x3010)).toBe(false);
  });

  test("may have ranges that abut", () => {
    const classifier = classifierOf({}, [entryAndBody, otherRange]);
    expect(classifier.rangeAt(0x2fff)).toBe(entryAndBody);
    expect(classifier.rangeAt(0x3000)).toBe(otherRange);
  });

  const invalidLists: [name: string, ranges: RemovableRange[]][] = [
    ["overlapping ranges", [entryAndBody, rangeOf(0x2800, 0x3800, referrerSet)]],
    ["descending ranges", [otherRange, entryAndBody]],
    ["a range that ends before it starts", [rangeOf(0x3000, 0x2000, rangeSet)]],
  ];
  test.each(invalidLists)("fails the build with %s", (_, ranges) => {
    expect(() => classifierOf({}, ranges)).toThrow(BuildError);
  });
});

const Machine = { I386: 3, X86_64: 62, AArch64: 183 };
const SectionType = {
  Null: 0,
  ProgramBits: 1,
  SymbolTable: 2,
  StringTable: 3,
  Rela: 4,
  Note: 7,
  NoBits: 8,
  Rel: 9,
  Crel: 0x40000014,
};
const SectionFlag = { Alloc: 2, ExecInstr: 4, Tls: 0x400 };
const SymbolType = { None: 0, Function: 2, Section: 3, Tls: 6 };
const globalBinding = 1 << 4;
const absoluteSectionIndex = 0xfff1;
const X86 = {
  None: 0,
  Abs64: 1,
  Pc32: 2,
  Plt32: 4,
  DtpMod64: 16,
  TpOff32: 23,
  Pc64: 24,
  GotOff64: 25,
  Size32: 32,
  TlsDesc: 36,
};
const Arm64 = { Prel32: 261, Call26: 283 };

interface ElfSection {
  name: string;
  type: number;
  flags?: number;
  address?: number;
  relocatedSection?: string;
  bytes: Buffer;
}

function elfOf(machine: number, sections: ElfSection[]): Buffer {
  const listed: ElfSection[] = [
    { name: "", type: SectionType.Null, bytes: Buffer.alloc(0) },
    ...sections,
    { name: ".shstrtab", type: SectionType.StringTable, bytes: Buffer.alloc(0) },
  ];
  const nameOffsets: number[] = [];
  let names = "";
  for (const { name } of listed) {
    nameOffsets.push(names.length);
    names += name + "\0";
  }
  listed.at(-1)!.bytes = Buffer.from(names, "latin1");
  const indexOfName = new Map(listed.map(({ name }, index) => [name, index]));

  const header = Buffer.alloc(64);
  const headers = Buffer.alloc(64 * listed.length);
  let offset = header.length;
  listed.forEach((section, index) => {
    const at = 64 * index;
    headers.writeUInt32LE(nameOffsets[index]!, at);
    headers.writeUInt32LE(section.type, at + 4);
    headers.writeBigUInt64LE(BigInt(section.flags ?? 0), at + 8);
    headers.writeBigUInt64LE(BigInt(section.address ?? 0), at + 16);
    headers.writeBigUInt64LE(BigInt(offset), at + 24);
    headers.writeBigUInt64LE(BigInt(section.bytes.length), at + 32);
    headers.writeUInt32LE(indexOfName.get(section.relocatedSection ?? "")!, at + 44);
    offset += section.bytes.length;
  });
  header.writeUInt32BE(0x7f454c46, 0);
  header.writeUInt16LE(machine, 0x12);
  header.writeBigUInt64LE(BigInt(offset), 0x28);
  header.writeUInt16LE(listed.length, 0x3c);
  header.writeUInt16LE(listed.length - 1, 0x3e);
  return Buffer.concat([header, ...listed.map(section => section.bytes), headers]);
}

const symbolNames = [
  "none",
  "text",
  "threadData",
  "caller",
  "entry",
  "body",
  "undefined",
  "absolute",
  "threadLocal",
] as const;
type SymbolName = (typeof symbolNames)[number];

function relocation(address: number, type: number, symbolName: SymbolName, addend = 0): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.writeBigUInt64LE(BigInt(address), 0);
  bytes.writeUInt32LE(type, 8);
  bytes.writeUInt32LE(symbolNames.indexOf(symbolName), 12);
  bytes.writeBigInt64LE(BigInt(addend), 16);
  return bytes;
}

function symbol(info: number, sectionIndex: number, value: number): Buffer {
  const bytes = Buffer.alloc(24);
  bytes[4] = info;
  bytes.writeUInt16LE(sectionIndex, 6);
  bytes.writeBigUInt64LE(BigInt(value), 8);
  return bytes;
}

const { Alloc, ExecInstr, Tls } = SectionFlag;
const textStart = 0x1000;
const pointerIntoRange = relocation(0x1810, X86.Abs64, "text", 0x2800 - textStart);
const sections: ElfSection[] = [
  {
    name: ".text",
    type: SectionType.ProgramBits,
    flags: Alloc | ExecInstr,
    address: textStart,
    bytes: Buffer.alloc(0x3000),
  },
  { name: ".rodata", type: SectionType.ProgramBits, flags: Alloc, address: 0x5000, bytes: Buffer.alloc(0x40) },
  { name: ".eh_frame", type: SectionType.ProgramBits, flags: Alloc, address: 0x6000, bytes: Buffer.alloc(0x40) },
  { name: ".tdata", type: SectionType.ProgramBits, flags: Alloc | Tls, address: 0x7000, bytes: Buffer.alloc(8) },
  {
    name: ".rela.dyn",
    type: SectionType.Rela,
    flags: Alloc,
    address: 0x7100,
    relocatedSection: ".text",
    bytes: pointerIntoRange,
  },
  { name: ".note.gnu.build-id", type: SectionType.Note, flags: Alloc, address: 0x7200, bytes: Buffer.alloc(16) },
  { name: ".bun_trim", type: SectionType.ProgramBits, flags: Alloc, address: 0x8000, bytes: Buffer.alloc(16) },
  { name: ".bss", type: SectionType.NoBits, flags: Alloc, address: 0x9000, bytes: Buffer.alloc(8) },
  { name: ".debug_info", type: SectionType.ProgramBits, bytes: Buffer.alloc(16) },
];
const sectionIndex = (name: string) => 1 + sections.findIndex(section => section.name === name);

const functionAt = (address: number) => symbol(globalBinding | SymbolType.Function, sectionIndex(".text"), address);
const symbols: Record<SymbolName, Buffer> = {
  none: symbol(SymbolType.None, 0, 0),
  text: symbol(SymbolType.Section, sectionIndex(".text"), textStart),
  threadData: symbol(SymbolType.Section, sectionIndex(".tdata"), 0x7000),
  caller: functionAt(0x1800),
  entry: functionAt(0x2000),
  body: functionAt(0x2040),
  undefined: symbol(globalBinding, 0, 0x2800),
  absolute: symbol(globalBinding, absoluteSectionIndex, 0x2800),
  threadLocal: symbol(globalBinding | SymbolType.Tls, sectionIndex(".tdata"), 0x2800),
};
const symbolTable: ElfSection = {
  name: ".symtab",
  type: SectionType.SymbolTable,
  bytes: Buffer.concat(symbolNames.map(name => symbols[name])),
};

const relocationsOf = (target: string, entries: Buffer[], type = SectionType.Rela): ElfSection => ({
  name: `.rela${target}`,
  type,
  relocatedSection: target,
  bytes: Buffer.concat(entries),
});
const relinkedOf = (relocationSections: ElfSection[], machine = Machine.X86_64) =>
  elfOf(machine, [...sections, symbolTable, ...relocationSections]);

function withLinks<T>(shipped: Buffer, relinked: Buffer, run: (input: RelocationInput) => T): T {
  using dir = tempDir("trim-elf-relocations", { shipped, relinked });
  const linkOf = (name: LinkName, file: string): Link => ({
    name,
    executable: join(String(dir), file),
    map: "",
    log: "",
  });
  return run({
    shipped: linkOf("second", "shipped"),
    withRelocations: linkOf("relocations", "relinked"),
    graph,
    partition: partitionOf(),
    ranges: [entryAndBody],
  });
}

const check = (relocationSections: ElfSection[], machine = Machine.X86_64): RelocationCheck =>
  withLinks(elfOf(machine, sections), relinkedOf(relocationSections, machine), checkElfRelocations);

const counts = (relocations: number, intoRanges = 0, ambiguous = 0, fieldsOutsideGraph = 0) => ({
  relocations,
  intoRanges,
  ambiguous,
  fieldsOutsideGraph,
});
const referenceInto = (from: number, address: number, to: number | undefined): RelocationFailure => ({
  kind: "ReferenceIntoRemovableRange",
  from,
  address,
  to,
  range: entryAndBody,
});
const callTo = (target: number) => target - textStart - 4;
const withinRetainedCode = relocation(0x1810, X86.Pc32, "text", callTo(0x1004));

describe("relocations in code", () => {
  test("report a call from retained code into a range", () => {
    const call = relocation(0x1810, X86.Plt32, "text", callTo(0x2800));
    expect(check([relocationsOf(".text", [call])])).toEqual({
      failures: [referenceInto(caller, 0x1810, body)],
      ...counts(1, 1),
    });
  });

  test("report each pair of sections once", () => {
    const calls = [
      relocation(0x1810, X86.Plt32, "text", callTo(0x2800)),
      relocation(0x1820, X86.Plt32, "text", callTo(0x2900)),
      relocation(0x1830, X86.Plt32, "body", -4),
      relocation(0x1010, X86.Plt32, "body", -4),
    ];
    expect(check([relocationsOf(".text", calls)])).toEqual({
      failures: [referenceInto(caller, 0x1810, body), referenceInto(guard, 0x1010, body)],
      ...counts(4, 4),
    });
  });

  test("accept a guard's call to its entry point", () => {
    const calls = [relocation(0x1010, X86.Plt32, "entry", -4), relocation(0x1020, X86.Pc32, "text", callTo(0x2000))];
    expect(check([relocationsOf(".text", calls)])).toEqual({ failures: [], ...counts(2, 2) });
  });

  test("count a target within 4 bytes of a range's start as ambiguous", () => {
    const call = relocation(0x1810, X86.Pc32, "text", callTo(0x1ffe));
    expect(check([relocationsOf(".text", [call])])).toEqual({ failures: [], ...counts(1, 1, 1) });
  });

  test("have one candidate target in a 64-bit field", () => {
    const fieldTo = (target: number) => relocation(0x1810, X86.Pc64, "text", target - textStart - 8);
    expect(check([relocationsOf(".text", [fieldTo(0x1ffe)])])).toEqual({ failures: [], ...counts(1) });
    expect(check([relocationsOf(".text", [fieldTo(0x2800)])])).toEqual({
      failures: [referenceInto(caller, 0x1810, body)],
      ...counts(1, 1),
    });
  });

  test("ignore the addend of a named symbol", () => {
    const call = relocation(0x1010, X86.Plt32, "caller", 0x1000);
    expect(check([relocationsOf(".text", [call])])).toEqual({ failures: [], ...counts(1) });
  });
});

describe("relocations in data", () => {
  const labelDifferenceAddend = (field: number, base: number, target: number) => target + (field - base) - textStart;

  test("report a pointer from retained data into a range", () => {
    const pointer = relocation(0x5010, X86.Abs64, "text", 0x2800 - textStart);
    expect(check([relocationsOf(".rodata", [pointer])])).toEqual({
      failures: [referenceInto(table, 0x5010, body)],
      ...counts(1, 1),
    });
  });

  test("report a pointer to padding inside a range without a target section", () => {
    const pointer = relocation(0x5010, X86.Abs64, "text", 0x2ff8 - textStart);
    expect(check([relocationsOf(".rodata", [pointer])])).toEqual({
      failures: [referenceInto(table, 0x5010, undefined)],
      ...counts(1, 1),
    });
  });

  test("count a pointer to a range's first byte as ambiguous", () => {
    const pointer = relocation(0x5010, X86.Abs64, "text", 0x2000 - textStart);
    expect(check([relocationsOf(".rodata", [pointer])])).toEqual({ failures: [], ...counts(1, 1, 1) });
  });

  test("do not report a jump table entry whose addend alone lies in a range", () => {
    const addend = labelDifferenceAddend(0x5008, 0x5000, 0x1ffc);
    expect(textStart + addend).toBe(0x2004);
    const tableEntry = relocation(0x5008, X86.Pc32, "text", addend);
    expect(check([relocationsOf(".rodata", [tableEntry])])).toEqual({ failures: [], ...counts(1, 1, 1) });
  });

  test("report a jump table entry that lies in a range for every base label", () => {
    const tableEntry = relocation(0x5008, X86.Pc32, "text", labelDifferenceAddend(0x5008, 0x5000, 0x2800));
    expect(check([relocationsOf(".rodata", [tableEntry])])).toEqual({
      failures: [referenceInto(table, 0x5008, body)],
      ...counts(1, 1),
    });
  });

  test("count a field in a section outside the graph", () => {
    const field = relocation(0x6008, X86.Pc32, "text", 0x2800 - textStart);
    expect(check([relocationsOf(".eh_frame", [field])])).toEqual({ failures: [], ...counts(1, 1, 0, 1) });
  });
});

describe("relocations that name no address", () => {
  test("are skipped by type", () => {
    const types = [X86.None, X86.DtpMod64, X86.TpOff32, X86.Size32, X86.TlsDesc];
    const entries = types.map(type => relocation(0x1810, type, "text", 0x2800 - textStart));
    expect(check([relocationsOf(".text", entries)])).toEqual({ failures: [], ...counts(types.length) });
  });

  test("are skipped by symbol", () => {
    const names: SymbolName[] = ["none", "undefined", "absolute", "threadLocal", "threadData"];
    const entries = names.map(name => relocation(0x5010, X86.Abs64, name, 0x2800 - 0x7000));
    expect(check([relocationsOf(".rodata", entries)])).toEqual({ failures: [], ...counts(names.length) });
  });
});

test("dynamic relocations and relocations of debug information are not read", () => {
  expect(check([relocationsOf(".text", [pointerIntoRange])]).failures).toEqual([referenceInto(caller, 0x1810, body)]);
  const relocationSections = [
    relocationsOf(".debug_info", [pointerIntoRange]),
    relocationsOf(".text", [withinRetainedCode]),
  ];
  expect(check(relocationSections)).toEqual({ failures: [], ...counts(1) });
});

test("an unknown relocation type is reported once per section, whatever its symbol", () => {
  const relocationSections = [
    relocationsOf(".rodata", [relocation(0x5010, X86.GotOff64, "text"), relocation(0x5018, X86.GotOff64, "none")]),
    relocationsOf(".text", [relocation(0x1810, X86.GotOff64, "text")]),
  ];
  expect(check(relocationSections)).toEqual({
    failures: [
      { kind: "UnknownRelocationType", section: ".rela.rodata", type: X86.GotOff64 },
      { kind: "UnknownRelocationType", section: ".rela.text", type: X86.GotOff64 },
    ],
    ...counts(3),
  });
});

describe("on AArch64", () => {
  const checkArm64 = (target: string, entry: Buffer) => check([relocationsOf(target, [entry])], Machine.AArch64);

  test("a branch has an exact addend", () => {
    expect(checkArm64(".text", relocation(0x1810, Arm64.Call26, "text", 0x2800 - textStart))).toEqual({
      failures: [referenceInto(caller, 0x1810, body)],
      ...counts(1, 1),
    });
    expect(checkArm64(".text", relocation(0x1810, Arm64.Call26, "text", 0x1ffc - textStart))).toEqual({
      failures: [],
      ...counts(1),
    });
  });

  test("a jump table entry has an unknown base label", () => {
    expect(checkArm64(".rodata", relocation(0x5008, Arm64.Prel32, "text", 0x2004 - textStart))).toEqual({
      failures: [],
      ...counts(1, 1, 1),
    });
    expect(checkArm64(".rodata", relocation(0x5008, Arm64.Prel32, "text", 0x2808 - textStart))).toEqual({
      failures: [referenceInto(table, 0x5008, body)],
      ...counts(1, 1),
    });
  });

  test("the x86-64 types are unknown", () => {
    expect(checkArm64(".rodata", relocation(0x5010, X86.Abs64, "text")).failures).toEqual([
      { kind: "UnknownRelocationType", section: ".rela.rodata", type: X86.Abs64 },
    ]);
  });
});

describe("the two links", () => {
  const relinked = relinkedOf([relocationsOf(".text", [withinRetainedCode])]);
  const checkShipped = (shippedSections: ElfSection[]) =>
    withLinks(elfOf(Machine.X86_64, shippedSections), relinked, checkElfRelocations);
  const replaced = (name: string, change: (section: ElfSection) => Partial<ElfSection>) =>
    sections.map(section => (section.name === name ? { ...section, ...change(section) } : section));
  const withChangedByte = (name: string) =>
    replaced(name, ({ bytes }) => ({ bytes: Buffer.from(bytes).fill(bytes[0]! ^ 1, 0, 1) }));
  const differsIn = (section: string): RelocationCheck => ({ failures: [{ kind: "RelinkedImageDiffers", section }], ...counts(0) });

  test.each([".text", ".rodata", ".rela.dyn"])("must have the same bytes in %s", name => {
    expect(checkShipped(withChangedByte(name))).toEqual(differsIn(name));
  });

  test.each([".bun_trim", ".note.gnu.build-id", ".bss", ".debug_info"])("may differ in the bytes of %s", name => {
    expect(checkShipped(withChangedByte(name))).toEqual({ failures: [], ...counts(1) });
  });

  test("must give each section the same address, size and type", () => {
    expect(checkShipped(replaced(".rodata", () => ({ address: 0x5008 })))).toEqual(differsIn(".rodata"));
    expect(checkShipped(replaced(".bun_trim", () => ({ bytes: Buffer.alloc(24) })))).toEqual(differsIn(".bun_trim"));
    expect(checkShipped(replaced(".bss", () => ({ type: SectionType.ProgramBits })))).toEqual(differsIn(".bss"));
  });

  test("must have the same number of allocated sections", () => {
    const extra: ElfSection = {
      name: ".extra",
      type: SectionType.ProgramBits,
      flags: Alloc,
      address: 0xa000,
      bytes: Buffer.alloc(8),
    };
    expect(checkShipped([...sections, extra])).toEqual(differsIn(".extra"));
    const longerRelinked = elfOf(Machine.X86_64, [...sections, extra, symbolTable]);
    expect(withLinks(elfOf(Machine.X86_64, sections), longerRelinked, checkElfRelocations)).toEqual(
      differsIn(".extra"),
    );
  });
});

describe("the build fails", () => {
  const valid = relocationsOf(".text", [withinRetainedCode]);
  const shipped = elfOf(Machine.X86_64, sections);
  const pastSymbolTable = Buffer.from(withinRetainedCode);
  pastSymbolTable.writeUInt32LE(symbolNames.length, 12);

  const cases: [name: string, run: () => unknown, message: string][] = [
    [
      "when the shipped file is not ELF",
      () => withLinks(Buffer.from("text"), relinkedOf([valid]), checkElfRelocations),
      "shipped is not an ELF file",
    ],
    [
      "when the relinked file is not ELF",
      () => withLinks(shipped, Buffer.from("text"), checkElfRelocations),
      "relinked is not an ELF file",
    ],
    ["for a machine without rules", () => check([valid], Machine.I386), "no relocation rules for machine 3"],
    [
      "without a symbol table",
      () => withLinks(shipped, elfOf(Machine.X86_64, [...sections, valid]), checkElfRelocations),
      "has no symbol table",
    ],
    ["without relocations", () => check([]), "has no relocations"],
    [
      "with relocations for debug information only",
      () => check([relocationsOf(".debug_info", [withinRetainedCode])]),
      "has no relocations",
    ],
    [
      "for relocations without addends",
      () => check([relocationsOf(".text", [withinRetainedCode], SectionType.Rel)]),
      "is not in RELA format",
    ],
    [
      "for compact relocations",
      () => check([relocationsOf(".text", [withinRetainedCode], SectionType.Crel)]),
      "is not in RELA format",
    ],
    [
      "for a truncated relocation section",
      () => check([relocationsOf(".text", [withinRetainedCode.subarray(0, 20)])]),
      "is not a multiple of 24",
    ],
    [
      "for a symbol index past the symbol table",
      () => check([relocationsOf(".text", [pastSymbolTable])]),
      "past the symbol table's end",
    ],
  ];
  test.each(cases)("%s", (_, run, message) => {
    expect(run).toThrow(BuildError);
    expect(run).toThrow(message);
  });
});

test("validateElfRelocations prints the counts and returns the failures", () => {
  const relinked = relinkedOf([
    relocationsOf(".text", [relocation(0x1810, X86.Plt32, "text", callTo(0x2800))]),
    relocationsOf(".eh_frame", [relocation(0x6008, X86.Pc32, "text", 0x2800 - textStart)]),
  ]);
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const failures = withLinks(elfOf(Machine.X86_64, sections), relinked, validateElfRelocations);
    expect(failures).toEqual([referenceInto(caller, 0x1810, body)]);
    expect(log.mock.calls).toEqual([
      ["2 relocations from the linker: 2 into removable ranges, 0 ambiguous, 1 in sections outside the graph"],
    ]);
  } finally {
    log.mockRestore();
  }
});
