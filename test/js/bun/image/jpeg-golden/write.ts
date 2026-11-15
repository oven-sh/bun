// Writes a JPEG file for given coefficients or samples, in any layout of frame and scans. model.ts has their pixels.
// Section numbers are those of ITU-T T.81: https://www.w3.org/Graphics/JPEG/itu-t81.pdf
//
// A debug build runs JavaScript some fifty times slower. Hence the plain loops over typed arrays.
import { ArithmeticCoder } from "./arithmetic";

export const [SOF0, SOF1, SOF2, SOF3, SOF9, SOF10, SOF11] = [0xc0, 0xc1, 0xc2, 0xc3, 0xc9, 0xca, 0xcb];
export const [DHT, DAC, RST0, SOI, EOI, SOS, DQT, DNL, DRI] = [0xc4, 0xcc, 0xd0, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd];
export const [APP0, APP2, APP14, COM, TEM] = [0xe0, 0xe2, 0xee, 0xfe, 0x01];

type Bytes = Uint8Array | number[] | string;
const bytesOf = (data: Bytes) => (typeof data === "string" ? Buffer.from(data, "latin1") : Buffer.from(data));
const word = (value: number) => [value >> 8, value & 255];

export const marker = (code: number) => Buffer.from([0xff, code]);
export const rst = (number: number) => marker(RST0 + (number & 7));
export const withRestarts = <T>(intervals: T[]) => intervals.flatMap((data, i) => (i ? [rst(i - 1), data] : [data]));
/** `length` goes into the length field. */
export const segment = (code: number, data: Bytes = [], length = 2 + data.length) =>
  Buffer.concat([Buffer.from([0xff, code, ...word(length)]), bytesOf(data)]);
export const withoutEoi = (...parts: Bytes[]) => Buffer.concat([marker(SOI), ...parts.map(bytesOf)]);
export const jpeg = (...parts: Bytes[]) => withoutEoi(...parts, marker(EOI));

export const jfif = segment(APP0, "JFIF\0\x01\x01\0\0\x01\0\x01\0\0");
export const adobe = (transform: number) => segment(APP14, [...bytesOf("Adobe\0\x64\0\0\0\0"), transform]);
export const icc = (number: number, count: number, data: Bytes) =>
  segment(APP2, Buffer.concat([bytesOf("ICC_PROFILE\0"), Buffer.from([number, count]), bytesOf(data)]));
export const dri = (interval: number) => segment(DRI, word(interval));
export const dqt = (number: number, values: number[], wide = values.some(value => value > 255)) =>
  segment(DQT, [number | (wide ? 16 : 0), ...(wide ? values.flatMap(word) : values)]);
/** A quantization table that multiplies all AC coefficients by 0. That also turns block smoothing off. */
export const dcOnly = (step: number): number[] => [step, ...Array(63).fill(0)];

export type Component = {
  id: number;
  h: number;
  v: number;
  /** The number of its quantization table. */
  table: number;
  /** In blocks, or in samples if lossless: what the image needs, then that rounded up to whole MCUs. */
  wide: number;
  high: number;
  across: number;
  down: number;
  /** 64 coefficients for each block, in zigzag order, or the samples if lossless. */
  data: Int32Array;
};

export type Frame = {
  type: number;
  precision: number;
  width: number;
  height: number;
  components: Component[];
  /** Quantization tables by number, in zigzag order. */
  tables: number[][];
};

export const rgbIds = [...Buffer.from("RGB")];
export const progressiveTypes = [
  ["Huffman", SOF2],
  ["arithmetic", SOF10],
] as const;
export const isLossless = (frame: { type: number }) => (frame.type & 3) === 3;
export const isProgressive = (frame: { type: number }) => (frame.type & 3) === 2;
export const largest = ({ components }: Frame) => [
  Math.max(...components.map(c => c.h)),
  Math.max(...components.map(c => c.v)),
];

