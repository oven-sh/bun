import { constantsIn, decode, decoded, startOfInstruction, walk, type Walked } from "./x64-instructions";

export interface Place {
  name: string;
  address: number;
}

interface Segment {
  offset: number;
  end: number;
  address: number;
  isExecutable: boolean;
}

interface Image {
  file: Uint8Array;
  view: DataView;
  isArm64: boolean;
  segments: Segment[];
  /** The parts of the executable segments that hold instructions and nothing else. */
  code: Segment[];
  isElf: boolean;
  importAt: Map<number, string>;
  stubs: Set<number>;
  ownTables: [number, number][];
}

const jumpSlot = { x64: 7, arm64: 1026 };
const globalData = { x64: 6, arm64: 1025 };
const absolute = { x64: 1, arm64: 257 };
const operandOpcodes = [0x8d, 0x8b, 0xff, 0x3b, 0x39, 0x89];

function signed(value: number, bits: number): number {
  return value >= 2 ** (bits - 1) ? value - 2 ** bits : value;
}

function readMachO(file: Uint8Array): Image {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const u32 = (at: number) => view.getUint32(at, true);
  const u64 = (at: number) => Number(view.getBigUint64(at, true));
  const textAt = (at: number, most: number) => {
    const end = file.indexOf(0, at);
    return Buffer.from(file.subarray(at, end < 0 || end > at + most ? at + most : end)).toString("latin1");
  };
  const image: Image = { file, view, isArm64: u32(4) === 0x0100000c, segments: [], code: [], isElf: false, importAt: new Map(), stubs: new Set(), ownTables: [] };
  const pointers: { address: number; size: number; first: number; each: number; isStub: boolean }[] = [];
  let symbols = 0;
  let strings = 0;
  let indirect = 0;
  for (let index = 0, at = 32; index < u32(16); index++, at += u32(at + 4)) {
    const command = u32(at);
    if (command === 2) [symbols, strings] = [u32(at + 8), u32(at + 16)];
    if (command === 11) indirect = u32(at + 56);
    if (command !== 0x19) continue;
    if (u64(at + 48) > 0) image.segments.push({ offset: u64(at + 40), end: u64(at + 40) + u64(at + 48), address: u64(at + 24), isExecutable: (u32(at + 60) & 4) !== 0 });
    for (let section = at + 72; section < at + 72 + u32(at + 64) * 80; section += 80) {
      const type = u32(section + 64) & 0xff;
      if ((u32(section + 64) & 0x80000400) !== 0) image.code.push({ offset: u32(section + 48), end: u32(section + 48) + u64(section + 40), address: u64(section + 32), isExecutable: true });
      if (type === 6 || type === 7) pointers.push({ address: u64(section + 32), size: u64(section + 40), first: u32(section + 68), each: 8, isStub: false });
      if (type === 8) pointers.push({ address: u64(section + 32), size: u64(section + 40), first: u32(section + 68), each: u32(section + 72), isStub: true });
    }
  }
  for (const { address, size, first, each, isStub } of pointers) {
    for (let index = 0; index * each < size; index++) {
      const symbol = u32(indirect + (first + index) * 4);
      if (symbol >= 0x40000000) continue;
      image.importAt.set(address + index * each, textAt(strings + u32(symbols + symbol * 16), 256).replace(/^_/, ""));
      if (isStub) image.stubs.add(address + index * each);
    }
  }
  return image;
}

const images = new WeakMap<Uint8Array, Image>();
function readImage(file: Uint8Array): Image {
  let image = images.get(file);
  if (!image) {
    const isMachO = new DataView(file.buffer, file.byteOffset, 4).getUint32(0, true) === 0xfeedfacf;
    images.set(file, (image = isMachO ? readMachO(file) : readElf(file)));
  }
  return image;
}

