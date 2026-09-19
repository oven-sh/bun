import {
  cc,
  dlopen,
  FFIType,
  JSCallback,
  linkSymbols,
  read,
  suffix,
  viewSource,
  type CString,
  type Pointer,
} from "bun:ffi";
import * as tsd from "./utilities";

// `suffix` is either "dylib", "so", or "dll" depending on the platform
// you don't have to use "suffix", it's just there for convenience
const path = `libsqlite3.${suffix}`;

const lib = dlopen(
  path, // a library name or file path
  {
    sqlite3_libversion: {
      // no arguments, returns a string
      args: [],
      returns: FFIType.cstring,
    },
    add: {
      args: [FFIType.i32, FFIType.i32],
      returns: FFIType.i32,
    },
    ptr_type: {
      args: [FFIType.pointer],
      returns: FFIType.pointer,
    },
    fn_type: {
      args: [FFIType.function],
      returns: FFIType.function,
    },
    allArgs: {
      args: [
        FFIType.char, // string
        FFIType.int8_t,
        FFIType.i8,
        FFIType.uint8_t,
        FFIType.u8,
        FFIType.int16_t,
        FFIType.i16,
        FFIType.uint16_t,
        FFIType.u16,
        FFIType.int32_t,
        FFIType.i32,
        FFIType.int,
        FFIType.uint32_t,
        FFIType.u32,
        FFIType.int64_t,
        FFIType.i64,
        FFIType.uint64_t,
        FFIType.u64,
        FFIType.double,
        FFIType.f64,
        FFIType.float,
        FFIType.f32,
        FFIType.bool,
        FFIType.ptr,
        FFIType.pointer,
        FFIType.void,
        FFIType.cstring,
        FFIType.i64_fast,
        FFIType.u64_fast,
      ],
      returns: FFIType.void,
    },
  },
);

declare const ptr: Pointer;

tsd.expectType<string | null>(lib.symbols.sqlite3_libversion());
tsd.expectType<number>(lib.symbols.add(1, 2));

tsd.expectType<Pointer | bigint | null>(lib.symbols.ptr_type(ptr));

tsd.expectType<Pointer | bigint | null>(lib.symbols.fn_type(new JSCallback(() => {}, {})));

function _arg(
  ...params: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    boolean,
    Pointer,
    Pointer,
    // tslint:disable-next-line: void-return
    // eslint-disable-next-line @typescript-eslint/no-invalid-void-type
    void,
    CString,
    number | bigint,
    number | bigint,
  ]
) {
  console.log("asdf");
}
_arg;

type libParams = Parameters<(typeof lib)["symbols"]["allArgs"]>;
tsd.expectTypeEquals<libParams[0], number>(true);
tsd.expectTypeEquals<libParams[1], number>(true);
tsd.expectTypeEquals<libParams[2], number>(true);
tsd.expectTypeEquals<libParams[3], number>(true);
tsd.expectTypeEquals<libParams[4], number>(true);
tsd.expectTypeEquals<libParams[5], number>(true);
tsd.expectTypeEquals<libParams[6], number>(true);
tsd.expectTypeEquals<libParams[7], number>(true);
tsd.expectTypeEquals<libParams[8], number>(true);
tsd.expectTypeEquals<libParams[9], number>(true);
tsd.expectTypeEquals<libParams[10], number>(true);
tsd.expectTypeEquals<libParams[11], number>(true);
tsd.expectTypeEquals<libParams[12], number>(true);
tsd.expectTypeEquals<libParams[13], number>(true);
tsd.expectTypeEquals<libParams[14], number>(true);
tsd.expectTypeEquals<libParams[15], number>(true);
tsd.expectTypeEquals<libParams[16], number>(true);
tsd.expectTypeEquals<libParams[17], number>(true);
tsd.expectTypeEquals<libParams[18], number>(true);
tsd.expectTypeEquals<libParams[19], number>(true);
tsd.expectTypeEquals<libParams[20], number>(true);
tsd.expectTypeEquals<libParams[21], number>(true);
tsd.expectTypeEquals<libParams[22], boolean>(true);
tsd.expectTypeEquals<libParams[23], Pointer>(true);
tsd.expectTypeEquals<libParams[24], Pointer>(true);
tsd.expectTypeEquals<libParams[25], undefined>(true);
tsd.expectTypeEquals<libParams[26], CString>(true);
tsd.expectTypeEquals<libParams[27], number | bigint>(true);
tsd.expectTypeEquals<libParams[28], number | bigint>(true);

// tslint:disable-next-line:no-object-literal-type-assertion
const as_const_test = {
  sqlite3_libversion: {
    args: [],
    returns: FFIType.cstring,
  },
  multi_args: {
    args: [FFIType.i32, FFIType.f32],
    returns: FFIType.void,
  },
  no_returns: {
    args: [FFIType.i32],
  },
  no_args: {
    returns: FFIType.i32,
  },
} as const;

const lib2 = dlopen(path, as_const_test);

tsd.expectType<string | null>(lib2.symbols.sqlite3_libversion());
// tslint:disable-next-line:no-void-expression
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
tsd.expectType<void>(lib2.symbols.multi_args(1, 2));
tsd.expectTypeEquals<ReturnType<(typeof lib2)["symbols"]["no_returns"]>, undefined>(true);
tsd.expectTypeEquals<Parameters<(typeof lib2)["symbols"]["no_args"]>, []>(true);