/** All zeros. `sampling` is like "2x2,1x1,1x1". Component `i` has table `i`, or the last one. */
export function frameOf(
  width: number,
  height: number,
  sampling = "1x1",
  { type = SOF0, precision = 8, ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], tables = [Array(64).fill(1)] } = {},
): Frame {
  const factors = sampling.split(",").map(pair => pair.split("x").map(Number));
  const [maxH, maxV] = [0, 1].map(axis => Math.max(...factors.map(pair => pair[axis])));
  const unit = isLossless({ type }) ? 1 : 8;
  const components = factors.map(([h, v], i) => {
    const [wide, high] = [Math.ceil((width * h) / (maxH * unit)), Math.ceil((height * v) / (maxV * unit))];
    const [across, down] = [Math.ceil(wide / h) * h, Math.ceil(high / v) * v];
    const data = new Int32Array(across * down * unit * unit);
    return { id: ids[i], h, v, table: Math.min(i, tables.length - 1), wide, high, across, down, data };
  });
  return { type, precision, width, height, components, tables };
}

/** The same coefficients in another kind of frame. */
export const as = (type: number, frame: Frame): Frame => ({ ...frame, type });
export const copyOf = (frame: Frame): Frame => ({
  ...frame,
  components: frame.components.map(c => ({ ...c, data: c.data.slice() })),
});

export const sof = ({ type, precision, width, height, components }: Frame) =>
  segment(type, [
    precision,
    ...word(height),
    ...word(width),
    components.length,
    ...components.flatMap(c => [c.id, (c.h << 4) | c.v, c.table]),
  ]);

export type Scan = {
  /** Indices into those of the frame. */
  components: number[];
  /** In a lossless scan, the predictor. */
  ss: number;
  se: number;
  ah: number;
  al: number;
  /** For each of `components`, the numbers of its tables. */
  dc: number[];
  ac: number[];
  /** The restart interval. */
  interval: number;
  maxEobRun: number;
  /** The DAC values, by class and number. */
  conditioning: Record<number, number>;
};

/** Table 0 for the first component and 1 for the others, and 0 where none is needed. */
export function scanOf(components: number[], ss = 0, se = 63, ah = 0, al = 0, more: Partial<Scan> = {}): Scan {
  const numbers = components.map(c => Math.min(c, 1));
  const [dc, ac] = [ss === 0 && ah === 0, se !== 0].map(needed => (needed ? numbers : numbers.map(() => 0)));
  return { components, ss, se, ah, al, dc, ac, interval: 0, maxEobRun: 0x7fff, conditioning: {}, ...more };
}
export const all = (frame: Frame) => frame.components.map((_, i) => i);
/** The components of each scan, from something like "01 2". */
export const groupsOf = (layout: string) => layout.split(" ").map(group => [...group].map(Number));
export const forThree = (scans: (component: number) => Scan[]) => [0, 1, 2].flatMap(scans);
/** Successive approximation: a first scan with this Al, then a refinement scan for each bit. */
export const bitByBit = (al: number, components: number[], ss: number, se: number) =>
  Array.from({ length: al + 1 }, (_, i) => scanOf(components, ss, se, i ? al - i + 1 : 0, al - i));

export const sos = (frame: Frame, { components, dc, ac, ss, se, ah, al }: Scan) =>
  segment(SOS, [
    components.length,
    ...components.flatMap((c, i) => [frame.components[c].id, (dc[i] << 4) | ac[i]]),
    ss,
    se,
    (ah << 4) | al,
  ]);

/** A.2: calls `unit` for the blocks or samples of a scan in order. `i` is the index of the component in the scan. */
export function walk(
  frame: Frame,
  { components, interval }: Scan,
  unit: (component: Component, i: number, x: number, y: number) => void,
  restart: (number: number) => void,
) {
  const parts = components.map(c => frame.components[c]);
  const [first] = parts;
  const alone = parts.length === 1;
  const [columns, rows] = alone ? [first.wide, first.high] : [first.across / first.h, first.down / first.v];
  for (let row = 0, mcu = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++, mcu++) {
      if (interval && mcu && mcu % interval === 0) restart((mcu / interval - 1) & 7);
      if (alone) {
        unit(first, 0, column, row);
        continue;
      }
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        for (let y = 0; y < part.v; y++) {
          for (let x = 0; x < part.h; x++) unit(part, i, column * part.h + x, row * part.v + y);
        }
      }
    }
  }
}

