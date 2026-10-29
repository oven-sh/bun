// Decodes x86-64 far enough to walk compiled code instruction by instruction, and to tell which constant a register holds at an instruction.

// What follows an opcode byte.
const invalid = 0,
  nothing = 1,
  modrm = 2,
  modrmImm8 = 3,
  modrmImmZ = 4,
  imm8 = 5,
  immZ = 6,
  imm16 = 7,
  imm16Imm8 = 8,
  rel8 = 9,
  rel32 = 10,
  offset64 = 11,
  immV = 12,
  modrmImm8IfTest = 13,
  modrmImmZIfTest = 14,
  prefix = 15;

/** `opcodes`: hexadecimal, single or as a range. */
function table(fill: number, entries: [kind: number, opcodes: string][]) {
  const kinds = new Uint8Array(256).fill(fill);
  for (const [kind, opcodes] of entries)
    for (const each of opcodes.split(" ")) {
      const [first, last = first] = each.split("-").map(digits => parseInt(digits, 16));
      kinds.fill(kind, first, last! + 1);
    }
  return kinds;
}

const oneByte = table(invalid, [
  [modrm, "00-03 08-0b 10-13 18-1b 20-23 28-2b 30-33 38-3b 63 84-8f d0-d3 d8-df fe ff"],
  [imm8, "04 0c 14 1c 24 2c 34 3c 6a a8 b0-b7 cd e4-e7"],
  [immZ, "05 0d 15 1d 25 2d 35 3d 68 a9"],
  [prefix, "26 2e 36 3e 40-4f 64-67 f0 f2 f3"],
  [nothing, "50-5f 6c-6f 90-99 9b-9f a4-a7 aa-af c3 c9 cb cc cf d7 ec-ef f1 f4 f5 f8-fd"],
  [modrmImmZ, "69 81 c7"],
  [modrmImm8, "6b 80 83 c0 c1 c6"],
  [rel8, "70-7f e0-e3 eb"],
  [rel32, "e8 e9"],
  [offset64, "a0-a3"],
  [immV, "b8-bf"],
  [imm16, "c2 ca"],
  [imm16Imm8, "c8"],
  [modrmImm8IfTest, "f6"],
  [modrmImmZIfTest, "f7"],
]);

const after0f = table(modrm, [
  [invalid, "04 0a 0c 24-27 36 39 3b-3f 7a 7b a6 a7"],
  [nothing, "05-09 0b 0e 30-35 37 77 a0-a2 a8-aa c8-cf"],
  [modrmImm8, "0f 70-73 a4 ac ba c2 c4-c6"],
  [rel32, "80-8f"],
]);

/** The instruction that `decode` read last. */
export const decoded = {
  /** 0: one opcode byte. 1: after 0f. 2: after 0f 38. 3: after 0f 3a. Others are maps of VEX and EVEX alone. */
  map: 0,
  opcode: 0,
  isVector: false,
  has66: false,
  hasF3: false,
  rex: 0,
  /** Where the ModRM byte is, or -1. */
  modrm: -1,
  /** Where the immediate or the relative target is, and how many bytes it has. */
  immediate: 0,
  immediateSize: 0,
  isRelative: false,
};

