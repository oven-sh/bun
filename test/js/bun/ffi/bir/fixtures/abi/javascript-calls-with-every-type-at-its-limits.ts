import * as c from "./javascript-calls-with-every-type-at-its-limits.c";

const show = (...values: unknown[]) => console.log(values.map(v => (Object.is(v, -0) ? "-0" : String(v))).join(" "));
show(c.min_i8(), c.max_i8(), c.max_u8(), c.min_i16(), c.max_i16(), c.max_u16(), c.min_i32(), c.max_i32(), c.max_u32());
show(c.min_i64(), c.max_i64(), c.max_u64(), typeof c.min_i64(), typeof c.max_u64());
show(c.max_float(), c.tiny_float(), c.max_double(), c.negative_zero(), c.not_a_number(), c.infinity());
// What arrives: integers wrap to the width of the parameter, floats round to it, booleans are truth values.
show(
  c.same_i8(127),
  c.same_i8(128),
  c.same_i8(-129),
  c.same_u8(256),
  c.same_u8(-1),
  c.same_i16(32768),
  c.same_u16(65536 + 7),
);
show(
  c.same_i32(2 ** 31),
  c.same_i32(-(2 ** 31) - 1),
  c.same_u32(2 ** 32 + 9),
  c.same_u32(-1),
  c.same_i32(1.9),
  c.same_i32(-1.9),
);
show(c.same_i64(-(2n ** 63n)), c.same_i64(2n ** 63n - 1n), c.same_u64(2n ** 64n - 1n), c.same_i64(42n), c.same_u64(0n));
show(
  c.same_float(0.1),
  c.same_float(16777217),
  c.same_double(0.1),
  c.same_double(Number.MAX_SAFE_INTEGER),
  c.same_float(-0),
  c.same_double(NaN),
);
show(c.same_bool(true), c.same_bool(false), c.same_bool(1), c.same_bool(0));
show(
  c.twelve(1, 2.5, 3n, 4.5, 5, 6.5, 7, 8.5, 9n, 10.5, true, 12),
  c.ten_integers(1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n),
  c.ten_doubles(1, 2, 3, 4, 5, 6, 7, 8, 9, 10),
);

const bytes = new Uint8Array([1, 2, 3, 250]);
const ints = new Int32Array(4);
c.fill(ints, 4, 100);
const doubles = new Float64Array([1, 2, 3]);
show(
  c.sum_bytes(bytes, 4n),
  Array.from(ints).join(","),
  c.length(Buffer.from("twelve bytes\0")),
  c.scale_in_place(doubles, 3, 2),
  Array.from(doubles).join(","),
);
const address = c.address_of_element(2);
show(
  typeof address,
  c.read_through(address),
  c.read_through(c.address_of_element(0)),
  c.read_through(null),
  c.is_null(null),
  c.is_null(address),
  c.null_pointer(),
);
