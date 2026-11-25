// Reads arithmetic-coded data, complete or not (T.81, D.2, F.2.4 and G.2).
import { states } from "./arithmetic";
import { AC, int16, isProgressive, scanOf, sizeOf, walk, type Frame, type Scan } from "./write";

const fault = Symbol("invalid data");

/** For one restart interval. Zeros follow the bytes. */
export class ArithmeticReader {
  #bins: Uint8Array[] = [];
  #contexts = [0, 0, 0, 0];
  #at = 0;
  #a = 0x10000;
  #c: number;
  #ct = 0;

  constructor(
    private bytes: Uint8Array,
    private conditioning: Record<number, number>,
  ) {
    this.#c = (this.byte() * 256 + this.byte()) * 0x10000;
  }

  byte() {
    const byte = this.bytes[this.#at++] ?? 0;
    // An FF that is not stuffed starts a marker.
    return byte !== 0xff || this.bytes[this.#at++] === 0 ? byte : 0;
  }

  /** 0 for the MPS, 1 for the MPS with renormalization, 2 for the LPS. */
  take(qe: number) {
    this.#a -= qe;
    const isUpper = this.#c >>> 16 >= this.#a;
    if (!isUpper && this.#a >= 0x8000) return 0;
    const isLps = isUpper !== this.#a < qe;
    if (isUpper) {
      this.#c -= this.#a * 0x10000;
      this.#a = qe;
    }
    do {
      if (this.#ct === 0) {
        this.#c += this.byte() * 256;
        this.#ct = 8;
      }
      this.#a *= 2;
      this.#c *= 2;
      this.#ct--;
    } while (this.#a < 0x8000);
    return isLps ? 2 : 1;
  }

  #decide(bins: Uint8Array, bin: number) {
    const [state, mps] = [states[bins[bin] & 127], bins[bin] >> 7];
    const taken = this.take(state.qe);
    if (taken) bins[bin] = (mps << 7) ^ (taken === 1 ? state.nextMps : state.nextLps);
    return mps ^ (taken >> 1);
  }

  evenly() {
    return this.take(states[0].qe) >> 1;
  }

  /** Figures F.23 and F.24, from bin `x` on: X1 for DC, X2 for AC. */
  #magnitude(bins: Uint8Array, x: number, top: number) {
    for (; this.#decide(bins, x); x++) if ((top *= 2) === 0x8000) throw fault;
    let value = top;
    for (let bit = top >> 1; bit; bit >>= 1) if (this.#decide(bins, x + 14)) value |= bit;
    return value;
  }

  /** F.2.4.1 */
  difference(table: number, component: number) {
    const [bins, context] = [(this.#bins[table] ??= new Uint8Array(64)), this.#contexts[component]];
    this.#contexts[component] = 0;
    if (!this.#decide(bins, context)) return 0;
    const sign = this.#decide(bins, context + 1);
    const value = this.#decide(bins, context + 2 + sign) && this.#magnitude(bins, 20, 1);
    const [top, bounds] = [value && 1 << (sizeOf(value) - 1), this.conditioning[table] ?? 0x10];
    if (top > (1 << (bounds >> 4)) >> 1) this.#contexts[component] = 12 + sign * 4;
    else if (top >= (1 << (bounds & 15)) >> 1) this.#contexts[component] = 4 + sign * 4;
    return sign ? -value - 1 : value + 1;
  }

  /** F.2.4.2, G.2.2 and G.2.3 */
  band(table: number, block: Int32Array, ss: number, se: number, ah: number, al: number) {
    const bins = (this.#bins[AC + table] ??= new Uint8Array(256));
    let endBefore = ah ? se : 0;
    while (endBefore > 0 && block[endBefore] === 0) endBefore--;
    for (let k = ss; k <= se; k++) {
      if (k > endBefore && this.#decide(bins, 3 * (k - 1))) return;
      while (!(ah && block[k]) && !this.#decide(bins, 3 * (k - 1) + 1)) if (++k > se) throw fault;
      const bin = 3 * (k - 1) + 2;
      if (ah && block[k]) {
        if (this.#decide(bins, bin)) block[k] = int16(block[k] + Math.sign(block[k]) * (1 << al));
        continue;
      }
      const sign = this.evenly() ? -1 : 1;
      let value = ah ? 0 : this.#decide(bins, bin);
      if (value && this.#decide(bins, bin)) {
        value = this.#magnitude(bins, k <= (this.conditioning[AC + table] ?? 5) ? 189 : 217, 2);
      }
      block[k] = int16((sign * (value + 1)) << al);
    }
  }
}

/** Into the coefficients of `frame`. After invalid data, the rest of the restart interval is skipped. */
export function readArithmetic(frame: Frame, scan: Scan, intervals: Uint8Array[]) {
  const { ss, se, ah, al } = isProgressive(frame) ? scan : scanOf([]);
  let nth = 0;
  const start = () => new ArithmeticReader(intervals[nth++] ?? new Uint8Array(), scan.conditioning);
  let reader: ArithmeticReader | undefined = start();
  let last = [0, 0, 0, 0];
  walk(
    frame,
    scan,
    ({ data, across }, i, x, y) => {
      if (!reader) return;
      const at = (y * across + x) * 64;
      try {
        if (ss === 0 && ah) data[at] |= reader.evenly() << al;
        else if (ss === 0) data[at] = int16((last[i] += reader.difference(scan.dc[i], i)) << al);
        if (se !== 0) reader.band(scan.ac[i], data.subarray(at, at + 64), Math.max(ss, 1), se, ah, al);
      } catch (error) {
        if (error !== fault) throw error;
        reader = undefined;
      }
    },
    () => {
      reader = start();
      last = [0, 0, 0, 0];
    },
  );
}

/** Splits at the restart markers. */
export function intervalsOf(data: Buffer) {
  const intervals: Buffer[] = [];
  let start = 0;
  for (let at = data.indexOf(0xff); at !== -1; at = data.indexOf(0xff, at + 2)) {
    if (!data[at + 1]) continue;
    intervals.push(data.subarray(start, at));
    start = at + 2;
  }
  return [...intervals, data.subarray(start)];
}