/** Returns the length of the instruction at `at`, or 0 if the bytes are not an instruction. */
export function decode(file: Uint8Array, at: number, end: number): number {
  let here = at;
  let has66 = false;
  let has67 = false;
  let hasF3 = false;
  let rex = 0;
  let kind: number;
  let opcode: number;
  let map = 0;
  let isVector = false;
  for (;;) {
    if (here >= end || here - at > 14) return 0;
    opcode = file[here++]!;
    kind = oneByte[opcode]!;
    if (kind !== prefix) break;
    // Only a REX prefix right before the opcode counts.
    rex = (opcode & 0xf0) === 0x40 ? opcode : 0;
    if (opcode === 0x66) has66 = true;
    else if (opcode === 0x67) has67 = true;
    else if (opcode === 0xf3) hasF3 = true;
  }
  if (opcode === 0x0f) {
    opcode = file[here++]!;
    map = 1;
    kind = after0f[opcode]!;
    if (opcode === 0x38 || opcode === 0x3a) {
      map = opcode === 0x38 ? 2 : 3;
      kind = map === 2 ? modrm : modrmImm8;
      opcode = file[here++]!;
    }
  } else if (opcode === 0xc5 || opcode === 0xc4 || opcode === 0x62) {
    isVector = true;
    if (opcode === 0xc5) {
      map = 1;
      here += 1;
    } else if (opcode === 0xc4) {
      map = file[here]! & 0x1f;
      here += 2;
    } else {
      map = file[here]! & 7;
      here += 3;
    }
    opcode = file[here++]!;
    kind = map === 1 ? after0f[opcode]! : map === 3 ? modrmImm8 : modrm;
    if (map === 0 || kind === rel32) return 0;
  }
  let modrmAt = -1;
  let size = 0;
  switch (kind) {
    case invalid:
      return 0;
    case nothing:
      break;
    case imm8:
    case rel8:
      size = 1;
      break;
    case immZ:
      size = has66 ? 2 : 4;
      break;
    case rel32:
      size = 4;
      break;
    case imm16:
      size = 2;
      break;
    case imm16Imm8:
      size = 3;
      break;
    case offset64:
      size = has67 ? 4 : 8;
      break;
    case immV:
      size = rex & 8 ? 8 : has66 ? 2 : 4;
      break;
    default: {
      modrmAt = here;
      const byte = file[here++]!;
      const mode = byte >> 6;
      if (mode !== 3) {
        const base = byte & 7;
        if (base === 4 && (file[here++]! & 7) === 5 && mode === 0) here += 4;
        if (mode === 1) here += 1;
        else if (mode === 2 || (mode === 0 && base === 5)) here += 4;
      }
      const isTest = (byte & 0x30) === 0;
      if (kind === modrmImm8 || (kind === modrmImm8IfTest && isTest)) size = 1;
      else if (kind === modrmImmZ || (kind === modrmImmZIfTest && isTest)) size = has66 ? 2 : 4;
    }
  }
  const length = here + size - at;
  if (length > 15 || here + size > end) return 0;
  decoded.map = map;
  decoded.opcode = opcode;
  decoded.isVector = isVector;
  decoded.has66 = has66;
  decoded.hasF3 = hasF3;
  decoded.rex = rex;
  decoded.modrm = modrmAt;
  decoded.immediate = here;
  decoded.immediateSize = size;
  decoded.isRelative = kind === rel8 || kind === rel32;
  return length;
}

const keeps = -1;
const unknown = -2;
const ends = -3;
const pops = -4;

// What an opcode does to the general registers. 0: see `effectOn`.
const keepsAll = 1,
  writesRm = 2,
  writesRm8 = 3,
  writesReg = 4,
  writesReg8 = 5,
  writesRax = 6,
  neverFallsThrough = 7;

const effectsOfOneByte = table(0, [
  [keepsAll, "50-57 68 6a 70-7f 84 85 8e 99 9b-9e a2 a3 a8 a9 c8 c9 e0-e3 e6 e7 ee ef f5 f8-fd"],
  [writesRm, "89 8c 8f c1 d1 d3"],
  [writesRm8, "88 c0 d0 d2 fe"],
  [writesReg, "63 69 6b 8b 8d"],
  [writesReg8, "8a"],
  [writesRax, "98 9f a0 a1 d7 e4 e5 ec ed"],
  [neverFallsThrough, "c2 c3 ca cb cc cf e9 eb f4"],
]);

// Most of these write a vector register or memory.
const effectsAfter0f = table(0, [
  [keepsAll, "0d 10-1f 28-2b 2e 2f 51-77 7f 80-8f a0 a1 a3 a8 a9 c2-c4 c6 d0-d6 d8-ff"],
  [writesReg, "02 03 2c 2d 40-4f 50 af b6-b8 bc-bf c5 d7"],
  [writesRm, "a4 a5 ab ac ad b3 bb"],
  [writesRm8, "90-9f"],
  [writesRax, "05"],
  [neverFallsThrough, "0b"],
]);

/**
 * What the instruction in `decoded` does to a general register (0: rax, 7: rdi). Returns the constant it loads, `keeps`, `pops`, `ends` if
 * the next instruction is never reached from it, or `unknown`. An instruction that is not listed is `unknown`.
 */