/** How many codes there are of 1 to 16 bits, and their symbols. */
export type HuffmanTable = { counts: number[]; symbols: number[] };
/** By class and number, as in DHT: AC + 1 is the second table for AC coefficients. */
export type HuffmanTables = Record<number, HuffmanTable>;
export const AC = 16;
export const [EOB, ZRL] = [0x00, 0xf0];

export const dht = (number: number, { counts, symbols }: HuffmanTable) => segment(DHT, [number, ...counts, ...symbols]);
export const dhts = (tables: HuffmanTables) => Object.entries(tables).map(([number, table]) => dht(+number, table));

const fromHex = (counts: string, symbols: string) => ({
  counts: [...Buffer.from(counts, "hex")],
  symbols: [...Buffer.from(symbols.replace(/\s/g, ""), "hex")],
});

/** K.3 */
export const typical: HuffmanTables = {
  0: fromHex("00010501010101010100000000000000", "000102030405060708090a0b"),
  1: fromHex("00030101010101010101010000000000", "000102030405060708090a0b"),
  [AC]: fromHex(
    "0002010303020403050504040000017d",
    `01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a343536373839
     3a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7
     a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9fa`,
  ),
  [AC + 1]: fromHex(
    "00020102040403040705040400010277",
    `000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738
     393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5
     a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9fa`,
  ),
};

/** `symbols[i]` gets a code of `lengths[i]` bits. */
export function tableOf(symbols: number[], lengths: number[]): HuffmanTable {
  const order = symbols.map((_, i) => i).sort((a, b) => lengths[a] - lengths[b]);
  const counts = Array(16).fill(0);
  for (const length of lengths) counts[length - 1]++;
  return { counts, symbols: order.map(i => symbols[i]) };
}

/** K.2. `unlimited` is the length of the longest code before figure K.3 limits it to 16. */
export function optimalTable(occurrences: ArrayLike<number>) {
  // A dummy symbol takes the all-ones code.
  const used: number[] = [];
  for (let symbol = 0; symbol < 256; symbol++) if (occurrences[symbol]) used.push(symbol);
  used.push(256);
  const lengths = new Int32Array(257);
  const trees = used.map(symbol => ({ frequency: occurrences[symbol] ?? 1, symbols: [symbol] }));
  /** On a tie, the last. */
  const least = (but?: number) => {
    let found = but === 0 ? 1 : 0;
    for (let i = 0; i < trees.length; i++) if (i !== but && trees[i].frequency <= trees[found].frequency) found = i;
    return found;
  };
  while (trees.length > 1) {
    const first = trees[least()];
    const [second] = trees.splice(least(least()), 1);
    first.frequency += second.frequency;
    first.symbols = first.symbols.concat(second.symbols);
    for (let i = 0; i < first.symbols.length; i++) lengths[first.symbols[i]]++;
  }
  const unlimited = lengths[256];
  const counts = Array(Math.max(unlimited, 16) + 1).fill(0);
  for (const symbol of used) counts[lengths[symbol]]++;
  let length = counts.length - 1;
  for (; length > 16; length--) {
    while (counts[length] > 0) {
      let shorter = length - 2;
      while (counts[shorter] === 0) shorter--;
      counts[length] -= 2;
      counts[length - 1]++;
      counts[shorter + 1] += 2;
      counts[shorter]--;
    }
  }
  while (counts[length] === 0) length--;
  counts[length]--;
  const symbols = used.slice(0, -1).sort((a, b) => lengths[a] - lengths[b]);
  return { counts: counts.slice(1, 17), symbols, unlimited };
}