function readElf(file: Uint8Array): Image {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const u64 = (at: number) => Number(view.getBigUint64(at, true));
  const machine = u32(0) === 0x464c457f && file[4] === 2 ? u16(18) : 0;
  if (machine !== 62 && machine !== 183) throw new Error("not a 64-bit ELF file for x86-64 or arm64");
  const isArm64 = machine === 183;
  const kind = isArm64 ? "arm64" : "x64";
  const segments: Segment[] = [];
  let dynamic: [number, number] | undefined;
  for (let index = 0, at = u64(0x20); index < u16(0x38); index++, at += u16(0x36)) {
    if (u32(at) === 1 && u64(at + 32) > 0) segments.push({ offset: u64(at + 8), end: u64(at + 8) + u64(at + 32), address: u64(at + 16), isExecutable: (u32(at + 4) & 1) !== 0 });
    if (u32(at) === 2) dynamic = [u64(at + 8), u64(at + 8) + u64(at + 32)];
  }
  const offsetOf = (address: number) => {
    const segment = segments.find(each => address >= each.address && address < each.address + (each.end - each.offset));
    return segment && segment.offset + (address - segment.address);
  };
  const elf: Image = { file, view, isArm64, segments, code: segments.filter(each => each.isExecutable), isElf: true, importAt: new Map(), stubs: new Set(), ownTables: [] };
  if (!dynamic) return elf;
  const tags = new Map<number, number>();
  for (let at = dynamic[0]; at < dynamic[1]; at += 16) if (!tags.has(u64(at))) tags.set(u64(at), u64(at + 8));
  const symbols = offsetOf(tags.get(6)!)!;
  const strings = offsetOf(tags.get(5)!)!;
  elf.ownTables.push([tags.get(6)!, tags.get(5)! + tags.get(10)!]);
  const nameOf = (symbol: number) => {
    const start = strings + u32(symbols + symbol * 24);
    return Buffer.from(file.subarray(start, file.indexOf(0, start))).toString("latin1");
  };
  for (const [table, size] of [
    [tags.get(23), tags.get(2)],
    [tags.get(7), tags.get(8)],
  ]) {
    if (!table || !size) continue;
    elf.ownTables.push([table, table + size]);
    const start = offsetOf(table)!;
    for (let at = start; at < start + size; at += 24) {
      const type = u32(at + 8);
      const symbol = u32(at + 12);
      if (symbol === 0 || u16(symbols + symbol * 24 + 6) !== 0) continue;
      if (type === jumpSlot[kind] || type === globalData[kind] || type === absolute[kind]) elf.importAt.set(u64(at), nameOf(symbol));
    }
  }
  for (const { offset, end, address, isExecutable } of segments) {
    if (!isExecutable) continue;
    if (isArm64) {
      for (let at = (offset + 3) & ~3; at + 16 <= end; at += 4) {
        const page = u32(at);
        const load = u32(at + 4);
        if ((page & 0x9f00001f) >>> 0 !== 0x90000010 || (load & 0xffc003ff) >>> 0 !== 0xf9400211) continue;
        const here = address + (at - offset);
        const slot = here - (here % 4096) + signed((((page >>> 5) & 0x7ffff) << 2) | ((page >>> 29) & 3), 21) * 4096 + ((load >>> 10) & 0xfff) * 8;
        const name = elf.importAt.get(slot);
        if (name === undefined) continue;
        elf.importAt.set(here, name);
        elf.stubs.add(here);
      }
      continue;
    }
    for (let at = offset; at + 6 <= end; at++) {
      if (file[at] !== 0xff || file[at + 1] !== 0x25 || file[at + 6] !== 0x68 || file[at + 11] !== 0xe9) continue;
      const here = address + (at - offset);
      const name = elf.importAt.get(here + 6 + view.getInt32(at + 2, true));
      if (name === undefined) continue;
      elf.importAt.set(here, name);
      elf.stubs.add(here);
    }
  }
  return elf;
}

function placesIn(elf: Image, wanted: (name: string) => boolean): Place[] {
  const { file, view, importAt, stubs } = elf;
  const places: Place[] = [];
  const targets = [...importAt].filter(([, name]) => wanted(name)).map(([address]) => address);
  if (targets.length === 0) return places;
  const low = Math.min(...targets);
  const high = Math.max(...targets);
  const nameAt = (address: number) => {
    if (address < low || address > high) return undefined;
    const name = importAt.get(address);
    return name !== undefined && wanted(name) ? name : undefined;
  };
  const isInAStub = (address: number) => {
    for (let start = address - (elf.isArm64 ? address % 4 : 0), steps = 0; steps < 16; steps++, start -= elf.isArm64 ? 4 : 1) if (stubs.has(start)) return true;
    return false;
  };
  const isInOwnTable = (address: number) => elf.ownTables.some(([start, end]) => address >= start && address < end);
  const found = (name: string | undefined, address: number) => {
    if (name !== undefined && !isInAStub(address)) places.push({ name, address });
  };
  for (const { offset, end, address, isExecutable } of elf.segments) {
    const base = address - offset;
    if (!isExecutable) {
      for (let at = (offset + 7) & ~7; at + 8 <= end; at += 8) {
        if (view.getUint32(at + 4, true) === 0 && !isInOwnTable(base + at)) found(nameAt(view.getUint32(at, true)), base + at);
      }
      continue;
    }
    if (elf.isArm64) {
      for (let at = (offset + 3) & ~3; at + 4 <= end; at += 4) {
        const word = view.getUint32(at, true);
        const here = base + at;
        if ((word & 0x7c000000) >>> 0 === 0x14000000) found(nameAt(here + signed(word & 0x03ffffff, 26) * 4), here);
        if ((word & 0x1f000000) >>> 0 !== 0x10000000) continue;
        const distance = signed((((word >>> 5) & 0x7ffff) << 2) | ((word >>> 29) & 3), 21);
        if (word >>> 31 === 0) {
          found(nameAt(here + distance), here);
          continue;
        }
        const page = here - (here % 4096) + distance * 4096;
        for (let next = at + 4; next < at + 20 && next + 4 <= end; next += 4) {
          const use = view.getUint32(next, true);
          if (((use >>> 5) & 31) !== (word & 31)) continue;
          if ((use & 0xffc00000) >>> 0 === 0xf9400000) found(nameAt(page + ((use >>> 10) & 0xfff) * 8), here);
          else if ((use & 0xffc00000) >>> 0 === 0x91000000) found(nameAt(page + ((use >>> 10) & 0xfff)), here);
        }
      }
      continue;
    }
    for (let at = offset + 2; at + 4 <= end; at++) {
      const word = view.getInt32(at, true);
      const before = file[at - 1]!;
      const isBranch = before === 0xe8 || before === 0xe9 || (file[at - 2] === 0x0f && (before & 0xf0) === 0x80);
      const isOperand = (before & 0xc7) === 0x05 && operandOpcodes.includes(file[at - 2]!);
      if (isBranch || isOperand) found(nameAt(base + at + 4 + word), base + at);
    }
  }
  return places;
}