function effectOn(file: Uint8Array, view: DataView, register: number): number {
  const { map, opcode, rex, has66 } = decoded;
  const byte = decoded.modrm >= 0 ? file[decoded.modrm]! : 0;
  const isRegisterOperand = byte >> 6 === 3;
  const extension = (byte >> 3) & 7;
  // Without REX, the 8-bit registers 4 to 7 are ah, ch, dh and bh: parts of registers 0 to 3.
  const whole = (number: number, is8Bit: boolean) => (is8Bit && !rex && number >= 4 ? number - 4 : number);
  const isRm = (is8Bit = false) => isRegisterOperand && whole((byte & 7) | ((rex & 1) << 3), is8Bit) === register;
  const isReg = (is8Bit = false) => whole(extension | ((rex & 4) << 1), is8Bit) === register;
  const isInOpcode = (is8Bit = false) => whole((opcode & 7) | ((rex & 1) << 3), is8Bit) === register;
  const isRax = register === 0;
  const unknownIf = (isWritten: boolean) => (isWritten ? unknown : keeps);
  const immediate = () => {
    if (has66) return unknown;
    const value = view.getUint32(decoded.immediate, true);
    if (decoded.immediateSize === 8) return view.getUint32(decoded.immediate + 4, true) === 0 ? value : unknown;
    // With REX.W it is sign-extended.
    return rex & 8 && value >= 2 ** 31 ? unknown : value;
  };

  if (map > 1 || (decoded.isVector && effectsAfter0f[opcode] !== keepsAll)) return unknown;
  switch ((map === 0 ? effectsOfOneByte : effectsAfter0f)[opcode]) {
    case keepsAll:
      return keeps;
    case writesRm:
      return unknownIf(isRm());
    case writesRm8:
      return unknownIf(isRm(true));
    case writesReg:
      return unknownIf(isReg());
    case writesReg8:
      return unknownIf(isReg(true));
    case writesRax:
      return unknownIf(isRax);
    case neverFallsThrough:
      return ends;
  }
  const is8Bit = (opcode & 1) === 0;
  if (map === 1) {
    if ((opcode & 0xf8) === 0xc8) return unknownIf(isInOpcode()); // bswap
    if (opcode === 0xba) return extension === 4 ? keeps : unknownIf(isRm()); // bt, bts ..
    if (opcode === 0xb0 || opcode === 0xb1) return unknownIf(isRax || isRm(is8Bit)); // cmpxchg
    if (opcode === 0xc0 || opcode === 0xc1) return unknownIf(isRm(is8Bit) || isReg(is8Bit)); // xadd
    if (opcode === 0x7e) return decoded.hasF3 ? keeps : unknownIf(isRm()); // movd, movq
    if (opcode === 0xae) return decoded.hasF3 ? unknownIf(isRm()) : keeps; // fences, or rdfsbase ..
    return unknown;
  }
  if (opcode < 0x40) {
    // add, or, adc, sbb, and, sub, xor, cmp
    const form = opcode & 7;
    if (opcode >= 0x38) return keeps;
    if (form >= 4) return unknownIf(isRax);
    if ((opcode & 0x38) === 0x30 && !is8Bit && isRm() && isReg()) return 0;
    return unknownIf(form < 2 ? isRm(is8Bit) : isReg(is8Bit));
  }
  if ((opcode & 0xf8) === 0x58) return isInOpcode() ? pops : keeps;
  if ((opcode & 0xf8) === 0xb0) return unknownIf(isInOpcode(true));
  if ((opcode & 0xf8) === 0xb8) return isInOpcode() ? immediate() : keeps;
  if (opcode === 0x90) return unknownIf((rex & 1) !== 0 && isRax); // nop, or xchg r8, rax
  if ((opcode & 0xf8) === 0x90) return unknownIf(isRax || isInOpcode()); // xchg
  if ((opcode & 0xf8) === 0xd8) return unknownIf(opcode === 0xdf && byte === 0xe0 && isRax); // x87; fnstsw ax
  if (opcode === 0x80 || opcode === 0x81 || opcode === 0x83) return extension === 7 ? keeps : unknownIf(isRm(is8Bit));
  if (opcode === 0x86 || opcode === 0x87) return unknownIf(isRm(is8Bit) || isReg(is8Bit)); // xchg
  if (opcode === 0xc6 && extension === 0) return unknownIf(isRm(true));
  if (opcode === 0xc7 && extension === 0) return isRm() ? immediate() : keeps;
  // test; not, neg; mul, imul, div, idiv
  if (opcode === 0xf6 || opcode === 0xf7)
    return extension < 2 ? keeps : unknownIf(extension < 4 ? isRm(is8Bit) : isRax);
  // inc, dec; call; jmp; push
  if (opcode === 0xff)
    return extension < 2
      ? unknownIf(isRm())
      : extension < 4
        ? unknown
        : extension < 6
          ? ends
          : extension === 6
            ? keeps
            : unknown;
  return unknown;
}

/** Compiled code, walked from its first byte. The sets have a bit for each byte of `[offset, end)`. */
export interface Walked {
  offset: number;
  end: number;
  starts: Uint8Array;
  callTargets: Uint8Array;
  jumpTargets: Uint8Array;
  /** Each jump with a target in the code: where it begins, and its target. */
  jumps: { count: number; from: Int32Array; to: Int32Array };
  /** Where a `syscall` instruction begins. */
  systemCalls: number[];
  /** Where the bytes of a `syscall` instruction come so soon after bytes that are not code that nothing tells whether they begin an instruction. */
  doubtful: number[];
}

