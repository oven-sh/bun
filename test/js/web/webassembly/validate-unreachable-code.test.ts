import { describe, expect, test } from "bun:test";

// Code after `unreachable`, `br`, `br_table`, `return` or `throw` never runs, but the core spec
// still types it: the block's operand stack becomes polymorphic at its bottom and every instruction
// keeps its typing rules (spec test-suite unreached-invalid.wast). JSC used to decode such code
// without typing it, so validate() was true and compilation succeeded for modules that V8 and the
// reference interpreter reject. Fixed in oven-sh/WebKit#611.

// One function of the given type whose body is `body`, plus whatever sections the body needs.
function moduleWith({
  params = [],
  results = [],
  body,
  memory = false,
  immutableGlobal = false,
  callee = false,
}: {
  params?: number[];
  results?: number[];
  body: number[];
  memory?: boolean;
  immutableGlobal?: boolean;
  callee?: boolean;
}) {
  const section = (id: number, payload: number[]) => [id, payload.length, ...payload];
  const types = [0x60, params.length, ...params, results.length, ...results];
  // Type 1, used by the callee: (i32) -> (i64).
  const calleeType = [0x60, 1, i32, 1, i64];
  const functionBody = [0 /* no locals */, ...body, end];
  const calleeBody = [0, i64_const, 0, end];
  return new Uint8Array([
    ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    ...section(1, callee ? [2, ...types, ...calleeType] : [1, ...types]),
    ...section(3, callee ? [2, 0, 1] : [1, 0]),
    ...(memory ? section(5, [1, 0, 1]) : []),
    ...(immutableGlobal ? section(6, [1, i32, 0 /* const */, i32_const, 1, end]) : []),
    ...section(
      10,
      callee
        ? [2, functionBody.length, ...functionBody, calleeBody.length, ...calleeBody]
        : [1, functionBody.length, ...functionBody],
    ),
  ]);
}

const [i32, i64, f32] = [0x7f, 0x7e, 0x7d];
const [unreachable, block, if_, else_, end, br, br_table, return_, call, drop, select] = [
  0x00, 0x02, 0x04, 0x05, 0x0b, 0x0c, 0x0e, 0x0f, 0x10, 0x1a, 0x1b,
];
const [global_set, i32_store, memory_grow, i32_const, i64_const, f32_const, i32_eqz, i32_add, void_] = [
  0x24, 0x36, 0x40, 0x41, 0x42, 0x43, 0x45, 0x6a, 0x40,
];
const f32_zero = [f32_const, 0, 0, 0, 0];

const invalid: [string, Uint8Array][] = [
  ["unreachable; i64.const 1; i32.add", moduleWith({ body: [unreachable, i64_const, 1, i32_add, drop] })],
  [
    "() -> f32 whose dead code ends in an i32",
    moduleWith({ results: [f32], body: [unreachable, i32_const, 1, i32_const, 2, i32_add] }),
  ],
  ["return; f32.const 0; i32.eqz", moduleWith({ body: [return_, ...f32_zero, i32_eqz, drop] })],
  ["block; br 0; i64.const 1; i32.add", moduleWith({ body: [block, void_, br, 0, i64_const, 1, i32_add, drop, end] })],
  [
    "br_table; f32.const 0; i32.eqz",
    moduleWith({ params: [i32], body: [block, void_, 0x20, 0, br_table, 1, 0, 1, ...f32_zero, i32_eqz, drop, end] }),
  ],
  [
    "if (result i32) with an f32 arm and an i64 arm, entered from dead code",
    moduleWith({ body: [unreachable, i32_const, 0, if_, i32, ...f32_zero, else_, i64_const, 0, end, drop] }),
  ],
  [
    "global.set of an immutable global after unreachable",
    moduleWith({ immutableGlobal: true, body: [unreachable, i32_const, 0, global_set, 0] }),
  ],
  [
    "select with an i32 and an i64 operand",
    moduleWith({ body: [unreachable, i32_const, 0, i64_const, 0, i32_const, 1, select, drop] }),
  ],
  ["a stray value at the end of a void block", moduleWith({ body: [block, void_, unreachable, i32_const, 0, end] })],
  ["a stray value at the end of a void function", moduleWith({ body: [unreachable, i32_const, 0] })],
  [
    "i32.store of an i64",
    moduleWith({ memory: true, body: [unreachable, i32_const, 0, i64_const, 0, i32_store, 2, 0] }),
  ],
  ["memory.grow of an f32", moduleWith({ memory: true, body: [unreachable, ...f32_zero, memory_grow, 0, drop] })],
  [
    "call with an f32 argument for an i32 parameter",
    moduleWith({ callee: true, body: [unreachable, ...f32_zero, call, 1, drop] }),
  ],
  [
    "call whose i64 result is used as an i32",
    moduleWith({ callee: true, body: [unreachable, call, 1, i32_eqz, drop] }),
  ],
  [
    "a block entered from dead code does not have a polymorphic stack",
    moduleWith({ body: [unreachable, block, void_, drop, end] }),
  ],
];

// The same shapes, typed correctly. Dead code may pop operands it never pushed.
const valid: [string, Uint8Array][] = [
  ["unreachable; i32.add with no operands", moduleWith({ results: [i32], body: [unreachable, i32_add] })],
  ["unreachable; i32.const 1; i32.add", moduleWith({ body: [unreachable, i32_const, 1, i32_add, drop] })],
  [
    "() -> f32 whose dead code ends in an f32",
    moduleWith({ results: [f32], body: [unreachable, i32_const, 1, drop, ...f32_zero] }),
  ],
  ["extra values before a br are fine", moduleWith({ body: [block, void_, i32_const, 1, i32_const, 2, br, 0, end] })],
  [
    "if (result i32) with i32 arms, entered from dead code",
    moduleWith({ body: [unreachable, i32_const, 0, if_, i32, i32_const, 1, else_, i32_const, 2, end, drop] }),
  ],
  ["select with no operands", moduleWith({ results: [i32], body: [unreachable, select] })],
  [
    "i32.store and memory.grow with no operands",
    moduleWith({ memory: true, results: [i32], body: [unreachable, i32_store, 2, 0, memory_grow, 0] }),
  ],
  [
    "call with no operands whose i64 result is dropped",
    moduleWith({ callee: true, body: [unreachable, call, 1, drop] }),
  ],
  [
    "a block entered from dead code, ended by a br, has a polymorphic stack",
    moduleWith({ body: [unreachable, block, void_, br, 0, drop, end] }),
  ],
];

describe("WebAssembly validates unreachable code", () => {
  test.each(invalid)("invalid: %s", (_, bytes) => {
    expect(WebAssembly.validate(bytes)).toBe(false);
    expect(() => new WebAssembly.Module(bytes)).toThrow(WebAssembly.CompileError);
  });

  test.each(valid)("valid: %s", (_, bytes) => {
    expect(WebAssembly.validate(bytes)).toBe(true);
    expect(new WebAssembly.Module(bytes)).toBeInstanceOf(WebAssembly.Module);
  });

  test("compile() and instantiate() reject too", async () => {
    const bytes = invalid[0][1];
    await expect(WebAssembly.compile(bytes)).rejects.toBeInstanceOf(WebAssembly.CompileError);
    await expect(WebAssembly.instantiate(bytes)).rejects.toBeInstanceOf(WebAssembly.CompileError);
  });
});