export function importsOf(file: Uint8Array): string[] {
  return [...new Set(readImage(file).importAt.values())].sort();
}

export function placesThatCall(file: Uint8Array, names: readonly string[]): Place[] {
  return placesIn(readImage(file), name => names.includes(name));
}

export interface SystemCall {
  /** "unknown": nothing tells which system call it is, so it may be any. */
  number: number | "unknown";
  address: number;
  /** The 32 bytes before the place and the instruction itself, in hexadecimal. */
  bytes: string;
}

function numberLoadedAheadOnArm64({ view }: Image, at: number, start: number, register: number): number | undefined {
  for (let back = at - 4; back >= start && back >= at - 128; back -= 4) {
    const word = view.getUint32(back, true);
    if ((word & 0x7fe0001f) >>> 0 === (0x52800000 | register) >>> 0) return (word >>> 5) & 0xffff;
  }
  return undefined;
}

/**
 * The places that make one of the system calls `numbers`, with a `syscall` or `svc` instruction or through libc's syscall().
 *
 * On x86-64 an instruction can begin at any byte, and the bytes of `syscall` also occur inside other instructions. So the code is decoded from
 * its first byte, only a `syscall` that begins an instruction counts, and its number is what reaches rax (rdi for libc's function) along every path.
 */
export function placesThatMakeSystemCalls(file: Uint8Array, numbers: readonly number[]): SystemCall[] {
  const image = readImage(file);
  const places: SystemCall[] = [];
  const throughLibc = placesIn(image, name => name === "syscall");
  for (const { offset, end, address } of image.code) {
    const addressOf = (at: number) => address + (at - offset);
    const add = (found: readonly (number | "unknown")[], at: number, length: number) => {
      const bytes = Buffer.from(file.subarray(Math.max(offset, at - 32), at + length)).toString("hex");
      for (const number of found)
        if (number === "unknown" || numbers.includes(number)) places.push({ number, address: addressOf(at), bytes });
    };
    const calls = throughLibc.map(place => place.address - address + offset).filter(at => at >= offset && at < end);
    if (image.isArm64) {
      for (const at of calls) add([numberLoadedAheadOnArm64(image, at, offset, 0) ?? -1], at, 4);
      for (let at = (offset + 3) & ~3; at + 4 <= end; at += 4)
        if ((image.view.getUint32(at, true) & 0xffe0001f) >>> 0 === 0xd4000001)
          add([numberLoadedAheadOnArm64(image, at, offset, 8) ?? -1], at, 4);
      continue;
    }
    const walked = walk(file, image.view, offset, end);
    // The numbers are Linux's.
    const undecided = image.isElf ? (["unknown"] as const) : [];
    for (const at of walked.systemCalls) add(constantsIn(file, image.view, walked, 0, at) ?? undecided, at, 2);
    for (const at of walked.doubtful) add(undecided, at, 2);
    for (const at of calls) add(numbersPassedToLibc(file, image.view, walked, at) ?? undecided, at, 4);
  }
  return places;
}

/** `at`: four bytes that lead to libc's syscall(). Returns nothing if they are not the operand of an instruction, and undefined if the number cannot be told. */
function numbersPassedToLibc(file: Uint8Array, view: DataView, walked: Walked, at: number): number[] | undefined {
  const start = startOfInstruction(walked, at);
  if (start < 0 || start + decode(file, start, walked.end) <= at) return [];
  const { map, opcode, modrm, immediate, isRelative } = decoded;
  if (isRelative) return immediate === at ? constantsIn(file, view, walked, 7, start) : [];
  if (modrm + 1 !== at || (file[modrm]! & 0xc7) !== 0x05) return [];
  // call or jmp through the pointer. Anything else takes the address of the function, or the pointer, for later.
  const isCallOrJump = map === 0 && opcode === 0xff && [2, 4].includes((file[modrm]! >> 3) & 7);
  return isCallOrJump ? constantsIn(file, view, walked, 7, start) : undefined;
}
