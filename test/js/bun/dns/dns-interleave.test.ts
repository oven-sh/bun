import { describe, expect, test } from "bun:test";
import { dnsInternals } from "bun:internal-for-testing";

// When fetch()/Bun.connect() resolves a dual-stack hostname, the internal DNS
// cache (used by the usockets connect path) packs the getaddrinfo result into
// a flat array and is supposed to interleave address families so that, with
// the four parallel connection attempts usockets opens, both families are
// represented in the first batch. If the interleave is broken and the
// resolver returned the AAAA records first (the default on most dual-stack
// hosts), a network with broken IPv6 makes every initial attempt hang until
// the kernel gives up on the SYN retries.
//
// This exercises the exact reorder routine that feeds usockets.

const { interleaveAddresses } = dnsInternals;

function families(input: number[]): number[] {
  return interleaveAddresses(input).map(e => e.family);
}

function indices(input: number[]): number[] {
  return interleaveAddresses(input).map(e => e.index);
}

describe("internal DNS connect-order interleave", () => {
  test("AAAA-heavy result gets IPv4 into the first batch", () => {
    // The motivating case: 4+ IPv6 addresses (all dead on a broken-v6 network)
    // ahead of a single reachable IPv4 address. Without interleaving, the first
    // CONCURRENT_CONNECTIONS (4) attempts are all IPv6.
    const out = families([6, 6, 6, 6, 4]);
    expect(out).toEqual([6, 4, 6, 6, 6]);
    // The first four addresses (the first parallel-connect batch in usockets)
    // must include both families.
    expect(new Set(out.slice(0, 4))).toEqual(new Set([4, 6]));
  });

  test("A-heavy result gets IPv6 into the first batch", () => {
    expect(families([4, 4, 4, 4, 6])).toEqual([4, 6, 4, 4, 4]);
  });

  test("already-grouped input alternates fully", () => {
    expect(families([6, 6, 6, 4, 4, 4])).toEqual([6, 4, 6, 4, 6, 4]);
    expect(families([4, 4, 4, 6, 6, 6])).toEqual([4, 6, 4, 6, 4, 6]);
  });

  test("first address stays first", () => {
    // The resolver's ordering preference for the first address is respected.
    expect(families([6, 4, 4, 4])[0]).toBe(6);
    expect(families([4, 6, 6, 6])[0]).toBe(4);
  });

  test("already-interleaved input is unchanged", () => {
    expect(indices([6, 4, 6, 4, 6, 4])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(indices([4, 6, 4, 6])).toEqual([0, 1, 2, 3]);
  });

  test("single-family input is unchanged", () => {
    expect(indices([6, 6, 6, 6])).toEqual([0, 1, 2, 3]);
    expect(indices([4, 4, 4])).toEqual([0, 1, 2]);
    expect(indices([4])).toEqual([0]);
  });

  test("relative order within each family is preserved", () => {
    // Stable interleave: within the IPv6 group, original indices 0,1,2 stay
    // in that order; same for IPv4 indices 3,4,5.
    const out = interleaveAddresses([6, 6, 6, 4, 4, 4]);
    const v6order = out.filter(e => e.family === 6).map(e => e.index);
    const v4order = out.filter(e => e.family === 4).map(e => e.index);
    expect(v6order).toEqual([0, 1, 2]);
    expect(v4order).toEqual([3, 4, 5]);
  });

  test("uneven counts: extra addresses of one family go at the end", () => {
    expect(families([6, 6, 6, 6, 6, 4, 4])).toEqual([6, 4, 6, 4, 6, 6, 6]);
    expect(families([4, 6, 6, 6, 6, 6])).toEqual([4, 6, 6, 6, 6, 6]);
  });

  test("empty and single-element inputs", () => {
    expect(families([])).toEqual([]);
    expect(families([4])).toEqual([4]);
    expect(families([6])).toEqual([6]);
  });

  test("every non-trivial dual-stack result has both families in the first four", () => {
    // Exhaustive over small inputs: whenever both families are present and
    // there are at least two addresses, the first min(4, n) must include both.
    for (let n = 2; n <= 7; n++) {
      for (let mask = 0; mask < 1 << n; mask++) {
        const input: number[] = [];
        for (let i = 0; i < n; i++) input.push(mask & (1 << i) ? 6 : 4);
        if (!input.includes(4) || !input.includes(6)) continue;
        const out = families(input);
        const head = new Set(out.slice(0, Math.min(4, n)));
        expect({ input, head: [...head].sort() }).toEqual({ input, head: [4, 6] });
        // And it must be a permutation of the input.
        expect(out.toSorted()).toEqual(input.toSorted());
      }
    }
  });
});
