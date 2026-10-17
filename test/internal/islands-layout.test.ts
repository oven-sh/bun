import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeTable,
  encodeTable,
  inTableOrder,
  isPlan,
  itemsOf,
  misplaced,
  pageSize,
  placeKinds,
  rangesThatCanGo,
  readPlan,
  roomFor,
  runsOf,
  wholePages,
  writePlan,
  xxh3,
  type Layout,
  type Needs,
  type Table,
} from "../../scripts/build/islands-layout.ts";
import { packageOf } from "./icu-data-package.ts";

type Section = [
  size: number,
  neededBy: string | "stays",
  options?: { output?: string; gap?: number; alignment?: number },
];

function laidOut(sections: Section[], start = 0x200000): Layout & Needs {
  const result = { address: [], size: [], alignment: [], output: [], core: new Set(), neededBy: new Map() } as Layout &
    Needs;
  let address = start;
  sections.forEach(([size, neededBy, options = {}], node) => {
    address += options.gap ?? 0;
    result.address.push(address);
    result.size.push(size);
    result.alignment.push(options.alignment ?? 16);
    result.output.push(options.output ?? ".text");
    if (neededBy === "stays") result.core.add(node);
    else result.neededBy.set(node, neededBy);
    address += size;
  });
  return result;
}

const isMovable = (output: string) => output === ".text" || output === ".rodata";
const stretches = (layout: Layout & Needs) =>
  rangesThatCanGo(layout, layout, isMovable).map(({ start, end, features }) => [
    start - 0x200000,
    end - 0x200000,
    features,
  ]);

describe("the stretches of an executable that can go", () => {
  test("sections that lie together are one stretch for each set of features, and the stretches abut", () => {
    const layout = laidOut([
      [0x100, "stays"],
      [0x6000, "tools"],
      [0x2000, "tools"],
      [0x3000, "tools,jit"],
      [0x5000, "jit"],
      [0x100, "stays"],
    ]);
    expect(stretches(layout)).toEqual([
      [0x100, 0x8100, "tools"],
      [0x8100, 0xb100, "tools,jit"],
      [0xb100, 0x10100, "jit"],
    ]);
    expect(misplaced(layout, layout, rangesThatCanGo(layout, layout, isMovable))).toBe(0);
  });

  test("a section that stays is in no stretch, wherever a plan has put it", () => {
    const layout = laidOut([
      [0x8000, "tools"],
      [0x40, "stays"],
      [0x8000, "tools"],
    ]);
    expect(stretches(layout)).toEqual([
      [0, 0x8000, "tools"],
      [0x8040, 0x10040, "tools"],
    ]);
  });

  test("padding between two sets of features belongs to the first", () => {
    const layout = laidOut([
      [0x7ff8, "tools"],
      [0x8000, "jit", { gap: 8 }],
    ]);
    expect(stretches(layout)).toEqual([
      [0, 0x8000, "tools"],
      [0x8000, 0x10000, "jit"],
    ]);
  });

  test("a run shorter than a page is not listed", () => {
    expect(
      stretches(
        laidOut([
          [pageSize - 16, "tools"],
          [0x40, "stays"],
          [pageSize, "tools"],
        ]),
      ),
    ).toEqual([[pageSize + 0x30, 2 * pageSize + 0x30, "tools"]]);
  });

  test("bytes that no section accounts for end a run", () => {
    const layout = laidOut([
      [0x8000, "tools"],
      [0x8000, "tools", { gap: 64, alignment: 16 }],
    ]);
    expect(stretches(layout)).toEqual([
      [0, 0x8000, "tools"],
      [0x8040, 0x10040, "tools"],
    ]);
  });

  test("another output section ends a run, and one that cannot be cut is never listed", () => {
    const layout = laidOut([
      [0x8000, "tools"],
      [0x8000, "tools", { output: ".rodata" }],
      [0x8000, "tools", { output: ".data" }],
    ]);
    expect(stretches(layout)).toEqual([
      [0, 0x8000, "tools"],
      [0x8000, 0x10000, "tools"],
    ]);
    expect(wholePages(rangesThatCanGo(layout, layout, isMovable))).toBe(0x10000);
  });

  test("the largest runs are kept when there are too many", () => {
    const sections: Section[] = [];
    for (let index = 0; index < 2100; index++) sections.push([pageSize + index * 16, "tools"], [16, "stays"]);
    const kept = rangesThatCanGo(laidOut(sections), laidOut(sections), isMovable);
    expect(kept.length).toBe(2048);
    expect(Math.min(...kept.map(range => range.end - range.start))).toBe(pageSize + 52 * 16);
  });
});

