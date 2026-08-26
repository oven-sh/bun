import { gpu } from "bun:appkit";
import { emit, run } from "./_util";

function attempt(name: string, f: () => unknown) {
  try {
    f();
    emit({ step: name, threw: false });
  } catch (e) {
    const err = e as Error & { code?: string };
    emit({
      step: name,
      threw: true,
      isTypeError: err instanceof TypeError,
      code: err?.code,
      message: String(err?.message),
    });
  }
}

// Pure layout arithmetic: none of this needs a GPU.
await run(() => {
  const S = gpu.struct({ a: "float", b: "float3", c: "float4x4" });
  emit({
    step: "layout",
    offsets: { a: S.fields.a.offset, b: S.fields.b.offset, c: S.fields.c.offset },
    sizes: { a: S.fields.a.size, b: S.fields.b.size, c: S.fields.c.size },
    size: S.size,
    align: S.align,
    msl: S.msl,
    name: S.name,
  });

  const T = gpu.struct(
    { m2: "float2x2", h: "half", h3: "half3", u: "uchar4", flag: "bool", m3: "float3x3", s: "short", i2: "int2" },
    "Mixed",
  );
  emit({
    step: "mixed",
    fields: Object.fromEntries(Object.values(T.fields).map(f => [f.name, [f.offset, f.size, f.align]])),
    size: T.size,
    align: T.align,
    firstLine: T.msl.split("\n")[0],
  });

  const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const packed = S.pack({ a: 1.5, b: [1, 2, 3], c: identity });
  const f32 = new Float32Array(packed);
  emit({
    step: "pack",
    isArrayBuffer: packed instanceof ArrayBuffer,
    byteLength: packed.byteLength,
    a: f32[0],
    b: Array.from(f32.subarray(4, 8)),
    diagonal: [f32[8], f32[13], f32[18], f32[23]],
  });

  // Into an existing typed array at an offset; untouched fields keep their bytes.
  const target = new Float32Array(2 + S.size / 4).fill(7);
  const returned = S.pack({ b: Float32Array.of(9, 8, 7, 6) }, target, 8);
  emit({
    step: "pack into",
    same: returned === target,
    before: [target[0], target[1]],
    a: target[2],
    b: Array.from(target.subarray(6, 10)),
  });

  const mixed = new DataView(
    T.pack({
      h: 0.5,
      h3: [1, 2, 3],
      u: [1, 2, 3, 255],
      flag: true,
      s: -2,
      i2: [-1, 1],
      m3: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    }),
  );
  emit({
    step: "pack mixed",
    h: mixed.getFloat16(T.fields.h.offset, true),
    h3: [0, 2, 4].map(o => mixed.getFloat16(T.fields.h3.offset + o, true)),
    u: [0, 1, 2, 3].map(o => mixed.getUint8(T.fields.u.offset + o)),
    flag: mixed.getUint8(T.fields.flag.offset),
    s: mixed.getInt16(T.fields.s.offset, true),
    i2: [0, 4].map(o => mixed.getInt32(T.fields.i2.offset + o, true)),
    // Column 1 of a float3x3 starts 16 bytes in, not 12.
    m3: [0, 16, 32].map(o => mixed.getFloat32(T.fields.m3.offset + o, true)),
  });

  attempt("unknown type", () => gpu.struct({ a: "float5" as never }));
  attempt("no fields", () => gpu.struct({}));
  attempt("bad name", () => gpu.struct({ a: "float" }, "not valid"));
  attempt("wrong length", () => S.pack({ b: [1, 2] }));
  attempt("unknown field", () => S.pack({ nope: 1 } as never));
  attempt("scalar as string", () => S.pack({ a: "1" as never }));
  attempt("too small", () => S.pack({}, new ArrayBuffer(8)));
});
