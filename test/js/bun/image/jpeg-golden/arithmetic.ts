// The arithmetic encoder of T.81, annex D, with the models of annexes F and G.

/** Table D.3: Qe, Next_Index_LPS plus 128 times Switch_MPS, and Next_Index_MPS. */
export const states = `
  5a1d8101 25860e02 11141003 080b1204 03d81405 01da1706 00e51907 006f1c08 00361e09 001a210a 000d230b 0006090c
  00030a0d 00010c0d 5a7f8f0f 3f252410 2cf22611 207c2712 17b92813 11822a14 0cef2b15 09a12d16 072f2e17 055c3018
  04063119 0303331a 0240341b 01b1361c 0144381d 00f5391e 00b73b1f 008a3c20 00683e21 004e3f22 003b2023 002c2109
  5ae1a525 484c4026 3a0d4127 2ef14328 261f4429 1f33452a 19a8462b 1518482c 1177492d 0e744a2e 0bfb4b2f 09f84d30
  08614e31 07064f32 05cd3033 04de3234 040f3235 03633336 02d43437 025c3538 01f83639 01a4373a 0160383b 0125393c
  00f63a3d 00cb3b3e 00ab3d3f 008f3d20 5b12c141 4d045042 412c5143 37d85244 2fe85345 293c5446 23795647 1edf5748
  1aa95749 174e484a 1424484b 119c4a4c 0f6b4a4d 0d514b4e 0bb64d4f 0a404d30 5832d051 4d1c5852 438e5953 3bdd5a54
  34ee5b55 2eae5c56 299a5d57 25165647 5570d859 4ca95f5a 44d9605b 3e22615c 3824635d 32b4635e 2e175d56 56a8df60
  4f466561 47e56662 41cf6763 3c3d6864 375e635d 52316966 4c0f6a67 46396b68 415e6763 5627e96a 50e76c6b 4b856d67
  55976e6d 504f6f6b 5a10ee6f 5522706d 59ebf06f`
  .trim()
  .split(/\s+/)
  .map(hex => Buffer.from(hex, "hex"))
  .map(state => ({ qe: state.readUInt16BE(), nextLps: state[2], nextMps: state[3] }));

/** For one restart interval. */
export class ArithmeticCoder {
  /** By table: the state of each bin, plus 128 times its MPS. */
  #bins: Uint8Array[] = [];
  dc = (table: number) => (this.#bins[table] ??= new Uint8Array(64));
  ac = (table: number) => (this.#bins[16 + table] ??= new Uint8Array(256));
  #contexts = [0, 0, 0, 0];
  #bytes: number[] = [];
  #a = 0x10000;
  #c = 0;
  #ct = 11;

  constructor(private conditioning: Record<number, number> = {}) {}

  /** Returns whether it renormalized. */
  #code(qe: number, isMps: boolean) {
    this.#a -= qe;
    if (isMps && this.#a >= 0x8000) return false;
    if (isMps === this.#a < qe) {
      this.#c += this.#a;
      this.#a = qe;
    }
    do {
      this.#a <<= 1;
      this.#c <<= 1;
      if (--this.#ct === 0) this.#byte();
    } while (this.#a < 0x8000);
    return true;
  }

  #byte() {
    if (this.#c >> 27) {
      let at = this.#bytes.length - 1;
      for (; this.#bytes[at] === 255; at--) this.#bytes[at] = 0;
      this.#bytes[at]++;
    }
    this.#bytes.push((this.#c >> 19) & 255);
    this.#c &= 0x7ffff;
    this.#ct = 8;
  }

  /** Returns whether the bin went to its next state. */
  decide(bins: Uint8Array, bin: number, bit: number) {
    const state = states[bins[bin] & 127];
    const isMps = bit === bins[bin] >> 7;
    if (!this.#code(state.qe, isMps)) return false;
    bins[bin] = (bins[bin] & 128) ^ (isMps ? state.nextMps : state.nextLps);
    return true;
  }

  /** With the fixed probability estimate. */
  evenly(bit: number) {
    this.#code(states[0].qe, bit === 0);
  }

  /** Figures F.8 and F.9, from bin `x` on: X1 for DC, X2 for AC. */
  #magnitude(bins: Uint8Array, x: number, value: number, top: number) {
    for (; top * 2 <= value; top *= 2) this.decide(bins, x++, 1);
    this.decide(bins, x, 0);
    for (let bit = top >> 1; bit; bit >>= 1) this.decide(bins, x + 14, value & bit ? 1 : 0);
    return top;
  }

  /** F.1.4.1 */
  difference(table: number, component: number, difference: number) {
    const [bins, context] = [this.dc(table), this.#contexts[component]];
    this.decide(bins, context, difference ? 1 : 0);
    this.#contexts[component] = 0;
    if (!difference) return;
    const [sign, value] = difference < 0 ? [1, -difference - 1] : [0, difference - 1];
    this.decide(bins, context + 1, sign);
    this.decide(bins, context + 2 + sign, value ? 1 : 0);
    const top = value ? this.#magnitude(bins, 20, value, 1) : 0;
    const bounds = this.conditioning[table] ?? 0x10;
    if (top > (1 << (bounds >> 4)) >> 1) this.#contexts[component] = 12 + sign * 4;
    else if (top >= (1 << (bounds & 15)) >> 1) this.#contexts[component] = 4 + sign * 4;
  }

  /** F.1.4.2, G.1.3.2 and G.1.3.3 */
  band(table: number, block: Int32Array, ss: number, se: number, ah: number, al: number) {
    const bins = this.ac(table);
    let end = se;
    while (end >= ss && Math.abs(block[end]) >> al === 0) end--;
    let endBefore = ah ? end : 0;
    while (endBefore >= ss && Math.abs(block[endBefore]) >> ah === 0) endBefore--;
    for (let k = ss; k <= end; k++) {
      if (k > endBefore) this.decide(bins, 3 * (k - 1), 0);
      for (; Math.abs(block[k]) >> al === 0; k++) this.decide(bins, 3 * (k - 1) + 1, 0);
      const [bin, magnitude] = [3 * (k - 1), Math.abs(block[k]) >> al];
      if (ah && magnitude > 1) {
        this.decide(bins, bin + 2, magnitude & 1);
        continue;
      }
      this.decide(bins, bin + 1, 1);
      this.evenly(block[k] < 0 ? 1 : 0);
      if (ah) continue;
      this.decide(bins, bin + 2, magnitude > 1 ? 1 : 0);
      if (magnitude > 1) this.decide(bins, bin + 2, magnitude > 2 ? 1 : 0);
      if (magnitude > 2) this.#magnitude(bins, k <= (this.conditioning[16 + table] ?? 5) ? 189 : 217, magnitude - 1, 2);
    }
    if (end < se) this.decide(bins, 3 * end, 1);
  }

  /** D.1.8: the bytes, without trailing zeros. */
  finish() {
    const rounded = (this.#a - 1 + this.#c) & 0xffff0000;
    this.#c = (rounded < this.#c ? rounded + 0x8000 : rounded) << this.#ct;
    this.#byte();
    this.#c <<= 8;
    this.#byte();
    while (this.#bytes.at(-1) === 0) this.#bytes.pop();
    return this.#bytes;
  }
}