describe("the check over the stretches", () => {
  const layout = laidOut([
    [0x8000, "tools"],
    [0x40, "stays"],
    [0x8000, "jit"],
  ]);

  test("finds a section that stays within a stretch", () => {
    expect(misplaced(layout, layout, [{ start: 0x200000, end: 0x208040, features: "tools" }])).toBe(1);
  });

  test("finds a section that other features need", () => {
    expect(misplaced(layout, layout, [{ start: 0x208040, end: 0x210040, features: "tools" }])).toBe(1);
  });

  test("finds a section of which only the end lies in a stretch", () => {
    expect(misplaced(layout, layout, [{ start: 0x208020, end: 0x208040, features: "tools" }])).toBe(1);
  });
});

describe("whole pages", () => {
  test("stretches that abut count as one; the broken pages at both ends do not count", () => {
    expect(
      wholePages([
        { start: 0x200100, end: 0x208100, features: "tools" },
        { start: 0x208100, end: 0x210100, features: "jit" },
      ]),
    ).toBe(0x10000 - pageSize);
    expect(
      wholePages([
        { start: 0x200100, end: 0x208100, features: "tools" },
        { start: 0x208140, end: 0x210100, features: "jit" },
      ]),
    ).toBe(0x10000 - 2 * pageSize);
  });
});

describe("a plan", () => {
  const plan = {
    doors: ["_ZN3JSC21installImageCompilerEv"],
    islands: [
      { features: "tools", names: ["a", "b.llvm.123"] },
      { features: "tools,jit", names: ["c"] },
    ],
  };

  test("is read as it was written", () => {
    using dir = tempDir("islands-plan", {});
    const path = join(String(dir), "islands.plan");
    writePlan(path, plan, "0123abcd");
    expect(readFileSync(path, "utf8")).toBe(
      "bun-islands-plan 1\nfor 0123abcd\ndoor _ZN3JSC21installImageCompilerEv\nisland tools\na\nb.llvm.123\nisland tools,jit\nc\n",
    );
    expect(readPlan(path, ["tools", "jit"], "0123abcd")).toEqual(plan);
    expect(isPlan(path)).toBe(true);
    writePlan(path, { ...plan, tableBytes: 33378 }, "0123abcd");
    expect(readFileSync(path, "utf8")).toStartWith("bun-islands-plan 1\nfor 0123abcd\ntable 33378\ndoor ");
    expect(readPlan(path, ["tools", "jit"], "0123abcd")).toEqual({ ...plan, tableBytes: 33378 });
  });

  test("loses the islands of features that are no longer declared", () => {
    using dir = tempDir("islands-plan", {});
    const path = join(String(dir), "islands.plan");
    writePlan(path, plan, "0123abcd");
    expect(readPlan(path, ["tools"], "0123abcd")?.islands).toEqual([plan.islands[0]!]);
    expect(readPlan(path, ["bundler"], "0123abcd")).toBeUndefined();
  });

  test("is not taken when it was made for other doors", () => {
    using dir = tempDir("islands-plan", {});
    const path = join(String(dir), "islands.plan");
    writePlan(path, plan, "0123abcd");
    expect(readPlan(path, ["tools", "jit"], "89ef4567")).toBeUndefined();
    expect(isPlan(path)).toBe(true);
  });

  test("is not there when the file is the placeholder, is missing or was not named", () => {
    using dir = tempDir("islands-plan", {});
    const path = join(String(dir), "islands.plan");
    writeFileSync(path, "no plan yet\n");
    expect(readPlan(path, ["tools"], "0123abcd")).toBeUndefined();
    expect(readPlan(join(String(dir), "none"), ["tools"], "0123abcd")).toBeUndefined();
    expect(readPlan(undefined, ["tools"], "0123abcd")).toBeUndefined();
    expect([path, join(String(dir), "none"), undefined].map(isPlan)).toEqual([false, false, false]);
  });
});