const made = new WeakMap<HuffmanTable, { codes: Int32Array; lengths: Int32Array }>();
/** C.2: the code of each symbol, and its length. */
function codesOf(table: HuffmanTable) {
  if (made.has(table)) return made.get(table)!;
  const { counts, symbols } = table;
  const [codes, lengths] = [new Int32Array(256), new Int32Array(256)];
  made.set(table, { codes, lengths });
  for (let length = 1, code = 0, at = 0; length <= 16; length++, code <<= 1) {
    for (let i = 0; i < counts[length - 1]; i++, at++) {
      codes[symbols[at]] = code++;
      lengths[symbols[at]] = length;
    }
  }
  return { codes, lengths };
}

export function stuffed(bytes: ArrayLike<number>) {
  const out = Buffer.alloc(bytes.length * 2);
  let to = 0;
  for (let i = 0; i < bytes.length; i++) if ((out[to++] = bytes[i]) === 255) to++;
  return out.subarray(0, to);
}

/** SSSS: how many extra bits `value` takes. */
export const sizeOf = (value: number) => 32 - Math.clz32(Math.abs(value));
export const int16 = (value: number) => (value << 16) >> 16;
const [BITS, MARKER] = [-1, -2];

/** The symbols and bits of a Huffman-coded scan, before codes are assigned. */
export class Symbols {
  /** Three numbers each: the table, BITS or MARKER, then the symbol, the bits or the marker, then how many bits. */
  #items: number[] = [];

  symbol(table: number, symbol: number) {
    this.#items.push(table, symbol, 0);
    return this;
  }
  bits(bits: number, count: number) {
    if (count) this.#items.push(BITS, bits & ((1 << count) - 1), count);
    return this;
  }
  /** F.1.2: RRRRSSSS, then the extra bits. */
  value(table: number, run: number, value: number) {
    const size = sizeOf(value);
    return this.symbol(table, (run << 4) | size).bits(value < 0 ? value - 1 : value, size);
  }
  /** G.1.2.2: EOBn, then the extra bits. */
  eobRun(table: number, blocks: number) {
    const size = sizeOf(blocks) - 1;
    return this.symbol(table, size << 4).bits(blocks, size);
  }
  /** Pads with ones to a whole byte first. */
  marker(code: number) {
    this.#items.push(MARKER, code, 0);
    return this;
  }

  /** By table, in the order of their first use. */
  occurrences() {
    const found = new Map<number, Int32Array>();
    const items = this.#items;
    for (let i = 0; i < items.length; i += 3) {
      if (items[i] < 0) continue;
      if (!found.has(items[i])) found.set(items[i], new Int32Array(256));
      found.get(items[i])![items[i + 1]]++;
    }
    return found;
  }

  bytes(tables: HuffmanTables = typical) {
    const codes: ReturnType<typeof codesOf>[] = [];
    for (const number in tables) codes[number] = codesOf(tables[number]);
    const items = this.#items;
    const out = Buffer.alloc((items.length / 3) * 6 + 2);
    let [to, pending, count] = [0, 0, 0];
    for (let i = 0; i <= items.length; i += 3) {
      const kind = i < items.length ? items[i] : MARKER;
      let bits = items[i + 1];
      let length = items[i + 2];
      if (kind === MARKER) {
        length = -count & 7;
        bits = (1 << length) - 1;
      } else if (kind !== BITS) {
        length = codes[kind].lengths[bits];
        if (!length) throw new Error(`no code for ${bits} in table ${kind}`);
        bits = codes[kind].codes[bits];
      }
      pending = (pending << length) | bits;
      for (count += length; count >= 8; count -= 8) {
        if ((out[to++] = (pending >> (count - 8)) & 255) === 255) to++;
      }
      if (kind === MARKER && i < items.length) to = out.writeUInt16BE(0xff00 | items[i + 1], to);
    }
    return out.subarray(0, to);
  }
}

/** libjpeg ends an EOB run when more correction bits than this are pending. */
export const maxCorrectionBits = 937;