const has = (set: Uint8Array, index: number) => (set[index >> 3]! & (1 << (index & 7))) !== 0;

export function walk(file: Uint8Array, view: DataView, offset: number, end: number): Walked {
  const size = end - offset;
  const starts = new Uint8Array((size >> 3) + 1);
  const callTargets = new Uint8Array((size >> 3) + 1);
  const jumpTargets = new Uint8Array((size >> 3) + 1);
  let from = new Int32Array(1 << 16);
  let to = new Int32Array(1 << 16);
  let count = 0;
  const systemCalls: number[] = [];
  const doubtful: number[] = [];
  for (let at = offset; at < end; ) {
    const length = decode(file, at, end);
    if (length === 0) {
      // Data among the code. A few instructions later the walk is in step again.
      for (let near = at; near < at + 64 && near + 2 <= end; near++)
        if (file[near] === 0x0f && file[near + 1] === 0x05 && doubtful.at(-1) !== near) doubtful.push(near);
      at++;
      continue;
    }
    const index = at - offset;
    starts[index >> 3]! |= 1 << (index & 7);
    if (decoded.isRelative) {
      const distance =
        decoded.immediateSize === 1 ? view.getInt8(decoded.immediate) : view.getInt32(decoded.immediate, true);
      const target = index + length + distance;
      if (target >= 0 && target < size) {
        if (decoded.map === 0 && decoded.opcode === 0xe8) callTargets[target >> 3]! |= 1 << (target & 7);
        else {
          jumpTargets[target >> 3]! |= 1 << (target & 7);
          if (count === from.length) {
            const [oldFrom, oldTo] = [from, to];
            (from = new Int32Array(count * 2)).set(oldFrom);
            (to = new Int32Array(count * 2)).set(oldTo);
          }
          from[count] = index;
          to[count++] = target;
        }
      }
    } else if (decoded.map === 1 && decoded.opcode === 0x05 && !decoded.isVector) systemCalls.push(at);
    at += length;
  }
  const isFound = new Set(systemCalls);
  return {
    offset,
    end,
    starts,
    callTargets,
    jumpTargets,
    jumps: { count, from, to },
    systemCalls,
    doubtful: doubtful.filter(at => !isFound.has(at)),
  };
}

/** Returns where the instruction begins that holds the byte at `at`, or -1. */
export function startOfInstruction(walked: Walked, at: number): number {
  for (let start = at; start >= walked.offset && start > at - 15; start--)
    if (has(walked.starts, start - walked.offset)) return start;
  return -1;
}

/**
 * Returns the constants that `register` (0: rax, 7: rdi) may hold when the instruction at `at` runs, one for each path that leads there,
 * or undefined if some path brings another kind of value, or cannot be followed.
 */
export function constantsIn(
  file: Uint8Array,
  view: DataView,
  walked: Walked,
  register: number,
  at: number,
): number[] | undefined {
  const { offset, end, jumps } = walked;
  const constants = new Set<number>();
  const seen = new Set([at]);
  const left = [at];
  const follow = (place: number) => void (seen.has(place) || (seen.add(place), left.push(place)));
  while (left.length > 0) {
    if (seen.size > 512) return undefined;
    const here = left.pop()!;
    // A caller's value.
    if (has(walked.callTargets, here - offset)) return undefined;
    let isReached = false;
    if (has(walked.jumpTargets, here - offset))
      for (let index = 0; index < jumps.count; index++)
        if (jumps.to[index] === here - offset) {
          isReached = true;
          follow(jumps.from[index]! + offset);
        }
    const previous = startOfInstruction(walked, here - 1);
    if (previous < 0 || previous + decode(file, previous, end) !== here) return undefined;
    const effect = effectOn(file, view, register);
    if (effect >= 0) constants.add(effect);
    else if (effect === keeps) follow(previous);
    else if (effect === pops) {
      // push 57; pop rax
      const push = startOfInstruction(walked, previous - 1);
      if (
        has(walked.jumpTargets, previous - offset) ||
        push < 0 ||
        push + decode(file, push, end) !== previous ||
        decoded.map !== 0
      )
        return undefined;
      const value =
        decoded.opcode === 0x6a
          ? view.getInt8(decoded.immediate)
          : decoded.opcode === 0x68 && !decoded.has66
            ? view.getInt32(decoded.immediate, true)
            : -1;
      if (value < 0) return undefined;
      constants.add(value);
    } else if (effect !== ends || !isReached) return undefined;
  }
  return [...constants];
}
