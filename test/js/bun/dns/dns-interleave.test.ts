// The internal DNS cache (used by the usockets connect path for fetch(),
// Bun.connect() and `bun install`) packs getaddrinfo results into a flat
// array and is supposed to interleave address families (RFC 8305 §4) so that
// the four parallel connection attempts usockets opens always cover both
// families. registry.npmjs.org resolves to 12 AAAA + 12 A; on a dual-stack
// host with blackholed IPv6, a broken interleave leaves all four initial
// attempts on dead IPv6 and every manifest fetch stalls for ~100s waiting on
// kernel SYN-retry exhaustion.
//
// https://github.com/oven-sh/bun/issues/4938
// https://github.com/oven-sh/bun/issues/33278
import { dnsInternals } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";

const { getaddrinfoInterleave } = dnsInternals;

// Entries are encoded as family * 1000 + original resolver index.
const families = (input: number[]) => getaddrinfoInterleave(input).map(e => Math.floor(e / 1000));
const indices = (input: number[]) => getaddrinfoInterleave(input).map(e => e % 1000);

describe("internal getaddrinfo interleave (RFC 8305)", () => {
  test("registry.npmjs.org shape: 12 AAAA + 12 A puts IPv4 in the first batch", () => {
    const input = [...Array(12).fill(6), ...Array(12).fill(4)];
    const out = families(input);
    expect(out.slice(0, 4)).toEqual([6, 4, 6, 4]);
    expect(out).toEqual(Array(12).fill([6, 4]).flat());
  });

  test("AAAA-heavy result gets IPv4 into the first batch", () => {
    // 4+ dead IPv6 ahead of one reachable IPv4. Without interleaving, the
    // first CONCURRENT_CONNECTIONS (4) attempts are all IPv6.
    const out = getaddrinfoInterleave([6, 6, 6, 6, 4]);
    expect(out).toEqual([6000, 4004, 6001, 6002, 6003]);
    expect(new Set(families([6, 6, 6, 6, 4]).slice(0, 4))).toEqual(new Set([4, 6]));
  });

  test("A-heavy result gets IPv6 into the first batch", () => {
    expect(getaddrinfoInterleave([4, 4, 4, 4, 6])).toEqual([4000, 6004, 4001, 4002, 4003]);
  });

  test("first address stays first (respects OS RFC 6724 preference)", () => {
    expect(families([6, 4, 4, 4])[0]).toBe(6);
    expect(families([4, 6, 6, 6])[0]).toBe(4);
  });

  test("already-grouped input alternates fully", () => {
    expect(getaddrinfoInterleave([6, 6, 6, 4, 4, 4])).toEqual([6000, 4003, 6001, 4004, 6002, 4005]);
    expect(getaddrinfoInterleave([4, 4, 4, 6, 6, 6])).toEqual([4000, 6003, 4001, 6004, 4002, 6005]);
  });

  test("uneven counts: surplus family keeps resolver order at the tail", () => {
    expect(getaddrinfoInterleave([6, 6, 6, 6, 4, 4])).toEqual([6000, 4004, 6001, 4005, 6002, 6003]);
    expect(getaddrinfoInterleave([6, 4, 4, 4])).toEqual([6000, 4001, 4002, 4003]);
  });

  test("already-interleaved input is preserved", () => {
    expect(getaddrinfoInterleave([6, 4, 6, 4])).toEqual([6000, 4001, 6002, 4003]);
    expect(indices([4, 6, 4, 6])).toEqual([0, 1, 2, 3]);
  });

  test("single-family input is unchanged", () => {
    expect(indices([6, 6, 6, 6])).toEqual([0, 1, 2, 3]);
    expect(indices([4, 4, 4])).toEqual([0, 1, 2]);
  });

  test("relative order within each family is preserved", () => {
    const out = getaddrinfoInterleave([6, 6, 6, 4, 4, 4]);
    expect(out.filter(e => e >= 6000)).toEqual([6000, 6001, 6002]);
    expect(out.filter(e => e < 6000)).toEqual([4003, 4004, 4005]);
  });

  test("empty and single-element inputs", () => {
    expect(getaddrinfoInterleave([])).toEqual([]);
    expect(getaddrinfoInterleave([4])).toEqual([4000]);
    expect(getaddrinfoInterleave([6])).toEqual([6000]);
  });

  test("exhaustive: every dual-stack result has both families in the first four", () => {
    // Whenever both families are present, the first min(4, n) slots must
    // include both, and the output is a permutation of the input with
    // resolver order preserved within each family.
    for (let n = 2; n <= 8; n++) {
      for (let mask = 0; mask < 1 << n; mask++) {
        const input: number[] = [];
        for (let i = 0; i < n; i++) input.push(mask & (1 << i) ? 6 : 4);
        const out = getaddrinfoInterleave(input);
        const outFamilies = out.map(e => Math.floor(e / 1000));
        // permutation of the input
        expect(outFamilies.toSorted()).toEqual(input.toSorted());
        // stable within each family
        expect(out.filter(e => e >= 6000)).toEqual(out.filter(e => e >= 6000).toSorted((a, b) => a - b));
        expect(out.filter(e => e < 6000)).toEqual(out.filter(e => e < 6000).toSorted((a, b) => a - b));
        if (!input.includes(4) || !input.includes(6)) continue;
        // both families in the first connect batch
        const head = new Set(outFamilies.slice(0, Math.min(4, n)));
        expect({ input, head: [...head].sort() }).toEqual({ input, head: [4, 6] });
      }
    }
  });
});
