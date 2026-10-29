export interface Place {
  name: string;
  address: number;
  // The bytes around it, for whoever reads a failure without the executable at hand.
  code: string;
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
  const image: Image = { file, view, isArm64: u32(4) === 0x0100000c, segments: [], importAt: new Map(), stubs: new Set(), ownTables: [] };
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

function readImage(file: Uint8Array): Image {
  return new DataView(file.buffer, file.byteOffset, 4).getUint32(0, true) === 0xfeedfacf ? readMachO(file) : readElf(file);
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
  const elf: Image = { file, view, isArm64, segments, importAt: new Map(), stubs: new Set(), ownTables: [] };
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

function codeAt({ file, segments }: Image, address: number, before: number, after: number): string {
  const segment = segments.find(each => address >= each.address && address < each.address + (each.end - each.offset))!;
  const at = segment.offset + (address - segment.address);
  return Buffer.from(file.subarray(Math.max(at - before, segment.offset), at + after)).toString("hex");
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
    if (name !== undefined && !isInAStub(address)) places.push({ name, address, code: codeAt(elf, address, 16, 24) });
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
          const isLoad = (use & 0xffc00000) >>> 0 === 0xf9400000;
          const isAdd = (use & 0xffc00000) >>> 0 === 0x91000000;
          if (isLoad) found(nameAt(page + ((use >>> 10) & 0xfff) * 8), here);
          else if (isAdd) found(nameAt(page + ((use >>> 10) & 0xfff)), here);
          // `ldr x8, [x8, #16]` leaves something else in the register, so `ldr x0, [x8, #32]` after it reads no page.
          if ((isLoad || isAdd) && (use & 31) === (word & 31)) break;
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

const isIn = (value: number, ...ranges: number[]) => ranges.some((low, index) => index % 2 === 0 && value >= low && value <= ranges[index + 1]!);

// How many bytes the x64 instruction at `at` takes, or 0 for one that this does not know.
function instructionLength(file: Uint8Array, at: number): number {
  let next = at;
  let hasSmallOperands = false;
  let hasSmallAddresses = false;
  for (; [0x26, 0x2e, 0x36, 0x3e, 0x64, 0x65, 0x66, 0x67, 0xf0, 0xf2, 0xf3].includes(file[next]!); next++) {
    hasSmallOperands ||= file[next] === 0x66;
    hasSmallAddresses ||= file[next] === 0x67;
  }
  const hasWideOperands = (file[next]! & 0xf8) === 0x48;
  if ((file[next]! & 0xf0) === 0x40) next++;
  let opcode = file[next++]!;
  // 0 is the table of opcodes of one byte, 1 the one after `0f`, 2 after `0f 38`, 3 after `0f 3a`. VEX and EVEX prefixes name one.
  let table = 0;
  if (opcode === 0xc5) [table, next] = [1, next + 1];
  else if (opcode === 0xc4) [table, next] = [file[next]! & 31, next + 2];
  else if (opcode === 0x62) [table, next] = [file[next]! & 7, next + 3];
  else if (opcode === 0x0f) table = file[next] === 0x38 ? 2 : file[next] === 0x3a ? 3 : 1;
  if (opcode === 0x0f && table > 1) next++;
  if (table > 0) opcode = file[next++]!;
  const word = hasSmallOperands && !hasWideOperands ? 2 : 4;
  let hasOperandByte = true;
  let immediate = 0;
  if (table === 0 && opcode < 0x40) {
    if ((opcode & 7) > 5) return 0;
    hasOperandByte = (opcode & 7) < 4;
    immediate = (opcode & 7) === 4 ? 1 : (opcode & 7) === 5 ? word : 0;
  } else if (table === 0) {
    if (isIn(opcode, 0x60, 0x62, 0x82, 0x82, 0x9a, 0x9a, 0xce, 0xce, 0xd4, 0xd6, 0xea, 0xea)) return 0;
    hasOperandByte = isIn(opcode, 0x63, 0x63, 0x69, 0x69, 0x6b, 0x6b, 0x80, 0x8f, 0xc0, 0xc1, 0xc6, 0xc7, 0xd0, 0xd3, 0xd8, 0xdf, 0xf6, 0xf7, 0xfe, 0xff);
    if (isIn(opcode, 0x6a, 0x6b, 0x70, 0x80, 0x83, 0x83, 0xa8, 0xa8, 0xb0, 0xb7, 0xc0, 0xc1, 0xc6, 0xc6, 0xcd, 0xcd, 0xe0, 0xe7, 0xeb, 0xeb)) immediate = 1;
    else if (isIn(opcode, 0x68, 0x69, 0x81, 0x81, 0xa9, 0xa9, 0xc7, 0xc7)) immediate = word;
    else if (isIn(opcode, 0xb8, 0xbf)) immediate = hasWideOperands ? 8 : word;
    else if (isIn(opcode, 0xa0, 0xa3)) immediate = hasSmallAddresses ? 4 : 8;
    else if (isIn(opcode, 0xe8, 0xe9)) immediate = 4;
    else if (isIn(opcode, 0xc2, 0xc2, 0xca, 0xca)) immediate = 2;
    else if (opcode === 0xc8) immediate = 3;
  } else if (table === 1) {
    if (isIn(opcode, 0x04, 0x04, 0x0a, 0x0a, 0x0c, 0x0c, 0x0f, 0x0f)) return 0;
    hasOperandByte = !isIn(opcode, 0x05, 0x09, 0x0b, 0x0b, 0x0e, 0x0e, 0x30, 0x37, 0x77, 0x77, 0x80, 0x8f, 0xa0, 0xa2, 0xa8, 0xaa, 0xc8, 0xcf);
    immediate = isIn(opcode, 0x80, 0x8f) ? 4 : isIn(opcode, 0x70, 0x73, 0xa4, 0xa4, 0xac, 0xac, 0xba, 0xba, 0xc2, 0xc2, 0xc4, 0xc6) ? 1 : 0;
  } else if (table === 3) immediate = 1;
  else if (table !== 2) return 0;
  if (hasOperandByte) {
    const operand = file[next++]!;
    if (table === 0 && (opcode & 0xfe) === 0xf6 && (operand & 0x30) === 0) immediate = opcode === 0xf6 ? 1 : word;
    if (operand < 0xc0) {
      const base = (operand & 7) === 4 ? file[next++]! & 7 : operand & 7;
      next += operand >= 0x80 || (operand < 0x40 && base === 5) ? 4 : operand >= 0x40 ? 1 : 0;
    }
  }
  return next + immediate - at;
}

// Whether the instructions from `from` on end where `to` begins. `0f 05` is `syscall` only there: `0f 84 0f 05 00 00` is a jump.
function leadsTo(file: Uint8Array, from: number, to: number): boolean {
  while (from < to) {
    const length = instructionLength(file, from);
    if (length === 0) return true;
    from += length;
  }
  return from === to;
}

function numberLoadedAhead(elf: Image, at: number, start: number, isFirstArgument: boolean): number | undefined {
  const { file, view } = elf;
  if (elf.isArm64) {
    const register = isFirstArgument ? 0 : 8;
    for (let back = at - 4; back >= start && back >= at - 128; back -= 4) {
      const word = view.getUint32(back, true);
      if ((word & 0x7fe0001f) >>> 0 === (0x52800000 | register) >>> 0) return (word >>> 5) & 0xffff;
    }
    return undefined;
  }
  const load = isFirstArgument ? 0xbf : 0xb8;
  const clear = isFirstArgument ? 0xff : 0xc0;
  const pop = isFirstArgument ? 0x5f : 0x58;
  for (let back = at - 2; back >= start && back >= at - 96; back--) {
    if (!isFirstArgument && !leadsTo(file, back, at)) continue;
    if (file[back] === load && back + 5 <= at) return view.getUint32(back + 1, true);
    if (file[back] === 0x31 && file[back + 1] === clear) return 0;
    if (file[back] === 0x6a && file[back + 2] === pop) return file[back + 1]!;
  }
  return undefined;
}

export function placesThatMakeSystemCalls(file: Uint8Array, numbers: readonly number[]): { number: number; address: number; code: string }[] {
  const elf = readImage(file);
  const places: { number: number; address: number; code: string }[] = [];
  const found = (number: number | undefined, address: number) => {
    if (number !== undefined && numbers.includes(number)) places.push({ number, address, code: codeAt(elf, address, 128, 4) });
  };
  const segmentOf = (address: number) => elf.segments.find(each => address >= each.address && address < each.address + (each.end - each.offset))!;
  for (const { address } of placesIn(elf, name => name === "syscall")) {
    const segment = segmentOf(address);
    if (segment.isExecutable) found(numberLoadedAhead(elf, segment.offset + (address - segment.address), segment.offset, true), address);
  }
  for (const { offset, end, address, isExecutable } of elf.segments) {
    if (!isExecutable) continue;
    if (elf.isArm64) {
      for (let at = (offset + 3) & ~3; at + 4 <= end; at += 4) if ((elf.view.getUint32(at, true) & 0xffe0001f) >>> 0 === 0xd4000001) found(numberLoadedAhead(elf, at, offset, false), address + (at - offset));
      continue;
    }
    for (let at = offset; at + 2 <= end; at++) if (file[at] === 0x0f && file[at + 1] === 0x05) found(numberLoadedAhead(elf, at, offset, false), address + (at - offset));
  }
  return places;
}
