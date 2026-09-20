import * as c from "./javascript-values-of-another-kind-than-the-parameter.c";

// Every line is what one call gave: its value, or the error it threw.
const show = (what: string, call: () => unknown) => {
  try {
    const value = call();
    console.log(what, "=>", Array.isArray(value) ? value.map(String).join(",") : String(value));
  } catch (error) {
    console.log(what, "threw", (error as Error).constructor.name);
  }
};

const bytes = new Uint8Array([10, 20, 30, 40]);
// Where a pointer is wanted: views at an offset, buffers, nothing.
show("a subarray", () => c.first(bytes.subarray(2)));
show("a typed array at an offset", () => c.first(new Uint8Array(bytes.buffer, 1)));
show("an ArrayBuffer", () => c.first(bytes.buffer));
show("a DataView at an offset", () => c.first(new DataView(bytes.buffer, 3)));
show("an Int32Array of the same buffer", () => c.first_int(new Int32Array(bytes.buffer)));
show("null", () => c.first(null));
show("undefined", () => c.first(undefined));
show("a Buffer with a terminator", () => c.length_of(Buffer.from("hello\0")));
show("a string", () => c.length_of("hello" as any));
show("an object", () => c.length_of({} as any));
const gone = new ArrayBuffer(8);
const view = new Uint8Array(gone);
view[0] = 9;
structuredClone(gone, { transfer: [gone] });
show("a view of a detached buffer", () => c.first(view));
// Where a 64-bit integer is wanted.
show("a BigInt", () => c.same64(-5n));
show("a Number", () => c.same64(42 as any));
show("a Number with a fraction", () => c.same64(1.5 as any));
show("a Number of 2 to the 63", () => c.same64((2 ** 63) as any));
show("a BigInt of 2 to the 64 minus 1, signed", () => c.same64((2n ** 64n - 1n) as any));
show("a BigInt of 2 to the 64 minus 1, unsigned", () => c.same_u64(2n ** 64n - 1n));
show("a negative BigInt, unsigned", () => c.same_u64(-1n as any));
show("a string of digits", () => c.same64("7" as any));
// Where an int, a double, a float or a bool is wanted.
show("too few arguments", () => (c.add as any)(1));
show("too many arguments", () => (c.add as any)(1, 2, 3));
show("a string of digits for an int", () => c.add("3" as any, 4));
show("an object with valueOf", () => c.add({ valueOf: () => 5 } as any, 4));
show("a BigInt for an int", () => c.add(3n as any, 4));
show("NaN and Infinity for ints", () => c.add(NaN, Infinity));
show("2 to the 32 plus 5 for an int", () => c.add(2 ** 32 + 5, 0));
show("a BigInt for a double", () => c.half(3n as any));
show("a Symbol for a double", () => c.half(Symbol() as any));
show("a string for a double", () => c.half("3" as any));
show("a double that does not fit a float", () => c.single(1e300));
show("an object for a bool", () => c.truth({} as any));
show("an empty string for a bool", () => c.truth("" as any));
// The exports are functions like any other.
show("new", () => new (c.add as any)(1, 2));
show("call, apply, bind", () => [c.add.call(null, 1, 2), c.add.apply(null, [3, 4]), c.add.bind(null, 5)(6)]);
show("name, length, typeof", () => [c.add.name, c.add.length, typeof c.add]);
