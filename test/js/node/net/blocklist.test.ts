import { estimateShallowMemoryUsageOf } from "bun:jsc";
import { beforeAll, describe, expect, it } from "bun:test";
import { BlockList, SocketAddress } from "node:net";

// Expected values verified against Node.js v26.3.0. From v26.8.0 and v24.21.0, Node.js lists the rules by kind and drops duplicates (nodejs/node#64974).
describe("net.BlockList rules", () => {
  it("lists the newest rule first", () => {
    const blockList = new BlockList();
    expect(blockList.rules).toEqual([]);

    blockList.addAddress("1.1.1.1");
    blockList.addSubnet("2.2.2.0", 24);
    const two = blockList.rules;
    expect(two).toEqual(["Subnet: IPv4 2.2.2.0/24", "Address: IPv4 1.1.1.1"]);

    blockList.addRange("3.3.3.3", "3.3.3.9");
    blockList.addAddress("::1", "ipv6");
    expect(blockList.rules).toEqual([
      "Address: IPv6 ::1",
      "Range: IPv4 3.3.3.3-3.3.3.9",
      "Subnet: IPv4 2.2.2.0/24",
      "Address: IPv4 1.1.1.1",
    ]);
    expect(two).toEqual(["Subnet: IPv4 2.2.2.0/24", "Address: IPv4 1.1.1.1"]);
  });

  it("keeps a rule that is added twice", () => {
    const blockList = new BlockList();
    blockList.addAddress("1.1.1.1");
    blockList.addSubnet("2.2.2.0", 24);
    blockList.addAddress("1.1.1.1");
    expect(blockList.rules).toEqual(["Address: IPv4 1.1.1.1", "Subnet: IPv4 2.2.2.0/24", "Address: IPv4 1.1.1.1"]);
  });

  it("an add that throws leaves the rules as they were", () => {
    const blockList = new BlockList();
    blockList.addAddress("1.1.1.1");
    // @ts-expect-error
    expect(() => blockList.addAddress(1)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(() => blockList.addRange("3.3.3.9", "3.3.3.3")).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
    );
    expect(() => blockList.addSubnet("2.2.2.0", 33)).toThrow(expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }));
    expect(blockList.rules).toEqual(["Address: IPv4 1.1.1.1"]);
  });

  it("a clone and its source share one list", () => {
    const blockList = new BlockList();
    blockList.addAddress("1.1.1.1");
    const clone = structuredClone(blockList);
    clone.addSubnet("2.2.2.0", 24);
    blockList.addRange("3.3.3.3", "3.3.3.9");
    const rules = ["Range: IPv4 3.3.3.3-3.3.3.9", "Subnet: IPv4 2.2.2.0/24", "Address: IPv4 1.1.1.1"];
    expect(blockList.rules).toEqual(rules);
    expect(clone.rules).toEqual(rules);
    expect(clone.check("2.2.2.2")).toBe(true);
    expect(blockList.check("2.2.2.2")).toBe(true);
  });

  it("keeps the order and every rule while the list grows", () => {
    const blockList = new BlockList();
    const newestFirst: string[] = [];
    const blocked: [address: string, family: "ipv4" | "ipv6"][] = [];
    for (let i = 0; i < 1100; i++) {
      const [a, b, hex] = [i >> 8, i & 255, i.toString(16)];
      switch (i % 6) {
        case 0:
          blockList.addAddress(`10.0.${a}.${b}`);
          newestFirst.unshift(`Address: IPv4 10.0.${a}.${b}`);
          blocked.push([`10.0.${a}.${b}`, "ipv4"]);
          break;
        case 1:
          blockList.addRange(`10.1.${b}.${a * 10}`, `10.1.${b}.${a * 10 + 9}`);
          newestFirst.unshift(`Range: IPv4 10.1.${b}.${a * 10}-10.1.${b}.${a * 10 + 9}`);
          blocked.push([`10.1.${b}.${a * 10 + 5}`, "ipv4"]);
          break;
        case 2:
          blockList.addSubnet(`10.${2 + a}.${b}.0`, 24);
          newestFirst.unshift(`Subnet: IPv4 10.${2 + a}.${b}.0/24`);
          blocked.push([`10.${2 + a}.${b}.77`, "ipv4"]);
          break;
        case 3:
          blockList.addAddress(`fd00::${hex}`, "ipv6");
          newestFirst.unshift(`Address: IPv6 fd00::${hex}`);
          blocked.push([`fd00::${hex}`, "ipv6"]);
          break;
        case 4:
          blockList.addRange(`fd01::${hex}:0`, `fd01::${hex}:9`, "ipv6");
          newestFirst.unshift(`Range: IPv6 fd01::${hex}:0-fd01::${hex}:9`);
          blocked.push([`fd01::${hex}:5`, "ipv6"]);
          break;
        case 5:
          blockList.addSubnet(`fd02:${hex}::`, 64, "ipv6");
          newestFirst.unshift(`Subnet: IPv6 fd02:${hex}::/64`);
          blocked.push([`fd02:${hex}::77`, "ipv6"]);
          break;
      }
      // The buffer of the list doubles when the number of rules passes a power of two.
      const size = i + 1;
      if (size > 2 && [size - 1, size, size + 1].some(n => (n & (n - 1)) === 0)) {
        expect(blockList.rules).toEqual(newestFirst);
      }
    }
    expect(blockList.rules).toEqual(newestFirst);
    expect(blocked.filter(([address, family]) => !blockList.check(address, family))).toEqual([]);
    const allowed = [
      ["10.0.0.1", "ipv4"],
      ["10.1.1.10", "ipv4"],
      ["10.3.0.77", "ipv4"],
      ["fd00::1", "ipv6"],
      ["fd01::4:a", "ipv6"],
      ["fd03::77", "ipv6"],
    ] as const;
    expect(allowed.filter(([address, family]) => blockList.check(address, family))).toEqual([]);
  });

  it("each kind of rule adds the same size to the list", () => {
    const blockList = new BlockList();
    const sizes = [estimateShallowMemoryUsageOf(blockList)];
    blockList.addAddress("1.1.1.1");
    sizes.push(estimateShallowMemoryUsageOf(blockList));
    blockList.addRange("3.3.3.3", "3.3.3.9");
    sizes.push(estimateShallowMemoryUsageOf(blockList));
    blockList.addSubnet("2.2.2.0", 24);
    sizes.push(estimateShallowMemoryUsageOf(blockList));

    const [empty, one] = sizes;
    const rule = one - empty;
    expect(rule).toBeGreaterThan(0);
    expect(sizes).toEqual([empty, empty + rule, empty + 2 * rule, empty + 3 * rule]);
  });

  describe("on a list of 50,000 rules", () => {
    // Parsed addresses keep a call short, so that a slow add or check() shows in a debug build too.
    let addresses: SocketAddress[];
    let large: BlockList;

    beforeAll(() => {
      addresses = Array.from({ length: 320 }, (_, i) => new SocketAddress({ address: `10.0.${i >> 8}.${i & 255}` }));
      // Each rule is a different range, so that a list that drops duplicates holds them all too.
      large = new BlockList();
      for (let i = 0, size = 0; size < 50_000; i++) {
        for (let j = i; j < addresses.length && size < 50_000; j++, size++) large.addRange(addresses[i], addresses[j]);
      }
      const one = new BlockList();
      one.addRange(addresses[0], addresses[1]);
      const empty = estimateShallowMemoryUsageOf(new BlockList());
      expect(estimateShallowMemoryUsageOf(large) - empty).toBe(50_000 * (estimateShallowMemoryUsageOf(one) - empty));
    });

    function time(list: BlockList, call: (list: BlockList) => unknown, count: number) {
      const before = performance.now();
      for (let i = 0; i < count; i++) call(list);
      return performance.now() - before;
    }

    // Each add put the new rule at the front of a Vec, which moved every rule of the list: 60,000 adds took over a second.
    it("an add costs the same as on an empty list", () => {
      const [start, end] = addresses;
      const adds = {
        addAddress: (list: BlockList) => list.addAddress(start),
        addRange: (list: BlockList) => list.addRange(start, end),
        addSubnet: (list: BlockList) => list.addSubnet(start, 24),
      };
      for (const [name, add] of Object.entries(adds)) {
        // The best of many short interleaved runs, so that a busy machine does not decide the ratio.
        let onEmpty = Infinity;
        let onLarge = Infinity;
        for (let run = 0; run < 30; run++) {
          onEmpty = Math.min(onEmpty, time(new BlockList(), add, 100));
          onLarge = Math.min(onLarge, time(large, add, 100));
        }
        // About 1 when an add moves no rule. With the move it was 5 in a debug build with ASAN and over 200 in a release build.
        expect(onLarge / onEmpty, name).toBeLessThan(3);
      }
    });

    it("a check() that hits the newest rule costs the same as on a list of one rule", () => {
      const newest = new SocketAddress({ address: "192.0.2.1" });
      const check = (list: BlockList) => list.check(newest);
      const short = new BlockList();
      short.addAddress(newest);
      large.addAddress(newest);
      expect(check(large)).toBe(true);

      let onShort = Infinity;
      let onLarge = Infinity;
      for (let run = 0; run < 20; run++) {
        onShort = Math.min(onShort, time(short, check, 60));
        onLarge = Math.min(onLarge, time(large, check, 60));
      }
      // About 1 when check() reaches the newest rule first. Over 100 when it reaches the 50,000 older rules first.
      expect(onLarge / onShort).toBeLessThan(3);
    });
  });
});
