import * as c from "./ffi-types-of-the-exports.c";

console.log(
  Object.keys(c)
    .filter(name => name !== "default")
    .sort()
    .join(" "),
);
console.log(c.f_i8(200), c.f_u8(-1), c.f_i16(70000), c.f_u16(-1), c.f_i32(2 ** 32 + 5), c.f_u32(-1));
console.log(c.f_i64(-5n, 3n), c.f_u64(2n ** 64n - 1n), typeof c.f_i64(1n, 1n));
console.log(c.f_double(0.5, 0.25), c.f_float(16777217), c.f_bool(true), c.f_bool(false), c.f_void());
console.log(c.f_enum(1), c.f_ptr(null, null, null), c.uses_hidden(21), c.f_char(65));