/** F.1.2 and G.1.2 */
function huffmanSymbols(frame: Frame, scan: Scan) {
  const { ss, se, ah, al, maxEobRun } = isProgressive(frame) ? scan : scanOf([], 0, 63, 0, 0, { maxEobRun: 1 });
  const out = new Symbols();
  const last = [0, 0, 0, 0];
  let table = 0;
  let [eobRun, corrections] = [0, [] as number[]];
  const send = (bits: number[]) => {
    for (const bit of bits) out.bits(bit, 1);
    bits.length = 0;
  };
  const endRun = () => {
    if (!eobRun) return;
    out.eobRun(table, eobRun);
    send(corrections);
    eobRun = 0;
  };
  const block = ({ data, across }: Component, i: number, x: number, y: number) => {
    const at = (y * across + x) * 64;
    if (ss === 0 && ah) return void out.bits(data[at] >> al, 1);
    if (ss === 0) {
      out.value(scan.dc[i], 0, (data[at] >> al) - last[i]);
      last[i] = data[at] >> al;
    }
    if (se === 0) return;
    table = AC + scan.ac[i];
    let lastNew = se;
    if (ah) while (lastNew >= ss && Math.abs(data[at + lastNew]) >> al !== 1) lastNew--;
    let run = 0;
    const waiting: number[] = [];
    for (let k = Math.max(ss, 1); k <= se; k++) {
      const value = data[at + k];
      const magnitude = (value < 0 ? -value : value) >> al;
      if (magnitude === 0) {
        run++;
        continue;
      }
      for (; run > 15 && k <= lastNew; run -= 16) {
        endRun();
        out.symbol(table, ZRL);
        send(waiting);
      }
      if (ah && magnitude > 1) {
        waiting.push(magnitude & 1);
        continue;
      }
      endRun();
      out.value(table, run, value < 0 ? -magnitude : magnitude);
      send(waiting);
      run = 0;
    }
    if (run === 0 && waiting.length === 0) return;
    corrections.push(...waiting);
    if (++eobRun === maxEobRun || corrections.length > maxCorrectionBits) endRun();
  };
  walk(frame, scan, block, number => {
    endRun();
    out.marker(RST0 + number);
    last.fill(0);
  });
  endRun();
  return out;
}

/** H.1.2.1 */
export function predict(predictor: number, a: number, b: number, c: number) {
  return [0, a, b, c, a + b - c, a + ((b - c) >> 1), b + ((a - c) >> 1), (a + b) >> 1][predictor];
}

/** H.1.2. A sample that only pads an MCU is written as a difference. */
function losslessSymbols(frame: Frame, scan: Scan) {
  const { ss, al } = scan;
  const out = new Symbols();
  // The first row of each component in this restart interval.
  let first: number[] = [];
  const sample = ({ data, across, wide, high }: Component, i: number, x: number, y: number) => {
    first[i] ??= y;
    const at = y * across + x;
    let predicted = 0;
    if (x < wide && y < high) {
      const [a, b, c] = [data[at - 1] >> al, data[at - across] >> al, data[at - across - 1] >> al];
      if (y === first[i]) predicted = x ? a : 1 << (frame.precision - al - 1);
      else predicted = x ? predict(ss, a, b, c) : b;
    }
    const difference = int16((data[at] >> al) - predicted);
    if (difference === -32768) out.symbol(scan.dc[i], 16);
    else out.value(scan.dc[i], 0, difference);
  };
  walk(frame, scan, sample, number => {
    out.marker(RST0 + number);
    first = [];
  });
  return out;
}

/** F.1.4 and G.1.3 */
function arithmeticData(frame: Frame, scan: Scan) {
  const { ss, se, ah, al } = isProgressive(frame) ? scan : scanOf([]);
  const parts: Buffer[] = [];
  let coder = new ArithmeticCoder(scan.conditioning);
  let last = [0, 0, 0, 0];
  const block = ({ data, across }: Component, i: number, x: number, y: number) => {
    const at = (y * across + x) * 64;
    if (ss === 0 && ah) return coder.evenly((data[at] >> al) & 1);
    if (ss === 0) {
      coder.difference(scan.dc[i], i, int16((data[at] >> al) - last[i]));
      last[i] = data[at] >> al;
    }
    if (se !== 0) coder.band(scan.ac[i], data.subarray(at, at + 64), Math.max(ss, 1), se, ah, al);
  };
  walk(frame, scan, block, number => {
    parts.push(stuffed(coder.finish()), rst(number));
    coder = new ArithmeticCoder(scan.conditioning);
    last = [0, 0, 0, 0];
  });
  return Buffer.concat([...parts, stuffed(coder.finish())]);
}

