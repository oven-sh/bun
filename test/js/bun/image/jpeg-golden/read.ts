// Reads the kinds of JPEG file that Bun.Image writes, bit by bit, and throws at the first violation of T.81.
import { AC, APP0, APP2, DHT, DQT, EOI, frameOf, scanOf, SOF0, SOF2, SOI, SOS, walk, type HuffmanTable } from "./write";

function fail(what: string): never {
  throw new Error(`not a valid JPEG file: ${what}`);
}

/** SOS comes with its entropy-coded data. */
export function segmentsOf(input: Uint8Array) {
  const file = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (file.readUInt16BE(0) !== (0xff00 | SOI) || file.readUInt16BE(file.length - 2) !== (0xff00 | EOI))
    fail("SOI, EOI");
  const segments: { code: number; body: Buffer; data?: Buffer }[] = [];
  for (let at = 2; at < file.length - 2;) {
    if (file[at] !== 0xff) fail(`no marker at ${at}`);
    const [code, end] = [file[at + 1], at + 2 + file.readUInt16BE(at + 2)];
    if (end > file.length - 2) fail("a segment longer than the file");
    let next = end;
    while (code === SOS && file[(next = file.indexOf(0xff, next)) + 1] === 0) next += 2;
    segments.push({
      code,
      body: file.subarray(at + 4, end),
      data: code === SOS ? file.subarray(end, next) : undefined,
    });
    at = next;
  }
  return segments;
}

class Bits {
  #at = 0;
  #left = 0;
  #byte = 0;
  constructor(private data: Buffer) {}

  take(count: number) {
    let bits = 0;
    for (; count > 0; count--) {
      if (this.#left === 0) {
        if (this.#at >= this.data.length) fail("too little data");
        this.#byte = this.data[this.#at];
        this.#at += this.#byte === 0xff ? 2 : 1;
        this.#left = 8;
      }
      bits = (bits << 1) | ((this.#byte >> --this.#left) & 1);
    }
    return bits;
  }
  /** F.2.2.3 */
  symbol({ counts, symbols }: HuffmanTable) {
    for (let length = 0, code = 0, first = 0, at = 0; length < 16; length++) {
      code = (code << 1) | this.take(1);
      if (code - first < counts[length]) return symbols[at + code - first];
      at += counts[length];
      first = (first + counts[length]) << 1;
    }
    fail("no such code");
  }
  value(size: number) {
    const bits = this.take(size);
    return bits < (1 << size) >> 1 ? bits - (1 << size) + 1 : bits;
  }
  end() {
    const ones = (1 << this.#left) - 1;
    if (this.#at !== this.data.length || this.take(this.#left) !== ones) fail("more than padding after the last block");
  }
}

export function read(file: Uint8Array) {
  const segments = segmentsOf(file);
  const names = { [APP0]: "0", [APP2]: "2", [DQT]: "Q", [SOF0]: "B", [SOF2]: "P", [DHT]: "H", [SOS]: "S" };
  const order = segments.map(({ code }) => names[code] ?? "?").join("");
  if (!/^02*Q+(BH+S|P(H*S)+)$/.test(order)) fail(`segments ${order}`);
  const only = (...codes: number[]) => segments.filter(({ code }) => codes.includes(code));

  const parts = only(APP2).map(({ body }, i, all) => {
    if (body.toString("latin1", 0, 12) !== "ICC_PROFILE\0" || body[12] !== i + 1 || body[13] !== all.length)
      fail("APP2");
    return body.subarray(14);
  });
  const tables: number[][] = [];
  for (const { body } of only(DQT)) {
    if (body.length !== 65 || body[0] > 3 || body.includes(0, 1)) fail("DQT");
    tables[body[0]] = [...body.subarray(1)];
  }
  const [{ code: type, body: fields }] = only(SOF0, SOF2);
  if (fields[0] !== 8 || fields.length !== 6 + fields[5] * 3) fail("SOF");
  const described = Array.from({ length: fields[5] }, (_, i) => fields.subarray(6 + i * 3, 9 + i * 3));
  const sampling = described.map(([, both]) => `${both >> 4}x${both & 15}`).join();
  const ids = described.map(([id]) => id);
  const frame = frameOf(fields.readUInt16BE(3), fields.readUInt16BE(1), sampling, { type, ids, tables });
  described.forEach(([, , table], i) => (frame.components[i].table = tables[table] ? table : fail("no such DQT")));

  const codes: HuffmanTable[] = [];
  /** The EOB runs of refinement scans. */
  const runs: { blocks: number; corrections: number }[] = [];
  const scans = only(DHT, SOS).flatMap(({ body, data }) => {
    if (!data) {
      const counts = [...body.subarray(1, 17)];
      const room = counts.reduce((room, count) => room * 2 - count, 1);
      if (room < 1 || counts.reduce((a, b) => a + b) !== body.length - 17 || body[0] & 0xec) fail("DHT");
      codes[body[0]] = { counts, symbols: [...body.subarray(17)] };
      return [];
    }
    if (body[0] < 1 || body[0] > 4 || body.length !== 4 + body[0] * 2) fail("SOS");
    const named = Array.from({ length: body[0] }, (_, i) => body.subarray(1 + i * 2, 3 + i * 2));
    const [ss, se, both] = body.subarray(1 + body[0] * 2);
    const [dc, ac] = [named.map(([, numbers]) => numbers >> 4), named.map(([, numbers]) => numbers & 15)];
    const scan = scanOf(
      named.map(([id]) => ids.indexOf(id)),
      ss,
      se,
      both >> 4,
      both & 15,
      { dc, ac },
    );
    const { ah, al } = scan;
    const bits = new Bits(data);
    const last = [0, 0, 0, 0];
    let eobRun = 0;
    /** G.1.2.3 */
    const correct = (data: Int32Array, at: number) => {
      if (bits.take(1)) data[at] += data[at] < 0 ? -1 << al : 1 << al;
    };
    walk(
      frame,
      scan,
      ({ data, across }, i, x, y) => {
        const at = (y * across + x) * 64;
        if (ss === 0 && ah) data[at] |= bits.take(1) << al;
        else if (ss === 0) data[at] = (last[i] += bits.value(bits.symbol(codes[dc[i]]))) << al;
        let k = Math.max(ss, 1);
        for (; k <= se && !eobRun; k++) {
          const symbol = bits.symbol(codes[AC + ac[i]]);
          const size = symbol & 15;
          let run = symbol >> 4;
          if (size > (ah ? 1 : 10) || (!size && run % 15 && type === SOF0)) fail(`symbol ${symbol}`);
          if (!size && run < 15) {
            eobRun = (1 << run) + bits.take(run);
            if (ah) runs.push({ blocks: eobRun, corrections: 0 });
            break;
          }
          const value = bits.value(size) * (1 << al);
          for (; k <= se && ((ah && data[at + k]) || run-- > 0); k++) if (data[at + k]) correct(data, at + k);
          if (k > se || (!size && k === se)) fail("zeros beyond the band");
          data[at + k] = value;
        }
        if (!eobRun) return;
        eobRun--;
        for (; ah && k <= se; k++) {
          if (!data[at + k]) continue;
          correct(data, at + k);
          runs.at(-1)!.corrections++;
        }
      },
      () => {},
    );
    if (eobRun) fail("an EOB run beyond the last block");
    bits.end();
    return [scan];
  });
  return { frame, scans, runs, segments, profile: parts.length ? Buffer.concat(parts) : undefined };
}