describe("the table of islands", () => {
  const small: Table = {
    stub: 0x201234,
    smallestDoor: { exit: 12, return: 8 },
    features: ["tools", "jit", "text"],
    conditions: [
      { feature: "jit", kind: "world", name: "open" },
      { feature: "text", kind: "world", name: "open" },
      { feature: "text", kind: "Bun", name: "Transpiler" },
    ],
    islands: [
      { start: 0x204000, end: 0x208000, features: "tools" },
      { start: 0x208000, end: 0x20c010, features: "tools,jit" },
      { start: 0x300000, end: 0x304000, features: "tools" },
    ],
    doors: [
      { address: 0x201000, feature: "tools", whenShut: "exit" },
      {
        address: 0x201080,
        feature: "tools",
        whenShut: "exit",
        places: [
          { address: 0x201301, kind: placeKinds.add32 },
          { address: 0x205001, kind: placeKinds.add32 },
          { address: 0x400008, kind: placeKinds.add64 },
        ],
      },
      {
        address: 0x201100,
        feature: "jit",
        whenShut: "return",
        places: [{ address: 0x201311, kind: placeKinds.add32 }],
      },
      { address: 0x201200, feature: "text", whenShut: "exit" },
    ],
  };
  const empty: Table = {
    stub: 0,
    smallestDoor: { exit: 0, return: 0 },
    features: [],
    conditions: [],
    islands: [],
    doors: [],
  };
  const header = Buffer.from("bun-islands 2\n");
  const inItsRoom = (table: Buffer) => Buffer.concat([table, Buffer.alloc(roomFor(table.length) - table.length)]);

  function large(features: number, stretches: number, doors: number): Table {
    let seed = 1;
    const below = (limit: number) => (seed = (seed * 48271) % 2147483647) % limit;
    const names = Array.from({ length: features }, (_, index) => `feature${index}`);
    const facts = Array.from({ length: features * 2 }, (_, index) => ({
      kind: ["Bun", "global", "module", "native"][index % 4]!,
      name: `node:name${index}`,
    }));
    const sets = Array.from({ length: Math.ceil(stretches / 2) }, () =>
      [...new Set(Array.from({ length: 1 + below(5) }, () => names[below(features)]!))].join(","),
    );
    let end = 0x200000;
    let address = 0;
    return {
      stub: 0x7654321,
      smallestDoor: { exit: 10, return: 3 },
      features: names,
      conditions: names.flatMap(feature =>
        Array.from({ length: 4 }, () => ({ feature, ...facts[below(facts.length)]! })),
      ),
      islands: Array.from({ length: stretches }, (_, index) => {
        const start = end + (below(10) === 0 ? 16384 * (1 + below(64)) : 0);
        end = start + 8 * (1 + below(16384));
        return { start, end, features: sets[index % sets.length]! };
      }),
      doors: Array.from({ length: doors }, (_, index) => {
        if (index % Math.ceil(doors / features) === 0) address = 0;
        const bits = [21, 14, 14, 14, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 4, 4, 4, 4][address === 0 ? 0 : below(20)]!;
        address += (1 << bits) + below(127 << bits);
        return { address, feature: names[Math.floor(index / Math.ceil(doors / features))]!, whenShut: "exit" };
      }),
    };
  }

  test("what is written is what is read, out of a room that is larger", () => {
    expect(decodeTable(inItsRoom(encodeTable(small)))).toEqual(small);
    expect(decodeTable(encodeTable(small))).toEqual(small);
    const table = large(120, 1500, 6000);
    expect(decodeTable(inItsRoom(encodeTable(table)))).toEqual(table);
  });

  test("these are the bytes that src/exe_islands/lib.rs is tested on", () => {
    expect(encodeTable(small).toString("hex")).toBe(
      "62756e2d69736c616e647320320a" +
        "b4a480010c08" +
        "0305746f6f6c73036a69740474657874" +
        "0205776f726c640342756e" +
        "0200046f70656e010a5472616e7370696c6572" +
        "000100020001" +
        "020100020001" +
        "0380808101ff7f00008f800101f0ff3cff7f00" +
        "0280a08001800100000180a280010180a4800100" +
        "0201" +
        "06" +
        "90e08410" +
        "80d007" +
        "b980f607" +
        "00" +
        "8002",
    );
  });

  test("a table of nothing", () => {
    expect(encodeTable(empty)).toEqual(Buffer.concat([header, Buffer.alloc(9)]));
    expect(decodeTable(inItsRoom(encodeTable(empty)))).toEqual(empty);
  });

  test("conditions are read by feature, and a fact that several features wait for is written once", () => {
    const conditions = [small.conditions[2]!, small.conditions[0]!, small.conditions[1]!];
    expect(decodeTable(encodeTable({ ...small, conditions })).conditions).toEqual([
      conditions[1]!,
      conditions[0]!,
      conditions[2]!,
    ]);
    expect(encodeTable(small).toString("latin1").split("open").length).toBe(2);
  });

  test("the largest numbers", () => {
    const most = Number.MAX_SAFE_INTEGER;
    const table: Table = {
      stub: most,
      smallestDoor: { exit: most, return: most },
      features: ["all"],
      conditions: [],
      islands: [
        { start: 0, end: 1, features: "all" },
        { start: 1, end: most, features: "all" },
      ],
      doors: [
        { address: 0, feature: "all", whenShut: "exit" },
        { address: most, feature: "all", whenShut: "exit" },
        { address: most, feature: "all", whenShut: "return" },
      ],
    };
    expect(decodeTable(encodeTable(table))).toEqual(table);
    for (const stub of [most + 1, -1, 0.5, NaN, Infinity])
      expect(() => encodeTable({ ...empty, stub })).toThrow("the table cannot hold the number");
    const withStub = (...number: number[]) => Buffer.concat([header, Buffer.from(number), Buffer.alloc(32)]);
    expect(decodeTable(withStub(0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f)).stub).toBe(most);
    expect(() => decodeTable(withStub(0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x10))).toThrow(
      "the table is malformed",
    );
    const pastTheEnd = encodeTable({ ...table, islands: [{ start: most - 1, end: most, features: "all" }], doors: [] });
    expect(decodeTable(pastTheEnd).islands[0]!.end).toBe(most);
    pastTheEnd[pastTheEnd.indexOf(Buffer.from("feffffffffffff0f", "hex")) + 8] = 1;
    expect(() => decodeTable(pastTheEnd)).toThrow("the table is malformed");
  });

  test("6,000 doors, 1,500 stretches and 120 features take less than 32 KB", () => {
    expect(encodeTable(large(120, 1500, 6000)).length).toBeLessThan(32768);
  });

  test("the room is the table's own size and a sixteenth, in whole kilobytes", () => {
    expect([0, 1, 960, 964, 33378].map(roomFor)).toEqual([0, 1024, 1024, 2048, 35840]);
    for (const bytes of [1, 1000, 20390, 33378, 100000]) {
      expect(roomFor(bytes)).toBeGreaterThanOrEqual((bytes * 17) / 16);
      expect(roomFor(bytes) - (bytes * 17) / 16).toBeLessThan(1024);
    }
  });

  test("a table that does not fit is not written", () => {
    const length = encodeTable(small).length;
    expect(encodeTable(small, length).length).toBe(length);
    expect(() => encodeTable(small, length - 1)).toThrow(
      `the table takes ${length} bytes and there is room for ${length - 1}`,
    );
    expect(encodeTable(large(120, 1500, 120000)).length).toBeGreaterThan(131072);
  });

  test("the number of a door is its place in the table: by feature, those that exit first, by address", () => {
    const shuffled = [small.doors[3]!, small.doors[1]!, small.doors[2]!, small.doors[0]!];
    expect(inTableOrder(small.features, shuffled)).toEqual(small.doors);
    expect(() => encodeTable({ ...small, doors: shuffled })).toThrow("the doors are not in the order of the table");
    const both: Table["doors"] = [
      { address: 9, feature: "jit", whenShut: "return" },
      { address: 5, feature: "jit", whenShut: "return" },
      { address: 7, feature: "jit", whenShut: "exit" },
    ];
    expect(inTableOrder(small.features, both).map(door => door.address)).toEqual([7, 5, 9]);
  });

  test("what the table cannot say is refused", () => {
    expect(() => encodeTable({ ...small, doors: [{ address: 1, feature: "other", whenShut: "exit" }] })).toThrow(
      "the table does not list other",
    );
    expect(() => encodeTable({ ...small, conditions: [{ feature: "other", kind: "Bun", name: "serve" }] })).toThrow(
      "the table does not list other",
    );
    expect(() => encodeTable({ ...small, islands: [{ start: 1, end: 2, features: "tools,other" }] })).toThrow(
      "the table does not list other",
    );
    expect(() => encodeTable({ ...small, islands: [{ start: 1, end: 2, features: "" }] })).toThrow(
      "the table does not list",
    );
    expect(() => encodeTable({ ...small, islands: [{ start: 2, end: 2, features: "tools" }] })).toThrow(
      "the table cannot hold the number -1",
    );
    expect(() => encodeTable({ ...small, islands: [small.islands[1]!, small.islands[0]!] })).toThrow(
      "the table cannot hold the number",
    );
    expect(() =>
      encodeTable({ ...small, islands: [small.islands[0]!, { ...small.islands[1]!, start: 0x207fff }] }),
    ).toThrow("the table cannot hold the number -1");
  });

  test("a table that is cut short, or followed by something, or names what it does not list, is malformed", () => {
    const whole = encodeTable(small);
    expect(() => decodeTable(Buffer.alloc(32768))).toThrow("there is no table");
    expect(() => decodeTable(Buffer.from("bun-islands 1\nstub 201234\n"))).toThrow("there is no table");
    for (let length = header.length; length < whole.length; length++)
      expect(() => decodeTable(whole.subarray(0, length))).toThrow("the table is malformed");
    expect(() => decodeTable(Buffer.concat([whole, Buffer.from([0, 0, 1])]))).toThrow("the table is malformed");
    const changed = (at: number, byte: number) => {
      const copy = Buffer.from(whole);
      copy[at] = byte;
      return copy;
    };
    const after = (hex: string) => whole.indexOf(Buffer.from(hex, "hex")) + hex.length / 2;
    expect(() => decodeTable(changed(after("0342756e02"), 2))).toThrow("the table is malformed");
    expect(() => decodeTable(changed(after("5472616e7370696c65720001"), 2))).toThrow("the table is malformed");
    expect(() => decodeTable(changed(after("0001000200010201"), 3))).toThrow("the table is malformed");
    expect(() => decodeTable(changed(after("0380808101ff7f"), 2))).toThrow("the table is malformed");
    expect(() => decodeTable(changed(header.length + 6, 0xff))).toThrow("the table is malformed");
    expect(() => decodeTable(Buffer.concat([header, Buffer.from([0x80, 0]), Buffer.alloc(32)]))).toThrow(
      "the table is malformed",
    );
    const withSet = (set: string) =>
      Buffer.concat([header, Buffer.from("000000" + "0103616c6c" + "000000" + "01" + set, "hex"), Buffer.alloc(32)]);
    expect(decodeTable(withSet("0100")).features).toEqual(["all"]);
    expect(() => decodeTable(withSet("00"))).toThrow("the table is malformed");
  });

  describe("ICU's data package", () => {
    const packages = [
      {
        start: 0x400000,
        end: 0x480010,
        runs: [
          { first: 2, count: 3, features: "tools" },
          { first: 5, count: 1, features: "tools,jit" },
          { first: 200, count: 300, features: "tools" },
        ],
      },
    ];
    const withRuns = (...runs: (typeof packages)[number]["runs"]) => ({
      ...small,
      packages: [{ start: 1, end: 2, runs }],
    });

    test("stands behind the doors; these are the bytes that src/exe_islands/lib.rs is tested on", () => {
      const written = encodeTable({ ...small, packages });
      expect(written.subarray(0, encodeTable(small).length)).toEqual(encodeTable(small));
      expect(written.subarray(encodeTable(small).length).toString("hex")).toBe(
        "01" + "80808002" + "908020" + "03" + "020200" + "000001" + "c201ab0200",
      );
      expect(decodeTable(inItsRoom(written))).toEqual({ ...small, packages });
      expect(decodeTable(written)).toEqual({ ...small, packages });
    });

    test("a table without one is written as before", () => {
      expect(encodeTable({ ...small, packages: [] })).toEqual(encodeTable(small));
      expect(decodeTable(inItsRoom(encodeTable(small))).packages).toBeUndefined();
    });

    test("a set of features that only items wait for is listed with those of the islands", () => {
      const waiting = [{ start: 16, end: 32, runs: [{ first: 0, count: 1, features: "jit,text" }] }];
      expect(decodeTable(encodeTable({ ...small, packages: waiting })).packages).toEqual(waiting);
      expect(decodeTable(encodeTable({ ...small, islands: [], packages: waiting })).packages).toEqual(waiting);
    });

    test("the largest numbers, two packages, no runs", () => {
      const most = Number.MAX_SAFE_INTEGER;
      const two = [
        { start: 0, end: most, runs: [{ first: 0, count: most, features: "tools" }] },
        { start: most, end: most, runs: [{ first: most - 1, count: 1, features: "jit" }] },
        { start: 5, end: 6, runs: [] },
      ];
      expect(decodeTable(encodeTable({ ...small, packages: two })).packages).toEqual(two);
    });

    test("400 runs of items beside 6,000 doors, 1,500 stretches and 120 features take less than 34 KB", () => {
      const table = large(120, 1500, 6000);
      const runs = Array.from({ length: 400 }, (_, index) => ({
        first: index * 12,
        count: 1 + (index % 11),
        features: table.islands[index]!.features,
      }));
      const written = encodeTable({ ...table, packages: [{ start: 0x8000000, end: 0xa000000, runs }] });
      expect(written.length).toBeLessThan(34816);
      expect(decodeTable(written).packages![0]!.runs).toEqual(runs);
    });

    test("what the table cannot say is refused", () => {
      expect(() => encodeTable(withRuns({ first: 0, count: 1, features: "other" }))).toThrow(
        "the table does not list other",
      );
      expect(() => encodeTable(withRuns({ first: 0, count: 0, features: "tools" }))).toThrow(
        "the table cannot hold the number -1",
      );
      expect(() =>
        encodeTable(withRuns({ first: 0, count: 2, features: "tools" }, { first: 1, count: 1, features: "jit" })),
      ).toThrow("the table cannot hold the number -1");
      expect(() => encodeTable({ ...small, packages: [{ start: 2, end: 1, runs: [] }] })).toThrow(
        "the table cannot hold the number -1",
      );
    });

    test("one that is cut short, or names a set that is not listed, is malformed", () => {
      const written = encodeTable({ ...small, packages });
      for (let length = encodeTable(small).length + 1; length < written.length; length++)
        expect(() => decodeTable(written.subarray(0, length))).toThrow("the table is malformed");
      const unlisted = Buffer.from(written);
      unlisted[unlisted.length - 1] = 2;
      expect(() => decodeTable(unlisted)).toThrow("the table is malformed");
    });
  });

  describe("the places that hold the address of a thin door", () => {
    const withPlaces = (...places: Table["doors"][number]["places"][]): Table => ({
      ...small,
      doors: small.doors.map(({ places: _, ...door }, index) =>
        places[index] === undefined ? door : { ...door, places: places[index] },
      ),
    });
    const fat = encodeTable(withPlaces());
    const withSection = (hex: string) => Buffer.concat([fat.subarray(0, -1), Buffer.from(hex, "hex")]);

    test("a table without them ends in a zero, as the room does", () => {
      expect(fat.at(-1)).toBe(0);
      expect(decodeTable(fat).doors.every(door => door.places === undefined)).toBe(true);
      expect(decodeTable(inItsRoom(fat.subarray(0, -1)))).toEqual(decodeTable(fat));
      expect(encodeTable(withPlaces([], undefined, []))).toEqual(fat);
    });

    test("one place, forty places, every kind", () => {
      const forty = Array.from({ length: 40 }, (_, index) => ({
        address: 0x200000 + index * index * 4,
        kind: [0, 1, 2, 3, 4, 5, 7, 6, 7, 5][index % 10]!,
      }));
      const table = withPlaces([{ address: 0, kind: placeKinds.pointer36 }], undefined, undefined, forty);
      expect(decodeTable(encodeTable(table))).toEqual(table);
      expect(Object.values(placeKinds).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    test("the largest address", () => {
      const most = (Number.MAX_SAFE_INTEGER - 15) / 16;
      const table = withPlaces([{ address: most, kind: placeKinds.pointer36 }]);
      expect(decodeTable(encodeTable(table))).toEqual(table);
      expect(() => encodeTable(withPlaces([{ address: most + 2, kind: placeKinds.add32 }]))).toThrow(
        "the table cannot hold the number",
      );
    });

    test("they ascend, and are of a kind that the writer knows", () => {
      const [first, second] = [
        { address: 16, kind: placeKinds.add32 },
        { address: 32, kind: placeKinds.add64 },
      ];
      expect(decodeTable(encodeTable(withPlaces([first, second]))).doors[0]!.places).toEqual([first, second]);
      expect(() => encodeTable(withPlaces([second, first]))).toThrow("the places of a door are not in ascending order");
      expect(() => encodeTable(withPlaces([first, { ...first, kind: placeKinds.add64 }]))).toThrow(
        "the places of a door are not in ascending order",
      );
      for (const kind of [8, -1, 0.5])
        expect(() => encodeTable(withPlaces([{ address: 16, kind }]))).toThrow("the table knows no place of the kind");
    });

    test("a section that names no door, the same door twice, the same place twice or an unknown kind is malformed", () => {
      expect(decodeTable(withSection("0101" + "0c" + "10")).doors[3]!.places).toEqual([
        { address: 1, kind: placeKinds.add32 },
      ]);
      expect(() => decodeTable(withSection("0101" + "10" + "10"))).toThrow("the table is malformed");
      expect(decodeTable(withSection("0201" + "08" + "10" + "00" + "10")).doors[3]!.places).toEqual([
        { address: 2, kind: placeKinds.add32 },
      ]);
      expect(() => decodeTable(withSection("0201" + "0c" + "10" + "00" + "10"))).toThrow("the table is malformed");
      expect(decodeTable(withSection("0101" + "01" + "10" + "09")).doors[0]!.places).toHaveLength(2);
      expect(() => decodeTable(withSection("0101" + "01" + "10" + "01"))).toThrow("the table is malformed");
      expect(() => decodeTable(withSection("0101" + "01" + "10"))).toThrow("the table is malformed");
      expect(
        decodeTable(withSection("0101" + "0301" + "10" + "08" + "08" + "08" + "0e")).doors[0]!.places,
      ).toHaveLength(5);
      expect(() => decodeTable(withSection("0101" + "03ffffffff0f" + "10"))).toThrow("the table is malformed");
    });

    test("an adr has its nop beside it, before or behind", () => {
      const of = (...kinds: number[]) => withPlaces(kinds.map((kind, index) => ({ address: 16 + index * 4, kind })));
      const { add32, adr, nop } = placeKinds;
      for (const kinds of [
        [adr, nop],
        [nop, adr],
        [add32, adr, nop, add32],
        [adr, nop, nop, adr],
        [nop, adr, nop, adr],
      ]) {
        expect(decodeTable(encodeTable(of(...kinds)))).toEqual(of(...kinds));
      }
      for (const kinds of [
        [adr],
        [nop],
        [add32, adr],
        [adr, add32, nop],
        [adr, adr, nop, nop],
        [nop, nop, adr, adr],
        [adr, nop, adr],
      ]) {
        expect(() => encodeTable(of(...kinds))).toThrow("an adr has no nop beside it");
      }
      expect(decodeTable(withSection("0104" + "01" + "15" + "0f")).doors[0]!.places).toEqual([
        { address: 4, kind: adr },
        { address: 8, kind: nop },
      ]);
      expect(() => decodeTable(withSection("0104" + "01" + "15" + "0d"))).toThrow("the table is malformed");
      expect(() => decodeTable(withSection("0104" + "00" + "17"))).toThrow("the table is malformed");
    });

    test("the first place of a door is told from that of the last door, forward or back", () => {
      const at = (...addresses: number[]) => addresses.map(address => ({ address, kind: placeKinds.add32 }));
      for (const second of [12, 10, 8, 0]) {
        const table = withPlaces(at(10, 11), at(second));
        expect(decodeTable(encodeTable(table))).toEqual(table);
      }
      expect(
        encodeTable(withPlaces(at(10, 11), at(8)))
          .subarray(fat.length - 1)
          .toString("hex"),
      ).toBe("0201" + "01" + "a001" + "08" + "00" + "18");
      expect(() => decodeTable(withSection("0201" + "00" + "a001" + "00" + "a801"))).toThrow("the table is malformed");
      expect(() => decodeTable(withSection("0101" + "00" + "08"))).toThrow("the table is malformed");
    });

    test("places that are all multiples of four are counted in fours", () => {
      const table = withPlaces(
        [
          { address: 40, kind: placeKinds.add32 },
          { address: 44, kind: placeKinds.branch26 },
        ],
        [{ address: 32, kind: placeKinds.branch26 }],
      );
      expect(
        encodeTable(table)
          .subarray(fat.length - 1)
          .toString("hex"),
      ).toBe("0204" + "01" + "a001" + "0a" + "00" + "1a");
      expect(decodeTable(encodeTable(table))).toEqual(table);
      for (const unit of ["00", "02", "03", "05", "08"])
        expect(() => decodeTable(withSection("01" + unit + "00" + "10"))).toThrow("the table is malformed");
    });
  });
});

describe("the items of ICU's data package", () => {
  const claims = [
    { feature: "tools", pattern: /\.cnv$/ },
    { feature: "collation", pattern: /^coll\// },
    { feature: "text", pattern: /^coll\/root\.res$/ },
    { feature: "locales", pattern: /^(?!en\.res$)[a-z]{2,3}\.res$/ },
  ];
  const features = ["tools", "text", "collation", "locales"];
  const named = (...names: string[]) => names.map(name => ({ name, size: 16 }));

  test("its items are named behind the first slash; each ends where the next begins and the last where the package ends", () => {
    const items: [string, number][] = [
      ["icudt75l/af.res", 48],
      ["icudt75l/coll/de.res", 40],
      ["icudt75l/zoneinfo64.res", 33],
    ];
    expect(itemsOf(packageOf(items))).toEqual([
      { name: "af.res", size: 48 },
      { name: "coll/de.res", size: 48 },
      { name: "zoneinfo64.res", size: 33 },
    ]);
    expect(itemsOf(packageOf(items, 144)).map(item => item.name)).toEqual(["af.res", "coll/de.res", "zoneinfo64.res"]);
    expect(itemsOf(packageOf([]))).toEqual([]);
  });

  test("something else, or a package that is cut short, is refused", () => {
    const whole = packageOf([
      ["icudt75l/af.res", 48],
      ["icudt75l/zu.res", 16],
    ]);
    const changed = (at: number, byte: number) => {
      const copy = Buffer.from(whole);
      copy[at] = byte;
      return copy;
    };
    for (const other of [
      Buffer.alloc(0),
      Buffer.alloc(64),
      changed(2, 0),
      changed(8, 1),
      changed(12, 0x52),
      changed(16, 2),
      whole.subarray(0, 40),
      changed(32, 0xff),
      changed(32 + 4 + 3, 0xff),
      changed(32 + 8 + 3, 0xff),
    ]) {
      expect(() => itemsOf(other)).toThrow("ICU's data package is malformed");
    }
  });

  test("items that lie together and wait for the same features are one run", () => {
    expect(runsOf(named("af.res", "ar.res", "coll/de.res", "coll/fr.res", "de.res"), claims, features)).toEqual([
      { first: 0, count: 2, features: "locales" },
      { first: 2, count: 2, features: "collation" },
      { first: 4, count: 1, features: "locales" },
    ]);
  });

  test("an item that nothing claims is in no run, and ends one", () => {
    expect(runsOf(named("de.res", "en.res", "es.res", "zoneinfo64.res"), claims, features)).toEqual([
      { first: 0, count: 1, features: "locales" },
      { first: 2, count: 1, features: "locales" },
    ]);
    expect(runsOf(named("en.res", "zoneinfo64.res"), claims, features)).toEqual([]);
  });

  test("an item that several features claim waits for all of them, named in the order of the features", () => {
    expect(runsOf(named("coll/de.res", "coll/root.res", "coll/sv.res"), [...claims].reverse(), features)).toEqual([
      { first: 0, count: 1, features: "collation" },
      { first: 1, count: 1, features: "text,collation" },
      { first: 2, count: 1, features: "collation" },
    ]);
  });
});

describe("the hash by which ld64.lld's order file names a string", () => {
  test("is XXH3, for every length that takes a road of its own", () => {
    let seed = 12345;
    for (const length of [...Array(300).keys(), 511, 512, 513, 1023, 1024, 1025, 2047, 2048, 2049, 5000, 100000]) {
      const bytes = Buffer.alloc(length);
      for (let index = 0; index < length; index++)
        bytes[index] = (seed = (seed * 1103515245 + 12345) & 0x7fffffff) & 255;
      expect({ length, hash: xxh3(bytes) }).toEqual({ length, hash: BigInt(Bun.hash.xxHash3(bytes)) });
    }
  });
});
