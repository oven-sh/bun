import { test, it, describe, expect } from "bun:test";
import { withoutAggressiveGC } from "gc";
import * as _ from "lodash";

function rebase(str, inBase, outBase) {
  const mapBase = b => (b === 2 ? 32 : b === 16 ? 8 : null);
  const stride = mapBase(inBase);
  const pad = mapBase(outBase);
  if (!stride) throw new Error(`Bad inBase ${inBase}`);
  if (!pad) throw new Error(`Bad outBase ${outBase}`);
  if (str.length % stride) throw new Error(`Bad string length ${str.length}`);
  const out = [];
  for (let i = 0; i < str.length; i += stride)
    out.push(
      parseInt(str.slice(i, i + stride), inBase)
        .toString(outBase)
        .padStart(pad, "0"),
    );
  return out.join("");
}

function expectDeepEqual(a, b) {
  expect(a).toEqual(b);
}
class HashMaker {
  constructor(length) {
    this.length = length;
    this._dist = {};
  }
  length: number;
  _dist: any;

  binToHex(binHash) {
    if (binHash.length !== this.length) throw new Error(`Hash length mismatch ${this.length} != ${binHash.length}`);
    return rebase(binHash, 2, 16);
  }

  makeBits() {
    const bits = [];
    for (let i = 0; i < this.length; i++) bits.push(i);
    return _.shuffle(bits);
  }

  makeRandom() {
    const bits = [];
    for (let i = 0; i < this.length; i++) bits.push(Math.random() < 0.5 ? 1 : 0);
    return bits;
  }

  get keySet() {
    return (this._set = this._set || new Set(this.data));
  }

  randomKey() {
    while (true) {
      const hash = this.binToHex(this.makeRandom().join(""));
      if (!this.keySet.has(hash)) return hash;
    }
  }

  get data() {
    return (this._data =
      this._data ||
      (() => {
        const bits = this.makeBits();
        const base = this.makeRandom();
        const data = [];
        for (let stride = 0; bits.length; stride++) {
          const flip = bits.splice(0, stride);
          for (const bit of flip) base[bit] = 1 - base[bit];
          data.push(this.binToHex(base.join("")));
        }
        return data;
      })());
  }

  get random() {
    const d = this.data;
    return d[Math.floor(Math.random() * d.length)];
  }

  distance(a, b) {
    const bitCount = n => {
      n = n - ((n >> 1) & 0x55555555);
      n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
      return (((n + (n >> 4)) & 0xf0f0f0f) * 0x1010101) >> 24;
    };

    if (a === b) return 0;
    if (a > b) return this.distance(b, a);
    const hash = a + "-" + b;
    return (this._dist[hash] =
      this._dist[hash] ||
      (() => {
        let dist = 0;
        for (let i = 0; i < a.length; i += 8) {
          const va = parseInt(a.slice(i, i + 8), 16);
          const vb = parseInt(b.slice(i, i + 8), 16);
          dist += bitCount(va ^ vb);
        }
        return dist;
      })());
  }

  query(baseKey, maxDist) {
    const out = [];
    for (const key of this.data) {
      const distance = this.distance(key, baseKey);
      if (distance <= maxDist) out.push({ key, distance });
    }
    return out.sort((a, b) => a.distance - b.distance);
  }
}

const treeClass = require("bktree-fast/native");

withoutAggressiveGC(() => {
  // this test is too slow
  for (let keyLen = 64; keyLen <= 64; keyLen += 64) {
    // for (let keyLen = 64; keyLen <= 512; keyLen += 64) {
    const hm = new HashMaker(keyLen);
    describe(`Key length: ${keyLen}`, () => {
      it("should compute distance", () => {
        const tree = new treeClass(keyLen);
        for (const a of hm.data) for (const b of hm.data) expect(tree.distance(a, b)).toBe(hm.distance(a, b));
      });

      it("should know which keys it has", () => {
        const tree = new treeClass(keyLen).add(hm.data);
        expectDeepEqual(
          hm.data.map(hash => tree.has(hash)),
          hm.data.map(() => true),
        );
        // Not interested in the hash
        for (const hash of hm.data) expect(tree.has(hm.randomKey())).toBe(false);
      });

      it("should know the tree size", () => {
        const tree = new treeClass(keyLen, { foo: 1 });
        expect(tree.size).toBe(0);
        tree.add(hm.data);
        expect(tree.size).toBe(hm.data.length);
        tree.add(hm.data);
        expect(tree.size).toBe(hm.data.length);
      });

      it("should walk the tree", () => {
        const tree = new treeClass(keyLen).add(hm.data);
        const got = [];
        tree.walk((hash, depth) => got.push(hash));
        expectDeepEqual(got.sort(), hm.data.slice(0).sort());
      });

      it("should query", () => {
        ((treeClass, expectDeepEqual) => {
          const tree = new treeClass(keyLen).add(hm.data);

          for (let dist = 0; dist <= hm.length; dist++) {
            for (const baseKey of [hm.random, hm.data[0]]) {
              const baseKey = hm.random;
              const got = [];
              tree.query(baseKey, dist, (key, distance) => got.push({ key, distance }));
              const want = hm.query(baseKey, dist);
              expectDeepEqual(
                got.sort((a, b) => a.distance - b.distance),
                want,
              );
              expectDeepEqual(tree.find(baseKey, dist), want);
            }
          }
        })(treeClass, expectDeepEqual);
      });
    });
  }

  describe("Misc functions", () => {
    it("should pad keys", () => {
      const tree = new treeClass(64);
      expect(tree.padKey("1")).toBe("0000000000000001");
      tree.add(["1", "2", "3"]);

      const got = [];
      tree.query("2", 3, (hash, distance) => got.push({ hash, distance }));
      const res = got.sort((a, b) => a.distance - b.distance);
      const want = [
        { hash: "0000000000000002", distance: 0 },
        { hash: "0000000000000003", distance: 1 },
        { hash: "0000000000000001", distance: 2 },
      ];

      expectDeepEqual(res, want);
    });
  });
});