tsd.expectType<number>(read.u8(ptr));
tsd.expectType<number>(read.u8(ptr, 0));
tsd.expectType<number>(read.i8(ptr, 0));
tsd.expectType<number>(read.u16(ptr, 0));
tsd.expectType<number>(read.i16(ptr, 0));
tsd.expectType<number>(read.u32(ptr, 0));
tsd.expectType<number>(read.i32(ptr, 0));
tsd.expectType<bigint>(read.u64(ptr, 0));
tsd.expectType<bigint>(read.i64(ptr, 0));
tsd.expectType<number>(read.f32(ptr, 0));
tsd.expectType<number>(read.f64(ptr, 0));
tsd.expectType<number>(read.ptr(ptr, 0));
tsd.expectType<number>(read.intptr(ptr, 0));

// Every name the runtime accepts in `args`/`returns` is declared: the keys of the FFIType
// object in src/js/bun/ffi.ts as enum members, and the table in src/runtime/ffi/abi_type.rs
// as strings.
declare const callback: JSCallback;
declare const view: Uint8Array;

const aliases = dlopen(path, {
  c_ints: { args: [FFIType.c_int, FFIType.c_uint, "c_int", "c_uint"], returns: "c_int" },
  returns_c_uint: { args: [], returns: FFIType.c_uint },
  sizes: { args: [FFIType.isize, FFIType.usize, "isize", "usize", "size_t"], returns: "isize" },
  returns_usize: { args: [], returns: FFIType.usize },
  returns_size_t: { args: [], returns: "size_t" },
  fast: { args: ["i64_fast", "u64_fast"], returns: "i64_fast" },
  returns_u64_fast: { args: [], returns: "u64_fast" },
  c_pointers: { args: ["char*", "void*"], returns: "char*" },
  returns_void_pointer: { args: [], returns: "void*" },
  function_members: { args: [FFIType.callback, FFIType.fn], returns: FFIType.fn },
  function_names: { args: ["function", "callback", "fn"], returns: "fn" },
  buffers: { args: [FFIType.buffer, FFIType.buffer_bytelength, "buffer", "buffer_bytelength"] },
} as const);

type AliasParams<K extends keyof (typeof aliases)["symbols"]> = Parameters<(typeof aliases)["symbols"][K]>;
type Int64Arg = number | bigint;
type PointerArg = NodeJS.TypedArray | Pointer | bigint | null;
type PointerReturn = Pointer | bigint | null;
type BufferArg = NodeJS.TypedArray | DataView;

tsd.expectType<AliasParams<"c_ints">>().is<[number, number, number, number]>();
tsd.expectType(aliases.symbols.c_ints(1, 2, 3, 4)).is<number>();
tsd.expectType(aliases.symbols.returns_c_uint()).is<number>();

tsd.expectType<AliasParams<"sizes">>().is<[Int64Arg, Int64Arg, Int64Arg, Int64Arg, Int64Arg]>();
tsd.expectType(aliases.symbols.sizes(-1, 1n, -1n, 1, 1)).is<bigint>();
tsd.expectType(aliases.symbols.returns_usize()).is<bigint>();
tsd.expectType(aliases.symbols.returns_size_t()).is<bigint>();

tsd.expectType<AliasParams<"fast">>().is<[Int64Arg, Int64Arg]>();
tsd.expectType(aliases.symbols.fast(1, 1n)).is<Int64Arg>();
tsd.expectType(aliases.symbols.returns_u64_fast()).is<Int64Arg>();

tsd.expectType<AliasParams<"c_pointers">>().is<[PointerArg, PointerArg]>();
tsd.expectType(aliases.symbols.c_pointers(view, null)).is<PointerReturn>();
tsd.expectType(aliases.symbols.returns_void_pointer()).is<PointerReturn>();

tsd.expectType<AliasParams<"function_members">>().is<[Pointer | JSCallback, Pointer | JSCallback]>();
tsd.expectType(aliases.symbols.function_members(callback, ptr)).is<PointerReturn>();
// The string spellings resolve like "function" and "callback" always have (to the pointer
// argument type), so `fn(callback.ptr)` keeps compiling.
tsd.expectType<AliasParams<"function_names">>().is<[PointerArg, PointerArg, PointerArg]>();
tsd.expectType(aliases.symbols.function_names(callback.ptr, ptr, 1n)).is<PointerReturn>();

tsd.expectType<AliasParams<"buffers">>().is<[BufferArg, BufferArg, BufferArg, BufferArg]>();
tsd.expectType(aliases.symbols.buffers(view, view, view, view)).is<undefined>();

// Names the runtime does not accept stay undeclared.
// @ts-expect-error the runtime FFIType object has no `size_t` key (only the string is accepted)
FFIType.size_t;
// @ts-expect-error "jsvalue" is not accepted by bun:ffi
viewSource({ f: { args: ["jsvalue"] } });

// The same FFIFunction declaration type is shared by every entry point.
const linked = linkSymbols({
  strlen: { args: ["char*"], returns: "size_t", ptr },
  labs: { args: ["isize"], returns: FFIType.isize, ptr },
} as const);
tsd.expectType(linked.symbols.strlen(view)).is<bigint>();
tsd.expectType(linked.symbols.labs(-1n)).is<bigint>();

const compiled = cc({
  source: "add.c",
  symbols: { add: { args: ["c_int", FFIType.c_uint], returns: "u64_fast" } } as const,
});
tsd.expectType(compiled.symbols.add(1, 2)).is<number | bigint>();

new JSCallback(() => 0n, { args: ["void*", "size_t", FFIType.usize], returns: "isize" });
viewSource({ f: { args: ["i64_fast", "fn", FFIType.buffer_bytelength], returns: "c_uint" } });
viewSource({ args: [FFIType.callback], returns: FFIType.c_int }, true);
