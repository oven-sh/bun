import { describe, expect, test } from "bun:test";
import { placeKinds, type Table } from "../../scripts/build/islands-layout.ts";
import { redirect, shutDoors } from "./islands-shut-doors.ts";

const { add32, add64, branch26, page21, low12, adr21, pointer36 } = placeKinds;

describe("a place is sent from the door to its stub, as src/exe_islands/lib.rs does it", () => {
  function redirected(kind: number, address: number, door: number, stub: number, field: Buffer): Buffer {
    const file = Buffer.concat([Buffer.from([0xaa, 0xaa]), field, Buffer.from([0xbb, 0xbb])]);
    redirect(file, 2, { address, kind }, door, stub);
    expect([file[0], file[1], file.at(-2), file.at(-1)]).toEqual([0xaa, 0xaa, 0xbb, 0xbb]);
    return file.subarray(2, -2);
  }
  const word = (kind: number, address: number) => (door: number, stub: number, before: number) => {
    const field = Buffer.alloc(4);
    field.writeUInt32LE(before);
    return redirected(kind, address, door, stub, field).readUInt32LE();
  };
  const pointer = (kind: number) => (door: number, stub: number, before: bigint) => {
    const field = Buffer.alloc(8);
    field.writeBigUInt64LE(before);
    return redirected(kind, 0x403008, door, stub, field).readBigUInt64LE();
  };

  test("add32", () => {
    const add = word(add32, 0x201301);
    expect(add(0x201080, 0x204000, 0xfffffd7b)).toBe(0x00002cfb);
    expect(add(0x204000, 0x201080, 0x00002cfb)).toBe(0xfffffd7b);
    expect(add(0x204000, 0x201080, 0x00204000)).toBe(0x00201080);
    expect(add(0x201080, 0x204000, 0x7fffd07f)).toBe(0x7fffffff);
    expect(() => add(0x201080, 0x204000, 0x7fffd080)).toThrow("refused");
    expect(add(0x204000, 0x201080, 0x80002f80)).toBe(0x80000000);
    expect(() => add(0x204000, 0x201080, 0x80002f7f)).toThrow("refused");
    expect(() => redirect(Buffer.alloc(5), 2, { address: 0x201301, kind: add32 }, 0x201080, 0x204000)).toThrow();
  });

  test("add64", () => {
    const add = pointer(add64);
    expect(add(0x201080, 0x204000, 0x201080n)).toBe(0x204000n);
    expect(add(0x204000, 0x201080, 0x204000n)).toBe(0x201080n);
    expect(add(0x201080, 0x204000, 0xffffffffffffd07fn)).toBe(0xffffffffffffffffn);
    expect(() => add(0x201080, 0x204000, 0xffffffffffffd080n)).toThrow("refused");
    expect(add(0x204000, 0x201080, 0x2f80n)).toBe(0n);
    expect(() => add(0x204000, 0x201080, 0x2f7fn)).toThrow("refused");
  });

  test("pointer36", () => {
    const add = pointer(pointer36);
    expect(add(0x100201080, 0x100204000, 0x00180ab100201080n)).toBe(0x00180ab100204000n);
    expect(add(0x100204000, 0x100201080, 0x00180ab100204000n)).toBe(0x00180ab100201080n);
    expect(add(0x100201080, 0x100204000, 0x100201080n)).toBe(0x100204000n);
    expect(add(0x100201080, 0x100204000, 0x00180abfffffd07fn)).toBe(0x00180abfffffffffn);
    expect(() => add(0x100201080, 0x100204000, 0x00180abfffffd080n)).toThrow("refused");
    expect(() => add(0x100204000, 0x100201080, 0x00180ab000002f7fn)).toThrow("refused");
    expect(() => add(0x100201080, 0x100204000, 0x80180ab100201080n)).toThrow("refused");
  });

  test("branch26", () => {
    const branch = word(branch26, 0x201300);
    expect(branch(0x201080, 0x204000, 0x97ffff60)).toBe(0x94000b40);
    expect(branch(0x204000, 0x201080, 0x94000b40)).toBe(0x97ffff60);
    expect(branch(0x201080, 0x204000, 0x17ffff60)).toBe(0x14000b40);
    expect(branch(0x201080, 0x201300 + 2 ** 27 - 4, 0x97ffff60)).toBe(0x95ffffff);
    expect(() => branch(0x201080, 0x201300 + 2 ** 27, 0x97ffff60)).toThrow("refused");
    expect(branch(0x8201080, 0x201300, 0x95ffff60)).toBe(0x94000000);
    expect(() => branch(0x201080, 0x204002, 0x97ffff60)).toThrow("refused");
    expect(() => branch(0x201080, 0x204000, 0x97ffff61)).toThrow("refused");
    expect(() => branch(0x201080, 0x204000, 0xd503201f)).toThrow("refused");
    expect(() => branch(0x201080, 0x204000, 0x57ffff60)).toThrow("refused");
  });

  test("page21", () => {
    const page = word(page21, 0x201304);
    expect(page(0x205080, 0x203ff0, 0x90000020)).toBe(0xd0000000);
    expect(page(0x203ff0, 0x205080, 0xd0000000)).toBe(0x90000020);
    expect(page(0x205080, 0x200010, 0x90000033)).toBe(0xf0fffff3);
    expect(page(0x205080, 0x205ff8, 0x90000020)).toBe(0x90000020);
    expect(page(0x205080, 0x201000 + 0xfffff * 4096, 0x90000020)).toBe(0xf07fffe0);
    expect(() => page(0x205080, 0x201000 + 0x100000 * 4096, 0x90000020)).toThrow("refused");
    expect(() => page(0x206080, 0x203ff0, 0x90000020)).toThrow("refused");
    expect(() => page(0x205080, 0x203ff0, 0x10000020)).toThrow("refused");
  });

  test("low12", () => {
    const low = word(low12, 0x201308);
    expect(low(0x205080, 0x203ff0, 0x91020000)).toBe(0x913fc000);
    expect(low(0x203ff0, 0x205080, 0x913fc000)).toBe(0x91020000);
    expect(low(0x205080, 0x203000, 0x91020135)).toBe(0x91000135);
    expect(() => low(0x205084, 0x203ff0, 0x91020000)).toThrow("refused");
    expect(() => low(0x205080, 0x203ff0, 0x91420000)).toThrow("refused");
    expect(() => low(0x205080, 0x203ff0, 0xd1020000)).toThrow("refused");
    expect(() => low(0x205080, 0x203ff0, 0x11020000)).toThrow("refused");
    expect(() => low(0x205080, 0x203ff0, 0xf9404000)).toThrow("refused");
  });

  test("adr21", () => {
    const adr = word(adr21, 0x201308);
    expect(adr(0x201080, 0x204000, 0x10ffebc1)).toBe(0x100167c1);
    expect(adr(0x204000, 0x201080, 0x100167c1)).toBe(0x10ffebc1);
    expect(adr(0x201080, 0x201308 + 0xfffff, 0x10ffebc1)).toBe(0x707fffe1);
    expect(() => adr(0x201080, 0x201308 + 0x100000, 0x10ffebc1)).toThrow("refused");
    expect(() => adr(0x201084, 0x204000, 0x10ffebc1)).toThrow("refused");
    expect(() => adr(0x201080, 0x204000, 0x90ffebc1)).toThrow("refused");
  });
});

