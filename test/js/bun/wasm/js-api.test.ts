import { describe, expect, test } from "bun:test";

// WebAssembly JS API conformance cases from a differential run against V8 and
// SpiderMonkey. The getArg cases need oven-sh/WebKit#613. The Memory cases pin
// behavior that JSC already has. Everything runs in-process.

const pageSize = 64 * 1024;

// (module
//   (memory (import "imp" "memory") 1 3 shared?)
//   (func (export "grow") (param i32) (result i32) local.get 0 memory.grow))
function memoryGrowModule(shared: boolean) {
  // prettier-ignore
  return new WebAssembly.Module(new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    // type section: (func (param i32) (result i32))
    0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f,
    // import section: imp.memory, limits {min 1, max 3, shared?}
    0x02, 0x10, 0x01, 0x03, 0x69, 0x6d, 0x70, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, shared ? 0x03 : 0x01, 0x01, 0x03,
    // function section
    0x03, 0x02, 0x01, 0x00,
    // export section: "grow" = func 0
    0x07, 0x08, 0x01, 0x04, 0x67, 0x72, 0x6f, 0x77, 0x00, 0x00,
    // code section: local.get 0; memory.grow 0
    0x0a, 0x08, 0x01, 0x06, 0x00, 0x20, 0x00, 0x40, 0x00, 0x0b,
  ]));
}

// The error class is the point of these tests: report it by name so that a
// failure reads "expected TypeError, received RangeError".
function errorClassOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).constructor.name;
  }
  return "no exception";
}

describe("WebAssembly.Exception.prototype.getArg", () => {
  const tag = new WebAssembly.Tag({ parameters: ["i32", "f64"] });
  const exception = new WebAssembly.Exception(tag, [5, 6.5]);
  const getArg = (index: unknown) => exception.getArg(tag, index as number);

  // getArg(Tag exceptionTag, [EnforceRange] unsigned long index): a failed
  // [EnforceRange] conversion is a TypeError, not a RangeError.
  test.each([
    -1,
    -1.5,
    2 ** 32,
    2 ** 32 + 0.5,
    2 ** 53,
    Number.MAX_VALUE,
    NaN,
    Infinity,
    -Infinity,
    undefined,
    "x",
    {},
  ])("index %p is a TypeError", index => {
    expect(errorClassOf(() => getArg(index))).toBe("TypeError");
  });

  test("an index that converts is truncated toward zero", () => {
    expect(getArg(0)).toBe(5);
    expect(getArg(-0)).toBe(5);
    expect(getArg(-0.5)).toBe(5);
    expect(getArg(0.9)).toBe(5);
    expect(getArg(null)).toBe(5);
    expect(getArg(1)).toBe(6.5);
    expect(getArg(1.99)).toBe(6.5);
    expect(getArg("1")).toBe(6.5);
    expect(getArg(true)).toBe(6.5);
  });

  test("a valid index past the payload is a RangeError", () => {
    for (const index of [2, 2.5, 2 ** 31, 2 ** 32 - 1]) expect(errorClassOf(() => getArg(index))).toBe("RangeError");

    const emptyTag = new WebAssembly.Tag({ parameters: [] });
    const empty = new WebAssembly.Exception(emptyTag, []);
    expect(errorClassOf(() => empty.getArg(emptyTag, 0))).toBe("RangeError");
    // The conversion still comes first.
    expect(errorClassOf(() => empty.getArg(emptyTag, -1))).toBe("TypeError");
  });
});

describe("WebAssembly.Memory grow and the buffer object", () => {
  // WebAssembly/threads#248: a non-shared memory detaches and replaces its
  // ArrayBuffer on every successful grow, even by 0 pages. A shared memory
  // hands out a new SharedArrayBuffer only when its length changed, and never
  // detaches the old one. V8 main (crrev.com/c/7660970) and SpiderMonkey agree.
  // Node 26 ships an older V8 that replaces the SharedArrayBuffer on grow(0).
  for (const via of ["Memory.prototype.grow", "memory.grow instruction"] as const) {
    const grower = (memory: WebAssembly.Memory, shared: boolean) =>
      via === "Memory.prototype.grow"
        ? (delta: number) => memory.grow(delta)
        : (new WebAssembly.Instance(memoryGrowModule(shared), { imp: { memory } }).exports.grow as (
            delta: number,
          ) => number);

    test(`non-shared memory, ${via}: grow(0) detaches and replaces the buffer`, () => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 3 });
      const grow = grower(memory, false);
      for (const delta of [0, 1, 0]) {
        const before = memory.buffer;
        const pagesBefore = before.byteLength / pageSize;
        expect(grow(delta)).toBe(pagesBefore);
        // Compare identities as booleans so that a failure does not print 64 KiB of zeros.
        expect(memory.buffer === before).toBe(false);
        expect(before.detached).toBe(true);
        expect(memory.buffer).toBeInstanceOf(ArrayBuffer);
        expect(memory.buffer.byteLength).toBe((pagesBefore + delta) * pageSize);
      }
    });

    test(`shared memory, ${via}: grow(0) keeps the buffer, a real grow replaces it`, () => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 3, shared: true });
      const grow = grower(memory, true);
      const first = memory.buffer;
      expect(first).toBeInstanceOf(SharedArrayBuffer);

      expect(grow(0)).toBe(1);
      expect(memory.buffer === first).toBe(true);

      expect(grow(1)).toBe(1);
      const second = memory.buffer;
      expect(second === first).toBe(false);
      expect(second).toBeInstanceOf(SharedArrayBuffer);
      expect(second.byteLength).toBe(2 * pageSize);
      // The old SharedArrayBuffer keeps its length and aliases the same block.
      expect(first.byteLength).toBe(pageSize);
      new Uint8Array(second)[0] = 7;
      expect(new Uint8Array(first)[0]).toBe(7);

      expect(grow(0)).toBe(2);
      expect(memory.buffer === second).toBe(true);
    });
  }

  test("growing one shared memory leaves another one's buffer alone", () => {
    const a = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
    const b = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
    const bufferA = a.buffer;
    const bufferB = b.buffer;
    a.grow(1);
    expect(a.buffer === bufferA).toBe(false);
    expect(b.buffer === bufferB).toBe(true);
  });
});