export const symbolsOf = (frame: Frame, scan: Scan) =>
  isLossless(frame) ? losslessSymbols(frame, scan) : huffmanSymbols(frame, scan);

/** The DHT or DAC segments of a scan, its header and its data. Huffman tables that are not given are optimal. */
export function coded(frame: Frame, scan: Scan, given?: HuffmanTables) {
  const header = sos(frame, scan);
  if (frame.type >= SOF9) {
    const pairs = Object.entries(scan.conditioning).flatMap(([number, value]) => [+number, value]);
    return { tables: pairs.length ? [segment(DAC, pairs)] : [], header, data: arithmeticData(frame, scan) };
  }
  const symbols = symbolsOf(frame, scan);
  const used = [...symbols.occurrences()].map(([number, n]) => [number, given?.[number] ?? optimalTable(n)] as const);
  return {
    tables: used.map(([number, table]) => dht(number, table)),
    header,
    data: symbols.bytes(Object.fromEntries(used)),
  };
}

export const scanWithTables = (frame: Frame, scan: Scan) => Object.values(coded(frame, scan)).flat();
export function scanWithoutTables(frame: Frame, scan: Scan, tables = typical) {
  const data = frame.type >= SOF9 ? arithmeticData(frame, scan) : symbolsOf(frame, scan).bytes(tables);
  return Buffer.concat([sos(frame, scan), data]);
}

/** DQT and SOF */
export const headerOf = (frame: Frame) =>
  Buffer.concat([...(isLossless(frame) ? [] : frame.tables.map((table, i) => dqt(i, table))), sof(frame)]);

export function write(
  frame: Frame,
  scans = [isLossless(frame) ? scanOf(all(frame), 1, 0) : scanOf(all(frame))],
  { before = [] as Buffer[], tables = undefined as HuffmanTables | undefined } = {},
) {
  let interval = 0;
  const parts = scans.flatMap(scan => {
    const { tables: segments, header, data } = coded(frame, scan, tables);
    const restart = scan.interval === interval ? [] : [dri((interval = scan.interval))];
    return [...segments, ...restart, header, data];
  });
  return jpeg(...before, headerOf(frame), ...parts);
}

/** The scans that libjpeg writes for YCbCr. */
export const simpleProgression = [
  scanOf([0, 1, 2], 0, 0, 0, 1),
  scanOf([0], 1, 5, 0, 2),
  scanOf([2], 1, 63, 0, 1),
  scanOf([1], 1, 63, 0, 1),
  scanOf([0], 6, 63, 0, 2),
  scanOf([0], 1, 63, 2, 1),
  scanOf([0, 1, 2], 0, 0, 1, 0),
  scanOf([2], 1, 63, 1, 0),
  scanOf([1], 1, 63, 1, 0),
  scanOf([0], 1, 63, 1, 0),
];

export const random16 = (random: () => number) => (random() << 8) | random();
/** From `-limit` to `limit`. */
export const within = (random: () => number, limit: number) => (random16(random) % (2 * limit + 1)) - limit;

/**
 * Sets one in `sparse` AC coefficients to at most `ac` before quantization, and the mean of each block to at most `dc`
 * from 128. A lossless frame gets random samples.
 */
export function noise(frame: Frame, random: () => number, { dc = 64, ac = 96, sparse = 1 } = {}) {
  for (const { data, table } of frame.components) {
    const steps = frame.tables[table];
    for (let i = 0; i < data.length; i++) {
      if (isLossless(frame)) data[i] = random() & ((1 << frame.precision) - 1);
      else if (i % 64 === 0) data[i] = Math.trunc(within(random, dc * 8) / steps[0]);
      else if (sparse === 1 || random() % sparse === 0) data[i] = Math.trunc(within(random, ac) / steps[i % 64]);
    }
  }
  return frame;
}