describe("the doors of an executable are shut, as src/exe_islands/lib.rs does it", () => {
  const trimmedOut = 0x201010;
  const segments = [
    [4, 0, 0x200000, 0x1000],
    [5, 0x1000, 0x201000, 0x2000],
    [6, 0x3000, 0x403000, 0x1000],
  ] as const;
  const at = (address: number) => {
    const [, offset, start] = segments.find(([, , start, size]) => address >= start && address - start < size)!;
    return offset + address - start;
  };

  function executable(): Buffer {
    const file = Buffer.from(Array.from({ length: 0x4000 }, (_, index) => index % 251 | 1));
    file.writeBigUInt64LE(0x40n, 0x20);
    file.writeUInt16LE(56, 0x36);
    file.writeUInt16LE(segments.length, 0x38);
    segments.forEach(([flags, offset, address, size], index) => {
      file.writeUInt32LE(1, 0x40 + index * 56);
      file.writeUInt32LE(flags, 0x44 + index * 56);
      [offset, address, address, size, size, 0x1000].forEach((value, field) => file.writeBigUInt64LE(BigInt(value), 0x48 + index * 56 + field * 8));
    });
    return file;
  }

  const put = (file: Buffer, address: number, bytes: number[] | Buffer) => void file.set(bytes, at(address));
  const putCall = (file: Buffer, address: number, target: number) => void file.writeInt32LE(target - (address + 4), at(address));
  const putPointer = (file: Buffer, address: number, target: number) => void file.writeBigUInt64LE(BigInt(target), at(address));
  const putWord = (file: Buffer, address: number, word: number) => void file.writeUInt32LE(word, at(address));

  function exitStub(address: number, number: number, feature: number): Buffer {
    const code = Buffer.from([0xbf, 0, 0, 0, 0, 0xe9, 0, 0, 0, 0]);
    code.writeUInt32LE(feature + number * 256, 1);
    code.writeInt32LE(trimmedOut - (address + 10), 6);
    return code;
  }

  const table: Table = {
    stub: trimmedOut,
    smallestDoor: { exit: 12, return: 12 },
    features: ["a", "b", "c"],
    conditions: [],
    islands: [
      { start: 0x200800, end: 0x200900, features: "a" },
      { start: 0x202000, end: 0x202800, features: "a" },
      { start: 0x202800, end: 0x202c00, features: "a,b" },
    ],
    doors: [
      { address: 0x201200, feature: "a", whenShut: "exit" },
      { address: 0x201300, feature: "a", whenShut: "exit", places: [{ address: 0x201111, kind: add32 }] },
      {
        address: 0x202100,
        feature: "a",
        whenShut: "exit",
        places: [
          { address: 0x201101, kind: add32 },
          { address: 0x201206, kind: add32 },
          { address: 0x202401, kind: add32 },
          { address: 0x202901, kind: add32 },
          { address: 0x403008, kind: add64 },
        ],
      },
      { address: 0x202300, feature: "a", whenShut: "return", places: [{ address: 0x201121, kind: add32 }] },
      { address: 0x202340, feature: "a", whenShut: "return", places: [{ address: 0x403010, kind: add64 }] },
      { address: 0x202880, feature: "b", whenShut: "exit", places: [{ address: 0x201131, kind: add32 }] },
    ],
  };

  function linked(): Buffer {
    const file = executable();
    for (const door of table.doors) {
      for (const place of door.places ?? []) (place.kind === add64 ? putPointer : putCall)(file, place.address, door.address);
    }
    return file;
  }

  test("thin doors are sent to a strip of dead code; a fat door is overwritten, with the place in it", () => {
    const expected = linked();
    expected.fill(0xcc, at(0x200800), at(0x200800) + 0x100);
    expected.fill(0xcc, at(0x202000), at(0x202000) + 0x800);
    put(expected, 0x202000, exitStub(0x202000, 1, 0));
    put(expected, 0x20200a, exitStub(0x20200a, 2, 0));
    put(expected, 0x202014, [0x31, 0xc0, 0xc3]);
    putCall(expected, 0x201111, 0x202000);
    putCall(expected, 0x201101, 0x20200a);
    putCall(expected, 0x202901, 0x20200a);
    putPointer(expected, 0x403008, 0x20200a);
    putCall(expected, 0x201121, 0x202014);
    putPointer(expected, 0x403010, 0x202014);
    put(expected, 0x201200, exitStub(0x201200, 0, 0));
    const before = linked();
    expect(shutDoors(before, table, ["a"], false).equals(expected)).toBe(true);
    expect(before.equals(linked())).toBe(true);
  });

  test("a place in what goes as well is left alone", () => {
    const file = shutDoors(linked(), table, ["a", "b"], false);
    expect(file.subarray(at(0x202021), at(0x202021) + 0xbdf).every(byte => byte === 0xcc)).toBe(true);
    expect(file.subarray(at(0x202014), at(0x202014) + 10)).toEqual(exitStub(0x202014, 5, 1));
    expect([...file.subarray(at(0x20201e), at(0x20201e) + 3)]).toEqual([0x31, 0xc0, 0xc3]);
    expect(file.readInt32LE(at(0x201131))).toBe(0x202014 - 0x201135);
  });

  test("nothing is touched for features that are kept", () => {
    expect(shutDoors(linked(), table, [], false).equals(linked())).toBe(true);
    expect(shutDoors(linked(), table, ["c"], false).equals(linked())).toBe(true);
    expect(() => shutDoors(linked(), table, ["d"], false)).toThrow("refused: there is no feature d");
  });

  test("no strip", () => {
    const withIslands = (islands: Table["islands"]) => ({ ...table, islands });
    const [data, code] = table.islands;
    expect(() => shutDoors(linked(), table, ["b"], false)).toThrow("refused: no dead code holds a strip of 10 bytes");
    expect(() => shutDoors(linked(), withIslands([data!, { ...code!, end: 0x202016 }]), ["a"], false)).toThrow("refused: no dead code holds a strip of 23 bytes");
    expect(shutDoors(linked(), withIslands([data!, { ...code!, end: 0x202017 }]), ["a"], false)[at(0x202016)]).toBe(0xc3);
    expect(() => shutDoors(linked(), withIslands([data!]), ["a"], false)).toThrow("refused: no dead code holds a strip of 23 bytes");
  });

  test("a place that cannot be rewritten stops the writer", () => {
    const file = linked();
    file.writeUInt32LE(0x80000000, at(0x201101));
    expect(() => shutDoors(file, table, ["a"], false)).toThrow("refused");
    const doors = table.doors.map((door, index) => (index === 1 ? { ...door, places: [{ address: 0x500000, kind: add32 }] } : door));
    expect(() => shutDoors(linked(), { ...table, doors }, ["a"], false)).toThrow("refused: nothing in the file is loaded at 0x500000");
  });

  test("arm64", () => {
    const arm64: Table = {
      stub: trimmedOut,
      smallestDoor: { exit: 12, return: 12 },
      features: ["a"],
      conditions: [],
      islands: [{ start: 0x202002, end: 0x202800, features: "a" }],
      doors: [
        {
          address: 0x202100,
          feature: "a",
          whenShut: "exit",
          places: [
            { address: 0x201100, kind: branch26 },
            { address: 0x201104, kind: page21 },
            { address: 0x201108, kind: low12 },
            { address: 0x20110c, kind: adr21 },
            { address: 0x403008, kind: add64 },
          ],
        },
        { address: 0x202300, feature: "a", whenShut: "return", places: [{ address: 0x201110, kind: branch26 }] },
      ],
    };
    const before = executable();
    putWord(before, 0x201100, 0x94000400);
    putWord(before, 0x201104, 0xb0000000);
    putWord(before, 0x201108, 0x91040000);
    putWord(before, 0x20110c, 0x10007fa0);
    putPointer(before, 0x403008, 0x202100);
    putWord(before, 0x201110, 0x1400047c);
    const file = shutDoors(before, arm64, ["a"], true);
    const words = (...addresses: number[]) => addresses.map(address => file.readUInt32LE(at(address)));
    expect([...file.subarray(at(0x202002), at(0x202004))]).toEqual([0x20, 0x00]);
    expect(words(0x202004, 0x202008, 0x20200c)).toEqual([0x52800000, 0x72a00000, 0x17fffc01]);
    expect(words(0x202010, 0x202014)).toEqual([0x52800000, 0xd65f03c0]);
    expect(words(0x201100, 0x201104, 0x201108, 0x20110c, 0x201110)).toEqual([0x940003c1, 0xb0000000, 0x91001000, 0x100077c0, 0x140003c0]);
    expect(file.readBigUInt64LE(at(0x403008))).toBe(0x202004n);
  });
});
